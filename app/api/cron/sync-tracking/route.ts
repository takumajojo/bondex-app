import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendOpsAlert } from "@/lib/ops-alert"
import { mailerConfigured } from "@/lib/mailer"
import { listPickupMisses, markPickupAlerted, listDeliveryOverdue, markDeliveryOverdueAlerted } from "@/lib/shipments-db"
import type { ShipmentStatus } from "@/lib/shipments-db"
import { chargeShipmentIfDue } from "@/lib/charge"
import { getTrackingProvider } from "@/lib/tracking"
import { statusDataFromRow, sendAgencyStatusEmail } from "@/lib/agency-status-notify"
import { notifyBondEx } from "@/lib/notify"
import { pushToAgency } from "@/lib/agency-push"

export const runtime = "nodejs"
// Hobby プランでも Fluid Compute 有効なら 300s (5分) まで許可される
// (公式ドキュメント確認済み, 2026-07-02). 個々の Ship&co 呼び出しには
// 別途 10s のタイムアウトを設けているので、ここは安全マージンとして最大値を確保。
export const maxDuration = 300

/**
 * Vercel Cron から定期実行: Ship&co の GET トラッキング API をポーリングして
 * shipments.status を実際のヤマト配送状況に同期する.
 *
 * Ship&co の Webhook (tracking.updated) は現時点で FedEx のみ対応・ヤマトは
 * 非対応 (公式ドキュメント確認済み, 2026-07-02) なので push 通知は使えず、
 * ポーリング方式を採用している。
 *
 * 公開エンドポイントとして Vercel 上に存在するため、Vercel Cron の
 * `Authorization: Bearer $CRON_SECRET` ヘッダーで認証する
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 *
 * 対象: status が終端状態 (delivered/cancelled/failed) ではなく、
 *       yamato_tracking に追跡番号が入っている shipment のみ。
 *
 * ステータスマッピングについて:
 *   Ship&co の current_status.status に入る正確な文字列の一覧は
 *   公式ドキュメントに明記されておらず (2026-07-02 時点で "transit" の例のみ)、
 *   本番の実キーでもローカルから検証できなかった (.env はプレースホルダーのみ)。
 *   そのため exact-match ではなくキーワードベースの寛容なマッチングを行い、
 *   「配達完了 / 配送中 / 集荷済」の順当な前進のみを自動反映する。
 *   未知のステータス文字列は握りつぶさず console.error に出し、レスポンスの
 *   `unmapped` にも積む — Vercel のログから実際の値を拾って、後日
 *   STATUS_KEYWORD_MAP を精緻化できるようにするため。
 *   失敗・返送等のネガティブ系ステータスは誤検知のリスクが高いため自動反映せず、
 *   人間の operator 判断に委ねる (dashboard の手動ステータス変更は従来通り有効).
 */

// 前進方向のみを許可する順序。この配列に無いステータス (pending/failed/cancelled) は
// 「Ship&co ポーリングでは触らない」ことを意味する。
const PROGRESSION: ShipmentStatus[] = ["issued", "picked_up", "in_transit", "delivered"]

function progressionRank(status: ShipmentStatus): number {
  const i = PROGRESSION.indexOf(status)
  return i === -1 ? -1 : i
}

// Ship&co 追跡の HTTP・ステータス正規化(mapTrackingStatus)・異常検知(detectException)・
// carrier パス解決は lib/tracking/shipandco.ts へ移設済み。cron は
// getTrackingProvider().fetchOne() が返す正規化済み結果 (TrackingResult) だけを見る。

/**
 * 単純な同時実行数制限つき map。
 *
 * 直列 (for...await) だと、1 leg に 5 個口 × 13 shipments のような実データでは
 * 合計 30〜40 回の Ship&co 呼び出しが積み重なり、1 件 10s のタイムアウトでも
 * 最悪 300〜400s になって関数がタイムアウトする (実際にこれで 2 回失敗した)。
 * かといって全部同時に投げると Ship&co 側のレート制限に引っかかる恐れがあるため、
 * 同時実行数を CONCURRENCY 件に制限しつつ並列化する。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (true) {
      const i = nextIndex++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

const CONCURRENCY = 6

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 二重起動ロック (GitHub Actions の誤判定リトライ対策・2026-08-31 監査対応)。
  const lock = await acquireCronLock("sync-tracking")
  if (!lock.ok) {
    return NextResponse.json({ ok: true, skipped: "already running" })
  }
  try {

    const token = process.env.SHIPANDCO_API_KEY
    if (!token) {
      return NextResponse.json({ error: "SHIPANDCO_API_KEY not configured" }, { status: 503 })
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const sb = getSupabase()
    if (!sb) {
      return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
    }

    const { data, error } = await sb
      .from("shipments")
      .select("id, booking_id, leg_index, agency, status, carrier, representative, recipient, from_hotel, to_hotel, tour_number, shipment_date, yamato_tracking, yamato_tracking_detail")
      .not("yamato_tracking", "is", null)
      .not("status", "in", '("delivered","cancelled","failed")')
      // 2026-08-31 監査対応: limit 未指定は PostgREST 既定の1000行で静かに切れ、
      // 超過分の追跡・集荷時課金・配達完了通知が止まる。発送日が近い順に明示して
      // 「今動いている荷物」から確実に処理する (繁忙期に1000区間を超えても、
      // 期限が近い側は必ず対象に入る)。
      .order("shipment_date", { ascending: true })
      .limit(1000)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // ランドオペレーター通知用: 代理店名 → contact_email / 国内外フラグ の対応表を 1 回で引く
    const agencyEmailByName = new Map<string, string>()
    const agencyForeignByName = new Map<string, boolean>()
    const agencyContactByName = new Map<string, string>()
    {
      const { data: agencies } = await sb.from("agencies").select("name, contact_email, contact_person, locale")
      for (const a of agencies ?? []) {
        if (a.name && a.contact_email) agencyEmailByName.set(a.name, a.contact_email)
        if (a.name) agencyForeignByName.set(a.name, a.locale === "en")
        if (a.name && a.contact_person) agencyContactByName.set(a.name, a.contact_person)
      }
    }

    const rows = (data ?? []).filter(
      (row) => ((row.yamato_tracking as string[] | null) ?? []).length > 0,
    )
    const skippedNoTracking = (data?.length ?? 0) - rows.length

    // Step 1: 全 shipment × 全追跡番号をフラットなタスク一覧にして、まとめて並列取得。
    // 「1 leg 内で直列」ではなく「全体で並列」にすることで、leg 数や口数に関わらず
    // 総所要時間が ceil(タスク総数 / CONCURRENCY) × 平均レイテンシ に収まる。
    type Task = { rowIndex: number; trackingNumber: string; carrier: string | null }
    const tasks: Task[] = []
    rows.forEach((row, rowIndex) => {
      const trackingNumbers = (row.yamato_tracking as string[] | null) ?? []
      const carrier = (row.carrier as string | null) ?? null
      trackingNumbers.forEach((num) => tasks.push({ rowIndex, trackingNumber: num, carrier }))
    })

    const checkedAt = new Date().toISOString()

    // 追跡プロバイダ経由で取得 (Phase A: shipandco)。carrier→照会先の対応付けと
    // ステータス正規化・異常検知はプロバイダ内で行い、cron は正規化済み結果だけを扱う。
    const provider = getTrackingProvider()
    const taskResults = await mapWithConcurrency(tasks, CONCURRENCY, async (task) => {
      const result = await provider.fetchOne(task.carrier, task.trackingNumber)
      return { rowIndex: task.rowIndex, result }
    })

    // Step 2: rowIndex ごとにグルーピングして、(a) leg の代表ステータス、
    // (b) 追跡番号ごとの詳細 (現在地・日時) を組み立てる。
    // 代表ステータスは複数口のうち「最も進んでいない番号」を採用 — 1個でも
    // 未着なら leg 全体は "配達中" 扱いが安全。詳細の方は個数分すべて保持する
    // (公開トラッキングページで各番号を個別に表示するため).
    let updated = 0
    let detailUpdated = 0
    let skipped = skippedNoTracking
    let deliveryNotified = 0
    let pickupNotified = 0
    const unmapped: Array<{ bookingId: string; leg: number; raw: string }> = []
    const failures: Array<{ bookingId: string; leg: number; reason: string }> = []
    const alertsSent: Array<{ bookingId: string; leg: number; exception: string }> = []
    const chargesMade: Array<{ bookingId: string; leg: number; amountYen: number }> = []
    const chargeFailures: Array<{ bookingId: string; leg: number; error: string }> = []

    interface PrevDetail {
      number: string
      alertedException?: string
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]
      const resultsForRow = taskResults.filter((t) => t.rowIndex === rowIndex).map((t) => t.result)

      // 前回 cron が保存した「通知済み異常」を番号単位で引き継ぐ —
      // 同じ遅延に対して毎時アラートを打ち続けないための重複防止。
      const prevAlerted = new Map<string, string>()
      for (const d of (row.yamato_tracking_detail as PrevDetail[] | null) ?? []) {
        if (d.alertedException) prevAlerted.set(d.number, d.alertedException)
      }

      let bestRank = -1
      let bestStatus: ShipmentStatus | null = null
      let sawUnmapped: string | null = null
      let anySuccess = false
      const newExceptions: Array<{ number: string; label: string; raw: string; location?: string }> = []

      const detail = resultsForRow.map((tr) => {
        if (tr.noData) {
          return { number: tr.number, checkedAt, alertedException: prevAlerted.get(tr.number) }
        }
        anySuccess = true

        // 異常系を最優先 — provider が正規化済み (異常時は status=null)。前進判定には使わない。
        if (tr.exception) {
          const alreadyAlerted = prevAlerted.get(tr.number) === tr.exception
          if (!alreadyAlerted) {
            newExceptions.push({
              number: tr.number,
              label: tr.exception,
              raw: tr.rawStatus ?? "",
              location: tr.location,
            })
          }
          return {
            number: tr.number,
            status: null,
            rawStatus: tr.rawStatus,
            exception: tr.exception,
            alertedException: tr.exception,
            location: tr.location,
            date: tr.date,
            checkedAt,
          }
        }

        const mapped = tr.status
        if (mapped) {
          const rank = progressionRank(mapped)
          if (bestRank === -1 || rank < bestRank) {
            bestRank = rank
            bestStatus = mapped
          }
        } else {
          sawUnmapped = tr.rawStatus ?? null
        }
        return {
          number: tr.number,
          status: mapped,
          rawStatus: tr.rawStatus,
          location: tr.location,
          date: tr.date,
          checkedAt,
        }
      })

      // 新規の異常があれば BondEx + ランドオペレーターへ即時通知 (代理店は言語設定で出し分け)
      if (newExceptions.length > 0) {
        const agencyEmail = agencyEmailByName.get(row.agency as string) ?? null
        const agencyEn = agencyForeignByName.get(row.agency as string) ?? false
        const legLabel = `${row.booking_id}-L${(row.leg_index as number) + 1}`
        await sendOpsAlert({
          subject: `【要確認】配送異常を検知 — ${legLabel}`,
          lines: [
            `予約: ${legLabel} (代理店: ${row.agency})`,
            ...newExceptions.map(
              (e) =>
                `追跡番号 ${e.number}: ${e.label} — ヤマト側表示「${e.raw}」${e.location ? ` @ ${e.location}` : ""}`,
            ),
            `ダッシュボード: https://bondex.express/operator/dashboard`,
            `お客様向け: https://bondex.express/track/${row.booking_id}`,
          ],
          agencyEmail,
          ...(agencyEn
            ? {
                agencySubject: `[BondEx] Delivery alert — ${legLabel}`,
                agencyLines: [
                  `Booking: ${legLabel} (${row.agency})`,
                  ...newExceptions.map(
                    (e) =>
                      `Tracking ${e.number}: ${e.label}${e.location ? ` @ ${e.location}` : ""}`,
                  ),
                  `We are checking with the carrier and will keep you posted.`,
                  `Track: https://bondex.express/track/${row.booking_id}`,
                ],
              }
            : {}),
        })
        for (const e of newExceptions) {
          alertsSent.push({ bookingId: row.booking_id, leg: row.leg_index, exception: e.label })
        }
      }

      if (sawUnmapped) {
        unmapped.push({ bookingId: row.booking_id, leg: row.leg_index, raw: sawUnmapped })
        console.error(
          `[cron/sync-tracking] Unmapped Ship&co status "${sawUnmapped}" for ${row.booking_id}-L${row.leg_index + 1}`,
        )
      }

      // Ship&co 側が今回まるごと応答しなかった場合 (全滅) は、既存の
      // yamato_tracking_detail を空で上書きしない — 一時的な障害で
      // 「今どこにあるか」の情報を消してしまわないため。
      const updatePayload: Record<string, unknown> = {}
      if (anySuccess) {
        updatePayload.yamato_tracking_detail = detail
      }

      const currentRank = progressionRank(row.status as ShipmentStatus)
      // 後退は絶対にしない。現在より前進している場合のみ status を更新。
      const statusAdvances = bestStatus !== null && bestRank > currentRank
      if (statusAdvances) {
        updatePayload.status = bestStatus
        // 集荷ライン(picked_up)を初めて越えたら picked_up_at を記録
        // (ダッシュボードの「本日集荷されました」通知用・未読/既読は pickup_ack_at)。
        if (currentRank < progressionRank("picked_up") && bestRank >= progressionRank("picked_up")) {
          updatePayload.picked_up_at = new Date().toISOString()
        }
        // 配達完了に到達 → delivered_at を記録 (2営業日経過で過去履歴へ移すための基準)。
        if (bestStatus === "delivered") {
          updatePayload.delivered_at = new Date().toISOString()
        }
      }

      if (Object.keys(updatePayload).length === 0) {
        skipped++
        continue
      }

      const { error: updateError } = await sb
        .from("shipments")
        .update(updatePayload)
        .eq("id", row.id)

      if (updateError) {
        failures.push({ bookingId: row.booking_id, leg: row.leg_index, reason: updateError.message })
        continue
      }
      if (statusAdvances) updated++
      if (anySuccess) detailUpdated++
      if (!statusAdvances && !anySuccess) skipped++

      // ── ステータス前進に伴う副作用 (いずれも best-effort・cron 本体は巻き込まない) ──
      if (statusAdvances && bestStatus) {
        // 集荷完了 (picked_up) 以降に到達 → カード課金 (STRIPE_CHARGE_LIVE=true 時のみ実行)。
        // idempotent (charged_at ガード) なので、picked_up を飛ばして in_transit/delivered に
        // 直接進んだ場合でも取りこぼさず、二重にも課金しない。
        if (progressionRank(bestStatus) >= progressionRank("picked_up")) {
          try {
            const r = await chargeShipmentIfDue(row.id as string)
            if (r.charged) {
              chargesMade.push({ bookingId: row.booking_id, leg: row.leg_index, amountYen: r.amountYen ?? 0 })
            } else if (r.error) {
              chargeFailures.push({ bookingId: row.booking_id, leg: row.leg_index, error: r.error })
            }
          } catch (e) {
            console.error("[sync-tracking] charge hook failed:", e instanceof Error ? e.message : e)
          }
        }
        // 集荷完了 → 代理店へ「集荷しました(＝課金確定)」通知。
        //   初めて集荷ライン(picked_up)を越えた時に一度だけ。配達完了に直行した
        //   場合は下の配達完了メールに集約するので、ここでは送らない (二重回避)。
        if (
          bestStatus !== "delivered" &&
          currentRank < progressionRank("picked_up") &&
          bestRank >= progressionRank("picked_up")
        ) {
          try {
            const sent = await sendAgencyStatusEmail(
              "picked_up",
              statusDataFromRow(row, agencyContactByName.get(row.agency as string) ?? null),
              agencyEmailByName.get(row.agency as string) ?? null,
              agencyForeignByName.get(row.agency as string) ?? false,
            )
            if (sent) pickupNotified++
            // support@ へ社内通知 (メール + Slack)。代理店メールとは別経路。
            await notifyBondEx({
              kind: "pickup",
              title: `${row.booking_id as string}-L${(row.leg_index as number) + 1}（${row.agency as string}）`,
              lines: [
                `集荷元: ${(row.from_hotel as string) ?? ""}`,
                `お届け先: ${(row.to_hotel as string) ?? ""}`,
                `代表者: ${(row.representative as string) ?? ""}`,
              ],
              link: `/track/${row.booking_id as string}`,
              linkLabel: "追跡ページで確認",
            })
          } catch (e) {
            console.error("[sync-tracking] pickup notify failed:", e instanceof Error ? e.message : e)
          }
        }
        // 配達完了 → 代理店へ通知 (delivered は次回以降 cron 対象外なので一度きり)
        if (bestStatus === "delivered") {
          const agencyEmail = agencyEmailByName.get(row.agency as string) ?? null
          const legRef = `${row.booking_id}-L${(row.leg_index as number) + 1}`
          let emailSent = false
          try {
            // 送信結果を必ず捕捉する (旧: 戻り値を捨てており、実際は失敗しても "通知済み" に見えた)。
            emailSent = await sendAgencyStatusEmail(
              "delivered",
              statusDataFromRow(row, agencyContactByName.get(row.agency as string) ?? null),
              agencyEmail,
              agencyForeignByName.get(row.agency as string) ?? false,
            )
            // 代理店へのプッシュ通知 (WhatsApp=承認テンプレ / LINE=自由文・登録があれば。メールの補完)
            {
              const rep = (row.representative as string) ?? ""
              const toHotel = (row.to_hotel as string) ?? ""
              await pushToAgency(row.agency as string, {
                kind: "delivered",
                templateParams: [rep, toHotel, legRef], // bondex_delivered の {{1}}{{2}}{{3}}
                textJa: `【BondEx】配達完了 ${legRef}\n${rep} 様のお荷物が ${toHotel} に到着しました。\nhttps://bondex.express/track/${row.booking_id}`,
                textEn: `[BondEx] Delivered ${legRef}\nLuggage for ${rep} has arrived at ${toHotel}.\nhttps://bondex.express/track/${row.booking_id}`,
              })
            }
            // 社内通知(Slack集約)
            await notifyBondEx({
              kind: "delivery",
              title: `${row.booking_id as string}-L${(row.leg_index as number) + 1}（${row.agency as string}）`,
              lines: [
                `お届け先: ${(row.to_hotel as string) ?? ""}`,
                `代表者: ${(row.representative as string) ?? ""}`,
              ],
              link: `/track/${row.booking_id as string}`,
              linkLabel: "追跡ページで確認",
            })
            if (emailSent) deliveryNotified++
          } catch (e) {
            console.error("[sync-tracking] delivery notify failed:", e instanceof Error ? e.message : e)
          }
          // 送達確認: 宛先があるのに配達通知メールが送れなかった = お客様への「届いた報告」が飛んでいない。
          // サイレント失敗を撲滅するため運用へ即アラート (手動フォローの起点)。
          if (agencyEmail && !emailSent) {
            await sendOpsAlert({
              subject: `【配達通知メール未達】${legRef}`,
              lines: [
                `配達は完了しましたが、代理店(${row.agency})への配達通知メールを送信できませんでした。`,
                `宛先: ${agencyEmail}`,
                `→ メーラ設定(SMTP / Resend の bondex.express ドメイン認証)を確認し、必要なら手動で連絡してください。`,
                `追跡: https://bondex.express/track/${row.booking_id}`,
              ],
              agencyEmail: null,
            }).catch(() => {
              /* アラート送信自体の失敗で本処理を止めない */
            })
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // 集荷漏れアラート: 発送日を過ぎても picked_up にならない区間を検知。
    //   - 発送日当日は 18 時 (JST) 以降にのみ発報 (集荷は日中に来るため)
    //   - 前日以前の発送分は時刻に関わらず即発報
    //   - pickup_alert_sent_at で二重通知を防止
    // ------------------------------------------------------------------
    let pickupAlertsSent = 0
    try {
      const nowJst = new Date(Date.now() + 9 * 3600 * 1000)
      const todayJst = nowJst.toISOString().slice(0, 10)
      const hourJst = nowJst.getUTCHours()
      const misses = await listPickupMisses(todayJst)
      const due = misses.filter(
        (s) => s.shipment_date < todayJst || hourJst >= 18,
      )
      const alertedIds: string[] = []
      for (const s of due) {
        const agencyEmail = agencyEmailByName.get(s.agency) ?? null
        const agencyEn = agencyForeignByName.get(s.agency) ?? false
        await sendOpsAlert({
          subject: `【集荷漏れの可能性】${s.booking_id}-L${s.leg_index + 1} ${s.from_hotel}`,
          lines: [
            `予約: ${s.booking_id} (区間 ${s.leg_index + 1})`,
            `代表者: ${s.representative} / 受取人: ${s.recipient}`,
            `発送日: ${s.shipment_date} を過ぎても集荷が確認できていません (現在: ${s.status})`,
            `発送元: ${s.from_hotel} → ${s.to_hotel}`,
            `追跡番号: ${(s.yamato_tracking ?? []).join(", ") || "未発行"}`,
            `対応: 発送元ホテルへ荷物の有無を確認し、必要なら集荷を再手配してください。`,
          ],
          agencyEmail,
          ...(agencyEn
            ? {
                agencySubject: `[BondEx] Possible missed pickup — ${s.booking_id}-L${s.leg_index + 1}`,
                agencyLines: [
                  `Booking: ${s.booking_id} (leg ${s.leg_index + 1})`,
                  `Traveler: ${s.representative}`,
                  `The ship date ${s.shipment_date} has passed but pickup is not confirmed yet.`,
                  `Route: ${s.from_hotel} → ${s.to_hotel}`,
                  `We are checking with the origin hotel and the carrier, and will re-arrange pickup if needed.`,
                ],
              }
            : {}),
        })
        alertedIds.push(s.id)
        pickupAlertsSent++
      }
      await markPickupAlerted(alertedIds)
    } catch (err) {
      console.error("[sync-tracking] pickup-miss check failed:", err instanceof Error ? err.message : err)
    }

    // ------------------------------------------------------------------
    // 配達遅延アラート: 予定到着日を過ぎても未配達の区間を検知 (取りこぼしの自動発見)。
    //   - delivery_overdue_alerted_at で二重通知を防止 (一度きり)。
    // ------------------------------------------------------------------
    let overdueAlertsSent = 0
    try {
      const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
      const overdue = await listDeliveryOverdue(todayJst)
      const overdueIds: string[] = []
      for (const s of overdue) {
        await sendOpsAlert({
          subject: `【配達遅延の可能性】${s.booking_id}-L${s.leg_index + 1} → ${s.to_hotel}`,
          lines: [
            `予約: ${s.booking_id} (区間 ${s.leg_index + 1}) / 代理店: ${s.agency}`,
            `代表者: ${s.representative}`,
            `予定到着日 ${s.expected_arrival} を過ぎても配達完了が確認できていません (現在: ${s.status})`,
            `区間: ${s.from_hotel} → ${s.to_hotel}`,
            `追跡番号: ${(s.yamato_tracking ?? []).join(", ") || "未発行"}`,
            `対応: 追跡状況を確認し、遅延・不着なら配送業者へ照会してください。`,
            `追跡: https://bondex.express/track/${s.booking_id}`,
          ],
          agencyEmail: null,
        }).catch(() => {
          /* アラート送信失敗で本処理を止めない */
        })
        overdueIds.push(s.id)
        overdueAlertsSent++
      }
      await markDeliveryOverdueAlerted(overdueIds)
    } catch (err) {
      console.error("[sync-tracking] delivery-overdue check failed:", err instanceof Error ? err.message : err)
    }

    return NextResponse.json({
      overdueAlertsSent,
      pickupAlertsSent,
      checked: rows.length,
      tasksRun: tasks.length,
      updated,
      detailUpdated,
      skipped,
      deliveryNotified,
      pickupNotified,
      mailerConfigured: mailerConfigured(), // メール送信が構成済みか (秘密は出さない・送達診断用)
      unmapped,
      alertsSent,
      chargesMade,
      chargeFailures,
      failures,
    })

  } finally {
    await releaseCronLock("sync-tracking")
  }
}
