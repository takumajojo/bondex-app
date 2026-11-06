-- P1-B2 v3.5 Track C｜増額承認通知の基盤 (2026-11-06)。
--
-- 実個数の確定で増額承認が必要になった案件を、対象代理店へ通知する「キュー」。本番メールは今回送らない。
-- 作成・対象抽出・冪等化・再送制御を DB で担保する。同一 (shipment, 見積バージョン) の通知は1件のみ (冪等)。
-- 送信失敗は配送・既存予約を止めない (通知は別系統・best-effort)。
--
-- 安全方針: 追加型のみ・RLS 有効 policy なし (service_role のみ)。**本番DB未適用**。隔離PGで検証。

create table if not exists public.agency_price_notifications (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  approval_id uuid,                 -- shipment_price_approvals.id (supersede を許すため hard FK にしない)
  booking_id text not null,
  agency_id uuid not null,
  quote_version int not null,
  kind text not null default 'increase_approval_request'
    check (kind in ('increase_approval_request')),
  locale text,                      -- 代理店の既定言語 (ja/en) 参考
  state text not null default 'pending'
    check (state in ('pending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  -- 冪等キー: 同一 (shipment, 見積バージョン, 種別) は1通だけ。再 enqueue は no-op。
  dedup_key text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists agency_price_notifications_dedup_uq
  on public.agency_price_notifications (dedup_key);
create index if not exists agency_price_notifications_pending_idx
  on public.agency_price_notifications (state, created_at) where state in ('pending','failed');
alter table public.agency_price_notifications enable row level security;
-- policy なし = service_role のみ。

-- 通知を1件キューに積む (冪等)。同一 (shipment, quote_version) は on conflict で1通に収める。
create or replace function enqueue_price_notification(
  p_shipment_id uuid, p_approval_id uuid, p_quote_version int, p_locale text default null
) returns table(state text, dedup text)
language plpgsql as $$
declare s record; v_agency uuid; v_key text;
begin
  select id, booking_id into s from shipments where id = p_shipment_id;
  if not found then return query select 'not_found'::text, null::text; return; end if;
  v_agency := bondex_shipment_agency_id(p_shipment_id);
  if v_agency is null then return query select 'agency_unresolved'::text, null::text; return; end if;
  v_key := p_shipment_id::text || '|' || coalesce(p_quote_version,1)::text || '|increase_approval_request';
  insert into public.agency_price_notifications(shipment_id, approval_id, booking_id, agency_id, quote_version, locale, dedup_key)
  values (p_shipment_id, p_approval_id, s.booking_id, v_agency, coalesce(p_quote_version,1), p_locale, v_key)
  on conflict (dedup_key) do nothing;
  return query select 'queued'::text, v_key;
end; $$;

-- 送信成功を記録 (再送制御: attempts を進める)。
create or replace function mark_price_notification_sent(p_id uuid) returns void
language sql as $$
  update public.agency_price_notifications
    set state='sent', sent_at=now(), attempts=attempts+1, last_error=null where id=p_id;
$$;

-- 送信失敗を記録 (配送は止めない・次回再送対象に残す)。
create or replace function mark_price_notification_failed(p_id uuid, p_error text) returns void
language sql as $$
  update public.agency_price_notifications
    set state='failed', attempts=attempts+1, last_error=left(p_error,500) where id=p_id;
$$;
