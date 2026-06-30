import crypto from "crypto"
import { getSupabase } from "@/lib/supabase"

/**
 * parse_log テーブルの CRUD.
 * 旅程パース結果を記録 — 将来 few-shot learning の元データに使う.
 *
 * 重要: この関数は **絶対に throw しない**. 記録失敗が parse API の
 *       本体動作を覆い隠してはいけない (PDF voucher 発行などはそのまま継続).
 */

export interface ParseLogInsert {
  agency?: string
  file_name?: string
  file_hash?: string
  file_size?: number
  file_type?: string
  ai_raw_output?: unknown
  operator_corrected?: unknown
  approved?: boolean
  notes?: string
}

/** Buffer の SHA-256 ハッシュを hex で返す */
export function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex")
}

export async function saveParseLog(input: ParseLogInsert): Promise<void> {
  try {
    const sb = getSupabase()
    if (!sb) return
    const row = {
      agency: input.agency ?? null,
      file_name: input.file_name ?? null,
      file_hash: input.file_hash ?? null,
      file_size: input.file_size ?? null,
      file_type: input.file_type ?? null,
      ai_raw_output: input.ai_raw_output ?? null,
      operator_corrected: input.operator_corrected ?? null,
      approved: input.approved ?? false,
      notes: input.notes ?? null,
    }
    const { error } = await sb.from("parse_log").insert(row)
    if (error) {
      console.error("[parse-log-db] saveParseLog failed:", error.message)
    }
  } catch (err) {
    console.error(
      "[parse-log-db] saveParseLog exception:",
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * 同じ代理店の approve 済 parse_log を最近 N 件取得 (few-shot 用、将来使用).
 * 現状は呼ばれていない. 将来 /api/itinerary/parse の system prompt に注入する.
 */
export async function listRecentApprovedExamples(
  agency: string,
  limit: number = 3,
): Promise<Array<{ ai_raw_output: unknown; operator_corrected: unknown }>> {
  try {
    const sb = getSupabase()
    if (!sb) return []
    const { data, error } = await sb
      .from("parse_log")
      .select("ai_raw_output, operator_corrected")
      .eq("agency", agency)
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .limit(limit)
    if (error) {
      console.error("[parse-log-db] listRecentApprovedExamples failed:", error.message)
      return []
    }
    return data ?? []
  } catch (err) {
    console.error(
      "[parse-log-db] listRecentApprovedExamples exception:",
      err instanceof Error ? err.message : err,
    )
    return []
  }
}
