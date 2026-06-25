"use client"

import { useMemo, useState } from "react"
import { ArrowLeft, MapPin, CheckCircle2, Calendar, Clock, User, Package, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BookingData } from "../traveler-flow"

interface FinalReviewScreenProps {
  data: BookingData
  onConfirm: () => void
  onBack: () => void
}

// 仕様 §3.4: 決済直前の最終確認画面。
// 配送先・受取人・日時を大きく表示し、verified チェック後のみ Confirm & Pay を有効化する。
// 戻るボタンは Contact ではなく Destination 編集画面に直接戻すこと (traveler-flow.tsx 側で onBack を制御)。

// Flat rate model: ¥5,000 per item (B2B ツアー会社向けモデル).
const PRICE_YEN: Record<"S" | "M" | "L" | "LL", number> = {
  S: 5000,
  M: 5000,
  L: 5000,
  LL: 5000,
}

function staticMapUrl(lat?: number, lng?: number): string | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null
  return `/api/places/staticmap?lat=${lat}&lng=${lng}&zoom=16`
}

export function FinalReviewScreen({ data, onConfirm, onBack }: FinalReviewScreenProps) {
  const [verified, setVerified] = useState(false)
  const [showPickup, setShowPickup] = useState(false)
  const [showItems, setShowItems] = useState(false)

  // Static Map URL は destination の lat/lng が変わらない限り同じなので useMemo で固定。
  // 画面再描画で URL 文字列が新規生成されても、ブラウザはキャッシュキー (URL) が同じなら再 fetch しない。
  const mapSrc = useMemo(
    () => staticMapUrl(data.destination.facility?.lat, data.destination.facility?.lng),
    [data.destination.facility?.lat, data.destination.facility?.lng],
  )

  const recipient = data.destination.recipientName || data.destination.bookingName

  const totalPrice = useMemo(
    () => data.items.reduce((sum, item) => sum + (PRICE_YEN[item.size] || 0), 0),
    [data.items],
  )

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full bg-background">
      <header className="p-4 flex items-center gap-3 border-b border-border sticky top-0 bg-white/80 backdrop-blur-md z-20">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
          aria-label="Edit destination"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Final Review</h1>
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Step 5 of 7</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* 最重要セクション: 配送先 — 画面1/3以上の領域を占めるようサイズを大きく取る */}
        <section className="rounded-2xl border-2 border-primary/40 bg-primary/5 overflow-hidden">
          {mapSrc && (
            <img
              src={mapSrc}
              alt={`Map showing ${data.destination.name}`}
              width={600}
              height={300}
              className="w-full h-48 object-cover bg-muted"
              loading="lazy"
            />
          )}
          <div className="p-4 space-y-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Delivering to</p>
              <p className="text-base font-bold text-foreground leading-snug">{data.destination.name}</p>
              <p className="text-sm text-foreground/80 mt-1 leading-snug">
                {data.destination.facility?.zip && <>〒{data.destination.facility.zip}<br /></>}
                {data.destination.address}
              </p>
              {data.destination.facility?.vicinity && (
                <p className="text-xs text-muted-foreground mt-1">{data.destination.facility.vicinity}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 pt-3 border-t border-primary/20">
              <div className="flex items-start gap-3">
                <User className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recipient</p>
                  <p className="text-base font-bold text-foreground">{recipient || "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Check-in / Delivery date</p>
                  <p className="text-base font-bold text-foreground">
                    {data.deliveryDate.selected || data.deliveryDate.earliest || data.destination.checkInDate || "—"}
                  </p>
                </div>
              </div>
              {data.deliveryDate.expectedArrival && (
                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Delivery time</p>
                    <p className="text-base font-bold text-foreground">{data.deliveryDate.expectedArrival}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* セカンダリ: ピックアップ元 (折りたたみ可) */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowPickup((v) => !v)}
            className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <div className="text-left">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pickup from</p>
                <p className="text-sm font-bold text-foreground">{data.pickup?.name || "—"}</p>
              </div>
            </div>
            {showPickup ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showPickup && (
            <div className="px-4 pb-4 text-sm text-foreground/80">
              {data.pickup?.address || "—"}
            </div>
          )}
        </section>

        {/* セカンダリ: 荷物個数と料金 (折りたたみ可) */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowItems((v) => !v)}
            className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Package className="w-4 h-4 text-muted-foreground" />
              <div className="text-left">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Items &amp; total</p>
                <p className="text-sm font-bold text-foreground">
                  {data.items.length} {data.items.length === 1 ? "item" : "items"} · ¥{totalPrice.toLocaleString()}
                </p>
              </div>
            </div>
            {showItems ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showItems && (
            <div className="px-4 pb-4 space-y-2 text-sm">
              {data.items.map((item, idx) => (
                <div key={item.id} className="flex items-center justify-between text-foreground/80">
                  <span>Item {idx + 1} · Size {item.size}</span>
                  <span>¥{(PRICE_YEN[item.size] || 0).toLocaleString()}</span>
                </div>
              ))}
              <div className="flex items-center justify-between font-bold text-foreground pt-2 border-t border-border">
                <span>Total</span>
                <span>¥{totalPrice.toLocaleString()}</span>
              </div>
            </div>
          )}
        </section>

        {/* 必須チェック: 受取人と配送先の確認 */}
        <label className="flex items-start gap-3 p-4 rounded-2xl border-2 border-amber-200 bg-amber-50 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
            className="mt-0.5 w-5 h-5 rounded border-2 border-amber-400 accent-amber-700 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-900 leading-snug">I have verified the destination and recipient</p>
            <p className="text-xs text-amber-800 mt-1">
              Same-name hotels exist nearby. Please double-check the address before paying.
            </p>
          </div>
        </label>
      </div>

      <div className="p-4 border-t border-border bg-card flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1 h-14 rounded-2xl">
          Back
        </Button>
        <Button
          onClick={onConfirm}
          disabled={!verified}
          className="flex-[2] h-14 rounded-2xl text-base font-bold disabled:opacity-40"
        >
          <CheckCircle2 className="w-5 h-5 mr-2" />
          Confirm &amp; Pay
        </Button>
      </div>
    </div>
  )
}
