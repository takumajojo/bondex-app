/**
 * B2C の安全スイッチ（Phase 1A）。docs/b2c/B2C_MVP_SCHEMA_v1.md 8章。
 *
 * どれも値が "true" のときだけ ON（タイプミスや未設定は OFF に倒す）。どれも B2B を止めない。
 * 新規受付・既存予約の閲覧と取消・請求の実行・自動の集荷確認を別々に止められる。
 */

function on(name: string): boolean {
  return process.env[name] === "true"
}

/** 新しい予約の受付（入口・予約・カード登録）。OFF でも既存の予約の閲覧・取消・確定の処理は動く。 */
export function b2cBookingEnabled(): boolean {
  return on("B2C_BOOKING_ENABLED")
}

/** 既存の予約の確認ページ（My Booking）と取消。緊急時だけ OFF にする。 */
export function b2cMyBookingEnabled(): boolean {
  return on("B2C_MY_BOOKING_ENABLED")
}

/** 集荷確認後の実際の請求。OFF の間は請求を予定のまま残し、ON に戻した時に照合してから 1回ずつ処理する。 */
export function b2cChargeLive(): boolean {
  return on("B2C_CHARGE_LIVE")
}

/** 追跡による自動の集荷確認。Phase 1A は OFF（運営の手作業だけ）。 */
export function b2cPickupAutomationEnabled(): boolean {
  return on("B2C_PICKUP_AUTOMATION_ENABLED")
}

/**
 * 直前予約（通常のホテル連絡の期限を過ぎた予約）の受付。既定は OFF。
 * 佐川が「新規の集荷の依頼を前日 18:30 まで受ける」ことを確認できるまで ON にしない（16.21）。
 * ON でも、その集荷日に至急の対応の担当者がいなければ受けない（lib/b2c/hotel-gate.ts の lateDutyStaffed）。
 */
export function b2cLateBookingEnabled(): boolean {
  return on("B2C_LATE_BOOKING_ENABLED")
}

/**
 * 旅行者向けの規約のページ（/legal/traveler/…）の表示。既定は OFF（ページは 404）。
 * 弁護士の確認・規約の確定・公開の承認（docs/b2c/legal/05_pre_publication_checklist.md）までは、ローカルのレビューでだけ ON にする。
 */
export function b2cLegalPagesEnabled(): boolean {
  return on("B2C_LEGAL_PAGES_ENABLED")
}
