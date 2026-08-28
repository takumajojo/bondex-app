import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { listIssueDue, type ShipmentRecord } from "@/lib/shipments-db"
import { sendOpsAlert } from "@/lib/ops-alert"
import { sendMail } from "@/lib/mailer"

export const runtime = "nodejs"
export const maxDuration = 300 // 複数区間の Ship&co 発行 + Drive 格納で時間がかかる

/**
 * 発行漏れ防止 cron。発送日が今日〜30日先で、まだ発行 (issued 以降) されていない
 * 区間 (status='requested'/'pending') を対象にする。
 *
 * ── 2モード (docs/issuance-rules.md) ─────────────────────────────
 *  1) 既定 (AUTO_ISSUE_ENABLED != "true"): 運用へ「発行してください」ダイジェスト通知のみ。
 *  2) 自動発行 (AUTO_ISSUE_ENABLED == "true" かつ OPERATOR_PASSWORD あり):
 *     発送30日前に入った区間の送り状を **自動発行** し、成功したら書類一式を Drive へ格納、
 *     代理店へ「送り状を発行しました」メールを送る。
 *
 * ── 安全設計 ────────────────────────────────────────────────────
 *  - フラグ AUTO_ISSUE_ENABLED を立てるまで自動発行しない (Ship&co 従量課金の暴発防止)。
 *  - 発行は運営と同じ /api/shipandco/create を OPERATOR_PASSWORD で呼ぶ。
 *  - 冪等: 発行済み区間は listIssueDue の対象外 + shipandco/create が既存ラベルを返す
 *    (二重課金なし)。発行後 status=issued になり翌日以降スキップ。
 *  - 30日超の区間は shipandco/create 側で deferred になり発行しない (窓外は自動保留)。
 *
 * 認証は sync-tracking と同じ CRON_SECRET (GitHub Actions から Bearer で叩く)。
 */

const HORIZON_DAYS = 30

function trustedOrigin(): string {
  return (
    process.env.APP_BASE_URL?.replace(/\/+$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://bondex.express"
  )
}

// ShipmentRecord から /api/shipandco/create のリクエストボディを組み立てる。
function toCreateBody(s: ShipmentRecord) {
  return {
    refNumber: `${s.booking_id}-L${s.leg_index + 1}`,
    bookingId: s.booking_id,
    legIndex: s.leg_index,
    carrier: s.carrier || "sagawa",
    shipmentDate: s.shipment_date,
    deliveryDate: s.expected_arrival || s.shipment_date,
    deliveryTime: s.delivery_time || "before-noon",
    suitcaseCount: s.suitcase_count,
    productName: s.item_type || "",
    from: {
      hotel: s.from_hotel,
      recipient: s.recipient,
      placeId: s.from_place_id ?? undefined,
      city: s.from_city ?? undefined,
      residence: s.from_residence ?? undefined,
    },
    to: {
      hotel: s.to_hotel,
      recipient: s.recipient,
      placeId: s.to_place_id ?? undefined,
      city: s.to_city ?? undefined,
      residence: s.to_residence ?? undefined,
    },
    agency: s.agency,
    representative: s.representative,
    travelerCount: s.traveler_count,
    bookingName: s.booking_name || "",
    fromCheckIn: s.from_check_in || "",
    toCheckOut: s.to_check_out || "",
    specialNote: s.notes || "",
    noteTarget: s.note_target || "",
    tourNumber: s.tour_number || "",
    groupName: s.group_name || "",
    guestLanguage: s.guest_language || undefined,
  }
}

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }

  const nowJst = new Date(Date.now() + 9 * 3600 * 1000)
  const todayJst = nowJst.toISOString().slice(0, 10)
  const horizonJst = new Date(nowJst.getTime() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10)

  const due = await listIssueDue(todayJst, horizonJst)
  if (due.length === 0) {
    return NextResponse.json({ due: 0, mode: "none", today: todayJst, horizon: horizonJst })
  }

  const byBooking = new Map<string, ShipmentRecord[]>()
  for (const s of due) {
    const arr = byBooking.get(s.booking_id) ?? []
    arr.push(s)
    byBooking.set(s.booking_id, arr)
  }

  const autoIssue = process.env.AUTO_ISSUE_ENABLED === "true"
  const opPw = process.env.OPERATOR_PASSWORD

  // ── モード1: ダイジェスト通知のみ (自動発行 OFF、または鍵なし) ──
  if (!autoIssue || !opPw) {
    const lines: string[] = [
      `発行がまだの予約が ${due.length} 区間あります (発送日が今日〜${HORIZON_DAYS}日先・発行窓に入っています)。`,
      `/operator から発行してください。放置すると手荷物が出荷されません。`,
      "",
    ]
    for (const [bookingId, legs] of byBooking) {
      const first = legs[0]
      lines.push(`■ ${bookingId} (${first.agency} / ${first.representative}) — ${legs.length}区間`)
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
      agencyEmail: null,
    })
    return NextResponse.json({
      due: due.length,
      bookings: byBooking.size,
      mode: "digest",
      autoIssue,
      notified: result.emailSent || result.slackSent,
      today: todayJst,
      horizon: horizonJst,
    })
  }

  // ── モード2: 自動発行 ──
  const origin = trustedOrigin()
  const issuedByBooking = new Map<string, ShipmentRecord[]>()
  const deferred: Array<{ booking_id: string; leg: number }> = []
  const failed: Array<{ booking_id: string; leg: number; error: string }> = []

  for (const s of due) {
    try {
      const res = await fetch(`${origin}/api/shipandco/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opPw}` },
        body: JSON.stringify(toCreateBody(s)),
      })
      const d = (await res.json().catch(() => ({}))) as {
        label?: string
        status?: string
        error?: string
        code?: string
      }
      if (res.ok && d.label) {
        const arr = issuedByBooking.get(s.booking_id) ?? []
        arr.push(s)
        issuedByBooking.set(s.booking_id, arr)
      } else if (d.status === "deferred") {
        deferred.push({ booking_id: s.booking_id, leg: s.leg_index })
      } else {
        failed.push({ booking_id: s.booking_id, leg: s.leg_index, error: d.code || d.error || `HTTP ${res.status}` })
      }
    } catch (e) {
      failed.push({ booking_id: s.booking_id, leg: s.leg_index, error: e instanceof Error ? e.message : "network" })
    }
  }

  // 代理店の連絡先 (発行済みの予約の agency) を引く
  const agencyEmailByName = new Map<string, { email: string | null; locale: string }>()
  const sb = getSupabase()
  if (sb && issuedByBooking.size > 0) {
    const names = Array.from(new Set(Array.from(issuedByBooking.values()).flat().map((s) => s.agency)))
    const { data: ags } = await sb.from("agencies").select("name, contact_email, locale").in("name", names)
    for (const a of ags ?? []) {
      agencyEmailByName.set(a.name as string, {
        email: (a.contact_email as string) ?? null,
        locale: (a.locale as string) === "en" ? "en" : "ja",
      })
    }
  }

  // 発行できた予約ごとに Drive 格納 + 代理店へ「発行しました」メール
  for (const [bookingId, legs] of issuedByBooking) {
    let folderUrl = ""
    try {
      const r = await fetch(`${origin}/api/operator/drive-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opPw}` },
        body: JSON.stringify({ bookingId }),
      })
      const dj = (await r.json().catch(() => ({}))) as { folderUrl?: string }
      folderUrl = dj.folderUrl || ""
    } catch {
      /* Drive 格納失敗は無視 (書類は画面から DL 可) */
    }

    const first = legs[0]
    const ag = agencyEmailByName.get(first.agency)
    const en = ag?.locale === "en"
    const legLines = legs
      .map((s) => `${en ? "Leg" : "区間"} L${s.leg_index + 1}: ${s.from_hotel} → ${s.to_hotel} (${s.shipment_date})`)
      .join("\n")
    const subject = en
      ? `[BondEx] Shipping labels issued (${bookingId})`
      : `【BondEx】送り状を発行しました（${bookingId}）`
    const body = en
      ? [
          `Dear ${first.agency},`,
          "",
          `The shipping labels for the following booking have been issued (they become available from 30 days before the shipment date).`,
          "",
          `Booking: ${bookingId}${first.tour_number ? ` / Tour No. ${first.tour_number}` : ""}`,
          legLines,
          "",
          folderUrl ? `Documents (voucher + labels) are stored here:\n${folderUrl}` : "Documents are available from the portal.",
          "",
          "— BondEx / JOJO Inc.",
        ].join("\n")
      : [
          `${first.agency} 御中`,
          "",
          `下記予約の送り状を発行いたしました（送り状は発送30日前から発行されます）。`,
          "",
          `予約番号: ${bookingId}${first.tour_number ? ` / ツアー番号 ${first.tour_number}` : ""}`,
          legLines,
          "",
          folderUrl ? `書類一式（バウチャー+送り状）をこちらに格納しました:\n${folderUrl}` : "書類はポータルからもDLいただけます。",
          "",
          "— BondEx ／ 株式会社JOJO",
        ].join("\n")

    const bondexCopy = process.env.ALERT_EMAIL || "support@bondex.express"
    const recipients = [...(ag?.email ? [ag.email] : []), bondexCopy]
    for (const to of recipients) {
      try {
        await sendMail({ to, subject, text: body, replyTo: "support@bondex.express" })
      } catch (e) {
        console.error("[cron/issue-due] 発行メール失敗:", e instanceof Error ? e.message : e)
      }
    }
  }

  // 発行できなかった区間は運用へアラート
  if (failed.length > 0) {
    await sendOpsAlert({
      subject: `【自動発行に失敗】${failed.length}区間（要確認）`,
      lines: [
        `自動発行を試みましたが失敗した区間があります。/operator から手動でご確認ください。`,
        "",
        ...failed.map((f) => `・${f.booking_id}-L${f.leg + 1}: ${f.error}`),
        "",
        "ダッシュボード: https://bondex.express/operator/dashboard",
      ],
      agencyEmail: null,
    })
  }

  return NextResponse.json({
    due: due.length,
    mode: "auto_issue",
    issuedBookings: issuedByBooking.size,
    issuedLegs: Array.from(issuedByBooking.values()).reduce((n, a) => n + a.length, 0),
    deferred: deferred.length,
    failed: failed.length,
    today: todayJst,
    horizon: horizonJst,
  })
}
