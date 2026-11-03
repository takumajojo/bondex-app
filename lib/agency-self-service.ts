/**
 * 代理店セルフサービス (日程・個数・代表者名の変更、区間の取り消し) の可否判定。
 *
 * 2026-09-24 運用変更 (送り状は佐川が作成) により、依頼直後から status="issued" (手配済) になる。
 * 従来の「requested / pending のみ変更可」のままだと全予約がロックされてしまうため、
 * ロック条件を「送り状 (Ship&co ラベル) が実在する / 追跡番号が入っている / 集荷済み以降」に改める。
 *
 * 締切: 集荷前日 18:30 (JST) (2026-11-04 谷口さん決定・lib/pickup-cutoff.ts)。ホテル変更も同じ時刻。
 * 締切を過ぎた変更と、佐川へ集荷依頼済みの区間の変更は、直接変えずに変更申請として受け付ける
 * (sql/068 の shipment_change_requests・佐川の確認後に反映)。
 *
 * サーバ (API) とクライアント (ポータル) の両方から使う純粋関数のみ。
 */

import { isPastPickupCutoff, pickupCutoffAt } from "./pickup-cutoff"

const EDITABLE_STATUSES = new Set(["requested", "pending", "issued"])

export interface LockInput {
  status: string | null | undefined
  label_url?: string | null
  tracking_numbers?: string[] | null
  /** 運営が佐川へ集荷依頼済みと記録した時刻 (手動 Excel・Biz-Logi とも)。ホテル変更の判定だけで使う。 */
  pickup_requested_at?: string | null
}

/** 代理店がこの区間を自分で変更できないなら true。 */
export function legLockedForAgency(s: LockInput): boolean {
  if (!EDITABLE_STATUSES.has(s.status || "")) return true
  if (s.label_url) return true
  if ((s.tracking_numbers?.length ?? 0) > 0) return true
  return false
}

/**
 * 代理店のホテル変更の扱い (画面と API で同じ判定)。2026-11-04 段階C:
 *   "locked"  … 集荷済み以降・送り状あり・集荷依頼の記録の無い番号あり (従来の手配済み。BondEx へ連絡)
 *   "request" … 佐川へ集荷依頼済み、または締切 (集荷前日 18:30) 後 → 直接は変えず変更申請として受け付ける
 *   null      … 直接変更できる
 */
export type AgencyHotelChangeLock = "request" | "locked" | null

export function agencyHotelChangeLock(s: LockInput & { shipment_date?: string | null }, now: Date = new Date()): AgencyHotelChangeLock {
  if (!EDITABLE_STATUSES.has(s.status || "")) return "locked"
  if (s.pickup_requested_at) return "request"
  if (legLockedForAgency(s)) return "locked"
  if (isPastPickupCutoff(s.shipment_date, now)) return "request"
  return null
}

/**
 * 代理店の変更 (日程・個数・代表者名・取消・ホテル) の扱い。画面の表示用 (API は DB の集荷依頼の記録で同じ判定をする)。
 *   "locked"  … 集荷済み以降・送り状あり・集荷依頼の記録の無い番号あり (BondEx へ連絡)
 *   "request" … 佐川へ集荷依頼済み → 変更申請 (取消も申請)
 *   "direct"  … 直接変更 (ただし締切 (集荷前日 18:30) 後の日程・個数・代表者名・ホテルは申請になる)
 */
export function agencyChangeMode(s: LockInput): "locked" | "request" | "direct" {
  if (!EDITABLE_STATUSES.has(s.status || "")) return "locked"
  if (s.label_url) return "locked"
  if (s.pickup_requested_at) return "request"
  if ((s.tracking_numbers?.length ?? 0) > 0) return "locked"
  return "direct"
}

/** 変更申請として受け付けたときの案内 (代理店向け・画面と API で共通)。 */
export const CHANGE_REQUEST_ACCEPTED_MESSAGE = {
  ja: "変更申請として受け付けました。佐川への確認が取れた後に予約へ反映し、ご連絡します。それまでは現在の手配内容のままです。",
  en: "We've received your change request. We'll update the booking and let you know once the courier confirms. Until then, the current arrangement stays in place.",
} as const

/** 締切後・依頼済みの区間で変更するときの事前の案内 (画面)。 */
export const CHANGE_REQUEST_NOTICE = {
  ja: "集荷前日18:30を過ぎているか、佐川へ集荷手配済みのため、変更は申請として受け付けます。BondEx が確認した後に反映されます。",
  en: "It's past 18:30 JST the day before pickup, or pickup is already arranged, so this will be sent as a change request. It takes effect after BondEx confirms it.",
} as const

/** 修正締切 = 集荷前日 18:30 JST (lib/pickup-cutoff.ts・2026-11-04 谷口さん決定)。ISO(UTC) で返す。 */
export function selfServiceCutoffAt(shipmentDate: string | null | undefined): string | null {
  return pickupCutoffAt(shipmentDate)
}

/** 修正締切 (集荷前日 18:30 JST) を過ぎているか (18:30:00 以降)。発送日不明なら false (既存ゲートに委ねる)。 */
export function isSelfServiceCutoffPassed(
  shipmentDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return isPastPickupCutoff(shipmentDate, now)
}

/** 代表者名の正規化と検証。空・長すぎ (80文字超) は null。 */
export function normalizeRepresentative(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const v = raw.replace(/\s+/g, " ").trim()
  if (!v || v.length > 80) return null
  return v
}
