import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { changeBlockedReason } from "@/lib/agency-change-gate"
import { notifyBondEx } from "@/lib/notify"
import { jstTodayYmd } from "@/lib/yamato-delivery"
import { legLockedForAgency, isSelfServiceCutoffPassed, normalizeRepresentative } from "@/lib/agency-self-service"
import { resyncBookingToDrive } from "@/lib/drive-resync"

export const runtime = "nodejs"

/**
 * PATCH /api/agency/shipment/[id] — 代理店セルフサービスの区間変更。
 *   body: { shipmentDate?, expectedArrival?, suitcaseCount?, representative?, cancel?: true }
 *
 * 安全ゲート:
 *  - 自社の予約のみ (agency 名一致)
 *  - ロック判定は lib/agency-self-service.ts (送り状が実在 / 追跡番号あり / 集荷済み以降 = 不可)。
 *    2026-09-24 の運用変更で依頼直後から "issued" (手配済) になるため、status だけでは判定しない。
 *  - 日程・個数・代表者名は「配送前日 17:00 (JST)」まで (完了画面・受付メールの案内どおり)。
 *  - 代表者名は予約単位 → 全区間に反映。受取人名が旧代表者名と同じなら揃える。
 *  - 団体 (booking_type='group') の個数変更は不可 (荷物リストと不整合になるため。
 *    団体ダッシュボードでリストを編集する)。
 *  - 未発行は amount_yen=0 のため、個数変更しても請求は発行時に個数×¥5,000で確定=ズレない。
 * 変更は BondEx へ Slack 通知 (kind=change)。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limit = rateLimit(req, "agency-shipment-patch")
  if (!limit.ok) return limit.response
  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const en = auth.agency.locale === "en"

  const { id } = await params
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const shipment = await getShipment(id)
  if (!shipment || shipment.agency !== auth.agency.name) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  if (legLockedForAgency(shipment)) {
    return NextResponse.json(
      {
        error: en
          ? "This leg has already been handed to the courier and can't be changed here. Please contact BondEx."
          : "この区間は配送業者への手配が済んでいるため、こちらから変更できません。BondEx までご連絡ください。",
        code: "LOCKED",
      },
      { status: 409 },
    )
  }
  // 変更可能な状態 (未集荷・送り状なし) だけを条件付きで更新するためのフィルタ
  const editableStatuses = ["requested", "pending", "issued"]

  let body: {
    shipmentDate?: unknown
    expectedArrival?: unknown
    suitcaseCount?: unknown
    representative?: unknown
    cancel?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const legRef = `${shipment.booking_id}-L${shipment.leg_index + 1}`
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 })

  // ── 取り消し
  if (body.cancel === true) {
    // 条件付き更新 (2026-08-31 監査対応): 事前チェックと更新の間に cron 自動発行が
    // 走ると「発行直後の区間をキャンセルで上書き = 実ラベル (課金済み) だけが生き残る」。
    // 未発行状態のときだけ更新し、0行なら発行済みとして 409 を返す。
    const { data: upd, error } = await sb
      .from("shipments")
      .update({
        status: "cancelled",
        // 監査証跡 (migration 042): 誰が・いつ・どの経路で取り消したかを必ず残す。
        cancelled_at: new Date().toISOString(),
        cancelled_by: auth.agency.contact_email
          ? `${auth.agency.name} <${auth.agency.contact_email}>`
          : auth.agency.name,
        cancel_source: "agency",
      })
      .eq("id", id)
      .in("status", editableStatuses)
      .is("yamato_label_url", null)
      .select("id")
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if ((upd ?? []).length === 0) {
      return NextResponse.json(
        { error: "LOCKED", message: "配送業者への手配が済んでいるため、取り消しは BondEx へご連絡ください。" },
        { status: 409 },
      )
    }
    await notifyBondEx({
      kind: "cancel",
      title: `${legRef}（${shipment.agency}）区間を取り消し`,
      lines: [
        `区間: ${shipment.from_hotel} → ${shipment.to_hotel}`,
        `発送日: ${shipment.shipment_date}（集荷前のため課金なし）`,
        `代理店の操作によるセルフ取り消し`,
      ],
      link: `/track/${shipment.booking_id}`,
      linkLabel: "追跡ページで確認",
    })
    return NextResponse.json({ ok: true, cancelled: true })
  }

  // ── 日程 / 個数 / 代表者名の変更 — 配送前日 17:00 (JST) まで
  if (isSelfServiceCutoffPassed(shipment.shipment_date)) {
    return NextResponse.json(
      {
        error: "CUTOFF_PASSED",
        message: en
          ? "Changes are accepted until 17:00 (JST) on the day before shipment. Please contact BondEx."
          : "変更は配送前日の 17:00 までの受付です。お手数ですが BondEx までご連絡ください。",
      },
      { status: 409 },
    )
  }
  const patch: Record<string, unknown> = {}
  const changes: string[] = []
  const bookingPatch: Record<string, unknown> = {}

  // リードタイムゲート (団体30個以上=発送7日以内は全変更不可 / 個数変更=14日前まで)
  const gateInput = {
    bookingType: shipment.booking_type,
    suitcaseCount: shipment.suitcase_count,
    shipmentDate: shipment.shipment_date,
  }
  const groupLockResp = () =>
    NextResponse.json(
      {
        error: "GROUP_LARGE_LOCK",
        message: en
          ? "Large group bookings (30+ pieces) can't be changed here within a week of shipment. Please contact BondEx."
          : "団体（30個以上）は発送1週間以内の変更ができません。BondEx までご連絡ください。",
      },
      { status: 409 },
    )

  const shipDate = typeof body.shipmentDate === "string" ? body.shipmentDate : ""
  const arrival = typeof body.expectedArrival === "string" ? body.expectedArrival : ""
  if (shipDate || arrival) {
    if (changeBlockedReason("dates", gateInput) === "group_large_lock") return groupLockResp()
    const newShip = shipDate || shipment.shipment_date
    const newArr = arrival || shipment.expected_arrival || newShip
    if (!DATE_RE.test(newShip) || !DATE_RE.test(newArr)) {
      return NextResponse.json(
        { error: en ? "Please enter valid dates." : "日付を正しくご入力ください。" },
        { status: 400 },
      )
    }
    if (newArr < newShip) {
      return NextResponse.json(
        { error: en ? "Arrival must be on/after the ship date." : "到着日は発送日以降にしてください。" },
        { status: 400 },
      )
    }
    // 「今日」は必ず JST で判定する。サーバは UTC 稼働のため new Date() ローカル値だと
    // 0:00-8:59 JST の間だけ前日扱いになり、過去日の発送が素通りして自動発行から漏れる。
    const todayYmd = jstTodayYmd()
    if (newShip < todayYmd) {
      return NextResponse.json(
        { error: en ? "The ship date can't be in the past." : "発送日に過去の日付は指定できません。" },
        { status: 400 },
      )
    }
    patch.shipment_date = newShip
    patch.expected_arrival = newArr
    changes.push(`日程: ${shipment.shipment_date} → ${newShip}（到着 ${newArr}）`)
  }

  if (body.suitcaseCount !== undefined) {
    if (shipment.booking_type === "group") {
      return NextResponse.json(
        {
          error: en
            ? "For group bookings, edit the luggage list on the group dashboard instead."
            : "団体予約の個数は、団体ダッシュボードの荷物リストから変更してください。",
        },
        { status: 400 },
      )
    }
    const countGate = changeBlockedReason("count", gateInput)
    if (countGate === "group_large_lock") return groupLockResp()
    if (countGate === "count_lead") {
      return NextResponse.json(
        {
          error: "COUNT_LEAD",
          message: en
            ? "Piece-count changes must be made at least 2 weeks before shipment. Please contact BondEx."
            : "個数の変更は発送の2週間前までにお願いします。締切を過ぎた分は BondEx までご連絡ください。",
        },
        { status: 409 },
      )
    }
    const n = Math.floor(Number(body.suitcaseCount))
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      return NextResponse.json(
        { error: en ? "Pieces must be 1–50." : "個数は 1〜50 でご入力ください。" },
        { status: 400 },
      )
    }
    patch.suitcase_count = n
    changes.push(`個数: ${shipment.suitcase_count} → ${n}`)
  }

  if (body.representative !== undefined) {
    const rep = normalizeRepresentative(body.representative)
    if (!rep) {
      return NextResponse.json(
        { error: en ? "Please enter the guest name (up to 80 characters)." : "代表者名をご入力ください（80文字以内）。" },
        { status: 400 },
      )
    }
    if (rep !== shipment.representative) {
      bookingPatch.representative = rep
      const oldRecipient = shipment.recipient || ""
      if (!oldRecipient || oldRecipient === shipment.representative) bookingPatch.recipient = rep
      changes.push(`代表者: ${shipment.representative || "—"} → ${rep}（全区間）`)
    }
  }

  if (Object.keys(patch).length === 0 && Object.keys(bookingPatch).length === 0) {
    return NextResponse.json({ error: "no fields" }, { status: 400 })
  }

  // 同上: 集荷と同時刻の変更が「佐川へ渡した情報と DB の食い違い」を生まないよう条件付き
  if (Object.keys(patch).length > 0) {
    const { data: upd2, error } = await sb
      .from("shipments")
      .update(patch)
      .eq("id", id)
      .in("status", editableStatuses)
      .is("yamato_label_url", null)
      .select("id")
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if ((upd2 ?? []).length === 0) {
      return NextResponse.json(
        { error: "LOCKED", message: "配送業者への手配が済んでいるため、変更は BondEx へご連絡ください。" },
        { status: 409 },
      )
    }
  }
  // 代表者名は予約単位 → 全区間 (変更可能な区間のみ)。
  if (Object.keys(bookingPatch).length > 0) {
    const { error } = await sb
      .from("shipments")
      .update(bookingPatch)
      .eq("booking_id", shipment.booking_id)
      .in("status", editableStatuses)
      .is("yamato_label_url", null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Drive のバウチャーも差し替え (best-effort)。ポータルの DL は都度生成なので常に最新。
    try {
      await resyncBookingToDrive(sb, shipment.booking_id)
    } catch {
      /* Drive 差し替え失敗は無視 */
    }
  }

  await notifyBondEx({
    kind: "change",
    title: `${legRef}（${shipment.agency}）予約内容の変更`,
    lines: [
      `区間: ${shipment.from_hotel} → ${shipment.to_hotel}`,
      ...changes,
      `代理店セルフ変更（バウチャーは再生成で自動反映・佐川への集荷情報は最新値で送付）`,
    ],
    link: `/track/${shipment.booking_id}`,
    linkLabel: "追跡ページで確認",
  })

  return NextResponse.json({ ok: true })
}
