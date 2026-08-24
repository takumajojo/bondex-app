// 代理店・バウチャー共通の問い合わせ導線。
// LINE 公式アカウントは公開リンク(番号ではない)なので定数で持つ。
// WhatsApp はビジネスアカウントの wa.me リンクを NEXT_PUBLIC 環境変数で持ち、
// 未設定なら UI 側で非表示にする(個人番号を勝手に載せない方針)。
export const LINE_URL = "https://line.me/R/ti/p/@564owvcv"
export const WHATSAPP_URL = process.env.NEXT_PUBLIC_BONDEX_WHATSAPP_URL || ""
export const SUPPORT_EMAIL = "support@bondex.express"
