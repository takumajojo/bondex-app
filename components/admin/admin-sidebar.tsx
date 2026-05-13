"use client"

import { LayoutDashboard, Package, AlertTriangle, ArrowLeft, Shield, Building2 } from "lucide-react"

interface AdminSidebarProps {
  currentScreen: string
  onNavigate: (screen: string) => void
  onBack: () => void
}

export function AdminSidebar({ currentScreen, onNavigate, onBack }: AdminSidebarProps) {
  const navItems = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "orders", label: "All Orders", icon: Package },
    { id: "hotels", label: "Hotels", icon: Building2 },
    { id: "payment-failure", label: "Payment Issues", icon: AlertTriangle },
  ]

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      {}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-foreground flex items-center justify-center">
            <Shield className="w-5 h-5 text-background" />
          </div>
          <div>
            <h1 className="font-bold text-foreground">BondEx</h1>
            <p className="text-xs text-muted-foreground">Admin Dashboard</p>
          </div>
        </div>
      </div>

      {}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = currentScreen === item.id || 
              (item.id === "orders" && currentScreen === "order-detail") ||
              (item.id === "hotels" && currentScreen === "hotel-register")
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {}
      <div className="p-4 border-t border-border">
        <button
          onClick={onBack}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to roles
        </button>
      </div>
    </aside>
  )
}
