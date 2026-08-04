import { NextRequest, NextResponse } from "next/server"
import { isSupabaseConfigured } from "@/lib/supabase"
import { listIssueDue } from "@/lib/shipments-db"
import { sendOpsAlert } from "@/lib/ops-alert"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 発行漏れ防止のデイリーダイジェスト。
 *
 * 背景: 発送が 1ヶ月超先の予約は status='requested'/'pending' のまま登録され、
 *       「1ヶ月前になったら発行する」想定だが、それを自動で行う仕組みが無かった。
 *       放置すると手荷物が発行されず出荷されない事故になる (最重要の穴)。
 *
 * この cron は毎朝、発送日が今日〜30日先で、まだ発行 (issued 以降) されていない
 * 区間を集めて BondEx 運用へ1通のダイジェストで通知する。運用はこれを見て
 * /operator から発行する。**自動でヤマト送り状は発行しない**(誤発行・従量課金を避け、
 * 人間の確認を挟む安全側の設計)。将来、完全自動発行に格上げできる。
 *
 * 発送日を過ぎた分は cron/sync-tracking の「集荷漏れアラート」が別途拾う。
 * 認証は sync-tracking と同じ CRON_SECRET (GitHub Actions から Bearer で叩く)。
 */

const HORIZON_DAYS = 30

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }

  // JST 基準で今日と 30日先を求める
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000)
  const todayJst = nowJst.toISOString().slice(0, 10)
  const horizonJst = new Date(nowJst.getTime() + HORIZON_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const due = await listIssueDue(todayJst, horizonJst)

  if (due.length === 0) {
    return NextResponse.json({ due: 0, notified: false, today: todayJst, horizon: horizonJst })
  }

  // 予約 (booking_id) 単位でまとめて読みやすく
  const byBooking = new Map<string, typeof due>()
  for (const s of due) {
    const arr = byBooking.get(s.booking_id) ?? []
    arr.push(s)
    byBooking.set(s.booking_id, arr)
  }

  const lines: string[] = [
    `発行がまだの予約が ${due.length} 区間あります (発送日が今日〜${HORIZON_DAYS}日先・発行窓に入っています)。`,
    `/operator から発行してください。放置すると手荷物が出荷されません。`,
    "",
  ]
  for (const [bookingId, legs] of byBooking) {
    const first = legs[0]
    lines.push(
      `■ ${bookingId} (${first.agency} / ${first.representative}) — ${legs.length}区間`,
    )
    for (const s of legs) {
      lines.push(
        `   ・L${s.leg_index + 1} 発送 ${s.shipment_date}｜${s.from_hotel} → ${s.to_hotel}｜${s.suitcase_count}個｜状態: ${s.status}`,
      )
    }
  }
  lines.push("", "ダッシュボード: https://bondex.express/operator/dashboard")

  const result = await sendOpsAlert({
    subject: `【発行してください】未発行の予約 ${due.length}区間（発送30日以内）`,
    lines,
    // 発行は BondEx 側の作業なので運用のみ (代理店には送らない)
    agencyEmail: null,
  })

  return NextResponse.json({
    due: due.length,
    bookings: byBooking.size,
    notified: result.emailSent || result.slackSent,
    today: todayJst,
    horizon: horizonJst,
    errors: result.errors,
  })
}
