/**
 * 施設名(ホテル名)の言語だし分け。「見る人の言語」で主表示を決める。
 *
 * 判定キーは代理店が海外か (agencies.is_domestic === false)。谷口さん決定 2026-10-07:
 *   - 海外代理店 … 英語名を主にし、日本語名を副に併記 (英語圏の人に合わせる)。
 *   - 国内代理店 … 日本語名を主にし、英語名を副に併記。
 * ゲスト向け(バウチャー)は代理店ではなく guest_language で決める (別経路・既存踏襲)。
 *
 * 併記のため主/副の2つを返す。副は主と異なるときだけ入れる (同一なら空)。
 */
export interface HotelDisplay {
  /** 主表示名 (大きく出す)。 */
  primary: string
  /** 副表示名 (小さく併記)。主と同じ/無い場合は空文字。 */
  secondary: string
}

/**
 * @param nameJa 日本語名 (from_hotel_ja など・null 可)
 * @param nameEn 英語名   (from_hotel / from_hotel_en など)
 * @param overseas 海外代理店の予約か (= 英語を主にするか)。agencies.is_domestic === false。
 */
export function hotelDisplay(
  nameJa: string | null | undefined,
  nameEn: string | null | undefined,
  overseas: boolean,
): HotelDisplay {
  const ja = (nameJa ?? "").trim()
  const en = (nameEn ?? "").trim()
  const primary = overseas ? en || ja : ja || en
  const other = overseas ? ja : en
  const secondary = other && other !== primary ? other : ""
  return { primary, secondary }
}
