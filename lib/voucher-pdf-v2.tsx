/**
 * バウチャー v2 (2026-09-24 正式デザイン再構築): 送り状をドライバーが持参する運用 (WaybillMode = driver_brings) 用の紙面。
 *   Page A = TOUR LEADER COPY / GUEST COPY (Vou_1.png)   … 区間ごと
 *   Page B = FOR HOTEL STAFF (発送元ホテル様用, Vou2.png) … 区間ごと
 *   Page C = HOW TO SEND YOUR LUGGAGE (howto1.png)        … 書類末尾に 1 枚
 * 原図 masters/ の構成・比率を A4 に写した。アイコンと装飾は public/assets の SVG をベクターのまま描く (lib/voucher-icons)。
 * 数量・日付・施設名・REF・QR・旅程は予約データ由来 (原図のサンプル値は使わない)。
 * ヘルパー (jb / 日付整形 / ロゴ等) は lib/voucher-pdf.tsx から ctx で受け取る (循環 import を避けるため)。
 */
import React from "react"
import { Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import type { Style } from "@react-pdf/types"
import { VIcon, VDecor, type VoucherIconName } from "./voucher-icons"
import type { VoucherArea } from "./voucher-area"

export type V2Helpers = {
  jb: (s?: string | null) => string
  safeText: (s?: string | null) => string
  realPhone: (s?: string | null) => string
  formatJpDate: (ymd: string) => string
  formatEnDate: (ymd: string) => string
  formatEnDateShort: (ymd: string) => string
  dowLabel: (ymd: string) => string
  logoPath: string
  mm: (v: number) => number
}
export type V2Leg = {
  index: number
  shipmentDate: string
  expectedArrival: string
  fromArea: VoucherArea
  toArea: VoucherArea
}
export type V2Ctx = {
  h: V2Helpers
  ref: string
  bookingId: string
  legIndex: number
  totalLegs: number
  legs: V2Leg[]
  isGroup: boolean
  guestName: string
  groupLine: string // 団体名の 2 行目 (代理店名等)
  tourLeader: string
  tourCompany: string
  companyName: string
  shipmentDate: string
  expectedArrival: string
  fromHotelJa: string
  fromHotelEn: string
  fromAddress: string
  toHotelJa: string
  toHotelEn: string
  toAddress: string
  fromArea: VoucherArea
  toArea: VoucherArea
  bagCount: number
  totalBags: number
  hasManifest: boolean
  dropWhenEn: string
  pickWhenEn: string
  presentText: string // ゲスト言語の「受付でご提示ください」
  copyTagEn: string
  copyTagJa: string
  trackingQrDataUri?: string
  trackingUrlText: string
  support: { kind: "whatsapp" | "email" | "text" | "hidden"; qrDataUri?: string; headEn: string; value: string; small: string }
  supportEmail: string
  supportPhone: string
  landOperatorContact: string
  noteForFrom: string
  noteForTo: string
  zf: Style
}

const RED = "#c8102e"
const INK = "#16161a"
const INK_SOFT = "#4b4b52"
const MUTED = "#8a8a92"
const RED_TINT = "#fdf3f4"
const GRAY_BG = "#f4f4f5"
const GRAY_LINE = "#e3e3e6"
const WHITE = "#ffffff"
const mm = (v: number) => v * 2.8346
/** 行数上限 (超過分は … で切る)。各ブロックの高さを固定し、どんな入力でも 1 枚に収めるための共通ルール。 */
const clamp = (n: number): Style => ({ maxLines: n, textOverflow: "ellipsis" })

/** WhatsApp グリフは Meta Brand Resource Center の公式 SVG (public/assets/brand/whatsapp-glyph.svg) を無改変で使う (2026-09-24 谷口さん支給)。
 *  ガイドラインにより色変更・改変・他ロゴとの合成は不可。原図の黒丸+白抜きは色変更に当たるため採らず、公式の緑グリフをそのまま置く。 */
export const WHATSAPP_LOGO_STATUS: "missing" | "official" = "official"

const s = StyleSheet.create({
  page: {
    paddingTop: mm(9),
    paddingBottom: mm(6),
    paddingHorizontal: mm(12),
    fontFamily: "NotoSansJP",
    fontSize: 8,
    color: INK,
    backgroundColor: WHITE,
    flexDirection: "column",
    minHeight: mm(297),
  },
  row: { flexDirection: "row" },
  // masthead
  mast: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  tag1: { fontSize: 6.2, letterSpacing: 1.3, fontWeight: 700, marginTop: mm(1.2) },
  tag2: { fontSize: 5.8, letterSpacing: 1.1, fontWeight: 500, color: INK_SOFT, marginTop: mm(0.4) },
  copyTag: { fontSize: 6.5, letterSpacing: 0.6, color: INK_SOFT, textAlign: "right" },
  refK: { fontSize: 6, letterSpacing: 1.8, color: MUTED, textAlign: "right", marginTop: mm(2) },
  refV: { fontSize: 12, fontWeight: 700, textAlign: "right", marginTop: mm(0.3) },
  // red band
  band: { backgroundColor: RED, flexDirection: "row", padding: mm(3.2), marginTop: mm(3), height: mm(30), overflow: "hidden" },
  bandKicker: { fontSize: 6.5, letterSpacing: 1.6, color: "#f4c4cc", fontWeight: 500 },
  bandLeg: { fontSize: 25, fontWeight: 700, color: WHITE, lineHeight: 1.05 },
  bandDivider: { width: mm(0.4), backgroundColor: "#e9a2ad", marginHorizontal: mm(4), alignSelf: "stretch" },
  bandRouteEn: { fontSize: 14.5, fontWeight: 700, color: WHITE },
  bandRouteJa: { fontSize: 10.5, fontWeight: 500, color: WHITE, marginTop: mm(0.8) },
  bandUseIn: { fontSize: 19, fontWeight: 700, color: WHITE, lineHeight: 1.05 },
  bandDate: { fontSize: 10, fontWeight: 700, color: WHITE, marginTop: mm(1) },
  bandNote: { fontSize: 5.6, color: "#f9dde2", marginTop: mm(0.8) },
  // title + QR
  h1: { fontSize: 15, fontWeight: 700, lineHeight: 1.1 },
  h1Ja: { fontSize: 9, marginTop: mm(0.8) },
  // 行の高さ (30mm・overflow hidden) の内側に枠線ごと収める: 見出し約4.4mm + 本体約22.6mm + 枠線 < 29mm
  qrModule: { width: mm(34), height: mm(29), borderWidth: mm(0.3), borderColor: INK, marginLeft: mm(2.5), overflow: "hidden" },
  qrHead: { fontSize: 5.6, letterSpacing: 0.4, fontWeight: 700, color: WHITE, paddingVertical: mm(1), paddingHorizontal: mm(0.8), textAlign: "center", maxLines: 1 },
  qrBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: mm(1), paddingHorizontal: mm(1) },
  qrImg: { width: mm(14), height: mm(14) },
  qrCap: { fontSize: 6.8, fontWeight: 700, marginTop: mm(1), textAlign: "center" },
  qrSub: { fontSize: 5.6, color: INK_SOFT, marginTop: mm(0.3), textAlign: "center" },
  // drop-off / collect cards
  card: { flex: 1, borderWidth: mm(0.3), borderColor: INK, overflow: "hidden" },
  cardHead: { flexDirection: "row", alignItems: "center", paddingVertical: mm(1.6), paddingHorizontal: mm(3) },
  cardNo: { fontSize: 15, fontWeight: 700, color: WHITE, marginRight: mm(3) },
  cardHeadText: { fontSize: 9.5, fontWeight: 700, color: WHITE, letterSpacing: 0.6 },
  cardBody: { paddingVertical: mm(3), paddingHorizontal: mm(3.5), flexDirection: "row", flex: 1, overflow: "hidden" },
  cardDate: { fontSize: 15, fontWeight: 700 },
  cardHotelEn: { fontSize: 12.5, fontWeight: 700, lineHeight: 1.25 },
  cardHotelJa: { fontSize: 8.5, marginTop: mm(1) },
  cardAddr: { fontSize: 6.8, color: INK_SOFT, marginTop: mm(1) },
  cardWhenEn: { fontSize: 8, fontWeight: 700, lineHeight: 1.3 },
  cardWhenJa: { fontSize: 7, marginTop: mm(0.8) },
  // info row
  infoRow: { flexDirection: "row", borderWidth: mm(0.3), borderColor: INK, marginTop: mm(3.5), height: mm(19), overflow: "hidden" },
  infoCell: { flex: 1, paddingVertical: mm(1.8), paddingHorizontal: mm(2.5), borderLeftWidth: mm(0.3), borderLeftColor: INK, overflow: "hidden" },
  infoK: { fontSize: 6, letterSpacing: 0.8, color: INK_SOFT },
  infoV: { fontSize: 11, fontWeight: 700, marginTop: mm(0.3) },
  infoS: { fontSize: 6.8, color: INK_SOFT, marginTop: mm(0.3) },
  // route
  routeBox: { borderWidth: mm(0.3), borderColor: GRAY_LINE, backgroundColor: GRAY_BG, marginTop: mm(3), padding: mm(3), height: mm(37), overflow: "hidden" },
  routeHead: { fontSize: 7.5, letterSpacing: 1.6, fontWeight: 500 },
  node: { flex: 1, alignItems: "center" },
  nodeCircle: { width: mm(9), height: mm(9), borderRadius: mm(4.5), alignItems: "center", justifyContent: "center" },
  nodeNo: { fontSize: 11, fontWeight: 700, color: WHITE },
  nodeDate: { fontSize: 7.5, fontWeight: 700, marginTop: mm(1.5) },
  nodeEn: { fontSize: 9, fontWeight: 700, marginTop: mm(0.4) },
  nodeJa: { fontSize: 7.5, marginTop: mm(0.4) },
  nodeThisBadge: { backgroundColor: RED, borderRadius: mm(1), paddingVertical: mm(0.7), paddingHorizontal: mm(2), marginTop: mm(1) },
  nodeThisBadgeText: { fontSize: 6.8, fontWeight: 700, color: WHITE, letterSpacing: 0.3 },
  // hotel staff band
  staffBand: { backgroundColor: INK, marginTop: mm(3), paddingVertical: mm(3), paddingHorizontal: mm(4), flexDirection: "row", alignItems: "center" },
  staffTitle: { fontSize: 15, fontWeight: 700, color: WHITE },
  staffJa: { fontSize: 10, fontWeight: 700, color: WHITE, lineHeight: 1.4 },
  staffEn: { fontSize: 7.5, color: "#d9d9de", marginTop: mm(1) },
  pageBox: { backgroundColor: WHITE, borderRadius: mm(1.5), paddingVertical: mm(2.5), paddingHorizontal: mm(3.5), flexDirection: "row", alignItems: "center" },
  // footer
  tagline: { fontSize: 7.2, letterSpacing: 1.6, fontWeight: 700, lineHeight: 1.45, textAlign: "right" },
  footRule: { borderTopWidth: mm(0.5), borderTopColor: "#b9b9c0", marginTop: mm(1) },
  footLine: { flexDirection: "row", justifyContent: "space-between", marginTop: mm(1.5) },
  footText: { fontSize: 6.2, color: INK_SOFT },
  // hotel page
  hsTag: { backgroundColor: RED, paddingVertical: mm(1.5), paddingHorizontal: mm(3), alignItems: "flex-end" },
  hsTagEn: { fontSize: 9, fontWeight: 700, color: WHITE },
  hsTagJa: { fontSize: 6.5, color: WHITE, marginTop: mm(0.3) },
  hsTitle: { fontSize: 18, fontWeight: 700, textAlign: "center", marginTop: mm(3.5) },
  hsTitleEn: { fontSize: 8, letterSpacing: 1, textAlign: "center", marginTop: mm(1.2) },
  hsGreetJa: { fontSize: 9, lineHeight: 1.5, textAlign: "center", marginTop: mm(2) },
  hsGreetEn: { fontSize: 7.2, lineHeight: 1.5, textAlign: "center", color: INK_SOFT, marginTop: mm(1) },
  hsPanel: { backgroundColor: GRAY_BG, flexDirection: "row", marginTop: mm(3.5), paddingVertical: mm(3), height: mm(34), overflow: "hidden" },
  hsCell: { flex: 1, paddingHorizontal: mm(3.5), borderLeftWidth: mm(0.3), borderLeftColor: "#d5d5da" },
  hsK: { fontSize: 6.8, color: INK_SOFT, marginTop: mm(2.5) },
  hsV: { fontSize: 11.5, fontWeight: 700, marginTop: mm(1) },
  hsS: { fontSize: 7.5, color: INK_SOFT, marginTop: mm(0.6) },
  todoTab: { backgroundColor: RED, alignSelf: "flex-start", paddingVertical: mm(1.4), paddingHorizontal: mm(3.5), marginTop: mm(3.5) },
  todoTabText: { fontSize: 9.5, fontWeight: 700, color: WHITE },
  todoPanel: { backgroundColor: RED_TINT, flexDirection: "row", padding: mm(3.5), height: mm(55), overflow: "hidden" },
  step: { flex: 1 },
  stepNo: { width: mm(7.5), height: mm(7.5), borderRadius: mm(3.75), backgroundColor: RED, alignItems: "center", justifyContent: "center" },
  stepNoText: { fontSize: 10.5, fontWeight: 700, color: WHITE },
  stepTitle: { fontSize: 10, fontWeight: 700, marginTop: mm(2.5), lineHeight: 1.35 },
  stepJa: { fontSize: 7.6, lineHeight: 1.55, marginTop: mm(1.5) },
  stepEn: { fontSize: 6.8, lineHeight: 1.45, color: INK_SOFT, marginTop: mm(1.2) },
  stepArrow: { width: mm(9), alignItems: "center", justifyContent: "center" },
  noteBox: { backgroundColor: GRAY_BG, flexDirection: "row", alignItems: "center", padding: mm(3), marginTop: mm(3), overflow: "hidden" },
  noteRed: { fontSize: 10, fontWeight: 700, color: RED },
  noteInk: { fontSize: 10, fontWeight: 700 },
  noteEn: { fontSize: 7.8, color: INK_SOFT, marginTop: mm(0.4) },
  contactCol: { flex: 1, paddingRight: mm(3) },
  cK: { fontSize: 6.2, letterSpacing: 0.6, color: INK_SOFT },
  cV: { fontSize: 9.5, fontWeight: 700, marginTop: mm(1) },
  cS: { fontSize: 7.5, marginTop: mm(0.8) },
  // how-to page
  htTitle: { fontSize: 36, fontWeight: 700, lineHeight: 1.08, letterSpacing: -0.5 },
  htSubRed: { fontSize: 11.5, fontWeight: 700, color: RED, marginTop: mm(4) },
  htSub: { fontSize: 10.5, marginTop: mm(0.5) },
  circle: { width: mm(50), height: mm(50), borderRadius: mm(25), backgroundColor: "#ececee", alignItems: "center", justifyContent: "center" },
  circleText: { fontSize: 11, fontWeight: 700, lineHeight: 1.35 },
  circleSub: { fontSize: 7.5, letterSpacing: 1.2, marginTop: mm(2) },
  htRule: { borderTopWidth: mm(0.4), borderTopColor: "#c9c9ce", marginTop: mm(5) },
  htStepNo: { width: mm(11), height: mm(11), borderRadius: mm(5.5), backgroundColor: RED, alignItems: "center", justifyContent: "center" },
  htStepNoText: { fontSize: 13, fontWeight: 700, color: WHITE },
  htStepTitle: { fontSize: 11, fontWeight: 700, lineHeight: 1.15, marginLeft: mm(3), flex: 1 },
  htCaption: { fontSize: 8, lineHeight: 1.45, marginTop: mm(3) },
  banPanel: { backgroundColor: RED_TINT, padding: mm(4), marginTop: mm(5) },
  banTitle: { fontSize: 17, fontWeight: 700 },
  banSub: { fontSize: 8.5, marginTop: mm(0.5) },
  banItem: { flex: 1, alignItems: "center" },
  banLabel: { fontSize: 7.2, fontWeight: 700, textAlign: "center", marginTop: mm(2), lineHeight: 1.3 },
  htFootBig: { fontSize: 15, fontWeight: 700, lineHeight: 1.15 },
  htFootSmall: { fontSize: 6.5, letterSpacing: 3, marginTop: mm(2.5) },
  redDash: { width: mm(10), height: mm(0.8), backgroundColor: RED, marginTop: mm(3) },
  needHead: { fontSize: 13, fontWeight: 700 },
  needBody: { fontSize: 8.5, lineHeight: 1.5, marginTop: mm(1) },
  needSmall: { fontSize: 7, color: INK_SOFT, marginTop: mm(0.5) },
  waMissing: {
    width: mm(19), height: mm(19), borderRadius: mm(9.5), borderWidth: mm(0.4), borderColor: RED, borderStyle: "dashed",
    alignItems: "center", justifyContent: "center",
  },
  waMissingText: { fontSize: 4.6, color: RED, textAlign: "center", lineHeight: 1.3 },
})

// ---------------------------------------------------------------------------
// 共通部品
// ---------------------------------------------------------------------------
function Masthead({ ctx, right }: { ctx: V2Ctx; right: React.ReactNode }) {
  const { h } = ctx
  return (
    <View style={s.mast}>
      <View>
        <Image src={h.logoPath} style={{ width: mm(42), height: mm(42 * 254 / 1255) }} />
        <Text style={s.tag1}>LUGGAGE FORWARDING SERVICE</Text>
        <Text style={s.tag2}>TRAVEL LIGHTER. TRAVEL FURTHER.</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>{right}</View>
    </View>
  )
}
function RefBlock({ ctx }: { ctx: V2Ctx }) {
  return (
    <>
      <Text style={s.refK}>REF</Text>
      <Text style={s.refV}>{ctx.ref}</Text>
    </>
  )
}
function FooterLine({ ctx }: { ctx: V2Ctx }) {
  const { h } = ctx
  return (
    <>
      <View style={s.footRule} />
      <View style={s.footLine}>
        <Text style={s.footText}>{h.jb(`${ctx.companyName} ／ bondex.express`)}</Text>
        <Text style={s.footText}>REFERENCE: {ctx.ref}</Text>
      </View>
    </>
  )
}
function Tagline({ align = "right" }: { align?: "left" | "right" }) {
  return (
    <View style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <Text style={[s.tagline, { textAlign: align }]}>TRAVEL LIGHTER.{"\n"}TRAVEL FURTHER.</Text>
      <View style={s.redDash} />
    </View>
  )
}
/** 原図の富士山・五重塔・街並み (再構築ベクター) の上にタグラインを重ねたフッター装飾 */
function SkylineFooter({ ctx }: { ctx: V2Ctx }) {
  return (
    <View style={{ marginTop: "auto" }}>
      <View style={{ position: "relative", height: mm(15) }}>
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
          <VDecor name="footer-skyline" width={mm(186)} />
        </View>
        <View style={{ position: "absolute", right: mm(2), top: mm(1) }}>
          <Tagline />
        </View>
      </View>
      <FooterLine ctx={ctx} />
    </View>
  )
}
function NeedHelpModule({ ctx }: { ctx: V2Ctx }) {
  const sp = ctx.support
  if (sp.kind === "hidden") return null
  return (
    <View style={s.qrModule}>
      <Text style={[s.qrHead, { backgroundColor: INK }]}>{sp.headEn}</Text>
      <View style={s.qrBody}>
        {sp.qrDataUri ? <Image src={sp.qrDataUri} style={s.qrImg} /> : null}
        <Text style={s.qrCap}>{ctx.h.jb(sp.value)}</Text>
        {sp.small ? <Text style={s.qrSub}>{ctx.h.jb(sp.small)}</Text> : null}
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Page A — TOUR LEADER COPY / GUEST COPY (Vou_1)
// ---------------------------------------------------------------------------
export function TourLeaderPage({ ctx }: { ctx: V2Ctx }) {
  const { h, zf } = ctx
  const current = ctx.legIndex
  // 旅程ノード = 各区間の出発地。1 区間のみのときは到着地を終点ノードとして添える (原図は 3 区間 = 3 ノード)。
  const nodes: Array<{ no: string; date: string; en: string; ja: string; isCurrent: boolean; end?: boolean }> = ctx.legs.map((l) => ({
    no: String(l.index + 1), date: h.formatEnDateShort(l.shipmentDate), en: l.fromArea.en, ja: l.fromArea.ja, isCurrent: l.index === current,
  }))
  if (ctx.totalLegs === 1) {
    const l = ctx.legs[0]
    nodes.push({ no: "", date: h.formatEnDateShort(l.expectedArrival), en: l.toArea.en, ja: l.toArea.ja, isCurrent: false, end: true })
  }
  const hotelPageNo = ctx.legIndex * 2 + 2
  const routeEnLen = ctx.fromArea.en.length + ctx.toArea.en.length
  const who = ctx.isGroup ? "添乗員様" : "お客様"
  return (
    <Page size="A4" style={s.page} wrap={false}>
      <Masthead
        ctx={ctx}
        right={
          <>
            <Text style={[s.copyTag, zf]}>{h.jb(`${ctx.copyTagEn} / ${ctx.copyTagJa}`)}</Text>
            <RefBlock ctx={ctx} />
          </>
        }
      />

      {/* 赤帯: LEG / 区間 / この用紙を使う場所 */}
      <View style={s.band}>
        <View style={{ justifyContent: "center", width: mm(40) }}>
          <Text style={s.bandKicker}>THIS VOUCHER IS FOR</Text>
          <Text style={[s.bandLeg, clamp(1)]}>{`LEG ${ctx.legIndex + 1} / ${ctx.totalLegs}`}</Text>
        </View>
        <View style={s.bandDivider} />
        <View style={{ justifyContent: "center", flex: 1 }}>
          <Text style={[s.bandRouteEn, routeEnLen >= 22 ? { fontSize: 10 } : routeEnLen >= 15 ? { fontSize: 11.5 } : {}, clamp(2)]}>{`${ctx.fromArea.en}  →  ${ctx.toArea.en}`}</Text>
          <Text style={[s.bandRouteJa, clamp(1)]}>{h.jb(`${ctx.fromArea.ja}  →  ${ctx.toArea.ja}`)}</Text>
        </View>
        <View style={s.bandDivider} />
        <View style={{ flexDirection: "row", alignItems: "center", width: mm(62) }}>
          <VIcon name="calendar-white" size={mm(9)} style={{ marginRight: mm(3) }} />
          <View style={{ flex: 1 }}>
            <Text style={s.bandKicker}>USE THIS VOUCHER IN</Text>
            <Text style={[s.bandUseIn, ctx.fromArea.en.length > 14 ? { fontSize: 11 } : ctx.fromArea.en.length > 8 ? { fontSize: 14 } : {}, clamp(1)]}>{ctx.fromArea.en}</Text>
            <Text style={s.bandDate}>{`${h.formatEnDate(ctx.shipmentDate)}  ${h.dowLabel(ctx.shipmentDate)}`}</Text>
            <Text style={[s.bandNote, clamp(1)]}>{h.jb(`この用紙は${ctx.fromArea.ja}のホテルでご利用ください`)}</Text>
          </View>
        </View>
      </View>

      {/* タイトル + QR */}
      <View style={[s.row, { marginTop: mm(3.5), alignItems: "flex-start", height: mm(30), overflow: "hidden" }]}>
        <View style={{ flex: 1, paddingTop: mm(1) }}>
          <Text style={s.h1}>LUGGAGE FORWARDING VOUCHER</Text>
          <Text style={s.h1Ja}>{h.jb("荷物配送引換証")}</Text>
          <Text style={[{ fontSize: 7, color: INK_SOFT, marginTop: mm(2.5), lineHeight: 1.45 }, zf, clamp(3)]}>{h.jb(ctx.presentText)}</Text>
        </View>
        <View style={s.qrModule}>
          <Text style={[s.qrHead, { backgroundColor: RED }]}>TRACKING / 追跡</Text>
          <View style={s.qrBody}>
            {ctx.trackingQrDataUri ? <Image src={ctx.trackingQrDataUri} style={s.qrImg} /> : <Text style={s.qrSub}>{ctx.trackingUrlText}</Text>}
            <Text style={s.qrCap}>{h.jb("配送状況を確認")}</Text>
            <Text style={s.qrSub}>Live status</Text>
          </View>
        </View>
        <NeedHelpModule ctx={ctx} />
      </View>

      {/* DROP OFF / COLLECT */}
      <View style={[s.row, { marginTop: mm(3.5), alignItems: "stretch", height: mm(62) }]}>
        <View style={s.card}>
          <View style={[s.cardHead, { backgroundColor: RED }]}>
            <Text style={s.cardNo}>01</Text>
            <Text style={s.cardHeadText}>{h.jb("DROP OFF  /  お預け")}</Text>
          </View>
          <View style={[s.cardBody, { backgroundColor: RED_TINT }]}>
            <View style={{ flex: 1, justifyContent: "space-between" }}>
              <View>
              <View style={[s.row, { alignItems: "center" }]}>
                <VIcon name="calendar" size={mm(6.5)} style={{ marginRight: mm(2.5) }} />
                <Text style={s.cardDate}>
                  {h.formatEnDate(ctx.shipmentDate)} <Text style={{ fontSize: 9, color: RED }}>{h.dowLabel(ctx.shipmentDate)}</Text>
                </Text>
              </View>
              <View style={[s.row, { alignItems: "flex-start", marginTop: mm(3) }]}>
                <VIcon name="hotel" size={mm(7)} style={{ marginRight: mm(2.5), marginTop: mm(0.5) }} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardHotelEn, (ctx.fromHotelEn || ctx.fromHotelJa).length > 26 ? { fontSize: 10.5 } : {}, clamp(2)]}>{h.jb(ctx.fromHotelEn || ctx.fromHotelJa)}</Text>
                  {ctx.fromHotelEn ? <Text style={[s.cardHotelJa, clamp(1)]}>{h.jb(ctx.fromHotelJa)}</Text> : null}
                  {ctx.fromAddress ? <Text style={[s.cardAddr, clamp(1)]}>{h.jb(ctx.fromAddress)}</Text> : null}
                </View>
              </View>
              </View>
              <View style={{ marginTop: mm(3) }}>
                <Text style={[s.cardWhenEn, zf, clamp(1)]}>{h.jb(ctx.dropWhenEn)}</Text>
                <Text style={[s.cardWhenJa, clamp(1)]}>{h.jb("チェックアウトまでにフロントへお預けください")}</Text>
              </View>
            </View>
            <View style={{ justifyContent: "center", marginLeft: mm(3) }}>
              <VIcon name="luggage" size={mm(15)} />
            </View>
          </View>
        </View>
        <View style={{ width: mm(9), alignItems: "center", justifyContent: "center" }}>
          <VIcon name="arrow-right-red" size={mm(6.5)} />
        </View>
        <View style={s.card}>
          <View style={[s.cardHead, { backgroundColor: INK }]}>
            <Text style={s.cardNo}>02</Text>
            <Text style={s.cardHeadText}>{h.jb("COLLECT  /  お受け取り")}</Text>
          </View>
          <View style={[s.cardBody, { backgroundColor: GRAY_BG }]}>
            <View style={{ flex: 1, justifyContent: "space-between" }}>
              <View>
              <View style={[s.row, { alignItems: "center" }]}>
                <VIcon name="calendar" size={mm(6.5)} style={{ marginRight: mm(2.5) }} />
                <Text style={s.cardDate}>
                  {h.formatEnDate(ctx.expectedArrival)} <Text style={{ fontSize: 9, color: RED }}>{h.dowLabel(ctx.expectedArrival)}</Text>
                </Text>
              </View>
              <View style={[s.row, { alignItems: "flex-start", marginTop: mm(3) }]}>
                <VIcon name="hotel" size={mm(7)} style={{ marginRight: mm(2.5), marginTop: mm(0.5) }} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardHotelEn, (ctx.toHotelEn || ctx.toHotelJa).length > 26 ? { fontSize: 10.5 } : {}, clamp(2)]}>{h.jb(ctx.toHotelEn || ctx.toHotelJa)}</Text>
                  {ctx.toHotelEn ? <Text style={[s.cardHotelJa, clamp(1)]}>{h.jb(ctx.toHotelJa)}</Text> : null}
                  {ctx.toAddress ? <Text style={[s.cardAddr, clamp(1)]}>{h.jb(ctx.toAddress)}</Text> : null}
                </View>
              </View>
              </View>
              <View style={{ marginTop: mm(3) }}>
                <Text style={[s.cardWhenEn, zf, clamp(1)]}>{h.jb(ctx.pickWhenEn)}</Text>
                <Text style={[s.cardWhenJa, clamp(1)]}>{h.jb("チェックイン時にお受け取りいただけます")}</Text>
              </View>
            </View>
            <View style={{ justifyContent: "center", marginLeft: mm(3) }}>
              <VIcon name="luggage" size={mm(15)} />
            </View>
          </View>
        </View>
      </View>

      {/* GROUP / TOUR LEADER / LUGGAGE / SERVICE */}
      <View style={s.infoRow}>
        <View style={[s.infoCell, { borderLeftWidth: 0 }]}>
          <Text style={s.infoK}>{ctx.isGroup ? "GROUP  /  団体名" : "GUEST  /  ご予約者"}</Text>
          <View style={[s.row, { alignItems: "center" }]}>
            <VIcon name={ctx.isGroup ? "group" : "person"} size={mm(6.5)} style={{ marginRight: mm(2) }} />
            <View style={{ flex: 1 }}>
              <Text style={[s.infoV, ctx.guestName.length > 30 ? { fontSize: 7.8, lineHeight: 1.2 } : ctx.guestName.length > 18 ? { fontSize: 9.5, lineHeight: 1.2 } : {}, clamp(ctx.groupLine ? 1 : 2)]}>{h.jb(ctx.guestName)}</Text>
              {ctx.groupLine ? <Text style={[s.infoS, clamp(1)]}>{h.jb(ctx.groupLine)}</Text> : null}
            </View>
          </View>
        </View>
        {ctx.isGroup ? (
          <View style={s.infoCell}>
            <Text style={s.infoK}>TOUR LEADER  /  添乗員</Text>
            <View style={[s.row, { alignItems: "center" }]}>
              <VIcon name="person" size={mm(6.5)} style={{ marginRight: mm(2) }} />
              <Text style={[s.infoV, ctx.tourLeader.length > 24 ? { fontSize: 7.2, lineHeight: 1.2 } : ctx.tourLeader.length > 14 ? { fontSize: 8.5, lineHeight: 1.2 } : {}, clamp(2)]}>{h.jb(ctx.tourLeader || "—")}</Text>
            </View>
          </View>
        ) : null}
        <View style={s.infoCell}>
          <Text style={s.infoK}>LUGGAGE  /  荷物</Text>
          <View style={[s.row, { alignItems: "center" }]}>
            <VIcon name="luggage-solid" size={mm(6.5)} style={{ marginRight: mm(2) }} />
            <View>
              <Text style={s.infoV}>{`${ctx.bagCount} bag${ctx.bagCount === 1 ? "" : "s"}`}</Text>
              <Text style={s.infoS}>{`Total ${ctx.totalBags} bag${ctx.totalBags === 1 ? "" : "s"}`}</Text>
            </View>
          </View>
        </View>
        <View style={s.infoCell}>
          <Text style={s.infoK}>SERVICE  /  サービス種別</Text>
          <View style={[s.row, { alignItems: "center" }]}>
            <VIcon name="route" size={mm(6.5)} style={{ marginRight: mm(2) }} />
            <View>
              <Text style={s.infoV}>Hotel → Hotel</Text>
              <Text style={s.infoS}>{h.jb("ホテル間配送")}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* YOUR LUGGAGE ROUTE */}
      <View style={s.routeBox}>
        <Text style={s.routeHead}>{h.jb(`YOUR LUGGAGE ROUTE  /  荷物の旅程（全 ${ctx.totalLegs} 区間）`)}</Text>
        <View style={{ position: "relative", marginTop: mm(2.5) }}>
          {nodes.length > 1 ? (
            <View
              style={{
                position: "absolute", top: mm(4.2), height: mm(0.6), backgroundColor: "#9a9aa0",
                left: `${50 / nodes.length}%`, width: `${100 - 100 / nodes.length}%`,
              }}
            />
          ) : null}
          <View style={s.row}>
            {nodes.map((n, i) => (
              <View key={i} style={s.node}>
                <View style={[s.nodeCircle, { backgroundColor: n.isCurrent ? RED : n.end ? "#c9c9ce" : "#7d7d85" }]}>
                  {n.end ? <VIcon name="location-pin" size={mm(5)} color={WHITE} /> : <Text style={s.nodeNo}>{n.no}</Text>}
                </View>
                <Text style={[s.nodeDate, { color: n.isCurrent ? RED : INK }]}>{n.date}</Text>
                <Text style={[s.nodeEn, n.en.length > 14 ? { fontSize: 7.2 } : {}, clamp(2)]}>{n.en}</Text>
                <Text style={[s.nodeJa, clamp(1)]}>{h.jb(n.ja)}</Text>
                {n.isCurrent ? (
                  <View style={s.nodeThisBadge}>
                    <Text style={s.nodeThisBadgeText}>{h.jb("THIS VOUCHER  ・  この用紙")}</Text>
                  </View>
                ) : null}
                {n.end ? <Text style={[s.infoS, { marginTop: mm(0.8) }]}>ARRIVE</Text> : null}
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* 到着先ホテル向けの申し送り (あれば): ホテル用紙は発送元にしか渡さないため、ここに残す */}
      {ctx.noteForTo ? (
        <View style={{ borderWidth: mm(0.3), borderColor: GRAY_LINE, padding: mm(2), marginTop: mm(2.5), height: mm(12), overflow: "hidden" }}>
          <Text style={{ fontSize: 6.5, fontWeight: 700, color: INK_SOFT, letterSpacing: 0.6 }}>{h.jb("到着先ホテル様へ / TO THE DESTINATION HOTEL")}</Text>
          <Text style={[{ fontSize: 7.5, marginTop: mm(0.8), lineHeight: 1.5 }, clamp(2)]}>
            {h.jb(`BondExよりご連絡済みのお荷物です。ご予約名「${ctx.guestName}」でご照合のうえ${who}へお渡しください。　・${ctx.noteForTo}`)}
          </Text>
        </View>
      ) : null}

      {/* HOTEL STAFF 黒帯 → 次ページ */}
      <View style={s.staffBand}>
        <View style={{ flex: 1 }}>
          <View style={[s.row, { alignItems: "center" }]}>
            <VIcon name="hotel-white" size={mm(9)} style={{ marginRight: mm(3) }} />
            <Text style={s.staffTitle}>{h.jb("HOTEL STAFF  /  ホテルご担当者様へ")}</Text>
          </View>
          <View style={[s.row, { marginTop: mm(2.2), alignItems: "center" }]}>
            <View style={{ flex: 1, paddingRight: mm(3), borderRightWidth: mm(0.3), borderRightColor: "#5a5a62" }}>
              <Text style={s.staffJa}>{h.jb("お荷物をお預かりの際は、\n次ページをご確認ください。")}</Text>
              <Text style={s.staffEn}>Please see the next page for detailed instructions.</Text>
            </View>
            <View style={[s.pageBox, { marginLeft: mm(4) }]}>
              <View>
                <Text style={{ fontSize: 9, fontWeight: 700 }}>FOR HOTEL STAFF</Text>
                <Text style={{ fontSize: 6.5, marginTop: mm(0.5) }}>{h.jb("ホテルスタッフ向け情報")}</Text>
              </View>
              <VIcon name="arrow-right-black" size={mm(5.5)} style={{ marginHorizontal: mm(4) }} />
              <Text style={{ fontSize: 12, fontWeight: 700 }}>{`PAGE ${hotelPageNo}`}</Text>
            </View>
          </View>
        </View>
      </View>

      <SkylineFooter ctx={ctx} />
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Page B — FOR HOTEL STAFF (発送元ホテル様用, Vou2)
// ---------------------------------------------------------------------------
export function HotelStaffPage({ ctx }: { ctx: V2Ctx }) {
  const { h } = ctx
  const who = ctx.isGroup ? "添乗員様（代表者様）" : "お客様"
  const steps: Array<{ icon: VoucherIconName; title: string; ja: string; en: string }> = [
    {
      icon: "luggage",
      title: "お荷物をお預かり",
      ja: ctx.isGroup ? "添乗員様（代表者様）が団体のお荷物をお持ち込みされます。" : "お客様がチェックアウト時にお荷物をお持ち込みされます。",
      en: ctx.isGroup ? "Receive the luggage from the tour leader." : "Receive the luggage from the guest at check-out.",
    },
    {
      icon: "clipboard-check",
      title: "個数をご確認のうえ\n集荷まで保管",
      ja: ctx.hasManifest ? "団体お荷物リスト（別紙）でご照合ください。" : "ご予約名と個数を控え、他のお荷物と区別して保管してください。",
      en: "Check the number of bags and keep them until collection.",
    },
    {
      icon: "delivery-truck",
      title: "ドライバーへ引き渡し",
      ja: "集荷ドライバーが送り状を持参し、貼付して集荷します。ドライバーへご予約名と個数をお伝えください。",
      en: "The driver will bring and attach the shipping labels. Please hand the luggage to the driver.",
    },
  ]
  const fromEnUpper = ctx.fromHotelEn ? ctx.fromHotelEn.toUpperCase() : ""
  return (
    <Page size="A4" style={s.page} wrap={false}>
      <Masthead
        ctx={ctx}
        right={
          <>
            <View style={s.hsTag}>
              <Text style={s.hsTagEn}>FOR HOTEL STAFF</Text>
              <Text style={s.hsTagJa}>{h.jb("ホテルご担当者様用")}</Text>
            </View>
            <RefBlock ctx={ctx} />
          </>
        }
      />

      <View style={s.band}>
        <View style={{ flex: 1, justifyContent: "center", paddingRight: mm(2) }}>
          <Text style={s.bandKicker}>{h.jb("FROM  /  発送元ホテル")}</Text>
          <Text style={[s.bandUseIn, { fontSize: ctx.fromHotelJa.length > 26 ? 12 : ctx.fromHotelJa.length > 18 ? 14 : 17, marginTop: mm(1), lineHeight: 1.15 }, clamp(2)]}>{h.jb(ctx.fromHotelJa)}</Text>
          <Text style={[s.bandDate, { marginTop: mm(1) }, clamp(1)]}>{h.jb(fromEnUpper && fromEnUpper.length <= 28 ? `ご担当者様へ  /  FOR ${fromEnUpper} STAFF` : "ご担当者様へ  /  DEAR FRONT DESK STAFF")}</Text>
        </View>
        <View style={s.bandDivider} />
        <View style={{ justifyContent: "center", width: mm(58) }}>
          <Text style={[s.bandKicker, { color: WHITE, fontSize: 9.5, fontWeight: 700 }]}>{`LEG ${ctx.legIndex + 1} / ${ctx.totalLegs}`}</Text>
          <Text style={[s.bandRouteEn, { fontSize: ctx.fromArea.en.length + ctx.toArea.en.length > 20 ? 9 : 11, marginTop: mm(1) }, clamp(2)]}>{`${ctx.fromArea.en}  →  ${ctx.toArea.en}`}</Text>
          <Text style={[s.bandRouteJa, { fontSize: 9 }, clamp(1)]}>{h.jb(`${ctx.fromArea.ja}  →  ${ctx.toArea.ja}`)}</Text>
        </View>
      </View>

      <Text style={[s.hsTitle, clamp(1)]}>{h.jb("お荷物のお預かりをお願いいたします")}</Text>
      <Text style={s.hsTitleEn}>PLEASE KEEP THE LUGGAGE UNTIL COLLECTION</Text>
      <Text style={s.hsGreetJa}>
        {h.jb("平素より大変お世話になっております。ご宿泊のお客様のお荷物を、\n次のご宿泊先へ配送いたします。下記のとおりご対応くださいますようお願い申し上げます。")}
      </Text>
      <Text style={s.hsGreetEn}>Thank you for your continued support. We will be delivering our guest&apos;s luggage to the next hotel.{"\n"}Please follow the instructions below.</Text>

      {/* 要点 4 項目 */}
      <View style={s.hsPanel}>
        <View style={[s.hsCell, { borderLeftWidth: 0 }]}>
          <VIcon name="calendar" size={mm(8)} />
          <Text style={s.hsK}>{h.jb("お預かり日 / DATE")}</Text>
          <Text style={s.hsV}>{h.jb(h.formatJpDate(ctx.shipmentDate))}</Text>
          <Text style={s.hsS}>{`${h.formatEnDate(ctx.shipmentDate)} ${h.dowLabel(ctx.shipmentDate)}`}</Text>
        </View>
        <View style={s.hsCell}>
          <VIcon name={ctx.isGroup ? "group" : "person"} size={mm(8)} />
          <Text style={s.hsK}>{h.jb("ご予約名 / GUEST")}</Text>
          <Text style={[s.hsV, ctx.guestName.length > 28 ? { fontSize: 8.5, lineHeight: 1.2 } : ctx.guestName.length > 16 ? { fontSize: 9, lineHeight: 1.2 } : {}, clamp(2)]}>{h.jb(ctx.guestName)}</Text>
          {ctx.groupLine ? <Text style={[s.hsS, clamp(1)]}>{h.jb(ctx.groupLine)}</Text> : null}
        </View>
        <View style={s.hsCell}>
          <VIcon name="luggage-solid" size={mm(8)} />
          <Text style={s.hsK}>{h.jb("お荷物の個数 / BAGS")}</Text>
          <Text style={s.hsV}>{h.jb(`${ctx.bagCount} 個`)}</Text>
          <Text style={s.hsS}>{`Total ${ctx.totalBags} bag${ctx.totalBags === 1 ? "" : "s"}`}</Text>
        </View>
        <View style={s.hsCell}>
          <VIcon name="location-pin" size={mm(8)} />
          <Text style={s.hsK}>{h.jb("お届け先 / TO")}</Text>
          <Text style={[s.hsV, ctx.toHotelJa.length > 24 ? { fontSize: 8.5, lineHeight: 1.2 } : ctx.toHotelJa.length > 14 ? { fontSize: 9, lineHeight: 1.2 } : {}, clamp(2)]}>{h.jb(ctx.toHotelJa)}</Text>
          {ctx.toHotelEn ? <Text style={[s.hsS, clamp(1)]}>{h.jb(ctx.toHotelEn)}</Text> : null}
          {ctx.toAddress ? <Text style={[s.hsS, { fontSize: 6.8 }, clamp(1)]}>{h.jb(ctx.toAddress)}</Text> : null}
        </View>
      </View>

      {/* ご対応の流れ */}
      <View style={s.todoTab}>
        <Text style={s.todoTabText}>{h.jb("ご対応の流れ  /  WHAT TO DO")}</Text>
      </View>
      <View style={s.todoPanel}>
        {steps.map((st, i) => (
          <React.Fragment key={i}>
            {i > 0 ? (
              <View style={s.stepArrow}>
                <VIcon name="arrow-right-red" size={mm(5)} />
              </View>
            ) : null}
            <View style={[s.step, i > 0 ? { borderLeftWidth: mm(0.3), borderLeftColor: "#e8c9ce", paddingLeft: mm(3) } : {}]}>
              <View style={[s.row, { alignItems: "center" }]}>
                <View style={s.stepNo}>
                  <Text style={s.stepNoText}>{i + 1}</Text>
                </View>
                <VIcon name={st.icon} size={mm(11)} style={{ marginLeft: mm(4) }} />
              </View>
              <Text style={[s.stepTitle, clamp(2)]}>{h.jb(st.title)}</Text>
              <Text style={[s.stepJa, clamp(4)]}>{h.jb(st.ja)}</Text>
              <Text style={[s.stepEn, clamp(3)]}>{st.en}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
      {ctx.noteForFrom ? (
        <Text style={[{ fontSize: 8, marginTop: mm(2), color: INK_SOFT, lineHeight: 1.4, height: mm(9) }, clamp(2)]}>{h.jb(`申し送り: ${ctx.noteForFrom}`)}</Text>
      ) : null}

      {/* 送り状不要・料金徴収不要 */}
      <View style={[s.noteBox, { height: mm(22) }]}>
        <VIcon name="no-label" size={mm(15)} style={{ marginRight: mm(5) }} />
        <View style={{ flex: 1 }}>
          <Text style={s.noteRed}>{h.jb("送り状のご用意・お荷物への取付けは不要です。")}</Text>
          <Text style={s.noteEn}>No shipping labels are needed.</Text>
          <Text style={[s.noteRed, { marginTop: mm(2) }]}>{h.jb("お客様からの料金徴収は不要です。")}</Text>
          <Text style={s.noteEn}>No payment is required from the guests.</Text>
        </View>
      </View>

      {/* 到着先ホテルへの電話は不要 */}
      <View style={[s.noteBox, { height: mm(18) }]}>
        <VIcon name="info" size={mm(9)} style={{ marginRight: mm(4) }} />
        <View style={{ flex: 1 }}>
          <Text style={s.noteInk}>{h.jb("到着先ホテル様へのお電話は不要です。")}</Text>
          <Text style={[s.noteEn, { color: INK, fontSize: 8.5 }]}>{h.jb("BondExより連絡済み・お受け入れ確認済みです。")}</Text>
          <Text style={s.noteEn}>No need to contact the destination hotel. BondEx has already informed them.</Text>
        </View>
      </View>

      {/* フッター連絡先 */}
      <View style={{ marginTop: "auto" }}>
        <View style={[s.footRule, { marginTop: mm(3) }]} />
        <View style={[s.row, { marginTop: mm(3), alignItems: "flex-start" }]}>
          <View style={[s.contactCol, { borderRightWidth: mm(0.3), borderRightColor: GRAY_LINE }]}>
            <Text style={s.cK}>{h.jb("荷物配送手配業者 / FORWARDING OPERATOR")}</Text>
            <Text style={s.cV}>{h.jb("BondEx サポートデスク")}</Text>
            <View style={[s.row, { alignItems: "center", marginTop: mm(1) }]}>
              <VIcon name="envelope" size={mm(4.5)} style={{ marginRight: mm(2) }} />
              <Text style={[s.cS, clamp(1)]}>{ctx.supportEmail}{ctx.supportPhone ? `  ／  ${ctx.supportPhone}` : ""}</Text>
            </View>
          </View>
          <View style={[s.contactCol, { paddingLeft: mm(3) }]}>
            <Text style={s.cK}>{h.jb("ランドオペレーター / LAND OPERATOR")}</Text>
            <Text style={[s.cV, ctx.tourCompany.length > 22 ? { fontSize: 8 } : {}, clamp(1)]}>{h.jb(ctx.tourCompany || "—")}</Text>
            <Text style={[s.cS, clamp(1)]}>{h.jb(ctx.landOperatorContact || " ")}</Text>
          </View>
          <View style={{ width: mm(40), alignItems: "flex-end", justifyContent: "center", paddingTop: mm(1) }}>
            <Tagline />
          </View>
        </View>
        <FooterLine ctx={ctx} />
      </View>
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Page C — HOW TO SEND YOUR LUGGAGE (howto1)。静的ガイド。書類に 1 枚だけ。
// ---------------------------------------------------------------------------
export function HowToSendPage({
  logoPath,
  supportQrDataUri,
  supportQrKind,
}: {
  logoPath: string
  supportQrDataUri?: string
  supportQrKind?: "whatsapp" | "email"
}) {
  const steps: Array<{ no: string; title: string; icon: VoucherIconName; cap: string }> = [
    { no: "01", title: "CHECK\nYOUR VOUCHER", icon: "voucher", cap: "Check the hotel and drop-off date on your voucher." },
    { no: "02", title: "LEAVE IT AT\nRECEPTION", icon: "reception", cap: "Leave your luggage at the hotel reception by check-out." },
    { no: "03", title: "THAT'S IT.", icon: "delivery", cap: "Your luggage will be delivered to the next hotel on your voucher." },
  ]
  const banned: Array<{ icon: VoucherIconName; label: string }> = [
    { icon: "passport", label: "PASSPORT / ID" },
    { icon: "cash-card", label: "CASH / CARDS" },
    { icon: "medication", label: "MEDICATION" },
    { icon: "valuables", label: "JEWELRY /\nVALUABLES" },
    { icon: "electronics", label: "LAPTOP / TABLET" },
    { icon: "ticket", label: "TICKETS /\nTRAVEL DOCUMENTS" },
  ]
  const isWa = supportQrKind === "whatsapp"
  return (
    <Page size="A4" style={s.page} wrap={false}>
      <View style={s.mast}>
        <Image src={logoPath} style={{ width: mm(52), height: mm(52 * 254 / 1255) }} />
        <View style={[s.row, { alignItems: "center", marginTop: mm(2) }]}>
          <Text style={{ fontSize: 7, letterSpacing: 2.5 }}>QUICK GUIDE</Text>
          <View style={{ width: mm(12), height: mm(0.3), backgroundColor: INK, marginHorizontal: mm(3) }} />
          <Text style={{ fontSize: 5.5, letterSpacing: 1.6, lineHeight: 1.5 }}>TRAVEL LIGHTER{"\n"}EXPLORE MORE</Text>
        </View>
      </View>

      <View style={[s.row, { marginTop: mm(8), alignItems: "center" }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.htTitle}>HOW TO SEND{"\n"}YOUR LUGGAGE</Text>
          <Text style={s.htSubRed}>Just leave your luggage at the hotel reception.</Text>
          <Text style={s.htSub}>We&apos;ll deliver it to your next hotel.</Text>
        </View>
        <View style={s.circle}>
          <Text style={s.circleText}>NO FORMS{"\n"}NO LABELS{"\n"}NO PAYMENT</Text>
          <View style={{ width: mm(30), height: mm(0.3), backgroundColor: "#9a9aa0", marginTop: mm(2.5) }} />
          <Text style={s.circleSub}>AT HOTEL</Text>
        </View>
      </View>

      <View style={s.htRule} />
      <View style={[s.row, { marginTop: mm(5) }]}>
        {steps.map((st, i) => (
          <React.Fragment key={i}>
            {i > 0 ? (
              <View style={{ width: mm(10), alignItems: "center", justifyContent: "center" }}>
                <VIcon name="arrow-right-red" size={mm(6)} />
              </View>
            ) : null}
            <View style={{ flex: 1, borderLeftWidth: i > 0 ? mm(0.3) : 0, borderLeftColor: "#c9c9ce", paddingLeft: i > 0 ? mm(3) : 0 }}>
              <View style={[s.row, { alignItems: "center" }]}>
                <View style={s.htStepNo}>
                  <Text style={s.htStepNoText}>{st.no}</Text>
                </View>
                <Text style={s.htStepTitle}>{st.title}</Text>
              </View>
              <View style={{ alignItems: "center", marginTop: mm(4) }}>
                <VIcon name={st.icon} size={mm(34)} />
              </View>
              <Text style={s.htCaption}>{st.cap}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
      <View style={s.htRule} />

      <View style={s.banPanel}>
        <View style={[s.row, { alignItems: "center" }]}>
          <VIcon name="alert" size={mm(11)} style={{ marginRight: mm(3.5) }} />
          <View>
            <Text style={s.banTitle}>DO NOT PACK THESE ITEMS</Text>
            <Text style={s.banSub}>The following items are not allowed in your luggage.</Text>
          </View>
        </View>
        <View style={[s.row, { marginTop: mm(5) }]}>
          {banned.map((b, i) => (
            <View key={i} style={s.banItem}>
              <VIcon name={b.icon} size={mm(21)} />
              <Text style={s.banLabel}>{b.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[s.row, { marginTop: mm(8), alignItems: "center" }]}>
        <View style={{ flex: 1, borderRightWidth: mm(0.3), borderRightColor: "#c9c9ce", paddingRight: mm(4) }}>
          <Text style={s.htFootBig}>Travel lighter.{"\n"}Travel better.</Text>
          <View style={s.redDash} />
          <Text style={s.htFootSmall}>JAPAN HANDS FREE</Text>
        </View>
        <View style={[s.row, { flex: 1.4, alignItems: "center", paddingLeft: mm(5) }]}>
          {isWa ? (
            WHATSAPP_LOGO_STATUS === "official" ? (
              <VIcon name="whatsapp-glyph" size={mm(19)} />
            ) : (
              <View style={s.waMissing}>
                <Text style={s.waMissingText}>WhatsApp{"\n"}logo{"\n"}(official asset{"\n"}pending)</Text>
              </View>
            )
          ) : (
            <View style={{ width: mm(19), height: mm(19), borderRadius: mm(9.5), backgroundColor: INK, alignItems: "center", justifyContent: "center" }}>
              <VIcon name="envelope" size={mm(9)} color={WHITE} />
            </View>
          )}
          <View style={{ flex: 1, marginLeft: mm(4) }}>
            <Text style={s.needHead}>NEED HELP?</Text>
            <Text style={s.needBody}>{isWa ? "Scan to contact us\non WhatsApp." : "Scan to email\nBondEx support."}</Text>
            <Text style={s.needSmall}>Our team will assist you.</Text>
          </View>
          {supportQrDataUri ? (
            <View style={{ borderWidth: mm(0.3), borderColor: "#c9c9ce", padding: mm(1.5) }}>
              <Image src={supportQrDataUri} style={{ width: mm(24), height: mm(24) }} />
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ marginTop: "auto", flexDirection: "row", justifyContent: "flex-end", alignItems: "center" }}>
        <View style={{ width: mm(8), height: mm(0.6), backgroundColor: RED, marginRight: mm(3) }} />
        <Image src={logoPath} style={{ width: mm(28), height: mm(28 * 254 / 1255) }} />
      </View>
    </Page>
  )
}
