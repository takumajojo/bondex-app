import type { MetadataRoute } from "next"

const BASE_URL = "https://bondex.express"

/**
 * sitemap.xml (App Router 生成)。公開ページのみ列挙する。
 * /track 索引は入口として載せるが、個別追跡ページ (/track/BDX-...) は
 * インデックス不要なので含めない。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const pages: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" },
    { path: "/track", priority: 0.5, changeFrequency: "monthly" },
    { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" },
    { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" },
    { path: "/legal/commercial-transactions", priority: 0.3, changeFrequency: "yearly" },
  ]
  return pages.map((p) => ({
    url: `${BASE_URL}${p.path}`,
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }))
}
