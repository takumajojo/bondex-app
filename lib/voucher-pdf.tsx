/* eslint-disable @next/next/no-img-element */
import React from "react"
import path from "path"
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
  Svg,
  Path,
  Rect,
  Circle,
} from "@react-pdf/renderer"

// ---------------------------------------------------------------------------
// BondEx Luggage Forwarding Voucher — react-pdf 実装
//
// デザインは design/voucher/voucher.html (確定版テンプレート) の移植。
//   - 1 区間 (leg) = 1 バウチャー (ゲスト用 EN ページ + ホテルスタッフ用 JP ページ)
//   - バウチャー番号 = bookingId + 区間サフィックス (-A / -B / -C ...)
//   - 各用紙はその区間だけを大きく表示し、旅程全体は補助情報として小さく表示
// テンプレートを変更する場合は必ず design/voucher/ 側を先に更新し、
// 本ファイルへ反映すること (両者の乖離が最大の事故要因)。
// ---------------------------------------------------------------------------

const FONT_DIR = path.join(process.cwd(), "public", "fonts")
const LOGO_PATH = path.join(process.cwd(), "public", "bondex-logo.png")

const BONDEX_SUPPORT_EMAIL = "support@bondex.express"
// 配送業者 (ヤマト) の連絡先 — 実番号確定までプレースホルダ (テンプレートと同じ)
const SUPPLIER_TEL_PLACEHOLDER = "+81-XX-XXXX-XXXX"
const PARTNER_URL = "https://bondex.express/partner"

// 日本語のハイフンなし改行:
// textkit は単語内の改行点 (penalty node) で必ず "-" を挿入するため、
// 従来の「1文字ずつ分割する hyphenationCallback」では日本語が「お-預かり」の
// ように壊れる。空白 (glue node) での改行にはハイフンが付かないことを利用し、
//   1. public/fonts の NotoSansJP 3 ウェイトに U+2009 (THIN SPACE) を
//      「幅 0 の空グリフ」としてパッチ済み (fontTools で追加)
//   2. jb() が日本語文字間に U+2009 を挿入して改行点を作る (禁則処理つき)
//   3. hyphenationCallback は U+2009 区切りで分割 → U+2009 は JS の trim で
//      空白扱い = glue node になり、ハイフンなしで改行される
// フォントを差し替える場合は必ず U+2009 パッチを再適用すること。
export const JP_BREAK = " "

try {
  Font.register({
    family: "NotoSansJP",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSansJP-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "NotoSansJP-Medium.ttf"), fontWeight: 500 },
      { src: path.join(FONT_DIR, "NotoSansJP-Bold.ttf"), fontWeight: 700 },
    ],
  })
  // 中国語 (簡体字) — ゲスト言語切り替え用。NotoSansJP は簡体字グリフを
  // 持たないため専用ファミリーが必要。U+2009 パッチ適用済み (scripts/ 参照)。
  Font.register({
    family: "NotoSansSC",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSansSC-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "NotoSansSC-Bold.ttf"), fontWeight: 700 },
    ],
  })
  // 注: Font.registerHyphenationCallback はグローバル (最後の登録が全 PDF に効く)。
  // contract-pdf.tsx も同じ実装を登録している — 変更時は両方を揃えること。
  Font.registerHyphenationCallback((word: string) => {
    if (word.includes(JP_BREAK)) return word.split(/( )/).filter(Boolean)
    if (/^[\x20-\x7e]+$/.test(word)) return [word] // ASCII 語はハイフン分割しない
    return Array.from(word) // jb() を通っていない CJK (旧挙動 — contract 用)
  })
} catch {
  // フォント未配置時は Helvetica にフォールバック
}

// ---------------------------------------------------------------------------
// Text safety: ラテン拡張 (Ō など) の合成ダイアクリティカルを除去。
// フル版 NotoSansJP に置き換え済みだがマクロン合成は依然非対応のため維持。
// ---------------------------------------------------------------------------
function safeText(input?: string | null): string {
  if (!input) return ""
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

// ---------------------------------------------------------------------------
// jb() — Japanese breakable: 日本語文字間に U+2009 (幅 0・パッチ済み) を挿入して
// ハイフンなしの改行点を作る。簡易禁則処理つき:
//   - 行頭禁則 (、。」など) の前では区切らない
//   - 行末禁則 (「（ など) の後では区切らない
//   - 数字 + 助数詞 (7月 / 2泊 / 1名 など) は分離しない
// 日本語を含む可能性のある Text 内容はすべてこれを通すこと。
// ---------------------------------------------------------------------------
const CJK_RE = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/
const NO_BREAK_BEFORE = "、。，．・：；？！ー〜～）」』】〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶんン々ゝゞ"
const NO_BREAK_AFTER = "（「『【〔"
const COUNTER_CHARS = "年月日泊名様個件時分枚"

function jb(input?: string | null): string {
  const s = safeText(input)
  if (!s) return ""
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const a = s[i]
    const b = s[i + 1]
    out += a
    if (!b) break
    if (!CJK_RE.test(a) && !CJK_RE.test(b)) continue
    if (a === JP_BREAK || b === JP_BREAK || a === " " || b === " ") continue
    if (NO_BREAK_AFTER.includes(a) || NO_BREAK_BEFORE.includes(b)) continue
    if (/[0-9０-９]/.test(a) && COUNTER_CHARS.includes(b)) continue
    out += JP_BREAK
  }
  return out
}

// ---------------------------------------------------------------------------
// Types (公開 API — generate / regenerate ルートが構築する)
// ---------------------------------------------------------------------------

export interface VoucherShipmentLocation {
  hotel: string
  address: string
  city: string
}

export interface VoucherShipment {
  shipmentDate: string
  expectedArrival: string
  from: VoucherShipmentLocation
  to: VoucherShipmentLocation
  recipient: string
  suitcaseCount: number
  dropOffTime?: string
  pickUpNote?: string
  specialNote?: string
  destinationNights?: number
  /** Reservation booking name (may differ from recipient). Optional. */
  bookingName?: string
  /** Guest check-in date at the from-hotel (YYYY-MM-DD). Optional. */
  fromCheckIn?: string
  /** Guest check-out date at the to-hotel (YYYY-MM-DD). Optional. */
  toCheckOut?: string
}

/** ゲスト向けページの言語。ホテルスタッフ用ページは常に日本語。 */
export type GuestLanguage = "en" | "zh"

export type ContactDisplayMode =
  | "bondex_support"
  | "travel_agency"
  | "tour_operator"
  | "hidden"

export interface VoucherInput {
  bookingId: string
  issuedDate: string
  representativeLabel: string
  tourCompany: string
  travelerCount: number
  shipments: VoucherShipment[]
  totalAmount: number
  supportPhone: string
  supportEmail: string
  contactPersonName: string
  contactPersonPhone: string
  companyName: string
  companyAddress: string
  groupName?: string
  /** Travel agency's own tour/booking number (internal ops / file naming). */
  tourNumber?: string
  /** 旧 API 互換: false → contactDisplayMode "hidden" と同義。 */
  showContact?: boolean
  /** CONTACT 欄の表示モード。未指定時は showContact から導出。 */
  contactDisplayMode?: ContactDisplayMode
  /** 追跡ページ QR (data URI)。ルート側で事前生成して渡す。 */
  trackingQrDataUri?: string
  /** パートナー募集 QR (data URI)。ルート側で事前生成して渡す。 */
  partnerQrDataUri?: string
  /** ゲスト向けページの言語 (既定: en)。zh = 簡体字。繁体字は同じ仕組みで追加可。 */
  guestLanguage?: GuestLanguage
}

function resolveContactMode(data: VoucherInput): ContactDisplayMode {
  if (data.contactDisplayMode) return data.contactDisplayMode
  return data.showContact === false ? "hidden" : "bondex_support"
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const MONTHS_EN_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
]
const DOW_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

/** "10 JUL 2026" */
function formatEnDate(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ymd
  return `${p.d} ${MONTHS_EN_SHORT[p.m - 1]} ${p.y}`
}

/** "10 JUL" */
function formatEnDateShort(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ymd
  return `${p.d} ${MONTHS_EN_SHORT[p.m - 1]}`
}

function formatJpDate(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ymd
  return `${p.y}年${p.m}月${p.d}日`
}

function dayOfMonth(ymd: string): string {
  const p = parseYmd(ymd)
  return p ? String(p.d) : ""
}

function monthYear(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ""
  return `${MONTHS_EN_SHORT[p.m - 1]} ${p.y}`
}

function dowLabel(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ""
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
  return `(${DOW_EN[dow]})`
}

/** a → b の泊数 (どちらか欠け・逆転時は null) */
function nightsBetween(a?: string, b?: string): number | null {
  if (!a || !b) return null
  const pa = parseYmd(a)
  const pb = parseYmd(b)
  if (!pa || !pb) return null
  const diff =
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000
  return diff > 0 ? diff : null
}

/** 区間サフィックス: 0 → A, 1 → B ... 25 → Z, それ以降は L27 形式 */
export function legSuffix(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `L${index + 1}`
}

export function voucherRefFor(bookingId: string, legIndex: number, totalLegs: number): string {
  return totalLegs > 1 ? `${bookingId}-${legSuffix(legIndex)}` : bookingId
}

// ---------------------------------------------------------------------------
// Design tokens (design/voucher/voucher.css の :root と同値)
// ---------------------------------------------------------------------------

const INK = "#16161a"
const INK_SOFT = "#4b4b52"
const MUTED = "#8a8a92"
const RED = "#c8102e"
const RED_DARK = "#a00d25"
const RED_SOFT = "#e2314f"
const RED_TINT = "#fdf3f4"
const GRAY_BG = "#f4f4f5"
const GRAY_LINE = "#e3e3e6"

/** mm → pt */
const mm = (v: number) => v * 2.8346

// ロゴ実寸 1255×254px → 高さ指定でアスペクト維持
const LOGO_ASPECT = 1255 / 254
const logoSize = (heightMm: number) => ({
  height: mm(heightMm),
  width: mm(heightMm) * LOGO_ASPECT,
})

const vs = StyleSheet.create({
  page: {
    paddingTop: mm(11),
    paddingBottom: mm(9),
    paddingHorizontal: mm(14),
    fontFamily: "NotoSansJP",
    fontSize: 9,
    color: INK,
    backgroundColor: "#ffffff",
    flexDirection: "column",
  },

  // ---------------- masthead (共通) ----------------
  masthead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: mm(2.4),
    borderBottomWidth: mm(0.8),
    borderBottomColor: INK,
  },
  copyTag: {
    marginTop: mm(1.8),
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 1.1,
    color: RED,
  },
  refLabel: { fontSize: 6.5, letterSpacing: 1.8, color: MUTED },
  refValue: { fontSize: 13, fontWeight: 700, marginTop: mm(0.8) },

  // ---------------- 区間バナー (page 1) ----------------
  legBanner: {
    marginTop: mm(3),
    backgroundColor: RED,
    paddingVertical: mm(2.4),
    paddingHorizontal: mm(4),
    flexDirection: "row",
    alignItems: "center",
  },
  lbKicker: {
    fontSize: 6.2,
    fontWeight: 700,
    letterSpacing: 1.4,
    color: "#f2b8c2",
  },
  lbLeg: { fontSize: 16, fontWeight: 700, color: "#ffffff", marginTop: mm(0.4) },
  lbMain: {
    marginLeft: mm(4.5),
    paddingLeft: mm(4.5),
    borderLeftWidth: mm(0.4),
    borderLeftColor: "#e08a99",
    flex: 1,
  },
  lbRoute: { fontSize: 11.5, fontWeight: 700, color: "#ffffff" },
  lbDates: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: mm(1),
  },
  lbDateText: { fontSize: 7.5, color: "#f4cdd4" },
  lbDateStrong: { fontSize: 7.5, fontWeight: 700, color: "#ffffff" },
  lbSep: {
    width: mm(1.4),
    height: mm(1.4),
    backgroundColor: "#e08a99",
    marginHorizontal: mm(2.2),
  },

  // ---------------- doc title + tracking module ----------------
  docTitle: {
    marginTop: mm(2.4),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  h1: { fontSize: 17, fontWeight: 700, lineHeight: 1.12 },
  h1Sub: { fontSize: 9, color: INK_SOFT, marginTop: mm(1.2) },
  trackingModule: {
    width: mm(42),
    borderWidth: mm(0.5),
    borderColor: INK,
    paddingBottom: mm(1.8),
    alignItems: "center",
  },
  tmHead: {
    alignSelf: "stretch",
    backgroundColor: RED,
    color: "#ffffff",
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 1.4,
    paddingVertical: mm(1.2),
    textAlign: "center",
    marginBottom: mm(1.6),
  },
  tmQr: { width: mm(15), height: mm(15) },
  tmCaption: { fontSize: 7, fontWeight: 700, marginTop: mm(1.2), textAlign: "center" },
  tmCaptionEn: { fontSize: 6, color: INK_SOFT, marginTop: mm(0.3), textAlign: "center" },
  tmNote: {
    fontSize: 5,
    color: MUTED,
    marginTop: mm(0.9),
    lineHeight: 1.4,
    textAlign: "center",
    paddingHorizontal: mm(1.5),
  },

  // ---------------- present strip ----------------
  presentStrip: {
    marginTop: mm(3),
    borderWidth: mm(0.5),
    borderColor: INK,
    paddingVertical: mm(2.2),
    paddingHorizontal: mm(5),
    flexDirection: "row",
    alignItems: "center",
  },
  psWords: { marginLeft: mm(4), flex: 1 },
  psEn: { fontSize: 9.5, fontWeight: 700 },
  psJa: { fontSize: 8, color: INK_SOFT, marginTop: mm(0.6) },

  // ---------------- journey ----------------
  journey: { marginTop: mm(3.5), flexDirection: "row", alignItems: "stretch" },
  legCard: {
    flex: 1,
    borderWidth: mm(0.5),
    borderColor: INK,
    paddingHorizontal: mm(5),
    paddingBottom: mm(3.5),
    flexDirection: "column",
  },
  legTab: {
    alignSelf: "flex-start",
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 1.4,
    color: "#ffffff",
    paddingVertical: mm(1.2),
    paddingHorizontal: mm(3),
    marginLeft: -mm(5),
    marginBottom: mm(2.6),
  },
  legDateRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: mm(0.3),
    borderBottomColor: GRAY_LINE,
    paddingBottom: mm(2),
  },
  legDay: { fontSize: 23, fontWeight: 700, lineHeight: 1 },
  legMy: { fontSize: 9, fontWeight: 700, letterSpacing: 0.5, marginLeft: mm(2.5), marginBottom: 2 },
  legDow: { fontSize: 8, color: RED, fontWeight: 700, marginLeft: mm(2.5), marginBottom: 2 },
  legHotelEn: { fontSize: 12, fontWeight: 700, lineHeight: 1.2, marginTop: mm(2) },
  legHotelAddr: { fontSize: 7, color: MUTED, marginTop: mm(1), lineHeight: 1.4 },
  legWhen: { marginTop: "auto", paddingTop: mm(1.6) },
  legWhenEn: { fontSize: 7.5, fontWeight: 700, lineHeight: 1.45 },
  legWhenJa: { fontSize: 7.5, color: INK_SOFT, lineHeight: 1.45 },
  journeyArrow: {
    width: mm(12),
    alignItems: "center",
    justifyContent: "center",
  },

  giveTo: {
    marginTop: mm(1.8),
    backgroundColor: RED_TINT,
    borderLeftWidth: mm(1),
    borderLeftColor: RED,
    paddingVertical: mm(1.5),
    paddingHorizontal: mm(2.2),
  },
  gtEn: { fontSize: 6.2, fontWeight: 700, letterSpacing: 0.8, color: RED_DARK },
  gtHotel: { fontSize: 9, fontWeight: 700, marginTop: mm(0.5) },
  gtDate: { fontSize: 7.5, fontWeight: 700, color: INK_SOFT },
  gtJa: { fontSize: 6.2, color: INK_SOFT, marginTop: mm(0.5), lineHeight: 1.45 },
  gtJaStrong: { color: INK, fontWeight: 700 },

  // ---------------- detail grid ----------------
  detailGrid: {
    marginTop: mm(3.5),
    borderTopWidth: mm(0.5),
    borderTopColor: INK,
    borderLeftWidth: mm(0.5),
    borderLeftColor: INK,
  },
  detailRow: { flexDirection: "row" },
  detailCell: {
    borderRightWidth: mm(0.5),
    borderRightColor: INK,
    borderBottomWidth: mm(0.5),
    borderBottomColor: INK,
    paddingVertical: mm(2.2),
    paddingHorizontal: mm(3.5),
    minHeight: mm(13),
  },
  dk: { fontSize: 6, letterSpacing: 0.9, color: MUTED },
  dv: { fontSize: 10, fontWeight: 700, marginTop: mm(1), lineHeight: 1.25 },
  dvSmall: { fontSize: 7, fontWeight: 400, color: INK_SOFT, marginTop: mm(0.6) },

  // ---------------- route list ----------------
  routeList: {
    marginTop: mm(3),
    borderWidth: mm(0.4),
    borderColor: GRAY_LINE,
    paddingVertical: mm(1.7),
    paddingHorizontal: mm(3),
  },
  rlHead: { fontSize: 6.2, fontWeight: 700, letterSpacing: 1.1, color: MUTED },
  rlRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: mm(0.7),
    paddingBottom: mm(0.5),
  },
  rlRowBorder: { borderTopWidth: mm(0.3), borderTopColor: GRAY_LINE },
  rlLeg: { width: mm(15), fontSize: 7, fontWeight: 700, color: MUTED },
  rlDate: { width: mm(11), fontSize: 7, fontWeight: 700, color: MUTED, marginLeft: mm(3) },
  rlRoute: { flex: 1, fontSize: 7, color: MUTED, marginLeft: mm(3) },
  rlChip: {
    backgroundColor: RED,
    color: "#ffffff",
    fontSize: 5.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    paddingVertical: mm(0.5),
    paddingHorizontal: mm(1.8),
  },

  // ---------------- staff alert ----------------
  staffAlert: {
    marginTop: "auto",
    borderWidth: mm(0.8),
    borderColor: RED,
    backgroundColor: RED_TINT,
    paddingVertical: mm(3),
    paddingHorizontal: mm(5),
    flexDirection: "row",
    alignItems: "center",
  },
  saBody: { marginLeft: mm(4.5), flex: 1 },
  saHead: { fontSize: 11, fontWeight: 700, color: RED_DARK, lineHeight: 1.3 },
  saHeadEn: { fontSize: 8, letterSpacing: 0.9 },
  saText: { fontSize: 8.5, fontWeight: 700, marginTop: mm(1.2), lineHeight: 1.55 },
  saTextEn: { fontSize: 7.5, color: INK_SOFT, marginTop: mm(0.8), lineHeight: 1.5 },

  // ---------------- p1 footer ----------------
  p1Footer: {
    marginTop: mm(2.5),
    paddingTop: mm(2.4),
    borderTopWidth: mm(0.3),
    borderTopColor: GRAY_LINE,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  p1Co: { fontSize: 7, color: MUTED, lineHeight: 1.6 },
  p1CoStrong: { color: INK_SOFT, fontWeight: 700 },
  nextPageNote: { fontSize: 8, fontWeight: 700, textAlign: "right", lineHeight: 1.5 },
  nextPageNoteJa: { fontSize: 7, fontWeight: 400, color: INK_SOFT, textAlign: "right" },
  nextPageArrow: { color: RED },

  // ================= page 2 =================
  p2HeadTag: { fontSize: 11, fontWeight: 700, color: RED, textAlign: "right" },
  p2HeadTagJa: { fontSize: 9, color: INK, fontWeight: 700 },
  p2Ref: { fontSize: 6.5, letterSpacing: 1.2, color: MUTED, marginTop: mm(1.5), textAlign: "right" },

  leadStatement: { marginTop: mm(2.2), fontSize: 11, fontWeight: 700, lineHeight: 1.4 },

  // ---------------- leg strip ----------------
  legStrip: {
    marginTop: mm(2),
    backgroundColor: INK,
    paddingVertical: mm(2),
    paddingHorizontal: mm(3.2),
    flexDirection: "row",
    alignItems: "center",
  },
  lsCap: { fontSize: 5.6, letterSpacing: 0.8, color: "#9c9ca4", fontWeight: 700 },
  lsBadge: {
    marginTop: mm(0.8),
    alignSelf: "flex-start",
    backgroundColor: RED,
    color: "#ffffff",
    fontSize: 10.5,
    fontWeight: 700,
    paddingVertical: mm(0.8),
    paddingHorizontal: mm(2.6),
  },
  lsGrid: { flex: 1, flexDirection: "row", marginLeft: mm(5) },
  lsK: { fontSize: 5.8, letterSpacing: 0.7, color: "#9c9ca4" },
  lsV: { fontSize: 9, fontWeight: 700, color: "#ffffff", marginTop: mm(0.5) },

  // ---------------- notice row ----------------
  noticeRow: { marginTop: mm(2), flexDirection: "row" },
  noticeCard: {
    flex: 1,
    borderWidth: mm(0.6),
    borderColor: INK,
    paddingVertical: mm(2.2),
    paddingHorizontal: mm(3.2),
  },
  noticeCardAccent: { borderColor: RED, backgroundColor: RED_TINT },
  nTitle: { fontSize: 9, fontWeight: 700, lineHeight: 1.35, marginTop: mm(1.4) },
  nTitleAccent: { color: RED_DARK },
  nSub: { fontSize: 6.8, color: INK_SOFT, marginTop: mm(1), lineHeight: 1.5 },

  // ---------------- flow ----------------
  flowTitle: {
    marginTop: mm(2.2),
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.3,
    color: MUTED,
  },
  flowCols: { marginTop: mm(1.8), flexDirection: "row" },
  flowCol: {
    flex: 1,
    borderWidth: mm(0.4),
    borderColor: GRAY_LINE,
    paddingVertical: mm(2.2),
    paddingHorizontal: mm(3),
  },
  flowColHead: {
    alignSelf: "flex-start",
    fontSize: 8,
    fontWeight: 700,
    color: "#ffffff",
    paddingVertical: mm(1.2),
    paddingHorizontal: mm(3),
    marginBottom: mm(2),
  },
  flowColHeadNo: { letterSpacing: 0.6, color: "#f0c3cb" },
  flowStep: { flexDirection: "row", marginBottom: mm(1.5) },
  flowNum: {
    width: mm(5.2),
    height: mm(5.2),
    borderRadius: mm(2.6),
    alignItems: "center",
    justifyContent: "center",
    marginRight: mm(3.3),
  },
  flowNumText: { fontSize: 7.5, fontWeight: 700, color: "#ffffff", lineHeight: 1 },
  flowStepBody: { flex: 1 },
  flowStepMain: { fontSize: 8, fontWeight: 700, lineHeight: 1.45 },
  flowStepSub: { fontSize: 7, color: INK_SOFT, lineHeight: 1.45 },

  roomNote: {
    marginTop: mm(1.5),
    backgroundColor: GRAY_BG,
    borderLeftWidth: mm(0.8),
    borderLeftColor: INK,
    paddingVertical: mm(1.5),
    paddingHorizontal: mm(2.5),
  },
  rnJa: { fontSize: 7, fontWeight: 700, lineHeight: 1.5 },
  rnEn: { fontSize: 6.5, color: INK_SOFT, marginTop: mm(0.3), lineHeight: 1.5 },

  // ---------------- hotel detail (予約検索パネル) ----------------
  hotelDetail: { marginTop: mm(2.2), flexDirection: "row" },
  hdBlock: {
    flex: 1,
    backgroundColor: GRAY_BG,
    paddingVertical: mm(2.3),
    paddingHorizontal: mm(3.2),
  },
  hdNo: { fontSize: 7, fontWeight: 700, letterSpacing: 0.8 },
  hdHotel: { fontSize: 10, fontWeight: 700, marginTop: mm(0.8) },
  lookupGrid: {
    marginTop: mm(2),
    backgroundColor: "#ffffff",
    borderWidth: mm(0.4),
    borderColor: INK,
  },
  lookupRow: { flexDirection: "row" },
  lookupCell: {
    paddingVertical: mm(1.6),
    paddingHorizontal: mm(2.2),
  },
  lookupCellL: { width: "53%" },
  lookupCellR: { width: "47%", borderLeftWidth: mm(0.3), borderLeftColor: GRAY_LINE },
  lookupRow2: { borderTopWidth: mm(0.3), borderTopColor: GRAY_LINE },
  lk: { fontSize: 5.5, letterSpacing: 0.4, color: MUTED, lineHeight: 1.3 },
  lkPrimary: { color: RED_DARK, fontWeight: 700 },
  lv: { fontSize: 8.5, fontWeight: 700, marginTop: mm(0.7), lineHeight: 1.25 },
  lvPrimary: { fontSize: 9.5, fontWeight: 700, marginTop: mm(0.7), lineHeight: 1.25 },
  lvNights: { fontSize: 7, color: INK_SOFT, fontWeight: 700 },
  lvBlank: {
    marginTop: mm(0.7),
    minHeight: mm(4),
    borderBottomWidth: mm(0.3),
    borderBottomColor: MUTED,
  },
  hdNote: { marginTop: mm(1.8), fontSize: 7.2, lineHeight: 1.6, color: INK_SOFT },
  hdNoteStrong: { color: INK, fontWeight: 700 },
  hdSpecial: { marginTop: mm(1), fontSize: 7, color: RED_DARK, fontWeight: 700, lineHeight: 1.5 },

  // ---------------- contact strip ----------------
  contactStrip: {
    marginTop: mm(2.2),
    borderWidth: mm(0.5),
    borderColor: INK,
    flexDirection: "row",
  },
  contactCell: { flex: 1, paddingVertical: mm(1.8), paddingHorizontal: mm(3.5) },
  contactCellR: { borderLeftWidth: mm(0.5), borderLeftColor: INK },
  cK: { fontSize: 6.5, letterSpacing: 0.9, color: MUTED },
  cV: { fontSize: 8, fontWeight: 700, marginTop: mm(0.8), lineHeight: 1.5 },
  cVSmall: { fontSize: 7, fontWeight: 400, color: INK_SOFT, lineHeight: 1.5 },

  // ---------------- ad banner (営業バナー) ----------------
  adBanner: {
    marginTop: mm(2.4),
    backgroundColor: INK,
    borderTopWidth: mm(1.4),
    borderTopColor: RED,
    paddingVertical: mm(2.8),
    paddingHorizontal: mm(4.5),
    flexDirection: "row",
    alignItems: "center",
  },
  adMain: { flex: 1 },
  adKicker: { fontSize: 7, fontWeight: 700, letterSpacing: 1.1, color: RED_SOFT },
  adKickerSub: { letterSpacing: 0.4, color: "#9c9ca4" },
  adHeadline: { fontSize: 12.5, fontWeight: 700, color: "#ffffff", marginTop: mm(1.8) },
  adAccent: { color: RED_SOFT },
  adLead: { fontSize: 7, color: "#c4c4cb", lineHeight: 1.55, marginTop: mm(1.2) },
  adPoints: {
    marginTop: mm(1.8),
    borderTopWidth: mm(0.3),
    borderTopColor: "#3a3a41",
    paddingTop: mm(1.8),
  },
  adPoint: { flexDirection: "row", alignItems: "flex-start" },
  adPointGap: { marginTop: mm(1.1) },
  ptMark: {
    width: mm(1.7),
    height: mm(1.7),
    backgroundColor: RED_SOFT,
    marginTop: mm(0.9),
    marginRight: mm(1.8),
  },
  ptBody: { flex: 1, fontSize: 7.2, color: "#c4c4cb", lineHeight: 1.5 },
  ptStrong: { color: "#ffffff", fontWeight: 700 },
  adCta: {
    width: mm(42),
    backgroundColor: "#ffffff",
    marginLeft: mm(5),
    paddingVertical: mm(2.8),
    paddingHorizontal: mm(2.5),
    alignItems: "center",
  },
  ctaQr: { width: mm(16), height: mm(16) },
  ctaTitle: { fontSize: 7.5, fontWeight: 700, color: RED_DARK, marginTop: mm(1.4), textAlign: "center" },
  ctaNote: { fontSize: 5.8, color: INK_SOFT, marginTop: mm(0.5), textAlign: "center" },
  ctaUrl: { fontSize: 5.8, fontWeight: 700, marginTop: mm(0.8), textAlign: "center" },

  // ---------------- p2 footer ----------------
  p2Footer: {
    marginTop: "auto",
    paddingTop: mm(1.8),
    borderTopWidth: mm(0.3),
    borderTopColor: GRAY_LINE,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  p2FooterText: { fontSize: 6.5, color: MUTED },
})

// ---------------------------------------------------------------------------
// SVG icons (テンプレートの line-art を移植)
// ---------------------------------------------------------------------------

function CheckCircleIcon() {
  return (
    <Svg width={mm(6.5)} height={mm(6.5)} viewBox="0 0 26 26">
      <Rect x={1} y={1} width={24} height={24} rx={12} stroke={RED} strokeWidth={1.6} fill="none" />
      <Path d="M8 13.5l3.2 3.2L18 10" stroke={RED} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}

function JourneyArrowIcon() {
  return (
    <Svg width={mm(9)} height={mm(9)} viewBox="0 0 24 24">
      <Path d="M3 12h17M14 5.5L20.5 12 14 18.5" stroke={RED} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}

function AlertIcon() {
  return (
    <Svg width={mm(8.5)} height={mm(8.5)} viewBox="0 0 34 34">
      <Rect x={1.5} y={1.5} width={31} height={31} rx={15.5} stroke={RED_DARK} strokeWidth={2} fill="none" />
      <Path d="M17 9v11" stroke={RED_DARK} strokeWidth={3} strokeLinecap="round" fill="none" />
      <Circle cx={17} cy={25} r={1.9} fill={RED_DARK} />
    </Svg>
  )
}

function TruckIcon() {
  return (
    <Svg width={mm(5)} height={mm(5)} viewBox="0 0 22 22">
      <Rect x={2} y={6} width={12} height={11} rx={1.5} stroke={RED_DARK} strokeWidth={1.6} fill="none" />
      <Path d="M14 9h3.5l2.5 3.5V17h-6" stroke={RED_DARK} strokeWidth={1.6} strokeLinejoin="round" fill="none" />
      <Circle cx={6.5} cy={17} r={1.8} fill="#ffffff" stroke={RED_DARK} strokeWidth={1.4} />
      <Circle cx={16.5} cy={17} r={1.8} fill="#ffffff" stroke={RED_DARK} strokeWidth={1.4} />
    </Svg>
  )
}

function YenIcon() {
  return (
    <Svg width={mm(5)} height={mm(5)} viewBox="0 0 22 22">
      <Circle cx={11} cy={11} r={9} stroke={RED_DARK} strokeWidth={1.6} fill="none" />
      <Path
        d="M11 6.5v9M8 9.2c0-1.2 1.3-2 3-2s3 .8 3 2-1.3 1.8-3 2-3 .8-3 2 1.3 2 3 2 3-.8 3-2"
        stroke={RED_DARK}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  )
}

function CheckboxIcon() {
  return (
    <Svg width={mm(5)} height={mm(5)} viewBox="0 0 22 22">
      <Rect x={3} y={3} width={16} height={16} rx={2} stroke={INK} strokeWidth={1.6} fill="none" />
      <Path d="M7 11.5l3 3 5.5-6" stroke={INK} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}

// ---------------------------------------------------------------------------
// ゲスト向け文言の言語辞書 (EN / 簡体字中国語)。
// 構造ラベル (DROP-OFF / TRACKING 等の欧文) はデザイン言語として共通、
// ゲストが読む「行動指示の文」を切り替える。
// ---------------------------------------------------------------------------
const GUEST_L10N = {
  en: {
    copyTag: "GUEST COPY / お客様控え",
    kicker: "THIS VOUCHER IS FOR",
    dropLabel: "Drop-off: ",
    pickLabel: "Pick-up: ",
    present: "Please present this voucher at the reception when dropping off and picking up your luggage.",
    dropWhen: (t?: string) => `At the hotel's reception ・ by ${t || "check-out"}`,
    pickWhen: (t?: string) => `At the hotel's reception ・ ${t || "when check-in"}`,
    giveTo: "PLEASE GIVE THIS VOUCHER TO:",
    giveToDate: (ymd: string) => `on ${formatEnDate(ymd)}`,
    scanCaption: "Scan for live delivery status",
    tmNote: "* Tracking may take a few hours to update after the courier receives your luggage.",
    routeHead: "YOUR LUGGAGE ROUTE ／ 旅程全体",
    currentChip: "CURRENT ／ この用紙",
  },
  zh: {
    copyTag: "GUEST COPY / 旅客联",
    kicker: "本凭证适用区间",
    dropLabel: "寄出 Drop-off: ",
    pickLabel: "领取 Pick-up: ",
    present: "寄存行李及领取行李时，请向酒店前台出示本凭证。",
    dropWhen: (t?: string) => (t ? `请于 ${t} 前交至酒店前台` : "请在退房前交至酒店前台"),
    pickWhen: (_t?: string) => "办理入住时向酒店前台领取",
    giveTo: "请将本凭证交给以下酒店：",
    giveToDate: (ymd: string) => `（${formatJpDate(ymd)} 交付）`,
    scanCaption: "扫码查看行李配送状态",
    tmNote: "* 行李由配送员揽收后，追踪信息可能需要数小时更新。",
    routeHead: "YOUR LUGGAGE ROUTE ／ 行李路线",
    currentChip: "CURRENT ／ 本张凭证",
  },
} as const

// ---------------------------------------------------------------------------
// Page 1 — GUEST COPY (guest language primary / JP secondary)
// ---------------------------------------------------------------------------

function GuestPage({
  data,
  shipment,
  legIndex,
  totalLegs,
}: {
  data: VoucherInput
  shipment: VoucherShipment
  legIndex: number
  totalLegs: number
}) {
  const ref = voucherRefFor(data.bookingId, legIndex, totalLegs)
  const contactMode = resolveContactMode(data)
  const totalLuggage = data.shipments.reduce((s, x) => s + x.suitcaseCount, 0)
  const guestName = jb(shipment.bookingName) || jb(data.representativeLabel)
  const fromHotel = jb(shipment.from.hotel)
  const toHotel = jb(shipment.to.hotel)
  // ゲスト言語 (en / zh)。zh は NotoSansSC で描画する (JP フォントに簡体字が無い)。
  const lang: GuestLanguage = data.guestLanguage === "zh" ? "zh" : "en"
  const L = GUEST_L10N[lang]
  const zf = lang === "zh" ? { fontFamily: "NotoSansSC" } : {}
  const dropWhenEn = L.dropWhen(shipment.dropOffTime?.trim() ? safeText(shipment.dropOffTime) : undefined)
  const pickWhenEn = L.pickWhen(shipment.pickUpNote?.trim() ? safeText(shipment.pickUpNote) : undefined)

  const contactCell = (() => {
    switch (contactMode) {
      case "hidden":
        return null
      case "travel_agency":
        return {
          label: "TRAVEL AGENCY CONTACT / 旅行会社連絡先",
          value: data.contactPersonPhone,
          small: data.contactPersonName ? `担当：${safeText(data.contactPersonName)}` : "",
        }
      case "tour_operator":
        return {
          label: "TOUR OPERATOR CONTACT / ランドオペレーター連絡先",
          value: data.contactPersonPhone,
          small: data.contactPersonName ? `担当：${safeText(data.contactPersonName)}` : "",
        }
      default:
        return {
          label: "CONTACT / お問い合わせ",
          value: data.supportPhone,
          small: `9:00 – 18:00 JST ・ ${data.supportEmail}`,
        }
    }
  })()

  return (
    <Page size="A4" style={vs.page} wrap={false}>
      {/* masthead */}
      <View style={vs.masthead}>
        <View>
          <Image style={logoSize(10)} src={LOGO_PATH} />
          <Text style={[vs.copyTag, zf]}>{jb(L.copyTag)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={vs.refLabel}>REF</Text>
          <Text style={vs.refValue}>{ref}</Text>
        </View>
      </View>

      {/* 区間バナー: どのホテルに渡す紙か一瞬で分かるようにする */}
      <View style={vs.legBanner}>
        <View>
          <Text style={[vs.lbKicker, zf]}>{jb(L.kicker)}</Text>
          <Text style={vs.lbLeg}>{`LEG ${legIndex + 1} / ${totalLegs}`}</Text>
        </View>
        <View style={vs.lbMain}>
          <Text style={vs.lbRoute}>{`${fromHotel} → ${toHotel}`}</Text>
          <View style={vs.lbDates}>
            <Text style={[vs.lbDateText, zf]}>
              {L.dropLabel}<Text style={vs.lbDateStrong}>{formatEnDate(shipment.shipmentDate)}</Text>
            </Text>
            <View style={vs.lbSep} />
            <Text style={[vs.lbDateText, zf]}>
              {L.pickLabel}<Text style={vs.lbDateStrong}>{formatEnDate(shipment.expectedArrival)}</Text>
            </Text>
          </View>
        </View>
      </View>

      {/* doc title + tracking module */}
      <View style={vs.docTitle}>
        <View>
          <Text style={vs.h1}>LUGGAGE FORWARDING{"\n"}VOUCHER</Text>
          <Text style={vs.h1Sub}>荷物配送引換証</Text>
        </View>
        <View style={vs.trackingModule}>
          <Text style={vs.tmHead}>TRACKING / 追跡</Text>
          {data.trackingQrDataUri ? (
            <Image style={vs.tmQr} src={data.trackingQrDataUri} />
          ) : (
            <Text style={{ fontSize: 6, color: INK_SOFT }}>
              bondex.express/track/{data.bookingId}
            </Text>
          )}
          <Text style={vs.tmCaption}>{jb("ここで荷物の配送状況がわかります")}</Text>
          <Text style={[vs.tmCaptionEn, zf]}>{jb(L.scanCaption)}</Text>
          <Text style={[vs.tmNote, zf]}>{jb(L.tmNote)}</Text>
        </View>
      </View>

      {/* present strip */}
      <View style={vs.presentStrip}>
        <CheckCircleIcon />
        <View style={vs.psWords}>
          <Text style={[vs.psEn, zf]}>{jb(L.present)}</Text>
          <Text style={vs.psJa}>{jb("お荷物のお預け時・お受け取り時に、本バウチャーを受付にご提示ください")}</Text>
        </View>
      </View>

      {/* journey */}
      <View style={vs.journey}>
        {/* DROP-OFF */}
        <View style={vs.legCard}>
          <Text style={[vs.legTab, { backgroundColor: RED }]}>DROP-OFF / お預け</Text>
          <View style={vs.legDateRow}>
            <Text style={vs.legDay}>{dayOfMonth(shipment.shipmentDate)}</Text>
            <Text style={vs.legMy}>{monthYear(shipment.shipmentDate)}</Text>
            <Text style={vs.legDow}>{dowLabel(shipment.shipmentDate)}</Text>
          </View>
          <Text style={vs.legHotelEn}>{fromHotel}</Text>
          {(shipment.from.address || shipment.from.city) !== "" && (
            <Text style={vs.legHotelAddr}>
              {jb(shipment.from.address) || jb(shipment.from.city)}
            </Text>
          )}
          <View style={vs.legWhen}>
            <Text style={[vs.legWhenEn, zf]}>{jb(dropWhenEn)}</Text>
            <Text style={vs.legWhenJa}>{jb("チェックアウトまでに受付へお預けください")}</Text>
          </View>
          {/* この用紙のお渡し先 */}
          <View style={vs.giveTo}>
            <Text style={[vs.gtEn, zf]}>{jb(L.giveTo)}</Text>
            <Text style={[vs.gtHotel, zf]}>
              {fromHotel} <Text style={vs.gtDate}>{jb(L.giveToDate(shipment.shipmentDate))}</Text>
            </Text>
            <Text style={vs.gtJa}>
              {jb("このバウチャーは ")}
              <Text style={vs.gtJaStrong}>{formatJpDate(shipment.shipmentDate)}</Text> に
              <Text style={vs.gtJaStrong}>{fromHotel}</Text>
              {jb("へお渡しください")}
            </Text>
          </View>
        </View>

        <View style={vs.journeyArrow}>
          <JourneyArrowIcon />
        </View>

        {/* PICK-UP */}
        <View style={vs.legCard}>
          <Text style={[vs.legTab, { backgroundColor: INK }]}>PICK-UP / お受け取り</Text>
          <View style={vs.legDateRow}>
            <Text style={vs.legDay}>{dayOfMonth(shipment.expectedArrival)}</Text>
            <Text style={vs.legMy}>{monthYear(shipment.expectedArrival)}</Text>
            <Text style={vs.legDow}>{dowLabel(shipment.expectedArrival)}</Text>
          </View>
          <Text style={vs.legHotelEn}>{toHotel}</Text>
          {(shipment.to.address || shipment.to.city) !== "" && (
            <Text style={vs.legHotelAddr}>
              {jb(shipment.to.address) || jb(shipment.to.city)}
            </Text>
          )}
          <View style={vs.legWhen}>
            <Text style={[vs.legWhenEn, zf]}>{jb(pickWhenEn)}</Text>
            <Text style={vs.legWhenJa}>{jb("チェックイン時にお受け取りいただけます")}</Text>
          </View>
        </View>
      </View>

      {/* detail grid */}
      <View style={vs.detailGrid}>
        <View style={vs.detailRow}>
          <View style={[vs.detailCell, { width: "25%" }]}>
            <Text style={vs.dk}>GUEST / ご予約者</Text>
            <Text style={vs.dv}>{guestName}</Text>
            <Text style={vs.dvSmall}>
              {data.groupName ? `${safeText(data.groupName)} ・ ` : ""}
              {data.travelerCount} guest{data.travelerCount === 1 ? "" : "s"} / {data.travelerCount}名様
            </Text>
          </View>
          <View style={[vs.detailCell, { width: "25%" }]}>
            <Text style={vs.dk}>LUGGAGE / お荷物</Text>
            <Text style={vs.dv}>
              {shipment.suitcaseCount} piece{shipment.suitcaseCount === 1 ? "" : "s"}
            </Text>
            <Text style={vs.dvSmall}>Total {totalLuggage} luggage</Text>
          </View>
          <View style={[vs.detailCell, { width: "25%" }]}>
            <Text style={vs.dk}>SERVICE TYPE / 種別</Text>
            <Text style={vs.dv}>{totalLegs > 1 ? "MULTI-LEG" : "SINGLE LEG"}</Text>
            <Text style={vs.dvSmall}>
              {totalLegs > 1 ? `Leg ${legIndex + 1} of ${totalLegs}` : "Point to Point"}
            </Text>
          </View>
          <View style={[vs.detailCell, { width: "25%" }]}>
            <Text style={vs.dk}>FORWARDED BY / 手配</Text>
            <Text style={vs.dv}>BondEx</Text>
          </View>
        </View>
        <View style={vs.detailRow}>
          {contactCell && (
            <View style={[vs.detailCell, { width: "50%" }]}>
              <Text style={vs.dk}>{contactCell.label}</Text>
              <Text style={vs.dv}>{contactCell.value}</Text>
              {contactCell.small !== "" && <Text style={vs.dvSmall}>{contactCell.small}</Text>}
            </View>
          )}
          <View style={[vs.detailCell, { width: contactCell ? "50%" : "100%" }]}>
            <Text style={vs.dk}>SUPPLIER / 配送業者</Text>
            <Text style={vs.dv}>{jb("Yamato Transport ヤマト運輸")}</Text>
            <Text style={vs.dvSmall}>
              Tel: {SUPPLIER_TEL_PLACEHOLDER}　*Japanese speaking only
            </Text>
          </View>
        </View>
      </View>

      {/* 旅程全体ミニ一覧 (複数区間のときのみ・補助情報) */}
      {totalLegs > 1 && (
        <View style={vs.routeList}>
          <Text style={[vs.rlHead, zf]}>{jb(L.routeHead)}</Text>
          {data.shipments.map((s, j) => {
            const current = j === legIndex
            const color = current ? RED_DARK : MUTED
            return (
              <View key={j} style={[vs.rlRow, ...(j > 0 ? [vs.rlRowBorder] : [])]}>
                <Text style={[vs.rlLeg, { color }]}>{`LEG ${j + 1} / ${totalLegs}`}</Text>
                <Text style={[vs.rlDate, { color }]}>{formatEnDateShort(s.shipmentDate)}</Text>
                <Text
                  style={[vs.rlRoute, { color }, ...(current ? [{ fontWeight: 700 as const }] : [])]}
                >
                  {`${jb(s.from.hotel)} → ${jb(s.to.hotel)}`}
                </Text>
                {current && <Text style={[vs.rlChip, zf]}>{jb(L.currentChip)}</Text>}
              </View>
            )
          })}
        </View>
      )}

      {/* staff alert (残余スペースを吸収して下部に寄せる) */}
      <View style={vs.staffAlert}>
        <AlertIcon />
        <View style={vs.saBody}>
          <Text style={vs.saHead}>
            ホテルご担当者様へ <Text style={vs.saHeadEn}>/ FOR HOTEL STAFF</Text>
          </Text>
          <Text style={vs.saText}>
            {jb("このお荷物は BondEx にて集荷依頼済みです。必ず 2 ページ目の「FOR HOTEL STAFF」をご確認ください。")}
          </Text>
          <Text style={vs.saTextEn}>Hotel staff: Please see page 2 before handling this luggage.</Text>
        </View>
      </View>

      {/* footer */}
      <View style={vs.p1Footer}>
        <View>
          <Text style={[vs.p1Co, vs.p1CoStrong]}>{data.companyName}</Text>
          <Text style={vs.p1Co}>{jb(data.companyAddress)}</Text>
          <Text style={vs.p1Co}>TEL: {data.supportPhone}</Text>
        </View>
        <View>
          <Text style={vs.nextPageNote}>
            PLEASE SEE PAGE 2 FOR HOTEL STAFF GUIDE <Text style={vs.nextPageArrow}>→</Text>
          </Text>
          <Text style={vs.nextPageNoteJa}>
            {jb("ホテル担当者様・次ページ「FOR HOTEL STAFF」をご確認ください")}
          </Text>
        </View>
      </View>
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Page 2 — FOR HOTEL STAFF (JP primary)
// ---------------------------------------------------------------------------

function FlowStep({ num, main, sub, color }: { num: string; main: string; sub?: string; color: string }) {
  return (
    <View style={vs.flowStep}>
      <View style={[vs.flowNum, { backgroundColor: color }]}>
        <Text style={vs.flowNumText}>{num}</Text>
      </View>
      <View style={vs.flowStepBody}>
        <Text style={vs.flowStepMain}>{jb(main)}</Text>
        {sub ? <Text style={vs.flowStepSub}>{jb(sub)}</Text> : null}
      </View>
    </View>
  )
}

function LookupGrid({
  guestName,
  checkIn,
  nights,
  travelerCount,
}: {
  guestName: string
  checkIn?: string
  nights: number | null
  travelerCount: number
}) {
  return (
    <View style={vs.lookupGrid}>
      <View style={vs.lookupRow}>
        <View style={[vs.lookupCell, vs.lookupCellL]}>
          <Text style={[vs.lk, vs.lkPrimary]}>GUEST NAME / ご予約者名</Text>
          <Text style={vs.lvPrimary}>{guestName}</Text>
        </View>
        <View style={[vs.lookupCell, vs.lookupCellR]}>
          <Text style={[vs.lk, vs.lkPrimary]}>CHECK-IN / チェックイン日</Text>
          <Text style={vs.lvPrimary}>
            {checkIn ? formatJpDate(checkIn) : "—"}
            {nights !== null ? <Text style={vs.lvNights}> ～{nights}泊</Text> : null}
          </Text>
        </View>
      </View>
      <View style={[vs.lookupRow, vs.lookupRow2]}>
        <View style={[vs.lookupCell, vs.lookupCellL]}>
          <Text style={vs.lk}>GUESTS / ご宿泊人数</Text>
          <Text style={vs.lv}>
            {travelerCount} guest{travelerCount === 1 ? "" : "s"}
          </Text>
        </View>
        <View style={[vs.lookupCell, vs.lookupCellR]}>
          <Text style={vs.lk}>ROOM NO. / お部屋番号</Text>
          <View style={vs.lvBlank} />
        </View>
      </View>
    </View>
  )
}

function HotelStaffPage({
  data,
  shipment,
  legIndex,
  totalLegs,
}: {
  data: VoucherInput
  shipment: VoucherShipment
  legIndex: number
  totalLegs: number
}) {
  const ref = voucherRefFor(data.bookingId, legIndex, totalLegs)
  const guestName = jb(shipment.bookingName) || jb(data.representativeLabel)
  const fromHotel = safeText(shipment.from.hotel)
  const toHotel = safeText(shipment.to.hotel)
  const nightsFrom = nightsBetween(shipment.fromCheckIn, shipment.shipmentDate)
  const nightsTo = nightsBetween(shipment.expectedArrival, shipment.toCheckOut)

  return (
    <Page size="A4" style={vs.page} wrap={false}>
      {/* masthead */}
      <View style={vs.masthead}>
        <View>
          <Image style={logoSize(8.6)} src={LOGO_PATH} />
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={vs.p2HeadTag}>
            FOR HOTEL STAFF <Text style={vs.p2HeadTagJa}>/ ホテルご担当者様へ</Text>
          </Text>
          <Text style={vs.p2Ref}>REFERENCE: {ref}</Text>
        </View>
      </View>

      <Text style={vs.leadStatement}>{jb("本バウチャーは、弊社にて集荷依頼済みの荷物配送サービスです。")}</Text>

      {/* 配送区間ストリップ: 見た瞬間に「この紙はこの区間の配送用」と分かる */}
      <View style={vs.legStrip}>
        <View>
          <Text style={vs.lsCap}>配送区間 / SEGMENT</Text>
          <Text style={vs.lsBadge}>{`LEG ${legIndex + 1} / ${totalLegs}`}</Text>
        </View>
        <View style={vs.lsGrid}>
          <View style={{ flex: 1.4 }}>
            <Text style={vs.lsK}>発送元</Text>
            <Text style={vs.lsV}>{fromHotel}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={vs.lsK}>発送日</Text>
            <Text style={vs.lsV}>{formatJpDate(shipment.shipmentDate)}</Text>
          </View>
          <View style={{ flex: 1.4 }}>
            <Text style={vs.lsK}>到着先</Text>
            <Text style={vs.lsV}>{toHotel}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={vs.lsK}>到着日</Text>
            <Text style={vs.lsV}>{formatJpDate(shipment.expectedArrival)}</Text>
          </View>
        </View>
      </View>

      {/* notice cards */}
      <View style={vs.noticeRow}>
        <View style={[vs.noticeCard, vs.noticeCardAccent]}>
          <TruckIcon />
          <Text style={[vs.nTitle, vs.nTitleAccent]}>{jb("荷物は「出荷する荷物」としてお預かりください。")}</Text>
          <Text style={vs.nSub}>{jb("通常の出荷荷物と同じお取り扱いで結構です。")}</Text>
        </View>
        <View style={[vs.noticeCard, vs.noticeCardAccent, { marginLeft: mm(3) }]}>
          <YenIcon />
          <Text style={[vs.nTitle, vs.nTitleAccent]}>{jb("配送料は弊社が立て替え済みです。")}</Text>
          <Text style={vs.nSub}>{jb("宿泊者様からの料金徴収は不要です。")}</Text>
        </View>
        <View style={[vs.noticeCard, { marginLeft: mm(3) }]}>
          <CheckboxIcon />
          <Text style={vs.nTitle}>{jb("集荷は手配済みです。")}</Text>
          <Text style={vs.nSub}>{jb("配送業者のドライバーが集荷に伺います。お手続きは不要です。")}</Text>
        </View>
      </View>

      {/* flow */}
      <Text style={vs.flowTitle}>ご対応の流れ</Text>
      <View style={vs.flowCols}>
        <View style={vs.flowCol}>
          <Text style={[vs.flowColHead, { backgroundColor: RED }]}>
            <Text style={vs.flowColHeadNo}>01  </Text>
            {jb("発送元ホテル（ご出発ホテル）での対応")}
          </Text>
          <FlowStep color={RED} num="1" main="お客様がチェックアウト時に荷物をお持ち込み" sub="本バウチャーの内容をご確認ください" />
          <FlowStep color={RED} num="2" main="出荷する荷物としてお預かり" sub="フロント等で通常の出荷荷物と同様に保管" />
          <FlowStep color={RED} num="3" main="ドライバーが集荷に伺います" sub="バウチャー内容を確認します" />
          <FlowStep color={RED} num="4" main="荷物をドライバーへお渡し" sub="確認後、お渡しください" />
        </View>
        <View style={[vs.flowCol, { marginLeft: mm(3.5) }]}>
          <Text style={[vs.flowColHead, { backgroundColor: INK }]}>
            <Text style={vs.flowColHeadNo}>02  </Text>
            {jb("到着先ホテル（次のご宿泊ホテル）での対応")}
          </Text>
          <FlowStep color={INK} num="1" main="ドライバーが荷物をお届け" sub="ドライバーがバウチャー内容を確認します" />
          <FlowStep color={INK} num="2" main="到着荷物としてお預かり" sub="通常の荷物お預かりと同様に保管" />
          <FlowStep color={INK} num="3" main="お客様がチェックイン" />
          <FlowStep color={INK} num="4" main="荷物をお客様へお渡し" sub="バウチャー記載のご予約名でお渡しください" />
          <View style={vs.roomNote}>
            <Text style={vs.rnJa}>
              {jb("お部屋番号が確定している場合：お客様のチェックイン前に、可能であればお部屋までお運びいただけると幸いです。")}
            </Text>
            <Text style={vs.rnEn}>
              If the room number has already been assigned, please deliver the luggage to the guest room when possible.
            </Text>
          </View>
        </View>
      </View>

      {/* 予約検索パネル */}
      <View style={vs.hotelDetail}>
        <View style={vs.hdBlock}>
          <Text style={[vs.hdNo, { color: RED }]}>01 発送元</Text>
          <Text style={vs.hdHotel}>{fromHotel}{jb(" 様")}</Text>
          <LookupGrid
            guestName={guestName}
            checkIn={shipment.fromCheckIn}
            nights={nightsFrom}
            travelerCount={data.travelerCount}
          />
          <Text style={vs.hdNote}>
            {jb("チェックアウト時にお客様が、本バウチャーと")}
            <Text style={vs.hdNoteStrong}>{jb("お荷物と同じ枚数の印字済み送り状")}</Text>
            {jb("をお持ちになります。")}
            <Text style={vs.hdNoteStrong}>{jb("出荷する荷物")}</Text>
            {jb("としてお預かりのうえ、送り状とあわせて集荷ドライバーへお渡しください。")}
          </Text>
          {shipment.specialNote ? (
            <Text style={vs.hdSpecial}>・{jb(shipment.specialNote)}</Text>
          ) : null}
        </View>
        <View style={[vs.hdBlock, { marginLeft: mm(3.5) }]}>
          <Text style={[vs.hdNo, { color: INK }]}>02 発送先</Text>
          <Text style={vs.hdHotel}>{toHotel}{jb(" 様")}</Text>
          <LookupGrid
            guestName={guestName}
            checkIn={shipment.expectedArrival}
            nights={nightsTo}
            travelerCount={data.travelerCount}
          />
          <Text style={vs.hdNote}>
            <Text style={vs.hdNoteStrong}>{formatJpDate(shipment.expectedArrival)}</Text>
            {jb(" にスーツケースが届きます。")}
            <Text style={vs.hdNoteStrong}>{jb("到着済み荷物")}</Text>
            {jb("としてお預かりのうえ、チェックイン時にお客様へお渡しください。")}
          </Text>
        </View>
      </View>

      {/* contact strip */}
      <View style={vs.contactStrip}>
        <View style={vs.contactCell}>
          <Text style={vs.cK}>荷物配送手配業者 / FORWARDING OPERATOR</Text>
          <Text style={vs.cV}>{jb("BondEx サポートデスク")}</Text>
          <Text style={vs.cVSmall}>
            Email: {data.supportEmail} ／ TEL: {data.supportPhone}（9:00 – 18:00 JST）
          </Text>
        </View>
        <View style={[vs.contactCell, vs.contactCellR]}>
          <Text style={vs.cK}>ランドオペレーター / LAND OPERATOR</Text>
          <Text style={vs.cV}>{jb(data.tourCompany) || "—"}</Text>
          <Text style={vs.cVSmall}>
            TEL: {data.contactPersonPhone || "—"}
            {data.contactPersonName ? jb(`（担当：${data.contactPersonName}）`) : ""}
          </Text>
        </View>
      </View>

      {/* 営業バナー (広告枠) */}
      <View style={vs.adBanner}>
        <View style={vs.adMain}>
          <Text style={vs.adKicker}>
            ABOUT BONDEX <Text style={vs.adKickerSub}>／ ホテル様へのご案内</Text>
          </Text>
          <Text style={vs.adHeadline}>
            {jb("フロント業務はそのままに、")}
            <Text style={vs.adAccent}>{jb("ゲスト体験")}</Text>
            {jb("を一段上へ。")}
          </Text>
          <Text style={vs.adLead}>
            {jb("BondEx（ボンデックス）は、訪日旅行者のホテル間荷物配送を手配するサービスです。ゲストは大きなスーツケースを持たずに身軽に移動でき、その体験が貴館の滞在満足度につながります。")}
          </Text>
          <View style={vs.adPoints}>
            <View style={vs.adPoint}>
              <View style={vs.ptMark} />
              <Text style={vs.ptBody}>
                <Text style={vs.ptStrong}>{jb("伝票（送り状）の記入は不要")}</Text>
                {jb(" — 送り状は BondEx がすべて手配します。")}
              </Text>
            </View>
            <View style={[vs.adPoint, vs.adPointGap]}>
              <View style={vs.ptMark} />
              <Text style={vs.ptBody}>
                <Text style={vs.ptStrong}>{jb("決済はお客様ご自身でキャッシュレス")}</Text>
                {jb(" — 貴館での集金・立て替えはありません。")}
              </Text>
            </View>
            <View style={[vs.adPoint, vs.adPointGap]}>
              <View style={vs.ptMark} />
              <Text style={vs.ptBody}>
                <Text style={vs.ptStrong}>{jb("出荷方法は柔軟")}</Text>
                {jb(" — BondEx 手配の集荷でも、貴館の通常の出荷に載せていただいても構いません。")}
              </Text>
            </View>
          </View>
        </View>
        <View style={vs.adCta}>
          {data.partnerQrDataUri ? <Image style={vs.ctaQr} src={data.partnerQrDataUri} /> : null}
          <Text style={vs.ctaTitle}>{jb("パートナーホテル募集中")}</Text>
          <Text style={vs.ctaNote}>{jb("導入のご相談・詳細はこちらから")}</Text>
          <Text style={vs.ctaUrl}>{PARTNER_URL}</Text>
        </View>
      </View>

      {/* footer */}
      <View style={vs.p2Footer}>
        <Text style={vs.p2FooterText}>
          {jb(`${data.companyName} ／ ${data.companyAddress}`)}
        </Text>
        <Text style={vs.p2FooterText}>REFERENCE: {ref} ・ FOR HOTEL STAFF</Text>
      </View>
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Public components
// ---------------------------------------------------------------------------

export function VoucherDocument({ data }: { data: VoucherInput }) {
  const totalLegs = data.shipments.length
  return (
    <Document
      title={`BondEx Voucher ${data.bookingId}`}
      author={data.companyName}
      subject="Luggage Forwarding Voucher"
    >
      {/*
       * 1 区間 = 1 バウチャー (2 ページ):
       *   Page 1 (GUEST COPY)      — 旅行者向け。ホテルに渡す紙
       *   Page 2 (FOR HOTEL STAFF) — ホテル担当者様向け詳細案内
       * バウチャー番号は bookingId + 区間サフィックス (-A / -B / ...)
       */}
      {data.shipments.flatMap((shipment, i) => [
        <GuestPage key={`g-${i}`} data={data} shipment={shipment} legIndex={i} totalLegs={totalLegs} />,
        <HotelStaffPage key={`h-${i}`} data={data} shipment={shipment} legIndex={i} totalLegs={totalLegs} />,
      ])}
    </Document>
  )
}

// ---------------------------------------------------------------------------
// How to ship PDF — 旅行会社が行程表に同梱できる 1 枚もののゲスト向けガイド。
// 堀部さん提案 (2026-07-03) の内容: 必要なもの / ラベル確認ポイント /
// 渡し方 (貼らずにレセプションへ — ドライバーがタグホルダーで取り付け) /
// 追跡案内 / 天候遅延の注意 / 貴重品を入れない注意。
// 完全に静的 (予約データ不要)。言語は en / zh。
// ---------------------------------------------------------------------------

const HOWTO_L10N = {
  en: {
    docTag: "TRAVELER GUIDE",
    title: "HOW TO SHIP YOUR LUGGAGE",
    subtitle: "Hotel-to-hotel luggage forwarding — a 1-minute guide",
    needHead: "WHAT YOU NEED",
    needs: [
      { title: "Voucher", body: "The BondEx paper with the red band. One sheet per delivery." },
      { title: "Shipping label", body: "Printed label from your travel agency — one per bag." },
      { title: "Your luggage", body: "Packed and closed. Up to 160 cm / 25 kg per piece." },
    ],
    checkHead: "CHECK YOUR LABEL",
    checkSub: "Take 10 seconds to confirm these three points:",
    checks: [
      "The sender name is your group representative's name — it may differ from your own.",
      "The destination hotel is the right one.",
      "The arrival date matches your travel plan.",
    ],
    labelMockFrom: "FROM: Representative name",
    labelMockTo: "TO: Your next hotel",
    labelMockDate: "Arrival date",
    stepsHead: "3 EASY STEPS",
    steps: [
      { title: "Pack smart", body: "Keep passports, rail tickets, medicine and valuables WITH YOU — never inside the suitcase." },
      { title: "Hand over at reception", body: "At check-out, give the voucher and label(s) to the reception. Do not stick anything on your bag — the courier attaches the label with a tag holder." },
      { title: "Pick up at your next hotel", body: "Your luggage arrives on the date shown on the voucher. Collect it at the reception when you check in." },
    ],
    trackHead: "TRACK ANYTIME",
    trackBody: "Scan the QR code on your voucher to see the live delivery status of your luggage.",
    noticeHead: "GOOD TO KNOW",
    notices: [
      "Typhoons or severe weather may delay delivery to the next day. Avoid shipping bags you will need right before your departure flight.",
      "Questions? BondEx support: support@bondex.express (9:00 - 18:00 JST)",
    ],
  },
  zh: {
    docTag: "旅客指南 TRAVELER GUIDE",
    title: "行李托运指南",
    subtitle: "酒店到酒店行李配送 — 1 分钟读懂",
    needHead: "需要准备 WHAT YOU NEED",
    needs: [
      { title: "凭证 Voucher", body: "带红色横幅的 BondEx 凭证，每个配送区间一张。" },
      { title: "配送标签 Label", body: "旅行社提供的打印标签，每件行李一张。" },
      { title: "您的行李", body: "收拾好并关闭。每件最大 160 cm / 25 kg。" },
    ],
    checkHead: "确认标签 CHECK YOUR LABEL",
    checkSub: "请花 10 秒确认以下三点：",
    checks: [
      "寄件人姓名为团队代表的姓名，可能与您本人的姓名不同。",
      "目的地酒店正确无误。",
      "到达日期符合您的行程安排。",
    ],
    labelMockFrom: "FROM: 代表姓名",
    labelMockTo: "TO: 下一家酒店",
    labelMockDate: "到达日期",
    stepsHead: "简单三步 3 EASY STEPS",
    steps: [
      { title: "聪明打包", body: "护照、车票、药品等贵重物品请随身携带，切勿放入托运行李箱。" },
      { title: "在前台交付", body: "退房时，将凭证和标签交给酒店前台。无需粘贴 — 配送员会用标签夹将其固定在行李上。" },
      { title: "在下一家酒店领取", body: "行李将于凭证上标注的日期送达。办理入住时在前台领取即可。" },
    ],
    trackHead: "随时追踪 TRACK ANYTIME",
    trackBody: "扫描凭证上的二维码，即可查看行李的实时配送状态。",
    noticeHead: "温馨提示 GOOD TO KNOW",
    notices: [
      "台风等恶劣天气可能导致配送延迟至次日。临近回国航班前，请避免托运随后立即需要的行李。",
      "如有疑问请联系 BondEx: support@bondex.express (9:00 - 18:00 JST)",
    ],
  },
} as const

const ht = StyleSheet.create({
  page: {
    paddingTop: mm(11),
    paddingBottom: mm(9),
    paddingHorizontal: mm(14),
    fontFamily: "NotoSansJP",
    fontSize: 9,
    color: INK,
    backgroundColor: "#ffffff",
    flexDirection: "column",
  },
  zh: { fontFamily: "NotoSansSC" },
  docTag: { marginTop: mm(1.8), fontSize: 7.5, fontWeight: 700, letterSpacing: 1.1, color: RED },
  titleBand: { marginTop: mm(3.5) },
  title: { fontSize: 22, fontWeight: 700, lineHeight: 1.1 },
  subtitle: { fontSize: 9.5, color: INK_SOFT, marginTop: mm(1.4) },
  secHead: {
    marginTop: mm(5),
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: 1.2,
    color: RED,
    borderBottomWidth: mm(0.5),
    borderBottomColor: INK,
    paddingBottom: mm(1.2),
  },
  needsRow: { marginTop: mm(2.5), flexDirection: "row" },
  needCard: {
    flex: 1,
    borderWidth: mm(0.4),
    borderColor: INK,
    paddingVertical: mm(2.4),
    paddingHorizontal: mm(3),
  },
  needGap: { marginLeft: mm(3) },
  needTitle: { fontSize: 9.5, fontWeight: 700, marginTop: mm(1.6) },
  needBody: { fontSize: 7.2, color: INK_SOFT, lineHeight: 1.5, marginTop: mm(0.8) },
  checkWrap: { marginTop: mm(2.5), flexDirection: "row" },
  labelMock: {
    width: mm(62),
    borderWidth: mm(0.5),
    borderColor: INK,
  },
  labelMockHead: {
    backgroundColor: INK,
    color: "#ffffff",
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1,
    textAlign: "center",
    paddingVertical: mm(1.2),
  },
  lmRow: { flexDirection: "row", alignItems: "center", paddingVertical: mm(1.7), paddingHorizontal: mm(2.4), borderBottomWidth: mm(0.3), borderBottomColor: GRAY_LINE },
  lmText: { fontSize: 7, fontWeight: 700, flex: 1 },
  lmBarcode: { flexDirection: "row", justifyContent: "center", paddingVertical: mm(2), gap: 1.5 },
  checkList: { flex: 1, marginLeft: mm(4.5) },
  checkSub: { fontSize: 7.8, color: INK_SOFT, marginBottom: mm(1.8) },
  checkRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: mm(1.8) },
  checkBody: { flex: 1, fontSize: 8.2, lineHeight: 1.55, fontWeight: 700 },
  numDot: {
    width: mm(5),
    height: mm(5),
    borderRadius: mm(2.5),
    backgroundColor: RED,
    alignItems: "center",
    justifyContent: "center",
    marginRight: mm(2.2),
  },
  numDotText: { fontSize: 7.5, fontWeight: 700, color: "#ffffff", lineHeight: 1 },
  stepsRow: { marginTop: mm(2.5), flexDirection: "row" },
  stepCol: { flex: 1, backgroundColor: GRAY_BG, paddingVertical: mm(2.6), paddingHorizontal: mm(3) },
  stepGap: { marginLeft: mm(3) },
  stepTitle: { fontSize: 9.5, fontWeight: 700, marginTop: mm(1.6) },
  stepBody: { fontSize: 7.2, color: INK_SOFT, lineHeight: 1.55, marginTop: mm(0.9) },
  bottomRow: { marginTop: mm(5), flexDirection: "row", alignItems: "stretch" },
  trackBox: {
    width: mm(66),
    borderWidth: mm(0.5),
    borderColor: RED,
    backgroundColor: RED_TINT,
    paddingVertical: mm(2.4),
    paddingHorizontal: mm(3),
  },
  trackHead: { fontSize: 7.5, fontWeight: 700, letterSpacing: 0.8, color: RED_DARK },
  trackBody: { fontSize: 7.2, lineHeight: 1.55, marginTop: mm(1), color: INK },
  noticeBox: { flex: 1, marginLeft: mm(3.5), borderTopWidth: mm(0.8), borderTopColor: INK, paddingTop: mm(1.8) },
  noticeHead: { fontSize: 7.5, fontWeight: 700, letterSpacing: 0.8, color: INK },
  noticeRowHt: { flexDirection: "row", alignItems: "flex-start", marginTop: mm(1.4) },
  noticeMark: { width: mm(1.7), height: mm(1.7), backgroundColor: RED, marginTop: mm(1), marginRight: mm(2) },
  noticeText: { flex: 1, fontSize: 7.2, color: INK_SOFT, lineHeight: 1.55 },
  htFooter: {
    marginTop: "auto",
    paddingTop: mm(2),
    borderTopWidth: mm(0.3),
    borderTopColor: GRAY_LINE,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  htFooterText: { fontSize: 6.5, color: MUTED },
})

function VoucherMiniIcon() {
  return (
    <Svg width={mm(7)} height={mm(7)} viewBox="0 0 28 28">
      <Rect x={3} y={4} width={22} height={20} stroke={INK} strokeWidth={1.6} fill="#ffffff" />
      <Rect x={3} y={4} width={22} height={5} fill={RED} />
      <Path d="M7 14h14M7 18h10" stroke={INK} strokeWidth={1.4} opacity={0.45} strokeLinecap="round" />
    </Svg>
  )
}
function LabelMiniIcon() {
  return (
    <Svg width={mm(7)} height={mm(7)} viewBox="0 0 28 28">
      <Rect x={4} y={3} width={20} height={22} stroke={INK} strokeWidth={1.6} fill="#ffffff" />
      <Path d="M8 8h12M8 12h9" stroke={INK} strokeWidth={1.4} opacity={0.45} strokeLinecap="round" />
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <Rect key={k} x={8 + k * 2.4} y={16} width={k % 2 === 0 ? 1.6 : 1} height={6} fill={INK} opacity={0.7} />
      ))}
    </Svg>
  )
}
function LuggageMiniIcon() {
  return (
    <Svg width={mm(7)} height={mm(7)} viewBox="0 0 28 28">
      <Rect x={6} y={9} width={16} height={15} rx={2} stroke={INK} strokeWidth={1.6} fill="#ffffff" />
      <Path d="M10 9V6.5a4 4 0 0 1 8 0V9" stroke={INK} strokeWidth={1.6} fill="none" />
      <Path d="M11 13v7M17 13v7" stroke={RED} strokeWidth={1.4} strokeLinecap="round" />
    </Svg>
  )
}
function QrMiniIcon() {
  return (
    <Svg width={mm(8)} height={mm(8)} viewBox="0 0 28 28">
      <Rect x={3} y={3} width={22} height={22} stroke={RED_DARK} strokeWidth={1.6} fill="#ffffff" />
      <Rect x={7} y={7} width={5} height={5} fill={RED_DARK} />
      <Rect x={16} y={7} width={5} height={5} fill={RED_DARK} />
      <Rect x={7} y={16} width={5} height={5} fill={RED_DARK} />
      <Rect x={16} y={16} width={2.4} height={2.4} fill={RED_DARK} />
      <Rect x={19.5} y={19.5} width={2.4} height={2.4} fill={RED_DARK} />
    </Svg>
  )
}

export function HowToShipDocument({ language }: { language: GuestLanguage }) {
  const L = HOWTO_L10N[language]
  const zf = language === "zh" ? ht.zh : {}
  const NEED_ICONS = [<VoucherMiniIcon key="v" />, <LabelMiniIcon key="l" />, <LuggageMiniIcon key="b" />]
  return (
    <Document title={`BondEx How to Ship (${language.toUpperCase()})`} author="BondEx" subject="How to ship guide">
      <Page size="A4" style={[ht.page, zf]} wrap={false}>
        {/* masthead */}
        <View style={vs.masthead}>
          <View>
            <Image style={logoSize(10)} src={LOGO_PATH} />
            <Text style={[ht.docTag, zf]}>{jb(L.docTag)}</Text>
          </View>
        </View>

        <View style={ht.titleBand}>
          <Text style={[ht.title, zf]}>{jb(L.title)}</Text>
          <Text style={[ht.subtitle, zf]}>{jb(L.subtitle)}</Text>
        </View>

        {/* 必要なもの */}
        <Text style={[ht.secHead, zf]}>{jb(L.needHead)}</Text>
        <View style={ht.needsRow}>
          {L.needs.map((n, i) => (
            <View key={i} style={[ht.needCard, ...(i > 0 ? [ht.needGap] : [])]}>
              {NEED_ICONS[i]}
              <Text style={[ht.needTitle, zf]}>{jb(n.title)}</Text>
              <Text style={[ht.needBody, zf]}>{jb(n.body)}</Text>
            </View>
          ))}
        </View>

        {/* ラベル確認 */}
        <Text style={[ht.secHead, zf]}>{jb(L.checkHead)}</Text>
        <View style={ht.checkWrap}>
          <View style={ht.labelMock}>
            <Text style={ht.labelMockHead}>SHIPPING LABEL</Text>
            <View style={ht.lmRow}>
              <View style={ht.numDot}><Text style={ht.numDotText}>1</Text></View>
              <Text style={[ht.lmText, zf]}>{jb(L.labelMockFrom)}</Text>
            </View>
            <View style={ht.lmRow}>
              <View style={ht.numDot}><Text style={ht.numDotText}>2</Text></View>
              <Text style={[ht.lmText, zf]}>{jb(L.labelMockTo)}</Text>
            </View>
            <View style={ht.lmRow}>
              <View style={ht.numDot}><Text style={ht.numDotText}>3</Text></View>
              <Text style={[ht.lmText, zf]}>{jb(L.labelMockDate)}</Text>
            </View>
            <View style={ht.lmBarcode}>
              {[...Array(18)].map((_, k) => (
                <View key={k} style={{ width: k % 3 === 0 ? 1.8 : 1, height: mm(6), backgroundColor: INK, opacity: 0.75 }} />
              ))}
            </View>
          </View>
          <View style={ht.checkList}>
            <Text style={[ht.checkSub, zf]}>{jb(L.checkSub)}</Text>
            {L.checks.map((c, i) => (
              <View key={i} style={ht.checkRow}>
                <View style={ht.numDot}><Text style={ht.numDotText}>{i + 1}</Text></View>
                <Text style={[ht.checkBody, zf]}>{jb(c)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 3 ステップ */}
        <Text style={[ht.secHead, zf]}>{jb(L.stepsHead)}</Text>
        <View style={ht.stepsRow}>
          {L.steps.map((s, i) => (
            <View key={i} style={[ht.stepCol, ...(i > 0 ? [ht.stepGap] : [])]}>
              <View style={ht.numDot}><Text style={ht.numDotText}>{i + 1}</Text></View>
              <Text style={[ht.stepTitle, zf]}>{jb(s.title)}</Text>
              <Text style={[ht.stepBody, zf]}>{jb(s.body)}</Text>
            </View>
          ))}
        </View>

        {/* 追跡 + 注意 */}
        <View style={ht.bottomRow}>
          <View style={ht.trackBox}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <QrMiniIcon />
              <Text style={[ht.trackHead, zf, { marginLeft: mm(2) }]}>{jb(L.trackHead)}</Text>
            </View>
            <Text style={[ht.trackBody, zf]}>{jb(L.trackBody)}</Text>
          </View>
          <View style={ht.noticeBox}>
            <Text style={[ht.noticeHead, zf]}>{jb(L.noticeHead)}</Text>
            {L.notices.map((n, i) => (
              <View key={i} style={ht.noticeRowHt}>
                <View style={ht.noticeMark} />
                <Text style={[ht.noticeText, zf]}>{jb(n)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={ht.htFooter}>
          <Text style={[ht.htFooterText, zf]}>{jb("株式会社JOJO ／ BondEx — bondex.express")}</Text>
          <Text style={ht.htFooterText}>HOW TO SHIP ・ {language.toUpperCase()}</Text>
        </View>
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Operations PDF: 内部記録用、簡素版 (デザイン刷新の対象外)
// ---------------------------------------------------------------------------

const ops = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontFamily: "NotoSansJP",
    fontSize: 9.5,
    color: "#0F0F0F",
    backgroundColor: "#FFFFFF",
    lineHeight: 1.5,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  logo: { width: 180, height: 36.4 },
  headerSubtitle: { fontSize: 9, color: "#7A7A7A", marginTop: 6, letterSpacing: 0.3 },
  topRule: { height: 2, backgroundColor: "#1A1A1A", marginTop: 16 },
  kvRow: { flexDirection: "row", marginBottom: 6 },
  kvKey: { width: 130, fontSize: 10, fontWeight: 500, color: "#0F0F0F" },
  kvValue: { flex: 1, fontSize: 10, color: "#0F0F0F" },
  legHeader: {
    fontSize: 11,
    fontWeight: 500,
    color: "#0F0F0F",
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E5E5",
    marginBottom: 6,
    marginTop: 10,
  },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 44,
    right: 44,
    borderTopWidth: 0.5,
    borderTopColor: "#E5E5E5",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerCompany: { fontSize: 8.5, fontWeight: 500, color: "#0F0F0F", marginBottom: 2 },
  footerLine: { fontSize: 7.5, color: "#7A7A7A", lineHeight: 1.4 },
  footerPage: { fontSize: 7.5, color: "#7A7A7A" },
})

export function OperationsDocument({ data }: { data: VoucherInput }) {
  return (
    <Document
      title={`BondEx Ops ${data.bookingId}`}
      author={data.companyName}
      subject="Operations Sheet"
    >
      <Page size="A4" style={ops.page}>
        <View style={ops.headerRow}>
          <View>
            <Image style={ops.logo} src={LOGO_PATH} />
            <Text style={ops.headerSubtitle}>OPERATIONS · {data.bookingId}</Text>
          </View>
        </View>
        <View style={ops.topRule} />
        <View style={{ height: 16 }} />

        <View style={ops.kvRow}>
          <Text style={ops.kvKey}>Issued</Text>
          <Text style={ops.kvValue}>{data.issuedDate}</Text>
        </View>
        <View style={ops.kvRow}>
          <Text style={ops.kvKey}>Representative</Text>
          <Text style={ops.kvValue}>{safeText(data.representativeLabel)}</Text>
        </View>
        {data.groupName && (
          <View style={ops.kvRow}>
            <Text style={ops.kvKey}>Group / family name</Text>
            <Text style={ops.kvValue}>{safeText(data.groupName)}</Text>
          </View>
        )}
        <View style={ops.kvRow}>
          <Text style={ops.kvKey}>Tour company</Text>
          <Text style={ops.kvValue}>{safeText(data.tourCompany)}</Text>
        </View>
        {data.tourNumber && (
          <View style={ops.kvRow}>
            <Text style={ops.kvKey}>Tour number</Text>
            <Text style={ops.kvValue}>{data.tourNumber}</Text>
          </View>
        )}
        <View style={ops.kvRow}>
          <Text style={ops.kvKey}>Travelers</Text>
          <Text style={ops.kvValue}>{data.travelerCount}</Text>
        </View>
        <View style={ops.kvRow}>
          <Text style={ops.kvKey}>Total billing</Text>
          <Text style={ops.kvValue}>¥{data.totalAmount.toLocaleString()}</Text>
        </View>

        {data.shipments.map((s, i) => (
          <View key={i} style={{ marginTop: 14 }}>
            <Text style={ops.legHeader}>
              Leg {i + 1} of {data.shipments.length} — Voucher Ref:{" "}
              {voucherRefFor(data.bookingId, i, data.shipments.length)}
            </Text>
            <View style={ops.kvRow}>
              <Text style={ops.kvKey}>Ship out</Text>
              <Text style={ops.kvValue}>{s.shipmentDate}</Text>
            </View>
            <View style={ops.kvRow}>
              <Text style={ops.kvKey}>Expected arrival</Text>
              <Text style={ops.kvValue}>{s.expectedArrival}</Text>
            </View>
            <View style={ops.kvRow}>
              <Text style={ops.kvKey}>From</Text>
              <Text style={ops.kvValue}>
                {safeText(s.from.hotel)} — {s.from.address || s.from.city}
              </Text>
            </View>
            <View style={ops.kvRow}>
              <Text style={ops.kvKey}>To</Text>
              <Text style={ops.kvValue}>
                {safeText(s.to.hotel)} — {s.to.address || s.to.city}
              </Text>
            </View>
            <View style={ops.kvRow}>
              <Text style={ops.kvKey}>Recipient</Text>
              <Text style={ops.kvValue}>{s.recipient}</Text>
            </View>
            <View style={ops.kvRow}>
              <Text style={ops.kvKey}>Suitcases</Text>
              <Text style={ops.kvValue}>
                {s.suitcaseCount} × ¥5,000 = ¥{(s.suitcaseCount * 5000).toLocaleString()}
              </Text>
            </View>
          </View>
        ))}

        <View style={ops.footer} fixed>
          <View>
            <Text style={ops.footerCompany}>{data.companyName}</Text>
            <Text style={ops.footerLine}>{data.companyAddress}</Text>
          </View>
          <Text
            style={ops.footerPage}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const SUPPORT_DEFAULTS = {
  phone: "+81-XX-XXXX-XXXX",
  email: BONDEX_SUPPORT_EMAIL,
  contactPersonName: "谷口",
  companyName: "株式会社JOJO",
  companyAddress: "〒158-0092 東京都世田谷区野毛1-9-12",
}

export function generateBookingId(): string {
  const now = new Date()
  const yy = String(now.getFullYear() % 100).padStart(2, "0")
  const mm2 = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const rand = Math.floor(100 + Math.random() * 900)
  return `BDX-${yy}${mm2}${dd}-${rand}`
}

export function formatIssuedDate(d: Date = new Date()): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}
