// 佐川へ送る集荷依頼が、予約 (区間の行 = 正本) と一致しているかを、送る前に機械的に確かめる (2026-11-04 谷口さん方針)。
//   - 予約で確定した配送条件 (集荷日・配達日・個数・時間帯・宛名・番号) と電文が1文字でも違えば送らない
//   - 日程は既存の予約の決まり (lib/b2c/bookability.ts) に合わせて判定する。チェックアウト日・チェックイン日との単純な不一致は異常にしない
//   - 推測で直さない。分からないものは止めるか、運営の明示の確認 (confirmations) を必須にする
// 純粋関数のみ (DB・外部通信なし)。

import { createHash } from "node:crypto"
import type { PickupLegInput } from "@/lib/bizlogi/pickup"
import { BONDEX_SLOT_TO_SHITEI_TIME, type ShippingDetail } from "@/lib/bizlogi/shipping"
import { normalizeManageNumber, toYmd } from "@/lib/bizlogi/text"
import { legRef, type PickupShipmentRow } from "./leg-input"

/** 運営が明示的に確認しないと送れない項目 (送信時に同じ code を acknowledged に含める)。 */
export interface SafetyConfirmation {
  code: string
  message: string
}

const dateOnly = (v: string | null | undefined) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

/**
 * 日程の判定 (予約の中の矛盾)。既存の予約の決まり (lib/b2c/bookability.ts) と同じ考え方:
 *   止める   : 集荷日・配達日が無い / 配達日が集荷日以前 / 集荷日が集荷元ホテルのチェックイン日より前 /
 *              配達日が配送先ホテルのチェックアウト日より後
 *   確認必須 : 配達日が配送先ホテルのチェックイン日より前 (ホテルが事前の受け取りを認めるかは予約の外の情報)
 *   確認必須 : 集荷日が集荷元ホテルのチェックアウト日より後 (旅行者が去った後もホテルが荷物を預かるかは予約の外の情報)
 *   判定しない: 集荷日がチェックアウト日以前 (チェックアウト前日に出す運用がある)・配達日がチェックイン日より後
 */
export function scheduleCheck(row: PickupShipmentRow): { errors: string[]; confirmations: SafetyConfirmation[] } {
  const errors: string[] = []
  const confirmations: SafetyConfirmation[] = []
  const pickup = dateOnly(row.shipment_date)
  const arrival = dateOnly(row.expected_arrival)
  if (!pickup) errors.push("予約に集荷日がありません")
  if (!arrival) errors.push("予約に配達予定日がありません")
  if (!pickup || !arrival) return { errors, confirmations }
  if (arrival <= pickup) {
    errors.push(`予約の配達予定日 (${arrival}) が集荷日 (${pickup}) 以前です。予約を確認して直してください (自動では直しません)`)
  }
  const originIn = dateOnly(row.origin_check_in)
  if (originIn && pickup < originIn) {
    errors.push(`集荷日 (${pickup}) が集荷元ホテルのチェックイン日 (${originIn}) より前です。予約を確認してください`)
  }
  const destOut = dateOnly(row.to_check_out)
  if (destOut && arrival > destOut) {
    errors.push(`配達予定日 (${arrival}) が配送先ホテルのチェックアウト日 (${destOut}) より後です。予約を確認してください`)
  }
  // B2C の区間は予約の控えに集荷元のチェックアウト日がある。無い・壊れていれば送らない (確定は通しても集荷依頼は通さない)
  const b2cOut = dateOnly(row.origin_check_out)
  if (row.channel === "b2c" && (!b2cOut || Number.isNaN(Date.parse(b2cOut)))) {
    errors.push("B2C の予約に集荷元ホテルのチェックアウト日が無い (または正しくない) ため送りません。予約を確認してください")
  }
  const originOut = dateOnly(row.origin_check_out)
  if (originOut && pickup > originOut) {
    confirmations.push({
      code: "pickup_after_origin_checkout",
      message: `集荷日 (${pickup}) が集荷元ホテルのチェックアウト日 (${originOut}・前の区間の予約) より後です。チェックアウト後もホテルが荷物を預かることを確認済みの場合だけ送ってください`,
    })
  }
  const destIn = dateOnly(row.from_check_in) // 列名は from_ だが中身は「配送先ホテルのチェックイン日」(lib/shipments-db.ts)
  if (destIn && arrival < destIn) {
    confirmations.push({
      code: "delivery_before_dest_checkin",
      message: `配達予定日 (${arrival}) が配送先ホテルのチェックイン日 (${destIn}) より前です。ホテルがチェックイン前の荷物を受け取ることを確認済みの場合だけ送ってください`,
    })
  }
  return { errors, confirmations }
}

/**
 * 組み立てた電文が予約と一致しているかを、組み立ての処理とは別に確かめる (二重の検査)。
 * 1つでも違えば送らない。日付は文字列のまま比べる (時差の変換で日付がずれない)。
 */
export function verifyDetailAgainstRow(row: PickupShipmentRow, input: PickupLegInput, detail: ShippingDetail, opts: { guestOverridden: boolean }): string[] {
  const out: string[] = []
  const pickup = toYmd(dateOnly(row.shipment_date) ?? "")
  const arrival = toYmd(dateOnly(row.expected_arrival) ?? "")
  if (!pickup || detail.shippingDate !== pickup) out.push(`発送日 ${detail.shippingDate} が予約の集荷日 ${row.shipment_date} と違います`)
  if (!pickup || detail.shukaIrai?.shukaIraiShiteiDate !== pickup) out.push(`集荷指定日 ${detail.shukaIrai?.shukaIraiShiteiDate ?? "なし"} が予約の集荷日 ${row.shipment_date} と違います`)
  if (!arrival || detail.shiteiDate !== arrival) out.push(`配達指定日 ${detail.shiteiDate ?? "なし"} が予約の配達予定日 ${row.expected_arrival ?? "なし"} と違います`)
  if (detail.haisoKosu !== row.suitcase_count) out.push(`個数 ${detail.haisoKosu} が予約の個数 ${row.suitcase_count ?? "なし"} と違います`)
  if (detail.userManageNumber !== normalizeManageNumber(legRef(row))) out.push(`管理番号 ${detail.userManageNumber} が区間 ${legRef(row)} と対応しません`)
  const slot = row.delivery_time ? BONDEX_SLOT_TO_SHITEI_TIME[row.delivery_time] : undefined
  if ((detail.shiteiTimeCode ?? undefined) !== slot) out.push(`配達時間帯のコード ${detail.shiteiTimeCode ?? "なし"} が予約の時間帯 ${row.delivery_time ?? "なし"} と対応しません`)
  // 宛名・住所: 折り返しで文字が落ちていないか (空白を除いて完全一致)
  const squash = (s: string) => s.replace(/[\s　]+/g, "")
  const party = (label: string, nm: string[], add: string[], src: PickupLegInput["origin"]) => {
    if (squash(nm.join("")) !== squash(`${src.name} 気付 ${input.guestName}様`)) out.push(`${label}の宛名が、組み立て前 (${src.name} 気付 / ${input.guestName}様) と一致しません`)
    if (squash(add.join("")) !== squash(src.address)) out.push(`${label}の住所が、組み立て前 (${src.address}) と一致しません`)
  }
  party("集荷先", detail.irai?.nm ?? [], detail.irai?.add ?? [], input.origin)
  party("お届け先", detail.otodokeNm, detail.otodokeAdd, input.destination)
  // 宛名の旅行者名は、運営の指定が無ければ予約の代表者名 (無ければ予約名) そのもの
  const registeredGuest = (row.representative || row.booking_name || "").trim()
  if (!opts.guestOverridden && input.guestName !== registeredGuest) out.push(`宛名の旅行者名 ${input.guestName} が予約の代表者名 ${registeredGuest || "なし"} と違います`)
  return out
}

/** 電文に影響する予約の項目 (区間の行)。確認画面の後・確保までの間に1つでも変われば送らない。 */
const SOURCE_KEYS = [
  "booking_id", "leg_index", "status", "carrier", "shipment_date", "expected_arrival", "delivery_time", "representative",
  "booking_name", "tour_number", "suitcase_count", "booking_type", "from_hotel", "from_hotel_ja", "from_place_id",
  "from_residence", "to_hotel", "to_hotel_ja", "to_place_id", "to_residence", "tracking_numbers", "origin_check_in",
  "from_check_in", "to_check_out",
] as const

function stable(v: unknown): string {
  if (v === undefined || v === null) return "null"
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`
  }
  return JSON.stringify(v)
}

/** 予約の項目の指紋 (キー順・undefined/null の違いに左右されない)。 */
export function sourceFingerprint(row: PickupShipmentRow): string {
  const r = row as unknown as Record<string, unknown>
  return createHash("sha256").update(SOURCE_KEYS.map((k) => `${k}=${stable(r[k])}`).join("\n")).digest("hex").slice(0, 32)
}

/** 2つの行で違う予約の項目 (日本語なしのキー名)。 */
export function sourceChanges(a: PickupShipmentRow, b: PickupShipmentRow): string[] {
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  return SOURCE_KEYS.filter((k) => stable(ra[k]) !== stable(rb[k]))
}
