/**
 * Frontend client for BondEx backend (Ship&co proxy).
 * Base URL: NEXT_PUBLIC_BACKEND_URL or http://localhost:8000
 */

import type { FacilityRecord } from "@/lib/facilities-data"

const getBaseUrl = () =>
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL) || "http://localhost:8000"

export type ApiResult<T> = { ok: true; data: T; status: number } | { ok: false; status: number; error: string }

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  const url = `${getBaseUrl()}${path}`
  const res = await fetch(url, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: T | undefined
  try {
    if (text) data = JSON.parse(text) as T
  } catch {
    // non-JSON response (e.g. Ship&co DELETE returns plain text)
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: text || res.statusText }
  }
  return { ok: true, data: data as T, status: res.status }
}

/** POST /api/payments/create-intent — create Stripe PaymentIntent */
export async function createPaymentIntent(body: {
  orderId: string
  amount: number
  currency?: string
}): Promise<ApiResult<{ clientSecret: string; paymentIntentId: string }>> {
  return request("POST", "/api/payments/create-intent", body)
}

/** POST /api/rates — get shipping rates */
export async function getRates(body: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return request("POST", "/api/rates", body)
}

/** Order snapshot for backend PostgreSQL (optional when creating shipment). */
export type BondexOrderSnapshot = {
  orderId: string
  status: string
  destination: Record<string, unknown>
  deliveryDate: string
  items: unknown[]
  contact: Record<string, unknown>
  payment: Record<string, unknown>
  messages: unknown[]
  pickup?: Record<string, unknown>
  flightNumber?: string
  arrivalTime?: string
  bookingDoc?: Record<string, unknown>
}

/** POST /api/shipments — create shipment. Optionally pass bondexOrder to persist order in backend PostgreSQL. */
export async function createShipment(
  body: Record<string, unknown>,
  bondexOrder?: BondexOrderSnapshot | null
): Promise<ApiResult<{
  id?: string
  delivery?: { carrier?: string; tracking_numbers?: string[]; label?: string }
}>> {
  const payload = bondexOrder ? { ...body, bondex_order: bondexOrder } : body
  return request("POST", "/api/shipments", payload)
}

/** GET /api/tracking/:carrier/:trackingNumber */
export async function getTracking(
  carrier: string,
  trackingNumber: string
): Promise<ApiResult<unknown>> {
  const encoded = encodeURIComponent(trackingNumber)
  return request("GET", `/api/tracking/${encodeURIComponent(carrier)}/${encoded}`)
}

/** GET /api/carriers */
export async function getCarriers(): Promise<ApiResult<unknown[]>> {
  return request("GET", "/api/carriers")
}

/** GET /api/shipments/:id */
export async function getShipment(id: string): Promise<ApiResult<unknown>> {
  return request("GET", `/api/shipments/${encodeURIComponent(id)}`)
}

export type BackendShipment = {
  shipmentId?: string
  labelUrl?: string | null
  trackingNumbers?: string[]
  carrier?: string | null
  createdAt?: string
}

export type BackendOrder = {
  orderId: string
  status: string
  /** Pickup hotel (traveler); optional — backend SQLite may omit until persisted */
  pickup?: {
    id?: string
    name: string
    address: string
    facility?: FacilityRecord
  }
  destination: {
    name: string
    address: string
    type?: string
    checkInDate: string
    bookingName: string
    recipientName: string
    facility?: FacilityRecord
  }
  deliveryDate: string
  items: Array<{
    size: string
    weight: number
    photos?: string[]
  }>
  contact: {
    email: string
    phone: string
    verified?: boolean
  }
  payment: Record<string, unknown>
  messages: unknown[]
  createdAt: string
  updatedAt: string
  shipment?: BackendShipment | null
}

/** GET /api/orders/{order_id} — fetch order + latest shipment from PostgreSQL. */
export async function getOrder(orderId: string): Promise<ApiResult<BackendOrder>> {
  return request("GET", `/api/orders/${encodeURIComponent(orderId)}`)
}

/** POST /api/orders — upsert full order snapshot (traveler / hotel / admin). */
export async function upsertOrder(
  body: BondexOrderSnapshot & { sourceRole?: "traveler" | "hotel_staff" | "admin" | "system" }
): Promise<ApiResult<{ ok: boolean; orderId: string }>> {
  return request("POST", "/api/orders", body)
}

export type AuditActionPayload = {
  actionType: string
  actorRole?: "traveler" | "hotel_staff" | "admin" | "system"
  actorId?: string
  payload?: Record<string, unknown>
}

/** POST /api/orders/{orderId}/audit-actions */
export async function createAuditAction(
  orderId: string,
  body: AuditActionPayload
): Promise<ApiResult<{ ok: boolean }>> {
  return request("POST", `/api/orders/${encodeURIComponent(orderId)}/audit-actions`, body)
}

/** GET /api/orders/{orderId}/audit-actions */
export async function getAuditActions(orderId: string): Promise<ApiResult<unknown[]>> {
  return request("GET", `/api/orders/${encodeURIComponent(orderId)}/audit-actions`)
}

// --- Payload builder for hotel check-in (Ship&co create shipment) ---

/** Fallback sender when facility data is missing (generic contact + lines). */
export const DEFAULT_HOTEL_ORIGIN = {
  full_name: "Park Hyatt Tokyo Front Desk",
  company: "Park Hyatt Tokyo",
  email: "frontdesk@parkhyatttokyo.com",
  phone: "03-5322-1234",
  country: "JP",
  zip: "5670001",
  province: "大阪府",
  address1: "茨木市安威",
  address2: "ビルA",
  extra: "",
}

const DEFAULT_TO_ADDRESS_LINES = {
  country: "JP",
  zip: "6048072",
  province: "京都府",
  address1: "京都市中京区",
  address2: "八百屋町117",
  extra: "ビルB",
}

/**
 * Normalize a FacilityRecord's address fields for Ship&co (Yamato Japan).
 * Google Places facilities have address2="" and address1=full_formatted_address,
 * while pre-defined facilities have address2=building and address1=street_block.
 * Ship&co requires address2 (市区郡町村) to be non-empty for Yamato.
 */
function normalizeJpAddress(f: FacilityRecord): { address1: string; address2: string } {
  const rawA2 = (f.address2 || "").trim()
  if (rawA2) {
    // Pre-defined facility: city+street in address1, building in address2
    return { address1: `${f.city}${f.address1}`.trim(), address2: rawA2 }
  }
  // Google Places facility: address1 = full formatted_address, address2 = ""
  // → use city as address1, full address as address2
  const city = (f.city || "").trim()
  const fullAddr = (f.address1 || "").trim()
  return {
    address1: city || fullAddr,
    address2: fullAddr || city || "1番地",
  }
}

/** Map a facility record to Ship&co `from_address` / static address lines. */
export function shipCoAddressFromFacility(
  f: FacilityRecord,
  fallbackPhoneEmail: Pick<typeof DEFAULT_HOTEL_ORIGIN, "email" | "phone" | "zip">
): Record<string, string> {
  const { address1, address2 } = normalizeJpAddress(f)
  return {
    full_name: f.full_name,
    company: f.company,
    email: (f.email || "").trim() || fallbackPhoneEmail.email,
    phone: (f.phone || "").trim() || fallbackPhoneEmail.phone,
    country: f.country,
    zip: (f.zip || "").trim() || fallbackPhoneEmail.zip,
    province: f.province,
    address1,
    address2,
    extra: f.extra || "",
  }
}

function buildFromAddress(
  pickup?: { name?: string; address?: string; facility?: FacilityRecord }
): Record<string, string> {
  if (pickup?.facility) {
    return shipCoAddressFromFacility(pickup.facility, DEFAULT_HOTEL_ORIGIN)
  }
  const hotelName = pickup?.name?.trim()
  if (hotelName) {
    return {
      ...DEFAULT_HOTEL_ORIGIN,
      full_name: `${hotelName} Front Desk`,
      company: hotelName,
    }
  }
  return { ...DEFAULT_HOTEL_ORIGIN }
}

function buildToAddress(booking: {
  destination: {
    recipientName: string
    bookingName: string
    facility?: FacilityRecord
  }
  contact?: { phone?: string; email?: string }
}): Record<string, string> {
  const recipient = booking.destination.recipientName || booking.destination.bookingName
  const base = {
    full_name: recipient,
    company: "",
    email: (booking.contact?.email ?? "").trim() || "",
    phone: formatPhoneForShipco(booking.contact?.phone ?? ""),
  }
  const f = booking.destination.facility
  if (f) {
    const { address1, address2 } = normalizeJpAddress(f)
    return {
      full_name: base.full_name,
      company: base.company,
      email: base.email,
      phone: base.phone,
      country: f.country,
      zip: (f.zip || "").trim() || DEFAULT_TO_ADDRESS_LINES.zip,
      province: f.province,
      address1,
      address2,
      extra: f.extra || "",
    }
  }
  return {
    ...base,
    country: DEFAULT_TO_ADDRESS_LINES.country,
    zip: DEFAULT_TO_ADDRESS_LINES.zip,
    province: DEFAULT_TO_ADDRESS_LINES.province,
    address1: DEFAULT_TO_ADDRESS_LINES.address1,
    address2: DEFAULT_TO_ADDRESS_LINES.address2,
    extra: DEFAULT_TO_ADDRESS_LINES.extra,
  }
}

/** Size to weight (kg) per requirements. */
const SIZE_WEIGHT_KG: Record<string, number> = { S: 10, M: 15, L: 20, LL: 25 }

/**
 * Format phone for Ship&co to_address.phone (E.164).
 * Strips non-digits; Japanese numbers (0xx or 81xx) become +81xxxxxxxxx.
 */
export function formatPhoneForShipco(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "")
  if (digits.length === 0) return ""
  if (digits.startsWith("81") && (digits.length === 12 || digits.length === 13)) return `+${digits}`
  if (digits.startsWith("0") && (digits.length === 10 || digits.length === 11)) return `+81${digits.slice(1)}`
  if (digits.length >= 9 && digits.length <= 11) return `+81${digits.startsWith("0") ? digits.slice(1) : digits}`
  return `+81${digits}`
}

function looksAsciiOnly(value: string): boolean {
  const s = (value ?? "").trim()
  if (!s) return true
  // If it contains any non-ASCII character, treat it as "not ASCII-only" (i.e., likely JP text).
  return !/[^\x00-\x7F]/.test(s)
}

function withJapaneseFallback(value: string, fallback: string): string {
  const s = (value ?? "").trim()
  if (!s) return fallback
  return looksAsciiOnly(s) ? fallback : s
}

/** Build Ship&co POST /shipments body from StoredBooking. */
export function buildShipmentPayload(booking: {
  orderId: string
  pickup?: { name?: string; address?: string; facility?: FacilityRecord }
  destination: {
    address: string
    name: string
    bookingName: string
    recipientName: string
    checkInDate: string
    facility?: FacilityRecord
  }
  items: Array<{ size: string; weight: number }>
  contact?: { phone?: string; email?: string }
}): Record<string, unknown> {
  const service = "yamato_regular"
  const to_address = buildToAddress({
    destination: {
      recipientName: booking.destination.recipientName,
      bookingName: booking.destination.bookingName,
      facility: booking.destination.facility,
    },
    contact: booking.contact,
  })
  const today = new Date().toISOString().slice(0, 10)
  const testMode =
    typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SHIPANDCO_TEST !== undefined
      ? process.env.NEXT_PUBLIC_SHIPANDCO_TEST === "true" || process.env.NEXT_PUBLIC_SHIPANDCO_TEST === "1"
      : true

  return {
    from_address: buildFromAddress(booking.pickup),
    to_address,
    setup: {
      carrier: "yamato",
      service,
      ref_number: booking.orderId,
      pack_amount: Math.max(1, booking.items.length),
      shipment_date: today,
      test: testMode ,
    },
    products: booking.items.map((item) => ({
      name: "Luggage",
      quantity: 1,
      price: 1000,
      weight: SIZE_WEIGHT_KG[item.size] ?? 10,
    })),
  }
}
