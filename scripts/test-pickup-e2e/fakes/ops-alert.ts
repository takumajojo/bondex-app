// 運用アラートの偽物: 送らずに記録する。
export interface OpsAlertInput {
  subject: string
  lines: string[]
  agencyEmail?: string | null
  agencySubject?: string
  agencyLines?: string[]
}
export const sentAlerts: OpsAlertInput[] = []
export async function sendOpsAlert(a: OpsAlertInput) {
  sentAlerts.push(a)
  return { emailSent: true, slackSent: false, errors: [] }
}
export const opsAlertConfigured = () => true
