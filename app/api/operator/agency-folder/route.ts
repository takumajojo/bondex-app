import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { ensureAgencyFolder, isDriveConfigured } from "@/lib/google-drive"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 既存の全代理店ぶんの共有ドライブ「代理店フォルダ」を一括で用意する (backfill)。
 *
 *   POST /api/operator/agency-folder
 *   Authorization: Bearer <OPERATOR_PASSWORD>
 *
 * find-or-create なので何度呼んでも安全 (idempotent)。新規代理店は登録時に自動作成される
 * (/api/agency/register) ため、これは既存分の補完用。
 */
export async function POST(req: NextRequest) {
  void req
  if (!isDriveConfigured()) {
    return NextResponse.json({ error: "Google Drive 未設定" }, { status: 503 })
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })

  const { data, error } = await sb.from("agencies").select("name")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const names = Array.from(
    new Set((data ?? []).map((r: { name: string | null }) => (r.name ?? "").trim()).filter(Boolean)),
  )
  const results: Array<{ name: string; ok: boolean; folderUrl?: string; error?: string }> = []
  for (const name of names) {
    const r = await ensureAgencyFolder(name)
    results.push(
      r.ok
        ? { name, ok: true, folderUrl: r.folderUrl }
        : { name, ok: false, error: r.error },
    )
  }
  return NextResponse.json({ ok: true, results })
}
