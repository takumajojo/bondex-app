// Drive 再保存（バックフィル）の共有ロジック。
//
// 目的: PDF 版数を 1.4 化した修正(2026-09-17)より前に共有ドライブへ格納された書類は、
// 旧版(1.3)のままで「印刷すると透明画像が消える」。新コードで再生成し、同名で上書き
// (google-drive の saveToDrive は同名 upsert)して差し替える。
//
//  - バウチャー: /api/operator/drive-sync と同じ手順(バウチャー再生成 + ラベル同梱 + フォルダ格納)。
//  - 契約書:     署名レコードから「署名時の内容(署名画像・条項の版・署名日)」を忠実に再現し、
//                契約番号も署名月(UTC)から採番して原本の番号を再現する。金額は v1/v2 は条文側で
//                ¥5,000固定・v3 は CONTRACT_PRICE_YEN(4,980)。中身は変えず版数と画像埋め込みのみ是正。

import type { SupabaseClient } from "@supabase/supabase-js"
import { renderToBuffer } from "@react-pdf/renderer"
import { ContractDocument, type ContractInput } from "@/lib/contract-pdf"
import { regenerateVoucherPdf } from "@/lib/voucher-regen"
import {
  putBookingDocuments,
  putContractDocument,
  type DriveFile,
} from "@/lib/google-drive"
import { setBookingDriveUrl } from "@/lib/shipments-db"

// 甲(BondEx=株式会社JOJO)の当事者情報。app/api/agency/contract/route.ts の BONDEX と一致させる。
const BONDEX = {
  companyName: "株式会社JOJO",
  representativeTitle: "代表取締役",
  representativeName: "谷口 琢真",
  address: "〒158-0092 東京都世田谷区野毛1-9-12",
  email: "support@bondex.express",
  bankInfo: "三菱UFJ銀行 田園調布駅前支店 普通 0145653 株式会社JOJO",
}

function fmtSignedDate(d: Date, locale: "ja" | "en"): string {
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d)
  }
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d)
  const y = p.find((x) => x.type === "year")?.value ?? ""
  const m = p.find((x) => x.type === "month")?.value ?? ""
  const dd = p.find((x) => x.type === "day")?.value ?? ""
  return `${y}年${m}月${dd}日`
}

// 原本の契約番号を再現する。contractNumberFor(UTC now) と同じ算法を署名時刻に適用する。
function contractNumberForSignedAt(agencyName: string, signedAt: Date): string {
  const ym = `${signedAt.getUTCFullYear()}${String(signedAt.getUTCMonth() + 1).padStart(2, "0")}`
  return `BDX-CONTRACT-${ym}-${(agencyName.length % 100).toString().padStart(3, "0")}`
}

export type ResyncItem = { id: string; ok: boolean; detail?: string; error?: string }

/**
 * 1 予約ぶんのバウチャー+ラベルを共有ドライブへ再格納する(同名上書き)。
 * /api/operator/drive-sync のコア手順と同一。
 */
export async function resyncBookingToDrive(
  sb: SupabaseClient,
  bookingId: string,
): Promise<ResyncItem> {
  const voucher = await regenerateVoucherPdf(sb, bookingId)
  if (!voucher.ok) return { id: bookingId, ok: false, error: "voucher regen failed" }

  const files: DriveFile[] = [
    { name: voucher.fileName || `${bookingId}_voucher.pdf`, buffer: Buffer.from(voucher.buf) },
  ]

  // 発行済み送り状(Ship&co ラベル・外部PDF)は再取得のみで同梱(内容は不変)。
  const { data: legs } = await sb
    .from("shipments")
    .select("leg_index, yamato_label_url")
    .eq("booking_id", bookingId)
    .order("leg_index", { ascending: true })
  for (const leg of (legs ?? []) as Array<{ leg_index: number; yamato_label_url: string | null }>) {
    if (!leg.yamato_label_url) continue
    try {
      const r = await fetch(leg.yamato_label_url)
      if (r.ok) {
        files.push({
          name: `${bookingId}_label_L${leg.leg_index + 1}.pdf`,
          buffer: Buffer.from(await r.arrayBuffer()),
        })
      }
    } catch {
      /* ラベル取得失敗はスキップ(バウチャーだけでも差し替える) */
    }
  }

  let agencyEmail: string | undefined
  if (voucher.agencyName) {
    const { data: ag } = await sb
      .from("agencies")
      .select("contact_email")
      .eq("name", voucher.agencyName)
      .maybeSingle()
    agencyEmail = ((ag?.contact_email as string | null) ?? undefined) || undefined
  }

  const result = await putBookingDocuments(bookingId, files, voucher.agencyName, agencyEmail)
  if (!result.ok) return { id: bookingId, ok: false, error: result.error }
  await setBookingDriveUrl(bookingId, result.folderUrl)
  return { id: bookingId, ok: true, detail: files.map((f) => f.name).join(", ") }
}

/**
 * 1 代理店の署名済み契約書を、署名内容を忠実に再現して共有ドライブへ再格納する(同名上書き)。
 */
export async function resyncSignedContractToDrive(
  sb: SupabaseClient,
  agencyName: string,
): Promise<ResyncItem> {
  const { data: ag } = await sb
    .from("agencies")
    .select("locale")
    .eq("name", agencyName)
    .maybeSingle()
  const locale: "ja" | "en" = ag?.locale === "en" ? "en" : "ja"

  const { data: sig } = await sb
    .from("agency_contract_signatures")
    .select("id, signer_name, signer_title, signature_image, contract_version, contract_hash, signed_at")
    .eq("agency", agencyName)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!sig) return { id: agencyName, ok: false, error: "no signature" }

  const signedAt = new Date(sig.signed_at as string)
  const signedDate = fmtSignedDate(signedAt, locale)
  const data: ContractInput = {
    contractNumber: contractNumberForSignedAt(agencyName, signedAt),
    locale,
    effectiveDate: signedDate,
    agency: { name: agencyName, address: undefined },
    bondex: BONDEX,
    serviceBrandName: "BondEx",
    // 署名した時点の条文で再現(条文改定後も過去契約の内容を変えない)。
    termsVersion: (sig.contract_version as string | null) ?? undefined,
    signature: {
      signerName: sig.signer_name as string,
      signerTitle: (sig.signer_title as string | null) ?? undefined,
      signedDate,
      signatureImageDataUrl: (sig.signature_image as string | null) ?? undefined,
      auditId: sig.id as string,
      docHashShort: ((sig.contract_hash as string | null) ?? "").slice(0, 16),
    },
  }

  const buf = await renderToBuffer(ContractDocument({ data }))
  const safeName = agencyName.replace(/[\\/]/g, "-")
  const drive = await putContractDocument(agencyName, `${safeName}_契約書_署名済.pdf`, Buffer.from(buf))
  if (!drive.ok) return { id: agencyName, ok: false, error: drive.error }
  return { id: agencyName, ok: true, detail: `${safeName}_契約書_署名済.pdf (${sig.contract_version ?? "?"})` }
}
