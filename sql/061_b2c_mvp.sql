-- 061: B2C Phase 1A（阪急交通社向けの限定 Beta）の表。docs/b2c/B2C_MVP_SCHEMA_v1.md v1.3。
--
-- **本番には未適用。** 試験の環境（Supabase の試験用ブランチ）への適用も、対象と内容を示して承認を得てから行う。
-- 既存の B2B への影響:
--   - shipments に列を足す（channel は既定 'b2b' で、既存の行はすべて 'b2b' になる。B2B のコードは列を読まない）。
--   - shipments に「B2C の行は B2B の課金の列を使わない」CHECK を足す（既存の行は channel='b2b' なので対象外）。
--   - agencies に「代理店名を 'BondEx Direct' にできない」CHECK を足す（その名前の代理店は今は無いことを適用前に確認する）。
--   - operator_passkeys に operator_email を足す（null 可。既存のログインは変わらない）。
-- 新しい表はすべて RLS を有効にし、匿名からの許可は付けない（サーバーだけが触る）。

begin;

-- ---------------------------------------------------------------------------
-- 入口（阪急専用の URL）。紹介元のコードと、URL の秘密の値を分ける。
-- ---------------------------------------------------------------------------
create table if not exists public.b2c_entry_links (
  id             uuid primary key default gen_random_uuid(),
  referrer_code  text not null check (referrer_code ~ '^[A-Z0-9]{3,16}$'),
  referrer_name  text not null,
  token_hash     text not null unique,
  status         text not null default 'active' check (status in ('active', 'disabled')),
  created_at     timestamptz not null default now(),
  disabled_at    timestamptz
);

-- ---------------------------------------------------------------------------
-- ホテルの施設としての確認（予約ごとの受入とは別）
-- ---------------------------------------------------------------------------
create table if not exists public.b2c_facilities (
  place_id          text primary key,
  name              text not null,
  address           text,
  postal_code       text check (postal_code is null or postal_code ~ '^[0-9]{7}$'),
  status            text not null default 'unknown' check (status in ('verified', 'unknown', 'unsupported')),
  checked_by        text,
  checked_at        timestamptz,
  check_note        text,
  last_verified_at  timestamptz,
  verified_until    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (status <> 'verified' or (checked_by is not null and last_verified_at is not null))
);

-- ---------------------------------------------------------------------------
-- 予約（1予約 1区間）
-- ---------------------------------------------------------------------------
create sequence if not exists public.b2c_order_number_seq start 100001;

create table if not exists public.b2c_orders (
  id                        uuid primary key default gen_random_uuid(),
  order_number              bigint not null unique default nextval('public.b2c_order_number_seq'),
  entry_link_id             uuid not null references public.b2c_entry_links(id),
  referrer_code             text not null,
  guest_name                text not null check (length(btrim(guest_name)) > 0),
  guest_email               text not null check (guest_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  guest_whatsapp            text not null check (guest_whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  language                  text not null default 'en' check (language in ('ja', 'en')),
  origin_place_id           text not null references public.b2c_facilities(place_id),
  dest_place_id             text not null references public.b2c_facilities(place_id),
  origin_snapshot           jsonb not null,  -- 名前・住所・郵便番号・チェックイン/アウト（予約の成立時）
  dest_snapshot             jsonb not null,
  pickup_date               date not null,
  delivery_date             date not null,
  pieces                    int not null check (pieces between 1 and 10),
  route_class               text not null check (route_class in ('standard', 'okinawa')),
  unit_net_yen              int not null check (unit_net_yen > 0),
  subtotal_net_yen          int not null check (subtotal_net_yen = unit_net_yen * pieces),
  tax_yen                   int not null check (tax_yen >= 0),
  total_gross_yen           int not null check (total_gross_yen = subtotal_net_yen + tax_yen),
  price_rule_version        text not null,
  status                    text not null default 'draft'
                              check (status in ('draft', 'card_pending', 'awaiting_hotel_confirmation', 'confirmed', 'completed', 'cancelled')),
  confirmation_mode         text not null check (confirmation_mode in ('instant', 'awaiting_hotel_verification', 'awaiting_hotel_acceptance')),
  confirmation_due_at       timestamptz,
  card_status               text not null default 'none' check (card_status in ('none', 'registering', 'registered', 'failed')),
  stripe_customer_id        text,
  stripe_setup_intent_id    text unique,
  stripe_payment_method_id  text,
  card_3ds_result           text check (card_3ds_result in ('authenticated', 'attempted', 'not_required', 'unknown')),
  consent_version           text,
  consented_at              timestamptz,
  access_token_hash         text not null unique,
  replaced_by               uuid references public.b2c_orders(id),
  confirmed_at              timestamptz,
  cancelled_at              timestamptz,
  cancel_reason             text,
  cancelled_by              text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (origin_place_id <> dest_place_id),
  check (delivery_date > pickup_date),
  check (confirmation_mode = 'instant' or confirmation_due_at is not null),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (status not in ('confirmed', 'completed') or (card_status = 'registered' and confirmed_at is not null and consented_at is not null))
);

-- 紹介元と入口は作成後に変えない
create or replace function public.b2c_orders_guard() returns trigger language plpgsql as $$
begin
  if new.entry_link_id is distinct from old.entry_link_id or new.referrer_code is distinct from old.referrer_code then
    raise exception 'b2c_orders: entry_link_id / referrer_code are immutable';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'b2c_orders: cancelled is terminal';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists b2c_orders_guard on public.b2c_orders;
create trigger b2c_orders_guard before update on public.b2c_orders
  for each row execute function public.b2c_orders_guard();

-- ---------------------------------------------------------------------------
-- 予約ごとのホテルの受入（集荷元・配送先）
-- ---------------------------------------------------------------------------
create table if not exists public.b2c_hotel_acceptances (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.b2c_orders(id),
  side          text not null check (side in ('origin', 'dest')),
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'refused', 'no_answer')),
  method        text,
  contact_note  text,
  decided_by    text,
  decided_at    timestamptz,
  unique (order_id, side),
  check (status = 'pending' or (decided_by is not null and decided_at is not null))
);

-- ---------------------------------------------------------------------------
-- 請求（方式 A: カード登録→集荷の確認の後に PaymentIntent）
-- ---------------------------------------------------------------------------
create table if not exists public.b2c_payments (
  id                         uuid primary key default gen_random_uuid(),
  order_id                   uuid not null references public.b2c_orders(id),
  kind                       text not null check (kind in ('base', 'extra')),
  charge_key                 text not null unique,  -- 論理の請求の ID。再試行でも変えない。Stripe の重複防止キーも同じ値
  amount_yen                 int not null check (amount_yen > 0),
  status                     text not null default 'scheduled'
                               check (status in ('scheduled', 'ready', 'processing', 'unknown', 'requires_action',
                                                 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
  scheduled_at               timestamptz not null,
  stripe_payment_intent_id   text unique,
  attempts                   int not null default 0 check (attempts >= 0),
  last_error_code            text,
  last_error_message         text,
  locked_by                  text,
  locked_at                  timestamptz,
  recovery_link_sent_at      timestamptz,
  succeeded_at               timestamptz,
  created_by                 text not null,  -- 集荷を確認した運営者（base）・追加の請求を作った運営者（extra）
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (kind <> 'base' or charge_key = 'base:' || order_id::text),
  check ((status = 'succeeded') = (succeeded_at is not null) or status in ('refunded', 'partially_refunded'))
);
-- 基本料金の請求は 1予約に 1行
create unique index if not exists b2c_payments_one_base_per_order on public.b2c_payments(order_id) where kind = 'base';
create index if not exists b2c_payments_due on public.b2c_payments(status, scheduled_at);

-- 請求済み（succeeded / refunded 系）から請求前の状態へ戻すことを禁止し、金額・キーを変えさせない
create or replace function public.b2c_payments_guard() returns trigger language plpgsql as $$
begin
  if new.charge_key is distinct from old.charge_key or new.order_id is distinct from old.order_id or new.kind is distinct from old.kind then
    raise exception 'b2c_payments: charge_key / order_id / kind are immutable';
  end if;
  if old.stripe_payment_intent_id is not null and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id then
    raise exception 'b2c_payments: payment intent cannot be replaced';
  end if;
  if old.status in ('succeeded', 'refunded', 'partially_refunded')
     and new.status not in ('succeeded', 'refunded', 'partially_refunded') then
    raise exception 'b2c_payments: a succeeded payment cannot go back to %', new.status;
  end if;
  if old.status in ('processing', 'unknown', 'requires_action', 'succeeded', 'refunded', 'partially_refunded')
     and new.amount_yen is distinct from old.amount_yen then
    raise exception 'b2c_payments: amount is fixed once charging started';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists b2c_payments_guard on public.b2c_payments;
create trigger b2c_payments_guard before update on public.b2c_payments
  for each row execute function public.b2c_payments_guard();

-- ---------------------------------------------------------------------------
-- 返金
-- ---------------------------------------------------------------------------
create table if not exists public.b2c_refunds (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid not null references public.b2c_payments(id),
  amount_yen        int not null check (amount_yen > 0),
  reason            text not null,
  requested_by      text not null,
  refund_key        text not null unique,
  stripe_refund_id  text unique,
  status            text not null default 'requested' check (status in ('requested', 'succeeded', 'failed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Stripe の Webhook の受信（同じ通知を 1回だけ処理）
-- ---------------------------------------------------------------------------
create table if not exists public.b2c_stripe_events (
  event_id      text primary key,
  type          text not null,
  object_id     text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  result        text
);

-- ---------------------------------------------------------------------------
-- 記録（追記のみ）
-- ---------------------------------------------------------------------------
create table if not exists public.b2c_order_events (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.b2c_orders(id),
  shipment_id      uuid,
  event            text not null,
  actor_type       text not null check (actor_type in ('guest', 'operator', 'system', 'stripe')),
  operator_email   text,
  credential_id    text,
  reason           text,
  before_state     jsonb,
  after_state      jsonb,
  created_at       timestamptz not null default now(),
  check (actor_type <> 'operator' or (operator_email is not null and credential_id is not null and reason is not null and length(btrim(reason)) > 0))
);
create or replace function public.b2c_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table';
end $$;
drop trigger if exists b2c_order_events_append_only on public.b2c_order_events;
create trigger b2c_order_events_append_only before update or delete on public.b2c_order_events
  for each row execute function public.b2c_append_only();

-- ---------------------------------------------------------------------------
-- 日ごとの運営の設定（受付の停止日・直前予約の担当者・受付の上限）
-- ---------------------------------------------------------------------------
create table if not exists public.b2c_ops_days (
  date              date primary key,
  closed            boolean not null default false,
  late_duty_staff   text,
  max_new_bookings  int not null default 5 check (max_new_bookings >= 0),
  max_pieces        int not null default 19 check (max_pieces >= 0),
  updated_by        text,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 既存の表への追加
-- ---------------------------------------------------------------------------
alter table public.shipments add column if not exists channel text not null default 'b2b';
alter table public.shipments add column if not exists b2c_order_id uuid references public.b2c_orders(id);
alter table public.shipments add column if not exists route_class text;
alter table public.shipments add column if not exists unit_net_yen int;
alter table public.shipments add column if not exists price_rule_version text;
do $$ begin
  alter table public.shipments add constraint shipments_channel_check check (channel in ('b2b', 'b2c'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.shipments add constraint shipments_b2c_order_consistency
    check ((channel = 'b2c') = (b2c_order_id is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.shipments add constraint shipments_b2c_no_b2b_billing
    check (channel <> 'b2c' or (charged_at is null and stripe_payment_intent_id is null and stripe_checkout_url is null));
exception when duplicate_object then null; end $$;
create unique index if not exists shipments_one_leg_per_b2c_order on public.shipments(b2c_order_id) where b2c_order_id is not null;
create index if not exists shipments_channel_date on public.shipments(channel, shipment_date);

do $$ begin
  alter table public.agencies add constraint agencies_name_not_b2c check (name <> 'BondEx Direct');
exception when duplicate_object then null; end $$;

alter table public.operator_passkeys add column if not exists operator_email text;

-- ---------------------------------------------------------------------------
-- RLS（匿名からの許可は付けない）
-- ---------------------------------------------------------------------------
alter table public.b2c_entry_links       enable row level security;
alter table public.b2c_facilities        enable row level security;
alter table public.b2c_orders            enable row level security;
alter table public.b2c_hotel_acceptances enable row level security;
alter table public.b2c_payments          enable row level security;
alter table public.b2c_refunds           enable row level security;
alter table public.b2c_stripe_events     enable row level security;
alter table public.b2c_order_events      enable row level security;
alter table public.b2c_ops_days          enable row level security;

create index if not exists b2c_orders_status_due on public.b2c_orders(status, confirmation_due_at);
create index if not exists b2c_orders_pickup on public.b2c_orders(pickup_date);

commit;
