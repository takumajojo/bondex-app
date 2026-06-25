"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import {
  Upload,
  FileText,
  Loader2,
  ArrowRight,
  MapPin,
  Calendar,
  Users,
  Package,
  AlertCircle,
  RotateCcw,
  LogOut,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const FLAT_RATE_YEN = 5000

interface ParsedTraveler {
  name: string
  title: string
  type: "adult" | "child"
  age?: number
}

interface ParsedGuest {
  familyName: string
  travelerCount: number
  travelers: ParsedTraveler[]
}

interface ParsedShipmentLocation {
  hotel: string
  address: string
  city: string
}

interface ParsedShipment {
  shipmentDate: string
  expectedArrival: string
  from: ParsedShipmentLocation
  to: ParsedShipmentLocation
  recipient: string
}

interface ParsedItinerary {
  guest: ParsedGuest
  shipments: ParsedShipment[]
}

// 編集可能な State: パース結果に suitcaseCount を加える
interface EditableShipment extends ParsedShipment {
  suitcaseCount: number
}

interface EditableItinerary {
  guest: ParsedGuest
  shipments: EditableShipment[]
}

type Phase = "idle" | "parsing" | "review" | "error"

export default function OperatorPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("idle")
  const [fileName, setFileName] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [itinerary, setItinerary] = useState<EditableItinerary | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const onLogout = useCallback(async () => {
    await fetch("/api/operator/logout", { method: "POST" })
    router.replace("/operator/login")
  }, [router])

  const totalSuitcases = useMemo(() => {
    if (!itinerary) return 0
    return itinerary.shipments.reduce((sum, s) => sum + s.suitcaseCount, 0)
  }, [itinerary])

  const totalAmount = useMemo(() => totalSuitcases * FLAT_RATE_YEN, [totalSuitcases])

  const reset = useCallback(() => {
    setPhase("idle")
    setItinerary(null)
    setFileName("")
    setError("")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name)
    setError("")
    setItinerary(null)
    setPhase("parsing")

    const formData = new FormData()
    formData.append("file", file)

    try {
      const res = await fetch("/api/itinerary/parse", {
        method: "POST",
        body: formData,
      })
      const text = await res.text()
      let json: ParsedItinerary | { error?: string } | null = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        // non-JSON
      }
      if (!res.ok) {
        const msg = (json && "error" in json && json.error) || text || res.statusText
        setError(msg)
        setPhase("error")
        return
      }
      const parsed = json as ParsedItinerary
      if (!parsed?.guest || !Array.isArray(parsed.shipments)) {
        setError("Unexpected response shape from parser")
        setPhase("error")
        return
      }
      // Default rule B: suitcase count = traveler count, operator can edit per leg.
      const editable: EditableItinerary = {
        guest: parsed.guest,
        shipments: parsed.shipments.map((s) => ({
          ...s,
          suitcaseCount: parsed.guest.travelerCount || 1,
        })),
      }
      setItinerary(editable)
      setPhase("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
      setPhase("error")
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  const updateSuitcaseCount = (index: number, value: number) => {
    if (!itinerary) return
    const next = Math.max(0, Math.floor(value))
    setItinerary({
      ...itinerary,
      shipments: itinerary.shipments.map((s, i) =>
        i === index ? { ...s, suitcaseCount: next } : s,
      ),
    })
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              BondEx Operator
            </p>
            <h1 className="text-xl font-semibold text-foreground mt-0.5">Itinerary Upload</h1>
          </div>
          <div className="flex items-center gap-4">
            {phase !== "idle" && (
              <button
                onClick={reset}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
                Start over
              </button>
            )}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {phase === "idle" && (
          <section className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-base font-medium text-foreground">Upload an itinerary</h2>
              <p className="text-sm text-muted-foreground">
                Drop the traveler's PDF or photo. We'll read it and prepare the shipment plan.
              </p>
            </div>

            <label
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={`block rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-12 text-center ${
                isDragging
                  ? "border-foreground bg-foreground/5"
                  : "border-border bg-white hover:border-foreground/40"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <Upload className="w-5 h-5 text-foreground" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Drop a file here or click to choose
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, JPG, PNG · up to 10MB
                  </p>
                </div>
              </div>
            </label>
          </section>
        )}

        {phase === "parsing" && (
          <section className="rounded-2xl border border-border bg-white p-10 flex flex-col items-center gap-4">
            <Loader2 className="w-6 h-6 text-foreground animate-spin" strokeWidth={1.5} />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-foreground">Reading itinerary</p>
              <p className="text-xs text-muted-foreground">{fileName}</p>
            </div>
          </section>
        )}

        {phase === "error" && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-6 flex items-start gap-4">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="space-y-2 flex-1">
              <p className="text-sm font-medium text-red-900">We couldn't read this itinerary</p>
              <p className="text-xs text-red-800 break-words">{error}</p>
              <button
                onClick={reset}
                className="text-sm text-red-900 underline underline-offset-2 hover:no-underline"
              >
                Try another file
              </button>
            </div>
          </section>
        )}

        {phase === "review" && itinerary && (
          <ReviewView
            itinerary={itinerary}
            totalSuitcases={totalSuitcases}
            totalAmount={totalAmount}
            onUpdateSuitcaseCount={updateSuitcaseCount}
          />
        )}
      </div>
    </main>
  )
}

function ReviewView({
  itinerary,
  totalSuitcases,
  totalAmount,
  onUpdateSuitcaseCount,
}: {
  itinerary: EditableItinerary
  totalSuitcases: number
  totalAmount: number
  onUpdateSuitcaseCount: (index: number, value: number) => void
}) {
  const { guest, shipments } = itinerary

  return (
    <div className="space-y-8">
      {/* Guest summary */}
      <section className="rounded-2xl border border-border bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              Guest
            </p>
            <h2 className="text-xl font-semibold text-foreground">{guest.familyName}</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
              <Users className="w-4 h-4" strokeWidth={1.5} />
              {guest.travelerCount} {guest.travelerCount === 1 ? "traveler" : "travelers"}
            </p>
          </div>
        </div>

        {guest.travelers.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {guest.travelers.map((t, i) => (
              <li
                key={i}
                className="text-sm text-foreground/80 px-3 py-2 rounded-lg bg-muted/40"
              >
                <span className="font-medium text-foreground">
                  {t.title ? `${t.title} ` : ""}
                  {t.name}
                </span>
                {t.type === "child" && t.age !== undefined && (
                  <span className="text-xs text-muted-foreground"> · age {t.age}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Shipments */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              Shipment plan
            </p>
            <h2 className="text-xl font-semibold text-foreground mt-0.5">
              {shipments.length} {shipments.length === 1 ? "leg" : "legs"}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">¥{FLAT_RATE_YEN.toLocaleString()} per suitcase</p>
        </div>

        {shipments.length === 0 ? (
          <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted-foreground text-center">
            No luggage forwarding legs were found in this itinerary.
          </div>
        ) : (
          <ol className="space-y-3">
            {shipments.map((s, i) => (
              <ShipmentRow
                key={i}
                index={i}
                shipment={s}
                onUpdateSuitcaseCount={onUpdateSuitcaseCount}
              />
            ))}
          </ol>
        )}
      </section>

      {/* Totals + CTA */}
      <section className="rounded-2xl bg-foreground text-background p-6 flex items-center justify-between gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-background/60 font-medium">
            Total
          </p>
          <p className="text-2xl font-semibold mt-1">¥{totalAmount.toLocaleString()}</p>
          <p className="text-xs text-background/60 mt-1">
            {totalSuitcases} {totalSuitcases === 1 ? "suitcase" : "suitcases"} ·{" "}
            {shipments.length} {shipments.length === 1 ? "leg" : "legs"}
          </p>
        </div>
        <Button
          disabled
          className="h-14 px-6 rounded-2xl bg-background text-foreground hover:bg-background/90 disabled:opacity-50"
        >
          Generate Vouchers
          <span className="ml-2 text-[10px] uppercase tracking-widest opacity-70">Coming soon</span>
        </Button>
      </section>
    </div>
  )
}

function ShipmentRow({
  index,
  shipment,
  onUpdateSuitcaseCount,
}: {
  index: number
  shipment: EditableShipment
  onUpdateSuitcaseCount: (index: number, value: number) => void
}) {
  return (
    <li className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-start gap-4">
        <div className="w-7 h-7 rounded-full bg-foreground text-background text-xs font-medium flex items-center justify-center shrink-0">
          {index + 1}
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
          {/* From */}
          <div className="space-y-1 min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              From
            </p>
            <p className="text-base font-medium text-foreground truncate">{shipment.from.hotel}</p>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <MapPin className="w-3 h-3 mt-0.5 shrink-0" strokeWidth={1.5} />
              <span className="leading-snug">{shipment.from.city || shipment.from.address}</span>
            </p>
            <p className="text-xs text-foreground/80 flex items-center gap-1 pt-1">
              <Calendar className="w-3 h-3" strokeWidth={1.5} />
              Ship {shipment.shipmentDate}
            </p>
          </div>

          {/* Arrow */}
          <ArrowRight
            className="w-5 h-5 text-muted-foreground hidden md:block"
            strokeWidth={1.5}
          />

          {/* To */}
          <div className="space-y-1 min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              To
            </p>
            <p className="text-base font-medium text-foreground truncate">{shipment.to.hotel}</p>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <MapPin className="w-3 h-3 mt-0.5 shrink-0" strokeWidth={1.5} />
              <span className="leading-snug">{shipment.to.city || shipment.to.address}</span>
            </p>
            <p className="text-xs text-foreground/80 flex items-center gap-1 pt-1">
              <Calendar className="w-3 h-3" strokeWidth={1.5} />
              Arrive {shipment.expectedArrival}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
          Recipient: <span className="text-foreground/80 font-medium">{shipment.recipient}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <Package className="w-3.5 h-3.5" strokeWidth={1.5} />
            Suitcases
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={shipment.suitcaseCount}
            onChange={(e) => onUpdateSuitcaseCount(index, Number(e.target.value))}
            className="w-20 h-9 text-center"
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            ¥{(shipment.suitcaseCount * FLAT_RATE_YEN).toLocaleString()}
          </span>
        </div>
      </div>
    </li>
  )
}
