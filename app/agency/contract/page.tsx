"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Check, Eraser, FileSignature, Download, ShieldCheck } from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"

interface Status {
  status: string
  currentVersion: string
  signed: boolean
  signedAt: string | null
  signerName: string | null
  signerTitle: string | null
}

export default function AgencyContractPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [signerName, setSignerName] = useState("")
  const [signerTitle, setSignerTitle] = useState("")
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)

  // セッショントークン取得
  useEffect(() => {
    ;(async () => {
      const sb = getBrowserSupabase()
      if (!sb) {
        setError("認証に失敗しました。ログインし直してください。")
        setLoading(false)
        return
      }
      const { data } = await sb.auth.getSession()
      const t = data.session?.access_token ?? null
      if (!t) {
        router.replace("/agency/login?next=/agency/contract")
        return
      }
      setToken(t)
    })()
  }, [router])

  const loadStatus = useCallback(async (t: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/agency/contract", {
        headers: { Authorization: `Bearer ${t}` },
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "取得に失敗しました")
      setStatus(json as Status)
      if (!json.signed) {
        const pv = await fetch("/api/agency/contract?preview=1", {
          headers: { Authorization: `Bearer ${t}` },
        })
        if (pv.ok) {
          const blob = await pv.blob()
          setPreviewUrl(URL.createObjectURL(blob))
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) void loadStatus(token)
  }, [token, loadStatus])

  // --- 署名キャンバス ---
  const ctx = () => canvasRef.current?.getContext("2d") ?? null
  const posOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    drawing.current = true
    const g = ctx()
    if (!g) return
    const { x, y } = posOf(e)
    g.beginPath()
    g.moveTo(x, y)
  }
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    e.preventDefault()
    const g = ctx()
    if (!g) return
    const { x, y } = posOf(e)
    g.lineTo(x, y)
    g.strokeStyle = "#0F0F0F"
    g.lineWidth = 2.4
    g.lineCap = "round"
    g.lineJoin = "round"
    g.stroke()
    hasInk.current = true
  }
  const endDraw = () => {
    drawing.current = false
  }
  const clearCanvas = () => {
    const g = ctx()
    const c = canvasRef.current
    if (g && c) g.clearRect(0, 0, c.width, c.height)
    hasInk.current = false
  }

  const submit = async () => {
    setError(null)
    if (!agreed) return setError("契約内容への同意にチェックを入れてください。")
    if (!signerName.trim()) return setError("署名者のお名前を入力してください。")
    if (!hasInk.current) return setError("枠内に手書きでサインしてください。")
    const canvas = canvasRef.current
    if (!canvas || !token) return
    const signatureImage = canvas.toDataURL("image/png")
    setSubmitting(true)
    try {
      const res = await fetch("/api/agency/contract", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ signerName: signerName.trim(), signerTitle: signerTitle.trim(), signatureImage, agreed: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "署名に失敗しました")
      // 署名済みPDFを自動ダウンロード
      if (json.signedPdfBase64) {
        const bytes = Uint8Array.from(atob(json.signedPdfBase64), (c) => c.charCodeAt(0))
        const blob = new Blob([bytes], { type: "application/pdf" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = "bondex-contract-signed.pdf"
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "署名に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  const downloadSigned = async () => {
    if (!token) return
    const res = await fetch("/api/agency/contract?download=1", { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return setError("ダウンロードに失敗しました")
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "bondex-contract-signed.pdf"
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const alreadySigned = status?.signed || done

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">BondEx 代理店</p>
            <h1 className="text-xl font-semibold text-foreground mt-0.5">業務委託契約書</h1>
          </div>
          <Link href="/agency" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            ポータルへ
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-20">
            <Loader2 className="w-5 h-5 animate-spin" /> 読み込み中…
          </div>
        ) : alreadySigned ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center">
            <ShieldCheck className="w-10 h-10 text-emerald-600 mx-auto" strokeWidth={1.5} />
            <p className="mt-3 text-lg font-semibold text-emerald-900">契約は締結済みです</p>
            <p className="mt-1 text-sm text-emerald-800">
              {status?.signerName ? `署名者：${status.signerName}　` : ""}
              {status?.signedAt ? new Date(status.signedAt).toLocaleString("ja-JP") : ""}
            </p>
            <button
              onClick={() => void downloadSigned()}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              <Download className="w-4 h-4" /> 署名済み契約書をダウンロード
            </button>
            <div className="mt-4">
              <Link href="/agency" className="text-sm text-emerald-800 underline">
                ポータルへ戻る
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              以下の契約書をご確認のうえ、ページ下部で同意・署名してください。署名するとメール不要でその場で締結が完了します。
            </p>

            {/* 契約書プレビュー */}
            <div className="rounded-xl border border-border overflow-hidden bg-muted/30">
              {previewUrl ? (
                <iframe src={previewUrl} title="契約書プレビュー" className="w-full h-[520px]" />
              ) : (
                <div className="h-[520px] flex items-center justify-center text-sm text-muted-foreground">
                  プレビューを読み込めませんでした
                </div>
              )}
            </div>

            {/* 署名フォーム */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2 text-foreground font-medium">
                <FileSignature className="w-4 h-4" /> 同意して署名する
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">署名者氏名（必須）</label>
                  <input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    maxLength={60}
                    placeholder="山田 太郎"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">役職（任意）</label>
                  <input
                    value={signerTitle}
                    onChange={(e) => setSignerTitle(e.target.value)}
                    maxLength={60}
                    placeholder="代表取締役"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-muted-foreground">手書きサイン（必須・枠内にサイン）</label>
                  <button onClick={clearCanvas} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <Eraser className="w-3.5 h-3.5" /> 消す
                  </button>
                </div>
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={200}
                  onPointerDown={startDraw}
                  onPointerMove={moveDraw}
                  onPointerUp={endDraw}
                  onPointerLeave={endDraw}
                  className="w-full h-[180px] rounded-lg border border-dashed border-border bg-background touch-none cursor-crosshair"
                />
              </div>

              <label className="flex items-start gap-2 text-sm text-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 rounded border-border"
                />
                <span>上記の業務委託契約書の内容を確認し、これに同意して電子的に締結します。</span>
              </label>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
              )}

              <button
                onClick={() => void submit()}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                同意して署名を確定する
              </button>
              <p className="text-[11px] text-muted-foreground text-center">
                署名者・日時・IP・契約書バージョンを記録します。締結後、署名済みPDFが自動でダウンロードされます。
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
