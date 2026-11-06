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
import {
  chargeCountHoldEnabled,
  chargeHoldDisposition,
  markChargeOperatorReview,
  claimChargeRight,
  beginChargeAttempt,
  revalidateChargeClaim,
  settleChargeAttempt,
  classifyStripeError,
} from "@/lib/charge-hold"

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

    // amount_yen は税抜小計 (個数 × 単価)。実際の課金額は下で代理店の国内/海外区分に応じて決める。
    const netYen = shipment.amount_yen ?? 0
    if (!Number.isFinite(netYen) || netYen <= 0) {
      return { charged: false, skipped: true, reason: "no_amount" }
    }

    const sb = getSupabase()
    if (!sb) return { charged: false, skipped: true, reason: "db_unset" }

    // 代理店の決済情報を引く
    const { data: agency } = await sb
      .from("agencies")
      .select("id, name, contact_email, payment_method, card_on_file, stripe_customer_id, billing_exempt, locale, is_domestic")
      .eq("name", shipment.agency)
      .maybeSingle()

    if (!agency) return { charged: false, skipped: true, reason: "agency_not_found" }

    // 実際に課金する額。国内・海外を問わず消費税を上乗せ (税込)。
    // 海外の旅行会社向けでも国内配送の手配は輸出免税にならず 10% 課税 (2026-10-05 税理士確認)。
    const amountYen = grossOf(netYen)

    // テスト代理店 (billing_exempt) は、どんなに配送手配しても一切課金しない (谷口さん指示)。
    // カード登録は可能だが、集荷完了しても課金処理をスキップする。
    if (agency.billing_exempt) {
      return { charged: false, skipped: true, reason: "billing_exempt" }
    }

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

    // P1-B2 課金保留 (既定 OFF)。ON のときだけ、Stripe 送信の直前に原子的な課金権を取得する。
    // 実個数確認前の大口/重複 (held) は claimed=false で課金に進まない。保留判定は RPC 内で
    // 集荷単位を "その場" 再集計するため、直前に別予約が足されて 20個 以上になっても取りこぼさない。
    // さらに begin_charge_attempt で試行を in_flight にし、前回が結果不明 (reconciliation_required) /
    // 送信中なら送らない = Stripe 冪等キーに加えて DB 側でも二重課金を止める。
    //
    // v3.4 段階導入: Global Flag ON でも、適用判定 (disposition) が legacy の leg は従来どおり即課金する
    // (対象外代理店=従来動作)。混在集荷単位 (operator_review) は自動課金せず Operator 確認へ回す (scheme C)。
    let claimOwner: string | null = null
    if (chargeCountHoldEnabled()) {
      const disposition = await chargeHoldDisposition(sb, shipmentId)
      if (disposition === "operator_review") {
        await markChargeOperatorReview(sb, shipmentId)
        return { charged: false, skipped: true, reason: "hold:operator_review" }
      }
      if (disposition === "hold") {
        claimOwner = `charge_${globalThis.crypto.randomUUID()}`
        const claim = await claimChargeRight(sb, shipmentId, claimOwner)
        if (!claim.claimed) {
          return { charged: false, skipped: true, reason: `hold:${claim.reason}` }
        }
        const began = await beginChargeAttempt(sb, shipmentId, claimOwner, `charge_${shipmentId}`)
        if (!began.ok) {
          // 前回の試行が未確定 (in_flight/reconciliation_required) か既課金。新規送信しない。
          return { charged: false, skipped: true, reason: `attempt:${began.reason}` }
        }
        // v3.2 §2: Stripe 送信の直前に集荷単位を再評価 (claim→送信の窓)。claim 後に別予約が足されて
        // 単位が大口化していたら送信を中止する (DB 側で held へ戻し課金権/試行を解放済み)。
        const reval = await revalidateChargeClaim(sb, shipmentId, claimOwner)
        if (!reval.ok) {
          if (!reval.reason.startsWith("unit_changed_hold")) {
            // hold 以外の無効化 (lease切れ/owner不一致等) は in_flight を failed で掃除し再試行可に。
            await settleChargeAttempt(sb, shipmentId, claimOwner, "failed", null, "revalidate", reval.reason)
          }
          return { charged: false, skipped: true, reason: `revalidate:${reval.reason}` }
        }
      }
      // disposition === "legacy": 対象外=従来動作。claimOwner は null のまま、通常課金へ進む。
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
        // 課金成立を試行台帳にも記録 (claim を保持したまま succeeded に)。charged_at は recordShipmentCharge が CAS。
        if (chargeCountHoldEnabled() && claimOwner) {
          await settleChargeAttempt(sb, shipmentId, claimOwner, "succeeded", pi.id, pi.status)
        }
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
      if (chargeCountHoldEnabled() && claimOwner) {
        // 既知の未成立ステータスは failed (再試行可)。processing 等の不確定は照合へ回す。
        const terminalFail = ["requires_action", "requires_payment_method", "canceled"].includes(pi.status)
        await settleChargeAttempt(
          sb, shipmentId, claimOwner,
          terminalFail ? "failed" : "reconciliation_required",
          pi.id, pi.status,
        )
      }
      await notifyChargeFailure(shipment.booking_id, shipment.leg_index, agency.name, amountYen, msg, agency.contact_email)
      return { charged: false, error: msg, paymentIntentId: pi.id }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stripe charge failed"
      // フラグ ON: 通信タイムアウト/Stripe障害 (結果不明) と、明確な失敗 (カード拒否等) を区別する。
      if (chargeCountHoldEnabled() && claimOwner) {
        const kind = classifyStripeError(err)
        const etype = (err as { type?: string } | null)?.type ?? null
        if (kind === "unknown") {
          // 結果不明: 課金された可能性がある。claim/試行を保持し、照合まで新規課金を禁止 (reconciliation_required)。
          await recordShipmentChargeError(shipmentId, `結果不明(要Stripe照合): ${msg}`)
          await settleChargeAttempt(sb, shipmentId, claimOwner, "reconciliation_required", null, etype, msg)
          await notifyChargeUnknown(shipment.booking_id, shipment.leg_index, agency.name, amountYen, msg)
          return { charged: false, error: msg, reason: "reconciliation_required" }
        }
        // 明確な失敗: 課金は成立していない。claim を解放し再試行可。
        await recordShipmentChargeError(shipmentId, msg)
        await settleChargeAttempt(sb, shipmentId, claimOwner, "failed", null, etype, msg)
        await notifyChargeFailure(shipment.booking_id, shipment.leg_index, agency.name, amountYen, msg, agency.contact_email)
        return { charged: false, error: msg }
      }
      // フラグ OFF: 従来どおり (挙動不変)。
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
 * Stripe の結果が不明 (通信タイムアウト/Stripe障害) のときのアラート。
 * 「失敗」と断定せず、二重課金の恐れがあるため Stripe ダッシュボードで実際の課金有無を照合するよう促す。
 * 照合して成立していれば reconcile_charge_attempt('succeeded') で charged_at を確定、
 * 未成立なら reconcile_charge_attempt('failed') で解放する。
 */
async function notifyChargeUnknown(
  bookingId: string,
  legIndex: number,
  agencyName: string,
  amountYen: number,
  reason: string,
): Promise<void> {
  await sendOpsAlert({
    subject: `【要Stripe照合・結果不明】${bookingId}-L${legIndex + 1} (${agencyName})`,
    lines: [
      `予約: ${bookingId}-L${legIndex + 1} / 代理店: ${agencyName}`,
      `金額: ¥${amountYen.toLocaleString()}`,
      `理由: ${reason}`,
      "⚠️ 通信タイムアウト等で Stripe の課金成否が不明です。課金された可能性があるため、",
      "   この区間は照合が済むまで自動で再課金しません (reconciliation_required)。",
      `→ Stripe ダッシュボードで PaymentIntent (冪等キー charge_${bookingId}… / 直近の該当顧客) を確認し、`,
      "   成立していれば「成立として照合」、未成立なら「未成立として解放」の操作をしてください。",
    ],
    agencyEmail: null,
  })
}
