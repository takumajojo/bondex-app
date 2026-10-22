-- 配送チェック (sync-tracking) の定時実行を GitHub Actions から Supabase pg_cron へ移す (2026-10-22 谷口さん)。
-- GitHub Actions の schedule は実測で2〜6時間おきにしか動かず、配達完了メールが遅れたため。
--
-- 実行時間帯: 日本時間 8:00〜21:30 の30分おき (22:00〜翌8:00 は止める)。
--   cron は UTC 表記: 23:00〜12:30 UTC = 8:00〜21:30 JST
-- 認証: Vercel の CRON_SECRET と同じ値を Supabase Vault に "cron_secret" という名前で保存しておく
--   (SQL Editor で: select vault.create_secret('<値>', 'cron_secret');)。SQL やリポジトリには秘密を書かない。
--
-- 佐川の追跡停止中 (lib/tracking-pause.ts の TRACKING_SYNC_PAUSED=true) は、エンドポイントが
-- 照会せずに即 {paused:true} を返すだけなので、先に登録しておいても無害。復旧時は停止スイッチを
-- 解除するだけで30分おきの照会が始まる。

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sync-tracking-30min',
  '*/30 23,0-12 * * *',
  $$
  select net.http_get(
    url := 'https://bondex.express/api/cron/sync-tracking',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 330000
  );
  $$
);

-- 確認:   select * from cron.job where jobname = 'sync-tracking-30min';
-- 実行履歴: select * from cron.job_run_details order by start_time desc limit 10;
-- HTTP結果: select id, status_code, left(content, 300), created from net._http_response order by created desc limit 10;
-- 停止:   select cron.unschedule('sync-tracking-30min');
