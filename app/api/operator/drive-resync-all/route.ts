import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { isDriveConfigured } from "@/lib/google-drive"
import { resyncBookingToDrive, resyncSignedContractToDrive, type ResyncItem } from "@/lib/drive-resync"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * POST /api/operator/drive-resync-all   { only?: "vouchers" | "contracts" }
 * Authorization: Bearer <OPERATOR_PASSWORD>  (middleware で保護)
 *
 * PDF版数1.4化(2026-09-17)より前に共有ドライブへ格納した旧版(1.3=印刷で画像が消える)書類を、
 * 新コードで再生成し同名で上書きして差し替える一括バックフィル。冪等(何度実行しても同名上書き)。
 *  - vouchers : drive_url を持つ予約のバウチャー+ラベルを再格納
 *  - contracts: 署名済み代理店の契約書を(署名内容を忠実に再現して)再格納
 * 件数が多く 60s に収まらない場合は only で分割実行できる。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "drive-resync-all")
  if (!limit.ok) return limit.response

  let only: "vouchers" | "contracts" | undefined
  try {
    const body = (await req.json()) as { only?: unknown }
    if (body?.only === "vouchers" || body?.only === "contracts") only = body.only
  } catch {
    /* body 省略可 = 両方 */
  }

  if (!isDriveConfigured()) {
    return NextResponse.json({ error: "Google Drive 未設定 (GOOGLE_DRIVE_SA_KEY / GOOGLE_DRIVE_ROOT_ID)" }, { status: 503 })
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })

  const vouchers: ResyncItem[] = []
  const contracts: ResyncItem[] = []

  // ── バウチャー: drive_url を持つ予約 ──
  if (only !== "contracts") {
    const { data, error } = await sb
      .from("shipments")
      .select("booking_id")
      .not("drive_url", "is", null)
    if (error) return NextResponse.json({ error: `bookings query: ${error.message}` }, { status: 500 })
    const bookingIds = Array.from(new Set((data ?? []).map((r) => r.booking_id as string).filter(Boolean)))
    for (const id of bookingIds) {
      try {
        vouchers.push(await resyncBookingToDrive(sb, id))
      } catch (e) {
        vouchers.push({ id, ok: false, error: e instanceof Error ? e.message : "exception" })
      }
    }
  }

  // ── 契約書: 署名済み代理店 ──
  if (only !== "vouchers") {
    const { data, error } = await sb.from("agency_contract_signatures").select("agency")
    if (error) return NextResponse.json({ error: `signatures query: ${error.message}` }, { status: 500 })
    const agencies = Array.from(new Set((data ?? []).map((r) => r.agency as string).filter(Boolean)))
    for (const name of agencies) {
      try {
        contracts.push(await resyncSignedContractToDrive(sb, name))
      } catch (e) {
        contracts.push({ id: name, ok: false, error: e instanceof Error ? e.message : "exception" })
      }
    }
  }

  const okCount = [...vouchers, ...contracts].filter((r) => r.ok).length
  const failCount = [...vouchers, ...contracts].filter((r) => !r.ok).length
  return NextResponse.json({
    ok: failCount === 0,
    summary: { ok: okCount, failed: failCount, vouchers: vouchers.length, contracts: contracts.length },
    vouchers,
    contracts,
  })
}
