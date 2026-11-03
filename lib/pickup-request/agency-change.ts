// 代理店の変更を「直接変更」と「変更申請」に振り分ける (2026-11-04 谷口さん承認・段階C)。
//   直接変更 … 佐川へ集荷依頼していない区間で、締切 (集荷前日 18:30 JST) の前
//   変更申請 … 佐川へ集荷依頼済みの区間 (佐川への確認が要る) / 締切の後 (Operator の個別対応)
// 申請は shipment_change_requests (sql/068) に積み、正式な予約情報は佐川・BondEx の確認後に反映する。
// 依頼の確保と変更が同時に起きても、DB のトリガーが依頼中の区間の書き換えを止める (直接変更が負けたら申請に回す)。

import type { SupabaseClient } from "@supabase/supabase-js"
import { createPickupChange, type ChangeKind } from "./change"
import { isPickupTableMissing } from "./store"

export interface LiveRequest {
  id: string
  state: string
}

/** 区間の有効な集荷依頼 (送信中・受付済み・結果不明・要確認・変更対応中)。sql/067 未適用の環境では null。 */
export async function liveRequestFor(sb: SupabaseClient, shipmentId: string): Promise<LiveRequest | null> {
  const { data, error } = await sb
    .from("pickup_requests")
    .select("id, state")
    .eq("shipment_id", shipmentId)
    .in("state", ["sending", "accepted", "unknown", "needs_review", "change_pending"])
    .limit(1)
  if (error) {
    if (isPickupTableMissing(error.message)) return null
    throw new Error(`集荷依頼の記録を読めません: ${error.message}`)
  }
  const row = (data ?? [])[0] as LiveRequest | undefined
  return row ?? null
}

/** DB のトリガーが依頼中の区間の書き換えを止めたか (sql/068)。 */
export function isPickupLockError(message: string | null | undefined): boolean {
  return /pickup_request_live|pickup_lock_field|pickup_lock_cancelled_number/.test(message ?? "")
}

const AGENCY_REASON: Record<string, { ja: string; en: string }> = {
  open_change_exists: {
    ja: "この区間には処理中の変更申請があります。結果のご連絡をお待ちいただくか、BondEx へご連絡ください。",
    en: "There is already a change request in progress for this leg. Please wait for our reply or contact BondEx.",
  },
  request_sending: {
    ja: "ただいま佐川へ集荷を手配している最中です。数分おいてから、もう一度お試しください。",
    en: "We're arranging the pickup with the courier right now. Please try again in a few minutes.",
  },
  picked_up_or_later: {
    ja: "集荷済みのため、こちらから変更できません。BondEx へご連絡ください。",
    en: "This leg has already been picked up, so it can't be changed here. Please contact BondEx.",
  },
  shipment_cancelled: { ja: "取り消し済みの区間です。", en: "This leg has been cancelled." },
}
const AGENCY_REASON_DEFAULT = {
  ja: "佐川への集荷手配を確認しているため、いま変更申請を受け付けられません。BondEx へご連絡ください。",
  en: "We're checking the pickup arrangement with the courier, so we can't take a change request right now. Please contact BondEx.",
}

/** 代理店からの変更申請。結果の文言は代理店の言語で返す。 */
export async function submitAgencyChange(i: {
  shipmentId: string
  kind: ChangeKind
  fields: Record<string, unknown>
  reason: string
  agencyName: string
  actor: string
  en: boolean
}): Promise<{ ok: true; changeId: string } | { ok: false; status: number; message: string; code: string }> {
  const r = await createPickupChange({
    shipmentId: i.shipmentId,
    kind: i.kind,
    fields: i.fields,
    reason: i.reason,
    source: "agency",
    requester: i.agencyName,
    actor: i.actor,
    rawReason: true,
  })
  if (r.ok) return r
  const msg = AGENCY_REASON[r.reason] ?? (r.reason.startsWith("request_") ? AGENCY_REASON_DEFAULT : null)
  if (msg) return { ok: false, status: 409, code: r.reason.toUpperCase(), message: i.en ? msg.en : msg.ja }
  return { ok: false, status: 400, code: "INVALID", message: i.en ? "The change couldn't be accepted. Please check the input." : `変更を受け付けられませんでした (${r.reason})` }
}

const LOCK_FIELD_JA: Record<string, string> = {
  shipment_date: "集荷日", expected_arrival: "お届け日", delivery_time: "配達時間帯", suitcase_count: "個数",
  from_hotel: "発送元ホテル", from_hotel_ja: "発送元ホテル", from_place_id: "発送元ホテル", from_city: "発送元ホテル",
  from_prefecture: "発送元ホテル", from_residence: "発送元の住所", to_hotel: "到着ホテル", to_hotel_ja: "到着ホテル",
  to_place_id: "到着ホテル", to_city: "到着ホテル", to_prefecture: "到着ホテル", to_residence: "到着先の住所",
  representative: "代表者名", recipient: "受取人", cancel: "取消",
}

/** 運営の操作が DB に止められたときの案内 (生の DB エラーではなく、変更申請へ誘導する)。 */
export function operatorLockBody(dbMessage: string | null | undefined): { error: string; code: string; message: string } {
  const m = /項目: ([^)]*)\)/.exec(dbMessage ?? "")
  const fields = m ? [...new Set(m[1].split(",").map((x) => LOCK_FIELD_JA[x.trim()] ?? x.trim()))].join("・") : ""
  const cancelled = /pickup_lock_cancelled_number/.test(dbMessage ?? "")
  const message = cancelled
      ? "取消済みの区間には問い合わせ番号を保存できません。"
      : `佐川へ集荷依頼済みの区間のため、直接は変更できません。予約詳細の「佐川への集荷依頼」で変更申請を登録し、世田谷へ連絡して佐川の回答を記録してから反映してください。${fields ? `（変更しようとした項目: ${fields}）` : ""}`
  // 画面は error か message を表示するので、どちらにも案内文を入れる (code で判定できるようにする)
  return { error: message, code: "PICKUP_REQUEST_LIVE", message }
}
