/**
 * B1（事業条件 D0〜D5 と規約・画面・通知の整合）の回帰テスト。純粋関数とファイルの中身だけを試し、DB・佐川・Stripe・本番には触れない。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-b2c/b1_legal.ts
 * 正本: docs/b2c/legal/01_business_conditions.md（D0〜D5）・02_implementation_gaps.md（G0〜G11）。
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { pickupCutoffAt, PICKUP_CUTOFF_TEXT, PICKUP_CUTOFF_HOUR_JST, PICKUP_CUTOFF_MINUTE_JST } from "@/lib/pickup-cutoff"
import { judgeB2cBookability, b2cCardWindowFits, B2C_CARD_WINDOW_MS, type B2cBookabilityInput } from "@/lib/b2c/bookability"
import { b2cChangeBlockedReason } from "@/lib/b2c/change-gate"
import { planB2cConfirmation, hotelCheckLatestAt, lateAcceptanceDueAt } from "@/lib/b2c/hotel-gate"
import { renderEmail, type B2cNotifyData } from "@/lib/b2c/notify-templates"
import { isSecretLinkPath } from "@/components/third-party-analytics"
import { B2C_CARD_WINDOW_MS as CARD_WINDOW_FROM_CARD_SERVICE, B2C_CARD_CONSENT_VERSION as CARD_V } from "@/lib/b2c/card-service"
import { B2C_CONSENT_VERSION } from "@/lib/b2c/booking-service"
import {
  B2C_TERMS_VERSION, B2C_CARD_CONSENT_VERSION, B2C_BOOKING_CONSENT_TEXT, B2C_CARD_CONSENT_TEXT, b2cCardChargeTerms, b2cLegalPath,
  b2cLegalDocBody, b2cLegalBodyFromSource, currentB2cLegalDocuments, sha256Hex, B2C_LEGAL_DOC_KINDS,
} from "@/lib/b2c/legal"

let passed = 0
function t(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}
const read = (p: string) => readFileSync(p, "utf8")
const jst = (s: string) => new Date(`${s}+09:00`)

// 集荷 2026-11-14（土）・前日 11-13（金）18:30 が締切
const PICKUP = "2026-11-14"
const base = (now: Date): B2cBookabilityInput => ({
  now, originFacilityId: "A", destFacilityId: "B",
  origin: { checkIn: "2026-11-12", checkOut: "2026-11-14" }, dest: { checkIn: "2026-11-14", checkOut: "2026-11-20" },
  pickupDate: PICKUP, deliveryDate: "2026-11-16", transitDays: 1, destAcceptsBeforeCheckIn: false,
})

console.log("D0 受付締切 = 集荷前日 18:30（B2B・B2C 共通）")
t("締切の定数は 18:30・案内の文も 18:30", () => {
  assert.equal(`${PICKUP_CUTOFF_HOUR_JST}:${PICKUP_CUTOFF_MINUTE_JST}`, "18:30")
  assert.match(PICKUP_CUTOFF_TEXT.ja, /18:30/)
  assert.match(PICKUP_CUTOFF_TEXT.en, /18:30/)
  assert.equal(pickupCutoffAt(PICKUP), "2026-11-13T09:30:00.000Z")
})
t("予約: 18:29:59 は受付・18:30:00 は締切後", () => {
  assert.ok(!judgeB2cBookability(base(jst("2026-11-13T18:29:59"))).errors.includes("past_cutoff"))
  assert.ok(judgeB2cBookability(base(jst("2026-11-13T18:30:00"))).errors.includes("past_cutoff"))
})
t("自分での取消: 18:29:59 はできる・18:30:00 はできない（運営への相談）", () => {
  assert.equal(b2cChangeBlockedReason("cancel", { pickupDate: PICKUP, pieces: 2 }, jst("2026-11-13T18:29:59")), null)
  assert.equal(b2cChangeBlockedReason("cancel", { pickupDate: PICKUP, pieces: 2 }, jst("2026-11-13T18:30:00")), "past_cutoff")
})
t("カード登録の 30分: 締切の 30分前（18:00:00）までは始められる・18:00:01 からは間に合わない", () => {
  assert.equal(B2C_CARD_WINDOW_MS, 30 * 60 * 1000)
  assert.equal(CARD_WINDOW_FROM_CARD_SERVICE, B2C_CARD_WINDOW_MS)
  assert.equal(b2cCardWindowFits(jst("2026-11-13T18:00:00"), PICKUP, null), true)
  assert.equal(b2cCardWindowFits(jst("2026-11-13T18:00:01"), PICKUP, null), false)
  assert.equal(b2cCardWindowFits(jst("2026-11-13T18:20:00"), PICKUP, null), false)
})
t("カード登録の 30分: ホテルの確認の期限（直前予約は前日 18:00）があれば、その 30分前（17:30）まで", () => {
  const due = lateAcceptanceDueAt(PICKUP)
  assert.equal(due, "2026-11-13T09:00:00.000Z")
  assert.equal(b2cCardWindowFits(jst("2026-11-13T17:30:00"), PICKUP, due), true)
  assert.equal(b2cCardWindowFits(jst("2026-11-13T17:30:01"), PICKUP, due), false)
})
t("予約の画面の日付の候補は、カード登録が間に合う日だけ（予約の画面とカード登録で同じ判定を使う）", () => {
  const svc = read("lib/b2c/booking-service.ts")
  const card = read("lib/b2c/card-service.ts")
  assert.match(svc, /b2cCardWindowFits\(input\.now, p, r\.plan\.confirmationDueAt\)/)
  assert.match(card, /b2cCardWindowFits\(now, order\.pickup_date, order\.confirmation_due_at\)/)
})
t("Beta（直前予約 OFF）: 通常の予約は集荷の 2営業日前 17:00 まで。それ以降は締切前でも画面に出ない（規約 第2条4項の但し書き）", () => {
  // 集荷 11-12（木）→ 2営業日前 = 11-10（火）17:00
  assert.equal(hotelCheckLatestAt("2026-11-12"), "2026-11-10T08:00:00.000Z")
  const at = (s: string) => planB2cConfirmation({ now: jst(s), pickupDate: "2026-11-12", origin: "verified", dest: "verified", lateDutyStaffed: false })
  assert.deepEqual(at("2026-11-10T16:59:00").errors, [])
  assert.equal(at("2026-11-10T16:59:00").mode, "instant")
  assert.ok(at("2026-11-10T17:01:00").errors.includes("late_booking_unstaffed"))
})

console.log("D1・D3・D4・L7 画面・通知の文言（G3・G4・G6・G11）")
const form = read("components/b2c/booking-form.tsx")
const cardStep = read("components/b2c/card-step.tsx")
const my = read("components/b2c/my-booking.tsx")
t("予約の画面: 1個 160cm・30kg・超える場合は予約の前に相談（日英）", () => {
  assert.match(form, /3辺の合計160cm以内・30kg以内。超える場合は、予約の前にご相談ください/)
  assert.match(form, /up to 160 cm \(length \+ width \+ height\) and up to 30 kg\. For larger or heavier bags, contact us before booking/)
})
t("予約の画面: 送れない物（現金・カード類・パスポート）と、手元に持つ物（貴重品・壊れやすい物）を分けて案内し、一覧（規約 第7条）へリンク", () => {
  assert.match(form, /送れない物があります（現金・カード類・パスポートなど）/)
  assert.match(form, /Some items cannot be sent \(cash, cards, passports, etc\.\)/)
  assert.match(form, /#article-7/)
  assert.doesNotMatch(form, /Valuables are not covered/)
  assert.doesNotMatch(form, /貴重品は補償の対象外のため/)
})
t("予約の画面: 規約・キャンセル規定・プライバシーポリシー・特商法の表記へのリンクと、同意の文（共通の定数）", () => {
  for (const k of ["terms", "cancellation", "privacy", "tokushoho"]) assert.match(form, new RegExp(`\\["${k}"`))
  assert.match(form, /consent: B2C_BOOKING_CONSENT_TEXT\.en/)
  assert.match(form, /consent: B2C_BOOKING_CONSENT_TEXT\.ja/)
  assert.match(B2C_BOOKING_CONSENT_TEXT.ja, /利用規約・キャンセル規定・プライバシーポリシーに同意します/)
  assert.match(B2C_BOOKING_CONSENT_TEXT.en, /Terms of Service, the Cancellation Policy and the Privacy Policy/)
  assert.match(B2C_BOOKING_CONSENT_TEXT.ja, /実際に集荷した個数/)
})
t("カード登録の画面: 実際に集荷した個数で請求（多い時は追加・少ない時は少ない個数）・集荷されなければ請求しない・失敗の時は支払のページ", () => {
  const ja = b2cCardChargeTerms("ja", "¥10,956")
  const en = b2cCardChargeTerms("en", "¥10,956")
  for (const s of ["実際に集荷した個数", "増えた分", "少ない場合は少ない個数の料金", "集荷されなかった場合は請求しません", "支払のページ", "¥10,956"]) assert.ok(ja.includes(s), s)
  for (const s of ["actually picked up", "extra bags are charged", "if fewer, you pay only for the bags picked up", "not picked up, we do not charge", "payment page", "¥10,956"]) assert.ok(en.includes(s), s)
  assert.match(cardStep, /b2cCardChargeTerms\("ja", y\)/)
  assert.match(cardStep, /consent: B2C_CARD_CONSENT_TEXT\.ja/)
  assert.match(B2C_CARD_CONSENT_TEXT.ja, /実際に集荷した個数の料金を請求することに同意します/)
  assert.match(cardStep, /b2cLegalPath\("terms", lang\)/)
})
t("通知はメールだけ（WhatsApp で送ると書かない・G11）", () => {
  for (const [name, src] of [["form", form], ["card", cardStep], ["my", my], ["notify", read("lib/b2c/notify-templates.ts")]] as const) {
    assert.doesNotMatch(src, /メールと WhatsApp/, name)
    assert.doesNotMatch(src, /email and WhatsApp/, name)
    assert.doesNotMatch(src, /reminders and urgent updates on WhatsApp/, name)
  }
})
t("確定のメール・予約の確認ページ: 送れない物と手元に持つ物を分けて案内（日英）", () => {
  const d: B2cNotifyData = {
    lang: "ja", orderNumber: 100001, guestName: "Test Guest", originName: "H1", destName: "H2", pickupDate: PICKUP, deliveryDate: "2026-11-16",
    pieces: 2, totalGrossYen: 10956, confirmationDueAt: null, cancelReason: null, myBookingUrl: "https://example.invalid/my/x", frontDeskUrl: "https://example.invalid/my/x/frontdesk",
  }
  const ja = renderEmail("booking_confirmed", d).text
  const en = renderEmail("booking_confirmed", { ...d, lang: "en" }).text
  assert.match(ja, /送れない物は入れないでください（一覧は利用規約 第7条）/)
  assert.match(en, /Do not pack items that cannot be sent/)
  assert.match(ja, /集荷の前日 18:30 まで/)
  assert.match(en, /until 18:30 JST the day before pickup/)
  assert.doesNotMatch(ja, /補償の対象外です/)
  assert.match(my, /一覧は利用規約 第7条/)
  assert.match(my, /b2cLegalPath\(k, lang\)/)
})

console.log("D5・G7 規約の版と本文")
t("版の名前は1か所（予約の同意 = 規約の版・カードの同意は別の版）", () => {
  assert.equal(B2C_CONSENT_VERSION, B2C_TERMS_VERSION)
  assert.equal(CARD_V, B2C_CARD_CONSENT_VERSION)
  assert.notEqual(B2C_TERMS_VERSION, B2C_CARD_CONSENT_VERSION)
})
t("予約の時に terms_version・terms_lang・terms_consented_at を書き、カード登録の時は card_consent_* に書く（予約の時の版を上書きしない）", () => {
  const svc = read("lib/b2c/booking-service.ts")
  const card = read("lib/b2c/card-service.ts")
  assert.match(svc, /terms_version: B2C_TERMS_VERSION/)
  assert.match(svc, /terms_lang:/)
  assert.match(svc, /terms_consented_at: consentedAt/)
  assert.match(card, /card_consent_version: B2C_CARD_CONSENT_VERSION, card_consented_at: now\.toISOString\(\)/)
  assert.doesNotMatch(card, /consent_version: B2C_CARD_CONSENT_VERSION, consented_at/)
})
t("本文の一式: 版×種類×言語が 12行・重複なし・SHA-256 が本文と一致", () => {
  const docs = currentB2cLegalDocuments()
  assert.equal(docs.length, 12)
  assert.equal(new Set(docs.map((d) => `${d.version}|${d.kind}|${d.lang}`)).size, 12)
  for (const d of docs) assert.equal(d.sha256, sha256Hex(d.body))
})
t("本文に社内の作成メモ（> の行）を含めない・見出しは残す", () => {
  const body = b2cLegalBodyFromSource("# Title\n\n> note 1\n> note 2\n\nBody line\n\n> quote kept in body\n")
  assert.equal(body, "# Title\n\nBody line\n\n> quote kept in body\n")
  for (const k of B2C_LEGAL_DOC_KINDS) for (const lang of ["ja", "en"] as const) {
    const b = b2cLegalDocBody(k, lang)
    assert.doesNotMatch(b.split("\n").slice(0, 4).join("\n"), /^>/m, `${k}_${lang}`)
  }
})
t("規約・キャンセル規定・特商法: 締切は 18:30 で確定（D0 の空欄が残っていない・日英）", () => {
  for (const f of ["terms", "cancellation", "tokushoho"]) for (const lang of ["ja", "en"]) {
    const s = read(`docs/b2c/legal/${f}_${lang}.md`)
    assert.doesNotMatch(s, /D0: 17:00|\[D0\]|【D0】/, `${f}_${lang}`)
    assert.match(s, /18:30/, `${f}_${lang}`)
    assert.doesNotMatch(s, /17:00 or 18:30|17:00 または 18:30/, `${f}_${lang}`)
  }
})
t("規約: 160cm・30kg・第7条（送れない物・補償が制限される物）・未集荷は請求しない・遅延は個別判断（日英で同じ項目）", () => {
  const ja = b2cLegalDocBody("terms", "ja")
  const en = b2cLegalDocBody("terms", "en")
  for (const s of ["160cm", "30kg", "## 第7条", "料金を請求しません", "個別に判断", "30万円"]) assert.ok(ja.includes(s), s)
  for (const s of ["160 cm", "30 kg", "## Article 7", "we do not charge you", "case by case", "300,000 JPY"]) assert.ok(en.includes(s), s)
  // 推測で足した品目を戻さない（v1 の誤り）
  assert.doesNotMatch(ja, /精密機器/)
  assert.doesNotMatch(en, /precision equipment/i)
})
t("プライバシーポリシー（日英）がある・要確認の箇所を推測で埋めていない", () => {
  const ja = b2cLegalDocBody("privacy", "ja")
  const en = b2cLegalDocBody("privacy", "en")
  assert.match(ja, /カードの番号・セキュリティコードを取得・保存しません/)
  assert.match(en, /do not collect or store your card number or security code/)
  assert.match(ja, /【要確認/)
  assert.match(en, /\[To confirm/)
})
t("秘密のリンク（予約の画面・確認ページ）から規約のページへは参照元を渡さず、規約のページでは計測を読み込まない", () => {
  for (const [name, src] of [["form", form], ["card", cardStep], ["my", my]] as const) {
    const links = src.match(/href=\{[^}]*b2cLegalPath[^>]*>/g) ?? []
    assert.ok(links.length > 0, name)
    for (const l of links) assert.match(l, /rel="noopener noreferrer"/, `${name}: ${l}`)
  }
  assert.equal(isSecretLinkPath("/legal/traveler/terms"), true)
  assert.equal(isSecretLinkPath("/book/x"), true)
  assert.equal(isSecretLinkPath("/legal/privacy"), false)
  assert.equal(isSecretLinkPath("/"), false)
})
t("規約のページの場所（日英）", () => {
  assert.equal(b2cLegalPath("terms", "en"), "/legal/traveler/terms")
  assert.equal(b2cLegalPath("privacy", "ja"), "/legal/traveler/privacy?lang=ja")
})
t("規約のページは既定で表示しない（B2C_LEGAL_PAGES_ENABLED が true の時だけ・検索エンジンに載せない）", () => {
  const page = read("app/legal/traveler/[doc]/page.tsx")
  assert.match(page, /if \(!b2cLegalPagesEnabled\(\)\) notFound\(\)/)
  assert.match(page, /robots: \{ index: false, follow: false/)
  assert.match(read("lib/b2c/flags.ts"), /on\("B2C_LEGAL_PAGES_ENABLED"\)/)
})

console.log(`\n${passed} passed`)
