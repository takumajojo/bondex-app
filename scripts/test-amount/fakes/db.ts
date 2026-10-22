// テスト用の共有状態
export const DB = {
  shipment: {} as Record<string, unknown>,
  unitPrice: null as number | null,
  agencyError: false,
  updates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
}
export function reset(ship: Record<string, unknown>, unitPrice: number | null = null) {
  DB.shipment = { ...ship }
  DB.unitPrice = unitPrice
  DB.agencyError = false
  DB.updates = []
  DB.audits = []
}
