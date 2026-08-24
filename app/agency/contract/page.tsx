"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Check, Eraser, FileSignature, Download, ShieldCheck, ExternalLink } from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { ContractHtml } from "@/components/contract-html"
import { PdfPreview } from "@/components/pdf-preview"
import { useAgencyLocale } from "@/lib/agency-i18n"

interface Status {
  status: string
  agencyName?: string
  locale?: "ja" | "en"
  currentVersion: string
  signed: boolean
  signedAt: string | null
  signerName: string | null
  signerTitle: string | null
  address?: string | null
}

// 契約署名ページの表示文言。契約書の言語は代理店のアカウント設定(status.locale)で決まるため、
// 画面のUIもそれに合わせて出し分ける(署名する契約書と画面の言語を一致させる)。
const messages = {
  ja: {
    brand: "BondEx 代理店",
    pageTitle: "業務委託契約書",
    backToPortal: "ポータルへ",
    loading: "読み込み中…",
    signedTitle: "契約は締結済みです",
    signerPrefix: "署名者：",
    downloadSigned: "署名済み契約書をダウンロード",
    backToPortal2: "ポータルへ戻る",
    reviewInstruction:
      "以下の契約書をご確認のうえ、ページ下部で同意・署名してください。署名するとメール不要でその場で締結が完了します。",
    fullText: "契約書（全文）",
    openPdf: "PDFを別タブで開く",
    savePdf: "PDFを保存",
    signHeading: "同意して署名する",
    signerNameLabel: "署名者氏名（必須）",
    signerNamePh: "山田 太郎",
    signerTitleLabel: "役職（任意）",
    signerTitlePh: "代表取締役",
    companyAddrLabel: "会社住所（必須・契約書「乙」欄に記載されます）",
    companyAddrPh: "〒100-0001 東京都千代田区…",
    signatureLabel: "手書きサイン（必須・枠内にサイン）",
    clear: "消す",
    consent: "上記の業務委託契約書の内容を確認し、これに同意して電子的に締結します。",
    submit: "同意して署名を確定する",
    legalNote: "署名者・日時・IP・契約書バージョンを記録します。締結後、署名済みPDFが自動でダウンロードされます。",
    emailSent: (to?: string) =>
      `署名済みの契約書を${to ? `「${to}」` : "ご登録のメール"}へ送信しました。`,
    emailPending: (note?: string) =>
      `契約は締結されました。控えメールの送信は保留中です${note ? `（${note}）` : ""}。下のボタンからPDFを保存できます。`,
    errAuth: "認証に失敗しました。ログインし直してください。",
    errLoad: "取得に失敗しました",
    errAgree: "契約内容への同意にチェックを入れてください。",
    errName: "署名者のお名前を入力してください。",
    errAddr: "会社住所を入力してください。",
    errSign: "枠内に手書きでサインしてください。",
    errSubmit: "署名に失敗しました",
    errDownload: "ダウンロードに失敗しました",
  },
  en: {
    brand: "BondEx Agency",
    pageTitle: "Agency Service Agreement",
    backToPortal: "Back to portal",
    loading: "Loading…",
    signedTitle: "Your contract is signed",
    signerPrefix: "Signer: ",
    downloadSigned: "Download signed contract",
    backToPortal2: "Back to portal",
    reviewInstruction:
      "Please review the agreement below and agree & sign at the bottom of the page. Signing concludes the contract on the spot — no email needed.",
    fullText: "Contract (full text)",
    openPdf: "Open PDF in a new tab",
    savePdf: "Save PDF",
    signHeading: "Agree and sign",
    signerNameLabel: "Signer name (required)",
    signerNamePh: "e.g. Taro Yamada",
    signerTitleLabel: "Title (optional)",
    signerTitlePh: "e.g. Representative Director",
    companyAddrLabel: "Company address (required — appears in the “Party B” field of the contract)",
    companyAddrPh: "e.g. 1-2-3 Main Street, City, Country",
    signatureLabel: "Handwritten signature (required — sign inside the box)",
    clear: "Clear",
    consent:
      "I have reviewed the Agency Service Agreement above and agree to conclude it electronically.",
    submit: "Agree and sign",
    legalNote:
      "We record the signer, date/time, IP, and contract version. The signed PDF downloads automatically once concluded.",
    emailSent: (to?: string) =>
      `The signed contract has been sent to ${to ? `“${to}”` : "your registered email"}.`,
    emailPending: (note?: string) =>
      `The contract is concluded. The copy email is pending${note ? ` (${note})` : ""}. You can save the PDF with the button below.`,
    errAuth: "Authentication failed. Please sign in again.",
    errLoad: "Failed to load.",
    errAgree: "Please check the box to agree to the contract.",
    errName: "Please enter the signer's name.",
    errAddr: "Please enter the company address.",
    errSign: "Please sign inside the box.",
    errSubmit: "Failed to sign.",
    errDownload: "Failed to download.",
  },
} as const

export default function AgencyContractPage() {
  const router = useRouter()
  const { locale: displayLocale } = useAgencyLocale()
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 契約書の言語=アカウント設定(status.locale)。読込前は表示言語で暫定表示。
  const locale: "ja" | "en" = status?.locale === "en" ? "en" : status?.locale === "ja" ? "ja" : displayLocale
  const t = messages[locale]

  const [signerName, setSignerName] = useState("")
  const [signerTitle, setSignerTitle] = useState("")
  const [companyAddress, setCompanyAddress] = useState("")
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [emailInfo, setEmailInfo] = useState<{ sent: boolean; to?: string; note?: string } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)

  // セッショントークン取得
  useEffect(() => {
    ;(async () => {
      const sb = getBrowserSupabase()
      if (!sb) {
        setError(messages[displayLocale].errAuth)
        setLoading(false)
        return
      }
      const { data } = await sb.auth.getSession()
      const tk = data.session?.access_token ?? null
      if (!tk) {
        router.replace("/agency/login?next=/agency/contract")
        return
      }
      setToken(tk)
    })()
  }, [router, displayLocale])

  const loadStatus = useCallback(
    async (tk: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/agency/contract", {
          headers: { Authorization: `Bearer ${tk}` },
          cache: "no-store",
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || messages[displayLocale].errLoad)
        setStatus(json as Status)
        // 既に住所が登録済みなら入力欄に初期表示 (再署名時など)
        if (typeof json.address === "string" && json.address) setCompanyAddress(json.address)
        if (!json.signed) {
          const pv = await fetch("/api/agency/contract?preview=1", {
            headers: { Authorization: `Bearer ${tk}` },
          })
          if (pv.ok) {
            const blob = await pv.blob()
            setPreviewUrl(URL.createObjectURL(blob))
            const ab = await blob.arrayBuffer()
            setPreviewBytes(new Uint8Array(ab))
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : messages[displayLocale].errLoad)
      } finally {
        setLoading(false)
      }
    },
    [displayLocale],
  )

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
    if (!agreed) return setError(t.errAgree)
    if (!signerName.trim()) return setError(t.errName)
    if (!companyAddress.trim()) return setError(t.errAddr)
    if (!hasInk.current) return setError(t.errSign)
    const canvas = canvasRef.current
    if (!canvas || !token) return
    const signatureImage = canvas.toDataURL("image/png")
    setSubmitting(true)
    try {
      const res = await fetch("/api/agency/contract", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ signerName: signerName.trim(), signerTitle: signerTitle.trim(), companyAddress: companyAddress.trim(), signatureImage, agreed: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t.errSubmit)
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
      setEmailInfo({ sent: !!json.emailSent, to: json.emailTo, note: json.emailNote })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errSubmit)
    } finally {
      setSubmitting(false)
    }
  }

  const downloadSigned = async () => {
    if (!token) return
    const res = await fetch("/api/agency/contract?download=1", { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return setError(t.errDownload)
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
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{t.brand}</p>
            <h1 className="text-xl font-semibold text-foreground mt-0.5">{t.pageTitle}</h1>
          </div>
          <Link href="/agency" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            {t.backToPortal}
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-20">
            <Loader2 className="w-5 h-5 animate-spin" /> {t.loading}
          </div>
        ) : alreadySigned ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center">
            <ShieldCheck className="w-10 h-10 text-emerald-600 mx-auto" strokeWidth={1.5} />
            <p className="mt-3 text-lg font-semibold text-emerald-900">{t.signedTitle}</p>
            <p className="mt-1 text-sm text-emerald-800">
              {status?.signerName ? `${t.signerPrefix}${status.signerName}　` : ""}
              {status?.signedAt
                ? new Date(status.signedAt).toLocaleString(locale === "en" ? "en-US" : "ja-JP")
                : ""}
            </p>
            {emailInfo && (
              <p className="mt-2 text-sm text-emerald-800">
                {emailInfo.sent ? t.emailSent(emailInfo.to) : t.emailPending(emailInfo.note)}
              </p>
            )}
            <button
              onClick={() => void downloadSigned()}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              <Download className="w-4 h-4" /> {t.downloadSigned}
            </button>
            <div className="mt-4">
              <Link href="/agency" className="text-sm text-emerald-800 underline">
                {t.backToPortal2}
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">{t.reviewInstruction}</p>

            {/* 契約書本文 (HTML表示 — Safari/iOS 含む全ブラウザで表示可) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-medium text-muted-foreground">{t.fullText}</p>
                {previewUrl && (
                  <div className="flex items-center gap-3">
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:opacity-70"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> {t.openPdf}
                    </a>
                    <a
                      href={previewUrl}
                      download="bondex-contract.pdf"
                      className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:opacity-70"
                    >
                      <Download className="w-3.5 h-3.5" /> {t.savePdf}
                    </a>
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3 max-h-[600px] overflow-y-auto">
                {previewBytes ? (
                  <PdfPreview
                    bytes={previewBytes}
                    fallback={<ContractHtml agencyName={status?.agencyName || ""} locale={locale} />}
                  />
                ) : (
                  <ContractHtml agencyName={status?.agencyName || ""} locale={locale} />
                )}
              </div>
            </div>

            {/* 署名フォーム */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2 text-foreground font-medium">
                <FileSignature className="w-4 h-4" /> {t.signHeading}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t.signerNameLabel}</label>
                  <input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    maxLength={60}
                    placeholder={t.signerNamePh}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t.signerTitleLabel}</label>
                  <input
                    value={signerTitle}
                    onChange={(e) => setSignerTitle(e.target.value)}
                    maxLength={60}
                    placeholder={t.signerTitlePh}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t.companyAddrLabel}</label>
                <input
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  maxLength={200}
                  placeholder={t.companyAddrPh}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-muted-foreground">{t.signatureLabel}</label>
                  <button onClick={clearCanvas} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <Eraser className="w-3.5 h-3.5" /> {t.clear}
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
                <span>{t.consent}</span>
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
                {t.submit}
              </button>
              <p className="text-[11px] text-muted-foreground text-center">{t.legalNote}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
