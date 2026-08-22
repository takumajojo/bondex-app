/**
 * 代理店別「ホテル通知設定」の中核ロジック (案A)。
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * BondEx の「ホテル通知」は実チャネル送信ではなく、バウチャーPDFの申し送り欄
 * (発送元ホテル欄 / お届け先ホテル欄 の2ブロック) への印字で実現される。
 * どちらのブロックに申し送りを載せるかは shipments.note_target (from/to/both) が決める:
 *   - from : 発送元ホテル欄のみ            (lib/voucher-pdf.tsx: from ブロック)
 *   - to   : お届け先ホテル欄のみ (既定)     (lib/voucher-pdf.tsx: to ブロック)
 *   - both : 両ブロック
 *
 * ── この設定が足すもの ──────────────────────────────────────────────────
 * これまで note_target は「予約フォームの leg 単位ドロップダウン」でしか決まらず、
 * 代理店ごとの既定がなかった。本モジュールは agencies.hotel_notification_mode を
 * 「代理店の既定」として持ち、leg 個別指定が無いときにそれへ解決する。
 *
 * ── 分岐が1箇所に閉じる ─────────────────────────────────────────────────
 * mode → note_target への対応表と、note_target → 該当ルートの判定を **この1ファイル**に
 * 集約する。代理店を増やしても分岐は増えない (データ=mode の値が変わるだけ)。
 * voucher-pdf 側の既存分岐と applicableRoutes() の真理値は一致させてある。
 */

/** 代理店の既定通知モード。値=データ。増やしてもコード分岐は増えない。 */
export type HotelNotificationMode = "guest_only" | "pickup_only" | "dual"

/** shipments.note_target の実値。 */
export type NoteTarget = "from" | "to" | "both"

/** 通知の2ルート。pickup=発送元ホテル / guest=お届け先ホテル。 */
export type HotelRoute = "pickup" | "guest"

export const HOTEL_NOTIFICATION_MODES: readonly HotelNotificationMode[] = [
  "guest_only",
  "pickup_only",
  "dual",
] as const

/** 既定=お届け先のみ (現行 note_target 既定 'to' と一致)。 */
export const DEFAULT_HOTEL_NOTIFICATION_MODE: HotelNotificationMode = "guest_only"

/** 画面表示用ラベル (operator 向け・日本語)。 */
export const HOTEL_NOTIFICATION_MODE_LABEL: Record<HotelNotificationMode, string> = {
  guest_only: "お届け先のみ",
  pickup_only: "発送元のみ",
  dual: "両方 (dual)",
}

export const HOTEL_ROUTE_LABEL: Record<HotelRoute, string> = {
  pickup: "発送元ホテル",
  guest: "お届け先ホテル",
}

/** mode → note_target。対応表はここ1箇所だけ。 */
export function modeToNoteTarget(mode: HotelNotificationMode | null | undefined): NoteTarget {
  switch (mode) {
    case "pickup_only":
      return "from"
    case "dual":
      return "both"
    case "guest_only":
    default:
      return "to"
  }
}

/**
 * leg の実効 note_target を解決する。
 * 優先順位: leg 個別指定 (from/to/both) > 代理店の既定 mode > お届け先のみ('to')。
 * 「代理店を増やす」= mode の値を1件持つだけ。呼び出し側に分岐は不要。
 */
export function resolveNoteTarget(
  legNoteTarget: string | null | undefined,
  agencyMode: HotelNotificationMode | null | undefined,
): NoteTarget {
  if (legNoteTarget === "from" || legNoteTarget === "to" || legNoteTarget === "both") {
    return legNoteTarget
  }
  return modeToNoteTarget(agencyMode)
}

/**
 * その note_target で「申し送りが載る=通知対象になる」ルート。
 * voucher-pdf の分岐と一致:
 *   発送元(pickup)ブロック … from | both
 *   お届け先(guest)ブロック … to  | both  (from 以外)
 */
export function applicableRoutes(target: NoteTarget): Record<HotelRoute, boolean> {
  return {
    pickup: target === "from" || target === "both",
    guest: target === "to" || target === "both",
  }
}

export function isHotelNotificationMode(v: unknown): v is HotelNotificationMode {
  return v === "guest_only" || v === "pickup_only" || v === "dual"
}
