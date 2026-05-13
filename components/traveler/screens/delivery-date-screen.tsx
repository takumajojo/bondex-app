"use client"

import { useState, useMemo } from "react"
import { ArrowLeft, CalendarDays, Zap, Clock, Building2, ShieldCheck, Bell, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BookingData } from "../traveler-flow"

interface DeliveryDateScreenProps {
  data: BookingData
  onUpdate: (data: BookingData) => void
  onNext: () => void
  onBack: () => void
}

export function DeliveryDateScreen({ data, onUpdate, onNext, onBack }: DeliveryDateScreenProps) {
  const { earliestDate, availableDates } = useMemo(() => {
    const today = new Date()
    const earliest = new Date(today)
    
    earliest.setDate(earliest.getDate() + 1)
    
    const dates: Date[] = []
    for (let i = 0; i <= 14; i++) {
      const date = new Date(earliest)
      date.setDate(earliest.getDate() + i)
      dates.push(date)
    }
    
    return { earliestDate: earliest, availableDates: dates }
  }, [])

  const timeSlots = [
    { label: "8:00 - 12:00" },
    { label: "14:00 - 16:00" },
    { label: "16:00 - 18:00" },
    { label: "18:00 - 20:00" },
    { label: "19:00 - 21:00" },
  ]

  const [selectedDate, setSelectedDate] = useState<Date>(
    data.deliveryDate.selected
      ? new Date(data.deliveryDate.selected)
      : earliestDate
  )

  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>(
    data.deliveryDate.expectedArrival ?? timeSlots[0].label
  )

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  }

  const formatDateISO = (date: Date) => {
    return date.toISOString().split("T")[0]
  }

  const isEarliest = (date: Date) => {
    return formatDateISO(date) === formatDateISO(earliestDate)
  }

  const handleContinue = () => {
    onUpdate({
      ...data,
      deliveryDate: {
        earliest: formatDateISO(earliestDate),
        selected: formatDateISO(selectedDate),
        expectedArrival: selectedTimeSlot,
      },
    })
    onNext()
  }

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      {}
      <header className="p-4 flex items-center gap-3 border-b border-border">
        <button 
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-semibold text-foreground">Delivery date</h1>
          <p className="text-sm text-muted-foreground">Step 3 of 6</p>
        </div>
      </header>

      {}
      <div className="flex-1 overflow-auto p-4 space-y-5">
        {}
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <div className="flex items-start gap-3">
            <CalendarDays className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">
              Select when you want your luggage to arrive at{" "}
              <span className="font-medium">{data.destination.name || "your destination"}</span>
            </p>
          </div>
        </div>

        {}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Delivery date</p>
          <div className="space-y-2 max-h-[240px] overflow-y-auto">
            {availableDates.slice(0, 4).map((date) => {
              const isSelected = formatDateISO(date) === formatDateISO(selectedDate)
              const earliest = isEarliest(date)
              
              return (
                <button
                  key={formatDateISO(date)}
                  onClick={() => setSelectedDate(date)}
                  className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                    isSelected
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card hover:border-foreground/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className={`font-medium ${isSelected ? "text-background" : "text-foreground"}`}>
                        {formatDate(date)}
                      </p>
                      {earliest && (
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                          isSelected ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
                        }`}>
                          <Zap className="w-3 h-3" />
                          Earliest
                        </span>
                      )}
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      isSelected 
                        ? "border-background bg-background" 
                        : "border-border"
                    }`}>
                      {isSelected && (
                        <div className="w-2 h-2 rounded-full bg-foreground" />
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Delivery time</p>
          <div className="grid grid-cols-1 gap-2">
            {timeSlots.map((slot) => {
              const isSelected = selectedTimeSlot === slot.label
              return (
                <button
                  key={slot.label}
                  onClick={() => setSelectedTimeSlot(slot.label)}
                  className={`w-full p-3 rounded-lg border-2 transition-all text-left flex items-center justify-between ${
                    isSelected
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card hover:border-foreground/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Clock className={`w-4 h-4 ${isSelected ? "text-background" : "text-muted-foreground"}`} />
                    <span className={`text-sm font-medium ${isSelected ? "text-background" : "text-foreground"}`}>
                      {slot.label}
                    </span>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isSelected ? "border-background bg-background" : "border-border"
                  }`}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-foreground" />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {}
        {data.destination.type === "hotel" && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
            <Building2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Hotel accepts luggage: <span className="font-medium">8:00 - 22:00</span>
            </p>
          </div>
        )}

        {}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-medium text-muted-foreground">Good to know</p>
          </div>
          <div className="space-y-2 pl-6">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Luggage is received at the hotel front desk. You {"don't"} need to be present.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Hotel staff will hold your luggage safely until you arrive.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Bell className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                {"You'll"} be notified by email if there are any changes to your delivery.
              </p>
            </div>
          </div>
        </div>
      </div>

      {}
      <div className="p-4 border-t border-border bg-card">
        <Button onClick={handleContinue} className="w-full h-12">
          Continue
        </Button>
      </div>
    </div>
  )
}
