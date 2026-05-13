// localStorage-backed booking store facade (POC).
// Existing UI code keeps calling these exports synchronously; an in-memory Map
// (cacheById) sits in front of localStorage so reads remain synchronous.

import type { FacilityRecord } from "@/lib/facilities-data"

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

const BOOKING_UPDATED_EVENT = "bondex-booking-updated"
const STORAGE_KEY = "bondex_bookings"

function dispatchBookingUpdated(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(BOOKING_UPDATED_EVENT))
}

// Cache (in-memory) as a facade to keep existing synchronous UI code.
// localStorage は永続化レイヤとして cacheById の下に位置する。
const cacheById = new Map<string, StoredBooking>()
let cacheInitialized = false

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

function ensureCacheInitialized(): void {
  if (cacheInitialized) return
  // SSR では localStorage が無いので no-op。クライアントで初めて呼ばれた時に復元する。
  if (typeof window === "undefined") return
  cacheInitialized = true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return
    for (const b of list as StoredBooking[]) {
      if (b && typeof b.orderId === "string" && b.orderId) {
        cacheById.set(b.orderId, b)
      }
    }
  } catch {
    // parse 失敗時は cacheInitialized=true のまま空キャッシュで進める。
    // 以降の write でストレージが上書きされて回復する。
  }
}

function persist(): void {
  if (typeof window === "undefined") return
  try {
    const list = Array.from(cacheById.values())
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // クォータ超過などは握りつぶす (POC)
  }
}

/** Generate a BDX-XXXX order ID */
export function generateOrderId(): string {
  const num = Math.floor(1000 + Math.random() * 9000)
  return `BDX-${num}`
}

/** Save a new booking from Traveler flow */
export function saveBooking(booking: StoredBooking): void {
  ensureCacheInitialized()
  cacheById.set(booking.orderId, booking)
  persist()
  scheduleDispatch()
}

/** Get all bookings (newest first-ish). */
export function getAllBookings(): StoredBooking[] {
  ensureCacheInitialized()
  return Array.from(cacheById.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
}

/** Get a single booking by orderId */
export function getBookingById(orderId: string): StoredBooking | null {
  ensureCacheInitialized()
  return cacheById.get(orderId) || null
}

/** Update booking status */
export function updateBookingStatus(
  orderId: string,
  status: StoredBooking["status"],
  _actorRole: "traveler" | "hotel_staff" | "admin" | "system" = "system",
): void {
  ensureCacheInitialized()
  const cur = cacheById.get(orderId)
  if (!cur) return
  cacheById.set(orderId, { ...cur, status })
  persist()
  scheduleDispatch()
}

/** Update booking shipment (label, tracking) after Ship&co create */
export function updateBookingShipment(
  orderId: string,
  shipment: NonNullable<StoredBooking["shipment"]>,
): void {
  ensureCacheInitialized()
  const cur = cacheById.get(orderId)
  if (!cur) return
  cacheById.set(orderId, {
    ...cur,
    shipment: { ...cur.shipment, ...shipment },
  })
  persist()
  scheduleDispatch()
}

/** Add a message to a booking */
export function addMessage(
  orderId: string,
  message: Omit<BookingMessage, "id" | "createdAt">,
  _actorRole: "traveler" | "hotel_staff" | "admin" | "system" = "admin",
): void {
  ensureCacheInitialized()
  const cur = cacheById.get(orderId)
  if (!cur) return
  const newMessage: BookingMessage = {
    id: (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    type: message.type,
    issueType: message.issueType,
    title: message.title,
    body: message.body,
  }
  cacheById.set(orderId, { ...cur, messages: [...(cur.messages || []), newMessage] })
  persist()
  scheduleDispatch()
}

/** Mark a message as read */
export function markMessageRead(orderId: string, messageId: string): void {
  ensureCacheInitialized()
  const cur = cacheById.get(orderId)
  if (!cur) return
  const now = new Date().toISOString()
  const messages = (cur.messages || []).map((m) =>
    m.id === messageId && !m.readAt ? { ...m, readAt: now } : m,
  )
  cacheById.set(orderId, { ...cur, messages })
  persist()
  scheduleDispatch()
}

/** Get unread message count for a booking */
export function getUnreadCount(orderId: string): number {
  const booking = getBookingById(orderId)
  if (!booking?.messages) return 0
  return booking.messages.filter((m) => !m.readAt).length
}
