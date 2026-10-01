// BondEx 公開トラッキング画面のURL（予約番号単位）。
//
// バウチャーの「追跡QRコード」と、代理店向けステータス通知メールの
// 「配送状況を確認」リンクを “必ず同一URL” にするための単一ソース。
// 追跡先を変える時はここだけを直せば、QR とメールの両方が同時に追従する。
export const BONDEX_SITE_URL = "https://bondex.express"

/** 予約番号から BondEx 追跡画面の絶対URLを組み立てる（QR・メール共通）。 */
export function bondexTrackUrl(bookingId: string): string {
  return `${BONDEX_SITE_URL}/track/${encodeURIComponent(bookingId)}`
}
