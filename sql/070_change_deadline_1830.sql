-- 変更受付締切 (shipments.change_deadline_at) を「集荷前日 18:30 JST」に計算し直す (2026-11-04 谷口さん決定・段階C)。未適用。
-- アプリ (lib/change-deadline.ts) は新しい予約・日程の変更から 18:30 で保存する。この SQL は既存の未完了の区間を合わせる。
-- 判定は集荷日から計算するように変えたので (画面・API)、この値は表示と監査用。適用しなくても判定は 18:30 になる。
-- 元の値は change_deadline_backup_070 に残す (ロールバック: sql/rollback/rollback_067_072.sql)。

-- 移行の表の確保 (2026-11-04 デッドロック対策・070)。関係する表を「待たずに」まとめて掴む (nowait)。
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

create table if not exists public.change_deadline_backup_070 (
  shipment_id        uuid primary key,
  change_deadline_at timestamptz,
  backed_up_at       timestamptz not null default now()
);
alter table public.change_deadline_backup_070 enable row level security;

insert into public.change_deadline_backup_070 (shipment_id, change_deadline_at)
select id, change_deadline_at
  from public.shipments
 where status in ('requested', 'pending', 'issued')
   and shipment_date >= (now() at time zone 'Asia/Tokyo')::date
on conflict (shipment_id) do nothing;

-- 18:30 JST = 09:30Z。佐川に渡す内容ではないので、sql/068 のトリガーの対象外。
update public.shipments s
   set change_deadline_at = public.pickup_cutoff_at(s.shipment_date)
  from public.change_deadline_backup_070 b
 where b.shipment_id = s.id
   and s.change_deadline_at is distinct from public.pickup_cutoff_at(s.shipment_date);
