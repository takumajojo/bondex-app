-- 集荷依頼の監視ジョブの定時実行 (pg_cron)。**未実行・本番での登録は谷口さんの承認後**。
-- 追跡の定時処理 (sync-tracking-15min / 30min・停止中) とは別のジョブ。追跡を止めていても動く。
-- 前提: sql/075_pickup_watch_alerts.sql の適用、アプリのデプロイ (/api/cron/pickup-watch)、
--       Vault の "cron_secret" (sql/052 と同じ)。
-- 実行時間帯: 日本時間 8:00〜22:50 の10分おき (cron は UTC: 23:00〜13:50)。
--   送信中のまま止まった依頼 (5分) を早めに見つけ、19:00 の送信の結果を 20:00 の締め前に確かめるため10分にする。
-- 同じ案件への通知は sql/075 と stale_alerted_at で1回だけなので、10分おきでもメールは重ならない。
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'pickup-watch-10min',
  '*/10 23,0-13 * * *',
  $$
  select net.http_get(
    url := 'https://bondex.express/api/cron/pickup-watch',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
-- 確認:   select jobid, jobname, schedule, active from cron.job where jobname = 'pickup-watch-10min';
-- HTTP結果: select id, status_code, left(content, 300), created from net._http_response order by created desc limit 10;
-- 止める:  select cron.unschedule('pickup-watch-10min');
