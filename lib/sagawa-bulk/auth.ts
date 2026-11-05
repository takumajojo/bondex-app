/**
 * P1-B cron エンドポイントの認証判定 (純粋関数・テスト可能)。
 *
 * 他 cron (sagawa-lead-times 等) と同じ CRON_SECRET + Bearer 方式を、
 * route から切り出して単体テストできるようにしたもの。副作用なし。
 *
 *  - CRON_SECRET 未設定 (undefined/空/空白) → 常に false (fail closed: 無認証では叩けない)
 *  - Authorization が `Bearer <CRON_SECRET>` に完全一致したときだけ true
 *  - それ以外 (ヘッダなし・プレフィックス違い・トークン不一致) → false
 *
 * 比較は固定時間でなくてよい (偽造には秘密値が必要で、タイミングで縮む探索空間がない)。
 */
export function cronBearerAuthorized(authHeader: string | null | undefined, secret: string | undefined): boolean {
  const s = secret?.trim()
  if (!s) return false
  return (authHeader || "") === `Bearer ${s}`
}
