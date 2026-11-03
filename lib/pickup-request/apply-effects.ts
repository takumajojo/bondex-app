// 変更申請を区間へ反映したあとの付随処理 (2026-11-04 段階C)。反映そのものは DB 関数 apply_shipment_change が
// 1トランザクションで行い、ここでは佐川に渡さない項目だけを更新する (DB のトリガーの対象外):
//   個数 → 請求額 (確定済み・未課金のとき。代理店のセルフ変更と同じ lib/amount-recalc)
//   集荷日 → 変更受付締切 (change_deadline_at = 集荷前日 18:30 JST)
// 代理店への変更メール (最新バウチャー付き) は、代理店のセルフ変更と同じく送る (best-effort)。

import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { amountForNewCount } from "@/lib/amount-recalc"
import { changeDeadlineAt } from "@/lib/change-deadline"
import { sendBookingUpdateEmail } from "@/lib/booking-update-email"
import { applyPickupChange, CHANGE_KIND_JA, type ChangeKind } from "./change"

export async function applyChangeWithEffects(
  changeId: string,
  actor: string,
): Promise<{ ok: true; summary: string } | { ok: false; reason: string }> {
  const r = await applyPickupChange(changeId, actor)
  if (!r.ok) return r
  const sb = getSupabase()
  if (!sb) return { ok: true, summary: "" }
  const { data: c } = await sb
    .from("shipment_change_requests")
    .select("shipment_id, booking_id, kind, fields")
    .eq("id", changeId)
    .maybeSingle()
  if (!c) return { ok: true, summary: "" }
  const kind = c.kind as ChangeKind
  const fields = (c.fields ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  const ship = await getShipment(String(c.shipment_id))
  if (ship && fields.suitcase_count !== undefined) {
    try {
      const amount = await amountForNewCount(sb, ship, Number(fields.suitcase_count))
      if (amount !== undefined && amount !== ship.amount_yen) patch.amount_yen = amount
    } catch (e) {
      console.error("[pickup-request] 申請反映後の請求額の更新に失敗", e instanceof Error ? e.message : e)
    }
  }
  if (typeof fields.shipment_date === "string") patch.change_deadline_at = changeDeadlineAt(fields.shipment_date)
  if (Object.keys(patch).length) {
    const { error } = await sb.from("shipments").update(patch).eq("id", String(c.shipment_id))
    if (error) console.error("[pickup-request] 申請反映後の付随更新に失敗", error.message)
  }
  const summary = `${CHANGE_KIND_JA[kind] ?? kind}の変更申請を反映`
  if (kind !== "number") {
    await sendBookingUpdateEmail(String(c.booking_id), [summary]).catch(() => {})
  }
  return { ok: true, summary }
}
