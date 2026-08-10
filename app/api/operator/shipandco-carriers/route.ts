import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

/**
 * Ship&co に接続済みの配送業者アカウント一覧を返す (読み取り専用・診断用)。
 *
 *   GET /api/operator/shipandco-carriers
 *
 * middleware の OPERATOR_PASSWORD ゲート対象 (公開許可リストに無いので default-deny)。
 * 送り状は発行しない=集荷も課金も発生しない。本番化 (SHIPANDCO_LIVE=true) の前に
 * 「佐川が接続済み・有効か」を運営ダッシュボードから確認するために使う。
 *
 * 注: Ship&co はテスト/本番を配送業者アカウント単位ではなく、発行リクエストの test フラグで
 * 切り替える。つまり接続された佐川アカウントは実契約であり、test=false で実ラベルになる。
 */

const SHIPANDCO_BASE = "https://api.shipandco.com/v1"

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "operator-shipandco-carriers")
  if (!limit.ok) return limit.response

  const token = process.env.SHIPANDCO_API_KEY
  if (!token) {
    return NextResponse.json({ ok: false, error: "SHIPANDCO_API_KEY not configured" }, { status: 500 })
  }

  try {
    const res = await fetch(`${SHIPANDCO_BASE}/carriers`, {
      headers: { "x-access-token": token, "Content-Type": "application/json" },
      cache: "no-store",
    })
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Ship&co /carriers returned ${res.status}` },
        { status: 502 },
      )
    }
    const raw = (await res.json()) as unknown
    const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
    // 表示に必要な項目だけ抜き出す (未知フィールドも保持して test/mode 等の手掛かりを残す)。
    const carriers = list.map((c) => ({
      id: typeof c.id === "string" ? c.id : "",
      type: typeof c.type === "string" ? c.type : "",
      name: typeof c.name === "string" ? c.name : "",
      state: typeof c.state === "string" ? c.state : "",
      // Ship&co が返す可能性のあるモード系フィールド (存在すれば表示)。
      raw: c,
    }))
    // 本番発行スイッチの現在値も併せて返す (SHIPANDCO_LIVE)。
    const liveSwitch = process.env.SHIPANDCO_LIVE === "true"
    return NextResponse.json({
      ok: true,
      liveSwitch, // true=実ラベル / false=テスト(SAMPLE透かし)
      carriers,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "lookup failed" },
      { status: 502 },
    )
  }
}
