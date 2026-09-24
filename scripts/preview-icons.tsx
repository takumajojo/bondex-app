// アイコン変換の検証: 全アイコンを react-pdf の Svg でベクター描画した PDF を出す。npx tsx scripts/preview-icons.tsx OUT.pdf
import React from "react"
import { Document, Page, View, Text, renderToFile, StyleSheet } from "@react-pdf/renderer"
import { VIcon, VDecor } from "../lib/voucher-icons"
import { VOUCHER_ICONS } from "../lib/voucher-icons.generated"
const s = StyleSheet.create({ page: { padding: 24, fontSize: 7 }, row: { flexDirection: "row", flexWrap: "wrap" }, cell: { width: 100, height: 96, alignItems: "center", margin: 2 } })
const names = Object.keys(VOUCHER_ICONS).filter((n) => !n.startsWith("footer")) as (keyof typeof VOUCHER_ICONS)[]
const band: Record<string, string> = { "calendar-white": "#c8102e", "hotel-white": "#16161a" }
const doc = (
  <Document>
    <Page size="A4" style={s.page}>
      <View style={s.row}>
        {names.map((n) => (
          <View key={n} style={[s.cell, { backgroundColor: band[n] ?? "#ffffff" }]}>
            <VIcon name={n} size={56} />
            <View style={{ flexDirection: "row", marginTop: 4 }}>
              <VIcon name={n} size={24} />
              <VIcon name={n} size={16} style={{ marginLeft: 4 }} />
            </View>
            <Text style={{ color: band[n] ? "#fff" : "#000", marginTop: 3 }}>{n}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 8 }}>
        <VDecor name="footer-skyline" width={540} />
      </View>
    </Page>
  </Document>
)
renderToFile(doc, process.argv[2] || "/tmp/icons.pdf").then(() => console.log("wrote", process.argv[2]))
