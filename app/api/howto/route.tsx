import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import QRCode from "qrcode"
import { rateLimit } from "@/lib/rate-limit"
import { HowToShipDocument, SUPPORT_DEFAULTS, normalizeGuestLanguage } from "@/lib/voucher-pdf"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * How to use this service (お客様お渡し用ガイド) の公開ダウンロード。
 *
 *   GET /api/howto?lang=en|ja|zh|ko|it|fr|es   … ブラウザで表示
 *   GET /api/howto?lang=en&dl=1                … ダウンロード
 *
 * 予約データを一切含まない静的 1 枚ものなので認証不要。
 * middleware の matcher に入れないこと (代理店・お客様が直接開ける必要がある)。
 * 運営画面用の /api/voucher/generate?type=howto は operator ゲート内に残す。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "howto")
  if (!limit.ok) return limit.response

  const lang = normalizeGuestLanguage(req.nextUrl.searchParams.get("lang"))
  const asDownload = req.nextUrl.searchParams.get("dl") === "1"

  try {
    const wa = process.env.BONDEX_WHATSAPP_URL?.trim()
    let supportQrDataUri: string | undefined
    try {
      supportQrDataUri = await QRCode.toDataURL(wa || `mailto:${SUPPORT_DEFAULTS.email}`, {
        margin: 0,
        width: 200,
        color: { dark: "#16161a", light: "#FFFFFF" },
      })
    } catch (err) {
      console.error("[howto] QR generation failed:", err)
    }

    const buf = await renderToBuffer(
      <HowToShipDocument
        language={lang}
        supportQrDataUri={supportQrDataUri}
        supportQrKind={wa ? "whatsapp" : "email"}
      />,
    )

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="BondEx_HowToUse_${lang.toUpperCase()}.pdf"`,
        // 予約情報を含まない静的資料なので CDN キャッシュ可
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PDF render error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
