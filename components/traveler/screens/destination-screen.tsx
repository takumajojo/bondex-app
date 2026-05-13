"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft, MapPin, Search,
  CheckCircle2, X, Clock,
  Calendar, ShieldCheck, AlertCircle, Upload, FileText
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar as DateCalendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { formatFacilityAddress, type FacilityRecord } from "@/lib/facilities-data"
import type { BookingData } from "../traveler-flow"

type Prediction = { place_id: string; name: string; secondary: string }
type AC = { long_name: string; short_name: string; types: string[] }

// Restrict autocomplete to hotels in Japan
const HOTEL_PARAMS = new URLSearchParams({ types: "lodging", components: "country:JP" }).toString()

/**
 * Build address1 from raw address_components.
 * province = administrative_area_level_1
 * address1 = locality + sublocality_level_1~4 + premise, joined with no separator.
 * address2 = "" always.
 */
function acGet(components: AC[], type: string): string {
  return components.find((c) => c.types.includes(type))?.long_name ?? ""
}

function buildAddress1(components: AC[]): string {
  return [
    acGet(components, "locality"),
    acGet(components, "sublocality_level_1"),
    acGet(components, "sublocality_level_2"),
    acGet(components, "sublocality_level_3"),
    acGet(components, "sublocality_level_4"),
    acGet(components, "premise") || acGet(components, "street_number"),
  ]
    .filter(Boolean)
    .join("")
}

function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number)
  if (!y || !m || !d) return new Date(NaN)
  return new Date(y, m - 1, d)
}

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${mo}-${day}`
}

interface DestinationScreenProps {
  data: BookingData
  onUpdate: (data: Partial<BookingData>) => void
  onNext: () => void
  onBack: () => void
}

export function DestinationScreen({ data, onUpdate, onNext, onBack }: DestinationScreenProps) {

  // ---- Pickup state ----
  const [pickupLocation, setPickupLocation] = useState<FacilityRecord | null>(() => data.pickup?.facility ?? null)
  const [pickupQuery, setPickupQuery] = useState(data.pickup?.name ?? "")
  const [pickupPredictions, setPickupPredictions] = useState<Prediction[]>([])
  const [pickupLoading, setPickupLoading] = useState(false)
  const pickupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- Destination state ----
  const [selectedFacility, setSelectedFacility] = useState<FacilityRecord | null>(() => data.destination.facility ?? null)
  const [searchQuery, setSearchQuery] = useState(data.destination.name || "")
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [placesLoading, setPlacesLoading] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- Form fields ----
  const [arrivalDate, setArrivalDate] = useState(data.destination.checkInDate || "")
  const [arrivalTime, setArrivalTime] = useState("")
  const [bookingName, setBookingName] = useState(data.destination.bookingName || "")
  const [bookingDoc, setBookingDoc] = useState<File | null>(null)
  const bookingDocRef = useRef<HTMLInputElement>(null)
  const [sameAsBooking, setSameAsBooking] = useState(true)
  const [recipientName, setRecipientName] = useState("")
  const [flightNumber, setFlightNumber] = useState("")
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  const isAirport = selectedFacility?.destType === "airport"

  const minArrival = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 1)
    return { ymd: formatYmdLocal(d), start: d }
  }, [])

  useEffect(() => {
    if (!arrivalDate) return
    if (arrivalDate < minArrival.ymd) setArrivalDate(minArrival.ymd)
  }, [arrivalDate, minArrival.ymd])

  const logisticsStatus = useMemo(() => {
    if (!isAirport || !arrivalDate || !arrivalTime) return null
    const flightDate = parseYmdLocal(arrivalDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const shippingDeadline = new Date(flightDate)
    shippingDeadline.setDate(flightDate.getDate() - 2)
    const [hours, minutes] = arrivalTime.split(":").map(Number)
    const pickupTime = `${(hours - 2).toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
    const isPossible = shippingDeadline >= today
    return {
      shippingDeadline: shippingDeadline.toLocaleDateString("ja-JP", { month: "short", day: "numeric" }),
      pickupDeadline: pickupTime,
      isPossible,
      error: !isPossible ? "空港配送はフライトの2日前までの予約が必須です。" : null,
    }
  }, [isAirport, arrivalDate, arrivalTime])

  // Fetch place details and convert to FacilityRecord.
  // Address fields are parsed directly from address_components (not from the server-parsed strings).
  // address2 is always "" — never use formatted_address.
  const placesToFacility = useCallback(async (placeId: string): Promise<FacilityRecord | null> => {
    try {
      const res = await fetch(`/api/places?place_id=${encodeURIComponent(placeId)}`)
      const d = await res.json()
      const components: AC[] = d.address_components ?? []
      const province = components.length > 0
        ? acGet(components, "administrative_area_level_1")
        : (d.province ?? "")
      const address1 = components.length > 0
        ? buildAddress1(components)
        : (d.address1 ?? "")
      const facility: FacilityRecord = {
        id: d.id,
        name: d.name,
        destType: d.destType ?? "hotel",
        full_name: d.name,
        company: d.name,
        email: "",
        phone: d.phone ?? "",
        country: "JP",
        zip: d.zip ?? "",
        province,
        city: d.city ?? "",
        address1,
        address2: "",
        extra: "",
      }
      console.log("[bondex] FacilityRecord:", JSON.stringify({
        name: facility.name,
        province: facility.province,
        address1: facility.address1,
        address2: facility.address2,
      }, null, 2))
      return facility
    } catch {
      return null
    }
  }, [])

  // ---- Pickup search ----
  const searchPickupPlaces = useCallback((q: string) => {
    if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current)
    if (!q) { setPickupPredictions([]); return }
    pickupTimerRef.current = setTimeout(async () => {
      setPickupLoading(true)
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(q)}&${HOTEL_PARAMS}`)
        const json = await res.json()
        setPickupPredictions(json.predictions ?? [])
      } catch {
        setPickupPredictions([])
      } finally {
        setPickupLoading(false)
      }
    }, 300)
  }, [])

  const selectPickupPlace = useCallback(async (placeId: string, placeName: string) => {
    setPickupQuery(placeName)
    setPickupPredictions([])
    const facility = await placesToFacility(placeId)
    if (facility) setPickupLocation(facility)
  }, [placesToFacility])

  // ---- Destination search ----
  const searchPlaces = useCallback((q: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!q) { setPredictions([]); return }
    searchTimerRef.current = setTimeout(async () => {
      setPlacesLoading(true)
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(q)}&${HOTEL_PARAMS}`)
        const json = await res.json()
        setPredictions(json.predictions ?? [])
      } catch {
        setPredictions([])
      } finally {
        setPlacesLoading(false)
      }
    }, 300)
  }, [])

  const selectPlace = useCallback(async (placeId: string, placeName: string) => {
    setSearchQuery(placeName)
    setPredictions([])
    const facility = await placesToFacility(placeId)
    if (facility) setSelectedFacility(facility)
  }, [placesToFacility])

  const effectiveRecipient = sameAsBooking ? bookingName : recipientName

  const canContinue = useMemo(() => {
    const hasRecipient = sameAsBooking ? !!bookingName : !!recipientName
    const basicInfo = !!pickupLocation && !!selectedFacility && arrivalDate && arrivalTime && bookingName && bookingDoc && hasRecipient
    if (isAirport) return !!(basicInfo && flightNumber && logisticsStatus?.isPossible)
    return !!basicInfo
  }, [pickupLocation, selectedFacility, arrivalDate, arrivalTime, bookingName, bookingDoc, sameAsBooking, recipientName, isAirport, flightNumber, logisticsStatus])

  const handleContinue = () => {
    if (!selectedFacility || !pickupLocation) return
    onUpdate({
      pickup: {
        id: pickupLocation.id,
        name: pickupLocation.name,
        address: formatFacilityAddress(pickupLocation),
        facility: pickupLocation,
      },
      destination: {
        name: selectedFacility.name,
        address: formatFacilityAddress(selectedFacility),
        type: selectedFacility.destType,
        checkInDate: arrivalDate,
        bookingName,
        recipientName: effectiveRecipient,
        facility: selectedFacility,
      },
    })
    onNext()
  }

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full pb-8 bg-background">
      {/* Header */}
      <div className="p-4 flex items-center gap-4 border-b border-border sticky top-0 bg-white/80 backdrop-blur-md z-20">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-muted"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold tracking-tight">Trip Plan</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">

        {/* Step 1: Pickup */}
        <div className={`p-4 rounded-2xl border-2 transition-all ${pickupLocation ? "bg-muted/30 border-transparent" : "bg-primary/5 border-primary shadow-lg shadow-primary/10"}`}>
          <p className="text-[10px] uppercase font-bold text-muted-foreground mb-3">Step 1: Pickup Point</p>
          {pickupLocation ? (
            /* Confirmed state */
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-base truncate">{pickupLocation.name}</p>
                <p className="text-xs text-muted-foreground truncate">{formatFacilityAddress(pickupLocation)}</p>
                <div className="mt-2 flex items-center gap-1.5 text-primary text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Location confirmed</span>
                  <button
                    type="button"
                    onClick={() => { setPickupLocation(null); setPickupQuery(""); setPickupPredictions([]) }}
                    className="ml-auto text-[10px] text-muted-foreground underline"
                  >
                    Change
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Search state */
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                autoFocus
                placeholder="Enter hotel name..."
                className="pl-9 h-12 rounded-xl border-primary/40"
                value={pickupQuery}
                onChange={(e) => { setPickupQuery(e.target.value); searchPickupPlaces(e.target.value) }}
              />
              {(pickupLoading || pickupPredictions.length > 0) && pickupQuery && (
                <div className="absolute top-full left-0 right-0 mt-1 border rounded-xl bg-white z-30 shadow-2xl overflow-hidden">
                  {pickupLoading ? (
                    <div className="p-3 text-sm text-center text-muted-foreground">Searching...</div>
                  ) : pickupPredictions.map((p) => (
                    <button
                      key={p.place_id}
                      onClick={() => selectPickupPlace(p.place_id, p.name)}
                      className="w-full p-3 text-left hover:bg-primary/5 border-b last:border-0"
                    >
                      <p className="text-sm font-bold">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.secondary}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Destination & Logistics — revealed after pickup confirmed */}
        {!!pickupLocation && (
          <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Where to?"
                  className="pl-9 h-14 rounded-2xl shadow-sm"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSelectedFacility(null); searchPlaces(e.target.value) }}
                />
                {!selectedFacility && (predictions.length > 0 || placesLoading) && searchQuery && (
                  <div className="absolute top-full w-full mt-1 border rounded-xl bg-white z-30 shadow-2xl overflow-hidden">
                    {placesLoading ? (
                      <div className="p-4 text-sm text-muted-foreground text-center">Searching...</div>
                    ) : predictions.map((p) => (
                      <button
                        key={p.place_id}
                        onClick={() => selectPlace(p.place_id, p.name)}
                        className="w-full p-4 text-left hover:bg-muted border-b last:border-0"
                      >
                        <p className="font-bold text-sm">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.secondary}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> {isAirport ? "Flight Date" : "Check-in Date"}
                  </label>
                  <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "h-12 w-full justify-start rounded-xl border-input bg-background px-3 text-left font-normal shadow-xs",
                          !arrivalDate && "text-muted-foreground"
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                        {arrivalDate
                          ? parseYmdLocal(arrivalDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
                          : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <DateCalendar
                        mode="single"
                        selected={arrivalDate ? parseYmdLocal(arrivalDate) : undefined}
                        onSelect={(d) => { if (d) { setArrivalDate(formatYmdLocal(d)); setDatePickerOpen(false) } }}
                        disabled={{ before: minArrival.start }}
                        defaultMonth={arrivalDate ? parseYmdLocal(arrivalDate) : minArrival.start}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {isAirport ? "Flight Time" : "Arrival Time"}
                  </label>
                  <select
                    className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
                    value={arrivalTime}
                    onChange={(e) => setArrivalTime(e.target.value)}
                  >
                    <option value="">--:00</option>
                    {Array.from({ length: 24 }, (_, i) => {
                      const h = i.toString().padStart(2, "0")
                      return <option key={h} value={`${h}:00`}>{h}:00</option>
                    })}
                  </select>
                </div>
              </div>
            </div>

            {/* 物流SLAステータス */}
            {isAirport && logisticsStatus && (
              <div className={`p-4 rounded-xl border ${logisticsStatus.isPossible ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20 shadow-lg"}`}>
                <div className="flex items-start gap-3">
                  {logisticsStatus.isPossible
                    ? <ShieldCheck className="w-5 h-5 text-primary mt-0.5" />
                    : <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />}
                  <div className="space-y-1">
                    <p className={`text-xs font-bold ${logisticsStatus.isPossible ? "text-primary" : "text-destructive"}`}>
                      {logisticsStatus.isPossible ? "Logistics Schedule Confirmed" : "Critical Alert: Deadlines"}
                    </p>
                    <div className="text-[10px] text-muted-foreground space-y-1 leading-relaxed">
                      {logisticsStatus.isPossible ? (
                        <>
                          <p>• Airport counter pickup by: <strong>{logisticsStatus.pickupDeadline}</strong></p>
                          <p>• Shipping deadline from hotel: <strong>{logisticsStatus.shippingDeadline}</strong></p>
                        </>
                      ) : (
                        <p className="font-bold text-destructive">{logisticsStatus.error}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* フライト・名前情報 */}
            <div className="space-y-4 pt-2 border-t border-dashed">
              {isAirport && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground ml-1">Flight Number</label>
                  <Input
                    placeholder="e.g. JL001 / NH211"
                    className="h-12 rounded-xl uppercase font-mono border-primary/20"
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground ml-1">Booking Name</label>
                <Input
                  placeholder="Name on booking"
                  className="h-12 rounded-xl"
                  value={bookingName}
                  onChange={(e) => setBookingName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1 ml-1">
                  <label className="text-[10px] font-bold text-muted-foreground">Booking Confirmation</label>
                  <span className="text-[9px] font-bold text-destructive">Required</span>
                </div>
                <input
                  ref={bookingDocRef}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => { setBookingDoc(e.target.files?.[0] || null) }}
                  className="hidden"
                  aria-label="Upload booking confirmation"
                />
                {bookingDoc ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                    <FileText className="w-5 h-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{bookingDoc.name}</p>
                      <p className="text-[10px] text-muted-foreground">{(bookingDoc.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button
                      onClick={() => { setBookingDoc(null); if (bookingDocRef.current) bookingDocRef.current.value = "" }}
                      className="p-1 rounded-full hover:bg-muted transition-colors shrink-0"
                      aria-label="Remove file"
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => bookingDocRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border-2 border-dashed border-muted-foreground/30 hover:border-foreground/40 hover:bg-muted/50 transition-colors"
                  >
                    <Upload className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Upload confirmation screenshot or PDF</span>
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-muted-foreground ml-1">Recipient Name</label>
                <button
                  type="button"
                  onClick={() => setSameAsBooking(!sameAsBooking)}
                  className="flex items-center gap-2 ml-1"
                >
                  <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${sameAsBooking ? "bg-foreground border-foreground" : "border-muted-foreground"}`}>
                    {sameAsBooking && (
                      <svg className="w-2.5 h-2.5 text-background" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                  <span className="text-xs text-foreground">Same as booking name</span>
                </button>
                {!sameAsBooking && (
                  <Input
                    placeholder="Recipient full name"
                    className="h-12 rounded-xl"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="p-4 bg-white border-t border-border mt-auto">
        <Button
          className="w-full h-14 text-lg font-bold rounded-2xl shadow-xl transition-all shadow-primary/20"
          disabled={!canContinue}
          onClick={handleContinue}
        >
          {logisticsStatus?.error ? "Schedule Error" : "Confirm & Save Time"}
        </Button>
      </div>
    </div>
  )
}
