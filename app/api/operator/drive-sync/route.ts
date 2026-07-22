import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { regenerateVoucherPdf } from "@/lib/voucher-regen"
import { putBookingDocuments, isDriveConfigured, type DriveFile } from "@/lib/google-drive"
import { setBookingDriveUrl } from "@/lib/shipments-db"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 予約の書類 (バウチャー + 発行済み送り状) を Google 共有ドライブの「予約番号」フォルダに
 * 格納し、そのフォルダ URL を drive_url に保存する (代理店ポータルに「フォルダ」リンクが出る)。
 *
 *   POST /api/operator/drive-sync  { "bookingId": "BDX-260721-XXXX" }
 *   Authorization: Bearer <OPERATOR_PASSWORD>   (middleware で保護)
 *
 * Drive 未設定 (env なし) なら 503 を返し、何もしない (graceful degrade)。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "drive-sync")
  if (!limit.ok) return limit.response

  let body: { bookingId?: unknown }
  try {
    body = (await req.json()) as { bookingId?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : ""
  if (!/^BDX-[\dA-Z]+-[\dA-Z]+$/i.test(bookingId)) {
    return NextResponse.json({ error: "Invalid bookingId" }, { status: 400 })
  }

  if (!isDriveConfigured()) {
    return NextResponse.json(
      { error: "Google Drive 未設定 (GOOGLE_DRIVE_SA_KEY / GOOGLE_DRIVE_ROOT_ID を Vercel に設定してください)" },
      { status: 503 },
    )
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) {
    return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
  }

  // 1) バウチャー PDF を再生成 (発行時と同じ内容・言語)
  const voucher = await regenerateVoucherPdf(sb, bookingId)
  if (!voucher.ok) {
    return NextResponse.json({ error: "Voucher regeneration failed (予約が見つからない等)" }, { status: 404 })
  }

  const files: DriveFile[] = [
    { name: voucher.fileName || `${bookingId}_voucher.pdf`, buffer: Buffer.from(voucher.buf) },
  ]

  // 2) 発行済みの送り状 (Ship&co ラベル) を各区間ぶん取得して同梱
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
        const buf = Buffer.from(await r.arrayBuffer())
        files.push({ name: `${bookingId}_label_L${leg.leg_index + 1}.pdf`, buffer: buf })
      }
    } catch {
      // ラベル取得失敗はスキップ (バウチャーだけでも格納する)
    }
  }

  // 3) 共有ドライブへ格納 (代理店フォルダ → 予約番号フォルダ)
  const result = await putBookingDocuments(bookingId, files, voucher.agencyName)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  // 4) drive_url を保存 → 代理店ポータル/運営ダッシュボードに「フォルダ」リンクが出る
  const saved = await setBookingDriveUrl(bookingId, result.folderUrl)
  if (!saved.ok) {
    // 格納は成功したが URL 保存に失敗 — フォルダ URL は返す (手動で貼れる)
    return NextResponse.json(
      { ok: true, folderUrl: result.folderUrl, files: files.map((f) => f.name), warning: `drive_url 保存失敗: ${saved.error}` },
    )
  }

  return NextResponse.json({ ok: true, folderUrl: result.folderUrl, files: files.map((f) => f.name) })
}
