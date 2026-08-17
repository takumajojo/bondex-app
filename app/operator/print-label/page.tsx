"use client"

// 運営用: 送り状を A5・横 で印刷。label proxy は operator cookie 認証。
import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { LabelPrintView } from "@/components/label-print-view"

const ALLOWED_LABEL_HOST = "storage.googleapis.com"

function OperatorPrintInner() {
  const sp = useSearchParams()
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")

  const url = sp.get("url") ?? ""
  const bookingId = sp.get("bookingId") ?? ""
  const leg = sp.get("leg") ?? ""

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr("")
      try {
        if (!url || new URL(url).hostname !== ALLOWED_LABEL_HOST) throw new Error("invalid label url")
        const proxy = `/api/voucher/label?url=${encodeURIComponent(url)}&bookingId=${encodeURIComponent(bookingId)}${leg ? `&leg=${encodeURIComponent(leg)}` : ""}`
        const res = await fetch(proxy, { cache: "no-store" })
        if (!res.ok) throw new Error(`label fetch ${res.status}`)
        const b = new Uint8Array(await res.arrayBuffer())
        if (!cancelled) setBytes(b)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "fetch failed")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [url, bookingId, leg])

  return <LabelPrintView bytes={bytes} title={`${bookingId}${leg ? ` ・ ${leg}` : ""}`} fetchError={err} fetchLoading={loading} />
}

export default function OperatorPrintLabelPage() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-sm text-slate-500">読み込み中…</div>}>
      <OperatorPrintInner />
    </Suspense>
  )
}
