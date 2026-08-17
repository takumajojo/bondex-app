"use client"

// 送り状を A5 で1枚に印刷するための共通ビュー(運営/代理店で共用)。
//
// PDF を直接印刷するとプリンターの既定用紙(A4等)が使われるため、送り状(A5)をブラウザ内で
// 画像化(pdf.js)して 1枚のHTMLに敷き、CSS @page でA5を効かせる。
// バーコードが潰れないよう約300dpi相当で描画する(実測でスキャン可を確認)。
//
// ブラウザ差:
//  - Chrome/Edge/Firefox は @page{size:A5 landscape} を尊重 → A5・横で自動、送り状は上向きのまま全面。
//  - Safari(WebKit) は @page の size/landscape を無視するため、A5(縦)のまま出て、横向きの送り状が
//    はみ出して2ページになる。対策として Safari のときだけ「A5縦の紙に送り状を90°回転して全面に敷く」
//    ことで、用紙選択のまま1枚・全面(スキャン可能な原寸)で印刷できるようにする。
//    (紙は縦向きで出るが、送り状は原寸で1枚に収まる)

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
  const [isSafari, setIsSafari] = useState(false)

  useEffect(() => {
    // Safari(WebKit)判定: Chrome/Edge/Firefox の各iOS版も除外する
    const ua = navigator.userAgent
    setIsSafari(/safari/i.test(ua) && !/chrome|chromium|crios|edg|edgios|fxios|android/i.test(ua))
  }, [])

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
        // 描画完了後、印刷ダイアログを自動で開く
        setTimeout(() => { if (!cancelled) window.print() }, 350)
      } catch (e) {
        console.error("[label-print] render failed:", e)
        if (!cancelled) { setErrMsg(e instanceof Error ? e.message : "render failed"); setState("error") }
      }
    })()
    return () => { cancelled = true }
  }, [bytes, fetchError, fetchLoading])

  // 2ページ目対策の共通リセット:
  //  - min-h-screen(100vh) は Safari の print で画面高になり空白の2ページ目を生む → lp-root を height:auto に
  //  - html/body overflow:hidden で、丸め誤差やヘッダ/フッタによるはみ出しを2ページ目にせず1枚に収める
  const sharedPrintReset = `
    html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #fff !important; }
    .lp-root { min-height: 0 !important; height: auto !important; background: #fff !important; }
    .no-print { display: none !important; }
  `
  // Safari は縦A5に90°回転で全面 / それ以外は横A5にそのまま全面
  const printCss = isSafari
    ? `
      @page { size: A5 portrait; margin: 0; }
      @media print {
        ${sharedPrintReset}
        .label-stage { margin: 0; padding: 0; width: 148mm; height: 210mm; position: relative; overflow: hidden; }
        .label-canvas {
          position: absolute; top: 50%; left: 50%;
          width: 210mm; height: 148mm;
          transform: translate(-50%, -50%) rotate(90deg);
          transform-origin: center center;
          box-shadow: none;
        }
      }`
    : `
      @page { size: A5 landscape; margin: 0; }
      @media print {
        ${sharedPrintReset}
        .label-stage { margin: 0; padding: 0; }
        .label-canvas { display: block; width: 100%; height: auto; max-height: 100vh; box-shadow: none; }
      }`

  return (
    <div className="lp-root min-h-screen bg-slate-100">
      <style>{`
        .label-canvas { display: block; }
        @media screen {
          .label-stage { max-width: 900px; margin: 0 auto; padding: 16px; }
          .label-canvas { width: 100%; height: auto; box-shadow: 0 1px 6px rgba(0,0,0,.15); background:#fff; }
        }
        ${printCss}
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
          印刷（A5）
        </button>
      </div>

      <div className="no-print px-4 pt-3 text-center text-[12px] text-slate-500">
        {state === "loading" && "送り状を準備中…（少し待つと印刷ダイアログが開きます）"}
        {state === "ready" && (
          isSafari
            ? "印刷ダイアログが開きます。用紙「A5」を選び、Safariの項目「ヘッダとフッタをプリント」のチェックを外すと、1枚・全面できれいに出ます（Safariでは紙は縦向き・送り状は原寸で回転します）。"
            : "印刷ダイアログが開きます。用紙が「A5・横」になっているのを確認して印刷してください（1枚・全面）。"
        )}
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
