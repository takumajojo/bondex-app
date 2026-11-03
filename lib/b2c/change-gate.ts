/**
 * B2C の予約後の変更（確認ページのリンクから）の可否。docs/b2c/B2C_PLATFORM_AUDIT_v1.md 16.13 Q04・16.16。
 *
 * B2B と同じ規則を使う（2026-11-03 決定）。
 * - 締切: すべての変更は集荷の前日 17:00 JST まで（16.15。B2B と同じ時刻）。
 * - 個数の変更: 集荷の 14日前まで（lib/agency-change-gate.ts のルール2）。
 * - 30個以上の予約: 集荷の 7日前を切ったら、すべての変更を不可（同ルール1。B2C は団体の区別が無いので個数で判定）。
 * 止められた時は「BondEx へご連絡ください」と案内する（運営が対応）。
 *
 * 集荷の現場で個数が変わる場合（P-03）はこの規則の対象外（佐川の受託の個数で追加の課金をする）。
 */
import { changeBlockedReason, GROUP_LARGE_PIECES, type BlockReason, type ChangeKind } from "@/lib/agency-change-gate"
import { b2cCutoffAt } from "./bookability"

export type B2cChangeKind = ChangeKind | "cancel"
export type B2cChangeBlock = "past_cutoff" | BlockReason

export function b2cChangeBlockedReason(
  kind: B2cChangeKind,
  input: { pickupDate: string; pieces: number },
  now: Date,
): B2cChangeBlock | null {
  if (now.getTime() >= b2cCutoffAt(input.pickupDate).getTime()) return "past_cutoff"
  if (kind === "cancel") return null
  return changeBlockedReason(
    kind,
    {
      bookingType: input.pieces >= GROUP_LARGE_PIECES ? "group" : "fit",
      suitcaseCount: input.pieces,
      shipmentDate: input.pickupDate,
    },
    now,
  )
}
