"use client"

import { useState } from "react"
import { AdminSidebar } from "./admin-sidebar"
import { DashboardOverview } from "./screens/dashboard-overview"
import { OrderDetailScreen } from "./screens/order-detail-screen"
import { PaymentFailureScreen } from "./screens/payment-failure-screen"
import { OrderListAdminScreen } from "./screens/order-list-admin-screen"
import { HotelListScreen } from "./screens/hotel-list-screen"
import { HotelRegisterScreen } from "./screens/hotel-register-screen"

type Screen = "overview" | "orders" | "order-detail" | "payment-failure" | "hotels" | "hotel-register"

interface AdminDashboardProps {
  onBack: () => void
  initialScreen?: string | null
}

export interface AdminOrder {
  id: string
  guestName: string
  guestEmail: string
  guestPhone: string
  itemCount: number
  items: Array<{ id: string; size: "S" | "M" | "L"; actualSize?: "S" | "M" | "L" }>
  status: "pending" | "checked-in" | "in-transit" | "delivered" | "exception"
  paymentStatus: "paid" | "failed" | "surcharge-pending"
  hotelName: string
  trackingNumber?: string
  createdAt: string
  checkInDate: string
  evidencePhotos: string[]
}

export function AdminDashboard({ onBack, initialScreen }: AdminDashboardProps) {
  const [currentScreen, setCurrentScreen] = useState<Screen>(() => {
    if (initialScreen && ["overview", "orders", "order-detail", "payment-failure", "hotels", "hotel-register"].includes(initialScreen)) {
      return initialScreen as Screen
    }
    return "overview"
  })
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [orderListFilter, setOrderListFilter] = useState<string>("all")

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId)
    setCurrentScreen("order-detail")
  }

  const handleViewPaymentFailures = () => {
    setCurrentScreen("payment-failure")
  }

  const handleViewOrders = (filter?: string) => {
    setOrderListFilter(filter || "all")
    setCurrentScreen("orders")
  }

  const handleBackToOverview = () => {
    setSelectedOrderId(null)
    setCurrentScreen("overview")
  }

  return (
    <div className="min-h-screen bg-background flex">
      {}
      <AdminSidebar 
        currentScreen={currentScreen}
        onNavigate={(screen) => {
          setCurrentScreen(screen as Screen)
          setSelectedOrderId(null)
        }}
        onBack={onBack}
      />

      {}
      <main className="flex-1 overflow-auto">
        {currentScreen === "overview" && (
          <DashboardOverview 
            onSelectOrder={handleSelectOrder}
            onViewPaymentFailures={handleViewPaymentFailures}
            onViewOrders={handleViewOrders}
          />
        )}
        {currentScreen === "orders" && (
          <OrderListAdminScreen
            onSelectOrder={handleSelectOrder}
            onBack={handleBackToOverview}
            initialFilter={orderListFilter}
          />
        )}
        {currentScreen === "order-detail" && selectedOrderId && (
          <OrderDetailScreen
            orderId={selectedOrderId}
            onBack={handleBackToOverview}
          />
        )}
        {currentScreen === "payment-failure" && (
          <PaymentFailureScreen
            onSelectOrder={handleSelectOrder}
            onBack={handleBackToOverview}
          />
        )}
        {currentScreen === "hotels" && (
          <HotelListScreen
            onAddHotel={() => setCurrentScreen("hotel-register")}
            onBack={handleBackToOverview}
          />
        )}
        {currentScreen === "hotel-register" && (
          <HotelRegisterScreen
            onBack={() => setCurrentScreen("hotels")}
          />
        )}
      </main>
    </div>
  )
}
