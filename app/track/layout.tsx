import type { Metadata } from "next"

// /track は client component のため metadata をここで定義する (トップと同じ title で索引されるのを防ぐ)。
export const metadata: Metadata = {
  title: "荷物の追跡 | BondEx（ボンデックス）",
  description: "BondEx で手配したホテル間荷物配送の配送状況を、予約番号または追跡番号で確認できます。",
  alternates: { canonical: "/track" },
  // 顧客向け画面。EN/JP を独自に持つため、ブラウザ自動翻訳によるラベル化けを防ぐ (2026-10-29)。
  other: { google: "notranslate" },
}

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return children
}
