"use client"

// 実際のPDFを canvas に描画して表示する(全ブラウザ対応・Safari/iOSでも表示可)。
// iframe埋め込みPDFは Safari で空白になるため、pdf.js でラスタライズして見せる。
// PDFのフォントは @react-pdf が埋め込み済みのため、外部CMap/フォントは不要。

import { useEffect, useRef, useState } from "react"

export function PdfPreview({
  bytes,
  fallback,
}: {
  bytes: Uint8Array | null
  fallback?: React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    if (!bytes) return
    let cancelled = false
    ;(async () => {
      setState("loading")
      try {
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
        // pdf.js は渡した TypedArray を neuter するので複製して渡す
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
        const container = containerRef.current
        if (!container || cancelled) return
        container.innerHTML = ""
        const cssWidth = container.clientWidth || 640
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const scale = (cssWidth / base.width) * dpr
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement("canvas")
          const ctx = canvas.getContext("2d")
          if (!ctx) continue
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = "100%"
          canvas.style.height = "auto"
          canvas.style.display = "block"
          canvas.style.marginBottom = "10px"
          canvas.style.boxShadow = "0 1px 4px rgba(0,0,0,0.12)"
          await page.render({ canvasContext: ctx, viewport }).promise
          if (cancelled) return
          container.appendChild(canvas)
        }
        if (!cancelled) setState("ready")
      } catch (e) {
        console.error("[pdf-preview] render failed:", e)
        if (!cancelled) setState("error")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bytes])

  if (state === "error" && fallback) return <>{fallback}</>

  return (
    <div>
      {state === "loading" && (
        <div className="py-16 text-center text-sm text-muted-foreground">PDFを読み込み中…</div>
      )}
      {state === "error" && !fallback && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          プレビューを表示できませんでした。「PDFを保存」からご確認ください。
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}
