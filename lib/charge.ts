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
import { notifyBondEx } from "@/lib/notify"
import { buildChargeInvoice } from "@/lib/invoice-build"
import type { SupabaseClient } from "@supabase/supabase-js"
import { grossOf } from "@/lib/tax"
import { resolveUnitPriceYen } from "@/lib/pricing"

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

    // 旅行中の「追加」区間は集荷時の自動課金対象外。
    // カード=Stripe Checkout の決済リンク、請求書=月次請求で清算する(二重清算防止)。
    if (shipment.is_addition) {
      return { charged: false, skipped: true, reason: "addition_settled_separately" }
    }

    const sb = getSupabase()
    if (!sb) return { charged: false, skipped: true, reason: "db_unset" }

    // 代理店の決済情報を引く
    const { data: agency } = await sb
      .from("agencies")
      .select("id, name, contact_email, payment_method, card_on_file, stripe_customer_id, billing_exempt, locale, is_domestic, unit_price_yen")
      .eq("name", shipment.agency)
      .maybeSingle()

    if (!agency) {
      // 代理店名がマスタと食い違う = 誰に課金すべきか不明。黙って終わらせず必ず人に知らせる。
      const msg = `代理店「${shipment.agency ?? "—"}」が代理店マスタに見つからないため課金できません (集荷完了済)`
      await recordShipmentChargeError(shipmentId, msg)
      await notifyChargeFailure(shipment.booking_id, shipment.leg_index, shipment.agency ?? "—", 0, msg, null)
      return { charged: false, error: msg }
    }

    // テスト代理店 (billing_exempt) は、どんなに配送手配しても一切課金しない (谷口さん指示)。
    // カード登録は可能だが、集荷完了しても課金処理をスキップする。
    if (agency.billing_exempt) {
      return { charged: false, skipped: true, reason: "billing_exempt" }
    }

    // 請求書払いの代理店は月次請求書で請求 — カード課金しない
    if (agency.payment_method !== "card") {
      return { charged: false, skipped: true, reason: "not_card_agency" }
    }

    // amount_yen は税抜小計 (個数 × 単価)。
    // 未確定 (0) のまま集荷された区間 = 送り状を Ship&co で発行せず問い合わせ番号を手入力した区間など。
    // 以前はここで黙ってスキップしており、カード代理店の課金漏れ事故になった (BDX-8K8Z2V-L1, 2026-10-31)。
    // → 集荷済みなら「個数 × 代理店単価」でこの場で確定させて課金する。個数も無ければ必ずアラート。
    let netYen = Number(shipment.amount_yen) || 0
    if (netYen <= 0) {
      const count = Math.floor(Number(shipment.suitcase_count) || 0)
      if (count <= 0) {
        const msg = "金額・個数が未確定のため課金できません (集荷完了済)。個数を確定して再試行してください"
        await recordShipmentChargeError(shipmentId, msg)
        await notifyChargeFailure(shipment.booking_id, shipment.leg_index, agency.name, 0, msg, null)
        return { charged: false, error: msg }
      }
      netYen = count * resolveUnitPriceYen(agency.unit_price_yen as number | null)
      // 未確定 (0/NULL) のときだけ書く。並走で他経路が先に確定していたら上書きしない。
      const { error: amtErr } = await sb
        .from("shipments")
        .update({ amount_yen: netYen })
        .eq("id", shipmentId)
        .or("amount_yen.is.null,amount_yen.lte.0")
      if (amtErr) {
        const msg = `請求額の確定に失敗したため課金を中止しました: ${amtErr.message}`
        await recordShipmentChargeError(shipmentId, msg)
        await notifyChargeFailure(shipment.booking_id, shipment.leg_index, agency.name, 0, msg, null)
        return { charged: false, error: msg }
      }
      shipment.amount_yen = netYen
    }

    // 実際に課金する額。国内・海外を問わず消費税を上乗せ (税込)。
    // 海外の旅行会社向けでも国内配送の手配は輸出免税にならず 10% 課税 (2026-10-05 税理士確認)。
    const amountYen = grossOf(netYen)

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
        const rec = await recordShipmentCharge(shipmentId, pi.id, amountYen)
        if (!rec.ok) {
          // 課金成功なのに記録失敗 = 24時間後の再試行で二重課金になりうる最悪パターン。
          // 必ず人に届くアラートを飛ばす (2026-08-31 監査対応)。
          await sendOpsAlert({
            subject: `【緊急】課金成功の記録に失敗 ${shipment.booking_id}-L${shipment.leg_index + 1}`,
            lines: [
              `Stripe では課金が成立しています: PaymentIntent ${pi.id} / ¥${amountYen.toLocaleString()}`,
              `しかし DB の charged_at を更新できませんでした: ${rec.error ?? "unknown"}`,
              "手動で charged_at / stripe_payment_intent_id / charge_amount_yen を記録してください。",
              "記録しないまま24時間経過すると、再試行で二重課金になります。",
            ],
            agencyEmail: null,
          })
        }
        if (!rec.firstRecord) {
          // 既に記録済み (並走 or 再実行)。領収書メールの重複送付を防いでここで終える。
          return { charged: true, paymentIntentId: pi.id, amountYen }
        }
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
          agency.locale === "en" ? "en" : "ja",
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
  locale: "ja" | "en" = "ja",
): Promise<void> {
  const legRef = `${shipment.booking_id}-L${shipment.leg_index + 1}`
  const en = locale === "en"
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
    const amount = `¥${(built.totalYen ?? 0).toLocaleString()}`
    const subject = en
      ? `[BondEx] Invoice / Receipt (${legRef}) — card payment`
      : `【BondEx】請求書 兼 領収書（${legRef}）クレジットカード決済`
    const body = en
      ? [
          `Dear ${shipment.agency},`,
          "",
          "The luggage for the leg below has been collected and charged to your registered card.",
          "The invoice / receipt (a Japanese qualified invoice) is attached.",
          "",
          `Booking: ${legRef}`,
          `Route: ${shipment.from_hotel} → ${shipment.to_hotel}`,
          `Amount (tax incl., paid): ${amount}`,
          "",
          "You can also download it anytime from your agency portal (the list after signing in).",
          "Questions? Contact support@bondex.express.",
          "",
          "— BondEx / JOJO Inc. | support@bondex.express",
        ].join("\n")
      : [
          `${shipment.agency} 御中`,
          "",
          `下記区間の集荷が完了し、ご登録のクレジットカードにて決済いたしました。`,
          `請求書 兼 領収書（適格請求書）を添付いたします。`,
          "",
          `予約番号: ${legRef}`,
          `区間: ${shipment.from_hotel} → ${shipment.to_hotel}`,
          `ご請求金額（税込・お支払い済み）: ${amount}`,
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

    // 社内通知(Slack集約) — 集荷完了→カード決済が成立したことを1部屋に流す。
    await notifyBondEx({
      kind: "charge",
      title: `${legRef}（${shipment.agency}）決済完了`,
      lines: [
        `区間: ${shipment.from_hotel} → ${shipment.to_hotel}`,
        `金額(税込): ¥${(built.totalYen ?? 0).toLocaleString()}`,
      ],
      link: `/track/${shipment.booking_id}`,
      linkLabel: "追跡ページで確認",
    })

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

/**
 * 課金漏れの安全網 (2026-11-02 谷口さん指示「カード登録で課金していないのは事故。絶対にないように」)。
 *
 * 課金は本来「集荷 or 配送中/配達完了にステータスが進んだ瞬間」のフックで行うが、
 * フックは一度きりなので、その瞬間に何らかの理由で課金されなかった区間は二度と拾われなかった。
 * この関数は追跡同期 cron (30分おき) の最後に毎回走り、次の条件の区間をすべて課金し直す:
 *   - status が picked_up / in_transit / delivered (集荷ライン以降)
 *   - charged_at が無い (未課金) かつ charge_error が無い (失敗は既にアラート済み・手動再試行に任せる)
 *   - 追加区間でない (Checkout リンクで別清算)・キャンセルされていない
 *   - 代理店がカード払い かつ テスト代理店 (billing_exempt) でない
 * chargeShipmentIfDue は冪等 (charged_at ガード + Stripe idempotencyKey) なので二重課金しない。
 * 実課金は STRIPE_CHARGE_LIVE=true のときだけ (それ以外は即 return)。
 */
export interface ChargeSweepResult {
  checked: number
  charged: Array<{ legRef: string; amountYen: number }>
  failed: Array<{ legRef: string; error: string }>
  skipped: Array<{ legRef: string; reason: string }>
}

export async function sweepUnchargedCardShipments(limit = 50): Promise<ChargeSweepResult> {
  const out: ChargeSweepResult = { checked: 0, charged: [], failed: [], skipped: [] }
  if (process.env.STRIPE_CHARGE_LIVE !== "true" || !process.env.STRIPE_SECRET_KEY) return out
  const sb = getSupabase()
  if (!sb) return out
  try {
    const { data: agencies, error: agErr } = await sb
      .from("agencies")
      .select("name")
      .eq("payment_method", "card")
      .or("billing_exempt.is.null,billing_exempt.eq.false")
    if (agErr) throw new Error(agErr.message)
    const names = (agencies ?? []).map((a) => String(a.name))
    if (names.length === 0) return out

    const { data: rows, error } = await sb
      .from("shipments")
      .select("id, booking_id, leg_index")
      .in("status", ["picked_up", "in_transit", "delivered"])
      .in("agency", names)
      .is("charged_at", null)
      .is("charge_error", null)
      .is("cancelled_at", null)
      .or("is_addition.is.null,is_addition.eq.false")
      .order("shipment_date", { ascending: true })
      .limit(limit)
    if (error) throw new Error(error.message)

    for (const r of rows ?? []) {
      const legRef = `${r.booking_id}-L${(r.leg_index as number) + 1}`
      out.checked++
      const res = await chargeShipmentIfDue(r.id as string)
      if (res.charged) out.charged.push({ legRef, amountYen: res.amountYen ?? 0 })
      else if (res.error) out.failed.push({ legRef, error: res.error })
      else out.skipped.push({ legRef, reason: res.reason ?? "unknown" })
    }

    // 対象なのに課金も失敗記録もされずに素通りした区間 = 想定外。必ず人に知らせる。
    const silent = out.skipped.filter((s) => s.reason !== "already_charged")
    if (silent.length > 0) {
      await sendOpsAlert({
        subject: `【要確認】集荷済み・未課金のカード区間が ${silent.length} 件あります`,
        lines: [
          "集荷済み(以降)のカード払い区間で、課金も失敗記録もされなかったものがあります。",
          ...silent.map((s) => `- ${s.legRef}: ${s.reason}`),
          "ダッシュボード: https://bondex.express/operator/dashboard",
        ],
        agencyEmail: null,
      }).catch(() => {})
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[charge] sweepUnchargedCardShipments failed:", msg)
    await sendOpsAlert({
      subject: "【要確認】未課金区間の自動チェックに失敗しました",
      lines: [`理由: ${msg}`, "集荷済み・未課金のカード区間が残っていないか、ダッシュボードの「未課金」で確認してください。"],
      agencyEmail: null,
    }).catch(() => {})
  }
  return out
}
