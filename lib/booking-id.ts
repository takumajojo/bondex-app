/**
 * BondEx 予約番号 (booking_id) の生成と検証。
 *
 * 依存ゼロの軽量モジュール (@react-pdf/renderer を含む voucher-pdf から分離)。
 * サーバー各ルートとクライアント (operator / agency) の両方から使う。
 *
 * 形式: `BDX-XXXXXX`  (プレフィックス + 6 文字コード)
 *   - 旧形式 `BDX-YYMMDD-XXXXXXXX` (日付 + 8桁) は長すぎるとの指摘で短縮 (2026-07)。
 *   - コードは紛らわしい文字 (0/O/1/I/L/U) を除いた 30 文字アルファベットから 6 文字。
 *     30^6 ≈ 7.29 億通り。予約番号は upsert のキー (衝突=他社予約の上書き) かつ
 *     /track の bearer capability (知っていれば追跡が見える) なので、総当り列挙・衝突を
 *     避けるためのエントロピーを確保する。
 */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ" // 30字 (0 O 1 I L U を除外)
const CODE_LEN = 6

export function generateBookingId(): string {
  const bytes = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(bytes)
  let code = ""
  for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[bytes[i] % ALPHABET.length]
  return `BDX-${code}`
}

/**
 * 予約番号の書式チェック。
 * 新形式 `BDX-XXXXXX` と、旧形式 `BDX-YYMMDD-XXXXXXXX` (2 セグメント) の両方を許可する
 * (既存予約のバウチャー再発行・追跡を壊さないため)。大小どちらの英字も可。
 */
export const BOOKING_ID_RE = /^BDX-[0-9A-Z]+(-[0-9A-Z]+)?$/i

export function isValidBookingId(value: string): boolean {
  return BOOKING_ID_RE.test(value)
}
