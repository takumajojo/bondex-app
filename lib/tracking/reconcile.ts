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
import type { TrackingProvider } from "@/lib/tracking/types"
import { legProgressStatus } from "@/lib/tracking/poll-policy"
import { chargeShipmentIfDue } from "@/lib/charge"
import { statusDataFromRow, sendAgencyStatusEmail } from "@/lib/agency-status-notify"
import { endpointLabel } from "@/lib/residence"
import { TRACKING_SYNC_PAUSED } from "@/lib/tracking-pause"
import { notifyBondEx } from "@/lib/notify"
import { agencyRecipientEmails } from "@/lib/agency-contacts"
import { sendOpsAlert } from "@/lib/ops-alert"

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
  // 追跡プロバイダ。既定は env に従う (shipandco)。結合テストでモックを注入するために引数化。
  provider: TrackingProvider = getTrackingProvider(),
): Promise<ReconcileResult> {
  // 追跡同期の一時停止中（佐川の追跡停止・流出対応）は照会をスキップ。
  // 番号の保存・差し替え自体は呼び出し側で継続し、ステータス前進のみ行わない。
  if (TRACKING_SYNC_PAUSED) {
    return { changed: false, note: "追跡同期は一時停止中（佐川の追跡停止・外部要因により照会をスキップ）" }
  }
  try {
    const { data: row, error } = await sb
      .from("shipments")
      .select(
        "id, booking_id, leg_index, agency, status, carrier, representative, recipient, from_hotel, to_hotel, from_hotel_en, to_hotel_en, from_residence, to_residence, tour_number, shipment_date, tracking_numbers, tracking_detail, tracking_limit_reached",
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
    // 15回上限に達した区間は照会しない (cron と同じ扱い・残枠を使わない)。佐川で確認し手動で完了にする。
    if ((row.tracking_limit_reached as boolean | null) ?? false) {
      return { changed: false, note: "追跡上限到達(15回)のため照会スキップ — 佐川で確認し手動で配達完了にしてください" }
    }

    const carrier = (row.carrier as string | null) ?? null
    const checkedAt = new Date().toISOString()

    // 各番号を照会 → 正規化済み結果。最も進んでいない番号を代表とする (1個でも未着なら区間は未着扱い)。
    const results = await Promise.all(numbers.map((n) => provider.fetchOne(carrier, n)))
    let bestRank = -1
    let bestStatus: ShipmentStatus | null = null
    let anySuccess = false
    let legLimitReached = (row.tracking_limit_reached as boolean | null) ?? false
    const prevByNumber = new Map<string, Record<string, unknown>>()
    for (const d of (row.tracking_detail as Array<Record<string, unknown>> | null) ?? []) {
      const n = String(d.number ?? "")
      if (n) prevByNumber.set(n, d)
    }
    const detail = results.map((tr) => {
      const prev = prevByNumber.get(tr.number) ?? { number: tr.number }
      // 回数は cron と同じ tracking_detail.queryCount を共有する (即時照会も1回=1消費)。
      const queryCount = ((prev.queryCount as number | undefined) ?? 0) + 1
      // 429 = 追跡番号あたり15回上限。最後の正常ステータス(prev)を残し、上限フラグを立てる(別一覧・手動)。
      if (tr.rateLimited) {
        legLimitReached = true
        return { ...prev, number: tr.number, queryCount, limitReached: true, lastError: tr.errorCode ?? "TRACKING_LIMIT_EXCEEDED", checkedAt }
      }
      if (tr.noData) return { ...prev, number: tr.number, queryCount, checkedAt }
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
          queryCount,
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
      return { number: tr.number, status: tr.status, rawStatus: tr.rawStatus, location: tr.location, date: tr.date, queryCount, checkedAt }
    })

    if (!anySuccess) {
      // プロバイダがこの番号の現況をまだ返していない (佐川側の反映待ち等)。DB は変更しない。
      return { changed: false, note: "追跡データなし(キャリア未反映の可能性)" }
    }

    // leg 代表ステータスを全番号の最劣で確定 (1番号でも未取得/未着なら delivered にしない=確認漏れ防止)。
    bestStatus = legProgressStatus(detail as Array<{ number?: string; status?: ShipmentStatus | null }>, numbers)
    bestRank = bestStatus ? progressionRank(bestStatus) : -1

    // history 由来の実イベント時刻 (集荷/配達)。複数番号なら最も早いものを採る。無ければ照会時刻で代替。
    const collectedAt = results.map((r) => r.collectedAt).filter(Boolean).sort()[0] as string | undefined
    const deliveredAt = results.map((r) => r.deliveredAt).filter(Boolean).sort()[0] as string | undefined

    const currentRank = progressionRank(row.status as ShipmentStatus)
    const statusAdvances = bestStatus !== null && bestRank > currentRank

    const updatePayload: Record<string, unknown> = { tracking_detail: detail }
    if (legLimitReached && !((row.tracking_limit_reached as boolean | null) ?? false)) {
      updatePayload.tracking_limit_reached = true
    }
    if (statusAdvances) {
      updatePayload.status = bestStatus
      if (currentRank < progressionRank("picked_up") && bestRank >= progressionRank("picked_up")) {
        // 実際に佐川がスキャンした集荷時刻 (collected の date) を優先。
        updatePayload.picked_up_at = collectedAt ?? checkedAt
      }
      if (bestStatus === "delivered") updatePayload.delivered_at = deliveredAt ?? checkedAt
    }

    // 読んだ時点の status で条件付き更新する。並走した定時の sync-tracking が先に進めていたら
    // 0 行になり、ここでは代理店メール等の副作用を起こさない (完了メールの二重送信防止)。
    const { data: updatedRows, error: upErr } = await sb
      .from("shipments")
      .update(updatePayload)
      .eq("id", shipmentId)
      .eq("status", row.status as string)
      .select("id")
    if (upErr) return { changed: false, note: `DB更新失敗: ${upErr.message}` }
    if ((updatedRows ?? []).length === 0) {
      return { changed: false, note: "同時に動いた定時の追跡同期が先に反映済み(二重通知を避けてスキップ)" }
    }

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
          statusDataFromRow(row, agencyContact, agencyEn),
          agencyEmail,
          agencyEn,
          `delivered-${row.booking_id}-L${(row.leg_index as number) + 1}`,
        )
        // 送信できたら delivered_notified_at を記録 (cron の再送ループと重複させない)。
        if (agencyEmailSent) {
          await sb
            .from("shipments")
            .update({ delivered_notified_at: new Date().toISOString() })
            .eq("id", shipmentId)
            .is("delivered_notified_at", null)
        }
      } catch {
        /* 送信失敗は無視 */
      }
      // 宛先があるのに送れなかった＝サイレント失敗にせず運用へアラート(cron と対称)。
      if (agencyEmail.length > 0 && !agencyEmailSent) {
        await sendOpsAlert({
          subject: `【配達通知メール未達】${legRef}`,
          lines: [
            `配達完了を反映しましたが、代理店(${row.agency})への配達完了メールを送信できませんでした。`,
            `宛先: ${agencyEmail.join(", ")}`,
            `→ メール設定を確認し、必要なら手動で連絡してください。`,
            `追跡: https://bondex.express/track/${row.booking_id}`,
          ],
          agencyEmail: null,
        }).catch(() => {})
      }
      await notifyBondEx({
        kind: "delivery",
        title: `${legRef}（${row.agency}）`,
        lines: [`お届け先: ${endpointLabel(row.to_hotel, row.to_residence)}`, `代表者: ${row.representative ?? ""}`, `（番号入力時の即時照会で確定）`],
        link: `/track/${row.booking_id}`,
        linkLabel: "追跡ページで確認",
      }).catch(() => {})
      return {
        changed: true,
        status: bestStatus,
        delivered: true,
        agencyEmailSent,
        note: agencyEmailSent ? "配達完了を反映し代理店へ配達完了メールを送信" : "配達完了を反映(代理店メール未送信・要確認)",
      }
    }

    // 初めて集荷ライン(picked_up)を越えた → 代理店へ集荷完了メール + 社内通知。
    if (currentRank < progressionRank("picked_up") && bestRank >= progressionRank("picked_up")) {
      try {
        agencyEmailSent = await sendAgencyStatusEmail(
          "picked_up",
          statusDataFromRow(row, agencyContact, agencyEn),
          agencyEmail,
          agencyEn,
        )
      } catch {
        /* 送信失敗は無視 */
      }
      if (agencyEmail.length > 0 && !agencyEmailSent) {
        await sendOpsAlert({
          subject: `【集荷通知メール未達】${legRef}`,
          lines: [
            `集荷済みを反映しましたが、代理店(${row.agency})への集荷完了メールを送信できませんでした。`,
            `宛先: ${agencyEmail.join(", ")}`,
            `→ メール設定を確認し、必要なら手動で連絡してください。`,
            `追跡: https://bondex.express/track/${row.booking_id}`,
          ],
          agencyEmail: null,
        }).catch(() => {})
      }
      await notifyBondEx({
        kind: "pickup",
        title: `${legRef}（${row.agency}）`,
        lines: [`集荷元: ${endpointLabel(row.from_hotel, row.from_residence)}`, `お届け先: ${endpointLabel(row.to_hotel, row.to_residence)}`, `代表者: ${row.representative ?? ""}`, `（番号入力時の即時照会で確定）`],
        link: `/track/${row.booking_id}`,
        linkLabel: "追跡ページで確認",
      }).catch(() => {})
      return {
        changed: true,
        status: bestStatus,
        pickedUp: true,
        agencyEmailSent,
        note: agencyEmailSent ? "集荷済みを反映し代理店へ集荷完了メールを送信" : "集荷済みを反映(代理店メール未送信・要確認)",
      }
    }

    return { changed: true, status: bestStatus, note: `ステータスを ${bestStatus} に前進` }
  } catch (e) {
    return { changed: false, note: `即時照会に失敗: ${e instanceof Error ? e.message : String(e)}` }
  }
}
