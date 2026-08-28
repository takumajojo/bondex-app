/**
 * 送り状(紙の伝票)の郵送先・差出人。
 *
 * BondEx が発行した佐川の送り状は、旅行者がホテルで荷物に貼れるよう事前に紙で届ける
 * 必要がある。従来この郵送は口頭合意で、システム上どこにも記録がなかった。
 * ここでは依頼時に選ばれた「どこへ送るか」「誰の名義で送るか」を型として扱い、
 * 運営が実際に封筒を用意するときの宛名・差出人を算出する。
 *
 * 住所は lib/residence.ts の ResidenceAddress を流用する。佐川は郵便番号と住所の
 * 一致を厳格に見るため、自由入力1行ではなく構造化して持つ必要があるため。
 */
import {
  type ResidenceAddress,
  type ResidenceField,
  EMPTY_RESIDENCE,
  cleanResidence,
  residenceError,
  RESIDENCE_FIELD_LABELS_JA,
} from "./residence"

/**
 * 差出人の住所フィールドの言語別ラベル。
 * residence.ts 側に英語ラベルを置かないのは、この機能だけで完結させるため
 * (共有の作業ツリーで他の作業と競合しないよう、依存を増やさない)。
 */
const SENDER_FIELD_LABELS_EN: Record<ResidenceField, string> = {
  name: "name on the envelope",
  phone: "phone number",
  zip: "postal code (7 digits)",
  prefecture: "prefecture",
  city: "city / ward",
  street: "street address",
}

/** 差出人住所の不足フィールドを、代理店の言語でラベル化する。 */
export function senderFieldLabel(field: ResidenceField, locale: "ja" | "en"): string {
  return locale === "en" ? SENDER_FIELD_LABELS_EN[field] : RESIDENCE_FIELD_LABELS_JA[field]
}

/** 郵送先。agency=代理店(御社)宛 / hotel=ホテル宛(旅行者様気付)。 */
export type LabelTo = "agency" | "hotel"
export const LABEL_TO_VALUES: readonly LabelTo[] = ["agency", "hotel"] as const

/**
 * 差出人 = 封筒に載る名前。
 * 業種のカテゴリー(ランドオペレーター/旅行代理店)は問わない。どの名前で送るかだけが重要
 * (谷口さん 2026-08-28)。
 * - bondex : BondEx（株式会社JOJO）名義 (既定)
 * - agency : 御社名義。代理店マスタの ship_address を使う (未登録なら選べない)
 * - other  : 他社名義。依頼ごとに名称と住所を入力する
 */
export type LabelSender = "bondex" | "agency" | "other"
export const LABEL_SENDER_VALUES: readonly LabelSender[] = ["bondex", "agency", "other"] as const

export type LabelDelivery = {
  to: LabelTo
  /** hotel かつ複数区間のとき true = 区間ごとに各発送元ホテルへ分送 / false = 最初のホテルへ一括 */
  split: boolean
  sender: LabelSender
  /** other の手入力値。agency では発送時点のスナップショットを入れる。 */
  senderInfo: ResidenceAddress | null
}

export const DEFAULT_LABEL_DELIVERY: LabelDelivery = {
  to: "agency",
  split: false,
  sender: "bondex",
  senderInfo: null,
}

function asLabelTo(v: unknown): LabelTo {
  return LABEL_TO_VALUES.includes(v as LabelTo) ? (v as LabelTo) : "agency"
}

function asLabelSender(v: unknown): LabelSender {
  return LABEL_SENDER_VALUES.includes(v as LabelSender) ? (v as LabelSender) : "bondex"
}

/** 任意の入力(フォーム/API/DB行)を LabelDelivery に正規化する。 */
export function cleanLabelDelivery(raw: unknown): LabelDelivery {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LABEL_DELIVERY }
  const o = raw as Record<string, unknown>
  const to = asLabelTo(o.to ?? o.label_to)
  const sender = asLabelSender(o.sender ?? o.label_sender)
  return {
    to,
    // 分送は「ホテル宛」のときだけ意味を持つ。代理店宛なら常に1箇所。
    split: to === "hotel" && Boolean(o.split ?? o.label_split),
    sender,
    senderInfo: cleanResidence(o.senderInfo ?? o.label_sender_info),
  }
}

/**
 * 入力の不足を返す。問題なければ null。
 * - 差出人が other のときだけ住所一式が必須 (封筒に差出人として刷るため)
 * - agency は代理店マスタの ship_address を使うので、ここでは検証しない
 *   (登録されているかは画面側で判定して選択不可にする)
 */
export function labelDeliveryError(
  d: LabelDelivery,
): { field: "senderInfo"; missing: ReturnType<typeof residenceError> } | null {
  if (d.sender !== "other") return null
  const missing = residenceError(d.senderInfo ?? EMPTY_RESIDENCE)
  return missing ? { field: "senderInfo", missing } : null
}

/** 郵送1通ぶんの宛先。運営が封筒を用意するときの単位。 */
export type LabelParcel = {
  /** 宛先の種類 */
  kind: LabelTo
  /** 宛名 (代理店名 または 「ホテル名 気付 旅行者名 様」) */
  addressee: string
  /** 補足 (ホテル宛のときは対象区間、代理店宛のときは通数の内訳) */
  detail: string
  /** この封筒に入れる送り状の対象区間 (0始まり) */
  legIndexes: number[]
}

export type LabelLeg = {
  legIndex: number
  fromHotel: string
  shipmentDate: string
  suitcaseCount: number
}

/**
 * 「実際に何通、どこへ送るか」を算出する。
 * - 代理店宛      : 常に1通 (全区間ぶんをまとめて代理店へ)
 * - ホテル宛・一括: 1通 (最初の区間の発送元ホテルへ全区間ぶん)
 * - ホテル宛・分送: 区間の数だけ (各区間の発送元ホテルへ、その区間ぶん)
 */
export function resolveLabelParcels(
  d: LabelDelivery,
  legs: LabelLeg[],
  ctx: { agencyName: string; travelerName: string },
): LabelParcel[] {
  const all = legs.map((l) => l.legIndex)
  if (legs.length === 0) return []

  if (d.to === "agency") {
    return [
      {
        kind: "agency",
        addressee: ctx.agencyName,
        detail: `全${legs.length}区間ぶん`,
        legIndexes: all,
      },
    ]
  }

  if (!d.split || legs.length === 1) {
    const first = legs[0]
    return [
      {
        kind: "hotel",
        addressee: `${first.fromHotel} 気付　${ctx.travelerName} 様`,
        detail: legs.length > 1 ? `全${legs.length}区間ぶんをまとめて` : "1区間ぶん",
        legIndexes: all,
      },
    ]
  }

  return legs.map((l) => ({
    kind: "hotel" as const,
    addressee: `${l.fromHotel} 気付　${ctx.travelerName} 様`,
    detail: `LEG ${l.legIndex + 1} ぶん（${l.shipmentDate} 発送）`,
    legIndexes: [l.legIndex],
  }))
}

/** 画面表示用の短いラベル。 */
export const LABEL_TO_LABEL_JA: Record<LabelTo, string> = {
  agency: "代理店（御社）宛",
  hotel: "ホテル宛（旅行者様気付）",
}
export const LABEL_TO_LABEL_EN: Record<LabelTo, string> = {
  agency: "To your office",
  hotel: "To the hotel (c/o traveler)",
}
export const LABEL_SENDER_LABEL_JA: Record<LabelSender, string> = {
  bondex: "BondEx（株式会社JOJO）",
  agency: "御社名義",
  other: "他社名義",
}
export const LABEL_SENDER_LABEL_EN: Record<LabelSender, string> = {
  bondex: "BondEx (JOJO Inc.)",
  agency: "Your company",
  other: "Another company",
}

// ---------------------------------------------------------------------------
// 郵送アラート — 「送り状を送る」作業を落とさないための期限判定
// ---------------------------------------------------------------------------

import { businessDaysBefore, businessDaysBetween, toYmd } from "./business-days"

/** 発送日の何営業日前までに投函するか。届かなければ旅行者が荷物を出せない。 */
export const LABEL_MAIL_LEAD_BUSINESS_DAYS = 5

export type LabelMailUrgency =
  /** まだ期限まで余裕がある */
  | "ok"
  /** 5営業日前に到達。今日から準備して送る */
  | "due"
  /** 5営業日を切っている(直前予約含む)。早急手配 */
  | "urgent"
  /** 発送日を過ぎている。もう間に合わない */
  | "overdue"
  /** 郵送済み */
  | "sent"

export type LabelMailStatus = {
  urgency: LabelMailUrgency
  /** 投函の期限 (YYYY-MM-DD)。発送日の5営業日前。 */
  deadline: string | null
  /** 期限まであと何営業日か。負なら超過。 */
  businessDaysLeft: number | null
}

/**
 * 送り状をいつまでに投函すべきかを判定する。
 *
 * 期限 = 発送日の 5 営業日前。
 *  - 期限より前          → ok
 *  - 期限当日            → due   (今日送る)
 *  - 期限を過ぎ発送日前   → urgent(直前予約。早急手配)
 *  - 発送日を過ぎている   → overdue
 *  - label_sent_at あり  → sent
 *
 * today は呼び出し側から渡す (サーバー/クライアントで時刻源を揃えるため)。
 */
export function labelMailStatus(input: {
  shipmentDate: string | null
  sentAt: string | null
  today: string
}): LabelMailStatus {
  if (input.sentAt) return { urgency: "sent", deadline: null, businessDaysLeft: null }
  const ship = (input.shipmentDate || "").trim()
  if (!ship) return { urgency: "ok", deadline: null, businessDaysLeft: null }

  const deadline = businessDaysBefore(ship, LABEL_MAIL_LEAD_BUSINESS_DAYS)
  if (!deadline) return { urgency: "ok", deadline: null, businessDaysLeft: null }

  const left = businessDaysBetween(input.today, deadline)
  // 発送日そのものを過ぎていたら手遅れ (暦日で比較する)
  if (input.today > ship) {
    return { urgency: "overdue", deadline, businessDaysLeft: left }
  }
  if (left === null) return { urgency: "ok", deadline, businessDaysLeft: null }
  if (left > 0) return { urgency: "ok", deadline, businessDaysLeft: left }
  if (left === 0) return { urgency: "due", deadline, businessDaysLeft: 0 }
  return { urgency: "urgent", deadline, businessDaysLeft: left }
}

/** 今日 (JST) を YYYY-MM-DD で返す。サーバーが UTC でも日本時間で判定するため。 */
export function todayJst(now: Date = new Date()): string {
  return toYmd(new Date(now.getTime() + 9 * 60 * 60 * 1000))
}

/**
 * 送り状の郵送アラートを出すべきステータスか。
 * 集荷済み以降 (picked_up / in_transit / delivered) は送り状が既に役目を果たしているので
 * 対象外。キャンセルも当然対象外。
 * 「郵送済みにする」を押し忘れた過去分で毎朝鳴り続けるのを防ぐ。
 */
export function labelMailApplies(status: string | null | undefined): boolean {
  return status === "requested" || status === "pending" || status === "issued" || status === "failed"
}

export const LABEL_URGENCY_LABEL_JA: Record<LabelMailUrgency, string> = {
  ok: "余裕あり",
  due: "本日投函",
  urgent: "早急手配",
  overdue: "期限超過",
  sent: "郵送済み",
}
