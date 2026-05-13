"use client"

import { ArrowLeft, AlertTriangle, CreditCard, ArrowRight, Info } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PaymentFailureScreenProps {
  onSelectOrder: (orderId: string) => void
  onBack: () => void
}

const failedPayments = [
  { 
    id: "BX-PAY001", 
    guestName: "Smith John", 
    guestEmail: "smith@example.com",
    amount: 4500, 
    type: "surcharge",
    reason: "Card declined",
    orderStatus: "in-transit",
    createdAt: "2026-02-04T08:30:00Z"
  },
]

export function PaymentFailureScreen({ onSelectOrder, onBack }: PaymentFailureScreenProps) {
  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      {}
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-6 h-6" />
            Payment Issues
          </h1>
          <p className="text-muted-foreground">Failed payments requiring manual recovery</p>
        </div>
      </div>

      {}
      <div className="p-4 rounded-lg bg-muted border border-border mb-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground mb-1">Payment failure handling policy</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>Shipment is <strong>NOT</strong> stopped for payment failures</li>
              <li>Status remains unchanged - shipment continues as normal</li>
              <li>CS handles payment recovery manually</li>
            </ul>
          </div>
        </div>
      </div>

      {}
      {failedPayments.length > 0 ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Guest</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {failedPayments.map((payment) => (
                <tr key={payment.id} className="hover:bg-muted/30">
                  <td className="px-4 py-4">
                    <div>
                      <p className="font-mono text-sm font-medium">{payment.id}</p>
                      <p className="text-xs text-muted-foreground">{payment.type === "surcharge" ? "Surcharge" : "Initial"}</p>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div>
                      <p className="text-sm font-medium">{payment.guestName}</p>
                      <p className="text-xs text-muted-foreground">{payment.guestEmail}</p>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-1">
                      <CreditCard className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">¥{payment.amount.toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-destructive/10 text-destructive text-xs font-medium">
                      <AlertTriangle className="w-3 h-3" />
                      {payment.reason}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="px-2 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                      {payment.orderStatus === "in-transit" ? "In transit" : payment.orderStatus}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Button size="sm" onClick={() => onSelectOrder(payment.id)}>
                      Handle
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <CreditCard className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-medium text-foreground mb-1">No payment issues</h3>
          <p className="text-sm text-muted-foreground">
            All payments are processing normally
          </p>
        </div>
      )}
    </div>
  )
}
