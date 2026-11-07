import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveB2cOperator } from "@/lib/b2c/operator-identity"
import { holdFacility, loadB2cHotelQueue, setFacilityStatus, setHotelAcceptance, type HotelOpsResult } from "@/lib/b2c/hotel-ops"

export const runtime = "nodejs"

/**
 * /api/b2c/ops/hotel — ホテルの確認の結果の入力（運営・Stage 4）。
 * 見るのも操作も、個人のパスキーの v2 のセッション（operator_email 登録済み）だけ。共有パスワード・v1 のセッションは 403。
 * GET: 確認待ちの一覧（未確認の施設ごと・直前予約の受入ごと）。旅行者の名前・連絡先は返さない。
 * POST: { action: "facility", placeId, status: "verified"|"unsupported"|"hold", note }
 *     | { action: "acceptance", orderNumber, side: "origin"|"dest", status: "accepted"|"refused"|"no_answer"|"hold", note }
 * note（確認の方法・相手・理由）は必須（記録に残す）。
 * 既に決まった施設・受入をもう一度操作すると 409（state_changed / already_decided）: 二重の押下・別の運営者との同時の操作で上書きしない。
 */
const CONFLICT = new Set(["state_changed", "already_decided", "nothing_waiting"])
const statusOf = (r: HotelOpsResult) =>
  r.ok ? 200 : r.error === "facility_not_found" || r.error === "order_not_found" ? 404 : CONFLICT.has(r.error ?? "") ? 409 : r.error === "not_late_booking" ? 422 : 500

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "b2c-ops")
  if (!limit.ok) return limit.response
  if (!(await resolveB2cOperator(req))) return NextResponse.json({ ok: false, error: "operator_passkey_required" }, { status: 403 })
  const q = await loadB2cHotelQueue()
  return q ? NextResponse.json({ ok: true, ...q }) : NextResponse.json({ ok: false, error: "server_error" }, { status: 500 })
}

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
  if (!b || typeof b !== "object") return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 })
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : ""
  if (!note) return NextResponse.json({ ok: false, error: "note_required" }, { status: 422 })
  if (b.action === "facility") {
    const placeId = typeof b.placeId === "string" ? b.placeId : ""
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId) || !["verified", "unsupported", "hold"].includes(b.status as string)) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 })
    }
    const r = b.status === "hold" ? await holdFacility(op, placeId, note) : await setFacilityStatus(op, placeId, b.status as "verified" | "unsupported", note)
    return NextResponse.json(r, { status: statusOf(r) })
  }
  if (b.action === "acceptance") {
    const n = Number(b.orderNumber)
    if (!Number.isInteger(n) || n <= 0 || (b.side !== "origin" && b.side !== "dest") || !["accepted", "refused", "no_answer", "hold"].includes(b.status as string)) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 })
    }
    const r = await setHotelAcceptance(op, n, b.side, b.status as "accepted" | "refused" | "no_answer" | "hold", note)
    return NextResponse.json(r, { status: statusOf(r) })
  }
  return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 422 })
}
