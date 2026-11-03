import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveB2cOperator } from "@/lib/b2c/operator-identity"
import { setFacilityStatus, setHotelAcceptance } from "@/lib/b2c/hotel-ops"

export const runtime = "nodejs"

/**
 * POST /api/b2c/ops/hotel — ホテルの確認の結果の入力（運営・Stage 4）。
 * 個人のパスキーの v2 のセッション（operator_email 登録済み）だけ。共有パスワード・v1 のセッションは 403。
 * body: { action: "facility", placeId, status: "verified"|"unsupported", note }
 *     | { action: "acceptance", orderNumber, side: "origin"|"dest", status: "accepted"|"refused"|"no_answer", note }
 * note（確認の方法・相手・理由）は必須（記録に残す）。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "b2c-ops")
  if (!limit.ok) return limit.response
  const op = await resolveB2cOperator(req)
  if (!op) return NextResponse.json({ ok: false, error: "operator_passkey_required" }, { status: 403 })
  let b: Record<string, unknown>
  try {
    b = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : ""
  if (!note) return NextResponse.json({ ok: false, error: "note_required" }, { status: 422 })
  if (b.action === "facility") {
    const placeId = typeof b.placeId === "string" ? b.placeId : ""
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId) || (b.status !== "verified" && b.status !== "unsupported")) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 })
    }
    const r = await setFacilityStatus(op, placeId, b.status, note)
    return NextResponse.json(r, { status: r.ok ? 200 : r.error === "facility_not_found" ? 404 : 500 })
  }
  if (b.action === "acceptance") {
    const n = Number(b.orderNumber)
    if (!Number.isInteger(n) || (b.side !== "origin" && b.side !== "dest") || !["accepted", "refused", "no_answer"].includes(b.status as string)) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 })
    }
    const r = await setHotelAcceptance(op, n, b.side, b.status as "accepted" | "refused" | "no_answer", note)
    return NextResponse.json(r, { status: r.ok ? 200 : r.error === "order_not_found" ? 404 : 422 })
  }
  return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 422 })
}
