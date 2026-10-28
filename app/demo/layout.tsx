import type { Metadata } from "next"

// /demo はバウチャー生成のお試しツール。検索結果にトップと同じ説明文で並ぶ価値はないため noindex。
export const metadata: Metadata = {
  title: "バウチャー発行デモ | BondEx",
  description: "BondEx が発行する旅行者用バウチャーを、架空のデータでその場で生成して確認できるデモです。",
  robots: { index: false, follow: true },
  alternates: { canonical: "/demo" },
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
