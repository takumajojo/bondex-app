import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"

export const runtime = "nodejs"

/**
 * 集荷実績レポート (2026-09-16 谷口さん)。middleware で operator 認証済み。
 *   GET /api/operator/report?agency=&from=&to=&prefecture=&status=&format=csv
 *   軸: どの代理店(agency) いつ(集荷日=picked_up_at) どこに(to_prefecture) 何個(suitcase_count)。
 *   from/to は集荷日の JST 日付(YYYY-MM-DD)。format=csv で Excel 用 CSV(BOM付) を返す。
 */

const SELECT =
  "booking_id, leg_index, agency, representative, tour_number, picked_up_at, shipment_date, from_hotel, from_prefecture, from_city, to_hotel, to_prefecture, to_city, suitcase_count, amount_yen, status, cancelled_at, cancelled_by, cancel_source"

const CANCEL_SRC_JA: Record<string, string> = { agency: "代理店", operator: "運営", system: "自動" }

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function jstDate(ts: string | null | undefined): string {
  return ts ? new Date(ts).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : ""
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "report")
  if (!limit.ok) return limit.response
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ rows: [], summary: { count: 0, pieces: 0, amount: 0 } })

  const sp = req.nextUrl.searchParams
  const agency = sp.get("agency") || ""
  const from = sp.get("from") || "" // 集荷日 from (JST日付)
  const to = sp.get("to") || ""
  const prefecture = sp.get("prefecture") || ""
  const status = (sp.get("status") as string) || ""
  const format = sp.get("format") || "json"

  let q = sb.from("shipments").select(SELECT)
  if (agency) q = q.eq("agency", agency)
  if (status) q = q.eq("status", status)
  if (prefecture) q = q.eq("to_prefecture", prefecture)
  if (from) q = q.gte("picked_up_at", `${from}T00:00:00+09:00`)
  if (to) {
    const d = new Date(`${to}T00:00:00+09:00`)
    d.setUTCDate(d.getUTCDate() + 1) // to 当日を含める
    q = q.lt("picked_up_at", d.toISOString())
  }
  q = q.order("picked_up_at", { ascending: false, nullsFirst: false }).limit(5000)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: error.message, rows: [], summary: { count: 0, pieces: 0, amount: 0 } }, { status: 500 })
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const pieces = rows.reduce((s, r) => s + (Number(r.suitcase_count) || 0), 0)
  const amount = rows.reduce((s, r) => s + (Number(r.amount_yen) || 0), 0)
  const summary = { count: rows.length, pieces, amount }

  if (format === "csv") {
    const header = [
      "予約番号", "代理店", "代表者", "ツアー番号", "集荷日", "発送日",
      "発送元ホテル", "発送元都道府県", "発送元市区",
      "お届け先ホテル", "お届け先都道府県", "お届け先市区",
      "個数", "金額", "ステータス",
      "取消経路", "取消実行者", "取消日時",
    ]
    const lines = [header.join(",")]
    for (const r of rows) {
      lines.push(
        [
          `${r.booking_id}-L${(Number(r.leg_index) || 0) + 1}`,
          r.agency, r.representative, r.tour_number,
          jstDate(r.picked_up_at as string | null), r.shipment_date,
          r.from_hotel, r.from_prefecture, r.from_city,
          r.to_hotel, r.to_prefecture, r.to_city,
          r.suitcase_count, r.amount_yen, r.status,
          r.cancel_source ? (CANCEL_SRC_JA[String(r.cancel_source)] ?? r.cancel_source) : "",
          r.cancelled_by ?? "",
          r.cancelled_at ? new Date(r.cancelled_at as string).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "",
        ].map(csvCell).join(","),
      )
    }
    const csv = "﻿" + lines.join("\r\n") // BOM + CRLF で Excel が文字化けしない
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bondex-report-${today}.csv"`,
      },
    })
  }

  return NextResponse.json({ rows, summary })
}
