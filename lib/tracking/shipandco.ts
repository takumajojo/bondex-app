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

interface TrackingHistoryEvent {
  date?: string | null
  status?: string
  details?: string[]
  location?: string
}

interface TrackingResponse {
  current_status?: TrackingCurrentStatus
  // Ship&co は時系列順(古い→新しい)の全追跡イベントを history で返す。
  // 各要素の status を正規化して、集荷/輸送中/配達完了の「実発生時刻」を取り出す。
  history?: TrackingHistoryEvent[]
}

/**
 * history[] から集荷/輸送中/配達完了の発生時刻を取り出す。
 * history は時系列順(古い→新しい)なので、集荷・輸送中は最初の該当、配達完了も最初の該当を採る。
 * 各イベントの status は current_status と同じ語彙なので mapTrackingStatus で正規化する
 * (異常系は detectException でスキップ = 前進イベントに数えない)。date が無い(null)要素は無視。
 */
function deriveEventTimes(
  history: TrackingHistoryEvent[] | undefined,
): { collectedAt?: string; inTransitAt?: string; deliveredAt?: string } {
  if (!Array.isArray(history)) return {}
  let collectedAt: string | undefined
  let inTransitAt: string | undefined
  let deliveredAt: string | undefined
  for (const ev of history) {
    const raw = ev?.status
    const date = ev?.date
    if (!raw || !date) continue
    if (detectException(raw)) continue
    const st = mapTrackingStatus(raw)
    if (st === "picked_up" && !collectedAt) collectedAt = date
    else if (st === "in_transit" && !inTransitAt) inTransitAt = date
    else if (st === "delivered" && !deliveredAt) deliveredAt = date
  }
  return { collectedAt, inTransitAt, deliveredAt }
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
): Promise<{ data: TrackingResponse | null; rateLimited: boolean; errorCode?: string }> {
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
      // 429 = 追跡番号あたり15回上限(TRACKING_LIMIT_EXCEEDED)。noData と区別して呼び出し側へ伝える
      // (この番号は以降 自動照会から外し、別一覧で手動確認する)。本文はコードのみ拾い、生本文は保持しない。
      if (res.status === 429) {
        let errorCode: string | undefined
        try {
          const b = (await res.json()) as { code?: string } | null
          if (b && typeof b.code === "string") errorCode = b.code
        } catch {
          /* 本文が JSON でなくても 429 の事実は変わらない */
        }
        console.error(`[sync-tracking] Ship&co 429 rate limit for ${carrier}/${trackingNumber}`)
        return { data: null, rateLimited: true, errorCode: errorCode ?? "TRACKING_LIMIT_EXCEEDED" }
      }
      console.error(
        `[cron/sync-tracking] Ship&co tracking HTTP ${res.status} for ${carrier}/${trackingNumber}`,
      )
      return { data: null, rateLimited: false }
    }
    return { data: (await res.json()) as TrackingResponse, rateLimited: false }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[cron/sync-tracking] Ship&co call failed for ${carrier}/${trackingNumber}: ${reason}`)
    return { data: null, rateLimited: false }
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
    const { data: tracking, rateLimited, errorCode } = await fetchTracking(token, path, trackingNumber)
    // 15回上限(429)は noData と区別する。最後に正常取得したステータスの保持は、呼び出し側(DB)が
    // tracking_detail を上書きしないことで行う。ここでは rateLimited を伝えるだけ。
    if (rateLimited) {
      return {
        number: trackingNumber,
        noData: true,
        rateLimited: true,
        errorCode: errorCode ?? "TRACKING_LIMIT_EXCEEDED",
        status: null,
        exception: null,
      }
    }
    const history = Array.isArray(tracking?.history) ? tracking!.history : undefined
    const derived = deriveEventTimes(history)
    const current = tracking?.current_status
    const rawStatus = current?.status
    // 現況が取れない = 従来 cron の「!rawStatus」分岐と同じ扱い (location/date は使わない)。
    // ※ history は current_status が無くても診断用に返す (集荷時刻の確認に使えるように)。
    if (!rawStatus) {
      return { number: trackingNumber, noData: true, status: null, exception: null, ...derived, history }
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
      ...derived,
      history,
    }
  },
}

// ────────────────────────────────────────────────────────────────────────────
// 診断専用（track-test?raw=1 からのみ使用）。
// noData に畳み込む前の「Ship&co の実応答」を切り分けるために、HTTP ステータス・
// Content-Type・レスポンスのキー構造・配送ステータス/日時・エラーコード(安全加工)
// だけを返す。未加工の本文は返さず、ログにも残さない。自動リトライはしない。
// 呼び出しは 1 回だけ（通常の fetchOne とは別経路なので二重照会にならない）。
// ────────────────────────────────────────────────────────────────────────────
export interface TrackingDiagnostic {
  httpStatus: number | null
  ok: boolean
  contentType: string | null
  /** レスポンスのキー名のみ（値は含めない）。現行パーサーとの整合確認用。 */
  keyStructure: { top: string[]; current_status: string[]; historyItem: string[] } | null
  /** 配送ステータス（current_status.status の生値）と日時。配送情報に限定。 */
  deliveryStatus: string | null
  deliveryDate: string | null
  /** history の各イベントのステータスと日時のみ（氏名/住所/location は含めない）。 */
  historyStatuses: Array<{ status: string | null; date: string | null }> | null
  historyLength: number
  /** エラー時のコードと、安全に加工した短いメッセージ（個人情報・長い数字列を除去）。 */
  errorCode: string | null
  safeMessage: string | null
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)
const keysOf = (v: unknown): string[] => (isObj(v) ? Object.keys(v) : [])

/** エラーメッセージの安全加工: 制御文字除去・長い数字列(電話/郵便/番号)伏せ・ASCII印字のみ・120字。 */
function sanitizeMessage(s: string): string {
  return s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\d{6,}/g, "***")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 120)
}

export async function fetchTrackingDiagnostic(
  carrier: string | null | undefined,
  trackingNumber: string,
): Promise<TrackingDiagnostic> {
  const empty: TrackingDiagnostic = {
    httpStatus: null, ok: false, contentType: null, keyStructure: null,
    deliveryStatus: null, deliveryDate: null, historyStatuses: null,
    historyLength: 0, errorCode: null, safeMessage: null,
  }
  const token = process.env.SHIPANDCO_API_KEY
  if (!token) return { ...empty, safeMessage: "SHIPANDCO_API_KEY not configured" }

  const path = trackingCarrierPath(carrier)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SHIPANDCO_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${SHIPANDCO_BASE}/tracking/${path}/${encodeURIComponent(trackingNumber)}`,
      { headers: { "x-access-token": token, "Content-Type": "application/json" }, signal: controller.signal },
    )
    const contentType = res.headers.get("content-type")
    // 本文はキー構造・配送ステータス抽出のためだけに読む。生のまま返す/ログ保存はしない。
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }

    const obj = isObj(parsed) ? parsed : {}
    const current = isObj(obj.current_status) ? obj.current_status : undefined
    const history = Array.isArray(obj.history) ? obj.history : undefined
    const firstHistory = history && isObj(history[0]) ? history[0] : undefined

    const keyStructure =
      parsed != null
        ? { top: keysOf(parsed), current_status: keysOf(current), historyItem: keysOf(firstHistory) }
        : null

    const deliveryStatus = current && typeof current.status === "string" ? current.status : null
    const deliveryDate = current && typeof current.date === "string" ? current.date : null
    const historyStatuses = history
      ? history.map((e) => {
          const ev = isObj(e) ? e : {}
          return {
            status: typeof ev.status === "string" ? ev.status : null,
            date: typeof ev.date === "string" ? ev.date : null,
          }
        })
      : null

    let errorCode: string | null = null
    let safeMessage: string | null = null
    if (!res.ok) {
      errorCode =
        isObj(obj.error) && typeof obj.error.code === "string"
          ? obj.error.code
          : typeof obj.code === "string"
            ? obj.code
            : null
      const rawMsg =
        isObj(obj.error) && typeof obj.error.message === "string"
          ? obj.error.message
          : typeof obj.message === "string"
            ? obj.message
            : null
      safeMessage = rawMsg ? sanitizeMessage(rawMsg) : `HTTP ${res.status}`
    }

    return {
      httpStatus: res.status,
      ok: res.ok,
      contentType,
      keyStructure,
      deliveryStatus,
      deliveryDate,
      historyStatuses,
      historyLength: history ? history.length : 0,
      errorCode,
      safeMessage,
    }
  } catch (err) {
    // タイムアウト/ネットワーク障害。本文なし。理由は型名のみ（個人情報を含めない）。
    const name = err instanceof Error ? err.name : "Error"
    return { ...empty, safeMessage: name === "AbortError" ? "timeout (10s)" : "network error" }
  } finally {
    clearTimeout(timer)
  }
}
