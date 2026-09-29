/**
 * 追跡番号(佐川=お問い合わせ送り状No / ヤマト=伝票No)の入力正規化。
 *
 * BondEx は佐川の送り状を発行せず、世田谷営業所が発番した「問合番号」を後から共有される。
 * 共有はハイフン付き (例: 5000-4465-2693) で来ることがあるため、貼り付けをそのまま受けて
 * 区切り・全角を除き数字のみに正規化して保存する。表示はハイフンなしの数字そのまま
 * (谷口さん指示 2026-09-29)。
 */

/** 全角数字を半角へ寄せて区切り等を除き、数字のみを返す (保存用)。 */
export function normalizeTrackingNo(input: string | null | undefined): string {
  return (input ?? "")
    .toString()
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[^0-9]/g, "")
}
