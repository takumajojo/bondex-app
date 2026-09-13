import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getShipment } from "@/lib/shipments-db"
import { parseHotelContactInfo } from "@/lib/hotel-contact-info"
import { lookupHotelPhone } from "@/lib/hotel-website-phone"

export const runtime = "nodejs"
export const maxDuration = 20

/**
 * GET /api/operator/hotel-lookup?shipmentId=&route=pickup|guest
 *   ホテル公式サイトから電話番号を取得する (Googleの電話データは使わない)。
 *   place_id → 公式サイトURL → ページから電話抽出。運用担当が確認して確定する候補を返す。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "hotel-lookup")
  if (!limit.ok) return limit.response

  const shipmentId = (req.nextUrl.searchParams.get("shipmentId") || "").trim()
  const route = req.nextUrl.searchParams.get("route")
  if (!shipmentId || (route !== "pickup" && route !== "guest")) {
    return NextResponse.json({ error: "shipmentId and valid route required" }, { status: 400 })
  }
  const ship = await getShipment(shipmentId)
  if (!ship) return NextResponse.json({ error: "shipment not found" }, { status: 404 })

  const placeId = route === "pickup" ? ship.from_place_id : ship.to_place_id
  // 既に公式サイトURLを保存していればそれを優先 (再取得の手入力に対応)。
  const savedWebsite = parseHotelContactInfo(ship.hotel_contact_info)[route].officialWebsite

  const result = await lookupHotelPhone({ placeId, website: savedWebsite || undefined })
  return NextResponse.json(result)
}
