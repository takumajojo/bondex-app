import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { chargeShipmentIfDue } from "@/lib/charge"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * POST /api/operator/charge-retry  { id: string }
 *
 * 課金失敗（charge_error 済・未課金）の区間について、その場でカード課金を再試行する。
 * middleware で operator 認証必須（cookie bondex_op_auth / Bearer OPERATOR_PASSWORD）。
 *
 * chargeShipmentIfDue は冪等：
 *   - charged_at 済み → skipped:"already_charged"（二重課金しない）
 *   - STRIPE_CHARGE_LIVE!=="true" → skipped:"disabled"（実課金せず・安全ゲート）
 *   - 失敗（カード未登録など）→ error を返し charge_error を再記録
 * 成否はレスポンスの result で返し、UI 側でメッセージ表示する。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "charge-retry")
  if (!limit.ok) return limit.response

  let body: { id?: unknown }
  try {
    body = (await req.json()) as { id?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const id = typeof body.id === "string" ? body.id.trim() : ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const result = await chargeShipmentIfDue(id)
  return NextResponse.json({ ok: true, result })
}
