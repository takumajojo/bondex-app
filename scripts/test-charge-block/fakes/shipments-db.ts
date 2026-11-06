// lib/shipments-db の偽物。呼ばれた回数を数え、state.db に置いた区間を返す。
import { calls, db } from "./state"

export type ShipmentRecord = Record<string, unknown>

export async function getShipment(id: string): Promise<ShipmentRecord | null> {
  calls.getShipment++
  return db.shipments[id] ?? null
}

export async function recordShipmentChargeError(): Promise<void> {
  calls.recordError++
}

export async function recordShipmentCharge(): Promise<{ ok: boolean; firstRecord: boolean }> {
  calls.recordCharge++
  return { ok: true, firstRecord: true }
}
