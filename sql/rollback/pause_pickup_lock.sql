-- 区間のロックを無効にし、集荷依頼の記録・送信を一時停止する (sql/072 の逆)。緊急時のみ・承認のうえで実行。
-- 使う場面: アプリを段階C の前に戻すとき (先にこれを実行してから Vercel の Instant Rollback)。
-- ロックを無効にするので、記録・送信も同じトランザクションで止める (有効な依頼が新しく増えない)。
-- 既にある有効な依頼の区間は、この間は DB で守られない。運営は依頼済みの区間を直接編集しないこと。
-- 移行の表の確保 (2026-11-04 デッドロック対策・ロックだけの切り戻し)。関係する表を「待たずに」まとめて掴む (nowait)。
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
update public.pickup_request_settings
   set claims_paused = true, lock_enabled = false, paused_reason = '切り戻し: 区間のロックを無効化',
       updated_at = now(), updated_by = 'sql/rollback/pause_pickup_lock'
 where id;
alter table public.shipments disable trigger shipments_pickup_lock;
reset lock_timeout;
