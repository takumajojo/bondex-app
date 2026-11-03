import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendOpsAlert, opsAlertConfigured } from "@/lib/ops-alert"
import { listHotelContactDue, countBoardViews } from "@/lib/shipments-db"
import { HOTEL_ROUTE_LABEL } from "@/lib/hotel-notification"
import { loadPickupTodo } from "@/lib/pickup-request/todo"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 「本日のTODO」ダイジェスト cron (/api/cron/daily-todo)。
 *
 * 運用担当が毎朝ダッシュボードを開かなくても、今日やることが一目で分かるように
 * support@ (運用受信箱) へ簡潔なメールを送る。中身はダッシュボードの「今日のTODO」と同じ:
 *   1) 佐川への集荷依頼 (発行済み・依頼未・発送が今日/明日の区間 = 前日までに佐川へ連絡)
 *   2) ホテルへの連絡   (発送2営業日前が締切の区間)
 *   3) その他の要対応件数 (送り状郵送/集荷遅れ/配送遅れ/課金失敗/発行失敗)
 *
 * 宛先は lib/ops-recipients の [ALERT_EMAIL, support@] 両方 (sendOpsAlert 経由)。
 * 認証は他 cron と同じ CRON_SECRET (GitHub Actions から Bearer で叩く)。
 */

const SITE_URL = "https://bondex.express"

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}
function tomorrowJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + 86_400_000).toISOString().slice(0, 10)
}
/** "2026-10-08" → "10/8" (JST 表示・簡潔) */
function mmdd(ymd: string | null): string {
  if (!ymd) return "—"
  const [, m, d] = ymd.split("-")
  return `${Number(m)}/${Number(d)}`
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

const URGENCY_RANK: Record<string, number> = { overdue: 0, urgent: 1, due: 2 }
const COUNT_LABEL: Record<string, string> = {
  "label-mail": "送り状郵送",
  "delay-pickup": "集荷遅れ",
  "delay-delivery": "配送遅れ",
  "charge-failed": "課金失敗",
  failed: "発行失敗",
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // 二重起動ロック (GitHub Actions の誤判定リトライ対策)。
  const lock = await acquireCronLock("daily-todo")
  if (!lock.ok) return NextResponse.json({ ok: true, skipped: "already running" })

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: true, skipped: "supabase not configured" })
    }
    const sb = getSupabase()
    if (!sb) return NextResponse.json({ ok: true, skipped: "supabase not configured" })

    const today = todayJst()
    const tomorrow = tomorrowJst()

    // 1) 佐川への集荷依頼 (2026-11-03 是正): 集荷依頼の記録で判定。未依頼で発送が今日/明日(JST)。
    //    status='requested' の区間も含める (旧条件の status='issued' では未依頼の区間が漏れていた)。
    // 集荷依頼の一覧が読めなくても他の TODO は配信する (読めなかったことは本文に出す)
    let pickupLoadError: string | null = null
    const pickupTodo = await loadPickupTodo(sb, today).catch((e: unknown) => {
      pickupLoadError = e instanceof Error ? e.message : String(e)
      return { needRequest: [], attention: [], legacyMode: false }
    })
    const sagawa = pickupTodo.needRequest
      .filter((t) => t.shipmentDate <= tomorrow)
      .map((t) => ({
        booking_id: t.bookingId, leg_index: t.legIndex, representative: t.representative,
        from_hotel: t.fromHotel, from_hotel_ja: t.fromHotelJa, shipment_date: t.shipmentDate,
      }))
    const pickupAttention = pickupTodo.attention

    // 2) ホテル連絡 (due/urgent/overdue)。区間×ルートに展開して期限が厳しい順に。
    const hotelRows = await listHotelContactDue(today)
    const hotelTasks = hotelRows
      .flatMap((row) =>
        row.routes.map((rt) => ({
          bookingId: row.booking_id,
          legIndex: row.leg_index,
          routeLabel: HOTEL_ROUTE_LABEL[rt.route],
          hotel: rt.hotel,
          deadline: rt.deadline,
          urgency: rt.urgency,
        })),
      )
      .sort((a, b) => {
        const ur = (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9)
        if (ur !== 0) return ur
        return (a.deadline ?? "").localeCompare(b.deadline ?? "")
      })

    // 3) その他カテゴリ件数。
    const counts = (await countBoardViews(today)) ?? ({} as Record<string, number>)
    const countParts = Object.entries(counts)
      .filter(([, n]) => typeof n === "number" && n > 0)
      .map(([k, n]) => `${COUNT_LABEL[k] ?? k} ${n}`)

    const countsTotal = Object.values(counts).reduce((s, n) => s + (typeof n === "number" ? n : 0), 0)
    const total = sagawa.length + pickupAttention.length + hotelTasks.length + countsTotal

    // ── メール本文 (簡潔・プレーンテキスト)
    const lines: string[] = []
    if (pickupLoadError) {
      lines.push(`■ 佐川への集荷依頼: 一覧を読み込めませんでした（運営画面で確認してください）: ${pickupLoadError}`)
      lines.push("")
    }
    if (sagawa.length > 0) {
      lines.push(`■ 佐川への集荷依頼（${sagawa.length}件）※集荷前日 20:00 までに依頼`)
      for (const s of sagawa) {
        const head = s.shipment_date <= today ? "【本日発送・至急】" : "【明日発送】"
        const hotel = s.from_hotel_ja || s.from_hotel || "—"
        lines.push(`  ${head} ${s.booking_id}-L${s.leg_index + 1}  ${hotel}  発送 ${mmdd(s.shipment_date)}（${s.representative}）`)
      }
      lines.push("")
    }
    if (pickupAttention.length > 0) {
      const kindLabel: Record<string, string> = {
        unknown: "【結果不明・要確認】",
        stale_sending: "【送信中のまま・要確認】",
        cancel_needed: "【取消済み区間・佐川へ取消連絡】",
        needs_review: "【依頼済みか不明・要確認】",
        change_pending: "【変更・取消の返信待ち】",
      }
      lines.push(`■ 集荷依頼の要対応（${pickupAttention.length}件）※再送せず、佐川へ確認してから記録`)
      for (const a of pickupAttention) {
        lines.push(`  ${kindLabel[a.kind] ?? a.kind} ${a.bookingId}-L${a.legIndex + 1}  発送 ${mmdd(a.shipmentDate)}`)
      }
      lines.push("")
    }
    if (hotelTasks.length > 0) {
      lines.push(`■ ホテルへの連絡（${hotelTasks.length}件）※発送2営業日前が締切`)
      for (const h of hotelTasks) {
        const head = h.urgency === "overdue" ? "【締切超過】" : h.urgency === "urgent" ? "【早急】" : "【本日締切】"
        lines.push(`  ${head} ${h.bookingId}-L${h.legIndex + 1}  ${h.routeLabel}: ${h.hotel}  締切 ${mmdd(h.deadline)}`)
      }
      lines.push("")
    }
    if (countParts.length > 0) {
      lines.push(`■ その他の要対応：${countParts.join(" / ")}`)
      lines.push("")
    }

    const hasTodo = !!pickupLoadError || sagawa.length > 0 || pickupAttention.length > 0 || hotelTasks.length > 0 || countParts.length > 0
    const bodyLines = hasTodo
      ? [...lines, `ダッシュボード: ${SITE_URL}/operator/dashboard`]
      : ["本日、対応が必要なTODOはありません。", "", `ダッシュボード: ${SITE_URL}/operator/dashboard`]

    const subject = hasTodo
      ? `【BondEx】本日のTODO（${mmdd(today)}）｜集荷依頼${sagawa.length}・ホテル連絡${hotelTasks.length}`
      : `【BondEx】本日のTODO（${mmdd(today)}）｜対応事項なし`

    if (!opsAlertConfigured()) {
      // 送る手段が無い = ダイジェストの意味が無い。静かな成功にせず検知可能にする。
      return NextResponse.json(
        { ok: false, skipped: "alert channel not configured", today, total },
        { status: 200 },
      )
    }

    const result = await sendOpsAlert({ subject, lines: bodyLines, agencyEmail: null })

    return NextResponse.json({
      ok: true,
      today,
      total,
      sagawa: sagawa.length,
      hotel: hotelTasks.length,
      otherCounts: counts,
      notified: result,
    })
  } finally {
    await releaseCronLock("daily-todo")
  }
}
