-- 区間のロックを無効にし、集荷依頼の記録・送信を一時停止する (sql/072 の逆)。緊急時のみ・承認のうえで実行。
-- 使う場面: アプリを段階C の前に戻すとき (先にこれを実行してから Vercel の Instant Rollback)。
-- ロックを無効にするので、記録・送信も同じトランザクションで止める (有効な依頼が新しく増えない)。
-- 既にある有効な依頼の区間は、この間は DB で守られない。運営は依頼済みの区間を直接編集しないこと。
set lock_timeout = '5s';
update public.pickup_request_settings
   set claims_paused = true, lock_enabled = false, paused_reason = '切り戻し: 区間のロックを無効化',
       updated_at = now(), updated_by = 'sql/rollback/pause_pickup_lock'
 where id;
alter table public.shipments disable trigger shipments_pickup_lock;
reset lock_timeout;
