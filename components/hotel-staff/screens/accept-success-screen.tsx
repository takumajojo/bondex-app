"use client"

import { CheckCircle, Printer, Tag, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Order } from "../hotel-staff-flow"
import { useI18n } from "../i18n"
import { getBookingById } from "@/lib/booking-store"

interface AcceptSuccessScreenProps {
  order: Order
  onDone: () => void
}

export function AcceptSuccessScreen({ order, onDone }: AcceptSuccessScreenProps) {
  const { t } = useI18n()
  const booking = getBookingById(order.id)
  const labelUrl = booking?.shipment?.labelUrl ?? order.labelUrl
  const trackingNumber = booking?.shipment?.trackingNumbers?.[0] ?? order.tracking?.trackingNumber
  const carrier = booking?.shipment?.carrier ?? order.tracking?.carrier

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
      {}
      <div className="p-8 bg-foreground text-background text-center">
        <CheckCircle className="w-16 h-16 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-1">{t("success.title")}</h1>
        <p className="text-background/70">{order.guestName}</p>
      </div>

      {}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {}
        <div className="p-4 rounded-lg bg-card border border-border">
          <h3 className="font-medium text-foreground mb-3">{t("success.auto")}</h3>
          <div className="space-y-3">
            {[
              { icon: CheckCircle, text: t("success.statusUpdated") },
              { icon: CheckCircle, text: t("success.labelGenerated") },
              { icon: Printer, text: t("success.labelSent") },
              { icon: Truck, text: t("success.trackingAssigned") },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {}
        <div className="p-4 rounded-lg bg-muted border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-5 h-5 text-muted-foreground" />
            <span className="font-medium">{t("success.shippingLabel")}</span>
          </div>
          {labelUrl ? (
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(labelUrl, "_blank", "noopener,noreferrer")}
              >
                <Printer className="w-4 h-4 mr-2" />
                Print label
              </Button>
              {trackingNumber && (
                <p className="text-sm text-muted-foreground">
                  Tracking: <span className="font-mono font-medium text-foreground">{trackingNumber}</span>
                  {carrier && ` (${carrier})`}
                </p>
              )}
            </div>
          ) : (
            <div className="aspect-[3/2] rounded-lg bg-card border-2 border-dashed border-border flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-mono text-muted-foreground">{order.id}</p>
                <p className="text-xs text-muted-foreground mt-1">{order.itemCount} {order.itemCount > 1 ? t("orders.items") : t("orders.item")} ({order.size})</p>
              </div>
            </div>
          )}
        </div>

        {}
        <div className="p-4 rounded-lg bg-foreground/5 border border-foreground/20">
          <h3 className="font-semibold text-foreground mb-2">{t("success.nextStepTitle")}</h3>
          <ol className="space-y-2 text-sm">
            {[t("success.step1"), t("success.step2"), t("success.step3")].map((step, i) => (
              <li key={step} className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center text-xs shrink-0">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {}
      <div className="p-4 border-t border-border bg-card">
        <Button onClick={onDone} className="w-full h-12">{t("success.done")}</Button>
      </div>
    </div>
  )
}
