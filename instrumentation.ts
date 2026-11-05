/**
 * サーバーの起動の時に 1回だけ動く（Next.js の instrumentation）。
 * 試験環境（BONDEX_ENV=staging）で本番の接続先・鍵・外への送信の設定があれば、起動を止める（lib/env-guard.ts）。
 * Node の実行環境ではプロセスを終了する（例外だけだと、プロセスが残ってすべての要求に 500 を返し続けるため）。
 * それ以外（本番・開発）では何もしない。
 */
import { assertEnvironmentSafe } from "@/lib/env-guard"

export function register(): void {
  try {
    assertEnvironmentSafe()
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    if (process.env.NEXT_RUNTIME === "nodejs") process.exit(1)
    throw err
  }
}
