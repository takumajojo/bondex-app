-- 区間のロック (sql/068 のトリガー) を有効にし、集荷依頼の記録・送信の一時停止を解く (2026-11-04 谷口さん指示)。未適用。
-- 本番移行の最後の段: 067 → 069 → 068 (ロック無効) → 061・062・071 (B2C) → アプリ切替 → この 072 → 070。
-- 1つのトランザクションで実行する (psql なら -1、Supabase の migration はそのまま)。
-- 18:00〜19:30 (締切と集荷依頼の時間帯) を避けて実行する。ロック待ちが長いときは失敗させてやり直す。
-- 再実行しても結果は同じ。戻すとき: sql/rollback/pause_pickup_lock.sql

set lock_timeout = '5s';

alter table public.shipments enable trigger shipments_pickup_lock;

update public.pickup_request_settings
   set lock_enabled = true, claims_paused = false, paused_reason = null,
       updated_at = now(), updated_by = 'sql/072'
 where id;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.shipments'::regclass and tgname = 'shipments_pickup_lock' and tgenabled = 'O') then
    raise exception 'sql/072: shipments_pickup_lock が有効になっていません';
  end if;
  if not exists (select 1 from public.pickup_request_settings where id and lock_enabled and not claims_paused) then
    raise exception 'sql/072: 一時停止スイッチを解除できていません';
  end if;
end $$;

reset lock_timeout;
