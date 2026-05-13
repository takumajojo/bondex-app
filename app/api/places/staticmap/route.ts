import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

// Google Maps Static API のプロキシ。
// クライアントに API キーを露出させないため、サーバー側でリクエストを中継する。
// キャッシュ戦略 (Redis 等) は Phase 1 スコープ外。ブラウザ HTTP キャッシュのみに依存する。
const BASE = "https://maps.googleapis.com/maps/api/staticmap"
const API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? ""

function isFiniteLatLng(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "staticmap")
  if (!limit.ok) return limit.response

  if (!API_KEY) {
    return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY not set" }, { status: 500 })
  }

  const { searchParams } = req.nextUrl
  const lat = Number(searchParams.get("lat"))
  const lng = Number(searchParams.get("lng"))

  if (!isFiniteLatLng(lat, -90, 90) || !isFiniteLatLng(lng, -180, 180)) {
    return NextResponse.json({ error: "invalid lat/lng" }, { status: 400 })
  }

  const zoom = Math.min(20, Math.max(1, Number(searchParams.get("zoom")) || 16))
  const url = new URL(BASE)
  url.searchParams.set("center", `${lat},${lng}`)
  url.searchParams.set("zoom", String(zoom))
  url.searchParams.set("size", "600x300")
  url.searchParams.set("scale", "2")
  url.searchParams.set("markers", `color:red|${lat},${lng}`)
  url.searchParams.set("language", "ja")
  url.searchParams.set("key", API_KEY)

  const upstream = await fetch(url.toString())
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "upstream error" }, { status: 502 })
  }

  const buf = await upstream.arrayBuffer()
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      // 同一 lat/lng の再リクエストはブラウザキャッシュで吸収する。
      "Cache-Control": "public, max-age=86400",
    },
  })
}
