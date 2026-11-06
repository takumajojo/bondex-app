import { NextRequest, NextResponse } from "next/server"
import { isChargeBlocked } from "@/lib/charge"

export const runtime = "nodejs"

/**
 * GET /api/operator/charge-block-status?id=<shipments.id>
 *
 * その区間が CHARGE_BLOCKED_SHIPMENT_IDS で自動課金から外れているかを返すだけ (読み取り専用)。
 * 本番デプロイ後の確認用: 再試行ボタンで確かめると、外れていなかった場合に実際に課金が走るため。
 * middleware で operator 認証必須。設定値そのものは返さない。
 */
export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim()
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  return NextResponse.json({ id, blocked: isChargeBlocked(id) })
}
