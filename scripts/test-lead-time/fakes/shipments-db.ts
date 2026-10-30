export const SAVED: Record<string, unknown>[] = []
export async function saveShipment(row: Record<string, unknown>) { SAVED.push(row); return { ok: true } }
export async function getAgencyNotificationMode() { return null }
