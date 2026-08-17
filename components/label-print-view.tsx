"use client"

// 送り状を A5・横 で印刷するための共通ビュー(運営/代理店で共用)。
//
// PDF を直接印刷するとプリンターの既定用紙(A4等)が使われるため、送り状(A5)をブラウザ内で
// 画像化(pdf.js)して 1枚のHTMLに敷き、CSS @page { size: A5 landscape } を効かせる。
// これで Chrome/Edge の印刷ダイアログが最初から A5・横 で開く。
// バーコードが潰れないよう約300dpi相当で描画する(実測でスキャン可を確認)。
// 親は PDF バイト取得(認証差分)だけ担当し、描画/印刷はここに集約する。

import { useEffect, useRef, useState } from "react"

export function LabelPrintView({
  bytes,
  title,
  fetchError,
  fetchLoading,
}: {
  bytes: Uint8Array | null
  title: string
  fetchError?: string
  fetchLoading?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [errMsg, setErrMsg] = useState("")

  useEffect(() => {
    if (fetchLoading) { setState("loading"); return }
    if (fetchError) { setErrMsg(fetchError); setState("error"); return }
    if (!bytes) return
    let cancelled = false
    ;(async () => {
      setState("loading")
      setErrMsg("")
      try {
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
        const page = await doc.getPage(1)
        // 約300dpi 相当(72dpi 基準の 4.17倍)。バーコードが潰れない。
        const viewport = page.getViewport({ scale: 4.17 })
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("no canvas ctx")
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.className = "label-canvas"
        await page.render({ canvasContext: ctx, viewport }).promise
        if (cancelled) return
        const wrap = wrapRef.current
        if (!wrap) return
        wrap.innerHTML = ""
        wrap.appendChild(canvas)
        setState("ready")
        // 描画完了後、印刷ダイアログを自動で開く(A5が既定で選ばれる)
        setTimeout(() => { if (!cancelled) window.print() }, 350)
      } catch (e) {
        console.error("[label-print] render failed:", e)
        if (!cancelled) { setErrMsg(e instanceof Error ? e.message : "render failed"); setState("error") }
      }
    })()
    return () => { cancelled = true }
  }, [bytes, fetchError, fetchLoading])

  return (
    <div className="min-h-screen bg-slate-100">
      <style>{`
        @page { size: A5 landscape; margin: 0; }
        .label-canvas { display: block; }
        @media screen {
          .label-stage { max-width: 900px; margin: 0 auto; padding: 16px; }
          .label-canvas { width: 100%; height: auto; box-shadow: 0 1px 6px rgba(0,0,0,.15); background:#fff; }
        }
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
          {title ? <span className="text-slate-500 ml-2">{title}</span> : null}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={state !== "ready"}
          className="rounded-lg bg-[#C8102E] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#a60d26] disabled:opacity-50"
        >
          印刷（A5・横）
        </button>
      </div>

      <div className="no-print px-4 pt-3 text-center text-[12px] text-slate-500">
        {state === "loading" && "送り状を準備中…（少し待つと印刷ダイアログが開きます）"}
        {state === "ready" && "印刷ダイアログが開きます。用紙が「A5・横」になっているのを確認して印刷してください（Safariのみ手動でA5選択が必要な場合があります）。"}
        {state === "error" && (
          <span className="text-amber-700">表示できませんでした（{errMsg}）。この送り状をダウンロードして印刷してください。</span>
        )}
      </div>

      <div className="label-stage">
        <div ref={wrapRef} />
      </div>
    </div>
  )
}
