// DB-backed booking store facade.
// Existing UI code keeps calling these exports, but reads/writes are persisted in PostgreSQL.

import type { FacilityRecord } from "@/lib/facilities-data"
import type { BackendOrder } from "@/lib/shipandco-api"

export type IssueType = "payment_failure" | "uncollected" | "carrier_exception" | "size_mismatch" | "other"

export interface BookingMessage {
  id: string
  type: "info" | "warning" | "action_required"
  issueType?: IssueType
  title: string
  body: string
  createdAt: string
  readAt?: string
}

export const ISSUE_TEMPLATES: Record<IssueType, { title: string; body: string; type: BookingMessage["type"] }> = {
  payment_failure: {
    title: "Payment issue",
    body: "Your payment could not be processed. Please update your payment method to avoid delivery delays.",
    type: "action_required",
  },
  uncollected: {
    title: "Luggage not collected",
    body: "Your luggage has not been collected at the hotel. Please contact the front desk or reach out to BondEx support.",
    type: "action_required",
  },
  carrier_exception: {
    title: "Delivery delay",
    body: "There is an issue with your delivery. Our team is working to resolve it. We will notify you once the situation is updated.",
    type: "warning",
  },
  size_mismatch: {
    title: "Size adjustment",
    body: "The measured size of your luggage differs from what was declared. A price adjustment will be applied to your payment method.",
    type: "warning",
  },
  other: {
    title: "Message from BondEx",
    body: "",
    type: "info",
  },
}

export interface StoredBooking {
  orderId: string
  status: "confirmed" | "waiting" | "checked_in" | "picked_up" | "in_transit" | "delivered"
  createdAt: string

  // Pickup hotel (Step 1 — where luggage is collected); optional for legacy stored rows
  pickup?: {
    id?: string
    name: string
    address: string
    /** Full Ship&co origin fields when available */
    facility?: FacilityRecord
  }

  // Destination (Step 1)
  destination: {
    name: string
    address: string
    type: string
    checkInDate: string
    bookingName: string
    recipientName: string
    facility?: FacilityRecord
  }

  // Delivery Date (Step 2)
  deliveryDate: string

  // Luggage Items (Step 3)
  items: Array<{
    size: string
    weight: number
    photos: string[] // backend photo URLs
  }>

  // Contact (Step 4)
  contact: {
    email: string
    phone: string
    verified: boolean
  }

  // Payment (Step 5)
  payment: {
    method: string
    amount: number
    maxAmount: number
    paymentIntentId?: string
  }

  // Messages from Admin/CS
  messages: BookingMessage[]

  // Ship&co: set at hotel check-in
  shipment?: {
    labelUrl?: string
    trackingNumbers?: string[]
    carrier?: string
    shipmentId?: string
  }
}

/** Persisted before Stripe redirect (PayPay, etc.) so the traveler flow can restore booking after return. */
export const TRAVELER_CHECKOUT_DRAFT_KEY = "bondex_traveler_draft"

/** Maps stored booking status to admin list/grid keys (hyphenated, matches mock orders). */
export function storedBookingStatusToAdminGridStatus(s: StoredBooking["status"]): string {
  switch (s) {
    case "confirmed":
      return "confirmed"
    case "waiting":
      return "waiting"
    case "checked_in":
      return "checked-in"
    case "picked_up":
      return "picked-up"
    case "in_transit":
      return "in-transit"
    case "delivered":
      return "delivered"
    default:
      return "waiting"
  }
}

/** Human labels for admin grid/list status keys (live + mock). */
export const ADMIN_GRID_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  waiting: "Waiting",
  "checked-in": "Checked in",
  "picked-up": "Picked up",
  "in-transit": "In transit",
  delivered: "Delivered",
  pending: "Pending",
  exception: "Exception",
  cancelled: "Cancelled",
}

type ApiResult<T> = { ok: true; data: T; status: number } | { ok: false; status: number; error: string }

const BOOKING_UPDATED_EVENT = "bondex-booking-updated"

const getBaseUrl = () =>
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL) || "http://localhost:8000"

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
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
    // non-JSON response
  }

  if (!res.ok) return { ok: false, status: res.status, error: text || res.statusText }
  return { ok: true, data: data as T, status: res.status }
}

function dispatchBookingUpdated(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(BOOKING_UPDATED_EVENT))
}

// Cache (in-memory) as a facade to keep existing synchronous UI code.
const cacheById = new Map<string, StoredBooking>()
let cacheInitialized = false
let refreshAllInFlight: Promise<void> | null = null
const refreshOneInFlight = new Map<string, Promise<void>>()

let dispatchScheduled = false
function scheduleDispatch(): void {
  if (typeof window === "undefined") return
  if (dispatchScheduled) return
  dispatchScheduled = true
  // Batch multiple cache updates in the same tick.
  window.setTimeout(() => {
    dispatchScheduled = false
    dispatchBookingUpdated()
  }, 0)
}

function normalizeStoredStatus(status: any): StoredBooking["status"] {
  const s = String(status || "").trim()
  const allowed: StoredBooking["status"][] = ["confirmed", "waiting", "checked_in", "picked_up", "in_transit", "delivered"]
  return (allowed.includes(s as any) ? (s as StoredBooking["status"]) : "waiting") as StoredBooking["status"]
}

function toBookingFromBackendOrder(order: BackendOrder, messages: BookingMessage[] | null): StoredBooking {
  const itemPhotos = (order.items || []).map((i: any) => ({
    size: String(i.size || ""),
    weight: Number(i.weight || 0),
    photos: Array.isArray(i.photos) ? i.photos.map((p: any) => String(p)) : [],
  }))

  const status = normalizeStoredStatus(order.status)
  const pickup = order.pickup
    ? {
        id: order.pickup.id,
        name: order.pickup.name,
        address: order.pickup.address,
        facility: order.pickup.facility,
      }
    : undefined

  // Prefer normalized messages when provided; otherwise fall back to legacy orders.messages JSONB.
  const resolvedMessages =
    messages ??
    (Array.isArray(order.messages)
      ? (order.messages as any[]).map((m) => ({
          id: String(m.id || ""),
          type:
            m.type === "warning" || m.type === "action_required" || m.type === "info"
              ? (m.type as BookingMessage["type"])
              : ("info" as const),
          issueType: m.issueType as IssueType | undefined,
          title: String(m.title || ""),
          body: String(m.body || ""),
          createdAt: String(m.createdAt || ""),
          readAt: m.readAt ? String(m.readAt) : undefined,
        }))
      : [])

  return {
    orderId: order.orderId,
    status,
    createdAt: order.createdAt,
    pickup,
    destination: {
      name: order.destination.name,
      address: order.destination.address,
      type: order.destination.type || "",
      checkInDate: order.destination.checkInDate,
      bookingName: order.destination.bookingName,
      recipientName: order.destination.recipientName,
      facility: order.destination.facility,
    },
    deliveryDate: order.deliveryDate,
    items: itemPhotos,
    contact: {
      email: (order.contact as any).email || "",
      phone: (order.contact as any).phone || "",
      verified: Boolean((order.contact as any).verified ?? true),
    },
    payment: (order.payment as any) || {},
    messages: resolvedMessages,
    shipment: order.shipment
      ? {
          labelUrl: order.shipment.labelUrl ?? undefined,
          trackingNumbers: order.shipment.trackingNumbers ?? [],
          carrier: order.shipment.carrier ?? undefined,
          shipmentId: order.shipment.shipmentId,
        }
      : undefined,
  }
}

async function fetchOrderMessages(orderId: string): Promise<BookingMessage[] | null> {
  const res = await request<any>("GET", `/api/orders/${encodeURIComponent(orderId)}/messages`)
  if (!res.ok) return null
  const raw = Array.isArray(res.data) ? (res.data as any[]) : []
  return raw.map((m) => ({
    id: String(m.id || ""),
    type: m.type === "warning" || m.type === "action_required" || m.type === "info" ? m.type : ("info" as const),
    issueType: m.issueType as IssueType | undefined,
    title: String(m.title || ""),
    body: String(m.body || ""),
    createdAt: String(m.createdAt || ""),
    readAt: m.readAt ? String(m.readAt) : undefined,
  }))
}

async function refreshBooking(orderId: string): Promise<void> {
  if (refreshOneInFlight.has(orderId)) return refreshOneInFlight.get(orderId)!

  const inflight = (async () => {
    const orderRes = await request<BackendOrder>("GET", `/api/orders/${encodeURIComponent(orderId)}`)
    if (!orderRes.ok || !orderRes.data) return

    const messages = await fetchOrderMessages(orderId).catch(() => null)
    const booking = toBookingFromBackendOrder(orderRes.data, messages)
    cacheById.set(orderId, booking)
    scheduleDispatch()
  })()

  refreshOneInFlight.set(orderId, inflight)
  try {
    await inflight
  } finally {
    refreshOneInFlight.delete(orderId)
  }
}

async function refreshAllBookings(limit = 100): Promise<void> {
  const inflight = (async () => {
    const listRes = await request<any[]>("GET", `/api/orders?limit=${encodeURIComponent(String(limit))}&offset=0`)
    if (!listRes.ok) return

    const rawOrders = Array.isArray(listRes.data) ? listRes.data : []

    // Populate a partial cache quickly.
    for (const o of rawOrders) {
      const orderId: string = String(o.orderId || "")
      if (!orderId) continue
      cacheById.set(orderId, {
        orderId,
        status: normalizeStoredStatus(o.status),
        createdAt: String(o.createdAt || new Date().toISOString()),
        destination: {
          name: o.destination?.name || "",
          address: o.destination?.address || "",
          type: o.destination?.type || "",
          checkInDate: o.destination?.checkInDate || "",
          bookingName: o.destination?.bookingName || "",
          recipientName: o.destination?.recipientName || "",
          facility: o.destination?.facility,
        },
        deliveryDate: String(o.deliveryDate || ""),
        items: Array.isArray(o.items) ? o.items : [],
        contact: {
          email: o.contact?.email || "",
          phone: o.contact?.phone || "",
          verified: Boolean(o.contact?.verified ?? true),
        },
        payment: o.payment || {},
        messages: Array.isArray(o.messages) ? (o.messages as any[]) : [],
      } as any)
    }

    // Then refresh full details (including shipment + messages).
    await Promise.all(rawOrders.slice(0, 20).map((o) => refreshBooking(String(o.orderId))))
  })()

  refreshAllInFlight = inflight
  try {
    await inflight
    cacheInitialized = true
  } finally {
    refreshAllInFlight = null
  }
}

function ensureCacheInitialized(): void {
  if (cacheInitialized) return
  if (!refreshAllInFlight) void refreshAllBookings(100)
}

/** Generate a BDX-XXXX order ID */
export function generateOrderId(): string {
  const num = Math.floor(1000 + Math.random() * 9000)
  return `BDX-${num}`
}

/** Save a new booking from Traveler flow */
export function saveBooking(booking: StoredBooking): void {
  void (async () => {
    try {
      const body: any = {
        orderId: booking.orderId,
        status: booking.status,
        destination: booking.destination,
        deliveryDate: booking.deliveryDate,
        items: booking.items,
        contact: booking.contact,
        payment: booking.payment,
        messages: booking.messages || [],
        pickup: booking.pickup || {},
        sourceRole: "traveler",
      }

      const res = await request("POST", "/api/orders", body)
      if (!res.ok) return

      cacheById.set(booking.orderId, booking)
      scheduleDispatch()
      await refreshBooking(booking.orderId)
    } catch {
      // best-effort
    }
  })()
}

/** Get all bookings (newest first-ish). */
export function getAllBookings(): StoredBooking[] {
  ensureCacheInitialized()
  return Array.from(cacheById.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
}

/** Get a single booking by orderId */
export function getBookingById(orderId: string): StoredBooking | null {
  ensureCacheInitialized()
  const hit = cacheById.get(orderId) || null
  if (!hit) void refreshBooking(orderId)
  return hit
}

/** Update booking status */
export function updateBookingStatus(
  orderId: string,
  status: StoredBooking["status"],
  actorRole: "traveler" | "hotel_staff" | "admin" | "system" = "system",
): void {
  void (async () => {
    try {
      // Optimistic cache update.
      const cur = cacheById.get(orderId)
      if (cur) {
        cacheById.set(orderId, { ...cur, status })
        scheduleDispatch()
      }

      // Preferred: status endpoint.
      const preferred = await request("POST", `/api/orders/${encodeURIComponent(orderId)}/status`, {
        status,
        actorRole,
      })
      if (preferred.ok) {
        await refreshBooking(orderId)
        return
      }

      // Fallback: upsert full snapshot from cached booking.
      if (preferred.status !== 404) return
      const fallback = cacheById.get(orderId)
      if (!fallback) return
      const body: any = {
        orderId: fallback.orderId,
        status,
        destination: fallback.destination,
        deliveryDate: fallback.deliveryDate,
        items: fallback.items,
        contact: fallback.contact,
        payment: fallback.payment,
        messages: fallback.messages || [],
        pickup: fallback.pickup || {},
        sourceRole: actorRole,
      }
      const res = await request("POST", "/api/orders", body)
      if (res.ok) await refreshBooking(orderId)
    } catch {
      // best-effort
    }
  })()
}

/** Update booking shipment (label, tracking) after Ship&co create */
export function updateBookingShipment(
  orderId: string,
  shipment: NonNullable<StoredBooking["shipment"]>,
): void {
  void (async () => {
    try {
      // Optimistic cache update.
      const cur = cacheById.get(orderId)
      if (cur) {
        cacheById.set(orderId, {
          ...cur,
          shipment: { ...cur.shipment, ...shipment },
        })
        scheduleDispatch()
      }

      // Shipment is already persisted server-side by createShipment; just refresh.
      await refreshBooking(orderId)
    } catch {
      // best-effort
    }
  })()
}

/** Add a message to a booking */
export function addMessage(
  orderId: string,
  message: Omit<BookingMessage, "id" | "createdAt">,
  actorRole: "traveler" | "hotel_staff" | "admin" | "system" = "admin",
): void {
  void (async () => {
    try {
      const res = await request("POST", `/api/orders/${encodeURIComponent(orderId)}/messages`, {
        type: message.type,
        issueType: message.issueType,
        title: message.title,
        body: message.body,
        actorRole,
      })
      if (!res.ok) return
      await refreshBooking(orderId)
    } catch {
      // best-effort
    }
  })()
}

/** Mark a message as read */
export function markMessageRead(orderId: string, messageId: string): void {
  void (async () => {
    try {
      const res = await request(
        "PATCH",
        `/api/orders/${encodeURIComponent(orderId)}/messages/${encodeURIComponent(messageId)}/read`,
      )
      if (!res.ok) return
      await refreshBooking(orderId)
    } catch {
      // best-effort
    }
  })()
}

/** Get unread message count for a booking */
export function getUnreadCount(orderId: string): number {
  const booking = getBookingById(orderId)
  if (!booking?.messages) return 0
  return booking.messages.filter((m) => !m.readAt).length
}
