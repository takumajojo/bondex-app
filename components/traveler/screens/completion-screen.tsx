"use client"

import { CheckCircle, QrCode, Camera, MessageCircle, MapPin, Navigation, Clock, Copy, Check, Luggage, Smartphone, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState, useEffect } from "react"
import type { BookingData } from "../traveler-flow"

function QRCodeSVG({ value, size = 160 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(value, {
        width: size,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "H",
      }).then(setDataUrl).catch(() => setDataUrl(null))
    }).catch(() => setDataUrl(null))
  }, [value, size])

  if (!dataUrl) {
    return (
      <div style={{ width: size, height: size }} className="bg-white rounded flex items-center justify-center">
        <QrCode className="w-16 h-16 text-foreground/30" />
      </div>
    )
  }

  return (
    <img src={dataUrl} alt={`QR code for order ${value}`} width={size} height={size} className="rounded" />
  )
}

interface CompletionScreenProps {
  data: BookingData
  onViewStatus: () => void
  onBack: () => void
}

export function CompletionScreen({ data, onViewStatus }: CompletionScreenProps) {
  const [copied, setCopied] = useState(false)
  const orderId = data.orderId || "BX-DEMO123"
  const pickupHotel = data.pickup?.name || "Sakura Hotel Shinjuku"
  const pickupAddress = data.pickup?.address
  const deliveryDest = data.destination.name || "Narita Airport Terminal 1"
  const deliveryDate = data.deliveryDate.selected || "Feb 8, 2026"
  const itemCount = data.items.length || 1
  const checkInDate = data.destination.checkInDate || "Feb 7, 2026"

  const handleCopy = () => {
    navigator.clipboard.writeText(orderId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <div className="p-6 bg-foreground text-background text-center">
        <CheckCircle className="w-10 h-10 mx-auto mb-2" />
        <h1 className="text-xl font-bold">Booking confirmed</h1>
        <div className="mt-2 flex items-center justify-center gap-2">
          <span className="font-mono text-sm text-background/70">{orderId}</span>
          <button onClick={handleCopy} className="p-1 rounded hover:bg-background/10 transition-colors" aria-label="Copy order ID">
            {copied ? <Check className="w-3.5 h-3.5 text-background/70" /> : <Copy className="w-3.5 h-3.5 text-background/50" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            <div className="px-4 py-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-foreground/10 flex items-center justify-center shrink-0">
                <MapPin className="w-[18px] h-[18px] text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Pickup from</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{pickupHotel}</p>
                <p className="text-xs text-muted-foreground">{pickupAddress || "Front desk"}</p>
              </div>
            </div>
            <div className="px-4 py-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-foreground/10 flex items-center justify-center shrink-0">
                <Navigation className="w-[18px] h-[18px] text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Deliver to</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{deliveryDest}</p>
                <p className="text-xs text-muted-foreground">{deliveryDate} &middot; {itemCount} item{itemCount > 1 ? "s" : ""}</p>
              </div>
            </div>
            <div className="px-4 py-3.5 flex items-center gap-3 bg-foreground/[0.04]">
              <div className="w-9 h-9 rounded-full bg-foreground flex items-center justify-center shrink-0">
                <Clock className="w-[18px] h-[18px] text-background" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Check in by</p>
                <p className="text-sm font-bold text-foreground mt-0.5">{checkInDate}, before 17:00</p>
                <p className="text-xs text-muted-foreground">Late check-in may delay your delivery</p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-card border-2 border-foreground text-center space-y-3">
          <div className="w-44 h-44 mx-auto bg-white rounded-xl flex items-center justify-center p-2 shadow-inner">
            <QRCodeSVG value={orderId} size={152} />
          </div>
          <p className="text-sm font-semibold text-foreground">Show this at the hotel front desk</p>
          <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <QrCode className="w-3 h-3" />
              <span>Scan only at hotel front desk</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="w-3 h-3" />
              <span>QR becomes invalid after check-in</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h2 className="text-sm font-semibold text-foreground">What to do</h2>
          </div>
          <div className="p-4">
            <div className="flex items-stretch justify-between gap-2">
              <div className="flex-1 flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-full bg-foreground text-background flex items-center justify-center">
                  <Luggage className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">1</p>
                  <p className="text-[11px] leading-tight text-muted-foreground mt-0.5">Luggage to front desk</p>
                </div>
              </div>
              <div className="flex items-center pt-0 pb-8">
                <div className="w-4 h-px bg-border" />
              </div>
              <div className="flex-1 flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-full bg-foreground text-background flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">2</p>
                  <p className="text-[11px] leading-tight text-muted-foreground mt-0.5">Show QR code</p>
                </div>
              </div>
              <div className="flex items-center pt-0 pb-8">
                <div className="w-4 h-px bg-border" />
              </div>
              <div className="flex-1 flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-full bg-foreground text-background flex items-center justify-center">
                  <Tag className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">3</p>
                  <p className="text-[11px] leading-tight text-muted-foreground mt-0.5">Label attached by staff</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/40">
          <Camera className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">Take a screenshot, just in case.</p>
        </div>

        <button className="w-full px-4 py-3.5 rounded-xl border border-border bg-card flex items-center gap-3 hover:bg-muted transition-colors">
          <MessageCircle className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Need help? Contact BondEx</span>
        </button>
      </div>

      <div className="p-4 border-t border-border bg-card">
        <Button onClick={onViewStatus} className="w-full h-12">View delivery status</Button>
      </div>
    </div>
  )
}
