import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"

export const runtime = "nodejs"

/**
 * ダッシュボードの「本日集荷されました」通知 (2026-09-16 谷口さん)。
 * middleware で operator 認証済み。
 *
 *   GET  /api/operator/pickup-alerts
 *     → 集荷済(picked_up_at 記録済み)で未読(pickup_ack_at is null)・直近7日の区間を返す。
 *   POST /api/operator/pickup-alerts   { ids?: string[], all?: true }
 *     → 指定 id (未指定なら全未読) を既読 (pickup_ack_at=now) にする。クリックで通知を消す用。
 */

const LOOKBACK_DAYS = 7

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "pickup-alerts")
  if (!limit.ok) return limit.response
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ alerts: [] })

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await sb
    .from("shipments")
    .select("id, booking_id, leg_index, agency, representative, from_hotel, to_hotel, suitcase_count, picked_up_at")
    .not("picked_up_at", "is", null)
    .is("pickup_ack_at", null)
    .gte("picked_up_at", since)
    .order("picked_up_at", { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message, alerts: [] }, { status: 500 })

  return NextResponse.json({ alerts: data ?? [] })
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "pickup-alerts-ack")
  if (!limit.ok) return limit.response
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 503 })

  let body: { ids?: unknown; all?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const now = new Date().toISOString()
  let q = sb.from("shipments").update({ pickup_ack_at: now }).is("pickup_ack_at", null).not("picked_up_at", "is", null)
  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const ids = body.ids.filter((x): x is string => typeof x === "string")
    q = q.in("id", ids)
  } else if (body.all !== true) {
    return NextResponse.json({ error: "ids[] または all:true が必要です" }, { status: 400 })
  }
  const { data, error } = await q.select("id")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, acked: (data ?? []).length })
}
