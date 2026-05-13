"use client"

import { useState, useEffect, useCallback } from "react"
import { AlertTriangle, Package, Truck, ArrowRight, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ADMIN_GRID_STATUS_LABELS,
  getAllBookings,
  storedBookingStatusToAdminGridStatus,
  type StoredBooking,
} from "@/lib/booking-store"

interface DashboardOverviewProps {
  onSelectOrder: (orderId: string) => void
  onViewPaymentFailures: () => void
  onViewOrders: (filter?: string) => void
}


const mockAllOrders = [
  { id: "BX-A1B2C3", guest: "Tanaka Yuki", status: "in-transit", items: 2, actionRequired: false, actionLabel: "" },
  { id: "BX-D4E5F6", guest: "Smith John", status: "checked-in", items: 1, actionRequired: true, actionLabel: "Payment failure" },
  { id: "BX-G7H8I9", guest: "Mueller Hans", status: "delivered", items: 3, actionRequired: false, actionLabel: "" },
  { id: "BX-J0K1L2", guest: "Lee Min-Jun", status: "pending", items: 1, actionRequired: true, actionLabel: "Uncollected luggage" },
  { id: "BX-M3N4O5", guest: "Garcia Maria", status: "exception", items: 2, actionRequired: true, actionLabel: "Carrier exception" },
  { id: "BX-P6Q7R8", guest: "Kim Soo-Jin", status: "delivered", items: 1, actionRequired: false, actionLabel: "" },
  { id: "BX-S9T0U1", guest: "Williams Emma", status: "in-transit", items: 2, actionRequired: false, actionLabel: "" },
  { id: "BX-V2W3X4", guest: "Brown David", status: "cancelled", items: 1, actionRequired: false, actionLabel: "" },
]

export function DashboardOverview({ onSelectOrder, onViewPaymentFailures, onViewOrders }: DashboardOverviewProps) {
  const [liveBookings, setLiveBookings] = useState<StoredBooking[]>([])

  const load = useCallback(() => setLiveBookings(getAllBookings()), [])
  useEffect(() => {
    load()
    const h = () => load()
    window.addEventListener("bondex-booking-updated", h)
    return () => window.removeEventListener("bondex-booking-updated", h)
  }, [load])

  const liveOrders = liveBookings.map((b) => {
    const unresolvedActions = (b.messages || []).filter((m) => m.type === "action_required" && !m.readAt)
    return {
      id: b.orderId,
      guest: b.destination.recipientName || b.destination.bookingName,
      status: storedBookingStatusToAdminGridStatus(b.status),
      items: b.items.length || 1,
      actionRequired: unresolvedActions.length > 0,
      actionLabel: unresolvedActions[0]?.title || "",
    }
  })

  
  const allOrders = [
    ...liveOrders,
    ...mockAllOrders.filter((o) => !liveOrders.some((l) => l.id === o.id)),
  ]

  
  const actionRequiredCount = allOrders.filter((o) => o.actionRequired).length
  const activeOrderCount = allOrders.filter((o) => o.status !== "delivered" && o.status !== "cancelled").length
  const inTransitCount = allOrders.filter((o) => o.status === "in-transit").length

  
  const mergedRecentOrders = allOrders.slice(0, 5)

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Dashboard</h1>
        <p className="text-muted-foreground">Operations overview and action items</p>
      </div>

      {}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <button
          onClick={() => onViewOrders("action_required")}
          className="p-4 rounded-lg bg-card border border-border text-left hover:border-foreground/30 hover:shadow-sm transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-foreground text-background flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{actionRequiredCount}</p>
              <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Action required</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => onViewOrders("active")}
          className="p-4 rounded-lg bg-card border border-border text-left hover:border-foreground/30 hover:shadow-sm transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
              <Package className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeOrderCount}</p>
              <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Active orders</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => onViewOrders("in-transit")}
          className="p-4 rounded-lg bg-card border border-border text-left hover:border-foreground/30 hover:shadow-sm transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
              <Truck className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{inTransitCount}</p>
              <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">In transit</p>
            </div>
          </div>
        </button>
      </div>

      {}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Action required
          </h2>
          <Button variant="ghost" size="sm" onClick={() => onViewOrders("action_required")}>
            View all
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Guest</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Issue</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allOrders.filter((o) => o.actionRequired).map((item) => (
                <tr key={item.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-mono text-sm font-medium">{item.id}</p>
                  </td>
                  <td className="px-4 py-3 text-sm">{item.guest}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-destructive/10 text-destructive text-xs font-medium">
                      <Clock className="w-3 h-3" />
                      {item.actionLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" onClick={() => onSelectOrder(item.id)}>
                      Resolve
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Package className="w-5 h-5" />
            Recent orders
          </h2>
          <Button variant="ghost" size="sm" onClick={onViewOrders}>
            View all
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Guest</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Items</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mergedRecentOrders.map((order) => (
                <tr key={order.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-sm font-medium">{order.id}</td>
                  <td className="px-4 py-3 text-sm">{order.guest}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{order.items} item{order.items > 1 ? "s" : ""}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                      order.status === "delivered" ? "bg-foreground/10 text-foreground" :
                      order.status === "in-transit" ? "bg-muted text-muted-foreground" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {ADMIN_GRID_STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </td>
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
      </div>
    </div>
  )
}
