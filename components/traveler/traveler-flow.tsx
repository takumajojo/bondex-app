"use client"

import { useLayoutEffect, useMemo, useState } from "react"
import { saveBooking, generateOrderId, TRAVELER_CHECKOUT_DRAFT_KEY, type StoredBooking } from "@/lib/booking-store"
import { DEFAULT_PICKUP_FACILITY, formatFacilityAddress, type FacilityRecord } from "@/lib/facilities-data"
import { LandingScreen } from "./screens/landing-screen"
import { DestinationScreen } from "./screens/destination-screen"
import { LuggageInputScreen } from "./screens/luggage-input-screen"
import { ContactInfoScreen } from "./screens/contact-info-screen"
import { PaymentScreen } from "./screens/payment-screen"
import { CompletionScreen } from "./screens/completion-screen"
import { StatusDashboard } from "./screens/status-dashboard"
import { Calendar, Clock, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface BookingData {
  pickup?: {
    id?: string
    name: string
    address: string
    facility: FacilityRecord
    pickupDate?: string
    pickupTime?: string
  }
  destination: {
    name: string
    address: string
    type: string
    checkInDate: string
    bookingName: string
    recipientName?: string
    facility?: FacilityRecord
  }
  deliveryDate: {
    earliest: string
    selected: string
    expectedArrival?: string
    departureTime?: string
  }
  items: Array<{
    id: string
    size: "S" | "M" | "L" | "LL"
    photos: string[]
    estimatedWeight?: number
  }>
  contact: {
    email: string
    phone: string
  }
  orderId?: string
  paymentIntentId?: string
}

interface TravelerFlowProps {
  onBack?: () => void
  initialStep?: string | null
}

const STEP_MAP: Record<string, number> = {
  landing: 0,
  destination: 1,
  "delivery-date": 2,
  luggage: 3,
  contact: 4,
  payment: 5,
  completion: 6,
  status: 7,
}

export function TravelerFlow({ onBack, initialStep }: TravelerFlowProps) {
  const [step, setStep] = useState(() => {
    if (initialStep && initialStep in STEP_MAP) return STEP_MAP[initialStep]
    return 0
  })
  const [data, setData] = useState<BookingData>({
    pickup: undefined,
    destination: { name: "", address: "", type: "", checkInDate: "", bookingName: "" },
    deliveryDate: { earliest: "", selected: "", departureTime: "" },
    items: [],
    contact: { email: "", phone: "" },
  })

  useLayoutEffect(() => {
    if (typeof window === "undefined") return
    const p = new URLSearchParams(window.location.search)
    if (!p.get("payment_intent_client_secret")) return
    try {
      const raw = sessionStorage.getItem(TRAVELER_CHECKOUT_DRAFT_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { data?: BookingData }
      if (parsed?.data) {
        setData((prev) => ({ ...prev, ...parsed.data }))
      }
    } catch {
      // ignore
    }
  }, [])

  const handleUpdate = (updates: Partial<BookingData>) => {
    setData((prev) => ({ ...prev, ...updates }))
  }

  
  const DeliveryDateScreen = () => {
    const destName = data.destination.name || "your destination"
    const timeSlots = [
      "8:00 - 12:00",
      "14:00 - 16:00",
      "16:00 - 18:00",
      "18:00 - 20:00",
      "19:00 - 21:00",
    ]
    const toYmd = (d: Date) => {
      const y = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, "0")
      const day = String(d.getDate()).padStart(2, "0")
      return `${y}-${mo}-${day}`
    }

    // Minimum delivery datetime = pickup end time + 12 hours
    const minDelivery = useMemo(() => {
      const tomorrow = new Date()
      tomorrow.setHours(0, 0, 0, 0)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const pickupDate = data.pickup?.pickupDate
      const pickupTime = data.pickup?.pickupTime
      if (!pickupDate || !pickupTime) return { date: tomorrow, ymd: toYmd(tomorrow), minHour: 0 }
      const endHour = parseInt(pickupTime.split(" - ")[1]?.split(":")[0] ?? "12", 10)
      const [y, m, d] = pickupDate.split("-").map(Number)
      const minDt = new Date(new Date(y, m - 1, d, endHour).getTime() + 12 * 60 * 60 * 1000)
      const minDateOnly = new Date(minDt.getFullYear(), minDt.getMonth(), minDt.getDate())
      const effectiveDate = minDateOnly >= tomorrow ? minDateOnly : tomorrow
      return {
        date: effectiveDate,
        ymd: toYmd(effectiveDate),
        minHour: minDateOnly >= tomorrow ? minDt.getHours() : 0,
      }
    }, [data.pickup?.pickupDate, data.pickup?.pickupTime])

    const deliveryOptions = useMemo(() => {
      return Array.from({ length: 4 }).map((_, i) => {
        const d = new Date(minDelivery.date)
        d.setDate(minDelivery.date.getDate() + i)
        const label = d.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
        return { label, ymd: toYmd(d), earliest: i === 0 }
      })
    }, [minDelivery])

    const earliestLabel = deliveryOptions[0]?.label ?? ""
    const initialSelectedCandidate = data.deliveryDate.selected || data.deliveryDate.earliest
    const initialSelected = deliveryOptions.some((o) => o.label === initialSelectedCandidate)
      ? initialSelectedCandidate
      : earliestLabel

    const [selectedDate, setSelectedDate] = useState<string>(initialSelected)
    const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>(
      data.deliveryDate.expectedArrival ?? ""
    )

    const selectedYmd = deliveryOptions.find((o) => o.label === selectedDate)?.ymd ?? ""
    const availableTimeSlots = selectedYmd === minDelivery.ymd
      ? timeSlots.filter((slot) => parseInt(slot.split(":")[0], 10) >= minDelivery.minHour)
      : timeSlots

    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full pb-8 bg-background animate-in fade-in slide-in-from-right-4 duration-500">
        <div className="p-4 flex items-center gap-4 border-b border-border sticky top-0 bg-white/80 backdrop-blur-md z-20">
          <button onClick={() => setStep(1)} className="p-2 -ml-2 rounded-lg hover:bg-muted">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Delivery date</h1>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Step 3 of 6</p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-6">
          {}
          <div className="p-4 rounded-xl bg-muted/50 flex items-start gap-3">
            <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
            <p className="text-sm font-medium leading-tight">
              Select when you want your luggage to arrive at{" "}
              <span className="font-bold text-primary">{destName}</span>
            </p>
          </div>

          {}
          <div className="space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground pl-1">
              Delivery date
            </p>

            {deliveryOptions.map((opt) => {
              const isSelected = selectedDate === opt.label
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => {
                    setSelectedDate(opt.label)
                    // reset time slot if it becomes unavailable on this date
                    if (selectedTimeSlot && opt.ymd === minDelivery.ymd) {
                      const startHour = parseInt(selectedTimeSlot.split(":")[0], 10)
                      if (startHour < minDelivery.minHour) setSelectedTimeSlot("")
                    }
                  }}
                  className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${
                    isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`font-bold text-base ${
                          isSelected ? "text-foreground" : "text-muted-foreground/80"
                        }`}
                      >
                        {opt.label}
                      </div>
                      {opt.earliest && (
                        <div className="px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-black uppercase italic">
                          Earliest
                        </div>
                      )}
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? "border-primary" : "border-border"
                      }`}
                    >
                      {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {}
          <div className="space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground pl-1">
              Delivery time
            </p>
            {availableTimeSlots.map((slot) => {
              const isSelected = selectedTimeSlot === slot
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setSelectedTimeSlot(slot)}
                  className={`w-full p-4 rounded-2xl border-2 transition-all text-left flex items-center justify-between ${
                    isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-muted rounded-full">
                      <Clock className="w-4 h-4" />
                    </div>
                    <span className={`font-bold text-sm ${isSelected ? "text-foreground" : "text-muted-foreground/80"}`}>
                      {slot}
                    </span>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isSelected ? "border-primary" : "border-border"
                  }`}>
                    {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                  </div>
                </button>
              )
            })}
          </div>

        </div>

        {}
        <div className="p-4 bg-background border-t border-border sticky bottom-0">
          <Button
            className="w-full h-14 text-lg font-bold rounded-2xl"
            disabled={!selectedDate || !selectedTimeSlot}
            onClick={() => {
              handleUpdate({
                deliveryDate: {
                  ...data.deliveryDate,
                  earliest: earliestLabel,
                  selected: selectedDate,
                  expectedArrival: selectedTimeSlot,
                },
              })
              setStep(3)
            }}
          >
            Continue
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {}
      {step === 0 && <LandingScreen onNext={() => setStep(1)} onBack={() => onBack?.()} />}

      {}
      {step === 1 && (
        <DestinationScreen
          data={data}
          onUpdate={handleUpdate}
          onNext={() => setStep(2)}
          onBack={() => setStep(0)}
        />
      )}

      {}
      {step === 2 && <DeliveryDateScreen />}

      {}
      {step === 3 && (
        <LuggageInputScreen
          data={data}
          onUpdate={(d) => setData(d)}
          onNext={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}

      {}
      {step === 4 && (
        <ContactInfoScreen
          data={data}
          onUpdate={(d) => setData(d)}
          onNext={() => setStep(5)}
          onBack={() => setStep(3)}
        />
      )}

      {}
      {step === 5 && (
        <PaymentScreen
          data={data}
          onUpdate={(d) => setData(d)}
          onNext={(finalBooking) => {
            const booking = finalBooking ?? data
            const orderId = booking.orderId || generateOrderId()
            const prices: Record<string, number> = { S: 2500, M: 3500, L: 4500, LL: 6000 }
            const amount = booking.items.reduce((sum, item) => sum + (prices[item.size] || 0), 0)
            const maxAmount = amount + booking.items.length * 1500
            const stored: StoredBooking = {
              orderId,
              status: "confirmed",
              createdAt: new Date().toISOString(),
              pickup: booking.pickup?.facility
                ? {
                    id: booking.pickup.id,
                    name: booking.pickup.name,
                    address: booking.pickup.address,
                    facility: booking.pickup.facility,
                  }
                : {
                    name: DEFAULT_PICKUP_FACILITY.name,
                    address: formatFacilityAddress(DEFAULT_PICKUP_FACILITY),
                    facility: DEFAULT_PICKUP_FACILITY,
                  },
              destination: {
                name: booking.destination.name,
                address: booking.destination.address,
                type: booking.destination.type,
                checkInDate: booking.destination.checkInDate,
                bookingName: booking.destination.bookingName,
                recipientName: booking.destination.recipientName || booking.destination.bookingName,
                facility: booking.destination.facility,
              },
              deliveryDate: booking.deliveryDate.selected || booking.deliveryDate.earliest || "2026-02-18",
              items: booking.items.map((item) => ({
                size: item.size,
                weight: item.estimatedWeight || 10,
                photos: item.photos,
              })),
              messages: [],
              contact: {
                email: booking.contact.email,
                phone: booking.contact.phone,
                verified: true,
              },
              payment: {
                method: "stripe",
                amount,
                maxAmount,
                paymentIntentId: booking.paymentIntentId,
              },
            }
            saveBooking(stored)
            setData((prev) => ({ ...prev, ...booking, orderId }))
            setStep(6)
          }}
          onBack={() => setStep(4)}
        />
      )}

      {}
      {step === 6 && (
        <CompletionScreen data={data} onViewStatus={() => setStep(7)} onBack={() => setStep(5)} />
      )}

      {}
      {step === 7 && <StatusDashboard data={data} onBack={() => setStep(6)} />}

      {}
      <footer className="max-w-md mx-auto w-full px-6 py-6 border-t border-border/50">
        <div className="flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
          <a href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy Policy</a>
          <span className="text-muted-foreground/30">|</span>
          <a href="/legal/terms" className="hover:text-foreground transition-colors">Terms of Service</a>
          <span className="text-muted-foreground/30">|</span>
          <a href="/legal/commercial-transactions" className="hover:text-foreground transition-colors">SCTA</a>
        </div>
      </footer>
    </div>
  )
}


function ArrowLeft({ className }: { className?: string }) {
  return <ChevronRight className={`${className} rotate-180`} />
}

export default TravelerFlow
