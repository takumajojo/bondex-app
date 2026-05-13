/**
 * Minimal in-memory IP rate limiter for Next.js Route Handlers (Node.js runtime).
 *
 * NOTE: state lives in the Node process, so this only works on a single-instance
 * deploy. For multi-instance / serverless-cold-start environments, replace the
 * `buckets` map with Redis / Upstash / Vercel KV before relying on this in prod.
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const WINDOW_MS = 60_000

function getLimit(): number {
  const raw = process.env.RATE_LIMIT_PER_MINUTE
  const n = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : 10
}

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get("x-real-ip")
  if (real) return real.trim()
  return "unknown"
}

export type RateLimitResult =
  | { ok: true; remaining: number; limit: number; resetAt: number }
  | { ok: false; response: NextResponse }

export function rateLimit(req: NextRequest, scope: string): RateLimitResult {
  const limit = getLimit()
  const ip = getClientIp(req)
  const key = `${scope}:${ip}`
  const now = Date.now()

  const existing = buckets.get(key)
  const bucket: Bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + WINDOW_MS }

  bucket.count += 1
  buckets.set(key, bucket)

  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))

  if (bucket.count > limit) {
    const response = NextResponse.json(
      { error: "Too many requests" },
      { status: 429 },
    )
    response.headers.set("Retry-After", String(retryAfterSec))
    response.headers.set("X-RateLimit-Limit", String(limit))
    response.headers.set("X-RateLimit-Remaining", "0")
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)))
    return { ok: false, response }
  }

  return {
    ok: true,
    remaining: Math.max(0, limit - bucket.count),
    limit,
    resetAt: bucket.resetAt,
  }
}
