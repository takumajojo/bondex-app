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
} from "@react-pdf/renderer"

// ---------------------------------------------------------------------------
// Fonts: register Noto Sans JP for Japanese rendering.
// ---------------------------------------------------------------------------

const FONT_DIR = path.join(process.cwd(), "public", "fonts")
const LOGO_PATH = path.join(process.cwd(), "public", "bondex-logo.png")

try {
  Font.register({
    family: "NotoSansJP",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSansJP-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "NotoSansJP-Medium.ttf"), fontWeight: 500 },
    ],
  })
  Font.registerHyphenationCallback((word: string) => Array.from(word))
} catch {
  // フォント未配置時は Helvetica にフォールバック
}

// ---------------------------------------------------------------------------
// Types
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
}

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
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const MONTHS_EN_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

function formatEnDate(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ymd
  return `${p.d} ${MONTHS_EN[p.m - 1]}`
}

function formatJpDate(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ymd
  return `${p.y}年${p.m}月${p.d}日`
}

function dayOfMonth(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ""
  return String(p.d)
}

function monthShort(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ""
  return MONTHS_EN_SHORT[p.m - 1].toUpperCase()
}

function yearStr(ymd: string): string {
  const p = parseYmd(ymd)
  if (!p) return ""
  return String(p.y)
}

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const C_FG = "#0F0F0F"
const C_FG_SOFT = "#3A3A3A"
const C_MUTED = "#7A7A7A"
const C_HAIRLINE = "#E5E5E5"
const C_HAIRLINE_STRONG = "#1A1A1A"
const C_BG_SOFT = "#F6F6F4"
const C_BG_TINT = "#FAFAF8"

const PAGE_PAD_H = 44
const PAGE_PAD_TOP = 38
const PAGE_PAD_BOTTOM = 56

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_PAD_TOP,
    paddingBottom: PAGE_PAD_BOTTOM,
    paddingHorizontal: PAGE_PAD_H,
    fontFamily: "NotoSansJP",
    fontSize: 9.5,
    color: C_FG,
    backgroundColor: "#FFFFFF",
    lineHeight: 1.5,
  },

  // ---------------- Header ----------------
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  headerLeft: { flexDirection: "column", flexShrink: 1, paddingRight: 12 },
  headerEyebrow: {
    fontSize: 8,
    color: C_MUTED,
    letterSpacing: 3.5,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 500,
    color: C_FG,
    letterSpacing: -0.2,
    lineHeight: 1.15,
  },
  headerSubtitle: {
    fontSize: 9,
    color: C_MUTED,
    marginTop: 6,
    letterSpacing: 0.3,
  },
  headerRight: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  headerRefBox: {
    flexDirection: "column",
    alignItems: "flex-end",
    marginTop: 6,
  },
  headerRefLabel: {
    fontSize: 7,
    color: C_MUTED,
    letterSpacing: 2,
    marginBottom: 3,
  },
  headerRefValue: {
    fontSize: 11,
    fontWeight: 500,
    color: C_FG,
    letterSpacing: 0.5,
  },
  logo: {
    width: 52,
    height: 52,
    marginBottom: 8,
  },

  // ---------------- Top rule ----------------
  topRule: {
    height: 2,
    backgroundColor: C_HAIRLINE_STRONG,
    marginTop: 16,
    marginBottom: 0,
  },

  // ---------------- Notice pill ----------------
  noticeWrap: {
    alignItems: "center",
    marginTop: 18,
    marginBottom: 22,
  },
  noticePill: {
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: C_FG,
    fontSize: 8.5,
    color: C_FG,
    letterSpacing: 0.6,
  },

  // ---------------- Journey card ----------------
  journeyCard: {
    flexDirection: "row",
    borderWidth: 0.5,
    borderColor: C_HAIRLINE,
    backgroundColor: C_BG_TINT,
    borderRadius: 4,
    overflow: "hidden",
  },
  journeyCol: {
    flex: 1,
    padding: 18,
    flexDirection: "column",
  },
  journeyColRight: {
    borderLeftWidth: 0.5,
    borderLeftColor: C_HAIRLINE,
  },
  journeyLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  journeyLabel: {
    fontSize: 8,
    color: C_MUTED,
    letterSpacing: 2,
    marginRight: 8,
  },
  journeyLabelDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: C_FG,
  },
  journeyDateRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 8,
  },
  journeyDay: {
    fontSize: 28,
    fontWeight: 500,
    color: C_FG,
    letterSpacing: -0.5,
    lineHeight: 1,
    marginRight: 6,
  },
  journeyMonth: {
    fontSize: 10,
    color: C_FG_SOFT,
    letterSpacing: 1.5,
  },
  journeyYear: {
    fontSize: 8.5,
    color: C_MUTED,
    marginLeft: 6,
  },
  journeyHotel: {
    fontSize: 11,
    fontWeight: 500,
    color: C_FG,
    marginBottom: 3,
    lineHeight: 1.25,
  },
  journeyHotelMeta: {
    fontSize: 8.5,
    color: C_MUTED,
    letterSpacing: 0.2,
  },

  // ---------------- Details strip ----------------
  detailsStrip: {
    marginTop: 18,
    marginBottom: 22,
    paddingTop: 14,
    paddingBottom: 4,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  detailItem: {
    width: "33.33%",
    paddingRight: 12,
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 7.5,
    color: C_MUTED,
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  detailValue: {
    fontSize: 9.5,
    color: C_FG,
    fontWeight: 500,
    lineHeight: 1.35,
  },

  // ---------------- JP section ----------------
  jpSection: {
    backgroundColor: C_BG_SOFT,
    borderLeftWidth: 2,
    borderLeftColor: C_FG,
    padding: 16,
    marginTop: 2,
  },
  jpSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  jpGreeting: {
    fontSize: 11,
    fontWeight: 500,
    color: C_FG,
  },
  jpHeaderHint: {
    fontSize: 7.5,
    color: C_MUTED,
    letterSpacing: 0.5,
  },
  jpIntro: {
    fontSize: 9,
    color: C_FG_SOFT,
    lineHeight: 1.6,
    marginTop: 8,
    marginBottom: 14,
  },
  jpStep: {
    flexDirection: "row",
    marginBottom: 12,
  },
  jpStepBullet: {
    width: 18,
    paddingTop: 1,
  },
  jpStepBulletNum: {
    fontSize: 9,
    fontWeight: 500,
    color: C_FG,
    letterSpacing: 0.5,
  },
  jpStepBody: {
    flex: 1,
  },
  jpStepTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 4,
  },
  jpStepLabel: {
    fontSize: 8,
    color: C_MUTED,
    letterSpacing: 1.5,
    marginRight: 8,
  },
  jpStepHotel: {
    fontSize: 10.5,
    fontWeight: 500,
    color: C_FG,
  },
  jpStepMeta: {
    fontSize: 8.5,
    color: C_FG_SOFT,
    marginBottom: 4,
  },
  jpStepInstruction: {
    fontSize: 9,
    color: C_FG,
    lineHeight: 1.6,
  },
  jpStepNote: {
    fontSize: 8.5,
    color: C_FG_SOFT,
    lineHeight: 1.55,
    marginTop: 4,
  },

  // ---------------- Footer ----------------
  footer: {
    position: "absolute",
    bottom: 22,
    left: PAGE_PAD_H,
    right: PAGE_PAD_H,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerCol: { flexDirection: "column" },
  footerCompany: {
    fontSize: 8.5,
    fontWeight: 500,
    color: C_FG,
    marginBottom: 2,
  },
  footerLine: {
    fontSize: 7.5,
    color: C_MUTED,
    lineHeight: 1.4,
  },
  footerRight: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  footerLeg: {
    fontSize: 8,
    color: C_FG,
    fontWeight: 500,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  footerLegSub: {
    fontSize: 7.5,
    color: C_MUTED,
    letterSpacing: 0.3,
  },

  // ---------------- Ops doc (operations sheet) helpers ----------------
  opsKvRow: { flexDirection: "row", marginBottom: 6 },
  opsKvKey: { width: 130, fontSize: 10, fontWeight: 500, color: C_FG },
  opsKvValue: { flex: 1, fontSize: 10, color: C_FG },
  opsLegHeader: {
    fontSize: 11,
    fontWeight: 500,
    color: C_FG,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: C_HAIRLINE,
    marginBottom: 6,
    marginTop: 10,
  },
})

// ---------------------------------------------------------------------------
// Per-leg voucher page
// ---------------------------------------------------------------------------

function LegPage({
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
  const totalSuitcases = data.shipments.reduce((sum, s) => sum + s.suitcaseCount, 0)
  const dropOffTime = shipment.dropOffTime?.trim() || "check-out"
  const pickUpNote = shipment.pickUpNote?.trim() || "when check-in"

  const jpFromInstruction = `朝${dropOffTime}までにお客様がスーツケースを預けに来られますので「一時預かり」をお願い致します。午前中に配送業者のドライバーが集荷に伺いますのでお荷物をお渡しください。`
  const jpToInstruction = `お客様のスーツケースが${formatJpDate(shipment.expectedArrival)}に届いております。チェックイン時にお客様にお渡しください。`

  return (
    <Page size="A4" style={styles.page}>
      {/* ---------------- Header ---------------- */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerEyebrow}>VOUCHER · BONDEX</Text>
          <Text style={styles.headerTitle}>Luggage Forwarding</Text>
          <Text style={styles.headerSubtitle}>
            Between hotels in Japan · Operated by {data.companyName}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Image style={styles.logo} src={LOGO_PATH} />
          <View style={styles.headerRefBox}>
            <Text style={styles.headerRefLabel}>REF</Text>
            <Text style={styles.headerRefValue}>{data.bookingId}</Text>
          </View>
        </View>
      </View>

      <View style={styles.topRule} />

      {/* ---------------- Notice pill ---------------- */}
      <View style={styles.noticeWrap}>
        <Text style={styles.noticePill}>
          PLEASE PRESENT THIS VOUCHER AT THE RECEPTION
        </Text>
      </View>

      {/* ---------------- Journey card ---------------- */}
      <View style={styles.journeyCard}>
        <View style={styles.journeyCol}>
          <View style={styles.journeyLabelRow}>
            <Text style={styles.journeyLabel}>DROP-OFF</Text>
            <View style={styles.journeyLabelDot} />
          </View>
          <View style={styles.journeyDateRow}>
            <Text style={styles.journeyDay}>{dayOfMonth(shipment.shipmentDate)}</Text>
            <Text style={styles.journeyMonth}>{monthShort(shipment.shipmentDate)}</Text>
            <Text style={styles.journeyYear}>{yearStr(shipment.shipmentDate)}</Text>
          </View>
          <Text style={styles.journeyHotel}>{shipment.from.hotel}</Text>
          <Text style={styles.journeyHotelMeta}>
            at the hotel&#x2019;s reception · by {dropOffTime}
          </Text>
        </View>

        <View style={[styles.journeyCol, styles.journeyColRight]}>
          <View style={styles.journeyLabelRow}>
            <Text style={styles.journeyLabel}>PICK-UP</Text>
            <View style={styles.journeyLabelDot} />
          </View>
          <View style={styles.journeyDateRow}>
            <Text style={styles.journeyDay}>{dayOfMonth(shipment.expectedArrival)}</Text>
            <Text style={styles.journeyMonth}>{monthShort(shipment.expectedArrival)}</Text>
            <Text style={styles.journeyYear}>{yearStr(shipment.expectedArrival)}</Text>
          </View>
          <Text style={styles.journeyHotel}>{shipment.to.hotel}</Text>
          <Text style={styles.journeyHotelMeta}>
            at the hotel&#x2019;s reception · {pickUpNote}
          </Text>
        </View>
      </View>

      {/* ---------------- Details strip ---------------- */}
      <View style={styles.detailsStrip}>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>NUMBER OF LUGGAGE</Text>
          <Text style={styles.detailValue}>{shipment.suitcaseCount} piece{shipment.suitcaseCount === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>FORWARDED BY</Text>
          <Text style={styles.detailValue}>BondEx</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>CONTACT</Text>
          <Text style={styles.detailValue}>{data.contactPersonPhone}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>FROM (EN)</Text>
          <Text style={styles.detailValue}>
            {formatEnDate(shipment.shipmentDate)} · {shipment.from.hotel}
          </Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>TO (EN)</Text>
          <Text style={styles.detailValue}>
            {formatEnDate(shipment.expectedArrival)} · {shipment.to.hotel}
          </Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>REPRESENTATIVE</Text>
          <Text style={styles.detailValue}>
            {data.representativeLabel} · {data.travelerCount} guest{data.travelerCount === 1 ? "" : "s"}
          </Text>
        </View>
      </View>

      {/* ---------------- JP section ---------------- */}
      <View style={styles.jpSection}>
        <View style={styles.jpSectionHeader}>
          <Text style={styles.jpGreeting}>ホテルご担当者様へ</Text>
          <Text style={styles.jpHeaderHint}>FOR HOTEL STAFF · 日本語</Text>
        </View>
        <Text style={styles.jpIntro}>
          配送担当：BondEx（運営 {data.companyName}）— ランドオペレーター[{data.tourCompany || "BondEx"}]からの手配です。何かご不明な点がございましたら、手配担当の{data.contactPersonName}までご連絡ください　TEL: {data.contactPersonPhone}
        </Text>

        {/* Step 1: 発送元 */}
        <View style={styles.jpStep}>
          <View style={styles.jpStepBullet}>
            <Text style={styles.jpStepBulletNum}>01</Text>
          </View>
          <View style={styles.jpStepBody}>
            <View style={styles.jpStepTitleRow}>
              <Text style={styles.jpStepLabel}>発送元</Text>
              <Text style={styles.jpStepHotel}>{shipment.from.hotel} 様</Text>
            </View>
            <Text style={styles.jpStepMeta}>
              チェックイン日：{formatJpDate(shipment.shipmentDate)}　／　代表者 {data.representativeLabel}　{data.travelerCount}名様
            </Text>
            <Text style={styles.jpStepInstruction}>{jpFromInstruction}</Text>
            {shipment.specialNote && (
              <Text style={styles.jpStepNote}>※ {shipment.specialNote}</Text>
            )}
          </View>
        </View>

        {/* Step 2: 発送先 */}
        <View style={styles.jpStep}>
          <View style={styles.jpStepBullet}>
            <Text style={styles.jpStepBulletNum}>02</Text>
          </View>
          <View style={styles.jpStepBody}>
            <View style={styles.jpStepTitleRow}>
              <Text style={styles.jpStepLabel}>発送先</Text>
              <Text style={styles.jpStepHotel}>{shipment.to.hotel} 様</Text>
            </View>
            <Text style={styles.jpStepMeta}>
              チェックイン日：{formatJpDate(shipment.expectedArrival)}　／　代表者 {data.representativeLabel}　{data.travelerCount}名様
            </Text>
            <Text style={styles.jpStepInstruction}>{jpToInstruction}</Text>
          </View>
        </View>
      </View>

      {/* ---------------- Footer ---------------- */}
      <View style={styles.footer} fixed>
        <View style={styles.footerCol}>
          <Text style={styles.footerCompany}>{data.companyName}</Text>
          <Text style={styles.footerLine}>{data.companyAddress}</Text>
          <Text style={styles.footerLine}>TEL: {data.contactPersonPhone}</Text>
        </View>
        <View style={styles.footerRight}>
          <Text style={styles.footerLeg}>
            {totalLegs > 1
              ? `LEG ${legIndex + 1} / ${totalLegs}`
              : `SINGLE LEG`}
          </Text>
          <Text style={styles.footerLegSub}>Total {totalSuitcases} luggage · {data.bookingId}</Text>
        </View>
      </View>
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Public components
// ---------------------------------------------------------------------------

export function VoucherDocument({ data }: { data: VoucherInput }) {
  return (
    <Document
      title={`BondEx Voucher ${data.bookingId}`}
      author={data.companyName}
      subject="Luggage Forwarding Voucher"
    >
      {data.shipments.map((shipment, i) => (
        <LegPage
          key={i}
          data={data}
          shipment={shipment}
          legIndex={i}
          totalLegs={data.shipments.length}
        />
      ))}
    </Document>
  )
}

// Operations PDF: 内部記録用、簡素版。Ship&co の本物 Yamato 伝票が出るまでのつなぎ。
export function OperationsDocument({ data }: { data: VoucherInput }) {
  return (
    <Document
      title={`BondEx Ops ${data.bookingId}`}
      author={data.companyName}
      subject="Operations Sheet"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerEyebrow}>OPERATIONS</Text>
            <Text style={styles.headerTitle}>{data.bookingId}</Text>
          </View>
          <Image style={styles.logo} src={LOGO_PATH} />
        </View>
        <View style={styles.topRule} />
        <View style={{ height: 16 }} />

        <View style={styles.opsKvRow}>
          <Text style={styles.opsKvKey}>Issued</Text>
          <Text style={styles.opsKvValue}>{data.issuedDate}</Text>
        </View>
        <View style={styles.opsKvRow}>
          <Text style={styles.opsKvKey}>Representative</Text>
          <Text style={styles.opsKvValue}>{data.representativeLabel}</Text>
        </View>
        <View style={styles.opsKvRow}>
          <Text style={styles.opsKvKey}>Tour company</Text>
          <Text style={styles.opsKvValue}>{data.tourCompany}</Text>
        </View>
        <View style={styles.opsKvRow}>
          <Text style={styles.opsKvKey}>Travelers</Text>
          <Text style={styles.opsKvValue}>{data.travelerCount}</Text>
        </View>
        <View style={styles.opsKvRow}>
          <Text style={styles.opsKvKey}>Total billing</Text>
          <Text style={styles.opsKvValue}>¥{data.totalAmount.toLocaleString()}</Text>
        </View>

        {data.shipments.map((s, i) => (
          <View key={i} style={{ marginTop: 14 }}>
            <Text style={styles.opsLegHeader}>
              Leg {i + 1} of {data.shipments.length}
            </Text>
            <View style={styles.opsKvRow}>
              <Text style={styles.opsKvKey}>Ship out</Text>
              <Text style={styles.opsKvValue}>{s.shipmentDate}</Text>
            </View>
            <View style={styles.opsKvRow}>
              <Text style={styles.opsKvKey}>Expected arrival</Text>
              <Text style={styles.opsKvValue}>{s.expectedArrival}</Text>
            </View>
            <View style={styles.opsKvRow}>
              <Text style={styles.opsKvKey}>From</Text>
              <Text style={styles.opsKvValue}>
                {s.from.hotel} — {s.from.address || s.from.city}
              </Text>
            </View>
            <View style={styles.opsKvRow}>
              <Text style={styles.opsKvKey}>To</Text>
              <Text style={styles.opsKvValue}>
                {s.to.hotel} — {s.to.address || s.to.city}
              </Text>
            </View>
            <View style={styles.opsKvRow}>
              <Text style={styles.opsKvKey}>Recipient</Text>
              <Text style={styles.opsKvValue}>{s.recipient}</Text>
            </View>
            <View style={styles.opsKvRow}>
              <Text style={styles.opsKvKey}>Suitcases</Text>
              <Text style={styles.opsKvValue}>
                {s.suitcaseCount} × ¥5,000 = ¥{(s.suitcaseCount * 5000).toLocaleString()}
              </Text>
            </View>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <View style={styles.footerCol}>
            <Text style={styles.footerCompany}>{data.companyName}</Text>
            <Text style={styles.footerLine}>{data.companyAddress}</Text>
          </View>
          <Text
            style={styles.footerLegSub}
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
  email: "support@bondex.express",
  contactPersonName: "谷口",
  companyName: "株式会社JOJO",
  companyAddress: "〒158-0092 東京都世田谷区野毛1-9-12",
}

export function generateBookingId(): string {
  const now = new Date()
  const yy = String(now.getFullYear() % 100).padStart(2, "0")
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const rand = Math.floor(100 + Math.random() * 900)
  return `BDX-${yy}${mm}${dd}-${rand}`
}

export function formatIssuedDate(d: Date = new Date()): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}
