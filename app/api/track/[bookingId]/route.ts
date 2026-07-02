import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"

export const runtime = "nodejs"

/**
 * 公開トラッキング API (認証なし).
 * URL の booking_id が知っている = 旅行者が voucher を持っている前提.
 *
 * GET /api/track/{bookingId}
 *
 * セキュリティ: 個人情報の最小開示 — 名前は姓のみ、ホテル名と日付・ステータス・追跡番号のみ.
 */

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ bookingId: string }> },
) {
  const limit = rateLimit(req, "track")
  if (!limit.ok) return limit.response

  const { bookingId } = await ctx.params
  const trimmed = (bookingId || "").trim()
  if (!/^BDX-[\dA-Z]+-[\dA-Z]+$/i.test(trimmed)) {
    return NextResponse.json({ error: "Invalid booking ID" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) {
    return NextResponse.json({ error: "Tracking unavailable" }, { status: 503 })
  }

  const { data, error } = await sb
    .from("shipments")
    .select(
      "booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, recipient, status, yamato_tracking, yamato_tracking_detail, created_at, updated_at",
    )
    .eq("booking_id", trimmed)
    .order("leg_index", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // 姓のみに匿名化 ("Mr. Jack Costanzo" → "Mr. Costanzo")
  const anonymize = (name: string): string => {
    const noTitle = name.replace(/^(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s+/i, "")
    const lastName = noTitle.split(/\s+/).pop() || ""
    const title = name.match(/^(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)/i)?.[0] ?? ""
    return (title ? `${title} ${lastName}` : lastName).trim()
  }

  interface TrackingDetailRow {
    number: string
    status?: string | null
    rawStatus?: string
    location?: string
    date?: string
    checkedAt: string
  }

  return NextResponse.json({
    bookingId: trimmed,
    legs: data.map((s) => {
      // yamato_tracking (番号だけの配列) を正としつつ、cron が書き込んだ
      // yamato_tracking_detail (番号ごとの現在地・ステータス) があれば番号単位でマージする。
      // detail は「Ship&co から一度でも応答があった番号」だけなので、cron 未実行 /
      // 応答なしの番号は number 以外 undefined のまま返す (UI 側で「未取得」表示にする).
      const detailByNumber = new Map<string, TrackingDetailRow>(
        ((s.yamato_tracking_detail as TrackingDetailRow[] | null) ?? []).map((d) => [
          d.number,
          d,
        ]),
      )
      const tracking = ((s.yamato_tracking as string[] | null) ?? []).map((num) => {
        const d = detailByNumber.get(num)
        return {
          number: num,
          status: d?.status ?? null,
          location: d?.location ?? null,
          date: d?.date ?? null,
          checkedAt: d?.checkedAt ?? null,
        }
      })

      return {
        legIndex: s.leg_index,
        shipmentDate: s.shipment_date,
        expectedArrival: s.expected_arrival,
        fromHotel: s.from_hotel,
        toHotel: s.to_hotel,
        recipient: anonymize(s.recipient || ""),
        status: s.status,
        tracking,
        updatedAt: s.updated_at,
      }
    }),
  })
}
