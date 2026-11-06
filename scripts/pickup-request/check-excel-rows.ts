// 佐川指定 Excel を作る前に、rows.json の区間が既に佐川へ依頼済みでないかを確かめる (読み取りのみ)。
//   npx tsx scripts/pickup-request/check-excel-rows.ts <rows.json> [--ops-mode=excel-check]
// 通常は output/sagawa-pickup/build_sheet.py から呼ばれる (照合を飛ばす指定は無い。照合できなければ Excel を作らない)。
// 1件でも依頼済み・取消などがあれば終了コード 1 (その区間を rows.json から外してから build_sheet.py を実行する)。
//
// 接続 (2026-11-07・lib/ops/script-db-guard.ts):
//   - 本番の DB は運営の照合のモード (--ops-mode=excel-check) の時だけ読む。Vercel・CI の上では動かない
//   - 鍵は、読み取りだけの役割の鍵 EXCEL_CHECK_READONLY_KEY (sql/ops/excel_check_readonly.sql の bondex_excel_reader) を優先する。
//     無い間は移行期として SUPABASE_SERVICE_ROLE_KEY を使う。どちらも読み取り (GET) しか送れない接続で作る
//   - Supabase のゲートウェイは apikey の欄に anon・service_role (または publishable・secret) の鍵しか受け付けない。読み取りだけの
//     役割の鍵は Authorization: Bearer で送り、apikey には公開の鍵 NEXT_PUBLIC_SUPABASE_ANON_KEY を入れる (2026-11-07・Supabase の文書)
//   - 読み取りだけの役割の鍵は有効期限 (exp) を必須にし、期限切れは接続の前に止める
//   - URL は NEXT_PUBLIC_SUPABASE_URL (または SUPABASE_URL)

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { checkExcelRows, parseLegRef, type ExcelCheckLeg, type ExcelOpenChange } from "../../lib/pickup-request/excel-check"
import { isPickupTableMissing } from "../../lib/pickup-request/store"
import type { PickupRequestRow } from "../../lib/pickup-request/state"
import { assertExcelCheckAllowed, classifyDbTarget, jwtPayload, keyRole, readOnlyFetch, ScriptGuardError } from "../../lib/ops/script-db-guard"

export const READONLY_ROLE = "bondex_excel_reader"

export interface CheckDeps {
  fetch?: typeof fetch
  log?: (s: string) => void
  now?: Date
}

/** 終了コード (0 = すべて OK、1 = NG・止めた)。process.exit はここでは呼ばない (試験で使うため)。 */
export async function run(argv: string[], env: Record<string, string | undefined>, deps: CheckDeps = {}): Promise<number> {
  const log = deps.log ?? console.log
  try {
    const file = argv.find((a) => !a.startsWith("--"))
    if (!file) throw new Error("rows.json のパスを指定してください")
    const rows = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, string>>
    if (!Array.isArray(rows)) throw new Error("rows.json は配列ではありません")
    const refs = rows.map((r) => String(r["31"] ?? "").trim())
    // 個数 (列4)・集荷予定日付 (列12)・配達指定日付 (列28) も予約と照合する (2026-11-06 監査 B-12)
    const inputs = rows.map((r) => ({ ref: String(r["31"] ?? "").trim(), pieces: r["4"] ?? null, pickupDate: r["12"] ?? null, deliveryDate: r["28"] ?? null }))

    const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
    const readonlyKey = (env.EXCEL_CHECK_READONLY_KEY ?? "").trim()
    let apiKey: string | undefined
    if (readonlyKey) {
      const claims = jwtPayload(readonlyKey)
      if (claims?.role !== READONLY_ROLE) throw new ScriptGuardError(`EXCEL_CHECK_READONLY_KEY は ${READONLY_ROLE} の鍵ではありません`)
      if (typeof claims.exp !== "number") throw new ScriptGuardError("EXCEL_CHECK_READONLY_KEY に有効期限 (exp) がありません（期限なしの鍵は使わない）")
      if (claims.exp * 1000 <= (deps.now ?? new Date()).getTime()) throw new ScriptGuardError("EXCEL_CHECK_READONLY_KEY の有効期限が切れています（谷口さんに作り直しを依頼する）")
      apiKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()
      if (!apiKey) throw new ScriptGuardError("読み取りだけの役割の鍵には、ゲートウェイを通すための公開の鍵 NEXT_PUBLIC_SUPABASE_ANON_KEY が要ります")
      if (keyRole(apiKey) !== "anon") throw new ScriptGuardError("NEXT_PUBLIC_SUPABASE_ANON_KEY が公開の鍵 (anon) ではありません")
    } else {
      apiKey = env.SUPABASE_SERVICE_ROLE_KEY
    }
    const target = classifyDbTarget(url, apiKey)
    if (readonlyKey) {
      const ref = jwtPayload(readonlyKey)?.ref
      if (ref && (target === "local" || ref !== jwtPayload(apiKey)?.ref)) throw new ScriptGuardError("EXCEL_CHECK_READONLY_KEY の接続先が URL と一致しません")
    }
    assertExcelCheckAllowed(target, argv, env)
    if (!readonlyKey && target !== "local" && keyRole(apiKey) !== "service_role") {
      // anon などの鍵は RLS で行が見えず、依頼済みを「依頼なし」と誤って OK にしうる
      throw new ScriptGuardError("照合に使える鍵ではありません (読み取りだけの役割の鍵か、移行期の service_role の鍵)")
    }
    const sb = createClient(url!, apiKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: readOnlyFetch(deps.fetch ?? fetch), headers: readonlyKey ? { Authorization: `Bearer ${readonlyKey}` } : undefined },
    })
    if (target === "production") log(readonlyKey ? "本番の DB を読み取りだけの役割で照合します" : "本番の DB を照合します (移行期: service_role の鍵を読み取りだけの接続で使用)")

    const bookingIds = [...new Set(refs.map((r) => parseLegRef(r)?.bookingId).filter(Boolean))] as string[]
    let legs: ExcelCheckLeg[]
    let requests: PickupRequestRow[] = []
    let openChanges: ExcelOpenChange[] = []

    if (readonlyKey) {
      // 読み取りだけの役割: 表を直接読まず、全部の行を見る関数だけを GET で呼ぶ (RLS で見えない行を「無い」としない)
      const { data, error } = await sb.rpc("excel_check_snapshot", { p_booking_ids: bookingIds }, { get: true })
      if (error) throw new Error(error.message)
      const snap = data as { complete?: boolean; legs?: ExcelCheckLeg[]; requests?: PickupRequestRow[]; open_changes?: ExcelOpenChange[] } | null
      if (!snap || snap.complete !== true || !Array.isArray(snap.legs) || !Array.isArray(snap.requests) || !Array.isArray(snap.open_changes)) {
        throw new Error("照合の関数の結果を確かめられません")
      }
      legs = snap.legs
      requests = snap.requests
      openChanges = snap.open_changes
    } else {
      const { data: legRows, error } = await sb
        .from("shipments")
        .select("id, booking_id, leg_index, status, tracking_numbers, pickup_requested_at, suitcase_count, shipment_date, expected_arrival")
        .in("booking_id", bookingIds.length ? bookingIds : ["-"])
      if (error) throw new Error(error.message)
      legs = (legRows ?? []) as ExcelCheckLeg[]
      const ids = legs.map((l) => l.id)
      if (ids.length) {
        const { data, error: rErr } = await sb.from("pickup_requests").select("*").in("shipment_id", ids)
        if (rErr && !isPickupTableMissing(new Error(rErr.message))) throw new Error(rErr.message)
        requests = (data ?? []) as PickupRequestRow[]
        if (rErr) log("※ 集荷依頼の記録 (sql/067) が未適用のため、従来の「依頼済み」印と問合番号で判定します")
      }
      // 処理中の変更・取消の申請。068 の前 (stage の列が無い) は status='pending' で読む。それ以外の失敗は止める
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
    }
    const verdicts = checkExcelRows(inputs, legs, requests, openChanges)
    for (const v of verdicts) log(v.ok ? `  OK   ${v.ref}` : `  NG   ${v.ref}: ${v.reason}`)
    const ng = verdicts.filter((v) => !v.ok).length
    if (verdicts.length === 0) {
      log("中止: rows.json に区間がありません")
      return 1
    }
    log(ng ? `\n${ng}件を Excel から外してください (二重依頼の恐れ)` : "\nすべて Excel に入れて問題ありません")
    return ng ? 1 : 0
  } catch (e) {
    log(`中止: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

if (require.main === module) {
  run(process.argv.slice(2), process.env).then((code) => process.exit(code))
}
