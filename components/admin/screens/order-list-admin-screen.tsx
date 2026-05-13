"use client"

import { useState, useEffect, useCallback } from "react"
import { ArrowLeft, Search, Package, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ADMIN_GRID_STATUS_LABELS,
  getAllBookings,
  storedBookingStatusToAdminGridStatus,
  type StoredBooking,
} from "@/lib/booking-store"

interface OrderListAdminScreenProps {
  onSelectOrder: (orderId: string) => void
  onBack: () => void
  initialFilter?: string
}

const mockOrders = [
  { id: "BX-A1B2C3", guest: "Tanaka Yuki", hotel: "Park Hyatt Tokyo", items: 2, status: "in-transit", createdAt: "2026-02-02", actionRequired: false },
  { id: "BX-D4E5F6", guest: "Smith John", hotel: "Aman Tokyo", items: 1, status: "checked-in", createdAt: "2026-02-03", actionRequired: true, actionLabel: "Payment failure" },
  { id: "BX-G7H8I9", guest: "Mueller Hans", hotel: "The Ritz-Carlton Kyoto", items: 3, status: "delivered", createdAt: "2026-02-01", actionRequired: false },
  { id: "BX-J0K1L2", guest: "Lee Min-Jun", hotel: "Park Hyatt Tokyo", items: 1, status: "pending", createdAt: "2026-02-04", actionRequired: true, actionLabel: "Uncollected luggage" },
  { id: "BX-M3N4O5", guest: "Garcia Maria", hotel: "Hoshinoya Fuji", items: 2, status: "exception", createdAt: "2026-02-03", actionRequired: true, actionLabel: "Carrier exception" },
  { id: "BX-P6Q7R8", guest: "Kim Soo-Jin", hotel: "Aman Tokyo", items: 1, status: "delivered", createdAt: "2026-01-30", actionRequired: false },
  { id: "BX-S9T0U1", guest: "Williams Emma", hotel: "Park Hyatt Tokyo", items: 2, status: "in-transit", createdAt: "2026-02-02", actionRequired: false },
  { id: "BX-V2W3X4", guest: "Brown David", hotel: "The Ritz-Carlton Kyoto", items: 1, status: "cancelled", createdAt: "2026-02-01", actionRequired: false },
]

function toAdminOrder(b: StoredBooking) {
  const unresolvedMessages = (b.messages || []).filter((m) => m.type === "action_required" && !m.readAt)
  return {
    id: b.orderId,
    guest: b.destination.recipientName || b.destination.bookingName,
    hotel: b.destination.name || "Unknown",
    items: b.items.length || 1,
    status: storedBookingStatusToAdminGridStatus(b.status),
    createdAt: b.createdAt.slice(0, 10),
    actionRequired: unresolvedMessages.length > 0,
    actionLabel: unresolvedMessages[0]?.title || "",
  }
}

export function OrderListAdminScreen({ onSelectOrder, onBack, initialFilter = "all" }: OrderListAdminScreenProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>(initialFilter)
  const [liveOrders, setLiveOrders] = useState<ReturnType<typeof toAdminOrder>[]>([])

  useEffect(() => {
    setStatusFilter(initialFilter)
  }, [initialFilter])

  const load = useCallback(() => {
    setLiveOrders(getAllBookings().map(toAdminOrder))
  }, [])

  useEffect(() => {
    load()
    const h = () => load()
    window.addEventListener("bondex-booking-updated", h)
    return () => window.removeEventListener("bondex-booking-updated", h)
  }, [load])

  const allOrders = [
    ...liveOrders,
    ...mockOrders.filter((o) => !liveOrders.some((l) => l.id === o.id)),
  ]

  const filteredOrders = allOrders.filter(order => {
    const matchesSearch = 
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.guest.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.hotel.toLowerCase().includes(searchQuery.toLowerCase())
    
    let matchesStatus = false
    if (statusFilter === "all") {
      matchesStatus = true
    } else if (statusFilter === "active") {
      matchesStatus = order.status !== "delivered" && order.status !== "cancelled"
    } else if (statusFilter === "action_required") {
      matchesStatus = order.actionRequired === true
    } else {
      matchesStatus = order.status === statusFilter
    }
    
    return matchesSearch && matchesStatus
  })

  const statusOptions = [
    "all",
    "action_required",
    "active",
    "confirmed",
    "waiting",
    "pending",
    "checked-in",
    "picked-up",
    "in-transit",
    "delivered",
    "exception",
    "cancelled",
  ]
  const statusLabels: Record<string, string> = {
    all: "All statuses",
    action_required: "Action required",
    active: "Active (excl. delivered/cancelled)",
    confirmed: "Confirmed",
    waiting: "Waiting",
    pending: "Pending",
    "checked-in": "Checked in",
    "picked-up": "Picked up",
    "in-transit": "In transit",
    delivered: "Delivered",
    exception: "Exception",
    cancelled: "Cancelled",
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {}
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Package className="w-6 h-6" />
            {statusFilter === "all" ? "All Orders" : statusFilter === "active" ? "Active Orders" : `Orders: ${statusLabels[statusFilter] || statusFilter}`}
          </h1>
          <p className="text-muted-foreground">{filteredOrders.length} of {allOrders.length} orders</p>
        </div>
      </div>

      {}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by order ID, guest, or hotel..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 px-3 rounded-lg border border-border bg-background text-sm"
          >
            {statusOptions.map(status => (
              <option key={status} value={status}>
                {statusLabels[status] || status}
              </option>
            ))}
          </select>
        </div>
      </div>

      {}
      {filteredOrders.length > 0 ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Guest</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Hotel</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Items</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredOrders.map((order) => (
                <tr key={order.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-sm font-medium">{order.id}</td>
                  <td className="px-4 py-3 text-sm">{order.guest}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{order.hotel}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{order.items}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex w-fit px-2 py-1 rounded-full text-xs font-medium ${
                        order.status === "delivered" ? "bg-foreground/10 text-foreground" :
                        order.status === "in-transit" ? "bg-muted text-muted-foreground" :
                        order.status === "exception" ? "bg-destructive/10 text-destructive" :
                        order.status === "cancelled" ? "bg-muted text-muted-foreground line-through" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {ADMIN_GRID_STATUS_LABELS[order.status] ?? order.status}
                      </span>
                      {order.actionRequired && (
                        <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-bold uppercase">
                          Action required{order.actionLabel ? `: ${order.actionLabel}` : ""}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{order.createdAt}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => onSelectOrder(order.id)}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-medium text-foreground mb-1">No orders found</h3>
          <p className="text-sm text-muted-foreground">
            Try adjusting your search or filter criteria
          </p>
        </div>
      )}
    </div>
  )
}
