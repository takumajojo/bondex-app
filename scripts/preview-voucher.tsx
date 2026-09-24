// バウチャーのレイアウト確認用プレビュー生成 (レビュー用・本番未使用)。
// 実行: npx tsx scripts/preview-voucher.tsx [OUT_DIR]  (repo ルートから)
// 団体 / 個人客 × 送り状ドライバー持参 (driver_brings) と、従来運用 (guest_brings) の回帰確認を出力する。
import { renderToFile } from "@react-pdf/renderer"
import QRCode from "qrcode"
import path from "path"
import { VoucherDocument, type VoucherInput, type VoucherShipment } from "../lib/voucher-pdf"

const OUT_DIR = process.argv[2] || "/tmp"

const NAMES = [
  "James Anderson", "Emily Johnson", "Michael Williams", "Sarah Brown", "Daniel Miller", "Jessica Davis",
  "Christopher Wilson", "Ashley Moore", "Matthew Taylor", "Amanda Thomas", "Joshua Martin", "Lauren Jackson",
  "Andrew White", "Megan Harris", "David Thompson", "Rachel Garcia", "Joseph Martinez", "Stephanie Robinson",
  "Ryan Clark", "Nicole Rodriguez", "Brandon Lewis", "Samantha Lee", "Kevin Walker", "Brittany Hall",
  "Jonathan Allen", "Melissa Young", "Justin Hernandez", "Rebecca King", "Nathan Wright", "Heather Lopez",
  "Eric Hill", "Danielle Scott", "Adam Green", "Michelle Adams", "Brian Baker",
]

const leg1: VoucherShipment = {
  shipmentDate: "2026-12-16",
  expectedArrival: "2026-12-18",
  from: { hotel: "ヒルトン東京", address: "東京都新宿区西新宿6-6-2", city: "新宿区" },
  to: { hotel: "ひだホテルプラザ", address: "岐阜県高山市花岡町2-60", city: "高山市" },
  recipient: "D&N JOURNEYS",
  suitcaseCount: 39,
  bookingName: "D&N JOURNEYS",
  fromCheckIn: "2026-12-18",
  fromHotelEn: "Hilton Tokyo",
  toHotelEn: "Hida Hotel Plaza",
}
const leg2: VoucherShipment = {
  ...leg1,
  shipmentDate: "2026-12-20",
  expectedArrival: "2026-12-22",
  from: leg1.to,
  to: { hotel: "ザ・リッツ・カールトン京都", address: "京都府京都市中京区鴨川二条大橋畔", city: "京都市中京区" },
  fromHotelEn: "Hida Hotel Plaza",
  toHotelEn: "The Ritz-Carlton Kyoto",
  fromCheckIn: "2026-12-22",
  specialNote: "到着後はベルデスク奥の団体荷物置き場へお願いします",
}
const leg3: VoucherShipment = {
  ...leg1,
  shipmentDate: "2026-12-23",
  expectedArrival: "2026-12-25",
  from: leg2.to,
  to: { hotel: "帝国ホテル 大阪", address: "大阪府大阪市北区天満橋1-8-50", city: "大阪市北区" },
  fromHotelEn: "The Ritz-Carlton Kyoto",
  toHotelEn: "Imperial Hotel Osaka",
  fromCheckIn: "2026-12-25",
}

async function main() {
  const trackingQr = await QRCode.toDataURL("https://bondex.express/track/PREVIEW", { margin: 0 })
  // WhatsApp URL は本番では BONDEX_WHATSAPP_URL 由来。プレビューは既定 (未設定) の mailto にフォールバックし、
  // 環境変数があれば WhatsApp QR を出す (howto の NEED HELP 表示を両方確認できる)。
  const waUrl = process.env.BONDEX_WHATSAPP_URL
  const supportQr = await QRCode.toDataURL(waUrl || "mailto:support@bondex.express", { margin: 0 })
  const base: VoucherInput = {
    bookingId: "BDX-PREVIEW",
    issuedDate: "2026-09-18",
    representativeLabel: "D&N JOURNEYS",
    tourCompany: "BondEx Test Agency",
    carrier: "sagawa",
    travelerCount: 35,
    shipments: [leg1],
    totalAmount: 0,
    supportPhone: "",
    supportEmail: "support@bondex.express",
    contactPersonName: "",
    contactPersonPhone: "",
    companyName: "株式会社JOJO",
    companyAddress: "",
    trackingQrDataUri: trackingQr,
    supportQrDataUri: supportQr,
    supportQrKind: waUrl ? "whatsapp" : "email",
  }

  const group: VoucherInput = {
    ...base,
    groupName: "BondEx Test Agency",
    tourLeader: "Kaoru Tanaka",
    groupLuggage: NAMES.map((name, i) => ({ name, bags: [7, 14, 22, 32].includes(i) ? 2 : 1 })),
  }
  const individual: VoucherInput = {
    ...base,
    representativeLabel: "Paul Woolterton",
    travelerCount: 2,
    shipments: [{ ...leg1, recipient: "Paul Woolterton", bookingName: "Paul Woolterton", suitcaseCount: 2 }],
  }

  // 最悪ケース: 長いホテル名 (和英)・個人宅の長い住所・長い氏名/代理店名/添乗員名・長い申し送り・地名が引けない住所・70名の団体
  const longLeg: VoucherShipment = {
    shipmentDate: "2026-12-16",
    expectedArrival: "2026-12-18",
    from: { hotel: "ザ・プリンス パークタワー東京 タワーウイング ロイヤルクラブフロア ゲストリレーションズデスク", address: "〒105-8563 東京都港区芝公園4丁目8番1号 ザ・プリンス パークタワー東京 タワーウイング 33階 ロイヤルクラブラウンジ気付", city: "" },
    to: { hotel: "HOTEL THE MITSUI KYOTO, a Luxury Collection Hotel & Spa, Nijo-jo Castle Front Garden Residence", address: "〒604-8371 京都府京都市中京区二条城町284番地 ホテル ザ ミツイ キョウト 別館ガーデンレジデンス棟 フロントデスク気付", city: "" },
    recipient: "Maximilian Alexander von Hohenzollern-Sigmaringen",
    suitcaseCount: 120,
    bookingName: "Maximilian Alexander von Hohenzollern-Sigmaringen and Family Group",
    fromCheckIn: "2026-12-18",
    fromHotelEn: "The Prince Park Tower Tokyo, Tower Wing Royal Club Floor Guest Relations Desk",
    toHotelEn: "HOTEL THE MITSUI KYOTO, a Luxury Collection Hotel & Spa, Nijo-jo Castle Front Garden Residence",
    specialNote: "到着後はベルデスク奥の団体荷物置き場へお願いします。ハードケース40個とソフトケース30個が混在し、うち3個は車椅子用の大型ケースです。お客様は18時以降にチェックインされる予定で、翌朝7時には出発します。",
    noteTarget: "both",
  }
  const stress: VoucherInput = {
    ...base,
    bookingId: "BDX-STRESS",
    representativeLabel: "Maximilian Alexander von Hohenzollern-Sigmaringen",
    tourCompany: "Discovery Hidden Japan Luxury Travel Concierge Services International 株式会社",
    contactPersonName: "Alexandra Christina Featherstonehaugh-Cholmondeley",
    contactPersonPhone: "+81 90 1234 5678",
    supportPhone: "090-7005-4178",
    groupName: "Hohenzollern Family & Friends Winter Grand Tour of Japan 2026 (Kyoto, Osaka, Hida)",
    tourLeader: "Alexandra Christina Featherstonehaugh-Cholmondeley",
    travelerCount: 70,
    groupLuggage: Array.from({ length: 70 }, (_, i) => ({ name: `${NAMES[i % NAMES.length]} ${i >= NAMES.length ? "Jr." : ""} (Passenger ${i + 1})`, bags: (i % 5 === 0 ? 3 : 1) })),
    shipments: [longLeg, { ...longLeg, shipmentDate: "2026-12-20", expectedArrival: "2026-12-22", from: longLeg.to, to: longLeg.from, fromHotelEn: longLeg.toHotelEn, toHotelEn: longLeg.fromHotelEn }, { ...longLeg, shipmentDate: "2026-12-23", expectedArrival: "2026-12-25" }],
  }
  const cases: Array<[string, VoucherInput]> = [
    ["voucher_stress_worstcase", stress],
    ["voucher_stress_individual", { ...stress, groupName: undefined, tourLeader: undefined, groupLuggage: undefined, travelerCount: 2, shipments: [longLeg] }],
    ["voucher_group_3legs", { ...group, shipments: [leg1, leg2, leg3] }],
    ["voucher_group_1leg", group],
    ["voucher_individual_1leg", individual],
    ["voucher_individual_2legs", { ...individual, shipments: [individual.shipments[0], { ...leg2, recipient: "Paul Woolterton", bookingName: "Paul Woolterton", suitcaseCount: 2 }] }],
    ["voucher_individual_guest-brings_regression", { ...individual, waybillMode: "guest_brings" }],
  ]
  for (const [name, data] of cases) {
    const out = path.join(OUT_DIR, `${name}.pdf`)
    await renderToFile(<VoucherDocument data={data} />, out)
    console.log("wrote", out)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
