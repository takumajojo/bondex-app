import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"

export const runtime = "nodejs"

/**
 * 郵便番号 → 住所(都道府県/市区町村/町域) の検索 (代理店の個人宅入力の自動補完用)。
 *
 *   GET /api/agency/postal?zip=1500001
 *   Authorization: Bearer <Supabase access token>
 *
 * zipcloud(無料・公開・キー不要)をサーバー側でプロキシする。ブラウザから直接叩くと
 * CSP(connect-src)に引っかかるため、同一オリジンのこのルート経由にする。返す住所は
 * 公開データだが、無認証の踏み台にしないよう代理店JWTとレート制限を掛ける。
 */

const ZIPCLOUD = "https://zipcloud.ibsnet.co.jp/api/search"

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "agency-postal")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const raw = req.nextUrl.searchParams.get("zip") ?? ""
  const zip = raw.replace(/[^\d]/g, "")
  if (!/^\d{7}$/.test(zip)) {
    return NextResponse.json({ ok: false, error: "zip must be 7 digits" }, { status: 400 })
  }

  try {
    const url = new URL(ZIPCLOUD)
    url.searchParams.set("zipcode", zip)
    const res = await fetch(url.toString(), {
      // 郵便番号→住所は日次で変わらないため CDN/ブラウザに1日キャッシュさせる。
      next: { revalidate: 86_400 },
    })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "lookup failed" }, { status: 502 })
    }
    const data = (await res.json()) as {
      status?: number
      results?: Array<{ address1?: string; address2?: string; address3?: string }> | null
    }
    const hit = data.results?.[0]
    if (!hit) {
      // 存在しない郵便番号 — エラーではなく「見つからない」として返す(UIは手入力継続)。
      return NextResponse.json({ ok: true, found: false })
    }
    return NextResponse.json({
      ok: true,
      found: true,
      prefecture: hit.address1 ?? "",
      city: hit.address2 ?? "",
      town: hit.address3 ?? "",
    })
  } catch {
    return NextResponse.json({ ok: false, error: "lookup error" }, { status: 502 })
  }
}
