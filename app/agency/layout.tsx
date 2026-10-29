import type { Metadata } from "next"

// 代理店ポータル (顧客が操作する /agency/*) は EN/JP の独自トグルを持つため、
// ブラウザの自動翻訳を無効化する。ルートは lang="ja" で配信される一方、既定ロケールは英語
// (useAgencyLocale) のため、英語設定のブラウザが「日本語ページ」とみなして英語の内容を自動翻訳し、
// "Arrival date" → "None date" のようにラベルを化けさせる事故が実際に発生した (2026-10-29)。
// notranslate で翻訳自体を抑止し、lang 属性は useAgencyLocale が表示言語へ同期する。
export const metadata: Metadata = {
  other: { google: "notranslate" },
}

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  return children
}
