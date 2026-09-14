// Ship&co 追跡プロバイダ (Phase A・2026-09-14)。
//
// 中身は app/api/cron/sync-tracking/route.ts に元々あった純粋関数
// (mapTrackingStatus / detectException / trackingCarrierPath / fetchTracking) と
// レスポンス型を「ロジックそのままに」移設したもの。HTTPリクエスト内容・認証
// (x-access-token)・タイムアウト(10s)・エラー時の挙動は一切変えていない。

import type { ShipmentStatus } from "@/lib/shipments-db"
import type { TrackingProvider, TrackingResult } from "./types"

const SHIPANDCO_BASE = "https://api.shipandco.com/v1"
const SHIPANDCO_TIMEOUT_MS = 10_000

/**
 * 異常系ステータスの検知。ヤマト公式 FAQ (a_id/3887) の語彙 + 想定される
 * 英語正規化の両方をカバーする。検知したら status は進めず、BondEx と
 * ランドオペレーターへアラートを送る (自動で failed 等にはしない —
 * 最終判断は人間に委ねる)。
 */
const EXCEPTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /遅延|delay/i, label: "遅延中 (delayed)" },
  { pattern: /調査|investigat/i, label: "調査中 (under investigation)" },
  { pattern: /持戻|bring.?back|attempt.*fail|absence/i, label: "持戻 (delivery attempted / brought back)" },
  { pattern: /返品|return/i, label: "返品 (being returned)" },
  { pattern: /経路修正|reroute|misroute|wrong.?route/i, label: "輸送経路修正 (rerouted)" },
  { pattern: /伝票番号誤り|伝票番号未登録|not.?found|invalid.*number|unregistered/i, label: "伝票番号エラー (tracking number issue)" },
  { pattern: /exception|hold.*exception|failed/i, label: "exception (carrier-reported problem)" },
]

export function detectException(raw: string): string | null {
  for (const { pattern, label } of EXCEPTION_PATTERNS) {
    if (pattern.test(raw)) return label
  }
  return null
}

/**
 * Ship&co の current_status.status を BondEx の ShipmentStatus に対応付ける。
 * 判定順序が重要:
 *   1. 異常系 (呼び出し元で detectException を先に評価すること)
 *   2. 「配達完了」系 — ただし "out for delivery" (配達中) が "deliver" を含むため、
 *      配達中系を先に判定する
 *   3. 配達中・輸送中系
 *   4. 集荷・発送済み系
 * マッチしなければ null (= unmapped)。
 */
export function mapTrackingStatus(raw: string): ShipmentStatus | null {
  const s = raw.toLowerCase()

  // -- 配達中 (out for delivery) を「完了」より先に判定する --
  if (
    s.includes("out_for_delivery") ||
    s.includes("out for delivery") ||
    s.includes("配達中") ||
    s.includes("持ち出し")
  ) {
    return "in_transit"
  }

  // -- 配達完了系 --
  if (s.includes("配達完了") || /deliver/.test(s)) return "delivered"

  // -- 輸送中系 --
  if (
    s.includes("transit") ||
    s.includes("輸送中") ||
    s.includes("作業店通過") ||
    s.includes("配達店到着") ||
    s.includes("配達準備") ||
    s.includes("転送") ||
    s.includes("保管") ||
    s.includes("hold") ||
    s.includes("stored")
  ) {
    return "in_transit"
  }

  // -- 集荷・発送済み系 --
  //   佐川語彙: 集荷 (Ship&co は佐川の集荷を英語 "collected" で返す)。
  if (
    s.includes("picked_up") ||
    s.includes("picked up") ||
    s.includes("pickup_complete") ||
    s.includes("collected") ||
    s.includes("集荷") ||
    s.includes("荷物受付") ||
    s.includes("発送済")
  ) {
    return "picked_up"
  }

  return null
}

interface TrackingCurrentStatus {
  date?: string
  status?: string
  details?: string[]
  location?: string
}

interface TrackingResponse {
  current_status?: TrackingCurrentStatus
}

// Ship&co 追跡 API は GET /v1/tracking/:carrier/:trackingNumber。
// キャリア識別子は shipments.carrier ('sagawa' / 'yamato') をそのまま使う。既定は佐川。
export function trackingCarrierPath(carrier: string | null | undefined): "sagawa" | "yamato" {
  return carrier === "yamato" ? "yamato" : "sagawa"
}

/**
 * 1件の Ship&co 呼び出しがハングすると batch 全体が maxDuration までブロックされる
 * ため、個別に AbortController でタイムアウトを切る。carrier で照会先を切替。
 */
async function fetchTracking(
  token: string,
  carrier: "sagawa" | "yamato",
  trackingNumber: string,
): Promise<TrackingResponse | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SHIPANDCO_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${SHIPANDCO_BASE}/tracking/${carrier}/${encodeURIComponent(trackingNumber)}`,
      {
        headers: { "x-access-token": token, "Content-Type": "application/json" },
        signal: controller.signal,
      },
    )
    if (!res.ok) {
      console.error(
        `[cron/sync-tracking] Ship&co tracking HTTP ${res.status} for ${carrier}/${trackingNumber}`,
      )
      return null
    }
    return (await res.json()) as TrackingResponse
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[cron/sync-tracking] Ship&co call failed for ${carrier}/${trackingNumber}: ${reason}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const shipandcoTrackingProvider: TrackingProvider = {
  name: "shipandco",
  async fetchOne(carrier, trackingNumber): Promise<TrackingResult> {
    const token = process.env.SHIPANDCO_API_KEY
    // 認証情報が無い場合は防御的に noData (cron 側が事前に 503 ガードする)。
    if (!token) {
      return { number: trackingNumber, noData: true, status: null, exception: null }
    }
    const path = trackingCarrierPath(carrier)
    const tracking = await fetchTracking(token, path, trackingNumber)
    const current = tracking?.current_status
    const rawStatus = current?.status
    // 現況が取れない = 従来 cron の「!rawStatus」分岐と同じ扱い (location/date は使わない)。
    if (!rawStatus) {
      return { number: trackingNumber, noData: true, status: null, exception: null }
    }
    // 従来 cron と同順序: まず異常系、異常でなければステータス正規化。
    const exception = detectException(rawStatus)
    const status = exception ? null : mapTrackingStatus(rawStatus)
    return {
      number: trackingNumber,
      noData: false,
      rawStatus,
      status,
      exception,
      location: current?.location,
      date: current?.date,
    }
  },
}
