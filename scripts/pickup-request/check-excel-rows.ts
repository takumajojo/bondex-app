// 佐川指定 Excel を作る前に、rows.json の区間が既に佐川へ依頼済みでないかを確かめる (読み取りのみ)。
//   npx tsx scripts/pickup-request/check-excel-rows.ts <rows.json>
// SUPABASE の接続情報は環境変数 (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) から読む。
// 1件でも依頼済み・取消などがあれば終了コード 1 (その区間を rows.json から外してから build_sheet.py を実行する)。

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { checkExcelRows, parseLegRef, type ExcelCheckLeg, type ExcelOpenChange } from "../../lib/pickup-request/excel-check"
import { isPickupTableMissing } from "../../lib/pickup-request/store"
import type { PickupRequestRow } from "../../lib/pickup-request/state"

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error("rows.json のパスを指定してください")
  const rows = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, string>>
  const refs = rows.map((r) => String(r["31"] ?? "").trim())
  // 個数 (列4)・集荷予定日付 (列12)・配達指定日付 (列28) も予約と照合する (2026-11-06 監査 B-12)
  const inputs = rows.map((r) => ({ ref: String(r["31"] ?? "").trim(), pieces: r["4"] ?? null, pickupDate: r["12"] ?? null, deliveryDate: r["28"] ?? null }))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase の接続情報 (環境変数) がありません")
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const bookingIds = [...new Set(refs.map((r) => parseLegRef(r)?.bookingId).filter(Boolean))] as string[]
  const { data: legs, error } = await sb
    .from("shipments")
    .select("id, booking_id, leg_index, status, tracking_numbers, pickup_requested_at, suitcase_count, shipment_date, expected_arrival")
    .in("booking_id", bookingIds.length ? bookingIds : ["-"])
  if (error) throw new Error(error.message)
  let requests: PickupRequestRow[] = []
  const ids = (legs ?? []).map((l) => l.id as string)
  if (ids.length) {
    const { data, error: rErr } = await sb.from("pickup_requests").select("*").in("shipment_id", ids)
    if (rErr && !isPickupTableMissing(new Error(rErr.message))) throw new Error(rErr.message)
    requests = (data ?? []) as PickupRequestRow[]
    if (rErr) console.log("※ 集荷依頼の記録 (sql/067) が未適用のため、従来の「依頼済み」印と問合番号で判定します")
  }
  // 処理中の変更・取消の申請。068 の前 (stage の列が無い) は status='pending' で読む。それ以外の失敗は止める
  let openChanges: ExcelOpenChange[] = []
  if (ids.length) {
    const r1 = await sb.from("shipment_change_requests").select("shipment_id, kind, stage")
      .in("shipment_id", ids).in("stage", ["requested", "contacted", "approved"])
    if (!r1.error) {
      openChanges = ((r1.data ?? []) as ExcelOpenChange[]).filter((c) => c.kind !== "correction")
    } else if (/stage|kind/.test(r1.error.message) && /(does not exist|schema cache|not find)/i.test(r1.error.message)) {
      const r2 = await sb.from("shipment_change_requests").select("shipment_id").in("shipment_id", ids).eq("status", "pending")
      if (r2.error) throw new Error(r2.error.message)
      openChanges = (r2.data ?? []) as ExcelOpenChange[]
    } else {
      throw new Error(r1.error.message)
    }
  }
  const verdicts = checkExcelRows(inputs, (legs ?? []) as ExcelCheckLeg[], requests, openChanges)
  for (const v of verdicts) console.log(v.ok ? `  OK   ${v.ref}` : `  NG   ${v.ref}: ${v.reason}`)
  const ng = verdicts.filter((v) => !v.ok).length
  console.log(ng ? `\n${ng}件を Excel から外してください (二重依頼の恐れ)` : "\nすべて Excel に入れて問題ありません")
  process.exit(ng ? 1 : 0)
}

main().catch((e) => {
  console.error(`中止: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
