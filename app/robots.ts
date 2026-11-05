import type { MetadataRoute } from "next"

const BASE_URL = "https://bondex.express"

/**
 * robots.txt (App Router 生成)。
 * 公開 LP・法務ページのみクロール許可。運用系 (/operator /agency)、
 * API、個別の追跡ページ (/track/BDX-...) はクロール対象外にする。
 */
export default function robots(): MetadataRoute.Robots {
  // 試験環境（BONDEX_ENV=staging）は全体をクロール対象外にする（next.config.mjs の X-Robots-Tag と合わせて二重に）
  if (process.env.BONDEX_ENV === "staging") return { rules: { userAgent: "*", disallow: "/" } }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/operator", "/agency", "/api/", "/track/", "/book/", "/my/"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
