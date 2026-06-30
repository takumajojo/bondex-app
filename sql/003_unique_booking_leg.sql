-- BondEx migration 003 — shipments の upsert (booking_id + leg_index) 用 UNIQUE 制約
--
-- 既存環境では一度だけ実行. 新規環境では 001 → 002 → 003 の順で適用.
--
-- saveShipment は onConflict: "booking_id,leg_index" で upsert するが、
-- それには対象列に対応する UNIQUE / EXCLUSION 制約が必要.

-- 既存重複があると ALTER に失敗するので事前チェック (情報表示用)
do $$
declare
  dup_count int;
begin
  select count(*) into dup_count
  from (
    select booking_id, leg_index
    from shipments
    group by booking_id, leg_index
    having count(*) > 1
  ) t;
  if dup_count > 0 then
    raise notice '⚠️  Found % duplicate (booking_id, leg_index) combinations. Remove them before adding the unique constraint.', dup_count;
  end if;
end $$;

-- 複合 UNIQUE 制約を追加 (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shipments_booking_leg_unique'
    and conrelid = 'shipments'::regclass
  ) then
    alter table shipments
    add constraint shipments_booking_leg_unique unique (booking_id, leg_index);
  end if;
end $$;
