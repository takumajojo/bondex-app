"use client"

import { useState, useMemo } from "react"
import { ChevronRight, Briefcase, Plus, Minus, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

interface LuggageItem {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  count: number
}

interface LuggageCountScreenProps {
  onNext: () => void
  onBack: () => void
}

export function LuggageCountScreen({ onNext, onBack }: LuggageCountScreenProps) {
  const [items, setItems] = useState<LuggageItem[]>([
    { id: "1", name: "Large Suitcase", description: "Up to 30kg / 160cm", icon: <Briefcase className="w-6 h-6" />, count: 1 },
    { id: "2", name: "Carry-on / Bag", description: "Small cabin luggage", icon: <Briefcase className="w-5 h-5" />, count: 0 },
    { id: "3", name: "Golf / Ski", description: "Special size items", icon: <Plus className="w-5 h-5" />, count: 0 },
  ])

  const totalCount = useMemo(() => items.reduce((sum, item) => sum + item.count, 0), [items])

  const updateCount = (id: string, delta: number) => {
    setItems(items.map(item =>
      item.id === id ? { ...item, count: Math.max(0, item.count + delta) } : item
    ))
  }

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full pb-8 bg-background">
      {}
      <div className="p-4 flex items-center gap-4 border-b border-border sticky top-0 bg-background/80 backdrop-blur-md z-20">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-muted">
          <ChevronRight className="w-5 h-5 rotate-180" />
        </button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Luggage count</h1>
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Step 3 of 6</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-8">
        {}
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-foreground">What are you sending?</h2>
          <p className="text-sm text-muted-foreground">Select the items you want to be hands-free from.</p>
        </div>

        {}
        <div className="space-y-4">
          {items.map((item) => (
            <div
              key={item.id}
              className={`p-5 rounded-2xl border-2 transition-all flex items-center justify-between ${
                item.count > 0
                  ? "border-foreground bg-foreground/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`p-3 rounded-xl ${
                    item.count > 0
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {item.icon}
                </div>
                <div>
                  <p className="font-bold text-base text-foreground">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => updateCount(item.id, -1)}
                  disabled={item.count === 0}
                  className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${
                    item.count > 0
                      ? "border-foreground text-foreground hover:bg-foreground/10"
                      : "border-muted text-muted-foreground/30 cursor-not-allowed"
                  }`}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="font-bold text-lg w-4 text-center text-foreground">{item.count}</span>
                <button
                  onClick={() => updateCount(item.id, 1)}
                  className="w-8 h-8 rounded-full border border-foreground text-foreground flex items-center justify-center hover:bg-foreground/10 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {}
        <div className="p-4 rounded-xl bg-muted/30 border border-dashed border-border flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Logistics Policy</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Per Yamato Transport regulations, maximum weight per item is{" "}
              <span className="font-bold text-foreground">30kg</span>. Total linear dimensions should not exceed{" "}
              <span className="font-bold text-foreground">160cm</span>.
            </p>
          </div>
        </div>

        {}
        {totalCount > 1 && (
          <div className="p-4 rounded-2xl bg-foreground text-background space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest opacity-80 italic">Pro Insight</p>
            <p className="text-sm font-medium">
              With {totalCount} bags, you{"'"}re saving yourself from carrying over 40kg through station crowds. Smart move!
            </p>
          </div>
        )}
      </div>

      {}
      <div className="p-4 bg-background border-t border-border">
        <Button
          className="w-full h-14 text-lg font-bold rounded-2xl"
          disabled={totalCount === 0}
          onClick={onNext}
        >
          {totalCount > 0 ? `Select ${totalCount} items` : "Select items to continue"}
        </Button>
      </div>
    </div>
  )
}
