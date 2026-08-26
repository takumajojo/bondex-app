import { NextRequest, NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { renderToBuffer } from "@react-pdf/renderer"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { ContractDocument, CONTRACT_VERSION, type ContractInput } from "@/lib/contract-pdf"
import { sendMail, mailerConfigured } from "@/lib/mailer"
import { putContractDocument } from "@/lib/google-drive"
import { notifyBondEx } from "@/lib/notify"

export const runtime = "nodejs"
export const maxDuration = 30

const BONDEX = {
  companyName: "株式会社JOJO",
  representativeTitle: "代表取締役",
  representativeName: "谷口 琢真",
  address: "〒158-0092 東京都世田谷区野毛1-9-12",
  email: "support@bondex.express",
  bankInfo: "三菱UFJ銀行 田園調布駅前支店 普通 0145653 株式会社JOJO",
}

// timestamptz(または現在時刻) を JST の「YYYY年M月D日」に整形する。
function jpDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d)
  const y = parts.find((p) => p.type === "year")?.value ?? ""
  const m = parts.find((p) => p.type === "month")?.value ?? ""
  const dd = parts.find((p) => p.type === "day")?.value ?? ""
  return `${y}年${m}月${dd}日`
}

// 締結日の英語表記（例: August 4, 2026）。JST 基準。
function enDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d)
}

function fmtSignedDate(d: Date, locale: "ja" | "en"): string {
  return locale === "en" ? enDate(d) : jpDate(d)
}

// 署名済み契約書を登録会社(+BondEx控え)へメール送信する。ベストエフォート(失敗しても署名は成立)。
// ※ onboarding@resend.dev(共有ドメイン)では Resend 登録メール宛しか届かない。任意の代理店宛に
//    送るには bondex.express のドメイン認証(Plan B)が必要。
async function sendSignedContract(opts: {
  toAgencyEmail: string
  agencyName: string
  signerName: string
  signedDate: string
  pdfBase64: string
  locale?: "ja" | "en"
}): Promise<{ agencySent: boolean; bondexSent: boolean; to?: string; note?: string }> {
  if (!mailerConfigured()) return { agencySent: false, bondexSent: false, note: "メール未設定" }
  const en = opts.locale === "en"
  const subject = en
    ? `[BondEx] Your service agreement is signed (${opts.agencyName})`
    : `【BondEx】業務委託契約 締結完了のご連絡（${opts.agencyName} 御中）`
  const text = en
    ? [
        `Dear ${opts.agencyName},`,
        "",
        "Thank you for reviewing and signing the service agreement.",
        `The agreement was concluded as of ${opts.signedDate}. Please find the signed contract (PDF) attached and keep it for your records.`,
        "",
        "───────────────────",
        "  Contract : Agency Service Agreement",
        `  Date     : ${opts.signedDate}`,
        `  Signer   : ${opts.signerName}`,
        "───────────────────",
        "",
        "If you have any questions, reply to this email or contact support@bondex.express.",
        "",
        "— BondEx (luggage-forwarding coordination) / JOJO Inc.",
        "Web  : https://bondex.express",
        "Mail : support@bondex.express",
      ].join("\n")
    : [
        `${opts.agencyName} 御中`,
        "",
        "平素より大変お世話になっております。BondEx（株式会社JOJO）でございます。",
        "",
        "このたびは業務委託契約にご同意・ご署名を賜り、誠にありがとうございます。",
        `下記のとおり ${opts.signedDate} 付で本契約が締結されましたので、署名済みの契約書（PDF）を添付のうえご送付申し上げます。`,
        "控えとして大切に保管くださいますようお願い申し上げます。",
        "",
        "───────────────────",
        "　契約名　：業務委託契約書",
        `　締結日　：${opts.signedDate}`,
        `　署名者　：${opts.signerName}`,
        "───────────────────",
        "",
        "ご不明な点がございましたら、本メールへのご返信、または support@bondex.express までお気軽にお問い合わせください。",
        "今後とも何卒よろしくお願い申し上げます。",
        "",
        "━━━━━━━━━━━━━━━━━━",
        "BondEx（手荷物配送手配サービス）／ 株式会社JOJO",
        "Web  : https://bondex.express",
        "Mail : support@bondex.express",
        "━━━━━━━━━━━━━━━━━━",
      ].join("\n")
  const attachments = [{ filename: "bondex-contract-signed.pdf", contentBase64: opts.pdfBase64 }]
  const replyTo = "support@bondex.express"

  // 会社宛とBondEx控えは別々に送る(片方が失敗しても他方は届くように)
  const agencyEmail = opts.toAgencyEmail.trim()
  const bondexCopy = process.env.ALERT_EMAIL?.trim()
  const agencyRes = agencyEmail
    ? await sendMail({ to: agencyEmail, subject, text, attachments, replyTo })
    : { sent: false }
  const bondexRes =
    bondexCopy && bondexCopy !== agencyEmail
      ? await sendMail({ to: bondexCopy, subject, text, attachments, replyTo })
      : { sent: false }
  return {
    agencySent: agencyRes.sent,
    bondexSent: bondexRes.sent,
    to: agencyEmail || undefined,
    note: !agencyEmail
      ? "会社の登録メール未設定"
      : !agencyRes.sent
        ? "会社宛の送信設定(SMTP)を確認してください"
        : undefined,
  }
}

function contractNumberFor(agencyName: string): string {
  const now = new Date()
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  return `BDX-CONTRACT-${ym}-${(agencyName.length % 100).toString().padStart(3, "0")}`
}

function buildData(
  agencyName: string,
  signature?: ContractInput["signature"] & { effectiveDate?: string },
  agencyAddress?: string,
  locale: "ja" | "en" = "ja",
): ContractInput {
  return {
    contractNumber: contractNumberFor(agencyName),
    locale,
    effectiveDate: signature?.signedDate ?? (locale === "en" ? "____________, 20__" : "　　　　年　　月　　日"),
    agency: { name: agencyName, address: agencyAddress || undefined },
    bondex: BONDEX,
    pricePerSuitcaseYen: 5000,
    serviceBrandName: "BondEx",
    signature: signature
      ? {
          signerName: signature.signerName,
          signerTitle: signature.signerTitle,
          signedDate: signature.signedDate,
          signatureImageDataUrl: signature.signatureImageDataUrl,
          auditId: signature.auditId,
          docHashShort: signature.docHashShort,
        }
      : undefined,
  }
}

// 署名対象(条項)の版ハッシュ: 署名を含まないテンプレを描画して SHA-256。版+言語が同じなら決定的。
async function termsHash(agencyName: string, locale: "ja" | "en" = "ja"): Promise<string> {
  const buf = await renderToBuffer(ContractDocument({ data: buildData(agencyName, undefined, undefined, locale) }))
  return createHash("sha256").update(buf).digest("hex")
}

function agencyLocaleOf(a: { locale?: string | null }): "ja" | "en" {
  return a.locale === "en" ? "en" : "ja"
}

/**
 * GET /api/agency/contract          — 自社の契約署名ステータス
 * GET /api/agency/contract?download=1 — 署名済み契約書PDF(署名レコードから再生成)
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "agency-contract-get")
  if (!limit.ok) return limit.response
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  const resolved = await resolveAgencyFromRequest(req)
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const agencyName = resolved.agency.name
  const locale = agencyLocaleOf(resolved.agency)
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 })

  // 署名前プレビュー: 代理店名を差し込んだ未署名の契約書(=これから同意する内容)を返す
  if (req.nextUrl.searchParams.get("preview") === "1") {
    const buf = await renderToBuffer(ContractDocument({ data: buildData(agencyName, undefined, undefined, locale) }))
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="bondex-contract-${agencyName.replace(/\s+/g, "_")}.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  }

  const { data: sig } = await sb
    .from("agency_contract_signatures")
    .select("id, signer_name, signer_title, signature_image, contract_version, contract_hash, signed_at")
    .eq("agency", agencyName)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const wantDownload = req.nextUrl.searchParams.get("download") === "1"
  if (wantDownload) {
    if (!sig) return NextResponse.json({ error: "未署名です" }, { status: 404 })
    const signedDate = fmtSignedDate(new Date(sig.signed_at), locale)
    const data = buildData(
      agencyName,
      {
        signerName: sig.signer_name,
        signerTitle: sig.signer_title ?? undefined,
        signedDate,
        signatureImageDataUrl: sig.signature_image ?? undefined,
        auditId: sig.id,
        docHashShort: (sig.contract_hash ?? "").slice(0, 16),
      },
      undefined,
      locale,
    )
    // 署名済み契約は「署名した時点の条文」で再現する (条文改定後も過去契約の内容を変えない)
    data.termsVersion = sig.contract_version ?? undefined
    const buf = await renderToBuffer(ContractDocument({ data }))
    const fileName = `bondex-contract-signed-${agencyName.replace(/\s+/g, "_")}.pdf`
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    })
  }

  return NextResponse.json({
    status: resolved.agency.contract_status ?? "unsigned",
    agencyName,
    locale,
    currentVersion: CONTRACT_VERSION,
    signed: !!sig,
    signedAt: sig?.signed_at ?? null,
    signerName: sig?.signer_name ?? null,
    signerTitle: sig?.signer_title ?? null,
    signedVersion: sig?.contract_version ?? null,
    address: resolved.agency.billing_address ?? null,
  })
}

/**
 * POST /api/agency/contract — 手書きサイン+同意で契約を締結する。
 * body: { signerName, signerTitle?, signatureImage(dataURL PNG), agreed:true }
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-contract-sign")
  if (!limit.ok) return limit.response
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  const resolved = await resolveAgencyFromRequest(req)
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const agencyName = resolved.agency.name

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const signerName = typeof body.signerName === "string" ? body.signerName.trim() : ""
  const signerTitle = typeof body.signerTitle === "string" ? body.signerTitle.trim() : ""
  const companyAddress = typeof body.companyAddress === "string" ? body.companyAddress.trim() : ""
  const signatureImage = typeof body.signatureImage === "string" ? body.signatureImage : ""
  const agreed = body.agreed === true

  if (!agreed) return NextResponse.json({ error: "契約内容への同意が必要です。" }, { status: 400 })
  if (!signerName) return NextResponse.json({ error: "署名者のお名前を入力してください。" }, { status: 400 })
  if (signerName.length > 60) return NextResponse.json({ error: "お名前が長すぎます。" }, { status: 400 })
  if (signerTitle.length > 60) return NextResponse.json({ error: "役職が長すぎます。" }, { status: 400 })
  if (!companyAddress) return NextResponse.json({ error: "会社住所を入力してください。" }, { status: 400 })
  if (companyAddress.length > 200) return NextResponse.json({ error: "住所が長すぎます。" }, { status: 400 })
  if (!signatureImage.startsWith("data:image/")) {
    return NextResponse.json({ error: "手書きサインが未入力です。" }, { status: 400 })
  }
  // data URL の肥大化・悪用防止 (~2MB)
  if (signatureImage.length > 2_800_000) {
    return NextResponse.json({ error: "サイン画像が大きすぎます。" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 })

  const locale = agencyLocaleOf(resolved.agency)
  const auditId = randomUUID()
  const docHash = await termsHash(agencyName, locale)
  const signedDate = fmtSignedDate(new Date(), locale)

  // 署名済みPDFを生成 (即時ダウンロード用に base64 で返す)
  const data = buildData(
    agencyName,
    {
      signerName,
      signerTitle: signerTitle || undefined,
      signedDate,
      signatureImageDataUrl: signatureImage,
      auditId,
      docHashShort: docHash.slice(0, 16),
    },
    companyAddress,
    locale,
  )
  const buf = await renderToBuffer(ContractDocument({ data }))
  const signedPdfBase64 = Buffer.from(buf).toString("base64")

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    ""
  const userAgent = req.headers.get("user-agent")?.slice(0, 400) ?? ""

  const { error: sigErr } = await sb.from("agency_contract_signatures").insert({
    id: auditId,
    agency: agencyName,
    signer_name: signerName,
    signer_title: signerTitle || null,
    signature_image: signatureImage,
    contract_version: CONTRACT_VERSION,
    contract_hash: docHash,
    ip: ip || null,
    user_agent: userAgent || null,
  })
  if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 })

  const { error: agErr } = await sb
    .from("agencies")
    .update({
      contract_status: "signed",
      contract_signed_at: new Date().toISOString(),
      contract_signer_name: signerName,
      contract_signer_title: signerTitle || null,
      contract_version: CONTRACT_VERSION,
      // 契約書に記載した会社住所を保存 (請求書の billing_address にも再利用される)
      billing_address: companyAddress,
    })
    .eq("id", resolved.agency.id)
  if (agErr) return NextResponse.json({ error: agErr.message }, { status: 500 })

  // 署名済み契約書を谷口さん専用の Drive「契約書/<代理店名>」に保管 (代理店には共有しない・best-effort)。
  // クライアントが増えても同じ構造に自動で溜まる。失敗しても署名は成立させる。
  let driveSaved = false
  try {
    const safeName = agencyName.replace(/[\\/]/g, "-")
    const drive = await putContractDocument(agencyName, `${safeName}_契約書_署名済.pdf`, Buffer.from(buf))
    driveSaved = drive.ok
    if (!drive.ok) console.error("[contract] Drive 保管失敗:", drive.error)
  } catch (e) {
    console.error("[contract] Drive 保管例外:", e instanceof Error ? e.message : e)
  }

  // 締結後、署名済みPDFを登録会社(+BondEx控え)へメール送信 (ベストエフォート)
  const email = await sendSignedContract({
    toAgencyEmail: resolved.agency.contact_email ?? "",
    agencyName,
    signerName,
    signedDate,
    pdfBase64: signedPdfBase64,
    locale,
  })

  // 社内通知(Slack集約) — 受注契約が締結されたことを1部屋に流す。
  await notifyBondEx({
    kind: "contract",
    title: `${agencyName} が契約締結`,
    lines: [`署名者: ${signerName}`, `締結日: ${signedDate}`],
    link: `/operator/agencies`,
    linkLabel: "代理店一覧で確認",
  })

  return NextResponse.json({
    ok: true,
    auditId,
    signedDate,
    contractVersion: CONTRACT_VERSION,
    signedPdfBase64,
    emailSent: email.agencySent,
    emailBondexSent: email.bondexSent,
    emailTo: email.to ?? resolved.agency.contact_email ?? null,
    emailNote: email.note ?? null,
    driveSaved,
  })
}
