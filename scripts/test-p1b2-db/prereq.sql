-- sql/066 (P1-B2 課金保留) を隔離 PostgreSQL に適用するための前提 (本番 shipments の忠実な縮小版)。
-- RPC が参照する列のみを持つ shipments を作る。sql/066 が P1-B2 列を ALTER で足す。
create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  booking_id      text not null default 'BDX-TEST',
  leg_index       int  not null default 0,
  agency          text,
  booking_type    text not null default 'fit',
  suitcase_count  int  not null default 1,
  amount_yen      int  not null default 0,
  shipment_date   date not null default '2026-12-01',
  status          text not null default 'issued',
  is_addition     boolean not null default false,
  from_place_id   text,
  from_hotel_ja   text,
  from_hotel      text,
  from_prefecture text,
  from_city       text,
  from_residence  jsonb,
  to_hotel        text,   -- operator_count_queue (sql/071) の表示用 (本番は sql/001 で存在)
  charged_at      timestamptz,
  -- B2-3 reconcile_charge_attempt が実行時に参照する決済記録列 (本番は sql/015 で存在)。
  stripe_payment_intent_id text,
  charge_amount_yen int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 代理店マスタ (本番は sql/002)。sql/068 の所有権解決・sql/069 の allowlist が id/name を使う。
create table if not exists public.agencies (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- 月次請求書の送付記録 (本番は sql/030 + sql/049)。sql/067 が status 等を ALTER で足す。
create table if not exists public.invoice_sends (
  agency     text not null,
  month      text not null,
  invoice_no text,
  sent_to    text[],
  approved_at       timestamptz,
  approved_by       text,
  sent_to_agency_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (agency, month)
);
