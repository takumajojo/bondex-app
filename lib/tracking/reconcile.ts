// 単一区間の「今すぐ追跡照会 → ステータス前進 → 副作用(代理店メール/課金/社内通知)」。
//
// 運営が配送番号(問い合わせ番号)を手入力/差し替えした直後に、時間毎の sync-tracking cron を
// 待たずに一度だけ Ship&co(プロバイダ)へ照会し、集荷済み/配達完了なら即反映するために使う。
//
// ロジックは app/api/cron/sync-tracking/route.ts の「1区間ぶんの前進判定＋副作用」を単一区間に
// 絞って忠実に写したもの。前進方向のみ・二重送信/二重課金は既存ガード(状態比較・charged_at)で回避する。
// cron 本体は変更していない(実績のある夜間ジョブを壊さないため)。将来 cron からも本関数を
// 呼ぶよう寄せれば重複を解消できる。

import type { SupabaseClient } from "@supabase/supabase-js"
import type { ShipmentStatus } from "@/lib/shipments-db"
import { getTrackingProvider } from "@/lib/tracking"
import { chargeShipmentIfDue } from "@/lib/charge"
import { statusDataFromRow, sendAgencyStatusEmail } from "@/lib/agency-status-notify"
import { notifyBondEx } from "@/lib/notify"
import { agencyRecipientEmails } from "@/lib/agency-contacts"

// 前進方向のみを許可する順序 (sync-tracking と同一)。この配列に無い状態(pending/failed/cancelled)は触らない。
const PROGRESSION: ShipmentStatus[] = ["issued", "picked_up", "in_transit", "delivered"]
function progressionRank(status: ShipmentStatus): number {
  const i = PROGRESSION.indexOf(status)
  return i === -1 ? -1 : i
}
const TERMINAL = new Set<string>(["delivered", "cancelled", "failed"])

export interface ReconcileResult {
  /** DB を更新したか (ステータス前進 or 追跡詳細の書込)。 */
  changed: boolean
  /** 反映後のステータス (前進した場合)。 */
  status?: ShipmentStatus
  pickedUp?: boolean
  delivered?: boolean
  /** 代理店へ集荷/配達メールを送れたか。 */
  agencyEmailSent?: boolean
  /** 人が読める短い要約 (監査ログ/レスポンス表示用)。 */
  note: string
}

/**
 * shipmentId の現在の tracking_numbers をプロバイダで照会し、集荷済み/配達完了なら
 * ステータスを前進させ、集荷/配達の代理店メール・課金・社内通知を発火する (best-effort)。
 * 例外は投げない (呼び出し側の本処理=番号更新を止めないため)。
 */
export async function reconcileTrackingNow(
  sb: SupabaseClient,
  shipmentId: string,
): Promise<ReconcileResult> {
  try {
    const { data: row, error } = await sb
      .from("shipments")
      .select(
        "id, booking_id, leg_index, agency, status, carrier, representative, recipient, from_hotel, to_hotel, tour_number, shipment_date, tracking_numbers, tracking_detail",
      )
      .eq("id", shipmentId)
      .maybeSingle()
    if (error) return { changed: false, note: `照会前のDB読取失敗: ${error.message}` }
    if (!row) return { changed: false, note: "shipment not found" }

    const numbers = ((row.tracking_numbers as string[] | null) ?? []).filter(Boolean)
    if (numbers.length === 0) return { changed: false, note: "追跡番号なし" }
    if (TERMINAL.has(row.status as string)) {
      return { changed: false, note: `終端ステータス(${row.status})のため照会スキップ` }
    }

    const carrier = (row.carrier as string | null) ?? null
    const provider = getTrackingProvider()
    const checkedAt = new Date().toISOString()

    // 各番号を照会 → 正規化済み結果。最も進んでいない番号を代表とする (1個でも未着なら区間は未着扱い)。
    const results = await Promise.all(numbers.map((n) => provider.fetchOne(carrier, n)))
    let bestRank = -1
    let bestStatus: ShipmentStatus | null = null
    let anySuccess = false
    const detail = results.map((tr) => {
      if (tr.noData) return { number: tr.number, checkedAt }
      anySuccess = true
      if (tr.exception) {
        // 異常系は前進に使わない (異常アラートは cron 側に委ねる)。詳細だけ残す。
        return {
          number: tr.number,
          status: null,
          rawStatus: tr.rawStatus,
          exception: tr.exception,
          location: tr.location,
          date: tr.date,
          checkedAt,
        }
      }
      if (tr.status) {
        const rank = progressionRank(tr.status)
        if (bestRank === -1 || rank < bestRank) {
          bestRank = rank
          bestStatus = tr.status
        }
      }
      return { number: tr.number, status: tr.status, rawStatus: tr.rawStatus, location: tr.location, date: tr.date, checkedAt }
    })

    if (!anySuccess) {
      // プロバイダがこの番号の現況をまだ返していない (佐川側の反映待ち等)。DB は変更しない。
      return { changed: false, note: "追跡データなし(キャリア未反映の可能性)" }
    }

    // history 由来の実イベント時刻 (集荷/配達)。複数番号なら最も早いものを採る。無ければ照会時刻で代替。
    const collectedAt = results.map((r) => r.collectedAt).filter(Boolean).sort()[0] as string | undefined
    const deliveredAt = results.map((r) => r.deliveredAt).filter(Boolean).sort()[0] as string | undefined

    const currentRank = progressionRank(row.status as ShipmentStatus)
    const statusAdvances = bestStatus !== null && bestRank > currentRank

    const updatePayload: Record<string, unknown> = { tracking_detail: detail }
    if (statusAdvances) {
      updatePayload.status = bestStatus
      if (currentRank < progressionRank("picked_up") && bestRank >= progressionRank("picked_up")) {
        // 実際に佐川がスキャンした集荷時刻 (collected の date) を優先。
        updatePayload.picked_up_at = collectedAt ?? checkedAt
      }
      if (bestStatus === "delivered") updatePayload.delivered_at = deliveredAt ?? checkedAt
    }

    const { error: upErr } = await sb.from("shipments").update(updatePayload).eq("id", shipmentId)
    if (upErr) return { changed: false, note: `DB更新失敗: ${upErr.message}` }

    if (!statusAdvances || !bestStatus) {
      const raw = results.find((r) => r.rawStatus)?.rawStatus
      return { changed: true, note: `追跡取得OK(現況「${raw ?? "不明"}」)・ステータス前進なし(現在: ${row.status})` }
    }

    // ── 副作用 (すべて best-effort・番号更新は止めない) ─────────────────────────
    const { data: ag } = await sb
      .from("agencies")
      .select("contact_email, contact_person, locale")
      .eq("name", (row.agency as string) ?? "")
      .maybeSingle()
    // 通知は主メール+追加メールの全宛先へ。
    const agencyEmail = await agencyRecipientEmails(sb, (row.agency as string) ?? "")
    const agencyEn = ag?.locale === "en"
    const agencyContact = (ag?.contact_person as string | null) ?? null
    const legRef = `${row.booking_id}-L${(row.leg_index as number) + 1}`
    let agencyEmailSent = false

    // 集荷ライン以降に到達 → 課金 (STRIPE_CHARGE_LIVE=true 時のみ・idempotent)。
    if (progressionRank(bestStatus) >= progressionRank("picked_up")) {
      try {
        await chargeShipmentIfDue(row.id as string)
      } catch {
        /* 課金フック失敗は本処理を止めない */
      }
    }

    if (bestStatus === "delivered") {
      // 配達完了 → 代理店へ配達完了メール + 社内通知。
      try {
        agencyEmailSent = await sendAgencyStatusEmail(
          "delivered",
          statusDataFromRow(row, agencyContact),
          agencyEmail,
          agencyEn,
        )
      } catch {
        /* 送信失敗は無視 */
      }
      await notifyBondEx({
        kind: "delivery",
        title: `${legRef}（${row.agency}）`,
        lines: [`お届け先: ${row.to_hotel ?? ""}`, `代表者: ${row.representative ?? ""}`, `（番号入力時の即時照会で確定）`],
        link: `/track/${row.booking_id}`,
        linkLabel: "追跡ページで確認",
      }).catch(() => {})
      return { changed: true, status: bestStatus, delivered: true, agencyEmailSent, note: "配達完了を反映し代理店へ配達完了メールを送信" }
    }

    // 初めて集荷ライン(picked_up)を越えた → 代理店へ集荷完了メール + 社内通知。
    if (currentRank < progressionRank("picked_up") && bestRank >= progressionRank("picked_up")) {
      try {
        agencyEmailSent = await sendAgencyStatusEmail(
          "picked_up",
          statusDataFromRow(row, agencyContact),
          agencyEmail,
          agencyEn,
        )
      } catch {
        /* 送信失敗は無視 */
      }
      await notifyBondEx({
        kind: "pickup",
        title: `${legRef}（${row.agency}）`,
        lines: [`集荷元: ${row.from_hotel ?? ""}`, `お届け先: ${row.to_hotel ?? ""}`, `代表者: ${row.representative ?? ""}`, `（番号入力時の即時照会で確定）`],
        link: `/track/${row.booking_id}`,
        linkLabel: "追跡ページで確認",
      }).catch(() => {})
      return { changed: true, status: bestStatus, pickedUp: true, agencyEmailSent, note: "集荷済みを反映し代理店へ集荷完了メールを送信" }
    }

    return { changed: true, status: bestStatus, note: `ステータスを ${bestStatus} に前進` }
  } catch (e) {
    return { changed: false, note: `即時照会に失敗: ${e instanceof Error ? e.message : String(e)}` }
  }
}
