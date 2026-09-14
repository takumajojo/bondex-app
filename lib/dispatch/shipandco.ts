// Ship&co 配送プロバイダ (Phase A・2026-09-14)。
//
// create/route.ts に元々あった getCarrierId と、送り状発行の
// ペイロード構築 + POST /shipments + レスポンス解析を「ロジックそのまま」に移設。
// HTTPリクエスト内容・認証(x-access-token)・エラー処理・carrier_id キャッシュ・
// payload の形/キー順は一切変えていない。

import type { DispatchProvider, DispatchInput, DispatchResult } from "./types"

const SHIPANDCO_BASE = "https://api.shipandco.com/v1"
const CARRIER_CACHE_MS = 10 * 60 * 1000
const carrierIdCache = new Map<string, { id: string; at: number }>()

// Ship&co の /carriers から、指定キャリア種別の有効な carrier_id を取得。
// ヤマトは type が "yamato" または "yamato_takkyubin"、佐川は "sagawa"。
async function fetchCarrierId(token: string, carrierType: string): Promise<string | null> {
  const now = Date.now()
  const cached = carrierIdCache.get(carrierType)
  if (cached && now - cached.at < CARRIER_CACHE_MS) return cached.id
  const res = await fetch(`${SHIPANDCO_BASE}/carriers`, {
    headers: { "x-access-token": token, "Content-Type": "application/json" },
  })
  if (!res.ok) return null
  const data = (await res.json()) as Array<{ id?: string; type?: string; state?: string }>
  if (!Array.isArray(data)) return null
  const match = data.find((c) => {
    if (c.state === "disabled") return false
    if (carrierType === "yamato") return c.type === "yamato" || c.type === "yamato_takkyubin"
    return c.type === carrierType
  })
  if (!match?.id) return null
  carrierIdCache.set(carrierType, { id: match.id, at: now })
  return match.id
}

/**
 * Ship&co 送り状発行ペイロードを構築する。create/route.ts のインライン構築と
 * バイト一致させる (キー順・値・条件展開を厳密に維持)。テスト可能なよう export。
 */
export function buildShipandcoPayload(i: DispatchInput) {
  return {
    from_address: i.fromAddress,
    to_address: i.toAddress,
    setup: {
      carrier_id: i.carrierId,
      service: i.service, // 佐川=sagawa_regular / ヤマト=yamato_regular
      ref_number: i.refNumber, // BDX-XXX-LN + " 7/11着"
      shipment_date: i.shipmentDate,
      // 公式は "date" (JP国内のみ)。従来送っていた "delivery_date" と両方送り、
      // 実荷物検証後に delivery_date を削除する予定。
      ...(i.deliveryDate ? { date: i.deliveryDate, delivery_date: i.deliveryDate } : {}),
      time: i.deliveryTime,
      pack_size: i.packSize,
      pack_amount: i.suitcaseCount,
      test: !i.live, // SHIPANDCO_LIVE=true のときだけ本番(実ラベル)。既定はテスト。
    },
    products: [
      {
        name: i.productName,
        quantity: i.suitcaseCount,
        price: 5000,
        weight: 10, // kg/個
      },
    ],
  }
}

export const shipandcoDispatchProvider: DispatchProvider = {
  name: "shipandco",
  capabilities: { createPickup: true, cancelViaApi: false, changeViaApi: false, returnsLabelUrl: true },

  async getCarrierId(carrierType: string): Promise<string | null> {
    const token = process.env.SHIPANDCO_API_KEY
    if (!token) return null
    return fetchCarrierId(token, carrierType)
  },

  async postLabel(input: DispatchInput): Promise<DispatchResult> {
    const token = process.env.SHIPANDCO_API_KEY
    const payload = buildShipandcoPayload(input)
    // POC デバッグ用: payload を console に出す (Vercel の Functions ログで確認可)
    console.log("[shipandco] payload:", JSON.stringify(payload, null, 2))
    if (!token) {
      return {
        ok: false,
        status: 0,
        networkError: "SHIPANDCO_API_KEY not configured",
        trackingNumbers: [],
        labelUrl: null,
        carrier: "",
        method: "",
        estimatedDeliveryDate: "",
        id: "",
        sentPayload: payload,
      }
    }
    try {
      const res = await fetch(`${SHIPANDCO_BASE}/shipments`, {
        method: "POST",
        headers: {
          "x-access-token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })
      const text = await res.text()
      let data: unknown = null
      try {
        if (text) data = JSON.parse(text)
      } catch {
        // non-JSON
      }
      if (!res.ok) {
        const detail = data ?? text
        const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail)
        const code = /ES003001|30日以内/.test(detailStr) ? "SHIPANDCO_DATE_WINDOW" : undefined
        return {
          ok: false,
          status: res.status,
          errorCode: code,
          errorDetail: detail,
          errorDetailStr: detailStr,
          trackingNumbers: [],
          labelUrl: null,
          carrier: "",
          method: "",
          estimatedDeliveryDate: "",
          id: "",
          sentPayload: payload,
        }
      }
      const d = data as {
        id?: string
        delivery?: {
          carrier?: string
          method?: string
          tracking_numbers?: string[]
          label?: string
          estimated_delivery_date?: string
        }
      }
      return {
        ok: true,
        status: res.status,
        trackingNumbers: d.delivery?.tracking_numbers ?? [],
        labelUrl: d.delivery?.label ?? null,
        carrier: d.delivery?.carrier ?? "",
        method: d.delivery?.method ?? "",
        estimatedDeliveryDate: d.delivery?.estimated_delivery_date ?? "",
        id: d.id ?? "",
        sentPayload: payload,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ship&co network error"
      return {
        ok: false,
        status: 0,
        networkError: msg,
        trackingNumbers: [],
        labelUrl: null,
        carrier: "",
        method: "",
        estimatedDeliveryDate: "",
        id: "",
        sentPayload: payload,
      }
    }
  },
}
