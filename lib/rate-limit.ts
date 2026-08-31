/**
 * Next.js Route Handlers 用のインメモリ IP レートリミッタ。
 *
 * ── 限界の明示 (2026-08-31 監査で確認) ────────────────────────────────
 * 状態は Node プロセス内にあるため、serverless ではインスタンスごとに独立する。
 * つまり「本気の攻撃を止める」用途には使えない (それは Vercel WAF / Upstash 等の
 * 分散レートリミットの仕事)。ここでの役割は
 *   1) 未認証の書き込み系 (問い合わせ・登録) への雑なスパム抑止
 *   2) バグ由来の無限ループ呼び出しの被害限定
 * に絞る。
 *
 * ── 2026-08-31 の見直し ─────────────────────────────────────────────
 * 旧実装は全51スコープが一律 10回/分 で、正当な利用者を誤って弾いていた:
 *   - ホテル検索はデバウンス済みでも1検索で3〜8リクエスト消費
 *   - 同一オフィス NAT の複数担当者が同じ IP バケットを共有
 *   - 運営の朝のトリアージ (更新のたびに一覧再取得) が10回/分を超える
 * → スコープを4クラスに分け、認証済みの通常操作では実質引っかからない上限にする。
 *    (認証済みルートは middleware / Bearer で守られており、レート制限は防御の主役ではない)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const WINDOW_MS = 60_000

/**
 * スコープごとの1分あたり上限。
 * strict  : 未認証で外部に露出する書き込み・高コスト処理 (スパム抑止が目的)
 * search  : オートコンプリート系 (1操作で複数リクエストが正常)
 * normal  : 認証済みの読み書き (通常操作で到達しない安全弁)
 * heavy   : PDF生成・AI解析など1件が重いもの (連打の被害限定)
 */
const LIMIT_CLASS: Record<string, number> = {
  strict: 10,
  heavy: 20,
  normal: 120,
  search: 180,
}

const SCOPE_CLASS: Record<string, keyof typeof LIMIT_CLASS> = {
  // ── 未認証・外部露出 (strict) ──
  contact: "strict",
  "agency-register": "strict",
  "operator-auth": "strict",
  "operator-email-code": "strict",
  track: "strict",
  "group-share-view": "strict",
  howto: "strict",
  "demo-voucher": "strict",
  // ── 検索・オートコンプリート (search) ──
  "places-search": "search",
  "agency-places-search": "search",
  places: "search",
  "agency-postal": "search",
  staticmap: "search",
  // ── 重い処理 (heavy) ──
  "itinerary-parse": "heavy",
  "agency-itinerary-parse": "heavy",
  "analyze-luggage": "heavy",
  "photos-upload": "heavy",
  "voucher-generate": "heavy",
  "voucher-regenerate": "heavy",
  "agency-voucher-preview": "heavy",
  "contracts-generate": "heavy",
  "invoices-generate": "heavy",
  "shipandco-create": "heavy",
  "mail-test": "heavy",
  // それ以外 (認証済みの読み書き) は normal
}

function getLimit(scope: string): number {
  // 環境変数で全体を上書き可能 (負荷試験・緊急時の絞り込み用)
  const raw = process.env.RATE_LIMIT_PER_MINUTE
  const n = raw ? Number.parseInt(raw, 10) : NaN
  if (Number.isFinite(n) && n > 0) return n
  return LIMIT_CLASS[SCOPE_CLASS[scope] ?? "normal"]
}

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

/** 期限切れバケットの掃除 (旧実装は無限に増えた)。呼び出しのついでに軽く回収する。 */
let lastSweep = 0
function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return
  lastSweep = now
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k)
  }
}

export function getClientIp(req: NextRequest): string {
  // Vercel では x-real-ip が基盤付与の実クライアントIP。
  // x-forwarded-for の先頭はクライアントが自由に偽装できる (バケット新造で制限回避可能)
  // ため、x-real-ip を優先する (2026-08-31 監査対応)。
  const real = req.headers.get("x-real-ip")
  if (real) return real.trim()
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  return "unknown"
}

export type RateLimitResult =
  | { ok: true; remaining: number; limit: number; resetAt: number }
  | { ok: false; response: NextResponse }

export function rateLimit(req: NextRequest, scope: string): RateLimitResult {
  const limit = getLimit(scope)
  const ip = getClientIp(req)
  const key = `${scope}:${ip}`
  const now = Date.now()
  sweep(now)

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
      {
        error:
          "アクセスが集中しています。しばらく待ってから再度お試しください。 / Too many requests — please retry shortly.",
      },
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
