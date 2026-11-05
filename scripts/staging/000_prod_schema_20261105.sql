-- 試験環境（bondex-staging）の土台: 本番（dscxftwfspgihkszfakk）の public スキーマの定義の写し。
-- 2026-11-05 に本番のカタログを読み取りだけの SELECT で取得（表 23・制約・索引 44・関数 2・トリガー 6・RLS・ポリシー 5・注釈）。
-- **データは含まない**（顧客・予約・決済の情報は写さない）。本番の定期処理（pg_cron の 2件）は写さない（本番の URL と鍵を持つため）。
-- 本番の移行の前（067〜079 を流す前）の状態。権限は既定の権限（本番と試験環境で同じ）で付く。
-- 流すのは scripts/staging/apply.sh だけ（試験環境の印 staging_guard を確かめてから）。

-- 表 ---------------------------------------------------------------------------------------------
create table public.agencies (
  id uuid default uuid_generate_v4() not null,
  name text not null,
  contact_email text,
  contact_phone text,
  contact_person text,
  billing_address text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  country text,
  is_domestic boolean default true not null,
  payment_method text default 'invoice'::text not null,
  status text default 'active'::text not null,
  stripe_customer_id text,
  card_on_file boolean default false not null,
  default_currency text default 'jpy'::text not null,
  created_via text,
  contract_status text default 'unsigned'::text not null,
  contract_signed_at timestamp with time zone,
  contract_signer_name text,
  contract_signer_title text,
  contract_version text,
  billing_exempt boolean default false not null,
  hotel_notification_mode text default 'guest_only'::text not null,
  locale text default 'ja'::text not null,
  notify_whatsapp text,
  notify_line_user_id text,
  ship_address jsonb,
  unit_price_yen integer
);
create table public.agency_contract_signatures (
  id uuid default gen_random_uuid() not null,
  agency text not null,
  signer_name text not null,
  signer_title text,
  signature_image text,
  contract_version text not null,
  contract_hash text,
  drive_url text,
  ip text,
  user_agent text,
  signed_at timestamp with time zone default now() not null
);
create table public.agency_emails (
  id uuid default gen_random_uuid() not null,
  agency_id uuid not null,
  email text not null,
  label text,
  created_at timestamp with time zone default now() not null,
  created_by text
);
create table public.booking_requests (
  request_key text not null,
  booking_id text not null,
  agency text not null,
  created_at timestamp with time zone default now() not null
);
create table public.claim_cases (
  id uuid default uuid_generate_v4() not null,
  shipment_id uuid,
  booking_id text,
  leg_index integer,
  category text not null,
  reported_by text,
  reporter_name text,
  reporter_contact text,
  description text not null,
  resolution text,
  claim_amount_yen integer,
  yamato_case_number text,
  status text default 'open'::text not null,
  occurred_at timestamp with time zone,
  reported_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.contact_inquiries (
  id uuid default gen_random_uuid() not null,
  company text,
  name text,
  email text not null,
  message text not null,
  source text,
  user_agent text,
  created_at timestamp with time zone default now() not null,
  handled boolean default false not null
);
create table public.cron_locks (
  name text not null,
  locked_at timestamp with time zone default now() not null
);
create table public.group_luggage (
  id uuid default uuid_generate_v4() not null,
  booking_id text not null,
  leg_index integer default 0 not null,
  luggage_no integer not null,
  guest_name text default ''::text not null,
  tracking_number text,
  manual_status text,
  issue_note text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.group_shares (
  token text not null,
  booking_id text not null,
  expires_at timestamp with time zone not null,
  created_by text default 'operator'::text not null,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);
create table public.invoice_sends (
  agency text not null,
  month text not null,
  invoice_no text,
  sent_to text[],
  created_at timestamp with time zone default now() not null,
  approved_at timestamp with time zone,
  approved_by text,
  sent_to_agency_at timestamp with time zone
);
create table public.operator_passkeys (
  credential_id text not null,
  public_key bytea not null,
  counter bigint default 0 not null,
  transports text[],
  label text,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone
);
create table public.parse_log (
  id uuid default uuid_generate_v4() not null,
  agency text,
  file_name text,
  file_hash text,
  file_size integer,
  file_type text,
  ai_raw_output jsonb,
  operator_corrected jsonb,
  approved boolean default false not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.sagawa_bulk_pickup_events (
  id uuid default gen_random_uuid() not null,
  group_id uuid not null,
  kind text not null,
  detail jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);
create table public.sagawa_bulk_pickup_members (
  id uuid default gen_random_uuid() not null,
  group_id uuid not null,
  shipment_id uuid not null,
  booking_id text not null,
  leg_index integer default 0 not null,
  agency text,
  pieces integer default 0 not null,
  pickup_time text,
  added_at timestamp with time zone default now() not null,
  removed_at timestamp with time zone
);
create table public.sagawa_bulk_pickups (
  id uuid default gen_random_uuid() not null,
  hotel_key text not null,
  key_source text not null,
  confident boolean default false not null,
  pickup_date date not null,
  hotel_label text,
  from_prefecture text,
  from_city text,
  total_pieces integer default 0 not null,
  leg_count integer default 0 not null,
  agency_count integer default 0 not null,
  booking_count integer default 0 not null,
  is_bulk boolean default false not null,
  is_duplicate boolean default false not null,
  member_hash text not null,
  status text default 'pending'::text not null,
  notified_at timestamp with time zone,
  notified_by text,
  notified_snapshot jsonb,
  notified_method text,
  sagawa_reply text,
  needs_recontact boolean default false not null,
  notify_state text default 'idle'::text not null,
  notify_key text,
  notify_kind text,
  notify_claimed_at timestamp with time zone,
  notify_attempt_owner text,
  notify_error text,
  last_alerted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.sagawa_lead_times (
  from_zip text not null,
  to_zip text not null,
  from_office text,
  to_office text,
  days smallint not null,
  source text default 'live'::text not null,
  fetched_at timestamp with time zone default now() not null
);
create table public.sagawa_office_lead_times (
  from_office text not null,
  to_office text not null,
  days smallint not null,
  sample_from_zip text,
  sample_to_zip text,
  fetched_at timestamp with time zone default now() not null
);
create table public.sagawa_zip_offices (
  zip text not null,
  office text not null,
  prefecture text,
  city text,
  town text,
  fetched_at timestamp with time zone default now() not null
);
create table public.shipment_change_requests (
  id uuid default gen_random_uuid() not null,
  shipment_id uuid not null,
  booking_id text not null,
  leg_index integer not null,
  requested_by text not null,
  requester text,
  agency text,
  fields jsonb default '{}'::jsonb not null,
  before jsonb default '{}'::jsonb not null,
  over_deadline boolean default false not null,
  reason text,
  status text default 'pending'::text not null,
  decided_by text,
  decided_at timestamp with time zone,
  decision_note text,
  created_at timestamp with time zone default now() not null
);
create table public.shipment_hotel_changes (
  id uuid default gen_random_uuid() not null,
  shipment_id uuid not null,
  booking_id text not null,
  leg_index integer not null,
  side text not null,
  old_hotel text,
  new_hotel text,
  old_hotel_ja text,
  new_hotel_ja text,
  old_place_id text,
  new_place_id text,
  over_deadline boolean default false not null,
  reason text,
  old_slip_task boolean default false not null,
  changed_by text,
  agency text,
  changed_at timestamp with time zone default now() not null,
  old_hotel_cancel_task boolean default false not null
);
create table public.shipments (
  id uuid default uuid_generate_v4() not null,
  booking_id text not null,
  leg_index integer default 0 not null,
  agency text not null,
  representative text not null,
  traveler_count integer default 1 not null,
  booking_name text,
  shipment_date date not null,
  expected_arrival date not null,
  from_hotel text not null,
  from_city text,
  from_place_id text,
  from_check_in date,
  to_hotel text not null,
  to_city text,
  to_place_id text,
  to_check_out date,
  recipient text not null,
  suitcase_count integer default 1 not null,
  amount_yen integer default 0 not null,
  tracking_numbers jsonb,
  label_url text,
  issuable_from date,
  ship_ref_number text,
  status text default 'issued'::text not null,
  error_message text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  tour_number text,
  group_name text,
  tracking_detail jsonb,
  guest_language text,
  pickup_alert_sent_at timestamp with time zone,
  drive_url text,
  delivery_time text,
  carrier text default 'sagawa'::text not null,
  note_target text,
  from_hotel_en text,
  to_hotel_en text,
  charged_at timestamp with time zone,
  stripe_payment_intent_id text,
  charge_amount_yen integer,
  charge_error text,
  from_residence jsonb,
  to_residence jsonb,
  item_type text,
  count_change_log jsonb default '[]'::jsonb not null,
  pickup_hotel_notified_at timestamp with time zone,
  guest_hotel_notified_at timestamp with time zone,
  booking_type text default 'fit'::text not null,
  tour_leader_name text,
  tour_leader_phone text,
  tour_leader_whatsapp text,
  is_addition boolean default false not null,
  addition_note text,
  stripe_checkout_session_id text,
  stripe_checkout_url text,
  from_prefecture text,
  from_hotel_ja text,
  to_prefecture text,
  to_hotel_ja text,
  refunded_at timestamp with time zone,
  refund_amount_yen integer,
  disputed_at timestamp with time zone,
  dispute_status text,
  payment_failed_at timestamp with time zone,
  payment_failure_message text,
  label_to text default 'agency'::text not null,
  label_split boolean default false not null,
  label_sender text default 'bondex'::text not null,
  label_sender_info jsonb,
  label_sent_at timestamp with time zone,
  label_mail_due date,
  issue_claimed_at timestamp with time zone,
  hotel_contact_info jsonb default '{}'::jsonb not null,
  change_deadline_at timestamp with time zone,
  picked_up_at timestamp with time zone,
  pickup_ack_at timestamp with time zone,
  pickup_requested_at timestamp with time zone,
  delivered_at timestamp with time zone,
  origin_check_in date,
  delivery_overdue_alerted_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  cancelled_by text,
  cancel_source text,
  pickup_time text,
  sagawa_cost_actual_yen integer,
  delivered_notified_at timestamp with time zone,
  tracking_limit_reached boolean default false not null
);
create table public.user_agencies (
  user_id uuid not null,
  agency_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.whatsapp_processed (
  message_id text not null,
  created_at timestamp with time zone default now() not null
);

-- 主キー・一意・検査 -------------------------------------------------------------------------------
alter table public.agencies add constraint agencies_pkey PRIMARY KEY (id);
alter table public.agency_contract_signatures add constraint agency_contract_signatures_pkey PRIMARY KEY (id);
alter table public.agency_emails add constraint agency_emails_pkey PRIMARY KEY (id);
alter table public.booking_requests add constraint booking_requests_pkey PRIMARY KEY (request_key);
alter table public.claim_cases add constraint claim_cases_pkey PRIMARY KEY (id);
alter table public.contact_inquiries add constraint contact_inquiries_pkey PRIMARY KEY (id);
alter table public.cron_locks add constraint cron_locks_pkey PRIMARY KEY (name);
alter table public.group_luggage add constraint group_luggage_pkey PRIMARY KEY (id);
alter table public.group_shares add constraint group_shares_pkey PRIMARY KEY (token);
alter table public.invoice_sends add constraint invoice_sends_pkey PRIMARY KEY (agency, month);
alter table public.operator_passkeys add constraint operator_passkeys_pkey PRIMARY KEY (credential_id);
alter table public.parse_log add constraint parse_log_pkey PRIMARY KEY (id);
alter table public.sagawa_bulk_pickup_events add constraint sagawa_bulk_pickup_events_pkey PRIMARY KEY (id);
alter table public.sagawa_bulk_pickup_members add constraint sagawa_bulk_pickup_members_pkey PRIMARY KEY (id);
alter table public.sagawa_bulk_pickups add constraint sagawa_bulk_pickups_pkey PRIMARY KEY (id);
alter table public.sagawa_lead_times add constraint sagawa_lead_times_pkey PRIMARY KEY (from_zip, to_zip);
alter table public.sagawa_office_lead_times add constraint sagawa_office_lead_times_pkey PRIMARY KEY (from_office, to_office);
alter table public.sagawa_zip_offices add constraint sagawa_zip_offices_pkey PRIMARY KEY (zip);
alter table public.shipment_change_requests add constraint shipment_change_requests_pkey PRIMARY KEY (id);
alter table public.shipment_hotel_changes add constraint shipment_hotel_changes_pkey PRIMARY KEY (id);
alter table public.shipments add constraint shipments_pkey PRIMARY KEY (id);
alter table public.user_agencies add constraint user_agencies_pkey PRIMARY KEY (user_id);
alter table public.whatsapp_processed add constraint whatsapp_processed_pkey PRIMARY KEY (message_id);
alter table public.agencies add constraint agencies_name_key UNIQUE (name);
alter table public.group_luggage add constraint group_luggage_booking_id_leg_index_luggage_no_key UNIQUE (booking_id, leg_index, luggage_no);
alter table public.sagawa_bulk_pickup_members add constraint sagawa_bulk_pickup_members_group_id_shipment_id_key UNIQUE (group_id, shipment_id);
alter table public.sagawa_bulk_pickups add constraint sagawa_bulk_pickups_hotel_key_pickup_date_key UNIQUE (hotel_key, pickup_date);
alter table public.shipments add constraint shipments_booking_leg_unique UNIQUE (booking_id, leg_index);
alter table public.agencies add constraint agencies_unit_price_yen_positive CHECK (((unit_price_yen IS NULL) OR (unit_price_yen > 0)));
alter table public.claim_cases add constraint claim_cases_category_check CHECK ((category = ANY (ARRAY['damage'::text, 'loss'::text, 'delay'::text, 'wrong_delivery'::text, 'other'::text])));
alter table public.claim_cases add constraint claim_cases_reported_by_check CHECK ((reported_by = ANY (ARRAY['agency'::text, 'traveler'::text, 'hotel'::text, 'bondex'::text, 'yamato'::text])));
alter table public.claim_cases add constraint claim_cases_status_check CHECK ((status = ANY (ARRAY['open'::text, 'investigating'::text, 'resolved'::text, 'closed'::text, 'rejected'::text])));
alter table public.group_luggage add constraint group_luggage_manual_status_check CHECK (((manual_status IS NULL) OR (manual_status = ANY (ARRAY['pending'::text, 'issued'::text, 'picked_up'::text, 'in_transit'::text, 'delivered'::text, 'issue'::text]))));
alter table public.sagawa_bulk_pickups add constraint sagawa_bulk_pickups_key_source_check CHECK ((key_source = ANY (ARRAY['place_id'::text, 'name'::text])));
alter table public.sagawa_bulk_pickups add constraint sagawa_bulk_pickups_notify_state_check CHECK ((notify_state = ANY (ARRAY['idle'::text, 'pending'::text, 'sent'::text, 'failed'::text])));
alter table public.sagawa_bulk_pickups add constraint sagawa_bulk_pickups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'notified'::text, 'needs_reconfirm'::text, 'stale'::text, 'cleared'::text])));
alter table public.sagawa_lead_times add constraint sagawa_lead_times_days_check CHECK (((days >= 0) AND (days <= 14)));
alter table public.sagawa_lead_times add constraint sagawa_lead_times_from_zip_check CHECK ((from_zip ~ '^[0-9]{7}$'::text));
alter table public.sagawa_lead_times add constraint sagawa_lead_times_to_zip_check CHECK ((to_zip ~ '^[0-9]{7}$'::text));
alter table public.sagawa_office_lead_times add constraint sagawa_office_lead_times_days_check CHECK (((days >= 0) AND (days <= 14)));
alter table public.sagawa_zip_offices add constraint sagawa_zip_offices_zip_check CHECK ((zip ~ '^[0-9]{7}$'::text));
alter table public.shipment_change_requests add constraint shipment_change_requests_requested_by_check CHECK ((requested_by = ANY (ARRAY['agency'::text, 'operator'::text])));
alter table public.shipment_change_requests add constraint shipment_change_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.shipment_hotel_changes add constraint shipment_hotel_changes_side_check CHECK ((side = ANY (ARRAY['pickup'::text, 'guest'::text])));
alter table public.shipments add constraint shipments_booking_type_check CHECK ((booking_type = ANY (ARRAY['fit'::text, 'group'::text])));
alter table public.shipments add constraint shipments_label_sender_check CHECK ((label_sender = ANY (ARRAY['bondex'::text, 'agency'::text, 'other'::text])));
alter table public.shipments add constraint shipments_label_to_check CHECK ((label_to = ANY (ARRAY['agency'::text, 'hotel'::text])));
alter table public.shipments add constraint shipments_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'pending'::text, 'issued'::text, 'picked_up'::text, 'in_transit'::text, 'delivered'::text, 'failed'::text, 'cancelled'::text])));

-- 外部キー -----------------------------------------------------------------------------------------
alter table public.agency_emails add constraint agency_emails_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE;
alter table public.claim_cases add constraint claim_cases_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL;
alter table public.sagawa_bulk_pickup_events add constraint sagawa_bulk_pickup_events_group_id_fkey FOREIGN KEY (group_id) REFERENCES sagawa_bulk_pickups(id) ON DELETE CASCADE;
alter table public.sagawa_bulk_pickup_members add constraint sagawa_bulk_pickup_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES sagawa_bulk_pickups(id) ON DELETE CASCADE;
alter table public.sagawa_bulk_pickup_members add constraint sagawa_bulk_pickup_members_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE;
alter table public.shipment_change_requests add constraint shipment_change_requests_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE;
alter table public.shipment_hotel_changes add constraint shipment_hotel_changes_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE;
alter table public.user_agencies add constraint user_agencies_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE;
alter table public.user_agencies add constraint user_agencies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 索引 ---------------------------------------------------------------------------------------------
CREATE INDEX agency_contract_sig_idx ON public.agency_contract_signatures USING btree (agency, signed_at DESC);
CREATE INDEX agency_emails_agency_idx ON public.agency_emails USING btree (agency_id);
CREATE UNIQUE INDEX agency_emails_agency_lower_email_uidx ON public.agency_emails USING btree (agency_id, lower(email));
CREATE INDEX claim_cases_booking_idx ON public.claim_cases USING btree (booking_id);
CREATE INDEX claim_cases_created_at_idx ON public.claim_cases USING btree (created_at DESC);
CREATE INDEX claim_cases_shipment_idx ON public.claim_cases USING btree (shipment_id);
CREATE INDEX claim_cases_status_idx ON public.claim_cases USING btree (status);
CREATE INDEX contact_inquiries_created_idx ON public.contact_inquiries USING btree (created_at DESC);
CREATE INDEX group_luggage_booking_idx ON public.group_luggage USING btree (booking_id);
CREATE INDEX group_luggage_tracking_idx ON public.group_luggage USING btree (tracking_number);
CREATE INDEX group_shares_booking_idx ON public.group_shares USING btree (booking_id);
CREATE INDEX invoice_sends_pending_send_idx ON public.invoice_sends USING btree (approved_at) WHERE ((approved_at IS NOT NULL) AND (sent_to_agency_at IS NULL));
CREATE INDEX parse_log_agency_idx ON public.parse_log USING btree (agency);
CREATE INDEX parse_log_approved_idx ON public.parse_log USING btree (approved) WHERE (approved = true);
CREATE INDEX parse_log_created_at_idx ON public.parse_log USING btree (created_at DESC);
CREATE INDEX parse_log_file_hash_idx ON public.parse_log USING btree (file_hash);
CREATE INDEX sagawa_bulk_pickup_events_group_idx ON public.sagawa_bulk_pickup_events USING btree (group_id, created_at);
CREATE INDEX sagawa_bulk_pickup_members_group_idx ON public.sagawa_bulk_pickup_members USING btree (group_id);
CREATE INDEX sagawa_bulk_pickup_members_shipment_idx ON public.sagawa_bulk_pickup_members USING btree (shipment_id);
CREATE INDEX sagawa_bulk_pickups_date_idx ON public.sagawa_bulk_pickups USING btree (pickup_date);
CREATE INDEX sagawa_bulk_pickups_open_idx ON public.sagawa_bulk_pickups USING btree (pickup_date) WHERE (status = ANY (ARRAY['pending'::text, 'needs_reconfirm'::text, 'stale'::text]));
CREATE INDEX idx_sagawa_lead_times_fetched_at ON public.sagawa_lead_times USING btree (fetched_at);
CREATE INDEX idx_sagawa_office_lead_times_fetched_at ON public.sagawa_office_lead_times USING btree (fetched_at);
CREATE INDEX idx_shipment_change_requests_booking ON public.shipment_change_requests USING btree (booking_id);
CREATE INDEX idx_shipment_change_requests_pending ON public.shipment_change_requests USING btree (created_at) WHERE (status = 'pending'::text);
CREATE INDEX idx_shipment_change_requests_shipment ON public.shipment_change_requests USING btree (shipment_id);
CREATE INDEX idx_shipment_hotel_changes_booking ON public.shipment_hotel_changes USING btree (booking_id);
CREATE INDEX idx_shipment_hotel_changes_shipment ON public.shipment_hotel_changes USING btree (shipment_id);
CREATE INDEX idx_shipments_agency ON public.shipments USING btree (agency);
CREATE INDEX idx_shipments_created_at ON public.shipments USING btree (created_at);
CREATE INDEX idx_shipments_delivered_at ON public.shipments USING btree (delivered_at);
CREATE INDEX idx_shipments_limit_reached ON public.shipments USING btree (tracking_limit_reached) WHERE (tracking_limit_reached = true);
CREATE INDEX idx_shipments_picked_up_at ON public.shipments USING btree (picked_up_at);
CREATE INDEX idx_shipments_shipment_date ON public.shipments USING btree (shipment_date);
CREATE INDEX idx_shipments_to_prefecture ON public.shipments USING btree (to_prefecture);
CREATE INDEX shipments_agency_idx ON public.shipments USING btree (agency);
CREATE INDEX shipments_booking_id_idx ON public.shipments USING btree (booking_id);
CREATE INDEX shipments_booking_type_idx ON public.shipments USING btree (booking_type);
CREATE INDEX shipments_created_at_idx ON public.shipments USING btree (created_at DESC);
CREATE INDEX shipments_label_sent_at_idx ON public.shipments USING btree (label_sent_at) WHERE (label_sent_at IS NULL);
CREATE INDEX shipments_shipment_date_idx ON public.shipments USING btree (shipment_date DESC);
CREATE INDEX shipments_status_idx ON public.shipments USING btree (status);
CREATE INDEX shipments_tour_number_idx ON public.shipments USING btree (tour_number);
CREATE INDEX user_agencies_agency_idx ON public.user_agencies USING btree (agency_id);

-- 関数 ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_hotel_change(p_shipment_id uuid, p_side text, p_new_hotel text, p_new_hotel_ja text, p_new_place_id text, p_new_city text, p_new_prefecture text, p_over_deadline boolean, p_reason text, p_old_slip_task boolean, p_changed_by text, p_agency text, p_require_unissued boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  s shipments%rowtype;
  v_old_hotel text; v_old_hotel_ja text; v_old_place_id text;
  v_cancel_task boolean;
  v_change_id uuid;
begin
  if p_side not in ('guest','pickup') then raise exception 'invalid_side'; end if;
  select * into s from shipments where id = p_shipment_id for update;
  if not found then raise exception 'shipment_not_found'; end if;

  if coalesce(p_require_unissued,false) and s.status not in ('requested','pending') then
    raise exception 'unissued_required: issued or beyond - self-service change not allowed';
  end if;

  if (s.tracking_numbers is not null
      and jsonb_typeof(s.tracking_numbers) = 'array'
      and jsonb_array_length(s.tracking_numbers) > 0)
     or s.status in ('picked_up','in_transit','delivered') then
    raise exception 'physical_gate: label issued or picked up - cancel and reissue required';
  end if;

  if coalesce(p_over_deadline,false) and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'over_deadline_reason_required';
  end if;

  if p_side = 'guest' then
    v_old_hotel := s.to_hotel; v_old_hotel_ja := s.to_hotel_ja; v_old_place_id := s.to_place_id;
    v_cancel_task := s.guest_hotel_notified_at is not null;
    update shipments set
      to_hotel = p_new_hotel, to_hotel_ja = p_new_hotel_ja, to_place_id = p_new_place_id,
      to_city = coalesce(p_new_city, to_city), to_prefecture = p_new_prefecture,
      guest_hotel_notified_at = null,
      hotel_contact_info = coalesce(hotel_contact_info,'{}'::jsonb) - 'guest',
      updated_at = now()
    where id = p_shipment_id;
  else
    v_old_hotel := s.from_hotel; v_old_hotel_ja := s.from_hotel_ja; v_old_place_id := s.from_place_id;
    v_cancel_task := s.pickup_hotel_notified_at is not null;
    update shipments set
      from_hotel = p_new_hotel, from_hotel_ja = p_new_hotel_ja, from_place_id = p_new_place_id,
      from_city = coalesce(p_new_city, from_city), from_prefecture = p_new_prefecture,
      pickup_hotel_notified_at = null,
      hotel_contact_info = coalesce(hotel_contact_info,'{}'::jsonb) - 'pickup',
      updated_at = now()
    where id = p_shipment_id;
  end if;

  insert into shipment_hotel_changes(
    shipment_id, booking_id, leg_index, side,
    old_hotel, new_hotel, old_hotel_ja, new_hotel_ja, old_place_id, new_place_id,
    over_deadline, reason, old_slip_task, old_hotel_cancel_task, changed_by, agency
  ) values (
    p_shipment_id, s.booking_id, s.leg_index, p_side,
    v_old_hotel, p_new_hotel, v_old_hotel_ja, p_new_hotel_ja, v_old_place_id, p_new_place_id,
    coalesce(p_over_deadline,false), p_reason, coalesce(p_old_slip_task,false), coalesce(v_cancel_task,false), p_changed_by, p_agency
  ) returning id into v_change_id;

  return v_change_id;
end;
$function$
;

-- トリガー -----------------------------------------------------------------------------------------
CREATE TRIGGER agencies_set_updated_at BEFORE UPDATE ON public.agencies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER claim_cases_set_updated_at BEFORE UPDATE ON public.claim_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER group_luggage_set_updated_at BEFORE UPDATE ON public.group_luggage FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER parse_log_set_updated_at BEFORE UPDATE ON public.parse_log FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sagawa_bulk_pickups_set_updated_at BEFORE UPDATE ON public.sagawa_bulk_pickups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER shipments_set_updated_at BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS（全表で有効）とポリシー -----------------------------------------------------------------------
alter table public.agencies enable row level security;
alter table public.agency_contract_signatures enable row level security;
alter table public.agency_emails enable row level security;
alter table public.booking_requests enable row level security;
alter table public.claim_cases enable row level security;
alter table public.contact_inquiries enable row level security;
alter table public.cron_locks enable row level security;
alter table public.group_luggage enable row level security;
alter table public.group_shares enable row level security;
alter table public.invoice_sends enable row level security;
alter table public.operator_passkeys enable row level security;
alter table public.parse_log enable row level security;
alter table public.sagawa_bulk_pickup_events enable row level security;
alter table public.sagawa_bulk_pickup_members enable row level security;
alter table public.sagawa_bulk_pickups enable row level security;
alter table public.sagawa_lead_times enable row level security;
alter table public.sagawa_office_lead_times enable row level security;
alter table public.sagawa_zip_offices enable row level security;
alter table public.shipment_change_requests enable row level security;
alter table public.shipment_hotel_changes enable row level security;
alter table public.shipments enable row level security;
alter table public.user_agencies enable row level security;
alter table public.whatsapp_processed enable row level security;
create policy "users see own linking" on public.user_agencies as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));
create policy "agencies see own group luggage" on public.group_luggage as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM shipments s
  WHERE ((s.booking_id = group_luggage.booking_id) AND (s.agency = ( SELECT a.name
           FROM (agencies a
             JOIN user_agencies ua ON ((ua.agency_id = a.id)))
          WHERE (ua.user_id = auth.uid())))))));
create policy "agency users read own emails" on public.agency_emails as PERMISSIVE for SELECT to authenticated using ((agency_id = ( SELECT user_agencies.agency_id
   FROM user_agencies
  WHERE (user_agencies.user_id = auth.uid()))));
create policy "agencies see own info" on public.agencies as PERMISSIVE for SELECT to authenticated using ((id = ( SELECT user_agencies.agency_id
   FROM user_agencies
  WHERE (user_agencies.user_id = auth.uid()))));
create policy "agencies see only their shipments" on public.shipments as PERMISSIVE for SELECT to authenticated using ((agency = ( SELECT a.name
   FROM (agencies a
     JOIN user_agencies ua ON ((ua.agency_id = a.id)))
  WHERE (ua.user_id = auth.uid()))));

-- 注釈 ---------------------------------------------------------------------------------------------
comment on table public.operator_passkeys is '運営管理画面のパスキー公開鍵。1台でも登録されるとブラウザからの入場は生体認証必須になる。RLSポリシーなし=サーバー専用。';
comment on table public.booking_requests is '予約APIの冪等キー。タイムアウト再送で予約・伝票が二重にならないための記録。RLSポリシーなし=サーバー専用。';
comment on table public.cron_locks is 'cron の二重起動防止ロック。locked_at が15分より古ければ stale として取得可。RLSポリシーなし=サーバー専用。';
comment on table public.invoice_sends is '月次請求書の送付記録 (二重送付防止)。RLSポリシーなし=サーバー専用。';
