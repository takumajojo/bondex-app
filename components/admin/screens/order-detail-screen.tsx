"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { ArrowLeft, User, MapPin, Package, CreditCard, Camera, Edit2, Save, AlertTriangle, Truck, Send, MessageSquare, Bell, ChevronDown, Clock, Printer, RefreshCw, Copy, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getBookingById, updateBookingStatus, updateBookingShipment, addMessage, ISSUE_TEMPLATES, type IssueType, type BookingMessage, type StoredBooking } from "@/lib/booking-store"
import { createShipment, buildShipmentPayload, getOrder, getTracking, type BackendOrder } from "@/lib/shipandco-api"

interface OrderDetailScreenProps {
  orderId: string
  onBack: () => void
}

type PaymentStatus = "paid" | "failed" | "surcharge-pending"
type AdminOrderDetailMock = {
  id: string
  guestName: string
  guestEmail: string
  guestPhone: string
  itemCount: number
  items: Array<{ id: string; size: "S" | "M" | "L" | "LL"; actualSize?: "S" | "M" | "L" | "LL" }>
  status: StoredBooking["status"]
  paymentStatus: PaymentStatus
  hotelName: string
  hotelAddress: string
  trackingNumber: string
  createdAt: string
  checkInDate: string
  deliveryDate: string
  evidencePhotos: string[]
  price: number
  surchargePending: number
}

const fallbackOrder: AdminOrderDetailMock = {
  id: "BX-A1B2C3",
  guestName: "Tanaka Yuki",
  guestEmail: "tanaka@example.com",
  guestPhone: "+81 90-1234-5678",
  itemCount: 2,
  items: [
    { id: "1", size: "M" as const, actualSize: "L" as const },
    { id: "2", size: "S" as const, actualSize: "S" as const },
  ],
  status: "in_transit",
  paymentStatus: "paid",
  hotelName: "Park Hyatt Tokyo",
  hotelAddress: "3-7-1-2 Nishi-Shinjuku, Shinjuku-ku, Tokyo",
  trackingNumber: "1234567890",
  createdAt: "2026-02-02T10:30:00Z",
  checkInDate: "2026-02-05",
  deliveryDate: "2026-02-06",
  evidencePhotos: ["photo1", "photo2"],
  price: 7000,
  surchargePending: 1000,
}

export function OrderDetailScreen({ orderId, onBack }: OrderDetailScreenProps) {
  // Try to load live booking first, fall back to mock
  const mockOrder = useMemo<AdminOrderDetailMock>(() => {
    const live = getBookingById(orderId)
    if (live) {
      const prices: Record<string, number> = { S: 2500, M: 3500, L: 4500, LL: 5500 }
      const basePrice = live.items.reduce((sum, i) => sum + (prices[i.size] || 3500), 0)
      return {
        id: live.orderId,
        guestName: live.destination.recipientName || live.destination.bookingName,
        guestEmail: live.contact.email,
        guestPhone: live.contact.phone,
        itemCount: live.items.length || 1,
        items: live.items.map((item, idx) => ({
          id: String(idx + 1),
          size: item.size as "S" | "M" | "L" | "LL",
          actualSize: item.size as "S" | "M" | "L" | "LL",
        })),
        // Map "confirmed" (payment step) to "waiting" (hotel not checked-in yet) for admin display.
        status: live.status === "confirmed" ? "waiting" : (live.status as StoredBooking["status"]),
        paymentStatus: "paid",
        hotelName: live.destination.name,
        hotelAddress: live.destination.address,
          trackingNumber: live.shipment?.trackingNumbers?.[0] || "",
        createdAt: live.createdAt,
        checkInDate: live.destination.checkInDate,
        deliveryDate: live.deliveryDate,
        evidencePhotos: live.items.flatMap((i) => i.photos),
        price: basePrice,
        surchargePending: 0,
      }
    }
    return fallbackOrder
  }, [orderId])
  const [isEditingSize, setIsEditingSize] = useState(false)
  const [isEditingTracking, setIsEditingTracking] = useState(false)
  const [trackingNumber, setTrackingNumber] = useState(mockOrder.trackingNumber || "")
  const [sizeNote, setSizeNote] = useState("")
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null)

  // Backend shipment (label/tracking) - from FastAPI SQLite proxy
  const [backendOrder, setBackendOrder] = useState<BackendOrder | null>(null)
  const [backendLoading, setBackendLoading] = useState(false)
  const [backendNotFound, setBackendNotFound] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [trackingRefreshLoading, setTrackingRefreshLoading] = useState(false)
  const [reissueLoading, setReissueLoading] = useState(false)
  const [trackingRefreshNote, setTrackingRefreshNote] = useState<string | null>(null)
  const [reissueSuccess, setReissueSuccess] = useState(false)
  const [copiedTracking, setCopiedTracking] = useState(false)

  // Status change
  const liveBooking = getBookingById(orderId)
  const isLiveBooking = !!liveBooking
  const statuses: StoredBooking["status"][] = ["confirmed", "waiting", "checked_in", "picked_up", "in_transit", "delivered"]
  const statusLabels: Record<string, string> = { confirmed: "Confirmed", waiting: "Waiting", checked_in: "Checked In", picked_up: "Picked Up", in_transit: "In Transit", delivered: "Delivered" }
  const [currentStatus, setCurrentStatus] = useState<StoredBooking["status"]>(mockOrder.status)
  const [showStatusDropdown, setShowStatusDropdown] = useState(false)

  // Issue & messaging
  const [selectedIssue, setSelectedIssue] = useState<IssueType | "">("")
  const [messageTitle, setMessageTitle] = useState("")
  const [messageBody, setMessageBody] = useState("")
  const [messageSent, setMessageSent] = useState(false)
  const [messages, setMessages] = useState<BookingMessage[]>([])

  const loadMessages = useCallback(() => {
    const live = getBookingById(orderId)
    if (live?.messages) setMessages([...live.messages])
  }, [orderId])

  useEffect(() => {
    loadMessages()
    const h = () => loadMessages()
    window.addEventListener("bondex-booking-updated", h)
    return () => window.removeEventListener("bondex-booking-updated", h)
  }, [loadMessages])

  // Keep dropdown state in sync when switching orders.
  useEffect(() => {
    setCurrentStatus(mockOrder.status)
    setIsEditingSize(false)
    setIsEditingTracking(false)
    setShowStatusDropdown(false)
  }, [orderId, mockOrder.status])

  // Load backend order (label/tracking) on demand.
  useEffect(() => {
    let cancelled = false

    async function loadBackendOrder() {
      setBackendLoading(true)
      setBackendOrder(null)
      setBackendNotFound(false)
      setBackendError(null)
      setTrackingRefreshNote(null)

      const res = await getOrder(orderId)
      if (cancelled) return

      if (res.ok) {
        setBackendOrder(res.data)
        setBackendLoading(false)
        return
      }

      setBackendLoading(false)
      setBackendOrder(null)
      if (res.status === 404) {
        setBackendNotFound(true)
      } else {
        setBackendError(res.error || `Failed to load order (HTTP ${res.status})`)
      }
    }

    loadBackendOrder()

    return () => {
      cancelled = true
    }
  }, [orderId])

  // Prefer backend tracking number when present.
  useEffect(() => {
    const backendTracking = backendOrder?.shipment?.trackingNumbers?.[0] || null
    if (backendTracking) {
      setTrackingNumber(backendTracking)
      setIsEditingTracking(false)
      return
    }

    // Otherwise fall back to the current session-derived value (or manual "Not set").
    if (!isEditingTracking) {
      setTrackingNumber(mockOrder.trackingNumber || "")
    }
  }, [backendOrder, mockOrder.trackingNumber, isEditingTracking])

  const handleStatusChange = (status: StoredBooking["status"]) => {
    updateBookingStatus(orderId, status)
    setCurrentStatus(status as typeof currentStatus)
    setShowStatusDropdown(false)
  }

  const handleIssueSelect = (issue: IssueType) => {
    setSelectedIssue(issue)
    const template = ISSUE_TEMPLATES[issue]
    setMessageTitle(template.title)
    setMessageBody(template.body)
  }

  const handleSendMessage = () => {
    if (!messageTitle || !messageBody) return
    const issueType = selectedIssue || "other"
    const template = ISSUE_TEMPLATES[issueType as IssueType]
    addMessage(orderId, {
      type: template?.type || "info",
      issueType: issueType as IssueType,
      title: messageTitle,
      body: messageBody,
    })
    setMessageSent(true)
    setSelectedIssue("")
    setMessageTitle("")
    setMessageBody("")
    setTimeout(() => setMessageSent(false), 3000)
  }

  const handleSaveSize = () => {
    if (!sizeNote) {
      alert("Evidence note required for size change")
      return
    }
    setIsEditingSize(false)
    setSizeNote("")
  }

  const handleSaveTracking = () => {
    setIsEditingTracking(false)
  }

  const backendCarrier = backendOrder?.shipment?.carrier ?? null
  const backendTracking = backendOrder?.shipment?.trackingNumbers?.[0] ?? null
  const backendLabelUrl = backendOrder?.shipment?.labelUrl ?? null
  const fallbackCarrier = liveBooking?.shipment?.carrier ?? null
  const fallbackLabelUrl = liveBooking?.shipment?.labelUrl ?? null
  const currentCarrier = backendCarrier || fallbackCarrier
  const currentLabelUrl = backendLabelUrl || fallbackLabelUrl
  const canRefreshTracking = !!backendCarrier && !!backendTracking
  const canReissue = !!backendOrder || !!liveBooking

  const handleCopyTracking = async () => {
    if (!trackingNumber) return
    try {
      await navigator.clipboard.writeText(trackingNumber)
      setCopiedTracking(true)
      setTimeout(() => setCopiedTracking(false), 2000)
    } catch {
      // Clipboard access can fail in some environments; ignore.
    }
  }

  const extractTrackingStatusText = (trackingData: unknown): string => {
    if (!trackingData || typeof trackingData !== "object") return ""
    const obj = trackingData as any

    const current =
      obj.current_status?.status ??
      obj.currentStatus?.status ??
      obj.status?.status ??
      obj.current_status?.current_status ??
      obj.message ??
      null

    if (typeof current === "string" && current.trim()) return current.trim()

    // Ship&co sometimes returns a `details` array with the most recent text/status there.
    const details0 = Array.isArray(obj.details) ? obj.details[0] : null
    const detailsText = details0?.status ?? details0?.detail ?? details0?.message ?? null
    if (typeof detailsText === "string" && detailsText.trim()) return detailsText.trim()

    return ""
  }

  const mapTrackingToStatus = (trackingTextOrData: unknown): StoredBooking["status"] | null => {
    const text =
      typeof trackingTextOrData === "string"
        ? trackingTextOrData
        : extractTrackingStatusText(trackingTextOrData) || JSON.stringify(trackingTextOrData ?? {})

    const s = (text || "").toLowerCase()
    if (!s) return null

    // Common "not found" responses: do not change statuses.
    if (s.includes("not found") || s.includes("no such") || s.includes("未登録")) return null

    // Delivered
    if (
      s.includes("delivered") ||
      s.includes("delivery complete") ||
      s.includes("out for delivery") ||
      s.includes("配達完了") ||
      s.includes("配達済") ||
      s.includes("到着") && s.includes("配達")
    ) {
      return "delivered"
    }

    // Picked up / collected at origin
    if (
      s.includes("picked up") ||
      s.includes("pickup complete") ||
      s.includes("pickedup") ||
      s.includes("pickup") ||
      s.includes("collected") ||
      s.includes("collection") ||
      s.includes("posting/collection") ||
      s.includes("posting") ||
      s.includes("取扱い") ||
      s.includes("集荷")
    ) {
      return "picked_up"
    }

    // In transit (default for any resolvable non-not-found status string)
    if (
      s.includes("in transit") ||
      s.includes("in-transit") ||
      s.includes("on the way") ||
      s.includes("out for delivery") ||
      s.includes("depot") ||
      s.includes("at depot") ||
      s.includes("輸送") ||
      s.includes("運送中") ||
      s.includes("発送") ||
      s.includes("通過") ||
      s.includes("交換") ||
      s.includes("到着") ||
      s.includes("exchange")
    ) {
      return "in_transit"
    }

    // Ship&co may return other phrases like "Arrival at outward office of exchange".
    // Since it's not "not found", treat it as in-transit for our state machine.
    return "in_transit"
  }

  const handleRefreshTracking = async () => {
    if (!backendCarrier || !backendTracking) return

    setTrackingRefreshLoading(true)
    setTrackingRefreshNote(null)

    try {
      const res = await getTracking(backendCarrier, backendTracking)
      if (!res.ok) {
        setTrackingRefreshNote(res.error || `Failed to refresh tracking (HTTP ${res.status})`)
        return
      }

      const statusText = extractTrackingStatusText(res.data)
      const mapped = mapTrackingToStatus(statusText || res.data)

      const isNotFound = statusText.toLowerCase().includes("not found") || statusText.toLowerCase().includes("未登録")
      if (isNotFound) {
        setTrackingRefreshNote(
          "Ship&co could not find this tracking number yet (or the number is not resolvable in test mode). Status was not changed."
        )
        return
      }

      if (mapped) {
        updateBookingStatus(orderId, mapped)
        setCurrentStatus(mapped)
        setTrackingRefreshNote(`Tracking refreshed: ${statusLabels[mapped] || mapped}`)
      } else {
        const shortRaw = (() => {
          try {
            const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data)
            return text.length > 140 ? `${text.slice(0, 140)}...` : text
          } catch {
            return "Tracking refreshed."
          }
        })()
        setTrackingRefreshNote(
          `Tracking refreshed, but the status is not recognized. ${
            statusText ? `Latest: ${statusText}` : `Details: ${shortRaw}`
          }`
        )
      }
    } finally {
      setTrackingRefreshLoading(false)
    }
  }

  const handleReissueLabel = async () => {
    // We can reissue either from backend snapshot or from the current session booking.
    const source = backendOrder ?? liveBooking
    if (!source) return

    setReissueLoading(true)
    setReissueSuccess(false)
    setBackendError(null)

    try {
      // Build Ship&co payload from the order snapshot shape.
      const payload = buildShipmentPayload({
        orderId: source.orderId,
        pickup: liveBooking?.pickup ?? (source as BackendOrder).pickup,
        destination: {
          ...source.destination,
          facility: liveBooking?.destination?.facility ?? (source as BackendOrder).destination?.facility,
        },
        items: (source.items || []).map((i: any) => ({ size: i.size, weight: Number(i.weight) })),
        contact: {
          phone: (source as any).contact?.phone,
          email: (source as any).contact?.email,
        },
      })

      const bondexOrder = {
        orderId: source.orderId,
        status: "checked_in",
        destination: (source as any).destination,
        deliveryDate: (source as any).deliveryDate,
        items: (source as any).items,
        contact: (source as any).contact,
        payment: (source as any).payment ?? {},
        messages: (source as any).messages ?? [],
      } as any

      const res = await createShipment(payload, bondexOrder)
      if (!res.ok) {
        setBackendError(res.error || "Reissue failed.")
        return
      }
      if (!res.data) {
        setBackendError("Reissue failed.")
        return
      }

      const delivery = res.data.delivery
      const trackingNums = delivery?.tracking_numbers ?? []
      const nextTracking = trackingNums?.[0] ?? ""

      // Persist & refresh DB-backed store so traveler view updates in real time.
      updateBookingStatus(orderId, "checked_in")
      if (delivery) {
        updateBookingShipment(orderId, {
          labelUrl: delivery.label,
          trackingNumbers: trackingNums,
          carrier: delivery.carrier,
          shipmentId: res.data.id,
        })
      }

      setTrackingNumber(nextTracking)
      setCurrentStatus("checked_in")
      setReissueSuccess(true)
      setTrackingRefreshNote(null)

      // Refresh backend snapshot after reissue (best-effort).
      const backendRes = await getOrder(orderId)
      if (backendRes.ok) setBackendOrder(backendRes.data)
    } catch (e: any) {
      setBackendError(e?.message || "Reissue failed.")
    } finally {
      setReissueLoading(false)
      setTimeout(() => setReissueSuccess(false), 2500)
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono">{orderId}</h1>
          <p className="text-muted-foreground">Order details</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          {/* Status with dropdown */}
          <div className="p-4 rounded-lg bg-card border border-border">
            <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
              <Truck className="w-5 h-5" />
              Status
            </h3>
            <div className="relative mb-4">
              <button
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className="flex items-center justify-between w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted transition-colors"
              >
                <span>{statusLabels[currentStatus] || currentStatus}</span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showStatusDropdown ? "rotate-180" : ""}`} />
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden">
                  {statuses.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(s)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${s === currentStatus ? "bg-muted font-medium" : ""}`}
                    >
                      {statusLabels[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {trackingNumber && (
              <p className="text-sm text-muted-foreground font-mono mb-2">#{trackingNumber}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Select a status to update. Changes are reflected in the Traveler view in real-time.
            </p>
          </div>

          {/* Guest info */}
          <div className="p-4 rounded-lg bg-card border border-border">
            <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
              <User className="w-5 h-5" />
              Guest information
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{mockOrder.guestName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span>{mockOrder.guestEmail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span>{mockOrder.guestPhone}</span>
              </div>
            </div>
          </div>

          {/* Destination */}
          <div className="p-4 rounded-lg bg-card border border-border">
            <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Destination
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hotel</span>
                <span className="font-medium">{mockOrder.hotelName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Check-in</span>
                <span>{mockOrder.checkInDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Delivery</span>
                <span>{mockOrder.deliveryDate}</span>
              </div>
            </div>
          </div>

          {/* Shipping label + tracking */}
          <div className="p-4 rounded-lg bg-card border border-border space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-foreground mb-1">Shipping label & tracking</h3>
                <p className="text-xs text-muted-foreground">
                  Label/tracking derived from backend (Ship&co via proxy)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshTracking}
                  disabled={!canRefreshTracking || trackingRefreshLoading || backendLoading}
                >
                  {trackingRefreshLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Refreshing
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh tracking
                    </>
                  )}
                </Button>
              </div>
            </div>

            {backendLoading && <p className="text-xs text-muted-foreground">Loading backend shipment…</p>}
            {backendNotFound && (
              <div className="p-3 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground">
                Shipping not initialized yet (hotel check-in not persisted).
              </div>
            )}
            {backendError && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs border border-destructive/30">
                {backendError}
              </div>
            )}

            {/* Label */}
            <div className="p-3 rounded-lg bg-muted/20 border border-border">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Printer className="w-4 h-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Label</p>
                </div>
                {currentLabelUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(currentLabelUrl, "_blank", "noopener,noreferrer")}
                  >
                    Open label
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Not generated</span>
                )}
              </div>
            </div>

            {/* Tracking summary */}
            <div className="p-3 rounded-lg bg-muted/10 border border-border">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Carrier</span>
                  <span className="text-sm font-medium text-foreground">{currentCarrier || "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                    Tracking number
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{trackingNumber || "Not set"}</span>
                    <button
                      onClick={handleCopyTracking}
                      disabled={!trackingNumber}
                      className="p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                      aria-label="Copy tracking number"
                    >
                      <Copy className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>

                {trackingRefreshNote && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{trackingRefreshNote}</p>
                )}
              </div>
            </div>

            {/* Reissue */}
            <div className="flex items-center gap-2">
              <Button
                className="flex-1"
                onClick={handleReissueLabel}
                disabled={!canReissue || reissueLoading || backendLoading}
              >
                {reissueLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Reissuing…
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4 mr-2" />
                    Reissue label
                  </>
                )}
              </Button>
            </div>

            {reissueSuccess && (
              <div className="p-3 rounded-lg bg-foreground/5 border border-foreground/15 text-sm text-foreground">
                Label reissued successfully.
              </div>
            )}

            {/* Manual tracking override (only when backend shipment tracking is missing) */}
            {!backendTracking && (
              <div className="pt-4 border-t border-border">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-foreground text-sm">Manual tracking</h3>
                  {!isEditingTracking ? (
                    <Button variant="ghost" size="sm" onClick={() => setIsEditingTracking(true)}>
                      <Edit2 className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleSaveTracking}>
                      <Save className="w-4 h-4 mr-1" />
                      Save
                    </Button>
                  )}
                </div>

                {isEditingTracking ? (
                  <div className="space-y-2">
                    <Input
                      placeholder="Enter tracking number"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Use for handwritten label fallback only
                    </p>
                  </div>
                ) : (
                  <p className="font-mono text-sm">{trackingNumber || "Not set"}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Items and size control */}
          <div className="p-4 rounded-lg bg-card border border-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-foreground flex items-center gap-2">
                <Package className="w-5 h-5" />
                Items ({mockOrder.itemCount})
              </h3>
              {!isEditingSize ? (
                <Button variant="ghost" size="sm" onClick={() => setIsEditingSize(true)}>
                  <Edit2 className="w-4 h-4 mr-1" />
                  Adjust size
                </Button>
              ) : (
                <Button size="sm" onClick={handleSaveSize}>
                  <Save className="w-4 h-4 mr-1" />
                  Save
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {mockOrder.items.map((item, index) => (
                <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <span className="text-sm">Item {index + 1}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Declared: {item.size}</span>
                    {item.actualSize !== item.size && (
                      <>
                        <ArrowLeft className="w-3 h-3 rotate-180" />
                        <span className="text-sm font-medium text-foreground">Actual: {item.actualSize}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {isEditingSize && (
              <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border">
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Evidence note (required)
                </label>
                <Input
                  placeholder="Describe the size discrepancy..."
                  value={sizeNote}
                  onChange={(e) => setSizeNote(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Size change triggers automatic off-session surcharge
                </p>
              </div>
            )}
          </div>

          {/* Payment */}
          <div className="p-4 rounded-lg bg-card border border-border">
            <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              Payment
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base price</span>
                <span>¥{mockOrder.price.toLocaleString()}</span>
              </div>
              {mockOrder.surchargePending > 0 && (
                <div className="flex justify-between text-foreground">
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" />
                    Surcharge pending
                  </span>
                  <span className="font-medium">¥{mockOrder.surchargePending.toLocaleString()}</span>
                </div>
              )}
              <div className="pt-2 border-t border-border flex justify-between">
                <span className="font-medium">Total</span>
                <span className="font-bold">¥{(mockOrder.price + mockOrder.surchargePending).toLocaleString()}</span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                mockOrder.paymentStatus === "paid" ? "bg-foreground/10 text-foreground" :
                mockOrder.paymentStatus === "failed" ? "bg-destructive/10 text-destructive" :
                "bg-muted text-muted-foreground"
              }`}>
                {mockOrder.paymentStatus === "paid" && "Paid"}
                {mockOrder.paymentStatus === "failed" && "Failed"}
                {mockOrder.paymentStatus === "surcharge-pending" && "Surcharge pending"}
              </span>
            </div>
          </div>

          {/* Evidence photos */}
          <div className="p-4 rounded-lg bg-card border border-border">
            <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Evidence photos
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {mockOrder.evidencePhotos.map((photo) => (
                <button
                  key={photo}
                  onClick={() => setSelectedPhoto(photo)}
                  className="aspect-square rounded-lg bg-muted border border-border flex items-center justify-center hover:border-foreground transition-colors"
                >
                  <Camera className="w-6 h-6 text-muted-foreground" />
                </button>
              ))}
              {mockOrder.evidencePhotos.length === 0 && (
                <p className="col-span-3 text-sm text-muted-foreground text-center py-4">
                  No photos uploaded
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Issue Registration & Message Send */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Issue Registration */}
        <div className="p-4 rounded-lg bg-card border border-border">
          <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Register Issue & Notify User
          </h3>

          {/* Issue Type Selector */}
          <div className="space-y-2 mb-4">
            <label className="text-xs font-medium text-muted-foreground">Issue Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(ISSUE_TEMPLATES) as IssueType[]).map((key) => (
                <button
                  key={key}
                  onClick={() => handleIssueSelect(key)}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                    selectedIssue === key
                      ? "border-foreground bg-foreground/5 font-medium"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  {ISSUE_TEMPLATES[key].title}
                </button>
              ))}
            </div>
          </div>

          {/* Message Edit */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
              <Input
                value={messageTitle}
                onChange={(e) => setMessageTitle(e.target.value)}
                placeholder="Message title"
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Message body</label>
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Write a message to the traveler..."
                rows={3}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSendMessage}
                disabled={!messageTitle || !messageBody}
                className="flex-1"
              >
                <Send className="w-4 h-4 mr-2" />
                Send to Traveler
              </Button>
              {messageSent && (
                <span className="text-sm text-green-600 font-medium">Sent</span>
              )}
            </div>
            {!isLiveBooking && (
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                This is a mock order. Messages will not be persisted. Create a booking from the Traveler flow to test live messaging.
              </p>
            )}
          </div>
        </div>

        {/* Message History */}
        <div className="p-4 rounded-lg bg-card border border-border">
          <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Message History
            {messages.length > 0 && (
              <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                {messages.length}
              </span>
            )}
          </h3>

          {messages.length === 0 ? (
            <div className="text-center py-8">
              <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No messages sent yet</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {[...messages].reverse().map((msg) => (
                <div
                  key={msg.id}
                  className={`p-3 rounded-lg border ${
                    msg.type === "action_required" ? "border-destructive/30 bg-destructive/5" :
                    msg.type === "warning" ? "border-yellow-500/30 bg-yellow-500/5" :
                    "border-border bg-muted/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">{msg.title}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                      msg.type === "action_required" ? "bg-destructive/10 text-destructive" :
                      msg.type === "warning" ? "bg-yellow-500/10 text-yellow-600" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {msg.type.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">{msg.body}</p>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(msg.createdAt).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {msg.readAt ? (
                      <span className="text-green-600">Read</span>
                    ) : (
                      <span>Unread</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Photo viewer modal */}
      {selectedPhoto && (
        <div 
          className="fixed inset-0 bg-foreground/80 flex items-center justify-center z-50"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="bg-card p-4 rounded-lg max-w-2xl w-full mx-4">
            <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
              <Camera className="w-16 h-16 text-muted-foreground" />
            </div>
            <p className="text-center text-sm text-muted-foreground mt-4">
              Click anywhere to close
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
