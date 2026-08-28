import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendOpsAlert } from "@/lib/ops-alert"
import {
  labelMailStatus,
  todayJst,
  LABEL_MAIL_LEAD_BUSINESS_DAYS,
  LABEL_TO_LABEL_JA,
  LABEL_SENDER_LABEL_JA,
  labelMailApplies,
  type LabelTo,
  type LabelSender,
} from "@/lib/label-delivery"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 送り状(紙)の郵送漏れ防止 cron。
 *
 * 送り状が旅行者の手元に届かないと、当日ホテルで荷物を出せない = 配送が丸ごと止まる。
 * 画面の「要対応」だけだと運営がダッシュボードを開かない日に落ちるため、毎朝メールでも出す。
 *
 * 判定 (lib/label-delivery.ts):
 *   投函期限 = 発送日の 5 営業日前 (土日祝を除外)
 *     期限当日          → 本日投函
 *     期限超過・発送日前 → 早急手配 (直前予約はここに入る)
 *     発送日超過        → 期限超過
 *   label_sent_at が入ったら対象外 (運営が「郵送済みにする」を押すまで鳴り続ける)。
 *
 * 認証は他の cron と同じ CRON_SECRET (GitHub Actions から Bearer で叩く)。
 */

type Row = {
  booking_id: string
  leg_index: number
  agency: string
  representative: string
  shipment_date: string
  from_hotel: string
  status: string
  label_to: string | null
  label_split: boolean | null
  label_sender: string | null
  label_sent_at: string | null
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  const header = req.headers.get("authorization") || ""
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, skipped: "supabase not configured" })
  }
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ ok: true, skipped: "supabase not configured" })

  const today = todayJst()
  // 未郵送・未キャンセルのうち、発送日が過去30日〜未来60日のものを見る。
  // (過ぎたものも「期限超過」として拾い、取りこぼしを可視化する)
  const { data, error } = await sb
    .from("shipments")
    .select(
      "booking_id, leg_index, agency, representative, shipment_date, from_hotel, status, label_to, label_split, label_sender, label_sent_at",
    )
    .is("label_sent_at", null)
    .neq("status", "cancelled")
    .order("shipment_date", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as Row[]
  const due: Array<{ row: Row; urgency: string; deadline: string | null; over: number }> = []
  for (const r of rows) {
    // 集荷済み以降は送り状が役目を果たしているので対象外
    if (!labelMailApplies(r.status)) continue
    const st = labelMailStatus({
      shipmentDate: r.shipment_date,
      sentAt: r.label_sent_at,
      today,
    })
    if (st.urgency === "due" || st.urgency === "urgent" || st.urgency === "overdue") {
      due.push({
        row: r,
        urgency: st.urgency,
        deadline: st.deadline,
        over: Math.abs(st.businessDaysLeft ?? 0),
      })
    }
  }

  if (due.length === 0) {
    return NextResponse.json({ ok: true, today, pending: 0 })
  }

  // 早急なものを先に並べる (運営が上から順に処理すれば期限の近い順になる)
  const rank: Record<string, number> = { overdue: 0, urgent: 1, due: 2 }
  due.sort((a, b) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9))

  const urgent = due.filter((d) => d.urgency !== "due").length
  const lines = due.map((d) => {
    const r = d.row
    const head =
      d.urgency === "overdue"
        ? "【期限超過】"
        : d.urgency === "urgent"
          ? `【早急手配】投函期限を${d.over}営業日超過`
          : "【本日投函】"
    const to = LABEL_TO_LABEL_JA[(r.label_to as LabelTo) || "agency"]
    const sender = LABEL_SENDER_LABEL_JA[(r.label_sender as LabelSender) || "bondex"]
    const where = r.label_to === "hotel" ? `${to}（${r.from_hotel}）` : `${to}（${r.agency}）`
    return [
      `${head} ${r.booking_id}-L${r.leg_index + 1}`,
      `  発送日 ${r.shipment_date} / 投函期限 ${d.deadline}`,
      `  送付先 ${where}${r.label_split ? "・区間ごとに分送" : ""}`,
      `  差出人 ${sender} / ご予約者 ${r.representative}`,
    ].join("\n")
  })

  const subject =
    urgent > 0
      ? `【送り状を郵送してください】早急手配 ${urgent}件 / 全${due.length}件`
      : `【送り状を郵送してください】本日投函 ${due.length}件`

  const result = await sendOpsAlert({
    subject,
    lines: [
      `投函期限は発送日の${LABEL_MAIL_LEAD_BUSINESS_DAYS}営業日前です（土日祝を除く）。`,
      "郵送したら運営ダッシュボードで「郵送済みにする」を押してください。押すまで毎朝通知されます。",
      "",
      ...lines,
    ],
    agencyEmail: null,
  })

  return NextResponse.json({
    ok: true,
    today,
    pending: due.length,
    urgent,
    notified: result,
  })
}
