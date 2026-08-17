"use client"

// 代理店用: 自社送り状を A5・横 で印刷。label proxy は代理店JWT(Bearer)認証。
// Supabase セッションは localStorage 保存のため <a href> ではヘッダを付けられない。
// このページで token を取り、/api/agency/label を fetch → バイトを共通ビューに渡す。
import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { LabelPrintView } from "@/components/label-print-view"

function filenameFromCD(cd: string | null): string {
  const m = (cd || "").match(/filename="?([^";]+)"?/)
  return m?.[1] || ""
}

function AgencyPrintInner() {
  const sp = useSearchParams()
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [downloadName, setDownloadName] = useState("")
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")

  const bookingId = sp.get("booking_id") ?? ""
  const legIndex = sp.get("leg_index") ?? ""

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr("")
      try {
        const sb = getBrowserSupabase()
        const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
        if (!token) throw new Error("ログインが必要です")
        if (!bookingId || legIndex === "") throw new Error("パラメータが不正です")
        const res = await fetch(
          `/api/agency/label?booking_id=${encodeURIComponent(bookingId)}&leg_index=${encodeURIComponent(legIndex)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
        )
        if (!res.ok) throw new Error(`label fetch ${res.status}`)
        const name = filenameFromCD(res.headers.get("Content-Disposition"))
        const b = new Uint8Array(await res.arrayBuffer())
        if (!cancelled) {
          setBytes(b)
          setDownloadName(name || `BondEx_${bookingId}_L${Number(legIndex) + 1}_Label.pdf`)
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "fetch failed")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [bookingId, legIndex])

  const legNo = legIndex !== "" ? `L${Number(legIndex) + 1}` : ""
  return <LabelPrintView bytes={bytes} title={`${bookingId}${legNo ? ` ・ ${legNo}` : ""}`} downloadName={downloadName} fetchError={err} fetchLoading={loading} />
}

export default function AgencyPrintLabelPage() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-sm text-slate-500">読み込み中…</div>}>
      <AgencyPrintInner />
    </Suspense>
  )
}
