export const ALERTS: Array<{ subject: string; lines: string[] }> = []
export async function sendOpsAlert(a: { subject: string; lines: string[] }) { ALERTS.push(a); return { ok: true } }
export const opsAlertConfigured = () => true
