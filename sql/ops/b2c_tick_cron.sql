-- B2C の定期の処理（/api/b2c/cron/tick）の定時実行 (pg_cron)。**未実行・本番での登録は谷口さんの承認後**（2026-11-06 監査 B-07）。
-- staging には登録しない（staging の試験では手で呼ぶ: docs/release/staging_verification_plan_20261105.md の S4）。
-- 中身: カードの入力の放置の取消・ホテルの確認の期限切れ・リマインド・集荷の後の請求（30分の後）・結果不明の照合・返金の照合・
--       回収の案内・請求の見張り・通知の送信（app/api/b2c/cron/tick/route.ts）。
-- 前提:
--   1. sql/061〜082 の適用、アプリのデプロイ（/api/b2c/cron/tick）
--   2. Vercel の B2C_SCHEDULER_ENABLED=true（false の間は呼ばれても {skipped:"scheduler disabled"} を返すだけ。先に登録しても無害）
--   3. Vault の "cron_secret"（sql/052 と同じ。Vercel の CRON_SECRET と同じ値）
-- 間隔: 5分おき・終日（請求は集荷の確認の 30分後。見張り lib/cron-heartbeat.ts の b2c-tick は 30分止まると運営に知らせる）。
-- 二重起動: アプリ側の lib/cron-lock.ts（b2c-tick）と、請求の取り出しの for update skip locked・Stripe の冪等キーで止める。
-- 失敗: 段階ごとに記録し 500 を返す → cron_heartbeats に失敗を記録 → 3回続けば運営に知らせる（/api/cron/heartbeat-check、
--       GitHub Actions の cron-heartbeat.yml が 1時間おきに呼ぶ。こちらは main に入った後だけ動く）。
-- 呼び出しは POST（route は POST だけ）。timeout は関数の maxDuration(120s)＋30s。
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'b2c-tick-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://bondex.express/api/b2c/cron/tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 150000
  );
  $$
);
-- 確認:   select jobid, jobname, schedule, active from cron.job where jobname = 'b2c-tick-5min';
-- 実行履歴: select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'b2c-tick-5min') order by start_time desc limit 10;
-- HTTP結果: select id, status_code, left(content, 300), created from net._http_response order by created desc limit 10;
-- 止める:  select cron.unschedule('b2c-tick-5min');
--   すぐ止めたい時は、Vercel の B2C_SCHEDULER_ENABLED を false にしても止まる（請求だけ止めるのは B2C_CHARGE_LIVE=false）。
