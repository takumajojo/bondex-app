/**
 * B2C の安全スイッチ（MVP・T0）。docs/b2c/B2C_PLATFORM_AUDIT_v1.md 16.4。
 *
 * どちらも既定は OFF。値が "true" のときだけ ON（タイプミスや未設定は OFF に倒す）。
 * OFF の間、B2C の予約 API・画面は閉じ、既存 B2B の動きは今と同じ。
 */

/** B2C の予約の受付（予約画面・予約 API・カード登録）。 */
export function b2cEnabled(): boolean {
  return process.env.B2C_ENABLED === "true"
}

/** 集荷確認後の実課金（売上の確定）。OFF の間は課金の予定を記録するだけ。 */
export function b2cChargeLive(): boolean {
  return process.env.B2C_CHARGE_LIVE === "true"
}
