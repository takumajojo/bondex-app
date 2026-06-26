import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Ship&co API ラッパー — 1区間ぶんの Yamato 送り状を発行する.
 *
 * 入力 JSON:
 * {
 *   refNumber: string,            // 予約番号 BDX-XXX
 *   shipmentDate: "YYYY-MM-DD",
 *   suitcaseCount: number,        // ヤマトの "個口数"
 *   from: { hotel, full_name, phone, country, zip, province, city, address1, address2 },
 *   to:   { 同上 },
 * }
 *
 * 出力:
 *   { id, label, trackingNumbers, carrier, method, estimatedDeliveryDate }
 *
 * 仕様: https://developer.shipandco.com/
 *  - POST https://api.shipandco.com/v1/shipments
 *  - x-access-token: SHIPANDCO_API_KEY
 *  - setup.carrier_id は GET /carriers から取得 (yamato タイプ)
 *  - setup.test = true (POC は test mode 固定)
 */

const SHIPANDCO_BASE = "https://api.shipandco.com/v1"

interface Address {
  full_name?: string
  company?: string
  email?: string
  phone?: string
  country?: string
  zip?: string
  province?: string
  city?: string
  address1?: string
  address2?: string
  extra?: string
}

interface CreateBody {
  refNumber?: unknown
  shipmentDate?: unknown
  suitcaseCount?: unknown
  from?: unknown
  to?: unknown
}

// in-memory cache for carrier_id
let cachedCarrierId: string | null = null
let cachedAt = 0
const CARRIER_CACHE_MS = 10 * 60 * 1000 // 10 min

async function getYamatoCarrierId(token: string): Promise<string | null> {
  const now = Date.now()
  if (cachedCarrierId && now - cachedAt < CARRIER_CACHE_MS) return cachedCarrierId
  const res = await fetch(`${SHIPANDCO_BASE}/carriers`, {
    headers: { "x-access-token": token, "Content-Type": "application/json" },
  })
  if (!res.ok) return null
  const data = (await res.json()) as Array<{ id?: string; type?: string; state?: string }>
  if (!Array.isArray(data)) return null
  const yamato = data.find(
    (c) => (c.type === "yamato" || c.type === "yamato_takkyubin") && c.state !== "disabled",
  )
  if (!yamato?.id) return null
  cachedCarrierId = yamato.id
  cachedAt = now
  return cachedCarrierId
}

function asAddress(input: unknown): Address {
  const v = (input ?? {}) as Record<string, unknown>
  const pick = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined)
  return {
    full_name: pick("full_name") || pick("hotel"),
    company: pick("hotel") || pick("company"),
    email: pick("email"),
    phone: pick("phone"),
    country: pick("country") || "JP",
    zip: pick("zip"),
    province: pick("province"),
    city: pick("city"),
    address1: pick("address1"),
    address2: pick("address2"),
    extra: pick("extra"),
  }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "shipandco-create")
  if (!limit.ok) return limit.response

  const token = process.env.SHIPANDCO_API_KEY
  if (!token) {
    return NextResponse.json({ error: "SHIPANDCO_API_KEY not configured" }, { status: 500 })
  }

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const refNumber = typeof body.refNumber === "string" ? body.refNumber.trim() : ""
  const shipmentDate = typeof body.shipmentDate === "string" ? body.shipmentDate.trim() : ""
  const suitcaseCount = Math.max(1, Math.floor(Number(body.suitcaseCount) || 1))
  const fromAddr = asAddress(body.from)
  const toAddr = asAddress(body.to)

  if (!refNumber || !shipmentDate) {
    return NextResponse.json(
      { error: "refNumber and shipmentDate are required" },
      { status: 400 },
    )
  }
  if (!fromAddr.address1 || !toAddr.address1) {
    return NextResponse.json({ error: "from.address1 and to.address1 are required" }, { status: 400 })
  }

  const carrierId = await getYamatoCarrierId(token)
  if (!carrierId) {
    return NextResponse.json(
      { error: "Yamato carrier not registered in Ship&co dashboard" },
      { status: 502 },
    )
  }

  const payload = {
    from_address: fromAddr,
    to_address: toAddr,
    setup: {
      carrier_id: carrierId,
      service: "yamato_regular",
      ref_number: refNumber,
      shipment_date: shipmentDate,
      pack_amount: suitcaseCount,
      test: true, // POC 固定: 課金対象外
    },
    products: Array.from({ length: suitcaseCount }).map((_, i) => ({
      name: `Luggage ${i + 1}`,
      quantity: 1,
      price: 5000,
    })),
  }

  try {
    const res = await fetch(`${SHIPANDCO_BASE}/shipments`, {
      method: "POST",
      headers: {
        "x-access-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let data: unknown = null
    try {
      if (text) data = JSON.parse(text)
    } catch {
      // non-JSON
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `Ship&co error (${res.status})`, detail: data ?? text },
        { status: 502 },
      )
    }
    const d = data as {
      id?: string
      delivery?: {
        carrier?: string
        method?: string
        tracking_numbers?: string[]
        label?: string
        estimated_delivery_date?: string
      }
    }
    return NextResponse.json({
      id: d.id ?? "",
      label: d.delivery?.label ?? "",
      trackingNumbers: d.delivery?.tracking_numbers ?? [],
      carrier: d.delivery?.carrier ?? "",
      method: d.delivery?.method ?? "",
      estimatedDeliveryDate: d.delivery?.estimated_delivery_date ?? "",
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ship&co network error"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
