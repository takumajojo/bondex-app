import { rec } from "./state"
export type ShipmentStatus = "pending" | "requested" | "issued" | "picked_up" | "in_transit" | "delivered" | "cancelled" | "failed"
export async function listPickupMisses() { rec("listPickupMisses"); return [] }
export async function markPickupAlerted() {}
export async function listDeliveryOverdue() { rec("listDeliveryOverdue"); return [] }
export async function markDeliveryOverdueAlerted() {}
export async function getShipment(id: string) {
  return { id, booking_id: "BDX-TEST01", leg_index: 1, agency: "A", tracking_numbers: ["564832366066"], yamato_tracking: ["564832366066"], representative: "R", recipient: "R" }
}
