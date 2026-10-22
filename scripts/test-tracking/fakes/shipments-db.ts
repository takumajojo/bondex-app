import { rec } from "./state"
export type ShipmentStatus = "pending" | "requested" | "issued" | "picked_up" | "in_transit" | "delivered" | "cancelled" | "failed"
export async function listPickupMisses() { rec("listPickupMisses"); return [] }
export async function markPickupAlerted() {}
export async function listDeliveryOverdue() { rec("listDeliveryOverdue"); return [] }
export async function markDeliveryOverdueAlerted() {}
