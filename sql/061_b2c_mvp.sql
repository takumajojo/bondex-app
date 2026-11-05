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
  referrer_name_en text,
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
  shipment_id      uuid references public.shipments(id),
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
-- 通知の送信待ち（outbox）。確定などの DB の変更と同じトランザクションで積み、送信は後段の処理が再試行つきで行う。
-- ---------------------------------------------------------------------------
create table if not exists public.b2c_outbox (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.b2c_orders(id),
  kind             text not null,  -- booking_confirmed / awaiting_hotel / cancelled / reminder_eve / reminder_day / recovery_link など
  channel          text not null check (channel in ('email', 'whatsapp')),
  dedupe_key       text not null unique,  -- 同じ通知を二度送らない（例: confirmed:<order_id>:email）
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  attempts         int not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists b2c_outbox_due on public.b2c_outbox(status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- 受付の上限（集荷日ごと）を DB で保証する（Phase 1A 計画 5）。
-- 受付の枠を使う状態（card_pending 以降・取消以外）に入る時に、その集荷日の b2c_ops_days の行をロックして数える。
-- 同時に 2件が最後の 1枠を取りに来ても、片方は例外になる。
-- ---------------------------------------------------------------------------
create or replace function public.b2c_orders_capacity() returns trigger language plpgsql as $$
declare
  d          public.b2c_ops_days%rowtype;
  n_orders   int;
  n_pieces   int;
  counted    text[] := array['card_pending', 'awaiting_hotel_confirmation', 'confirmed', 'completed'];
begin
  if not (new.status = any(counted)) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = any(counted) and old.pickup_date = new.pickup_date and old.pieces >= new.pieces then
    return new;  -- 既に枠を使っている（個数を増やさない）
  end if;
  insert into public.b2c_ops_days(date) values (new.pickup_date) on conflict (date) do nothing;
  select * into d from public.b2c_ops_days where date = new.pickup_date for update;
  if d.closed then
    raise exception 'b2c_capacity: pickup date % is closed', new.pickup_date using errcode = 'P0001';
  end if;
  select count(*), coalesce(sum(pieces), 0) into n_orders, n_pieces
    from public.b2c_orders
   where pickup_date = new.pickup_date and status = any(counted) and id <> new.id;
  if n_orders + 1 > d.max_new_bookings or n_pieces + new.pieces > d.max_pieces then
    raise exception 'b2c_capacity: limit reached for %', new.pickup_date using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists b2c_orders_capacity on public.b2c_orders;
create trigger b2c_orders_capacity before insert or update of status, pickup_date, pieces on public.b2c_orders
  for each row execute function public.b2c_orders_capacity();

-- ---------------------------------------------------------------------------
-- 予約の確定と shipments の行の作成を 1つのトランザクションで行う（どちらかが失敗すれば両方とも無かったことになる）。
-- 確定の条件（カード登録・ホテルの条件・取消されていない・期限内）を満たさなければ何もしない（false）。
-- 通知は b2c_outbox に積むだけで、送信はトランザクションの外で行う。
-- ---------------------------------------------------------------------------
create or replace function public.b2c_confirm_order(p_order_id uuid) returns boolean language plpgsql as $$
declare
  o         public.b2c_orders%rowtype;
  hotels_ok boolean;
begin
  select * into o from public.b2c_orders where id = p_order_id for update;
  if not found then return false; end if;
  if o.status not in ('card_pending', 'awaiting_hotel_confirmation') or o.cancelled_at is not null then return false; end if;
  if o.card_status <> 'registered' or o.consented_at is null then return false; end if;
  if o.confirmation_due_at is not null and now() > o.confirmation_due_at then return false; end if;

  if o.confirmation_mode = 'awaiting_hotel_acceptance' then
    select count(*) = 2 into hotels_ok from public.b2c_hotel_acceptances
     where order_id = o.id and status = 'accepted';
  else
    select count(*) = 2 into hotels_ok from public.b2c_facilities
     where place_id in (o.origin_place_id, o.dest_place_id) and status = 'verified';
  end if;
  if not hotels_ok then
    update public.b2c_orders set status = 'awaiting_hotel_confirmation' where id = o.id and status = 'card_pending';
    return false;
  end if;

  update public.b2c_orders set status = 'confirmed', confirmed_at = now() where id = o.id;

  insert into public.shipments (
    booking_id, leg_index, agency, representative, traveler_count, shipment_date, expected_arrival,
    change_deadline_at, from_hotel, from_place_id, origin_check_in, to_hotel, to_place_id, from_check_in, to_check_out,
    recipient, suitcase_count, amount_yen, status, carrier, guest_language, pickup_time,
    channel, b2c_order_id, route_class, unit_net_yen, price_rule_version
  ) values (
    'B2C-' || o.order_number, 0, 'BondEx Direct', o.guest_name, 1, o.pickup_date, o.delivery_date,
    ((o.pickup_date - 1)::text || 'T08:00:00Z')::timestamptz,
    o.origin_snapshot->>'name', o.origin_place_id, (o.origin_snapshot->>'check_in')::date,
    o.dest_snapshot->>'name', o.dest_place_id, (o.dest_snapshot->>'check_in')::date, (o.dest_snapshot->>'check_out')::date,
    o.guest_name, o.pieces, o.subtotal_net_yen, 'issued', 'sagawa', 'en', '11',
    'b2c', o.id, o.route_class, o.unit_net_yen, o.price_rule_version
  );

  insert into public.b2c_order_events(order_id, event, actor_type, before_state, after_state)
  values (o.id, 'booking_confirmed', 'system', jsonb_build_object('status', o.status), jsonb_build_object('status', 'confirmed'));

  insert into public.b2c_outbox(order_id, kind, channel, dedupe_key) values
    (o.id, 'booking_confirmed', 'email',    'booking_confirmed:' || o.id || ':email'),
    (o.id, 'booking_confirmed', 'whatsapp', 'booking_confirmed:' || o.id || ':whatsapp')
  on conflict (dedupe_key) do nothing;
  return true;
end $$;

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
alter table public.b2c_outbox            enable row level security;

-- 関数はサーバー（service_role）だけが呼ぶ。PostgREST の RPC から匿名・ログイン利用者が呼べないようにする。
revoke execute on function public.b2c_confirm_order(uuid) from public;
do $$ begin
  execute 'revoke execute on function public.b2c_confirm_order(uuid) from anon, authenticated';
exception when undefined_object then null; end $$;

create index if not exists b2c_orders_status_due on public.b2c_orders(status, confirmation_due_at);
create index if not exists b2c_orders_pickup on public.b2c_orders(pickup_date);

commit;
