"use client"

import { useState } from "react"
import { Search, Plus, Building2, MapPin, ChevronRight } from "lucide-react"

interface HotelListScreenProps {
  onAddHotel: () => void
  onBack: () => void
}

const mockHotels = [
  { id: "h1", name: "Park Hyatt Tokyo", branch: "Shinjuku", region: "Tokyo", status: "active" as const, orderCount: 42 },
  { id: "h2", name: "The Ritz-Carlton Kyoto", branch: "Main", region: "Kyoto", status: "active" as const, orderCount: 28 },
  { id: "h3", name: "Aman Tokyo", branch: "Otemachi", region: "Tokyo", status: "active" as const, orderCount: 15 },
  { id: "h4", name: "Hoshinoya Fuji", branch: "Main", region: "Yamanashi", status: "active" as const, orderCount: 8 },
  { id: "h5", name: "Sakura Hotel Shinjuku", branch: "Main", region: "Tokyo", status: "paused" as const, orderCount: 0 },
]

export function HotelListScreen({ onAddHotel }: HotelListScreenProps) {
  const [search, setSearch] = useState("")

  const filtered = mockHotels.filter(h =>
    h.name.toLowerCase().includes(search.toLowerCase()) ||
    h.region.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8">
      {}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Hotels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mockHotels.length} registered hotels
          </p>
        </div>
        <button
          onClick={onAddHotel}
          className="flex items-center gap-2 px-4 py-2.5 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Add new hotel
        </button>
      </div>

      {}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by hotel name or region..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {}
      <div className="space-y-2">
        {filtered.map((hotel) => (
          <div
            key={hotel.id}
            className="flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <Building2 className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{hotel.name}</span>
                  {hotel.branch !== "Main" && (
                    <span className="text-xs text-muted-foreground">({hotel.branch})</span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    hotel.status === "active" 
                      ? "bg-success/10 text-success" 
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {hotel.status === "active" ? "Active" : "Paused"}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{hotel.region}</span>
                  <span className="text-xs text-muted-foreground ml-2">{hotel.orderCount} orders</span>
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
        ))}
      </div>
    </div>
  )
}
