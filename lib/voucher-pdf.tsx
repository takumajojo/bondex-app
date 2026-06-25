/* eslint-disable @next/next/no-img-element */
import React from "react"
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"

// ---------------------------------------------------------------------------
// Types — must match the parsed itinerary shape from /api/itinerary/parse
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
}

// ---------------------------------------------------------------------------
// Shared styles — black & white per docs/design-tokens.md.
// 全て font-normal/medium 想定 (font-bold は使わない方針)。
// ---------------------------------------------------------------------------

const COLOR_FG = "#0A0A0A"
const COLOR_MUTED = "#737373"
const COLOR_BORDER = "#D4D4D4"
const COLOR_HAIRLINE = "#E5E5E5"
const COLOR_BG_SOFT = "#FAFAFA"

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLOR_FG,
    backgroundColor: "#FFFFFF",
  },
  // header band
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 16,
  },
  brand: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    letterSpacing: 2,
    color: COLOR_FG,
  },
  docTitle: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLOR_MUTED,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  hr: {
    borderTopWidth: 0.5,
    borderTopColor: COLOR_BORDER,
    marginBottom: 24,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  metaLabel: {
    color: COLOR_MUTED,
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  metaValue: {
    fontSize: 11,
    color: COLOR_FG,
  },
  // section block
  section: {
    marginBottom: 22,
  },
  sectionLabel: {
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: COLOR_MUTED,
    marginBottom: 8,
  },
  // card with border
  card: {
    borderWidth: 0.5,
    borderColor: COLOR_BORDER,
    borderRadius: 6,
    padding: 16,
    marginBottom: 8,
  },
  cardSoft: {
    backgroundColor: COLOR_BG_SOFT,
    borderWidth: 0.5,
    borderColor: COLOR_HAIRLINE,
    borderRadius: 6,
    padding: 16,
  },
  // representative card
  repName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 18,
    color: COLOR_FG,
    marginBottom: 8,
  },
  repMeta: {
    fontSize: 10,
    color: COLOR_FG,
    marginBottom: 2,
  },
  repMetaMuted: {
    color: COLOR_MUTED,
  },
  // shipment leg
  legRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  legNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLOR_FG,
    color: "#FFFFFF",
    fontSize: 10,
    textAlign: "center",
    paddingTop: 5,
  },
  legNumText: {
    color: "#FFFFFF",
    fontSize: 10,
    textAlign: "center",
  },
  legBody: {
    flex: 1,
  },
  legHotel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: COLOR_FG,
    marginBottom: 2,
  },
  legArrow: {
    fontSize: 10,
    color: COLOR_MUTED,
    marginVertical: 4,
  },
  legMetaRow: {
    flexDirection: "row",
    marginTop: 6,
  },
  legMetaCol: {
    flex: 1,
  },
  legMetaLabel: {
    fontSize: 7,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: COLOR_MUTED,
    marginBottom: 2,
  },
  legMetaValue: {
    fontSize: 10,
    color: COLOR_FG,
  },
  // footer support
  supportCard: {
    borderTopWidth: 0.5,
    borderTopColor: COLOR_FG,
    paddingTop: 14,
    marginTop: 18,
    marginBottom: 14,
  },
  supportLabel: {
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: COLOR_FG,
    marginBottom: 6,
  },
  supportRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  supportKey: {
    fontSize: 9,
    color: COLOR_MUTED,
    width: 56,
  },
  supportVal: {
    fontSize: 10,
    color: COLOR_FG,
  },
  // page footer
  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: COLOR_MUTED,
    letterSpacing: 0.5,
  },
  // ops sheet specific
  opsLegCard: {
    borderWidth: 0.5,
    borderColor: COLOR_BORDER,
    borderRadius: 6,
    padding: 16,
    marginBottom: 12,
  },
  opsLegHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    marginBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR_HAIRLINE,
  },
  opsKv: {
    flexDirection: "row",
    marginBottom: 3,
  },
  opsKvKey: {
    width: 80,
    color: COLOR_MUTED,
    fontSize: 9,
  },
  opsKvVal: {
    flex: 1,
    fontSize: 10,
    color: COLOR_FG,
  },
  opsBlock: {
    marginTop: 8,
    marginBottom: 4,
  },
  opsAddrLine: {
    fontSize: 9.5,
    color: COLOR_FG,
    marginBottom: 1,
    paddingLeft: 8,
  },
  opsSubLabel: {
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: COLOR_MUTED,
    marginBottom: 4,
    marginTop: 6,
  },
  opsSuitcaseRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  opsSuitcaseLabel: {
    width: 60,
    fontSize: 9,
    color: COLOR_FG,
  },
  opsTrackingLine: {
    flex: 1,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR_MUTED,
    paddingBottom: 1,
    fontSize: 9,
    color: COLOR_MUTED,
  },
})

// ---------------------------------------------------------------------------
// Voucher (traveler-facing) — A4 portrait, English
// ---------------------------------------------------------------------------

export function VoucherDocument({ data }: { data: VoucherInput }) {
  return (
    <Document
      title={`BondEx Voucher ${data.bookingId}`}
      author="JOJO Corporation"
      subject="Luggage Forwarding Voucher"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.brand}>BONDEX</Text>
          <Text style={styles.docTitle}>Luggage Forwarding Voucher</Text>
        </View>
        <View style={styles.hr} />

        {/* Meta */}
        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>Booking</Text>
            <Text style={styles.metaValue}>{data.bookingId}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Issued</Text>
            <Text style={styles.metaValue}>{data.issuedDate}</Text>
          </View>
        </View>

        {/* Representative */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Representative</Text>
          <View style={styles.cardSoft}>
            <Text style={styles.repName}>{data.representativeLabel}</Text>
            <Text style={styles.repMeta}>
              <Text style={styles.repMetaMuted}>Tour company  </Text>
              {data.tourCompany}
            </Text>
            <Text style={styles.repMeta}>
              <Text style={styles.repMetaMuted}>Travelers  </Text>
              {data.travelerCount}
            </Text>
          </View>
        </View>

        {/* Shipment Plan */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Shipment Plan</Text>
          {data.shipments.map((s, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.legRow}>
                <View style={styles.legNum}>
                  <Text style={styles.legNumText}>{i + 1}</Text>
                </View>
                <View style={styles.legBody}>
                  <Text style={styles.legHotel}>{s.from.hotel}</Text>
                  <Text style={styles.legArrow}>↓</Text>
                  <Text style={styles.legHotel}>{s.to.hotel}</Text>
                  <View style={styles.legMetaRow}>
                    <View style={styles.legMetaCol}>
                      <Text style={styles.legMetaLabel}>Ship out</Text>
                      <Text style={styles.legMetaValue}>{s.shipmentDate}</Text>
                    </View>
                    <View style={styles.legMetaCol}>
                      <Text style={styles.legMetaLabel}>Arrive</Text>
                      <Text style={styles.legMetaValue}>{s.expectedArrival}</Text>
                    </View>
                    <View style={styles.legMetaCol}>
                      <Text style={styles.legMetaLabel}>Suitcases</Text>
                      <Text style={styles.legMetaValue}>{s.suitcaseCount}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Support */}
        <View style={styles.supportCard}>
          <Text style={styles.supportLabel}>24 / 7 Support</Text>
          <View style={styles.supportRow}>
            <Text style={styles.supportKey}>Phone</Text>
            <Text style={styles.supportVal}>{data.supportPhone}</Text>
          </View>
          <View style={styles.supportRow}>
            <Text style={styles.supportKey}>Email</Text>
            <Text style={styles.supportVal}>{data.supportEmail}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>JOJO Corporation</Text>
          <Text>bondex.express</Text>
        </View>
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Operations Sheet (JOJO / hotel staff facing) — A4, English labels
// (Japanese fonts are not bundled; English labels keep rendering reliable.)
// ---------------------------------------------------------------------------

export function OperationsDocument({ data }: { data: VoucherInput }) {
  return (
    <Document
      title={`BondEx Ops Sheet ${data.bookingId}`}
      author="JOJO Corporation"
      subject="Operations Sheet"
    >
      <Page size="A4" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.brand}>BONDEX</Text>
          <Text style={styles.docTitle}>Operations Sheet · Internal</Text>
        </View>
        <View style={styles.hr} />

        {/* Meta */}
        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>Booking</Text>
            <Text style={styles.metaValue}>{data.bookingId}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Issued</Text>
            <Text style={styles.metaValue}>{data.issuedDate}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Total billing</Text>
            <Text style={styles.metaValue}>¥{data.totalAmount.toLocaleString()}</Text>
          </View>
        </View>

        {/* Booking summary */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Booking Summary</Text>
          <View style={styles.cardSoft}>
            <View style={styles.opsKv}>
              <Text style={styles.opsKvKey}>Representative</Text>
              <Text style={styles.opsKvVal}>{data.representativeLabel}</Text>
            </View>
            <View style={styles.opsKv}>
              <Text style={styles.opsKvKey}>Tour company</Text>
              <Text style={styles.opsKvVal}>{data.tourCompany}</Text>
            </View>
            <View style={styles.opsKv}>
              <Text style={styles.opsKvKey}>Travelers</Text>
              <Text style={styles.opsKvVal}>{data.travelerCount}</Text>
            </View>
            <View style={styles.opsKv}>
              <Text style={styles.opsKvKey}>Total legs</Text>
              <Text style={styles.opsKvVal}>{data.shipments.length}</Text>
            </View>
          </View>
        </View>

        {/* Legs */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Shipment Legs</Text>
          {data.shipments.map((s, i) => (
            <View key={i} style={styles.opsLegCard} wrap={false}>
              <View style={styles.opsLegHeader}>
                <Text style={styles.legHotel}>Leg {i + 1} of {data.shipments.length}</Text>
                <Text style={styles.metaValue}>{s.suitcaseCount} × ¥{(5000).toLocaleString()} = ¥{(s.suitcaseCount * 5000).toLocaleString()}</Text>
              </View>

              <View style={styles.opsKv}>
                <Text style={styles.opsKvKey}>Ship out</Text>
                <Text style={styles.opsKvVal}>{s.shipmentDate}</Text>
              </View>
              <View style={styles.opsKv}>
                <Text style={styles.opsKvKey}>Expected arrival</Text>
                <Text style={styles.opsKvVal}>{s.expectedArrival}</Text>
              </View>
              <View style={styles.opsKv}>
                <Text style={styles.opsKvKey}>Recipient</Text>
                <Text style={styles.opsKvVal}>{s.recipient}</Text>
              </View>

              <Text style={styles.opsSubLabel}>From</Text>
              <Text style={styles.opsAddrLine}>{s.from.hotel}</Text>
              <Text style={styles.opsAddrLine}>{s.from.address}</Text>

              <Text style={styles.opsSubLabel}>To</Text>
              <Text style={styles.opsAddrLine}>{s.to.hotel}</Text>
              <Text style={styles.opsAddrLine}>{s.to.address}</Text>

              <Text style={styles.opsSubLabel}>Suitcases · Yamato tracking #</Text>
              {Array.from({ length: Math.max(1, s.suitcaseCount) }).map((_, j) => (
                <View key={j} style={styles.opsSuitcaseRow}>
                  <Text style={styles.opsSuitcaseLabel}>
                    #{j + 1} of {s.suitcaseCount}
                  </Text>
                  <Text style={styles.opsTrackingLine}> </Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {/* Support */}
        <View style={styles.supportCard}>
          <Text style={styles.supportLabel}>24 / 7 Support</Text>
          <View style={styles.supportRow}>
            <Text style={styles.supportKey}>Phone</Text>
            <Text style={styles.supportVal}>{data.supportPhone}</Text>
          </View>
          <View style={styles.supportRow}>
            <Text style={styles.supportKey}>Email</Text>
            <Text style={styles.supportVal}>{data.supportEmail}</Text>
          </View>
        </View>

        {/* Footer with page number */}
        <View style={styles.footer} fixed>
          <Text>JOJO Corporation · bondex.express</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const SUPPORT_DEFAULTS = {
  phone: "+81-XX-XXXX-XXXX",
  email: "support@bondex.express",
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
  // e.g. "June 25, 2026"
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}
