"use client"

// 送り状を A5・横 で印刷するためのページ。
//
// PDF を直接印刷するとプリンターの既定用紙(A4等)が使われるため、送り状(A5)をブラウザ内で
// 画像化(pdf.js)して 1枚のHTMLに敷き、CSS @page { size: A5 landscape } を効かせる。
// これで Chrome/Edge の印刷ダイアログが最初から A5・横 で開く(用紙選択の手間が消える)。
// バーコードが潰れないよう高解像度(約300dpi 相当)で描画する。
// Safari は @page の効きが弱いので、その場合だけ手動でA5選択(注意書きを表示)。

import { useEffect, useRef, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"

const ALLOWED_LABEL_HOST = "storage.googleapis.com"

function PrintLabelInner() {
  const sp = useSearchParams()
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [errMsg, setErrMsg] = useState("")

  const url = sp.get("url") ?? ""
  const bookingId = sp.get("bookingId") ?? ""
  const leg = sp.get("leg") ?? ""

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setState("loading")
      setErrMsg("")
      // 安全: ラベルURLは Ship&co(GCS) のみ許可
      try {
        if (!url || new URL(url).hostname !== ALLOWED_LABEL_HOST) {
          throw new Error("invalid label url")
        }
      } catch {
        if (!cancelled) { setErrMsg("ラベルURLが不正です。"); setState("error") }
        return
      }
      try {
        // 同一オリジンのプロキシ経由でPDFバイトを取得(operator cookie 認証)
        const proxy = `/api/voucher/label?url=${encodeURIComponent(url)}&bookingId=${encodeURIComponent(bookingId)}${leg ? `&leg=${encodeURIComponent(leg)}` : ""}`
        const res = await fetch(proxy, { cache: "no-store" })
        if (!res.ok) throw new Error(`label fetch ${res.status}`)
        const bytes = new Uint8Array(await res.arrayBuffer())

        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
        const page = await doc.getPage(1)
        // 約300dpi 相当(72dpi 基準の 4.17倍)でラスタライズ → バーコードが潰れない
        const scale = 4.17
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("no canvas ctx")
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.className = "label-canvas"
        await page.render({ canvasContext: ctx, viewport }).promise
        if (cancelled) return
        const wrap = canvasWrapRef.current
        if (!wrap) return
        wrap.innerHTML = ""
        wrap.appendChild(canvas)
        setState("ready")
        // 描画完了後に印刷ダイアログを自動で開く(A5が既定で選ばれる)
        setTimeout(() => { if (!cancelled) window.print() }, 350)
      } catch (e) {
        console.error("[print-label] failed:", e)
        if (!cancelled) { setErrMsg(e instanceof Error ? e.message : "render failed"); setState("error") }
      }
    })()
    return () => { cancelled = true }
  }, [url, bookingId, leg])

  return (
    <div className="min-h-screen bg-slate-100">
      <style>{`
        @page { size: A5 landscape; margin: 0; }
        .label-canvas { display: block; }
        /* 画面表示: 幅に合わせて縮小 */
        @media screen {
          .label-stage { max-width: 900px; margin: 0 auto; padding: 16px; }
          .label-canvas { width: 100%; height: auto; box-shadow: 0 1px 6px rgba(0,0,0,.15); background:#fff; }
        }
        /* 印刷: A5横ぴったりに敷く(高解像度canvasを210x148mmへ縮小=くっきり) */
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .no-print { display: none !important; }
          .label-stage { margin: 0; padding: 0; }
          .label-canvas { width: 210mm; height: 148mm; box-shadow: none; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
        <div className="text-[13px] text-slate-700">
          <span className="font-semibold">送り状 A5印刷</span>
          <span className="text-slate-500 ml-2">{bookingId}{leg ? ` ・ ${leg}` : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={state !== "ready"}
            className="rounded-lg bg-[#C8102E] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#a60d26] disabled:opacity-50"
          >
            印刷（A5・横）
          </button>
        </div>
      </div>

      <div className="no-print px-4 pt-3 text-center text-[12px] text-slate-500">
        {state === "loading" && "送り状を準備中…（少し待って印刷ダイアログが開きます）"}
        {state === "ready" && "印刷ダイアログが開きます。用紙が「A5・横」になっているのを確認して印刷してください（Safariのみ手動でA5選択が必要な場合があります）。"}
        {state === "error" && (
          <span className="text-amber-700">表示できませんでした（{errMsg}）。この予約の送り状をダウンロードして印刷してください。</span>
        )}
      </div>

      <div className="label-stage">
        <div ref={canvasWrapRef} />
      </div>
    </div>
  )
}

export default function PrintLabelPage() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-sm text-slate-500">読み込み中…</div>}>
      <PrintLabelInner />
    </Suspense>
  )
}
