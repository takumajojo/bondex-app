import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { OPERATOR_SESSION_COOKIE, verifyOperatorSession } from "@/lib/operator-session"
import { resolveB2cOperator } from "@/lib/b2c/operator-identity"
import { b2cStripeConfig } from "@/lib/b2c/stripe"
import {
  EVIDENCE_TYPES, confirmPickup, correctPieces, loadB2cOrderDetail, loadB2cTodo, markUncollectible, refund, resolveHold, retryCharge, revokePickup,
  type EvidenceType,
} from "@/lib/b2c/payment-ops"

export const runtime = "nodejs"

/**
 * /api/b2c/ops/payments — 運営の B2C の作業（Stage 5）。lib/b2c/payment-ops.ts。
 * GET: 要対応の一覧（?orderNumber= で予約の詳細）。運営のログイン（共有パスワード・v1 も可）で見られる。
 * POST: 操作。個人のパスキーの v2 のセッション（operator_email 登録済み）だけ。理由（note）は必須。
 *   { action: "confirm_pickup", orderNumber, evidenceType, evidenceRef, acceptedPieces, note }
 *   { action: "revoke_pickup", orderNumber, note }
 *   { action: "release_hold" | "cancel_hold", paymentId, note }
 *   { action: "retry_charge", paymentId, note }
 *   { action: "correct_pieces", orderNumber, actualPieces, evidenceType, evidenceRef, note }
 *   { action: "refund", paymentId, amountYen, note }
 *   { action: "mark_uncollectible", paymentId, note }
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "b2c-ops")
  if (!limit.ok) return limit.response
  if (!(await verifyOperatorSession(req.cookies.get(OPERATOR_SESSION_COOKIE)?.value))) return NextResponse.json({ ok: false, error: "operator_login_required" }, { status: 401 })
  // 一覧は旅行者の名前・額を返すので、個人のパスキーの運営者だけ（共有パスワード（v1）は不可・2026-11-05）
  if (!(await resolveB2cOperator(req))) return NextResponse.json({ ok: false, error: "operator_passkey_required" }, { status: 403 })
  const n = req.nextUrl.searchParams.get("orderNumber")
  if (n) {
    if (!/^\d{1,9}$/.test(n)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 })
    const d = await loadB2cOrderDetail(Number(n))
    return d ? NextResponse.json({ ok: true, detail: d }) : NextResponse.json({ ok: false, error: "not_found" }, { status: 404 })
  }
  const todo = await loadB2cTodo()
  return todo ? NextResponse.json({ ok: true, todo }) : NextResponse.json({ ok: false, error: "server_error" }, { status: 500 })
}

const STATUS: Record<string, number> = {
  order_not_found: 404, not_found: 404, server_error: 500, invalid_input: 422,
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
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : ""
  if (!note) return NextResponse.json({ ok: false, error: "note_required" }, { status: 422 })
  const orderNumber = Number(b.orderNumber)
  const paymentId = typeof b.paymentId === "string" && UUID.test(b.paymentId) ? b.paymentId : null
  const evidenceType = EVIDENCE_TYPES.includes(b.evidenceType as EvidenceType) ? (b.evidenceType as EvidenceType) : null
  const evidenceRef = typeof b.evidenceRef === "string" ? b.evidenceRef.trim().slice(0, 300) : ""
  const int = (v: unknown) => (Number.isInteger(Number(v)) ? Number(v) : NaN)
  const bad = () => NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 })
  const s = b2cStripeConfig()

  let r
  switch (b.action) {
    case "confirm_pickup":
      if (!Number.isInteger(orderNumber) || !evidenceType || !evidenceRef || !(int(b.acceptedPieces) >= 1 && int(b.acceptedPieces) <= 50)) return bad()
      r = await confirmPickup(op, orderNumber, evidenceType, evidenceRef, int(b.acceptedPieces), note)
      break
    case "revoke_pickup":
      if (!Number.isInteger(orderNumber)) return bad()
      r = await revokePickup(op, orderNumber, note)
      break
    case "release_hold":
    case "cancel_hold":
      if (!paymentId) return bad()
      r = await resolveHold(op, paymentId, b.action === "release_hold" ? "release" : "cancel", note)
      break
    case "retry_charge":
      if (!paymentId) return bad()
      if (!s.ok) return NextResponse.json({ ok: false, error: s.reason }, { status: 503 })
      r = await retryCharge(op, s.config.stripe, paymentId, note)
      break
    case "correct_pieces":
      if (!Number.isInteger(orderNumber) || !evidenceType || !evidenceRef || !(int(b.actualPieces) >= 1 && int(b.actualPieces) <= 50)) return bad()
      r = await correctPieces(op, orderNumber, int(b.actualPieces), evidenceType, evidenceRef, note)
      break
    case "refund":
      if (!paymentId || !(int(b.amountYen) >= 1)) return bad()
      if (!s.ok) return NextResponse.json({ ok: false, error: s.reason }, { status: 503 })
      r = await refund(op, s.config.stripe, paymentId, int(b.amountYen), note)
      break
    case "mark_uncollectible":
      if (!paymentId) return bad()
      r = await markUncollectible(op, paymentId, note)
      break
    default:
      return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 422 })
  }
  if (r.ok) return NextResponse.json(r)
  return NextResponse.json(r, { status: STATUS[r.error] ?? 409 })
}
