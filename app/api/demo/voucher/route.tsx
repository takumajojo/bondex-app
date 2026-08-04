import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import QRCode from "qrcode"
import { rateLimit } from "@/lib/rate-limit"
import {
  VoucherDocument,
  SUPPORT_DEFAULTS,
  formatIssuedDate,
  normalizeGuestLanguage,
  type VoucherInput,
} from "@/lib/voucher-pdf"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 登録前のお客様向け「体験デモ」バウチャー生成（公開・無認証）。
 * 入力(出発/到着ホテル・お名前・到着日)から見本バウチャーPDFを生成して返す。
 * ※ DB書き込み・Ship&co発行・課金・Google Places 呼び出しは一切しない（安全・無料）。
 * ※ 見本と明示するため注記に「SAMPLE / 見本」を入れる。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "demo-voucher")
  if (!limit.ok) return limit.response

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const fromHotel = s(body.fromHotel).slice(0, 60)
  const toHotel = s(body.toHotel).slice(0, 60)
  const name = s(body.name).slice(0, 40)
  const arrivalDate = s(body.arrivalDate) // YYYY-MM-DD
  const lang = normalizeGuestLanguage(body.guestLanguage)

  if (!fromHotel || !toHotel) {
    return NextResponse.json({ error: "出発ホテルと到着ホテルを入力してください。" }, { status: 400 })
  }

  const shipDate = arrivalDate && /^\d{4}-\d{2}-\d{2}$/.test(arrivalDate) ? arrivalDate : ""
  // ゲスト言語は en/zh/it/fr/es（旅行者向け・"ja"は無い）。見本注記は英語+日本語併記で固定。
  const sampleNote = "★ 見本 / SAMPLE — a real voucher is issued when you use the service"

  const input: VoucherInput = {
    bookingId: "SAMPLE-DEMO",
    issuedDate: formatIssuedDate(),
    representativeLabel: name || "Sample Guest",
    tourCompany: "Sample Travel Agency",
    carrier: "sagawa",
    travelerCount: 1,
    shipments: [
      {
        shipmentDate: shipDate,
        expectedArrival: shipDate,
        from: { hotel: fromHotel, address: "", city: "" },
        to: { hotel: toHotel, address: "", city: "" },
        recipient: name || "Sample Guest",
        suitcaseCount: 1,
        specialNote: sampleNote,
        noteTarget: "both",
        fromCheckIn: shipDate || undefined,
      },
    ],
    totalAmount: 5000,
    supportPhone: SUPPORT_DEFAULTS.phone,
    supportEmail: SUPPORT_DEFAULTS.email,
    contactPersonName: SUPPORT_DEFAULTS.contactPersonName,
    contactPersonPhone: SUPPORT_DEFAULTS.phone,
    companyName: SUPPORT_DEFAULTS.companyName,
    companyAddress: SUPPORT_DEFAULTS.companyAddress,
    showContact: true,
    guestLanguage: lang,
    includeHowto: false, // デモは1枚に
  }

  // 追跡QRはデモ用にLPへ（存在しない予約を指さない）
  try {
    input.trackingQrDataUri = await QRCode.toDataURL("https://bondex.express", {
      margin: 0,
      width: 200,
      color: { dark: "#1A1A1A", light: "#FFFFFF" },
    })
  } catch {
    /* QR失敗は非致命 */
  }

  try {
    const buf = await renderToBuffer(<VoucherDocument data={input} />)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="BondEx_sample_voucher.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PDF render error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
