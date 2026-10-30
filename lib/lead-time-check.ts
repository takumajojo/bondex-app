/**
 * 佐川便の「最短お届け日より前の到着日」をサーバー側で弾くための共通処理。
 *
 * 使う場所: /api/lead-time (入力中の照会) / /api/agency/booking (代理店の依頼) /
 *   /api/agency/shipment/[id] (代理店の変更) / /api/shipandco/create (発行・deferred 保存)。
 *
 * 方針 (依頼書 CLAUDE_CODE_TASK.md / data/sagawa-lead-times/README.md):
 *   - 郵便番号が取れない・佐川の日数が取れないときは「不明」= 通す (従来どおり発送翌日〜)。
 *     佐川サイトや Google の障害で予約・発行を止めないため。
 *   - ヤマト便は対象外 (このデータは佐川専用)。
 *   - 日数は暦日。佐川は土日祝・年末年始も配達する (2026-10-30 谷口さん確認)。
 * サーバー専用。
 */
import { resolveSagawaLeadTime, earliestArrivalYmd, normalizeZip7, type LeadTimeSource } from "@/lib/sagawa-lead-time"
import { resolveHotelZip } from "@/lib/hotel-place"

export interface LeadTimeEndpoint {
  /** Google Places の place_id (ホテル) */
  placeId?: string | null
  /** 郵便番号 (個人宅 / 直接指定) */
  zip?: string | null
}

export interface RouteLeadTime {
  days: number
  earliestArrival: string
  source: LeadTimeSource
  fromOffice: string | null
  toOffice: string | null
  fromZip: string
  toZip: string
}

/** 発送元/お届け先の郵便番号を解決する。郵便番号が直接あればそれを優先、無ければ placeId → Places。 */
export async function resolveEndpointZip(ep: LeadTimeEndpoint): Promise<string | null> {
  const direct = normalizeZip7(ep.zip)
  if (direct) return direct
  const placeId = (ep.placeId ?? "").trim()
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!placeId || !apiKey) return null
  return normalizeZip7(await resolveHotelZip(placeId, apiKey))
}

/** ルートの最短お届け日。不明なら null。 */
export async function routeLeadTime(
  from: LeadTimeEndpoint,
  to: LeadTimeEndpoint,
  shipmentDate: string,
): Promise<RouteLeadTime | null> {
  const [fromZip, toZip] = await Promise.all([resolveEndpointZip(from), resolveEndpointZip(to)])
  if (!fromZip || !toZip) return null
  const lt = await resolveSagawaLeadTime(fromZip, toZip).catch((err) => {
    console.error("[lead-time] resolve failed", { fromZip, toZip, err: err instanceof Error ? err.message : err })
    return null
  })
  if (!lt) return null
  const earliestArrival = earliestArrivalYmd(shipmentDate, lt.days)
  if (!earliestArrival) return null
  return { days: lt.days, earliestArrival, source: lt.source, fromOffice: lt.fromOffice, toOffice: lt.toOffice, fromZip, toZip }
}

/**
 * 佐川便で 到着日 < 最短お届け日 なら違反内容を返す。問題なし・不明・ヤマト便は null。
 * 不明のときはログだけ残す。
 */
export async function sagawaLeadTimeViolation(input: {
  carrier: string
  from: LeadTimeEndpoint
  to: LeadTimeEndpoint
  shipmentDate: string
  deliveryDate: string
  context?: string
}): Promise<RouteLeadTime | null> {
  if (input.carrier === "yamato") return null
  if (!input.shipmentDate || !input.deliveryDate) return null
  const lt = await routeLeadTime(input.from, input.to, input.shipmentDate)
  if (!lt) {
    console.warn("[lead-time] unknown — allowing (従来ルール)", {
      context: input.context,
      shipmentDate: input.shipmentDate,
      deliveryDate: input.deliveryDate,
    })
    return null
  }
  return input.deliveryDate < lt.earliestArrival ? lt : null
}
