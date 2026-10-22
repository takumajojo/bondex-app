import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveUnitPriceYen } from "./pricing"

/**
 * 個数を変えたあとの請求額 (amount_yen・税抜) を返す。
 *
 * 2026-10-22 谷口さん指示: 予約訂正で個数を変えても金額が据え置かれ、BDX-S8DBZW (4→2個) は
 * 過大請求、BDX-C7CCW6 (4→5個) は過少請求になっていた。個数を書き換える経路はすべてこの関数を通し、
 * 個数と一緒に金額も更新する。
 *
 * - 請求額が確定済み (amount_yen > 0) かつ未課金 (charged_at なし) のときだけ「新個数 × 代理店単価」を返す。
 * - 未確定 (amount_yen = 0、依頼段階) は undefined = 据え置き。発行時に個数 × 単価で確定するため。
 * - 課金済みは undefined = 据え置き。差額は返金・追加請求として運用で扱う (adjust-count と同じ方針)。
 */
export async function amountForNewCount(
  sb: SupabaseClient,
  shipment: { agency: string | null; amount_yen: number | null; charged_at: string | null },
  newCount: number,
): Promise<number | undefined> {
  if (!shipment.amount_yen || shipment.amount_yen <= 0) return undefined
  if (shipment.charged_at) return undefined
  const { data, error } = await sb
    .from("agencies")
    .select("unit_price_yen")
    .eq("name", shipment.agency ?? "")
    .maybeSingle()
  // 単価が引けないまま既定単価で上書きすると代理店別単価を壊すので、取得失敗時は例外にして更新を止める。
  if (error) throw new Error(`代理店単価の取得に失敗しました: ${error.message}`)
  return newCount * resolveUnitPriceYen(data?.unit_price_yen as number | null | undefined)
}
