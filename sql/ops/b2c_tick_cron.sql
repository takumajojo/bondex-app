-- B2C の定期の処理 (/api/b2c/cron/tick) の定時実行 (pg_cron)。**未実行・本番での登録は谷口さんの承認後** (2026-11-07 監査 B-07)。
-- 請求 (集荷確認の 30分後)・請求の見張り・結果不明の照合・返金の照合・リマインド・通知の送信待ち (outbox) は、すべてこの中で動く。
-- 登録しないと、B2C の請求も通知も一切動かない。
--
-- 前提:
--   1. sql/080_cron_heartbeats.sql の適用 (実行の記録)。アプリのデプロイ (/api/b2c/cron/tick)。
--   2. Vault の "cron_secret" (sql/052 と同じ値 = Vercel の CRON_SECRET)。SQL・リポジトリに秘密を書かない。
--   3. 登録の時点では B2C_SCHEDULER_ENABLED を入れない (未設定の間、エンドポイントは何もせず {"skipped":"scheduler disabled"} を返すだけ)。
--      登録 → 応答が 200 で skipped になるのを確かめる → B2C_SCHEDULER_ENABLED=true を入れて再デプロイ、の順。
-- 間隔: 5分おき・終日 (請求・通知は夜も止めない。B2C の請求の判定は 30分の猶予の後なので 5分の遅れは問題にならない)。
-- 認証: Authorization: Bearer <cron_secret>。違えば 401 (route.ts)。
-- 重複実行の防止: net.http_post は応答を待たずに次の回へ進むので、前の回が終わる前に次が始まりうる。
--   エンドポイント側の acquireCronLock("b2c-tick") で 2本目は {"skipped":"already running"} になる (lib/cron-lock.ts)。
--   請求は請求の行の確保と Stripe の冪等キーで 1回だけ (lib/b2c/charge-service.ts)。
-- 停止の検知: 実行ごとに cron_heartbeats の "b2c-tick" を記録し、GitHub Actions の 1時間おきの見張り
--   (/api/cron/heartbeat-check・.github/workflows/cron-heartbeat.yml) が、B2C_SCHEDULER_ENABLED=true の間に
--   「一度も記録が無い」「30分 (B2C_TICK_STALE_MIN) を超えて成功が無い」「3回続けて失敗」を運営に知らせる (lib/cron-heartbeat.ts)。
--   pg_cron と見張りは別の仕組みなので、どちらか一方が止まってももう一方で気づける。
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'b2c-tick-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bondex.express/api/b2c/cron/tick',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 130000
  );
  $$
);
-- 確認:     select jobid, jobname, schedule, active from cron.job where jobname = 'b2c-tick-5min';
-- HTTP結果: select id, status_code, left(content, 300), created from net._http_response order by created desc limit 10;
-- 実行記録: select name, last_ok_at, last_error_at, consecutive_failures from public.cron_heartbeats where name = 'b2c-tick';
-- 一時停止: select cron.alter_job((select jobid from cron.job where jobname = 'b2c-tick-5min'), active := false);
--           (または Vercel の B2C_SCHEDULER_ENABLED を外して再デプロイ。どちらも、止めている間の請求・通知は再開した回でまとめて処理する)
-- 止める:   select cron.unschedule('b2c-tick-5min');
