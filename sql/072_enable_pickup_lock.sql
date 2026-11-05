-- 区間のロック (sql/068 のトリガー) を有効にし、集荷依頼の記録・送信の一時停止を解く (2026-11-04 谷口さん指示)。未適用。
-- 本番移行の最後の段: 067 → 069 → 068 (ロック無効) → 061・062・071 (B2C) → アプリ切替 → この 072 → 070。
-- 1つのトランザクションで実行する (psql なら -1、Supabase の migration はそのまま)。
-- 18:00〜19:30 (締切と集荷依頼の時間帯) を避けて実行する。ロック待ちが長いときは失敗させてやり直す。
-- 再実行しても結果は同じ (運営の一時停止は解かない)。戻すとき: sql/rollback/pause_pickup_lock.sql

-- 移行の表の確保 (2026-11-04 デッドロック対策・072)。関係する表を「待たずに」まとめて掴む (nowait)。
-- 掴めなければ何も持たずに 0.2秒待って掴み直す (待っている間は表を持たないので、利用者の操作とデッドロックしない)。
-- 掴んだ後は、この SQL が終わるまで (1秒未満) 利用者の操作のほうが待つだけで、失敗しない。
-- 10秒たっても掴めなければ、何も変えずに失敗する (少し待って流し直す)。1つのトランザクションの中で流すこと。
do $migration_lock$
declare
  targets text;
  deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  -- 存在する表だけ (例: 067 の前は pickup_requests が無い)
  select string_agg(t, ', ') into targets from unnest(array['public.shipments', 'public.shipment_change_requests', 'public.operator_passkeys']) t where to_regclass(t) is not null;
  if targets is null then return; end if;
  loop
    begin
      execute format('lock table %s in access exclusive mode nowait', targets);
      return;
    exception when lock_not_available then
      -- 経過した時間で区切る（回数で数えると、1回ごとの手間の分だけ 10秒を超える: 実測 10.2〜12.4秒）
      if clock_timestamp() >= deadline then
        raise exception 'migration: 表 (%) を10秒以内に確保できませんでした。何も変えていません。少し待って流し直してください', targets;
      end if;
      perform pg_sleep(least(0.2, greatest(0.01, extract(epoch from (deadline - clock_timestamp())))));
    end;
  end loop;
end $migration_lock$;

set lock_timeout = '5s';

alter table public.shipments enable trigger shipments_pickup_lock;

-- 停止を解くのは「ロックがまだ無効」の時だけ (初回、または切り戻し pause_pickup_lock の後)。
-- 公開の後に運営が緊急停止 (sql/ops/pickup_claims_pause.sql) している時に流し直しても、停止は解かない
-- (2026-11-07 監査 B-09。以前は流し直すと黙って送信が再開した)。再開は sql/ops/pickup_claims_resume.sql で行う。
update public.pickup_request_settings
   set lock_enabled = true, claims_paused = false, paused_reason = null,
       updated_at = now(), updated_by = 'sql/072'
 where id and not lock_enabled;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.shipments'::regclass and tgname = 'shipments_pickup_lock' and tgenabled = 'O') then
    raise exception 'sql/072: shipments_pickup_lock が有効になっていません';
  end if;
  if not exists (select 1 from public.pickup_request_settings where id and lock_enabled) then
    raise exception 'sql/072: ロックの設定 (lock_enabled) を有効にできていません';
  end if;
  if exists (select 1 from public.pickup_request_settings where id and claims_paused) then
    raise notice 'sql/072: 集荷依頼の記録・送信は一時停止のままです (運営の停止を解いていません)。再開は sql/ops/pickup_claims_resume.sql';
  end if;
end $$;

reset lock_timeout;
