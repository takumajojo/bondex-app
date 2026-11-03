-- 変更受付締切 (shipments.change_deadline_at) を「集荷前日 18:30 JST」に計算し直す (2026-11-04 谷口さん決定・段階C)。未適用。
-- アプリ (lib/change-deadline.ts) は新しい予約・日程の変更から 18:30 で保存する。この SQL は既存の未完了の区間を合わせる。
-- 判定は集荷日から計算するように変えたので (画面・API)、この値は表示と監査用。適用しなくても判定は 18:30 になる。
-- 元の値は change_deadline_backup_066 に残す (ロールバック: sql/rollback/066_rollback.sql)。

create table if not exists public.change_deadline_backup_066 (
  shipment_id        uuid primary key,
  change_deadline_at timestamptz,
  backed_up_at       timestamptz not null default now()
);
alter table public.change_deadline_backup_066 enable row level security;

insert into public.change_deadline_backup_066 (shipment_id, change_deadline_at)
select id, change_deadline_at
  from public.shipments
 where status in ('requested', 'pending', 'issued')
   and shipment_date >= (now() at time zone 'Asia/Tokyo')::date
on conflict (shipment_id) do nothing;

-- 18:30 JST = 09:30Z。佐川に渡す内容ではないので、sql/064 のトリガーの対象外。
update public.shipments s
   set change_deadline_at = ((s.shipment_date - 1)::text || 'T09:30:00Z')::timestamptz
  from public.change_deadline_backup_066 b
 where b.shipment_id = s.id
   and s.change_deadline_at is distinct from ((s.shipment_date - 1)::text || 'T09:30:00Z')::timestamptz;
