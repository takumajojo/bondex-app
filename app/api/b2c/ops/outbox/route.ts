import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveB2cOperator } from "@/lib/b2c/operator-identity"
import { listOutboxProblems, resolveOutboxRow, type OutboxResolution } from "@/lib/b2c/outbox-ops"

export const runtime = "nodejs"

/**
 * /api/b2c/ops/outbox — 通知の照合（運営・Stage 4）。lib/b2c/outbox-ops.ts。
 * 個人のパスキーの v2 のセッション（operator_email 登録済み）だけ。共有パスワード・v1 のセッションは 403。
 * GET: 要確認の通知（unknown / failed / expired・直近 14日）
 * POST: { id, resolution: "delivered"|"resend"|"dismiss", note }（note は必須）
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "b2c-ops")
  if (!limit.ok) return limit.response
  if (!(await resolveB2cOperator(req))) return NextResponse.json({ ok: false, error: "operator_passkey_required" }, { status: 403 })
  const rows = await listOutboxProblems()
  if (!rows) return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 })
  return NextResponse.json({ ok: true, problems: rows })
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
  const id = Number(b.id)
  if (!Number.isInteger(id) || id <= 0 || !["delivered", "resend", "dismiss"].includes(b.resolution as string)) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 })
  }
  const r = await resolveOutboxRow(op, id, b.resolution as OutboxResolution, note)
  if (r.ok) return NextResponse.json(r)
  const status = r.error === "not_found" ? 404 : r.error === "server_error" ? 500 : 409
  return NextResponse.json(r, { status })
}
