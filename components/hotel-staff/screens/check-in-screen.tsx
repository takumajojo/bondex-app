"use client"

import { useState, useEffect, useRef } from "react"
import { ArrowLeft, Package, User, Calendar, QrCode, Camera, ImageIcon, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Order } from "../hotel-staff-flow"
import { useI18n } from "../i18n"
import { LanguageSwitcher } from "../language-switcher"
import { getBookingById, updateBookingStatus, updateBookingShipment } from "@/lib/booking-store"
import { createShipment, buildShipmentPayload } from "@/lib/shipandco-api"
import jsQR from "jsqr"

interface CheckInScreenProps {
  order: Order
  onPhotoCaptured: () => void
  onFlagIssue: () => void
  onBack: () => void
}

function QRScanner({ onScan, onClose }: { onScan: (result: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(true)
  const onScanRef = useRef(onScan)
  const [decoderMode, setDecoderMode] = useState<"barcodeDetector" | "jsqr" | "unsupported">("barcodeDetector")
  const decoderModeRef = useRef<"barcodeDetector" | "jsqr" | "unsupported">("barcodeDetector")
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const detectorRef = useRef<{ detect: (input: HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>> } | null>(null)
  const lastDecodeAtRef = useRef<number>(0)

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    let active = true

    async function startCamera() {
      try {
        // Initialize decoder once (fallback to jsqr if BarcodeDetector is missing).
        if (typeof window !== "undefined" && "BarcodeDetector" in window) {
          try {
            // BarcodeDetector types aren't included in TS DOM libs everywhere, so keep runtime-checked.
            const Ctor = (window as any).BarcodeDetector as
              | (new (opts: { formats: string[] }) => { detect: (input: HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>> })
              | undefined
            if (Ctor) {
              detectorRef.current = new Ctor({ formats: ["qr_code"] })
              setDecoderMode("barcodeDetector")
              decoderModeRef.current = "barcodeDetector"
            } else {
              setDecoderMode("jsqr")
              decoderModeRef.current = "jsqr"
            }
          } catch {
            setDecoderMode("jsqr")
            decoderModeRef.current = "jsqr"
          }
        } else {
          setDecoderMode("jsqr")
          decoderModeRef.current = "jsqr"
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
        })
        streamRef.current = stream
        if (videoRef.current && active) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
          scanFrame()
        }
      } catch {
        setError("Camera access denied. Please check browser settings.")
      }
    }

    async function scanFrame() {
      if (!active || !videoRef.current || !scanning) return
      const video = videoRef.current
      if (video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(scanFrame)
        return
      }
      const canvas = document.createElement("canvas")
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.drawImage(video, 0, 0)

      // Throttle decode attempts to reduce CPU usage.
      const now = Date.now()
      if (now - lastDecodeAtRef.current > 200) {
        lastDecodeAtRef.current = now

        try {
          if (detectorRef.current) {
            const codes = await detectorRef.current.detect(canvas)
            if (active && codes.length > 0 && codes[0]?.rawValue) {
              onScanRef.current(codes[0].rawValue)
              return
            }
          }

          // Fallback: decode from canvas pixels using jsqr.
          if (decoderModeRef.current !== "unsupported") {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(imageData.data, imageData.width, imageData.height)
            if (active && code?.data) {
              onScanRef.current(String(code.data))
              return
            }
          }
        } catch {
          // Ignore decode errors and continue scanning.
        }
      }
      if (active && scanning) {
        animFrameRef.current = requestAnimationFrame(scanFrame)
      }
    }

    startCamera()

    return () => {
      active = false
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [scanning])

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="p-4 flex items-center justify-between">
        <button onClick={onClose} className="text-white p-2 rounded-lg bg-white/10">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-white text-sm font-medium">Scan QR Code</span>
        <div className="w-9" />
      </div>
      <div className="flex-1 relative flex items-center justify-center">
        {error ? (
          <div className="text-white text-center px-8 space-y-3">
            <AlertTriangle className="w-12 h-12 mx-auto text-yellow-400" />
            <p className="text-sm">{error}</p>
            <Button onClick={onClose} variant="outline" className="mt-4 text-white border-white bg-transparent">Back</Button>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {decoderMode !== "barcodeDetector" && (
              <div className="absolute top-20 left-0 right-0 flex justify-center pointer-events-none">
                <div className="bg-black/50 text-white text-xs px-3 py-1 rounded-lg">
                  {decoderMode === "jsqr" ? "QR decoding fallback (compat mode)" : "QR decoding not supported in this browser"}
                </div>
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-64 h-64">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
                <div className="absolute inset-x-4 top-1/2 h-0.5 bg-white/60 animate-pulse" />
              </div>
            </div>
            <div className="absolute bottom-8 left-0 right-0 text-center">
              <p className="text-white/80 text-sm">{"Align the traveler's QR code within the frame"}</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function CheckInScreen({ order, onPhotoCaptured, onFlagIssue, onBack }: CheckInScreenProps) {
  const { t } = useI18n()
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([])
  const [isCapturing, setIsCapturing] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [qrVerified, setQrVerified] = useState(false)
  const [scannedId, setScannedId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [labelError, setLabelError] = useState<string | null>(null)

  const handleQRScan = (result: string) => {
    setShowScanner(false)
    setScannedId(result)
    if (result === order.id || result.startsWith("BX-") || result.startsWith("BDX-") || result.startsWith("bondex://")) {
      setQrVerified(true)
    } else {
      alert(`QR code does not match.\nScanned: ${result}\nOrder ID: ${order.id}`)
    }
  }

  const handleCapture = () => {
    setIsCapturing(true)
    setTimeout(() => {
      setCapturedPhotos(prev => [...prev, `/placeholder.svg?capture-${prev.length + 1}-${Date.now()}`])
      setIsCapturing(false)
    }, 400)
  }

  const handleDone = async () => {
    if (capturedPhotos.length < 1) return
    let booking = getBookingById(order.id)
    if (!booking) {
      // DB-backed facade loads asynchronously; wait briefly for cache population.
      await new Promise((r) => setTimeout(r, 600))
      booking = getBookingById(order.id)
    }
    if (!booking) {
      setLabelError("Booking is still loading. Try again or flag issue.")
      return
    }
    setLabelError(null)
    setIsSubmitting(true)
    try {
      const payload = buildShipmentPayload(booking)
      const bondexOrder = {
        orderId: booking.orderId,
        status: "checked_in",
        destination: booking.destination,
        deliveryDate: booking.deliveryDate,
        items: booking.items,
        contact: booking.contact,
        payment: booking.payment,
        messages: booking.messages ?? [],
      }
      const result = await createShipment(payload, bondexOrder)
      if (result.ok && result.data) {
        const d = result.data
        const delivery = d.delivery
        updateBookingStatus(order.id, "checked_in")
        updateBookingShipment(order.id, {
          labelUrl: delivery?.label,
          trackingNumbers: delivery?.tracking_numbers ?? [],
          carrier: delivery?.carrier,
          shipmentId: d.id,
        })
        onPhotoCaptured()
      } else {
        setLabelError(result.ok ? "Label could not be generated." : (result.error || "Label could not be generated. Try again or flag issue."))
      }
    } catch {
      setLabelError("Label could not be generated. Try again or flag issue.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasMinPhotos = capturedPhotos.length >= 1

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
      <header className="p-4 flex items-center gap-3 border-b border-border bg-card">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="font-semibold text-foreground">{t("checkin.title")}</h1>
          <p className="text-sm text-muted-foreground font-mono">{order.id}</p>
        </div>
        <LanguageSwitcher />
      </header>

      {showScanner && <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />}

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* QR verification: scan prompt or verified badge */}
        {!qrVerified ? (
          <div className="p-4 rounded-lg border-2 border-dashed border-foreground/30 text-center space-y-3">
            <QrCode className="w-12 h-12 mx-auto text-foreground/40" />
            <div>
              <p className="font-semibold text-foreground">{"Scan traveler's QR"}</p>
              <p className="text-sm text-muted-foreground mt-1">{"Read the QR code displayed on the traveler's phone"}</p>
            </div>
            <Button onClick={() => setShowScanner(true)} className="w-full h-12">
              <QrCode className="w-5 h-5 mr-2" />
              Start QR Scan
            </Button>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-foreground text-background">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 shrink-0" />
              <div>
                <p className="font-semibold">{t("checkin.qrVerified")}</p>
                <p className="text-sm text-background/70 font-mono">{scannedId || order.id}</p>
              </div>
            </div>
          </div>
        )}

        {/* Order summary */}
        <div className="p-4 rounded-lg bg-card border border-border">
          <h3 className="font-medium text-foreground mb-4">{t("checkin.orderSummary")}</h3>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("checkin.guestName")}</p>
                <p className="font-medium">{order.guestName}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Package className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("checkin.luggage")}</p>
                <p className="font-medium">{order.itemCount} {order.itemCount > 1 ? t("orders.items") : t("orders.item")} / {t("checkin.size")}: {order.size}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Calendar className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("checkin.checkInDate")}</p>
                <p className="font-medium">{order.checkInDate}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Traveler photos (reference) */}
        {order.travelerPhotos && order.travelerPhotos.length > 0 && (
          <div className="p-4 rounded-lg bg-card border border-border">
            <div className="flex items-center gap-2 mb-2">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium text-foreground text-sm">{t("photos.travelerTitle")}</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">{t("photos.travelerDesc")}</p>
            <div className="flex gap-2">
              {order.travelerPhotos.map((photo, i) => (
                <div key={i} className="w-20 h-20 rounded-lg bg-muted overflow-hidden">
                  <img
                    src={photo || "/placeholder.svg"}
                    alt={`Traveler photo ${i + 1}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const img = e.currentTarget
                      if (img.dataset.fallbackApplied === "1") return
                      img.dataset.fallbackApplied = "1"
                      img.src = "/placeholder.svg"
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Photo capture section */}
        <div className="p-4 rounded-lg bg-card border-2 border-foreground/20">
          <div className="flex items-center gap-2 mb-2">
            <Camera className="w-5 h-5 text-foreground" />
            <h3 className="font-semibold text-foreground">{t("capture.title")}</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-1">{t("capture.subtitle")}</p>
          <p className="text-xs font-medium text-foreground mb-4">{t("capture.officialRecord")}</p>
          {capturedPhotos.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-4">
              {capturedPhotos.map((photo, i) => (
                <div key={i} className="w-20 h-20 rounded-lg bg-muted overflow-hidden relative">
                  <img src={photo || "/placeholder.svg"} alt={`Captured photo ${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute bottom-0.5 right-0.5 bg-foreground text-background text-[9px] px-1 rounded">{i + 1}</div>
                </div>
              ))}
            </div>
          )}
          <Button onClick={handleCapture} disabled={isCapturing} variant="outline" className="w-full h-12 bg-transparent">
            <Camera className="w-5 h-5 mr-2" />
            {isCapturing ? t("capture.capturing") : capturedPhotos.length === 0 ? t("capture.takePhoto") : t("capture.takeAnother")}
          </Button>
          {capturedPhotos.length > 0 && (
            <p className="text-xs text-muted-foreground text-center mt-2">{capturedPhotos.length} {t("capture.photosCaptured")}</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground text-center px-4">{t("capture.autoFinalize")}</p>
      </div>

      <div className="p-4 border-t border-border bg-card space-y-2">
        {labelError && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {labelError}
          </div>
        )}
        <Button onClick={handleDone} disabled={!hasMinPhotos || isSubmitting} className="w-full h-14 text-lg">
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Generating label…
            </>
          ) : (
            <>
              <Camera className="w-5 h-5 mr-2" />
              {t("capture.recorded")}
            </>
          )}
        </Button>
        <button onClick={onFlagIssue} disabled={isSubmitting} className="w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {t("capture.flagIssue")}
        </button>
      </div>
    </div>
  )
}
