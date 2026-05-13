"use client"

import { useState } from "react"
import { ArrowLeft, User, Package, Calendar, Truck, Copy, CheckCircle2, Clock, AlertTriangle, Printer, MapPin, Info, ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Order, OrderStatus } from "../hotel-staff-flow"
import { useI18n } from "../i18n"
import { LanguageSwitcher } from "../language-switcher"

interface OrderDetailScreenProps {
  order: Order
  onBack: () => void
}

const STATUS_CONFIG: Record<OrderStatus, { icon: typeof Clock; bgClass: string; label: string }> = {
  waiting: { icon: Clock, bgClass: "bg-muted text-muted-foreground", label: "status.waiting" },
  ready: { icon: Truck, bgClass: "bg-muted text-muted-foreground", label: "status.ready" },
  flagged: { icon: AlertTriangle, bgClass: "bg-foreground text-background", label: "status.flagged" },
}

const DELIVERY_STEPS = ["trackingWaiting", "trackingInTransit", "trackingAtDepot", "trackingDelivered"] as const

export function OrderDetailScreen({ order, onBack }: OrderDetailScreenProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [reissueModal, setReissueModal] = useState(false)
  const [reissueSuccess, setReissueSuccess] = useState(false)

  const config = STATUS_CONFIG[order.status]
  const StatusIcon = config.icon
  const canReissue = order.status === "waiting" || order.status === "ready"

  const handleCopy = () => {
    if (order.tracking?.trackingNumber) {
      navigator.clipboard.writeText(order.tracking.trackingNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleReissue = () => {
    setReissueModal(false)
    setReissueSuccess(true)
    setTimeout(() => setReissueSuccess(false), 3000)
  }

  const getDeliveryStepIndex = () => {
    if (!order.tracking) return -1
    const map = { waiting: 0, "in-transit": 1, "at-depot": 2, delivered: 3 }
    return map[order.tracking.deliveryStatus]
  }

  const currentDeliveryStep = getDeliveryStepIndex()

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
      {}
      <header className="p-4 flex items-center gap-3 border-b border-border bg-card">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="font-semibold text-foreground">{t("detail.title")}</h1>
          <p className="text-sm text-muted-foreground font-mono">{order.id}</p>
        </div>
        <LanguageSwitcher />
      </header>

      {}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {}
        <div className={`p-4 rounded-lg flex items-center gap-3 ${config.bgClass}`}>
          <StatusIcon className="w-7 h-7" />
          <div>
            <p className="font-semibold text-lg">{t(config.label)}</p>
            {order.status === "flagged" && (
              <p className="text-sm opacity-80">{t("statusDesc.flagged")}</p>
            )}
          </div>
        </div>

        {}
        <div className="p-4 rounded-lg bg-card border border-border space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("detail.guestName")}</p>
              <p className="font-medium text-foreground">{order.guestName}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("detail.luggage")}</p>
              <p className="font-medium text-foreground">
                {order.itemCount} {order.itemCount > 1 ? t("orders.items") : t("orders.item")} / {t("checkin.size")}: {order.size}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("detail.checkInDate")}</p>
              <p className="font-medium text-foreground">{order.checkInDate}</p>
            </div>
          </div>
        </div>

        {}
        {order.hotelPhotos && order.hotelPhotos.length > 0 && (
          <div className="p-4 rounded-lg bg-card border border-border">
            <div className="flex items-center gap-2 mb-2">
              <ImageIcon className="w-4 h-4 text-foreground" />
              <h3 className="font-medium text-foreground text-sm">{t("photos.hotelTitle")}</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">{t("capture.officialRecord")}</p>
            <div className="flex gap-2 flex-wrap">
              {order.hotelPhotos.map((photo, i) => (
                <div key={i} className="w-20 h-20 rounded-lg bg-muted overflow-hidden">
                  <img src={photo || "/placeholder.svg"} alt={`Record photo ${i + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        {}
        {order.tracking && (
          <div className="p-4 rounded-lg bg-card border border-border space-y-4">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-muted-foreground" />
              <h3 className="font-medium text-foreground">{t("detail.tracking")}</h3>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">{t("detail.carrier")}</p>
              <p className="text-sm font-medium text-foreground">{order.tracking.carrier}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">{t("detail.trackingNumber")}</p>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-sm font-mono bg-muted px-2 py-1 rounded text-foreground">{order.tracking.trackingNumber}</code>
                <button onClick={handleCopy} className="p-1.5 rounded-md hover:bg-muted transition-colors" aria-label="Copy">
                  {copied ? <CheckCircle2 className="w-4 h-4 text-foreground" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                </button>
                {copied && <span className="text-xs text-muted-foreground">{t("detail.copied")}</span>}
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-3">{t("detail.deliveryStatus")}</p>
              <div className="space-y-0">
                {DELIVERY_STEPS.map((step, i) => {
                  const isActive = i <= currentDeliveryStep
                  const isCurrent = i === currentDeliveryStep
                  return (
                    <div key={step} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                          isActive ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                        }`}>
                          {isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />}
                        </div>
                        {i < DELIVERY_STEPS.length - 1 && (
                          <div className={`w-0.5 h-6 ${isActive ? "bg-foreground" : "bg-muted"}`} />
                        )}
                      </div>
                      <p className={`text-sm pt-0.5 ${isCurrent ? "font-semibold text-foreground" : isActive ? "text-foreground" : "text-muted-foreground"}`}>
                        {t(`detail.${step}`)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {}
        {canReissue && (
          <div className="p-4 rounded-lg bg-card border border-border">
            <Button onClick={() => setReissueModal(true)} variant="outline" className="w-full bg-transparent">
              <Printer className="w-4 h-4 mr-2" />
              {t("reissue.button")}
            </Button>
          </div>
        )}

        {reissueSuccess && (
          <div className="p-3 rounded-lg bg-foreground text-background flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{t("reissue.success")}</span>
          </div>
        )}

        {}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
          <Info className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">{t("detail.viewOnly")}</p>
        </div>
      </div>

      {}
      <div className="p-4 border-t border-border bg-card">
        <Button onClick={onBack} variant="outline" className="w-full h-12 bg-transparent">{t("detail.back")}</Button>
      </div>

      {}
      {reissueModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-end justify-center">
          <div className="absolute inset-0" onClick={() => setReissueModal(false)} />
          <div className="relative bg-card w-full max-w-md rounded-t-2xl border-t border-border p-6 pb-8">
            <div className="w-12 h-12 rounded-full bg-foreground/10 flex items-center justify-center mx-auto mb-4">
              <Printer className="w-6 h-6 text-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-center mb-2">{t("reissue.title")}</h2>
            <p className="text-sm text-muted-foreground text-center mb-6">{t("reissue.warning")}</p>
            <div className="flex gap-3">
              <Button onClick={() => setReissueModal(false)} variant="outline" className="flex-1 bg-transparent">{t("reissue.cancel")}</Button>
              <Button onClick={handleReissue} className="flex-1">{t("reissue.reissueLabel")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
