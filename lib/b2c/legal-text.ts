/**
 * B2C（旅行者向け）の規約の版と、同意の文言（B1・D5・G7）。docs/b2c/legal/01_business_conditions.md。
 *
 * - 予約の時に同意した規約を後から完全に再現できるようにする。予約（b2c_orders）には版の名前と言語と日時を残し、
 *   本文は版ごとに b2c_legal_documents（sql/079・追記だけ）に残す。本文の正本は docs/b2c/legal/<kind>_<lang>.md。
 * - 同意の欄の文言（予約の画面・カード登録の画面）も本文として版に含める（何に同意したかを文言まで再現する）。
 * - 版の名前は公開の時に変える（例 2027-01-v1）。下書きの版（-draft）のまま公開しない（05_pre_publication_checklist.md）。
 * - 公開した版の本文は書き換えない。変えるときは新しい版を足す（過去の予約は予約の時の版のまま）。
 * このファイルは画面（クライアント）からも読むので、Node の機能を使わない。本文の読み込み・ハッシュは lib/b2c/legal.ts。
 */
/** 利用規約・キャンセル規定・特商法の表記・プライバシーポリシー・予約の画面の同意の文言の版（予約の画面の同意）。 */
export const B2C_TERMS_VERSION = "2026-11-phase1a-draft"
/** カード登録の画面の「集荷の後に請求する」同意の文言の版。 */
export const B2C_CARD_CONSENT_VERSION = "2026-11-phase1a-card-draft"

export type B2cLegalLang = "ja" | "en"
export type B2cLegalDocKind = "terms" | "cancellation" | "tokushoho" | "privacy"
export type B2cLegalKind = B2cLegalDocKind | "booking_consent" | "card_consent"

export const B2C_LEGAL_DOC_KINDS: B2cLegalDocKind[] = ["terms", "cancellation", "tokushoho", "privacy"]

/** 確認のページ（ローカルのレビュー用。公開は法務の確認の後）の場所。 */
export function b2cLegalPath(kind: B2cLegalDocKind, lang: B2cLegalLang): string {
  return `/legal/traveler/${kind}${lang === "ja" ? "?lang=ja" : ""}`
}

/**
 * 予約の画面の同意の欄。規約・キャンセル規定・プライバシーポリシーへのリンクは画面が文の前に置く。
 * 文言を変えたら B2C_TERMS_VERSION を上げる（過去の予約の同意の文言は b2c_legal_documents に残っている）。
 */
export const B2C_BOOKING_CONSENT_TEXT: Record<B2cLegalLang, string> = {
  ja: "利用規約・キャンセル規定・プライバシーポリシーに同意します。送れない物（現金・カード類・パスポートなど）を入れないこと、ホテルが受けられない場合は BondEx が無料で取り消すこと、カードへの請求は集荷の後に実際に集荷した個数で行うことを理解しました。",
  en: "I agree to the Terms of Service, the Cancellation Policy and the Privacy Policy. I understand that items that cannot be sent (cash, cards, passports, etc.) must not be packed; that if a hotel cannot accept my bags, BondEx cancels at no charge; and that my card is charged after pickup, for the number of bags actually picked up.",
}

/** カード登録の画面の同意の欄（後日の請求への同意）。上の説明（B2C_CARD_CHARGE_TERMS）とあわせて残す。 */
export const B2C_CARD_CONSENT_TEXT: Record<B2cLegalLang, string> = {
  ja: "上記のとおり、BondEx がこのカードを保存し、集荷の後に実際に集荷した個数の料金を請求することに同意します。",
  en: "I authorize BondEx to save this card and charge it after pickup for the number of bags actually picked up, as described above.",
}

/** カード登録の画面の請求の説明（同意の対象）。{amount} は予約の合計（税込）。 */
export const B2C_CARD_CHARGE_TERMS: Record<B2cLegalLang, string> = {
  ja: "佐川急便が集荷した後に、このカードへ請求します。請求額は実際に集荷した個数で計算します（予約の合計は {amount}（税込））。ご予約より多くお預けになった場合は増えた分を、少ない場合は少ない個数の料金を、同じ1個あたりの料金で請求します。荷物が集荷されなかった場合は請求しません。請求ができなかった時は、メールで支払のページをご案内します。",
  en: "We charge this card after Sagawa picks up your bags. The amount is based on the number of bags actually picked up (your booking total is {amount}, tax included). If you hand over more bags than booked, the extra bags are charged; if fewer, you pay only for the bags picked up — at the same price per bag. If your bags are not picked up, we do not charge you. If the charge fails, we will email you a link to a payment page.",
}

export function b2cCardChargeTerms(lang: B2cLegalLang, amount: string): string {
  return B2C_CARD_CHARGE_TERMS[lang].replace("{amount}", amount)
}
