/**
 * ゲスト向けページの言語。ホテルスタッフ用ページは常に日本語。
 *
 * lib/voucher-pdf.tsx から分離した理由: voucher-pdf.tsx は @react-pdf/renderer の
 * Font.register (フォントファイル読み込み) を含むため、言語コードの正規化だけが
 * 必要な軽量な API ルート (例: app/api/shipandco/create) からそれを import すると
 * 不要な react-pdf 依存が紛れ込む。ここは依存ゼロの純粋ロジックのみを置く。
 */
export type GuestLanguage = "en" | "zh" | "it" | "fr" | "es"

const GUEST_LANGUAGES: readonly GuestLanguage[] = ["en", "zh", "it", "fr", "es"]

/** 未知の値・未指定は "en" にフォールバックする共通ヘルパー。 */
export function normalizeGuestLanguage(value: unknown): GuestLanguage {
  return (GUEST_LANGUAGES as readonly string[]).includes(value as string)
    ? (value as GuestLanguage)
    : "en"
}
