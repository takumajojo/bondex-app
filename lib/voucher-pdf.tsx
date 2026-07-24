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
import type { GuestLanguage } from "./guest-language"
import { normalizeGuestLanguage } from "./guest-language"
import { carrierConfig } from "./carrier"

// 外部モジュール向けの再エクスポート (これまで通り "@/lib/voucher-pdf" から import 可能)。
export type { GuestLanguage } from "./guest-language"
export { normalizeGuestLanguage } from "./guest-language"

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
// Text safety: マクロン (長音記号 Ō/Ū 等・ローマ字表記の日本語地名/人名で使用)
// のみを除去する。NotoSansJP はマクロン合成 (基底文字 + 結合マクロン) の描画に
// 依然対応していないため、Ōsaka → Osaka のように基底文字へ落とす。
// 除去対象を U+0304 (combining macron) のみに絞り、NFC で再合成することで、
// 仏・伊・西語などの通常のアクセント文字 (é, à, ñ, ç 等) は保持する。
// (旧実装は結合ダイアクリティカルマーク全域 [U+0300-U+036F] を除去しており、
//  多言語対応時にフランス語等のアクセントまで消える不具合があった)
// ---------------------------------------------------------------------------
function safeText(input?: string | null): string {
  if (!input) return ""
  return input.normalize("NFD").replace(/\u0304/g, "").normalize("NFC")
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
  /** 配送キャリア (sagawa/yamato)。SUPPLIER 欄に印字。未指定は既定 (佐川)。 */
  carrier?: string
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
  /** ゲスト向けページの言語 (既定: en)。zh = 簡体字。繁体字は同じ仕組みで追加可。 */
  guestLanguage?: GuestLanguage
  /** 問い合わせ QR (data URI)。BONDEX_WHATSAPP_URL 設定時は WhatsApp、
   *  未設定時は mailto:support@ のフォールバック。ルート側で生成。 */
  supportQrDataUri?: string
  supportQrKind?: "whatsapp" | "email"
  /** バウチャー末尾に「How to use this service」ガイドを 1 枚同梱するか。
   *  既定 = 同梱する (undefined/true)。false のときだけ省く。
   *  区間が何本でもガイドは常に 1 枚 (区間ごとには増えない)。 */
  includeHowto?: boolean
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
    paddingTop: mm(8),
    paddingBottom: mm(5.5),
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
    paddingBottom: mm(1.6),
    borderBottomWidth: mm(0.8),
    borderBottomColor: INK,
  },
  copyTag: {
    marginTop: mm(1.4),
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 1.1,
    color: RED,
  },
  refLabel: { fontSize: 6.5, letterSpacing: 1.8, color: MUTED },
  refValue: { fontSize: 11, fontWeight: 700, marginTop: mm(0.6) },

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
    width: mm(40),
    borderWidth: mm(0.5),
    borderColor: INK,
    paddingBottom: mm(1.4),
    alignItems: "center",
  },
  tmHead: {
    alignSelf: "stretch",
    backgroundColor: RED,
    color: "#ffffff",
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1.4,
    paddingVertical: mm(1),
    textAlign: "center",
    marginBottom: mm(1.2),
  },
  tmQr: { width: mm(10), height: mm(10) },
  tmCaption: { fontSize: 6.5, fontWeight: 700, marginTop: mm(1), textAlign: "center" },
  tmCaptionEn: { fontSize: 5.5, color: INK_SOFT, marginTop: mm(0.3), textAlign: "center" },
  tmNote: {
    fontSize: 4.4,
    color: MUTED,
    marginTop: mm(0.7),
    lineHeight: 1.3,
    textAlign: "center",
    paddingHorizontal: mm(1.5),
  },

  // ---------------- present strip ----------------
  presentStrip: {
    marginTop: mm(1.4),
    borderWidth: mm(0.5),
    borderColor: INK,
    paddingVertical: mm(1.3),
    paddingHorizontal: mm(5),
    flexDirection: "row",
    alignItems: "center",
  },
  psWords: { marginLeft: mm(4), flex: 1 },
  psEn: { fontSize: 8.5, fontWeight: 700 },
  psJa: { fontSize: 7, color: INK_SOFT, marginTop: mm(0.4) },

  // ---------------- journey ----------------
  journey: { marginTop: mm(2.2), flexDirection: "row", alignItems: "stretch" },
  legCard: {
    flex: 1,
    borderWidth: mm(0.5),
    borderColor: INK,
    paddingHorizontal: mm(5),
    paddingTop: mm(3.5),
    paddingBottom: mm(2),
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
    paddingBottom: mm(1.6),
  },
  legDay: { fontSize: 15, fontWeight: 700, lineHeight: 1 },
  legMy: { fontSize: 8, fontWeight: 700, letterSpacing: 0.5, marginLeft: mm(2.5), marginBottom: 2 },
  legDow: { fontSize: 7.5, color: RED, fontWeight: 700, marginLeft: mm(2.5), marginBottom: 2 },
  legHotelEn: { fontSize: 11, fontWeight: 700, lineHeight: 1.15, marginTop: mm(1.4) },
  legWhen: { marginTop: "auto", paddingTop: mm(1.2) },
  legWhenEn: { fontSize: 7, fontWeight: 700, lineHeight: 1.35 },
  legWhenJa: { fontSize: 7, color: INK_SOFT, lineHeight: 1.35 },
  journeyArrow: {
    width: mm(12),
    alignItems: "center",
    justifyContent: "center",
  },

  // ---------------- detail grid ----------------
  detailGrid: {
    marginTop: mm(2.2),
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
    paddingVertical: mm(0.9),
    paddingHorizontal: mm(3.5),
    minHeight: mm(7),
  },
  dk: { fontSize: 6, letterSpacing: 0.9, color: MUTED },
  dv: { fontSize: 9.5, fontWeight: 700, marginTop: mm(0.9), lineHeight: 1.2 },
  dvSmall: { fontSize: 6.6, fontWeight: 400, color: INK_SOFT, marginTop: mm(0.4) },

  // ---------------- route list ----------------
  routeList: {
    marginTop: mm(1.6),
    borderWidth: mm(0.4),
    borderColor: GRAY_LINE,
    paddingVertical: mm(1),
    paddingHorizontal: mm(3),
  },
  rlHead: { fontSize: 6, fontWeight: 700, letterSpacing: 1.1, color: MUTED },
  rlRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: mm(0.4),
    paddingBottom: mm(0.3),
  },
  rlRowBorder: { borderTopWidth: mm(0.3), borderTopColor: GRAY_LINE },
  rlLeg: { width: mm(15), fontSize: 6.5, fontWeight: 700, color: MUTED },
  rlDate: { width: mm(11), fontSize: 6.5, fontWeight: 700, color: MUTED, marginLeft: mm(3) },
  rlRoute: { flex: 1, fontSize: 6.5, color: MUTED, marginLeft: mm(3) },
  rlChip: {
    backgroundColor: RED,
    color: "#ffffff",
    fontSize: 5.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    paddingVertical: mm(0.5),
    paddingHorizontal: mm(1.8),
  },

  // ---------------- guest→hotel-staff 区切りバー (1枚化) ----------------
  staffDivider: {
    marginTop: mm(1.8),
    backgroundColor: INK,
    paddingVertical: mm(1.2),
    paddingHorizontal: mm(4),
  },
  sdLabel: { fontSize: 8, fontWeight: 700, color: "#ffffff", letterSpacing: 0.5 },
  sdLabelEn: { fontWeight: 700, color: "#c4c4cb", letterSpacing: 0.8 },

  // ---------------- flow ----------------
  flowTitle: {
    marginTop: mm(2),
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 1.3,
    color: MUTED,
  },
  flowCols: { marginTop: mm(1.6), flexDirection: "row" },
  flowCol: {
    flex: 1,
    borderWidth: mm(0.4),
    borderColor: GRAY_LINE,
    paddingVertical: mm(1.5),
    paddingHorizontal: mm(3),
  },
  flowColHead: {
    alignSelf: "flex-start",
    fontSize: 7.5,
    fontWeight: 700,
    color: "#ffffff",
    paddingVertical: mm(0.9),
    paddingHorizontal: mm(3),
    marginBottom: mm(1.4),
  },
  flowColHeadNo: { letterSpacing: 0.6, color: "#f0c3cb" },
  flowStep: { flexDirection: "row", marginBottom: mm(1) },
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
  flowStepMain: { fontSize: 7.2, fontWeight: 700, lineHeight: 1.3 },
  flowStepSub: { fontSize: 6.5, color: INK_SOFT, lineHeight: 1.3 },

  roomNote: {
    marginTop: mm(1.2),
    backgroundColor: GRAY_BG,
    borderLeftWidth: mm(0.8),
    borderLeftColor: INK,
    paddingVertical: mm(1),
    paddingHorizontal: mm(2.5),
  },
  rnJa: { fontSize: 6.5, fontWeight: 700, lineHeight: 1.35 },
  rnEn: { fontSize: 6, color: INK_SOFT, fontWeight: 400 },

  // ---------------- hotel detail (予約検索パネル) ----------------
  hotelDetail: { marginTop: mm(1.2), flexDirection: "row" },
  hdBlock: {
    flex: 1,
    backgroundColor: GRAY_BG,
    paddingVertical: mm(1.6),
    paddingHorizontal: mm(3.2),
  },
  hdNo: { fontSize: 7, fontWeight: 700, letterSpacing: 0.8 },
  hdHotel: { fontSize: 9, fontWeight: 700, marginTop: mm(0.5) },
  lookupGrid: {
    marginTop: mm(2),
    backgroundColor: "#ffffff",
    borderWidth: mm(0.4),
    borderColor: INK,
    flexDirection: "row",
  },
  lookupCell: {
    paddingVertical: mm(0.8),
    paddingHorizontal: mm(2.2),
  },
  lookupCellName: { width: "42%" },
  lookupCellNameWide: { width: "78%" }, // 日付欄が無い時 (発送元・チェックアウト日なし)
  lookupCellCheckin: { width: "36%", borderLeftWidth: mm(0.3), borderLeftColor: GRAY_LINE },
  lookupCellRoom: { width: "22%", borderLeftWidth: mm(0.3), borderLeftColor: GRAY_LINE },
  lk: { fontSize: 5.3, letterSpacing: 0.4, color: MUTED, lineHeight: 1.3 },
  lkPrimary: { color: RED_DARK, fontWeight: 700 },
  lv: { fontSize: 8.5, fontWeight: 700, marginTop: mm(0.5), lineHeight: 1.2 },
  lvPrimary: { fontSize: 9, fontWeight: 700, marginTop: mm(0.5), lineHeight: 1.2 },
  lvNights: { fontSize: 7, color: INK_SOFT, fontWeight: 700 },
  lvBlank: {
    marginTop: mm(0.5),
    minHeight: mm(3.5),
    borderBottomWidth: mm(0.3),
    borderBottomColor: MUTED,
  },
  hdNote: { marginTop: mm(1), fontSize: 6.3, lineHeight: 1.35, color: INK_SOFT },
  hdNoteStrong: { color: INK, fontWeight: 700 },
  hdSpecial: { marginTop: mm(1), fontSize: 7, color: RED_DARK, fontWeight: 700, lineHeight: 1.5 },

  // ---------------- contact strip ----------------
  contactStrip: {
    marginTop: mm(1.6),
    borderWidth: mm(0.5),
    borderColor: INK,
    flexDirection: "row",
  },
  contactCell: {
    flex: 1,
    paddingVertical: mm(0.9),
    paddingHorizontal: mm(3.5),
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
  },
  contactCellR: { borderLeftWidth: mm(0.5), borderLeftColor: INK },
  cK: { fontSize: 6, letterSpacing: 0.7, color: MUTED },
  cV: { fontSize: 7.2, fontWeight: 700, lineHeight: 1.3, marginLeft: mm(2) },
  cVSmall: { fontSize: 6.4, fontWeight: 400, color: INK_SOFT, marginLeft: mm(1.5) },

  // ---------------- footer (1枚化: guest/hotel 共通) ----------------
  finalFooter: {
    marginTop: mm(1),
    paddingTop: mm(1.2),
    borderTopWidth: mm(0.3),
    borderTopColor: GRAY_LINE,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  footerText: { fontSize: 6.2, color: MUTED },
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
    scanCaption: "Live status",
    tmNote: "* May take a few hours to update.",
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
    scanCaption: "实时状态",
    tmNote: "* 更新可能需数小时。",
    routeHead: "YOUR LUGGAGE ROUTE ／ 行李路线",
    currentChip: "CURRENT ／ 本张凭证",
  },
  it: {
    copyTag: "GUEST COPY / Copia ospite",
    kicker: "QUESTO VOUCHER È PER",
    dropLabel: "Consegna: ",
    pickLabel: "Ritiro: ",
    present: "Si prega di mostrare questo voucher alla reception al momento della consegna e del ritiro del bagaglio.",
    dropWhen: (t?: string) => `Alla reception dell'hotel ・ entro ${t || "il check-out"}`,
    pickWhen: (t?: string) => `Alla reception dell'hotel ・ ${t || "al check-in"}`,
    scanCaption: "Stato in tempo reale",
    tmNote: "* Aggiornamento entro alcune ore.",
    routeHead: "IL TUO PERCORSO BAGAGLI ／ 旅程全体",
    currentChip: "ATTUALE ／ この用紙",
  },
  fr: {
    copyTag: "GUEST COPY / Copie client",
    kicker: "CE BON EST POUR",
    dropLabel: "Dépôt : ",
    pickLabel: "Retrait : ",
    present: "Veuillez présenter ce bon à la réception lors du dépôt et du retrait de vos bagages.",
    dropWhen: (t?: string) => `À la réception de l'hôtel ・ avant ${t || "le départ"}`,
    pickWhen: (t?: string) => `À la réception de l'hôtel ・ ${t || "à l'arrivée"}`,
    scanCaption: "État en direct",
    tmNote: "* Mise à jour sous quelques heures.",
    routeHead: "VOTRE ITINÉRAIRE BAGAGES ／ 旅程全体",
    currentChip: "ACTUEL ／ この用紙",
  },
  es: {
    copyTag: "GUEST COPY / Copia del huésped",
    kicker: "ESTE COMPROBANTE ES PARA",
    dropLabel: "Entrega: ",
    pickLabel: "Recogida: ",
    present: "Por favor, presente este comprobante en la recepción al entregar y recoger su equipaje.",
    dropWhen: (t?: string) => `En la recepción del hotel ・ antes de ${t || "la salida"}`,
    pickWhen: (t?: string) => `En la recepción del hotel ・ ${t || "al registrarse"}`,
    scanCaption: "Estado en vivo",
    tmNote: "* Actualización en algunas horas.",
    routeHead: "SU RUTA DE EQUIPAJE ／ 旅程全体",
    currentChip: "ACTUAL ／ この用紙",
  },
} as const

// ---------------------------------------------------------------------------
// Page 1 — GUEST COPY (guest language primary / JP secondary)
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
  dateEn,
  dateJa,
  dateValue,
}: {
  guestName: string
  // 日付欄 (任意)。dateValue がある時だけ表示 (発送先のチェックアウト日など)。
  dateEn?: string
  dateJa?: string
  dateValue?: string
}) {
  const showDate = !!(dateValue && dateEn)
  return (
    <View style={vs.lookupGrid}>
      <View style={[vs.lookupCell, showDate ? vs.lookupCellName : vs.lookupCellNameWide]}>
        <Text style={[vs.lk, vs.lkPrimary]}>GUEST NAME{"\n"}ご予約者名</Text>
        <Text style={vs.lvPrimary}>{guestName}</Text>
      </View>
      {showDate && (
        <View style={[vs.lookupCell, vs.lookupCellCheckin]}>
          <Text style={[vs.lk, vs.lkPrimary]}>{dateEn}{"\n"}{dateJa}</Text>
          <Text style={vs.lvPrimary}>{formatJpDate(dateValue!)}</Text>
        </View>
      )}
      <View style={[vs.lookupCell, vs.lookupCellRoom]}>
        <Text style={vs.lk}>ROOM NO.{"\n"}お部屋番号</Text>
        <View style={vs.lvBlank} />
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Voucher page — 1 区間 = 1 バウチャー = 1 ページ (1枚化, 2026-07)
// 上半分: GUEST COPY (ゲスト言語 primary / JP secondary)
// 下半分: FOR HOTEL STAFF (JP primary)
// デザインは design/voucher/voucher.html の移植 — 変更時は必ず先にそちらを更新すること。
// ---------------------------------------------------------------------------

function VoucherPage({
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
  const fromHotelJa = safeText(shipment.from.hotel)
  const toHotelJa = safeText(shipment.to.hotel)
  // ゲスト言語 (en / zh / it / fr / es)。zh のみ NotoSansSC で描画 (JP フォントに簡体字が無い)。
  // it/fr/es はラテン文字のためNotoSansJPのフォールバックで描画可能 (アクセント付き文字も含めて確認済み)。
  const lang: GuestLanguage = normalizeGuestLanguage(data.guestLanguage)
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
          <Image style={logoSize(8.5)} src={LOGO_PATH} />
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
            <Text style={{ fontSize: 5.5, color: INK_SOFT }}>
              bondex.express/track/{data.bookingId}
            </Text>
          )}
          <Text style={vs.tmCaption}>{jb("配送状況を確認")}</Text>
          <Text style={[vs.tmCaptionEn, zf]}>/ {jb(L.scanCaption)}</Text>
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
          <View style={vs.legWhen}>
            <Text style={[vs.legWhenEn, zf]}>{jb(dropWhenEn)}</Text>
            <Text style={vs.legWhenJa}>{jb("チェックアウトまでに受付へお預けください")}</Text>
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
            {data.groupName ? (
              <Text style={vs.dvSmall}>{safeText(data.groupName)}</Text>
            ) : null}
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
            <View style={[vs.detailCell, { width: "50%", flexDirection: "row", alignItems: "center" }]}>
              <View style={{ flex: 1 }}>
                <Text style={vs.dk}>{contactCell.label}</Text>
                <Text style={vs.dv}>{contactCell.value}</Text>
                {contactCell.small !== "" && <Text style={vs.dvSmall}>{contactCell.small}</Text>}
              </View>
              {data.supportQrDataUri ? (
                <View style={{ alignItems: "center", marginLeft: mm(2) }}>
                  <Image style={{ width: mm(10), height: mm(10) }} src={data.supportQrDataUri} />
                  <Text style={{ fontSize: 4.5, color: MUTED, marginTop: mm(0.5), letterSpacing: 0.3 }}>
                    {data.supportQrKind === "whatsapp" ? "WhatsApp" : "Email"}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
          <View style={[vs.detailCell, { width: contactCell ? "50%" : "100%" }]}>
            <Text style={vs.dk}>SUPPLIER / 配送業者</Text>
            <Text style={vs.dv}>{jb(carrierConfig(data.carrier).voucherLabel)}</Text>
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

      {/* guest → hotel-staff 区切りバー (1枚化) */}
      <View style={vs.staffDivider}>
        <Text style={vs.sdLabel}>
          ここからホテルご担当者様へ <Text style={vs.sdLabelEn}>/ FOR HOTEL STAFF</Text>
        </Text>
      </View>

      {/* flow */}
      <Text style={vs.flowTitle}>ご対応の流れ</Text>
      <View style={vs.flowCols}>
        <View style={vs.flowCol}>
          <Text style={[vs.flowColHead, { backgroundColor: RED }]}>
            <Text style={vs.flowColHeadNo}>01  </Text>
            {jb("発送元ホテル（ご出発ホテル）での対応")}
          </Text>
          <FlowStep color={RED} num="1" main="お客様がチェックアウト時に荷物をお持ち込み" sub="出荷する荷物として通常どおりお預かりください" />
          <FlowStep color={RED} num="2" main="ドライバーが集荷に伺います" sub="バウチャー内容を確認します" />
          <FlowStep color={RED} num="3" main="荷物をドライバーへお渡し" sub="確認後、お渡しください" />
        </View>
        <View style={[vs.flowCol, { marginLeft: mm(3.5) }]}>
          <Text style={[vs.flowColHead, { backgroundColor: INK }]}>
            <Text style={vs.flowColHeadNo}>02  </Text>
            {jb("到着先ホテル（次のご宿泊ホテル）での対応")}
          </Text>
          <FlowStep color={INK} num="1" main="ドライバーが荷物をお届け" sub="到着荷物として通常どおりお預かりください" />
          <FlowStep color={INK} num="2" main="お客様がチェックイン" />
          <FlowStep color={INK} num="3" main="荷物をお客様へお渡し" sub="バウチャー記載のご予約名でお渡しください" />
          <View style={vs.roomNote}>
            <Text style={vs.rnJa}>
              {jb("お部屋番号が確定している場合：可能であればお部屋までお運びください ")}
              <Text style={vs.rnEn}>/ Room delivery when possible</Text>
            </Text>
          </View>
        </View>
      </View>

      {/* 予約検索パネル */}
      <View style={vs.hotelDetail}>
        <View style={vs.hdBlock}>
          <Text style={[vs.hdNo, { color: RED }]}>01 発送元</Text>
          <Text style={vs.hdHotel}>{fromHotelJa}{jb(" 様")}</Text>
          <LookupGrid guestName={guestName} />
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
          <Text style={vs.hdHotel}>{toHotelJa}{jb(" 様")}</Text>
          <LookupGrid
            guestName={guestName}
            dateEn="CHECK-OUT"
            dateJa="チェックアウト日"
            dateValue={shipment.toCheckOut}
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
            {data.supportEmail} ／ {data.supportPhone}
          </Text>
        </View>
        <View style={[vs.contactCell, vs.contactCellR]}>
          <Text style={vs.cK}>ランドオペレーター / LAND OPERATOR</Text>
          <Text style={vs.cV}>{jb(data.tourCompany) || "—"}</Text>
          <Text style={vs.cVSmall}>
            {data.contactPersonPhone || "—"}
            {data.contactPersonName ? jb(`（担当：${data.contactPersonName}）`) : ""}
          </Text>
        </View>
      </View>

      {/* footer */}
      <View style={vs.finalFooter}>
        <Text style={vs.footerText}>
          {jb(`${data.companyName} ／ ${data.companyAddress}`)}
        </Text>
        <Text style={vs.footerText}>REFERENCE: {ref}</Text>
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
       * 1 区間 = 1 バウチャー = 1 ページ (1枚化, 2026-07):
       *   上半分: GUEST COPY — 旅行者向け。ホテルに渡す紙
       *   下半分: FOR HOTEL STAFF — ホテル担当者様向け詳細案内
       * バウチャー番号は bookingId + 区間サフィックス (-A / -B / ...)
       */}
      {data.shipments.map((shipment, i) => (
        <VoucherPage key={i} data={data} shipment={shipment} legIndex={i} totalLegs={totalLegs} />
      ))}
      {/* How to use ガイドを末尾に 1 枚だけ同梱 (複数区間でも 1 枚)。既定 ON。 */}
      {data.includeHowto !== false ? (
        <HowToShipPage
          language={normalizeGuestLanguage(data.guestLanguage)}
          supportQrDataUri={data.supportQrDataUri}
          supportQrKind={data.supportQrKind}
        />
      ) : null}
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
      { title: "Voucher", body: "One per delivery" },
      { title: "Shipping label", body: "One per bag" },
      { title: "Your luggage", body: "Max 160 cm / 25 kg" },
    ],
    checkHead: "CHECK YOUR LABEL",
    checkSub: "A 10-second check:",
    checks: [
      "Sender name = your group representative",
      "Destination hotel is correct",
      "Arrival date matches your plan",
    ],
    labelMockFrom: "FROM: Representative name",
    labelMockTo: "TO: Your next hotel",
    labelMockDate: "Arrival date",
    stepsHead: "3 EASY STEPS",
    steps: [
      { title: "Pack smart", body: "Passport, tickets, medicine — keep them with you." },
      { title: "Hand over at reception", body: "Voucher + labels to the front desk — the courier will attach them for you." },
      { title: "Pick up & go", body: "Collect your bags at your next hotel's reception." },
    ],
    trackHead: "TRACK ANYTIME",
    trackBody: "Scan the QR code on your voucher.",
    contactHead: "NEED HELP?",
    contactWhatsapp: "Scan to chat with BondEx on WhatsApp",
    contactEmail: "Scan to email BondEx support",
    noticeHead: "GOOD TO KNOW",
    notices: [
      "Severe weather can delay delivery to the next day — avoid shipping right before your flight.",
      "BondEx support: support@bondex.express (9:00 - 18:00 JST)",
    ],
  },
  zh: {
    docTag: "旅客指南 TRAVELER GUIDE",
    title: "行李托运指南",
    subtitle: "酒店到酒店行李配送 — 1 分钟读懂",
    needHead: "需要准备 WHAT YOU NEED",
    needs: [
      { title: "凭证", body: "每个区间一张" },
      { title: "配送标签", body: "每件行李一张" },
      { title: "您的行李", body: "最大 160 cm / 25 kg" },
    ],
    checkHead: "确认标签 CHECK YOUR LABEL",
    checkSub: "只需 10 秒确认：",
    checks: [
      "寄件人姓名＝团队代表姓名",
      "目的地酒店正确",
      "到达日期与行程一致",
    ],
    labelMockFrom: "FROM: 代表姓名",
    labelMockTo: "TO: 下一家酒店",
    labelMockDate: "到达日期",
    stepsHead: "简单三步 3 EASY STEPS",
    steps: [
      { title: "聪明打包", body: "护照、车票、药品请随身携带。" },
      { title: "在前台交付", body: "将凭证和标签交给前台。无需粘贴，配送员会安装。" },
      { title: "领取行李", body: "在下一家酒店的前台领取。" },
    ],
    trackHead: "随时追踪 TRACK ANYTIME",
    trackBody: "扫描凭证上的二维码即可。",
    contactHead: "需要帮助？NEED HELP?",
    contactWhatsapp: "扫码通过 WhatsApp 联系 BondEx",
    contactEmail: "扫码给 BondEx 发送邮件",
    noticeHead: "温馨提示 GOOD TO KNOW",
    notices: [
      "恶劣天气可能延迟至次日送达，临近回国航班请勿托运。",
      "BondEx 客服: support@bondex.express (9:00 - 18:00 JST)",
    ],
  },
  it: {
    docTag: "GUIDA VIAGGIATORE / TRAVELER GUIDE",
    title: "COME SPEDIRE IL BAGAGLIO",
    subtitle: "Trasporto bagagli da hotel a hotel — una guida di 1 minuto",
    needHead: "COSA SERVE / WHAT YOU NEED",
    needs: [
      { title: "Voucher", body: "Uno per ogni consegna" },
      { title: "Etichetta di spedizione", body: "Una per ogni valigia" },
      { title: "Il tuo bagaglio", body: "Max 160 cm / 25 kg" },
    ],
    checkHead: "CONTROLLA L'ETICHETTA / CHECK YOUR LABEL",
    checkSub: "Un controllo di 10 secondi:",
    checks: [
      "Nome mittente = rappresentante del gruppo",
      "L'hotel di destinazione è corretto",
      "La data di arrivo corrisponde al programma",
    ],
    labelMockFrom: "FROM: Nome rappresentante",
    labelMockTo: "TO: Il tuo prossimo hotel",
    labelMockDate: "Data di arrivo",
    stepsHead: "3 PASSI SEMPLICI / 3 EASY STEPS",
    steps: [
      { title: "Fai i bagagli con criterio", body: "Passaporto, biglietti, medicine — tienili con te." },
      { title: "Consegna alla reception", body: "Voucher + etichette alla reception — sarà il corriere ad applicarle." },
      { title: "Ritira e riparti", body: "Ritira i bagagli alla reception del tuo prossimo hotel." },
    ],
    trackHead: "TRACCIA IN OGNI MOMENTO / TRACK ANYTIME",
    trackBody: "Scansiona il codice QR sul tuo voucher.",
    contactHead: "HAI BISOGNO DI AIUTO? / NEED HELP?",
    contactWhatsapp: "Scansiona per chattare con BondEx su WhatsApp",
    contactEmail: "Scansiona per scrivere all'assistenza BondEx",
    noticeHead: "BUONO A SAPERSI / GOOD TO KNOW",
    notices: [
      "Il maltempo può ritardare la consegna al giorno successivo — evita di spedire poco prima del tuo volo.",
      "Assistenza BondEx: support@bondex.express (9:00 - 18:00 JST)",
    ],
  },
  fr: {
    docTag: "GUIDE DU VOYAGEUR / TRAVELER GUIDE",
    title: "COMMENT EXPÉDIER VOS BAGAGES",
    subtitle: "Transport de bagages d'hôtel à hôtel — un guide d'1 minute",
    needHead: "CE DONT VOUS AVEZ BESOIN / WHAT YOU NEED",
    needs: [
      { title: "Bon (voucher)", body: "Un par livraison" },
      { title: "Étiquette d'expédition", body: "Une par bagage" },
      { title: "Votre bagage", body: "Max 160 cm / 25 kg" },
    ],
    checkHead: "VÉRIFIEZ VOTRE ÉTIQUETTE / CHECK YOUR LABEL",
    checkSub: "Une vérification de 10 secondes :",
    checks: [
      "Nom de l'expéditeur = représentant du groupe",
      "L'hôtel de destination est correct",
      "La date d'arrivée correspond à votre programme",
    ],
    labelMockFrom: "FROM : Nom du représentant",
    labelMockTo: "TO : Votre prochain hôtel",
    labelMockDate: "Date d'arrivée",
    stepsHead: "3 ÉTAPES SIMPLES / 3 EASY STEPS",
    steps: [
      { title: "Faites vos bagages intelligemment", body: "Passeport, billets, médicaments — gardez-les avec vous." },
      { title: "Remettez à la réception", body: "Bon + étiquettes à la réception — le transporteur les fixera lui-même." },
      { title: "Récupérez et partez", body: "Récupérez vos bagages à la réception de votre prochain hôtel." },
    ],
    trackHead: "SUIVEZ À TOUT MOMENT / TRACK ANYTIME",
    trackBody: "Scannez le code QR sur votre bon.",
    contactHead: "BESOIN D'AIDE ? / NEED HELP?",
    contactWhatsapp: "Scannez pour discuter avec BondEx sur WhatsApp",
    contactEmail: "Scannez pour envoyer un e-mail au support BondEx",
    noticeHead: "BON À SAVOIR / GOOD TO KNOW",
    notices: [
      "Les intempéries peuvent retarder la livraison au lendemain — évitez d'expédier juste avant votre vol.",
      "Support BondEx : support@bondex.express (9:00 - 18:00 JST)",
    ],
  },
  es: {
    docTag: "GUÍA DEL VIAJERO / TRAVELER GUIDE",
    title: "CÓMO ENVIAR SU EQUIPAJE",
    subtitle: "Transporte de equipaje de hotel a hotel — una guía de 1 minuto",
    needHead: "LO QUE NECESITA / WHAT YOU NEED",
    needs: [
      { title: "Comprobante (voucher)", body: "Uno por cada envío" },
      { title: "Etiqueta de envío", body: "Una por maleta" },
      { title: "Su equipaje", body: "Máx. 160 cm / 25 kg" },
    ],
    checkHead: "REVISE SU ETIQUETA / CHECK YOUR LABEL",
    checkSub: "Una revisión de 10 segundos:",
    checks: [
      "Nombre del remitente = representante del grupo",
      "El hotel de destino es correcto",
      "La fecha de llegada coincide con su itinerario",
    ],
    labelMockFrom: "FROM: Nombre del representante",
    labelMockTo: "TO: Su próximo hotel",
    labelMockDate: "Fecha de llegada",
    stepsHead: "3 PASOS SENCILLOS / 3 EASY STEPS",
    steps: [
      { title: "Empaque con inteligencia", body: "Pasaporte, billetes, medicinas — llévelos con usted." },
      { title: "Entregue en recepción", body: "Comprobante + etiquetas en recepción — el transportista las colocará." },
      { title: "Recoja y continúe", body: "Recoja su equipaje en la recepción de su próximo hotel." },
    ],
    trackHead: "SIGA SU ENVÍO EN TODO MOMENTO / TRACK ANYTIME",
    trackBody: "Escanee el código QR de su comprobante.",
    contactHead: "¿NECESITA AYUDA? / NEED HELP?",
    contactWhatsapp: "Escanee para chatear con BondEx por WhatsApp",
    contactEmail: "Escanee para enviar un correo al soporte de BondEx",
    noticeHead: "ES BUENO SABERLO / GOOD TO KNOW",
    notices: [
      "El mal tiempo puede retrasar la entrega al día siguiente — evite enviar justo antes de su vuelo.",
      "Soporte BondEx: support@bondex.express (9:00 - 18:00 JST)",
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
    width: mm(52),
    borderWidth: mm(0.5),
    borderColor: RED,
    backgroundColor: RED_TINT,
    paddingVertical: mm(2.4),
    paddingHorizontal: mm(3),
  },
  trackHead: { fontSize: 7.5, fontWeight: 700, letterSpacing: 0.8, color: RED_DARK },
  trackBody: { fontSize: 7.2, lineHeight: 1.55, marginTop: mm(1), color: INK },
  contactBox: {
    width: mm(48),
    marginLeft: mm(3),
    borderWidth: mm(0.5),
    borderColor: INK,
    paddingVertical: mm(2),
    paddingHorizontal: mm(2.6),
    flexDirection: "row",
    alignItems: "center",
  },
  contactQr: { width: mm(13), height: mm(13) },
  contactWords: { flex: 1, marginLeft: mm(2.2) },
  contactHead: { fontSize: 7, fontWeight: 700, letterSpacing: 0.5 },
  contactBody: { fontSize: 6.2, color: INK_SOFT, lineHeight: 1.45, marginTop: mm(0.7) },
  noticeBox: { flex: 1, marginLeft: mm(3), borderTopWidth: mm(0.8), borderTopColor: INK, paddingTop: mm(1.8) },
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

// ステップの情景イラスト (文字を減らし絵で伝える — 線画 + 赤アクセント)
function ScenePack() {
  return (
    <Svg width="100%" height={mm(20)} viewBox="0 0 120 64">
      {/* スーツケース */}
      <Rect x={14} y={22} width={34} height={34} rx={4} stroke={INK} strokeWidth={2.4} fill="#ffffff" />
      <Path d="M23 22v-5a8 8 0 0 1 16 0v5" stroke={INK} strokeWidth={2.4} fill="none" />
      <Path d="M24 30v18M38 30v18" stroke={INK} strokeWidth={1.8} opacity={0.35} strokeLinecap="round" />
      {/* 手荷物 (パスポート・薬・チケット) は赤丸で「箱に入れない」 */}
      <Circle cx={84} cy={30} r={22} stroke={RED} strokeWidth={2.6} fill={RED_TINT} />
      <Rect x={70} y={20} width={13} height={17} rx={1.5} stroke={INK} strokeWidth={1.8} fill="#ffffff" />
      <Circle cx={76.5} cy={27} r={2.6} stroke={INK} strokeWidth={1.4} fill="none" />
      <Rect x={87} y={23} width={11} height={7} rx={3.5} stroke={INK} strokeWidth={1.8} fill="#ffffff" />
      <Path d="M87 33h11M87 37h8" stroke={INK} strokeWidth={1.8} strokeLinecap="round" opacity={0.6} />
      {/* 禁止スラッシュ + スーツケースへの矢印を断つ */}
      <Path d="M68 45 L100 15" stroke={RED} strokeWidth={2.8} strokeLinecap="round" />
      <Path d="M60 40 L52 44" stroke={RED} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  )
}
function SceneDesk() {
  return (
    <Svg width="100%" height={mm(20)} viewBox="0 0 120 64">
      {/* カウンター */}
      <Rect x={16} y={38} width={88} height={8} fill={INK} />
      <Rect x={22} y={46} width={76} height={12} stroke={INK} strokeWidth={2} fill="#ffffff" />
      {/* ベル */}
      <Path d="M88 38v-6a8 8 0 0 0-16 0v6" stroke={INK} strokeWidth={2.2} fill="#ffffff" />
      <Circle cx={80} cy={29} r={1.8} fill={INK} />
      {/* 手渡しする書類: バウチャー (赤帯) + ラベル (バーコード) */}
      <Rect x={30} y={10} width={20} height={26} stroke={INK} strokeWidth={2} fill="#ffffff" />
      <Rect x={30} y={10} width={20} height={6} fill={RED} />
      <Path d="M34 22h12M34 27h9" stroke={INK} strokeWidth={1.6} strokeLinecap="round" opacity={0.5} />
      <Rect x={54} y={13} width={17} height={23} stroke={INK} strokeWidth={2} fill="#ffffff" />
      {[0, 1, 2, 3, 4].map((k) => (
        <Rect key={k} x={57 + k * 2.6} y={26} width={k % 2 === 0 ? 1.7 : 1} height={7} fill={INK} opacity={0.75} />
      ))}
      <Path d="M57 18h11" stroke={INK} strokeWidth={1.6} strokeLinecap="round" opacity={0.5} />
      {/* 手渡しの矢印 */}
      <Path d="M60 40 L60 45" stroke={RED} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M56 41.5 L60 45.5 L64 41.5" stroke={RED} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}
function SceneHotel() {
  return (
    <Svg width="100%" height={mm(20)} viewBox="0 0 120 64">
      {/* ホテル */}
      <Rect x={24} y={12} width={40} height={46} stroke={INK} strokeWidth={2.4} fill="#ffffff" />
      {[0, 1].map((r) =>
        [0, 1].map((c) => (
          <Rect key={`${r}-${c}`} x={31 + c * 14} y={19 + r * 13} width={8} height={8} fill={INK} opacity={0.25} />
        )),
      )}
      <Rect x={38} y={45} width={12} height={13} fill={INK} opacity={0.45} />
      {/* 受け取ったスーツケース + チェック */}
      <Rect x={76} y={28} width={24} height={28} rx={3} stroke={INK} strokeWidth={2.4} fill="#ffffff" />
      <Path d="M82 28v-4a6 6 0 0 1 12 0v4" stroke={INK} strokeWidth={2.2} fill="none" />
      <Circle cx={100} cy={26} r={9} fill={RED} />
      <Path d="M95.5 26 L98.8 29.2 L104.5 22.5" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}

/**
 * How to ship ガイドの 1 ページ本体 (Document ラッパー無し)。
 * 単体 PDF (HowToShipDocument) と、バウチャー末尾への同梱 (VoucherDocument) の
 * 両方から使う。複数区間でも常に 1 枚 = このページ 1 つだけを差し込む。
 */
export function HowToShipPage({
  language,
  supportQrDataUri,
  supportQrKind,
}: {
  language: GuestLanguage
  supportQrDataUri?: string
  supportQrKind?: "whatsapp" | "email"
}) {
  const L = HOWTO_L10N[language]
  const zf = language === "zh" ? ht.zh : {}
  const NEED_ICONS = [<VoucherMiniIcon key="v" />, <LabelMiniIcon key="l" />, <LuggageMiniIcon key="b" />]
  return (
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
          {L.steps.map((s, i) => {
            const SCENES = [<ScenePack key="p" />, <SceneDesk key="d" />, <SceneHotel key="h" />]
            return (
              <View key={i} style={[ht.stepCol, ...(i > 0 ? [ht.stepGap] : [])]}>
                {SCENES[i]}
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: mm(2) }}>
                  <View style={ht.numDot}><Text style={ht.numDotText}>{i + 1}</Text></View>
                  <Text style={[ht.stepTitle, zf, { marginTop: 0, flex: 1 }]}>{jb(s.title)}</Text>
                </View>
                <Text style={[ht.stepBody, zf]}>{jb(s.body)}</Text>
              </View>
            )
          })}
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
          {/* 問い合わせ QR (WhatsApp — 未設定時はメール QR にフォールバック) */}
          {supportQrDataUri ? (
            <View style={ht.contactBox}>
              <Image style={ht.contactQr} src={supportQrDataUri} />
              <View style={ht.contactWords}>
                <Text style={[ht.contactHead, zf]}>{jb(L.contactHead)}</Text>
                <Text style={[ht.contactBody, zf]}>
                  {jb(supportQrKind === "whatsapp" ? L.contactWhatsapp : L.contactEmail)}
                </Text>
              </View>
            </View>
          ) : null}
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
  )
}

export function HowToShipDocument({
  language,
  supportQrDataUri,
  supportQrKind,
}: {
  language: GuestLanguage
  supportQrDataUri?: string
  supportQrKind?: "whatsapp" | "email"
}) {
  return (
    <Document title={`BondEx How to Ship (${language.toUpperCase()})`} author="BondEx" subject="How to ship guide">
      <HowToShipPage language={language} supportQrDataUri={supportQrDataUri} supportQrKind={supportQrKind} />
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
  // 予約番号は (1) upsert のキー (衝突すると他社の予約を上書きしうる) かつ
  // (2) /track の bearer capability (知っていれば追跡情報が見える) なので、
  // 3桁 (900通り/日) では衝突・総当り列挙のリスクがある。暗号乱数の 8 桁英数字にする。
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()
  return `BDX-${yy}${mm2}${dd}-${rand}`
}

export function formatIssuedDate(d: Date = new Date()): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}
