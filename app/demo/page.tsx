"use client"

import { useState } from "react"
import Link from "next/link"
import { Loader2, Sparkles, ArrowRight, FileText, Package, Truck } from "lucide-react"
import { PdfPreview } from "@/components/pdf-preview"

const EXAMPLE = {
  fromHotel: "Hotel Gracery Shinjuku",
  toHotel: "The Thousand Kyoto",
  name: "John Smith",
  arrivalDate: "",
}

export default function DemoPage() {
  const [form, setForm] = useState({ ...EXAMPLE })
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const generate = async (data = form) => {
    if (!data.fromHotel.trim() || !data.toHotel.trim()) {
      setError("出発ホテルと到着ホテルを入力してください。")
      return
    }
    setError(null)
    setLoading(true)
    setSubmitted(true)
    try {
      const res = await fetch("/api/demo/voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, guestLanguage: "en" }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "生成に失敗しました")
      }
      const ab = await res.arrayBuffer()
      setBytes(new Uint8Array(ab))
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成に失敗しました")
    } finally {
      setLoading(false)
    }
  }

  const fmtDate = form.arrivalDate || "（到着日）"

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="h-9 w-auto object-contain" />
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground hidden sm:inline">無料・登録不要のデモ</span>
            <Link
              href="/agency/signup"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#C8102E] text-white text-sm font-semibold hover:bg-[#A00D25]"
            >
              無料で始める <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Hero */}
        <div className="text-center max-w-2xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">旅程を入れるだけ。</h1>
          <p className="mt-3 text-muted-foreground">
            出発ホテルと到着ホテルを入力すると、<strong className="text-foreground">お客様にお渡しするバウチャー</strong>と、
            <strong className="text-foreground">荷物に付ける送り状</strong>の見本がその場でできます。
            旅行者は「荷物を預けるだけ」で、次のホテルに手ぶらで移動できます。
          </p>
        </div>

        {/* 3 steps */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: FileText, t: "1. 旅程を入力 / 旅程表PDFをアップ", d: "行き先を入れるだけ。本番では旅程表PDFをアップするとAIが自動入力。" },
            { icon: Package, t: "2. 書類が自動でできる", d: "バウチャー（お客様用）と送り状（荷物用）をBondExが発行。" },
            { icon: Truck, t: "3. 荷物を預けるだけ", d: "送り状を付けて預ければ、佐川/ヤマトが次のホテルへ配送。" },
          ].map((s, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4">
              <s.icon className="w-5 h-5 text-[#C8102E]" strokeWidth={1.6} />
              <p className="mt-2 text-sm font-semibold text-foreground">{s.t}</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>

        {/* Form */}
        <div className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">出発ホテル（From）</label>
              <input value={form.fromHotel} onChange={set("fromHotel")} placeholder="Hotel Gracery Shinjuku" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">到着ホテル（To）</label>
              <input value={form.toHotel} onChange={set("toHotel")} placeholder="The Thousand Kyoto" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">お名前（ローマ字）</label>
              <input value={form.name} onChange={set("name")} placeholder="John Smith" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">到着日（任意）</label>
              <input type="date" value={form.arrivalDate} onChange={set("arrivalDate")} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
          </div>

          {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void generate()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#C8102E] text-white px-5 py-2.5 text-sm font-semibold hover:bg-[#A00D25] disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              バウチャーと送り状の見本を作る
            </button>
            <button
              onClick={() => { setForm({ ...EXAMPLE }); void generate({ ...EXAMPLE }) }}
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              サンプルで一発生成
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            ※ このデモは見本です。実際の発送・課金・追跡は行いません。本番では旅程表PDFをアップするだけでAIが自動入力します。
          </p>
        </div>

        {/* Results */}
        {submitted && (
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Voucher */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-[#C8102E]" />
                <h2 className="text-sm font-semibold text-foreground">お客様用バウチャー（見本）</h2>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3 min-h-[320px]">
                {loading ? (
                  <div className="py-20 text-center text-sm text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin inline" /> 作成中…
                  </div>
                ) : bytes ? (
                  <PdfPreview bytes={bytes} />
                ) : (
                  <div className="py-20 text-center text-sm text-muted-foreground">上のボタンで作成してください</div>
                )}
              </div>
            </div>

            {/* Shipping label mockup */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Truck className="w-4 h-4 text-[#C8102E]" />
                <h2 className="text-sm font-semibold text-foreground">荷物に付ける送り状（見本イメージ）</h2>
              </div>
              <div className="rounded-xl border border-border bg-white p-5 text-[13px] text-[#111] relative overflow-hidden">
                <span className="absolute top-3 right-3 text-[10px] font-bold text-[#C8102E] border border-[#C8102E] rounded px-1.5 py-0.5">
                  見本 / SAMPLE
                </span>
                <p className="text-xs text-muted-foreground">佐川急便 / Sagawa Express</p>
                <div className="mt-3 border-t border-dashed border-border pt-3 space-y-2">
                  <div>
                    <p className="text-[10px] text-muted-foreground">ご依頼主（発送元）</p>
                    <p className="font-medium">{form.name || "John Smith"} 様</p>
                    <p className="text-xs">{form.fromHotel || "Hotel Gracery Shinjuku"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">お届け先</p>
                    <p className="font-medium">{form.name || "John Smith"} 様</p>
                    <p className="text-xs">{form.toHotel || "The Thousand Kyoto"}</p>
                    <p className="text-xs">お届け日: {fmtDate}</p>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs">品名: スーツケース（1個）</p>
                    <p className="text-xs">サイズ160 / 陸便</p>
                  </div>
                </div>
                <div className="mt-4 h-9 bg-[repeating-linear-gradient(90deg,#111_0,#111_2px,transparent_2px,transparent_4px)] rounded-sm" />
                <p className="mt-2 text-[10px] text-muted-foreground text-center">— 実際の送り状はBondExが佐川/ヤマトで発行します —</p>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                旅行者は、この送り状を荷物に付けて宿泊先で預けるだけ。追跡もお客様のスマホでできます。
              </p>
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 rounded-2xl border border-[#C8102E]/30 bg-[#C8102E]/5 p-6 text-center">
          <p className="text-lg font-semibold text-foreground">ツアーに「手ぶら観光」を、初期費用0円で。</p>
          <p className="mt-1 text-sm text-muted-foreground">1件から・即日発行・月次まとめ精算。まずはご相談ください。</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link href="/agency/signup" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-[#C8102E] text-white text-sm font-semibold hover:bg-[#A00D25]">
              無料で始める <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/contact" className="inline-flex items-center h-10 px-4 rounded-lg border border-border text-sm text-foreground hover:bg-muted">
              導入のご相談
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
