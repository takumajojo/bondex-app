import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * P1-B2 v3.5 Track C｜増額承認通知 (料金保護A)。
 *
 * 実個数の確定で請求額が増える案件について、対象代理店へ「承認のお願い」を通知するための
 * 本文生成・キュー投入・再送制御。**本番メールは送らない** (mailer を import しない)。
 * 送信そのものは opts.sender で注入する (既定はドライラン=送らずに成功扱い)。将来、本番有効化時に
 * Flag 配下で実メール送信関数を注入する。送信失敗は配送・既存予約を止めない (通知は別系統)。
 */

export interface PriceChangeData {
  bookingRef: string
  fromHotel?: string | null
  toHotel?: string | null
  shipmentDate?: string | null
  declaredCount: number
  actualCount: number
  quotedGrossYen: number
  recalcGrossYen: number
  increaseGrossYen: number
  expiresAt?: string | null
  approvalUrl?: string | null
  supportEmail?: string
}

const yen = (n: number) => `¥${(n ?? 0).toLocaleString("ja-JP")}`

/** 増額承認のお願いメール本文 (ja/en)。金額は税込で提示 (税抜内訳は承認画面で表示)。 */
export function buildPriceChangeMessage(d: PriceChangeData, locale: "ja" | "en"): { subject: string; body: string } {
  const support = d.supportEmail || "support@bondex.express"
  const url = d.approvalUrl || "(代理店ポータルの「料金承認」)"
  if (locale === "en") {
    return {
      subject: `[BondEx] Price change needs your approval (${d.bookingRef})`,
      body: [
        `The actual piece count for the booking below differs from the reservation, and the amount increased.`,
        `We will not charge or invoice the new amount until you approve it. Your shipment is not held up by this.`,
        "",
        `Booking: ${d.bookingRef}`,
        d.shipmentDate ? `Pickup date: ${d.shipmentDate}` : "",
        d.fromHotel ? `From: ${d.fromHotel}` : "",
        d.toHotel ? `To: ${d.toHotel}` : "",
        `Pieces: reserved ${d.declaredCount} → actual ${d.actualCount}`,
        `Amount (tax incl.): ${yen(d.quotedGrossYen)} → ${yen(d.recalcGrossYen)} (increase ${yen(d.increaseGrossYen)})`,
        d.expiresAt ? `Please approve by: ${d.expiresAt}` : "",
        "",
        `Approve the new amount: ${url}`,
        `Questions? Contact ${support}.`,
        "",
        "— BondEx / JOJO Inc.",
      ].filter(Boolean).join("\n"),
    }
  }
  return {
    subject: `【BondEx】料金変更のご承認のお願い（${d.bookingRef}）`,
    body: [
      `下記のご予約について、実際の集荷個数が予約時と異なり、ご請求額が増えました。`,
      `ご承認をいただくまで、変更後の金額での課金・請求はいたしません。配送はこのために止まりません。`,
      "",
      `予約番号: ${d.bookingRef}`,
      d.shipmentDate ? `集荷日: ${d.shipmentDate}` : "",
      d.fromHotel ? `集荷元: ${d.fromHotel}` : "",
      d.toHotel ? `お届け先: ${d.toHotel}` : "",
      `個数: 予約 ${d.declaredCount}個 → 実際 ${d.actualCount}個`,
      `ご請求額（税込）: ${yen(d.quotedGrossYen)} → ${yen(d.recalcGrossYen)}（増額 ${yen(d.increaseGrossYen)}）`,
      d.expiresAt ? `ご承認期限: ${d.expiresAt}` : "",
      "",
      `変更後の料金を承認する: ${url}`,
      `ご不明な点は ${support} までお問い合わせください。`,
      "",
      "— BondEx ／ 株式会社JOJO",
    ].filter(Boolean).join("\n"),
  }
}

/** 増額承認通知をキューに積む (冪等: 同一 shipment×見積バージョンは1通)。失敗しても throw しない。 */
export async function enqueuePriceNotification(
  sb: SupabaseClient,
  shipmentId: string,
  approvalId: string | null,
  quoteVersion: number,
  locale?: string | null,
): Promise<void> {
  const { error } = await sb.rpc("enqueue_price_notification", {
    p_shipment_id: shipmentId,
    p_approval_id: approvalId,
    p_quote_version: quoteVersion,
    p_locale: locale ?? null,
  })
  if (error) console.error("[price-notify] enqueue failed", error.message)
}

export type NotificationSender = (
  to: string | null,
  msg: { subject: string; body: string },
  locale: "ja" | "en",
) => Promise<{ sent: boolean; error?: string }>

/** 既定の送信器: 何も送らない (ドライラン)。本番メールは送らない。 */
const dryRunSender: NotificationSender = async () => ({ sent: true })

interface NotifRow {
  id: string
  shipment_id: string
  agency_id: string
  quote_version: number
  attempts: number
}

/**
 * 保留中の通知を処理する。既定はドライラン (送信器=no-op)。再送制御: attempts<maxAttempts のものだけ対象。
 * 本番メールを送るには、将来 Flag 配下で実送信関数を opts.sender に注入する。
 */
export async function processPendingPriceNotifications(
  sb: SupabaseClient,
  opts: { sender?: NotificationSender; maxAttempts?: number; limit?: number } = {},
): Promise<{ processed: number; sent: number; failed: number }> {
  const sender = opts.sender ?? dryRunSender
  const maxAttempts = opts.maxAttempts ?? 5
  const limit = opts.limit ?? 100
  const { data, error } = await sb
    .from("agency_price_notifications")
    .select("id, shipment_id, agency_id, quote_version, attempts")
    .in("state", ["pending", "failed"])
    .lt("attempts", maxAttempts)
    .order("created_at", { ascending: true })
    .limit(limit)
  if (error) {
    console.error("[price-notify] select pending failed", error.message)
    return { processed: 0, sent: 0, failed: 0 }
  }
  let sent = 0
  let failed = 0
  for (const n of (data ?? []) as NotifRow[]) {
    // 承認内容・代理店宛先・言語をサーバー保存値から引く (本文はここで組み立てる)。
    const { data: ap } = await sb
      .from("shipment_price_approvals")
      .select("booking_id, declared_count, actual_count, quoted_gross_yen, recalc_gross_yen, increase_gross_yen, expires_at")
      .eq("shipment_id", n.shipment_id)
      .eq("quote_version", n.quote_version)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data: ag } = await sb.from("agencies").select("contact_email, locale").eq("id", n.agency_id).maybeSingle()
    const locale: "ja" | "en" = (ag as { locale?: string } | null)?.locale === "en" ? "en" : "ja"
    const a = (ap ?? {}) as Record<string, unknown>
    const msg = buildPriceChangeMessage(
      {
        bookingRef: String(a.booking_id ?? ""),
        declaredCount: Number(a.declared_count ?? 0),
        actualCount: Number(a.actual_count ?? 0),
        quotedGrossYen: Number(a.quoted_gross_yen ?? 0),
        recalcGrossYen: Number(a.recalc_gross_yen ?? 0),
        increaseGrossYen: Number(a.increase_gross_yen ?? 0),
        expiresAt: (a.expires_at as string | null) ?? null,
      },
      locale,
    )
    const to = (ag as { contact_email?: string | null } | null)?.contact_email ?? null
    let result: { sent: boolean; error?: string }
    try {
      result = await sender(to, msg, locale)
    } catch (e) {
      result = { sent: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (result.sent) {
      await sb.rpc("mark_price_notification_sent", { p_id: n.id })
      sent++
    } else {
      await sb.rpc("mark_price_notification_failed", { p_id: n.id, p_error: result.error ?? "send failed" })
      failed++
    }
  }
  return { processed: (data ?? []).length, sent, failed }
}
