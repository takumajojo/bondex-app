import Stripe from "stripe"
import { getSupabase } from "@/lib/supabase"
import {
  getShipment,
  recordShipmentCharge,
  recordShipmentChargeError,
  type ShipmentRecord,
} from "@/lib/shipments-db"
import { sendOpsAlert } from "@/lib/ops-alert"
import { sendMail } from "@/lib/mailer"
import { buildChargeInvoice } from "@/lib/invoice-build"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * 集荷完了時のカード課金 (海外/法人=Stripe 1件ごと課金モデル)。
 *
 * ── 安全装置 ──────────────────────────────────────────────
 * 実際にカードへ課金するのは STRIPE_CHARGE_LIVE === "true" かつ
 * STRIPE_SECRET_KEY (本番キー) がある時**だけ**。既定 (未設定) では
 * 一切課金せず {charged:false, reason:"disabled"} を返す。
 * SHIPANDCO_LIVE と同じ「フラグを立てるまで無害」方式。
 *
 * ── 二重課金防止 ──────────────────────────────────────────
 *  1) shipments.charged_at が既にあれば即スキップ。
 *  2) Stripe 側にも idempotencyKey (`charge_<shipmentId>`) を渡す。
 * どちらか一方でも二重課金を防げる。
 *
 * ── 対象 ──────────────────────────────────────────────────
 * payment_method='card' かつ card_on_file の代理店のみ。
 * 'invoice' 代理店は月次請求書 (cron/monthly-invoices) で請求するため対象外。
 *
 * この関数は **絶対に throw しない**。集荷完了のステータス更新や cron 本体を
 * 課金失敗が巻き込まないよう、全エラーを握って戻り値とログ/アラートで報告する。
 */

export interface ChargeResult {
  charged: boolean
  skipped?: boolean
  reason?: string
  paymentIntentId?: string
  amountYen?: number
  error?: string
}

export async function chargeShipmentIfDue(shipmentId: string): Promise<ChargeResult> {
  // --- 安全ゲート: フラグとキーが揃うまで課金しない ---
  const live = process.env.STRIPE_CHARGE_LIVE === "true"
  const secret = process.env.STRIPE_SECRET_KEY
  if (!live || !secret) {
    return { charged: false, skipped: true, reason: "disabled" }
  }

  try {
    const shipment = await getShipment(shipmentId)
    if (!shipment) return { charged: false, skipped: true, reason: "shipment_not_found" }

    // 既に課金済みなら何もしない (二重課金防止)
    if (shipment.charged_at) {
      return { charged: false, skipped: true, reason: "already_charged" }
    }

    const amountYen = shipment.amount_yen ?? 0
    if (!Number.isFinite(amountYen) || amountYen <= 0) {
      return { charged: false, skipped: true, reason: "no_amount" }
    }

    const sb = getSupabase()
    if (!sb) return { charged: false, skipped: true, reason: "db_unset" }

    // 代理店の決済情報を引く
    const { data: agency } = await sb
      .from("agencies")
      .select("id, name, contact_email, payment_method, card_on_file, stripe_customer_id")
      .eq("name", shipment.agency)
      .maybeSingle()

    if (!agency) return { charged: false, skipped: true, reason: "agency_not_found" }

    // 請求書払いの代理店は月次請求書で請求 — カード課金しない
    if (agency.payment_method !== "card") {
      return { charged: false, skipped: true, reason: "not_card_agency" }
    }

    if (!agency.card_on_file || !agency.stripe_customer_id) {
      const msg = "カード未登録のため課金できません (集荷完了済)"
      await recordShipmentChargeError(shipmentId, msg)
      await notifyChargeFailure(shipment.booking_id, shipment.leg_index, agency.name, amountYen, msg, agency.contact_email)
      return { charged: false, error: msg }
    }

    const stripe = new Stripe(secret)

    // 顧客の既定支払い方法を取得
    const customer = await stripe.customers.retrieve(agency.stripe_customer_id)
    const defaultPm =
      !("deleted" in customer) && customer.invoice_settings?.default_payment_method
        ? (typeof customer.invoice_settings.default_payment_method === "string"
            ? customer.invoice_settings.default_payment_method
            : customer.invoice_settings.default_payment_method.id)
        : null
    if (!defaultPm) {
      const msg = "既定カードが設定されていないため課金できません"
      await recordShipmentChargeError(shipmentId, msg)
      await notifyChargeFailure(shipment.booking_id, shipment.leg_index, agency.name, amountYen, msg, agency.contact_email)
      return { charged: false, error: msg }
    }

    // off_session で即時課金 (JPY はゼロ小数通貨なので amount = 円の額そのまま)
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountYen,
          currency: "jpy",
          customer: agency.stripe_customer_id,
          payment_method: defaultPm,
          off_session: true,
          confirm: true,
          description: `BondEx 手荷物配送 ${shipment.booking_id}-L${shipment.leg_index + 1} (${shipment.suitcase_count}個)`,
          metadata: {
            shipment_id: shipmentId,
            booking_id: shipment.booking_id,
            leg_index: String(shipment.leg_index),
            agency: agency.name,
          },
        },
        { idempotencyKey: `charge_${shipmentId}` },
      )

      if (pi.status === "succeeded") {
        await recordShipmentCharge(shipmentId, pi.id, amountYen)
        // 請求書 兼 領収書を生成して代理店へメール送付 (必須)。
        // 課金は既に成立しているので、失敗しても throw せずアラートで拾う。
        await sendChargeInvoice(
          sb,
          {
            ...shipment,
            charged_at: new Date().toISOString(),
            stripe_payment_intent_id: pi.id,
            charge_amount_yen: amountYen,
          },
          agency.contact_email,
        )
        return { charged: true, paymentIntentId: pi.id, amountYen }
      }

      // requires_action など (3DS 等) — off_session では完了できない
      const msg = `決済が完了しませんでした (status: ${pi.status})`
      await recordShipmentChargeError(shipmentId, msg)
      await notifyChargeFailure(shipment.booking_id, shipment.leg_index, agency.name, amountYen, msg, agency.contact_email)
      return { charged: false, error: msg, paymentIntentId: pi.id }
    } catch (err) {
      // カード拒否・残高不足など
      const msg = err instanceof Error ? err.message : "Stripe charge failed"
      await recordShipmentChargeError(shipmentId, msg)
      await notifyChargeFailure(shipment.booking_id, shipment.leg_index, agency.name, amountYen, msg, agency.contact_email)
      return { charged: false, error: msg }
    }
  } catch (err) {
    // 想定外 — 呼び出し元 (集荷完了処理) は絶対に巻き込まない
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[charge] chargeShipmentIfDue 予期せぬエラー:", msg)
    return { charged: false, error: msg }
  }
}

/**
 * カード決済1件の請求書 兼 領収書を生成し、代理店 (+BondEx控え) へメール送付。
 * メール送付は必須要件。失敗時は throw せず ops へアラート (課金は既に成立済のため)。
 */
async function sendChargeInvoice(
  sb: SupabaseClient,
  shipment: ShipmentRecord,
  agencyEmail?: string | null,
): Promise<void> {
  const legRef = `${shipment.booking_id}-L${shipment.leg_index + 1}`
  try {
    const built = await buildChargeInvoice(sb, shipment)
    if (!built.ok || !built.buffer) {
      await sendOpsAlert({
        subject: `【請求書生成失敗】${legRef} (${shipment.agency})`,
        lines: [
          `カード決済は成立しましたが、請求書 兼 領収書のPDF生成に失敗しました。`,
          `予約: ${legRef} / 代理店: ${shipment.agency} / 理由: ${built.reason ?? "unknown"}`,
          `→ /operator から手動で発行・送付してください。`,
        ],
        agencyEmail: null,
      })
      return
    }

    const attachments = [
      { filename: built.fileName!, contentBase64: built.buffer.toString("base64") },
    ]
    const subject = `【BondEx】請求書 兼 領収書（${legRef}）クレジットカード決済`
    const body = [
      `${shipment.agency} 御中`,
      "",
      `下記区間の集荷が完了し、ご登録のクレジットカードにて決済いたしました。`,
      `請求書 兼 領収書（適格請求書）を添付いたします。`,
      "",
      `予約番号: ${legRef}`,
      `区間: ${shipment.from_hotel} → ${shipment.to_hotel}`,
      `ご請求金額（税込・お支払い済み）: ¥${(built.totalYen ?? 0).toLocaleString()}`,
      "",
      `本書は代理店ポータル（ログイン後の一覧）からもいつでもダウンロードいただけます。`,
      `ご不明な点は support@bondex.express までお問い合わせください。`,
      "",
      "— BondEx ／ 株式会社JOJO ｜ support@bondex.express",
    ].join("\n")

    const bondexCopy = process.env.ALERT_EMAIL || "support@bondex.express"
    const recipients: string[] = []
    if (agencyEmail) recipients.push(agencyEmail)
    recipients.push(bondexCopy)

    let anySent = false
    const errs: string[] = []
    for (const to of recipients) {
      const r = await sendMail({ to, subject, text: body, attachments, replyTo: "support@bondex.express" })
      if (r.sent) anySent = true
      else errs.push(`${to}: ${r.error}`)
    }

    // 代理店宛が送れなかった (メール未登録 or 送信失敗) 場合は必須要件が未達なのでアラート
    if (!agencyEmail || !anySent || errs.some((e) => agencyEmail && e.startsWith(agencyEmail))) {
      await sendOpsAlert({
        subject: `【請求書メール未達】${legRef} (${shipment.agency})`,
        lines: [
          `カード決済は成立し請求書は生成しましたが、代理店への送付が未達です。`,
          `予約: ${legRef} / 代理店: ${shipment.agency}`,
          agencyEmail ? `宛先: ${agencyEmail}` : `代理店のメールアドレスが未登録です。`,
          errs.length ? `エラー: ${errs.join("; ")}` : "",
          `→ /operator から請求書を再送してください（ポータルからも代理店がDL可能）。`,
        ].filter(Boolean),
        agencyEmail: null,
      })
    }
  } catch (e) {
    console.error("[charge] sendChargeInvoice failed:", e instanceof Error ? e.message : e)
    await sendOpsAlert({
      subject: `【請求書処理エラー】${legRef} (${shipment.agency})`,
      lines: [
        `カード決済は成立しましたが、請求書メール処理で例外が発生しました。`,
        `予約: ${legRef} / 代理店: ${shipment.agency}`,
        `→ /operator から手動で発行・送付してください。`,
      ],
      agencyEmail: null,
    })
  }
}

async function notifyChargeFailure(
  bookingId: string,
  legIndex: number,
  agencyName: string,
  amountYen: number,
  reason: string,
  agencyEmail?: string | null,
): Promise<void> {
  await sendOpsAlert({
    subject: `【カード課金失敗】${bookingId}-L${legIndex + 1} (${agencyName})`,
    lines: [
      `予約: ${bookingId}-L${legIndex + 1} / 代理店: ${agencyName}`,
      `金額: ¥${amountYen.toLocaleString()}`,
      `理由: ${reason}`,
      "→ 集荷は完了しています。手動での再課金 or 請求書での回収をご検討ください。",
      "  ダッシュボード: https://bondex.express/operator/dashboard",
    ],
    // 課金失敗は社内の与信問題なので、代理店には自動送信しない (BondEx運用のみ)。
    agencyEmail: null,
  })
  void agencyEmail
}
