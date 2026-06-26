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
// ファイル読み込みはモジュールロード時に1回だけ実行される (process.cwd() は Next.js プロジェクトルート)。
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
  // CJK は1文字単位で改行できるようにする
  Font.registerHyphenationCallback((word: string) => Array.from(word))
} catch {
  // フォント未配置時は英字のみで描画 (テンプレでは Helvetica にフォールバック)
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
  shipmentDate: string // YYYY-MM-DD
  expectedArrival: string // YYYY-MM-DD
  from: VoucherShipmentLocation
  to: VoucherShipmentLocation
  recipient: string
  suitcaseCount: number
  /** ホテルへの drop-off 指定時刻 (例 "8:00"). 空なら "by check-out" 等のデフォルト */
  dropOffTime?: string
  /** "when check-in" など pickup タイミング表現 (空ならデフォルト) */
  pickUpNote?: string
  /** Free-form note shown in the hotel section */
  specialNote?: string
  /** Check-in nights at the destination (e.g. 2 → 「2泊」). Optional. */
  destinationNights?: number
}

export interface VoucherInput {
  bookingId: string
  issuedDate: string // human-readable
  representativeLabel: string
  tourCompany: string
  travelerCount: number
  shipments: VoucherShipment[]
  totalAmount: number
  supportPhone: string
  supportEmail: string
  contactPersonName: string // e.g. "谷口"
  contactPersonPhone: string // e.g. "+81-XX-XXXX-XXXX"
  companyName: string // e.g. "株式会社JOJO"
  companyAddress: string // e.g. "〒158-0092 東京都世田谷区野毛1-9-12"
}

// ---------------------------------------------------------------------------
// Date helpers (formatting)
// ---------------------------------------------------------------------------

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const C_FG = "#111111"
const C_MUTED = "#666666"
const C_HAIRLINE = "#CCCCCC"
const C_BG_SOFT = "#F8F8F8"

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 48,
    fontFamily: "NotoSansJP",
    fontSize: 10,
    color: C_FG,
    backgroundColor: "#FFFFFF",
  },
  // header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  headerLeft: {
    flexDirection: "column",
  },
  headerVoucher: {
    fontSize: 12,
    color: C_MUTED,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 500,
    color: C_FG,
    letterSpacing: 0.3,
  },
  logo: {
    width: 64,
    height: 64,
  },
  noticeBanner: {
    marginVertical: 14,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: C_FG,
    borderBottomWidth: 0.5,
    borderBottomColor: C_FG,
    textAlign: "center",
    fontSize: 10,
    fontWeight: 500,
  },
  // KV block (label | value)
  kvRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  kvKey: {
    width: 130,
    fontSize: 10,
    fontWeight: 500,
    color: C_FG,
  },
  kvValue: {
    flex: 1,
    fontSize: 10,
    color: C_FG,
  },
  // spacing
  gap: { height: 10 },
  gapSmall: { height: 6 },
  gapLarge: { height: 16 },
  // Drop-off / Pick-up block
  dropoffBlock: {
    marginBottom: 6,
  },
  dropoffSub: {
    marginLeft: 130,
    fontSize: 10,
    fontWeight: 500,
    color: C_FG,
    marginTop: 2,
  },
  // Divider between EN / JP sections
  sectionDivider: {
    marginTop: 16,
    marginBottom: 12,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
    paddingTop: 8,
    textAlign: "center",
    fontSize: 9,
    color: C_MUTED,
    fontStyle: "italic",
  },
  // JP section
  jpGreeting: {
    fontSize: 10,
    fontWeight: 500,
    color: C_FG,
    marginBottom: 6,
  },
  jpIntro: {
    fontSize: 9.5,
    color: C_FG,
    lineHeight: 1.55,
    marginBottom: 12,
  },
  jpHotelHeader: {
    fontSize: 11,
    fontWeight: 500,
    color: C_FG,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: C_HAIRLINE,
    marginBottom: 6,
    marginTop: 10,
  },
  jpGuestInfo: {
    fontSize: 9.5,
    color: C_FG,
    marginBottom: 4,
    paddingLeft: 8,
  },
  jpInstruction: {
    fontSize: 9.5,
    color: C_FG,
    lineHeight: 1.55,
    paddingLeft: 8,
    marginBottom: 4,
  },
  // footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: C_MUTED,
  },
  pageNum: {
    color: C_MUTED,
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

  // JP messages embedded as template strings
  const jpFromHeader = `発送元：${shipment.from.hotel} 様`
  const jpToHeader = `発送先：${shipment.to.hotel} 様`
  const fromNights = ""
  const toNights =
    typeof shipment.destinationNights === "number" && shipment.destinationNights > 0
      ? `〜${shipment.destinationNights}泊`
      : ""
  const jpFromGuest = `■ お客様情報　チェックイン日：${formatJpDate(shipment.shipmentDate)}${fromNights} / 代表者 ${data.representativeLabel} ${data.travelerCount}名様`
  const jpToGuest = `■ お客様情報　チェックイン日：${formatJpDate(shipment.expectedArrival)}${toNights} / 代表者 ${data.representativeLabel} ${data.travelerCount}名様`
  const jpFromInstruction = `朝${dropOffTime}までにお客様がスーツケースを預けに来られますので「一時預かり」をお願い致します。午前中に配送業者のドライバーが集荷に伺いますのでお荷物をお渡しください。`
  const jpToInstruction = `お客様のスーツケースが${formatJpDate(shipment.expectedArrival)}に届いております。チェックイン時にお客様にお渡しください。`

  return (
    <Page size="A4" style={styles.page}>
      {/* Header: title + logo */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerVoucher}>Voucher</Text>
          <Text style={styles.headerTitle}>Service: Luggage shipping service</Text>
        </View>
        <Image style={styles.logo} src={LOGO_PATH} />
      </View>

      <View style={styles.noticeBanner}>
        <Text>= Please present this voucher to the reception staff upon check-in =</Text>
      </View>

      {/* EN section */}
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>Transaction number</Text>
        <Text style={styles.kvValue}>{data.bookingId}</Text>
      </View>
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>Number of luggage</Text>
        <Text style={styles.kvValue}>{shipment.suitcaseCount} luggage</Text>
      </View>
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>Supplier</Text>
        <Text style={styles.kvValue}>
          {data.companyName} (Tel: {data.contactPersonPhone} *Japanese speaking only)
        </Text>
      </View>

      <View style={styles.gap} />

      <View style={styles.dropoffBlock}>
        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Drop-off:</Text>
          <Text style={styles.kvValue}>
            at the hotel&#x2019;s reception in {shipment.from.hotel}
          </Text>
        </View>
        <Text style={styles.dropoffSub}>
          On {formatEnDate(shipment.shipmentDate)} by {dropOffTime}
        </Text>
      </View>

      <View style={styles.gapSmall} />

      <View style={styles.dropoffBlock}>
        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Pick-up:</Text>
          <Text style={styles.kvValue}>
            at the hotel&#x2019;s reception in {shipment.to.hotel}
          </Text>
        </View>
        <Text style={styles.dropoffSub}>
          On {formatEnDate(shipment.expectedArrival)} {pickUpNote}
        </Text>
      </View>

      <Text style={styles.sectionDivider}>
        The following is a Japanese message addressed to the hotel representative.
      </Text>

      {/* JP section */}
      <Text style={styles.jpGreeting}>各ご担当者様へ</Text>
      <Text style={styles.jpIntro}>
        ランドオペレーター[{data.tourCompany || "BondEx"}]がこちらの手配を行っております。何か不明な点がありましたら手配担当の{data.contactPersonName}までご連絡ください → {data.contactPersonPhone}
      </Text>

      <Text style={styles.jpHotelHeader}>{jpFromHeader}</Text>
      <Text style={styles.jpGuestInfo}>{jpFromGuest}</Text>
      <Text style={styles.jpInstruction}>{jpFromInstruction}</Text>
      {shipment.specialNote && (
        <Text style={styles.jpInstruction}>※ {shipment.specialNote}</Text>
      )}

      <Text style={styles.jpHotelHeader}>{jpToHeader}</Text>
      <Text style={styles.jpGuestInfo}>{jpToGuest}</Text>
      <Text style={styles.jpInstruction}>{jpToInstruction}</Text>

      {/* Footer */}
      <View style={styles.footer} fixed>
        <View>
          <Text>{data.companyName}</Text>
          <Text>{data.companyAddress}</Text>
          <Text>TEL: {data.contactPersonPhone}</Text>
        </View>
        <Text
          style={styles.pageNum}
          render={() =>
            totalLegs > 1
              ? `Leg ${legIndex + 1} / ${totalLegs} · Total ${totalSuitcases} luggage`
              : `Total ${totalSuitcases} luggage`
          }
        />
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
            <Text style={styles.headerVoucher}>Operations</Text>
            <Text style={styles.headerTitle}>{data.bookingId}</Text>
          </View>
          <Image style={styles.logo} src={LOGO_PATH} />
        </View>

        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Issued</Text>
          <Text style={styles.kvValue}>{data.issuedDate}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Representative</Text>
          <Text style={styles.kvValue}>{data.representativeLabel}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Tour company</Text>
          <Text style={styles.kvValue}>{data.tourCompany}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Travelers</Text>
          <Text style={styles.kvValue}>{data.travelerCount}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Total billing</Text>
          <Text style={styles.kvValue}>¥{data.totalAmount.toLocaleString()}</Text>
        </View>

        {data.shipments.map((s, i) => (
          <View key={i} style={{ marginTop: 14 }}>
            <Text style={styles.jpHotelHeader}>
              Leg {i + 1} of {data.shipments.length}
            </Text>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Ship out</Text>
              <Text style={styles.kvValue}>{s.shipmentDate}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Expected arrival</Text>
              <Text style={styles.kvValue}>{s.expectedArrival}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>From</Text>
              <Text style={styles.kvValue}>
                {s.from.hotel} — {s.from.address || s.from.city}
              </Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>To</Text>
              <Text style={styles.kvValue}>
                {s.to.hotel} — {s.to.address || s.to.city}
              </Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Recipient</Text>
              <Text style={styles.kvValue}>{s.recipient}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Suitcases</Text>
              <Text style={styles.kvValue}>
                {s.suitcaseCount} × ¥5,000 = ¥{(s.suitcaseCount * 5000).toLocaleString()}
              </Text>
            </View>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <View>
            <Text>{data.companyName}</Text>
            <Text>{data.companyAddress}</Text>
          </View>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
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
