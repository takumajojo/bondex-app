import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getTrackingProvider } from "@/lib/tracking"
import { fetchTrackingDiagnostic } from "@/lib/tracking/shipandco"

export const runtime = "nodejs"
export const maxDuration = 20

const NO_STORE = { "Cache-Control": "no-store" } as const

/**
 * 追跡プロバイダ(Ship&co)の生の照会結果を返す診断エンドポイント(運営専用・middleware operator ゲート配下)。
 * GET /api/operator/track-test?number=500044378105&carrier=sagawa
 *
 * 目的: 佐川の実追跡レスポンスに history[](= 集荷 collected + date 等のイベント履歴)が
 *       実際に含まれるかを、本番の実番号で即確認するため。picked_up_at に「実集荷時刻」を
 *       入れる実装(lib/tracking/reconcile.ts / cron sync-tracking)の裏付け確認に使う。
 *
 * 機密値(SHIPANDCO_API_KEY 等)は返さない。正規化済み結果 + history をそのまま返すだけ。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "track-test")
  if (!limit.ok) return limit.response

  const number = req.nextUrl.searchParams.get("number")?.trim() || ""
  const carrier = (req.nextUrl.searchParams.get("carrier")?.trim() || "sagawa").toLowerCase()
  const raw = req.nextUrl.searchParams.get("raw") === "1"
  if (!number) {
    return NextResponse.json(
      { error: "number クエリが必要です (例: ?number=500044378105&carrier=sagawa)" },
      { status: 400, headers: NO_STORE },
    )
  }

  // 診断モード (raw=1): Ship&co を 1 回だけ照会し、HTTPステータス・Content-Type・
  // キー構造・配送ステータス/日時・エラーコード(安全加工)のみ返す。
  // 通常処理 (provider.fetchOne) は呼ばない = 二重照会にならない。自動リトライなし。
  // 未加工の本文は返却せずログにも残さない (API停止/認証/回数制限/パーサー不整合の切り分け用)。
  if (raw) {
    const diag = await fetchTrackingDiagnostic(carrier, number)
    return NextResponse.json({ mode: "diagnostic", carrier, number, ...diag }, { headers: NO_STORE })
  }

  const provider = getTrackingProvider()
  const result = await provider.fetchOne(carrier, number)

  // history 由来の集荷/輸送中/配達 時刻を上位に抜き出して確認しやすくする。
  return NextResponse.json(
    {
      provider: provider.name,
      carrier,
      number,
      derived: {
        collectedAt: result.collectedAt ?? null, // 集荷(collected)の発生時刻 = picked_up_at に使う値
        inTransitAt: result.inTransitAt ?? null,
        deliveredAt: result.deliveredAt ?? null,
      },
      current: { status: result.status, rawStatus: result.rawStatus ?? null, date: result.date ?? null, exception: result.exception },
      hasHistory: Array.isArray(result.history),
      historyLength: Array.isArray(result.history) ? result.history.length : 0,
      history: result.history ?? null, // キャリアの時系列イベント(生)
      noData: result.noData,
    },
    { headers: NO_STORE },
  )
}
