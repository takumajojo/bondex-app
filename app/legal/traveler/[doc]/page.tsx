import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { LegalMarkdown } from "@/components/b2c/legal-markdown"
import { b2cLegalDocBody, b2cLegalPath, B2C_LEGAL_DOC_KINDS, B2C_TERMS_VERSION, type B2cLegalDocKind } from "@/lib/b2c/legal"
import { b2cLegalPagesEnabled } from "@/lib/b2c/flags"

// 旅行者向けの規約のページ（B1）。弁護士の確認と公開の承認の前は B2C_LEGAL_PAGES_ENABLED が OFF で 404。
// ON にしてもローカルのレビュー用（原案の表示・検索エンジンに載せない）。本文は docs/b2c/legal/<doc>_<lang>.md。
export const metadata: Metadata = {
  title: "BondEx — Legal (travelers)",
  robots: { index: false, follow: false, nocache: true },
}
export const dynamic = "force-dynamic"

const LABEL: Record<B2cLegalDocKind, { ja: string; en: string }> = {
  terms: { ja: "利用規約", en: "Terms of Service" },
  cancellation: { ja: "キャンセル規定", en: "Cancellation Policy" },
  tokushoho: { ja: "特定商取引法に基づく表記", en: "Legal notice" },
  privacy: { ja: "プライバシーポリシー", en: "Privacy Policy" },
}

export default async function TravelerLegalPage({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<{ lang?: string }> }) {
  if (!b2cLegalPagesEnabled()) notFound()
  const { doc } = await params
  const { lang: q } = await searchParams
  if (!(B2C_LEGAL_DOC_KINDS as string[]).includes(doc)) notFound()
  const kind = doc as B2cLegalDocKind
  const lang = q === "ja" ? "ja" : "en"
  const body = b2cLegalDocBody(kind, lang)
  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <p className="text-lg font-bold tracking-tight">BondEx</p>
        <a className="rounded-full border px-3 py-1.5 text-sm font-medium" href={b2cLegalPath(kind, lang === "ja" ? "en" : "ja")}>{lang === "ja" ? "English" : "日本語"}</a>
      </header>
      <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100" data-legal-draft>
        {lang === "ja" ? `確認用の原案です（版: ${B2C_TERMS_VERSION}）。公開前のため、内容は変わります。` : `Review draft (version: ${B2C_TERMS_VERSION}). Not yet published; the content will change.`}
      </p>
      <nav className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {B2C_LEGAL_DOC_KINDS.map((k) => (
          <a key={k} href={b2cLegalPath(k, lang)} className={k === kind ? "font-semibold" : "underline underline-offset-2"} aria-current={k === kind ? "page" : undefined}>{LABEL[k][lang]}</a>
        ))}
      </nav>
      <LegalMarkdown source={body} />
    </main>
  )
}
