/**
 * 社内(運用)向けメールの宛先。
 *
 * ALERT_EMAIL(= 谷口さん個人宛・任意) と support@bondex.express(共有の運用受信箱) の両方へ届ける。
 * 以前は `ALERT_EMAIL || support@` の単一宛先だったため、ALERT_EMAIL を設定すると support@ に
 * 届かず、新着予約通知などが谷口さんのみに来ていた。両方へ送るよう統一する(重複は除去)。
 */
export const BONDEX_SUPPORT_EMAIL = "support@bondex.express"

/** 運用通知メールの宛先一覧 ([ALERT_EMAIL, support@] の重複なし・空は除外)。 */
export function opsRecipients(): string[] {
  const list = [process.env.ALERT_EMAIL, BONDEX_SUPPORT_EMAIL]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
  return Array.from(new Set(list))
}
