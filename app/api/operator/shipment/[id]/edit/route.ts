import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { notifyBondEx } from "@/lib/notify"

export const runtime = "nodejs"
export const maxDuration = 20

/**
 * POST /api/operator/shipment/[id]/edit
 *   運営専用: 予約の「代理店」と「配送番号(送り状No)」を修正する。
 *   middleware で operator 認証必須 (default-deny)。
 *
 *   body: {
 *     agency?:   string,            // 代理店名。予約(booking_id)の全区間に反映。
 *                                    // 月次請求は代理店名で突合するため、agencies マスタに
 *                                    // 存在する名前のみ許可 (誤入力で請求が飛ばない事故を防ぐ)。
 *     tracking?: string | string[], // 佐川/ヤマトの送り状No。この区間 (id) のみ更新。
 *                                    // 仮番号 → 正式番号の差し替え用。空配列/空文字で消去。
 *   }
 *   agency / tracking の少なくとも一方が必要。
 *
 *   配送番号を差し替えたら yamato_tracking_detail を null に戻し、次回 sync-tracking で
 *   新しい番号の配送状況を取り直させる (古い番号の詳細が残らないように)。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(req, "shipment-edit")
  if (!limit.ok) return limit.response

  const { id } = await ctx.params
  const shipmentId = (id || "").trim()
  if (!shipmentId) return NextResponse.json({ error: "shipment id required" }, { status: 400 })

  let body: { agency?: unknown; tracking?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const hasAgency = typeof body.agency === "string"
  const hasTracking = body.tracking !== undefined
  if (!hasAgency && !hasTracking) {
    return NextResponse.json({ error: "agency か tracking のいずれかを指定してください" }, { status: 400 })
  }

  // tracking の正規化: 文字列は改行/カンマ/空白区切り、配列はそのまま。数字のみ 10〜14 桁を許可。
  let tracking: string[] | null = null
  if (hasTracking) {
    const raw = Array.isArray(body.tracking)
      ? (body.tracking as unknown[]).map((t) => String(t))
      : String(body.tracking).split(/[\s,]+/)
    const cleaned = raw.map((t) => t.trim()).filter(Boolean)
    for (const t of cleaned) {
      if (!/^\d{10,14}$/.test(t)) {
        return NextResponse.json(
          { error: `配送番号「${t}」が不正です（送り状Noは10〜14桁の数字で入力してください）` },
          { status: 400 },
        )
      }
    }
    // 重複除去。空配列は「消去」として許可。
    tracking = Array.from(new Set(cleaned))
  }

  const agency = hasAgency ? (body.agency as string).trim() : ""
  if (hasAgency && !agency) {
    return NextResponse.json({ error: "代理店名を入力してください" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  const shipment = await getShipment(shipmentId)
  if (!shipment) return NextResponse.json({ error: "shipment not found" }, { status: 404 })

  // 代理店名は agencies マスタに存在する名前のみ許可 (請求突合の保護)。
  if (hasAgency) {
    const { data: ag, error: agErr } = await sb
      .from("agencies")
      .select("name")
      .eq("name", agency)
      .maybeSingle()
    if (agErr) return NextResponse.json({ error: agErr.message }, { status: 500 })
    if (!ag) {
      return NextResponse.json(
        { error: `代理店「${agency}」は登録されていません。代理店マスタに存在する名前を選択してください。` },
        { status: 400 },
      )
    }
  }

  const oldAgency = shipment.agency
  const oldTracking = (shipment.yamato_tracking as string[] | null) ?? []

  // 代理店は予約単位 → 全区間に反映。配送番号はこの区間 (id) のみ。
  const results: string[] = []
  if (hasAgency && agency !== oldAgency) {
    const { error: upErr } = await sb
      .from("shipments")
      .update({ agency })
      .eq("booking_id", shipment.booking_id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    results.push(`代理店: ${oldAgency || "—"} → ${agency}（全区間）`)
  }
  if (hasTracking) {
    const { error: upErr } = await sb
      .from("shipments")
      .update({ yamato_tracking: tracking, yamato_tracking_detail: null })
      .eq("id", shipmentId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    results.push(`配送番号: [${oldTracking.join(", ") || "—"}] → [${(tracking ?? []).join(", ") || "—"}]`)
  }

  // 社内 Slack へ監査ログ (best-effort)。代理店変更は請求に効くので記録を残す。
  if (results.length > 0) {
    const legRef = `${shipment.booking_id}-L${shipment.leg_index + 1}`
    await notifyBondEx({
      kind: "adjust",
      title: `${legRef} 予約情報を修正`,
      lines: results,
      link: `/operator/bookings/${shipment.booking_id}`,
      linkLabel: "予約詳細で確認",
    }).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    changed: results,
    agency: hasAgency ? agency : oldAgency,
    tracking: hasTracking ? tracking : oldTracking,
  })
}
