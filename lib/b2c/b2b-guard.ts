/**
 * B2C の区間を、既存の B2B の課金・清算の経路に入れないための判定（docs/b2c/B2C_MVP_SCHEMA_v1.md 5章・7章）。
 *
 * B2C の区間は shipments.channel='b2c'・b2c_order_id あり・代理店名 "BondEx Direct" のどれかで見分ける。
 * 列がまだ無い DB（B2C の表の適用前）では channel / b2c_order_id は undefined になり、代理店名で判定する。
 * 判定は「どれか 1つでも B2C らしければ B2C」（B2B の課金に入れない側に倒す）。
 *
 * 同じ考え方の lib/channel-guard.ts（review/tracking-fixes-7c234a4 ブランチ・未マージ）が main に入ったら、そちらに寄せる。
 */
export const B2C_AGENCY_NAME = "BondEx Direct"

export function isB2cShipmentRow(row: { channel?: unknown; b2c_order_id?: unknown; agency?: unknown } | null | undefined): boolean {
  if (!row) return false
  if (row.channel === "b2c") return true
  if (row.b2c_order_id !== undefined && row.b2c_order_id !== null) return true
  return row.agency === B2C_AGENCY_NAME
}
