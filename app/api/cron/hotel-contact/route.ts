import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { isSupabaseConfigured } from "@/lib/supabase"
import { sendOpsAlert, opsAlertConfigured } from "@/lib/ops-alert"
import { listHotelContactDue } from "@/lib/shipments-db"
import { HOTEL_CONTACT_LEAD_BUSINESS_DAYS } from "@/lib/hotel-notification"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * ホテル連絡の漏れ防止 cron (2026-09-01 谷口さん指示)。
 *
 * お届け先ホテルに「荷物が届く」ことを事前に伝えないと、ホテルが受け入れられず
 * 配送が止まる。発送元ホテルも集荷前に伝える必要がある。
 * 期限 = 発送日の2営業日前 (土日祝を除く)。運営が「連絡済み」を押すまで毎朝鳴る。
 * 認証は他 cron と同じ CRON_SECRET。
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const lock = await acquireCronLock("hotel-contact")
  if (!lock.ok) return NextResponse.json({ ok: true, skipped: "already running" })
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: true, skipped: "supabase not configured" })
    }
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10) // JST
    const due = await listHotelContactDue(today)
    if (due.length === 0) {
      return NextResponse.json({ ok: true, today, pending: 0 })
    }

    const ROUTE_JA = { pickup: "発送元ホテル", guest: "お届け先ホテル" } as const
    const rank: Record<string, number> = { overdue: 0, urgent: 1, due: 2 }
    // 連絡タスク単位に展開して緊急順に並べる
    const tasks = due
      .flatMap((r) => r.routes.map((x) => ({ r, x })))
      .sort((a, b) => (rank[a.x.urgency] ?? 9) - (rank[b.x.urgency] ?? 9))
    const urgent = tasks.filter((t) => t.x.urgency !== "due").length

    const lines = tasks.map(({ r, x }) => {
      const head =
        x.urgency === "overdue"
          ? "【期限超過】"
          : x.urgency === "urgent"
            ? "【至急連絡】"
            : "【本日連絡】"
      return [
        `${head} ${r.booking_id}-L${r.leg_index + 1} — ${ROUTE_JA[x.route]}`,
        `  連絡先 ${x.hotel}`,
        `  発送日 ${r.shipment_date} / 連絡期限 ${x.deadline}`,
        `  ご予約者 ${r.representative} / 代理店 ${r.agency}`,
      ].join("\n")
    })

    const subject =
      urgent > 0
        ? `【ホテルへ連絡してください】至急 ${urgent}件 / 全${tasks.length}件`
        : `【ホテルへ連絡してください】本日 ${tasks.length}件`

    if (!opsAlertConfigured()) {
      return NextResponse.json(
        { error: "alert channel not configured but there are hotel contacts due", pending: tasks.length },
        { status: 503 },
      )
    }
    const result = await sendOpsAlert({
      subject,
      lines: [
        `ホテルへの連絡期限は発送日の${HOTEL_CONTACT_LEAD_BUSINESS_DAYS}営業日前です（土日祝を除く）。`,
        "連絡したら運営ダッシュボードで「連絡済み」を押してください。押すまで毎朝通知されます。",
        "",
        ...lines,
      ],
      agencyEmail: null,
    })
    return NextResponse.json({ ok: true, today, pending: tasks.length, urgent, notified: result })
  } finally {
    await releaseCronLock("hotel-contact")
  }
}
