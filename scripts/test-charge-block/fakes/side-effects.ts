// 通知・メール・請求書生成の偽物 (外部送信なし)。
import { calls } from "./state"

export async function sendOpsAlert(): Promise<void> { calls.opsAlert++ }
export async function sendMail(): Promise<{ ok: boolean }> { calls.mail++; return { ok: true } }
export async function notifyBondEx(): Promise<void> {}
export async function buildChargeInvoice(): Promise<{ ok: boolean }> { return { ok: false } }
