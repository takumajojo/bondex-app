/**
 * B2C の旅行者向けの API の共通の入口（Stage 2）。
 * - 新規受付のスイッチ（B2C_BOOKING_ENABLED）が OFF なら 503。
 * - 入口の秘密の token を毎回 DB で確かめる（画面だけで判定しない）。無効なら 404。
 * - 回数の制限は lib/rate-limit.ts。
 */
import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { b2cBookingEnabled } from "./flags"
import { resolveEntry, B2cDbUnavailable, type B2cEntry } from "./booking-service"

export async function b2cGuard(
  req: NextRequest,
  scope: string,
): Promise<{ ok: true; entry: B2cEntry; body: Record<string, unknown> } | { ok: false; res: NextResponse }> {
  const limit = rateLimit(req, scope)
  if (!limit.ok) return { ok: false, res: limit.response }
  if (!b2cBookingEnabled()) {
    return { ok: false, res: NextResponse.json({ error: "booking_closed" }, { status: 503 }) }
  }
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return { ok: false, res: NextResponse.json({ error: "invalid_json" }, { status: 400 }) }
  }
  let entry: B2cEntry | null
  try {
    entry = await resolveEntry(body.token)
  } catch (e) {
    if (e instanceof B2cDbUnavailable) return { ok: false, res: b2cUnavailable() }
    throw e
  }
  if (!entry) return { ok: false, res: NextResponse.json({ error: "invalid_link" }, { status: 404 }) }
  return { ok: true, entry, body }
}

/** DB に届かない時の答え。画面は「見つからない」と区別し、少し待って照合を続ける。 */
export function b2cUnavailable(): NextResponse {
  return NextResponse.json({ ok: false, error: "temporarily_unavailable" }, { status: 503, headers: { "Retry-After": "5" } })
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

export function stay(v: unknown): { checkIn: string; checkOut: string } {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>
  return { checkIn: str(o.checkIn), checkOut: str(o.checkOut) }
}
