import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

/**
 * 郵便番号 → 住所(都道府県/市区町村/町域) の検索（運営発行画面の個人宅入力の自動補完用）。
 *
 *   GET /api/operator/postal?zip=1500001
 *
 * 認証は middleware の operator ゲート（/api/* 既定deny・本ルートは公開未登録）。
 * 代理店用 /api/agency/postal と同じ zipcloud(無料・公開・キー不要)プロキシ。
 */
const ZIPCLOUD = "https://zipcloud.ibsnet.co.jp/api/search"

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "operator-postal")
  if (!limit.ok) return limit.response

  const raw = req.nextUrl.searchParams.get("zip") ?? ""
  const zip = raw.replace(/[^\d]/g, "")
  if (!/^\d{7}$/.test(zip)) {
    return NextResponse.json({ ok: false, error: "zip must be 7 digits" }, { status: 400 })
  }

  try {
    const url = new URL(ZIPCLOUD)
    url.searchParams.set("zipcode", zip)
    const res = await fetch(url.toString(), { next: { revalidate: 86_400 } })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "lookup failed" }, { status: 502 })
    }
    const data = (await res.json()) as {
      status?: number
      results?: Array<{ address1?: string; address2?: string; address3?: string }> | null
    }
    const hit = data.results?.[0]
    if (!hit) {
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
