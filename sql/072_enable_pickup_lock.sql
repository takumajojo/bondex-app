-- 区間のロック (sql/068 のトリガー) を有効にし、集荷依頼の記録・送信の一時停止を解く (2026-11-04 谷口さん指示)。未適用。
-- 本番移行の最後の段: 067 → 069 → 068 (ロック無効) → 061・062・071 (B2C) → アプリ切替 → この 072 → 070。
-- 1つのトランザクションで実行する (psql なら -1、Supabase の migration はそのまま)。
-- 18:00〜19:30 (締切と集荷依頼の時間帯) を避けて実行する。ロック待ちが長いときは失敗させてやり直す。
-- 再実行しても結果は同じ。戻すとき: sql/rollback/pause_pickup_lock.sql

-- 移行の表の確保 (2026-11-04 デッドロック対策・072)。関係する表を「待たずに」まとめて掴む (nowait)。
-- 掴めなければ何も持たずに 0.2秒待って掴み直す (待っている間は表を持たないので、利用者の操作とデッドロックしない)。
-- 掴んだ後は、この SQL が終わるまで (1秒未満) 利用者の操作のほうが待つだけで、失敗しない。
-- 10秒たっても掴めなければ、何も変えずに失敗する (少し待って流し直す)。1つのトランザクションの中で流すこと。
do $migration_lock$
declare
  i int;
  targets text;
begin
  -- 存在する表だけ (例: 067 の前は pickup_requests が無い)
  select string_agg(t, ', ') into targets from unnest(array['public.shipments', 'public.shipment_change_requests', 'public.operator_passkeys']) t where to_regclass(t) is not null;
  if targets is null then return; end if;
  for i in 1..50 loop
    begin
      execute format('lock table %s in access exclusive mode nowait', targets);
      return;
    exception when lock_not_available then
      perform pg_sleep(0.2);
    end;
  end loop;
  raise exception 'migration: 表 (%) を10秒以内に確保できませんでした。何も変えていません。少し待って流し直してください', targets;
end $migration_lock$;

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
