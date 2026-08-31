import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { notifyBondEx } from "@/lib/notify"

export const runtime = "nodejs"

/**
 * PATCH /api/agency/shipment/[id] — 代理店セルフサービスの区間変更。
 *   body: { shipmentDate?, expectedArrival?, suitcaseCount?, cancel?: true }
 *
 * 安全ゲート:
 *  - 自社の予約のみ (agency 名一致)
 *  - status が requested / pending (未発行) のときだけ変更可。
 *    発行済み以降は送り状との食い違い事故になるため直接変更させない (BondEx へ連絡)。
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
  if (shipment.status !== "requested" && shipment.status !== "pending") {
    return NextResponse.json(
      {
        error: en
          ? "This leg has already been issued and can't be changed here. Please contact BondEx."
          : "この区間は発行済みのため、こちらから変更できません。BondEx までご連絡ください。",
        code: "LOCKED",
      },
      { status: 409 },
    )
  }

  let body: {
    shipmentDate?: unknown
    expectedArrival?: unknown
    suitcaseCount?: unknown
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
      .update({ status: "cancelled" })
      .eq("id", id)
      .in("status", ["requested", "pending"])
      .select("id")
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if ((upd ?? []).length === 0) {
      return NextResponse.json(
        { error: "LOCKED", message: "送り状が発行済みのため、取り消しは BondEx へご連絡ください。" },
        { status: 409 },
      )
    }
    await notifyBondEx({
      kind: "change",
      title: `${legRef}（${shipment.agency}）区間を取り消し`,
      lines: [
        `区間: ${shipment.from_hotel} → ${shipment.to_hotel}`,
        `発送日: ${shipment.shipment_date}（未発行のため送り状なし・課金なし）`,
        `代理店の操作によるセルフ取り消し`,
      ],
      link: `/track/${shipment.booking_id}`,
      linkLabel: "追跡ページで確認",
    })
    return NextResponse.json({ ok: true, cancelled: true })
  }

  // ── 日程 / 個数の変更
  const patch: Record<string, unknown> = {}
  const changes: string[] = []

  const shipDate = typeof body.shipmentDate === "string" ? body.shipmentDate : ""
  const arrival = typeof body.expectedArrival === "string" ? body.expectedArrival : ""
  if (shipDate || arrival) {
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
    const today = new Date()
    const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
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

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields" }, { status: 400 })
  }

  // 同上: 発行と同時刻の変更が「送り状と DB の日付・個数の食い違い」を生まないよう条件付き
  const { data: upd2, error } = await sb
    .from("shipments")
    .update(patch)
    .eq("id", id)
    .in("status", ["requested", "pending"])
    .select("id")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if ((upd2 ?? []).length === 0) {
    return NextResponse.json(
      { error: "LOCKED", message: "送り状が発行済みのため、変更は BondEx へご連絡ください。" },
      { status: 409 },
    )
  }

  await notifyBondEx({
    kind: "change",
    title: `${legRef}（${shipment.agency}）予約内容の変更`,
    lines: [
      `区間: ${shipment.from_hotel} → ${shipment.to_hotel}`,
      ...changes,
      `未発行区間の代理店セルフ変更（発行時の書類に自動反映）`,
    ],
    link: `/track/${shipment.booking_id}`,
    linkLabel: "追跡ページで確認",
  })

  return NextResponse.json({ ok: true })
}
