import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { changeDeadlineAt } from "@/lib/change-deadline"
import { notifyBondEx } from "@/lib/notify"
import { postCorrectionAction, postCorrectionLabel } from "@/lib/shipment-change"

export const runtime = "nodejs"
export const maxDuration = 20

/**
 * POST /api/operator/change-requests/[id]
 *   運営専用 (middleware 認証)。承認待ちの変更申請を承認/却下する。
 *   body: { action: 'approve' | 'reject', note?: string }
 *
 * 承認: 申請の fields を shipment に反映 (発送日変更時は締切を再計算)。区間フィールドは
 *   未発行(requested/pending)のときだけ反映し、発行済みに変わっていたら 409 で差し戻す
 *   (運営の訂正UIから手動反映してもらう)。代理店(agency)変更は全区間へ反映。
 * 却下: 申請を rejected にするだけ (shipment は変更しない)。
 */

// agency 以外は「この区間」のカラム。発送日変更時のみ締切も併せて更新する。
const LEG_FIELDS = new Set([
  "shipment_date",
  "expected_arrival",
  "suitcase_count",
  "representative",
  "recipient",
])

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(req, "change-request-decide")
  if (!limit.ok) return limit.response

  const { id } = await ctx.params
  const reqId = (id || "").trim()
  if (!reqId) return NextResponse.json({ error: "id required" }, { status: 400 })

  let body: { action?: unknown; note?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }
  const action = body.action === "approve" || body.action === "reject" ? body.action : null
  if (!action) return NextResponse.json({ error: "action は approve か reject" }, { status: 400 })
  const note = typeof body.note === "string" ? body.note.trim() || null : null

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  const { data: cr, error: crErr } = await sb
    .from("shipment_change_requests")
    .select("*")
    .eq("id", reqId)
    .maybeSingle()
  if (crErr) return NextResponse.json({ error: crErr.message }, { status: 500 })
  if (!cr) return NextResponse.json({ error: "変更申請が見つかりません。" }, { status: 404 })
  if (cr.status !== "pending") {
    return NextResponse.json({ error: "この申請は既に処理済みです。", code: "DECIDED" }, { status: 409 })
  }

  const nowIso = new Date().toISOString()
  const legRef = `${cr.booking_id}-L${(cr.leg_index ?? 0) + 1}`

  // ── 却下
  if (action === "reject") {
    const { error } = await sb
      .from("shipment_change_requests")
      .update({ status: "rejected", decided_by: "operator", decided_at: nowIso, decision_note: note })
      .eq("id", reqId)
      .eq("status", "pending")
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await notifyBondEx({
      kind: "change",
      title: `${legRef} 変更申請を却下（${cr.agency || "—"}）`,
      lines: [note ? `理由: ${note}` : "理由未記入", "代理店へ却下の連絡をしてください。"],
      link: `/operator/bookings/${cr.booking_id}`,
      linkLabel: "予約詳細で確認",
    }).catch(() => {})
    return NextResponse.json({ ok: true, status: "rejected" })
  }

  // ── 承認: fields を反映
  const shipment = await getShipment(String(cr.shipment_id))
  if (!shipment) return NextResponse.json({ error: "対象の区間が見つかりません。" }, { status: 404 })

  const fields = (cr.fields ?? {}) as Record<string, unknown>
  const legPatch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (LEG_FIELDS.has(k)) legPatch[k] = v
  }
  if (legPatch.shipment_date !== undefined) {
    legPatch.change_deadline_at = changeDeadlineAt(String(legPatch.shipment_date))
  }

  // 区間フィールドは未発行のときだけ反映 (承認までの間に cron 自動発行が走った場合の保護)。
  if (Object.keys(legPatch).length > 0) {
    const { data: upd, error } = await sb
      .from("shipments")
      .update(legPatch)
      .eq("id", cr.shipment_id)
      .in("status", ["requested", "pending"])
      .select("id")
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if ((upd ?? []).length === 0) {
      return NextResponse.json(
        {
          error: "この区間は承認までに発行済みになりました。運営の訂正UIから手動で反映してください（申請は保留のまま）。",
          code: "ISSUED",
        },
        { status: 409 },
      )
    }
  }

  // 代理店変更は全区間 (マスタ照合)
  const newAgency = typeof fields.agency === "string" ? (fields.agency as string).trim() : ""
  if (newAgency && newAgency !== shipment.agency) {
    const { data: ag } = await sb.from("agencies").select("name").eq("name", newAgency).maybeSingle()
    if (!ag) {
      return NextResponse.json(
        { error: `代理店「${newAgency}」は登録されていません。`, code: "AGENCY_UNKNOWN" },
        { status: 400 },
      )
    }
    const { error } = await sb.from("shipments").update({ agency: newAgency }).eq("booking_id", cr.booking_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { error: markErr } = await sb
    .from("shipment_change_requests")
    .update({ status: "approved", decided_by: "operator", decided_at: nowIso, decision_note: note })
    .eq("id", reqId)
    .eq("status", "pending")
  if (markErr) return NextResponse.json({ error: markErr.message }, { status: 500 })

  const changedKeys = Object.keys(fields)
  const downstream = postCorrectionAction(shipment.carrier, shipment.status, changedKeys)
  const downstreamLabel = postCorrectionLabel(downstream)

  await notifyBondEx({
    kind: "change",
    title: `${legRef} 変更申請を承認（${cr.agency || "—"}）`,
    lines: [
      ...changedKeys.filter((k) => k !== "agency").map((k) => `${k}: → ${String(fields[k])}`),
      ...(newAgency && newAgency !== shipment.agency ? [`代理店: ${shipment.agency} → ${newAgency}`] : []),
      ...(downstreamLabel ? [`⚠️ ${downstreamLabel}`] : []),
      ...(note ? [`メモ: ${note}`] : []),
    ],
    link: `/operator/bookings/${cr.booking_id}`,
    linkLabel: "予約詳細で確認",
  }).catch(() => {})

  return NextResponse.json({ ok: true, status: "approved", downstream, downstreamLabel })
}
