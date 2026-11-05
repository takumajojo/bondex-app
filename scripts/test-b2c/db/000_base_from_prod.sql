-- 試験の環境だけで使う土台。本番の shipments・agencies・operator_passkeys の列と制約を、
-- 2026-11-03 に本番の DB の定義から読み取って写したもの（データは無い。読み取りだけで本番は変更していない）。
-- 本番の土台の表は Supabase の migration の外で作られているため、試験の環境ではこれを先に流してから sql/061 を適用する。
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

create table if not exists public.agencies (
  id uuid not null default uuid_generate_v4(), name text not null, contact_email text, contact_phone text, contact_person text,
  billing_address text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  country text, is_domestic boolean not null default true, payment_method text not null default 'invoice', status text not null default 'active',
  stripe_customer_id text, card_on_file boolean not null default false, default_currency text not null default 'jpy', created_via text,
  contract_status text not null default 'unsigned', contract_signed_at timestamptz, contract_signer_name text, contract_signer_title text,
  contract_version text, billing_exempt boolean not null default false, hotel_notification_mode text not null default 'guest_only',
  locale text not null default 'ja', notify_whatsapp text, notify_line_user_id text, ship_address jsonb, unit_price_yen integer,
  constraint agencies_name_key unique (name), constraint agencies_pkey primary key (id),
  constraint agencies_unit_price_yen_positive check ((unit_price_yen is null) or (unit_price_yen > 0))
);
alter table public.agencies enable row level security;

create table if not exists public.operator_passkeys (
  credential_id text not null, public_key bytea not null, counter bigint not null default 0, transports text[], label text,
  created_at timestamptz not null default now(), last_used_at timestamptz,
  constraint operator_passkeys_pkey primary key (credential_id)
);
alter table public.operator_passkeys enable row level security;

create table if not exists public.shipments (
  id uuid not null default uuid_generate_v4(), booking_id text not null, leg_index integer not null default 0, agency text not null,
  representative text not null, traveler_count integer not null default 1, booking_name text, shipment_date date not null,
  expected_arrival date not null, from_hotel text not null, from_city text, from_place_id text, from_check_in date, to_hotel text not null,
  to_city text, to_place_id text, to_check_out date, recipient text not null, suitcase_count integer not null default 1,
  amount_yen integer not null default 0, tracking_numbers jsonb, label_url text, issuable_from date, ship_ref_number text,
  status text not null default 'issued', error_message text, notes text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), tour_number text, group_name text, tracking_detail jsonb, guest_language text,
  pickup_alert_sent_at timestamptz, drive_url text, delivery_time text, carrier text not null default 'sagawa', note_target text,
  from_hotel_en text, to_hotel_en text, charged_at timestamptz, stripe_payment_intent_id text, charge_amount_yen integer, charge_error text,
  from_residence jsonb, to_residence jsonb, item_type text, count_change_log jsonb not null default '[]'::jsonb,
  pickup_hotel_notified_at timestamptz, guest_hotel_notified_at timestamptz, booking_type text not null default 'fit',
  tour_leader_name text, tour_leader_phone text, tour_leader_whatsapp text, is_addition boolean not null default false, addition_note text,
  stripe_checkout_session_id text, stripe_checkout_url text, from_prefecture text, from_hotel_ja text, to_prefecture text, to_hotel_ja text,
  refunded_at timestamptz, refund_amount_yen integer, disputed_at timestamptz, dispute_status text, payment_failed_at timestamptz,
  payment_failure_message text, label_to text not null default 'agency', label_split boolean not null default false,
  label_sender text not null default 'bondex', label_sender_info jsonb, label_sent_at timestamptz, label_mail_due date,
  issue_claimed_at timestamptz, hotel_contact_info jsonb not null default '{}'::jsonb, change_deadline_at timestamptz,
  picked_up_at timestamptz, pickup_ack_at timestamptz, pickup_requested_at timestamptz, delivered_at timestamptz, origin_check_in date,
  delivery_overdue_alerted_at timestamptz, cancelled_at timestamptz, cancelled_by text, cancel_source text, pickup_time text,
  sagawa_cost_actual_yen integer, delivered_notified_at timestamptz, tracking_limit_reached boolean not null default false,
  constraint shipments_booking_leg_unique unique (booking_id, leg_index),
  constraint shipments_booking_type_check check (booking_type = any (array['fit','group'])),
  constraint shipments_label_sender_check check (label_sender = any (array['bondex','agency','other'])),
  constraint shipments_label_to_check check (label_to = any (array['agency','hotel'])),
  constraint shipments_pkey primary key (id),
  constraint shipments_status_check check (status = any (array['requested','pending','issued','picked_up','in_transit','delivered','failed','cancelled']))
);
alter table public.shipments enable row level security;
