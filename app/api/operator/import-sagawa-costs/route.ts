import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 佐川の運賃照会CSV（実支払い）を取り込み、区間ごとの実原価(sagawa_cost_actual_yen)を保存する
 * (BondEx 運用のみ・middleware で認証済み。2026-10-21 谷口さん)。
 *
 * CSV の「お客様管理番号」(例 BDXYRWAEDL1) を予約番号+区間(BDX-YRWAED / L1=leg0)に突合し、
 * 「合計」(最終列・税抜) を実原価として入れる。
 *
 * body: { csv: string }  ← クライアントで読んだCSVテキスト(文字コードは問わない。ASCIIの
 *   管理番号・金額のみ使うため、日本語列が文字化けしていても合計・突合に影響しない)。
 */

const REF_RE = /^BDX([0-9A-Z]{6})L(\d+)$/i

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })

  const body = (await req.json().catch(() => ({}))) as { csv?: string }
  const csv = typeof body.csv === "string" ? body.csv : ""
  if (!csv.trim()) return NextResponse.json({ error: "csv is required" }, { status: 400 })

  const lines = csv.split(/\r\n|\r|\n/)
  type Parsed = { bookingId: string; legIndex: number; yen: number; ref: string }
  const parsed: Parsed[] = []
  const unparseable: string[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const f = line.split(",")
    if (f.length < 6) continue
    const ref = (f[4] ?? "").trim().toUpperCase()
    const m = REF_RE.exec(ref)
    if (!m) continue // ヘッダ行・対象外行はスキップ
    // 合計 = 最終の数値列。末尾から最初に数値として読める列を採る。
    let yen = NaN
    for (let i = f.length - 1; i >= 5; i--) {
      const n = Number((f[i] ?? "").trim())
      if (Number.isFinite(n) && n > 0) {
        yen = Math.round(n)
        break
      }
    }
    if (!Number.isFinite(yen)) {
      unparseable.push(ref)
      continue
    }
    parsed.push({ bookingId: `BDX-${m[1].toUpperCase()}`, legIndex: Number(m[2]) - 1, yen, ref })
  }

  let updated = 0
  const notFound: string[] = []
  for (const p of parsed) {
    const upd = await sb
      .from("shipments")
      .update({ sagawa_cost_actual_yen: p.yen })
      .eq("booking_id", p.bookingId)
      .eq("leg_index", p.legIndex)
      .select("id")
    if (upd.error) {
      return NextResponse.json({ error: upd.error.message, updated }, { status: 500 })
    }
    if ((upd.data ?? []).length > 0) updated += 1
    else notFound.push(p.ref)
  }

  return NextResponse.json({
    ok: true,
    rowsParsed: parsed.length,
    updated,
    notFound, // 突合できなかった管理番号 (このシステムに無い予約)
    unparseable, // 金額が読めなかった行
  })
}
