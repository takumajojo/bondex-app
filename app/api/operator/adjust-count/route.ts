import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { sendMail } from "@/lib/mailer"
import { notifyBondEx } from "@/lib/notify"

export const runtime = "nodejs"
export const maxDuration = 30

const PRICE_PER = 5000

type ReasonCode = "mismatch" | "not_collected" | "customer_change" | "other"
const REASON_LABEL_JA: Record<ReasonCode, string> = {
  mismatch: "個数の相違（受付と実際が違った）",
  not_collected: "集荷不可（お客様から荷物をお預かりできず）",
  customer_change: "お客様都合の変更",
  other: "その他",
}

/**
 * POST /api/operator/adjust-count
 *   { id: string, newCount: number (0-99), reasonCode: ReasonCode, reasonNote?: string }
 *
 * 集荷時の「受付個数 ≠ 実個数」を、理由を必須にして修正する運用専用フロー。
 * middleware で operator 認証必須。
 *   - newCount === 0（または reasonCode="not_collected"）→ 区間キャンセル（status=cancelled・請求なし）
 *   - newCount >= 1 → suitcase_count を更新し、未課金なら amount_yen を 個数×¥5,000 に再計算
 *     （課金済みは金額を触らず、通知で「差額返金が必要」と明示）
 * 変更は count_change_log に追記し、依頼元ランオペへメール＋社内Slackへ通知する。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "adjust-count")
  if (!limit.ok) return limit.response

  let body: { id?: unknown; newCount?: unknown; reasonCode?: unknown; reasonNote?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const id = typeof body.id === "string" ? body.id.trim() : ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const reasonCode = (
    ["mismatch", "not_collected", "customer_change", "other"] as const
  ).includes(body.reasonCode as ReasonCode)
    ? (body.reasonCode as ReasonCode)
    : null
  if (!reasonCode) return NextResponse.json({ error: "reasonCode が不正です" }, { status: 400 })

  const reasonNote = typeof body.reasonNote === "string" ? body.reasonNote.trim().slice(0, 500) : ""
  if (reasonCode === "other" && !reasonNote) {
    return NextResponse.json({ error: "「その他」は理由の記述が必要です" }, { status: 400 })
  }

  let newCount = Math.floor(Number(body.newCount))
  if (!Number.isFinite(newCount) || newCount < 0 || newCount > 99) {
    return NextResponse.json({ error: "個数は 0〜99 で入力してください" }, { status: 400 })
  }
  // 集荷不可は 0 個（＝区間キャンセル）に正規化
  if (reasonCode === "not_collected") newCount = 0

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 })

  const shipment = await getShipment(id)
  if (!shipment) return NextResponse.json({ error: "shipment not found" }, { status: 404 })

  const oldCount = shipment.suitcase_count
  const oldAmount = shipment.amount_yen ?? 0
  const wasCharged = !!shipment.charged_at
  const cancel = newCount === 0

  if (newCount === oldCount && !cancel) {
    return NextResponse.json({ error: "個数が変わっていません" }, { status: 400 })
  }

  // 新しい請求額: 課金済みは据え置き（差額返金は運用で対応）。未課金はキャンセル=0 / それ以外=個数×単価。
  const newAmount = wasCharged ? oldAmount : cancel ? 0 : newCount * PRICE_PER

  const logEntry = {
    at: new Date().toISOString(),
    from: oldCount,
    to: newCount,
    reason: reasonCode,
    note: reasonNote || null,
    cancelled: cancel,
    old_amount: oldAmount,
    new_amount: newAmount,
    was_charged: wasCharged,
  }
  const rec = shipment as unknown as { count_change_log?: unknown[] }
  const prevLog = Array.isArray(rec.count_change_log) ? rec.count_change_log : []

  const update: Record<string, unknown> = { count_change_log: [...prevLog, logEntry] }
  if (cancel) {
    update.status = "cancelled"
    if (!wasCharged) update.amount_yen = 0
  } else {
    update.suitcase_count = newCount
    if (!wasCharged) update.amount_yen = newAmount
  }

  const { error: upErr } = await sb.from("shipments").update(update).eq("id", id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // 依頼元ランオペの連絡先
  const { data: ag } = await sb
    .from("agencies")
    .select("contact_email, locale")
    .eq("name", shipment.agency)
    .maybeSingle()
  const agencyEmail: string | null = ag?.contact_email ?? null
  const english = ag?.locale === "en"

  const legRef = `${shipment.booking_id}-L${shipment.leg_index + 1}`
  const route = `${shipment.from_hotel} → ${shipment.to_hotel}`
  const yen = (n: number) => `¥${n.toLocaleString()}`

  // ランオペ向けメール本文（キャンセル / 個数是正 で文面を出し分け）
  const jaLines: string[] = [`${shipment.agency} 御中`, ""]
  if (cancel) {
    jaLines.push(
      `下記のお荷物について、集荷時にお預かりができませんでした（${REASON_LABEL_JA[reasonCode]}）。`,
      `本区間はキャンセル扱いとし、ご請求はございません。`,
    )
    if (wasCharged) jaLines.push(`※既にご請求済みの場合は、全額（${yen(oldAmount)}）を返金いたします。`)
  } else {
    jaLines.push(
      `下記のお荷物について、集荷時に個数の相違がございました（${REASON_LABEL_JA[reasonCode]}）。`,
      `受付 ${oldCount}個 → 実際 ${newCount}個 に修正いたしました。`,
    )
    if (wasCharged) {
      const diff = oldAmount - newCount * PRICE_PER
      jaLines.push(
        `ご請求は ${yen(oldAmount)} で処理済みのため、差額 ${yen(Math.abs(diff))} を${diff >= 0 ? "返金" : "追加請求"}いたします。`,
      )
    } else {
      jaLines.push(`ご請求を ${yen(oldAmount)} → ${yen(newAmount)} に調整いたします。`)
    }
  }
  if (reasonNote) jaLines.push("", `補足: ${reasonNote}`)
  jaLines.push(
    "",
    `予約番号: ${legRef}`,
    `区間: ${route}`,
    `発送日: ${shipment.shipment_date}`,
    "",
    "ご不明な点は support@bondex.express までお気軽にお問い合わせください。",
    "— BondEx ／ 株式会社JOJO",
  )

  const subject = cancel
    ? `【BondEx】お荷物のお預かりについて（${legRef}）`
    : `【BondEx】お荷物の個数修正のご連絡（${legRef}）`

  let mailSent = false
  if (agencyEmail) {
    const text = english
      ? [
          `Dear ${shipment.agency},`,
          "",
          cancel
            ? `We were unable to collect the luggage for the leg below (${REASON_LABEL_JA[reasonCode]}). This leg is cancelled and will not be charged.`
            : `The piece count for the leg below was corrected: ${oldCount} → ${newCount}. Your charge will be adjusted ${yen(oldAmount)} → ${yen(newAmount)}.`,
          "",
          `Booking: ${legRef}`,
          `Route: ${route}`,
          reasonNote ? `Note: ${reasonNote}` : "",
          "",
          "— BondEx / JOJO Inc.",
        ]
          .filter(Boolean)
          .join("\n")
      : jaLines.join("\n")
    const r = await sendMail({ to: agencyEmail, subject, text, replyTo: "support@bondex.express" })
    mailSent = r.sent
  }

  // 社内 Slack（集約通知）
  await notifyBondEx({
    kind: "adjust",
    title: cancel
      ? `${legRef}（${shipment.agency}）区間キャンセル`
      : `${legRef}（${shipment.agency}）個数 ${oldCount}→${newCount}`,
    lines: [
      `理由: ${REASON_LABEL_JA[reasonCode]}`,
      reasonNote ? `補足: ${reasonNote}` : "",
      wasCharged
        ? `⚠️ 課金済み ${yen(oldAmount)} → ${cancel ? "全額" : yen(Math.abs(oldAmount - newCount * PRICE_PER))}返金が必要（Stripe）`
        : `請求: ${yen(oldAmount)} → ${yen(newAmount)}`,
      agencyEmail ? `ランオペ通知: ${mailSent ? "送信済" : "未送信（要確認）"}` : "ランオペのメール未登録",
    ],
    link: `/track/${shipment.booking_id}`,
    linkLabel: "追跡ページで確認",
  })

  return NextResponse.json({
    ok: true,
    cancelled: cancel,
    oldCount,
    newCount,
    oldAmount,
    newAmount,
    wasCharged,
    mailSent,
    agencyEmailKnown: !!agencyEmail,
  })
}
