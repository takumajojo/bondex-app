-- =============================================================================
-- 074_b2c_stage5_payments.sql — B2C Stage 5: 集荷の確認と、集荷の後の請求・回収・返金
-- 設計: docs/b2c/B2C_STAGE5_PAYMENT_DESIGN.md（たくまさん承認 2026-11-04。個数は実際に佐川が集荷した個数で請求）
--
-- - 集荷の確認（運営の個人のパスキー・根拠・受託の個数・理由）と、30分の猶予の中の取消。
-- - 請求の行の取り出し（30分の後・条件の再確認・FOR UPDATE SKIP LOCKED・1つの処理だけ）。
--   条件を満たさない請求は on_hold にして運営に回す（個数の違い・追跡との矛盾など）。
-- - 個数が予約と違う時は自動で確定しない（on_hold → 運営が根拠を確かめて確定）。
-- - 返金（運営だけ。合計は請求額まで。返金のキーは連番で固定）。
-- - 未収の数（新しい予約の受付を止める判断）。
-- b2c_confirm_order / b2c_cancel_order / b2c_request_cancel / 締切の値には触れない（統合ブランチの 071 と競合させない）。
-- 再実行できる。適用はローカルの試験の DB だけ。本番への適用は別の承認。
-- =============================================================================

-- 0. 個数から税込の額（lib/tax.ts と同じ: 税は切り捨て）------------------------------
create or replace function public.b2c_amount_for(p_unit_net int, p_pieces int) returns int
language sql immutable as $$ select p_unit_net * p_pieces + (p_unit_net * p_pieces) / 10 $$;

-- 1. 集荷の確認 -----------------------------------------------------------------
create table if not exists public.b2c_pickup_confirmations (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.b2c_orders(id),
  shipment_id           uuid not null references public.shipments(id),
  operator_email        text not null,
  credential_id         text not null,
  evidence_type         text not null check (evidence_type in ('sagawa_tracking', 'sagawa_driver', 'hotel_report', 'other')),
  evidence_ref          text not null check (length(btrim(evidence_ref)) > 0),
  booked_pieces         int not null,
  accepted_pieces       int not null check (accepted_pieces between 1 and 50),
  reason                text not null check (length(btrim(reason)) > 0),
  prev_shipment_status  text not null,
  confirmed_at          timestamptz not null default now(),
  revoked_at            timestamptz,
  revoked_by            text,
  revoked_credential_id text,
  revoke_reason         text,
  check ((revoked_at is null) = (revoked_by is null)),
  check (revoked_at is null or length(btrim(coalesce(revoke_reason, ''))) > 0)
);
create unique index if not exists b2c_pickup_one_active on public.b2c_pickup_confirmations(shipment_id) where revoked_at is null;
create index if not exists b2c_pickup_order on public.b2c_pickup_confirmations(order_id);
alter table public.b2c_pickup_confirmations enable row level security;

-- 2. 請求の行の追加の列と状態 ---------------------------------------------------------
alter table public.b2c_payments drop constraint if exists b2c_payments_status_check;
alter table public.b2c_payments add constraint b2c_payments_status_check
  check (status in ('scheduled', 'ready', 'processing', 'unknown', 'requires_action', 'on_hold',
                    'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'uncollectible'));
alter table public.b2c_payments add column if not exists pieces                 int;
alter table public.b2c_payments add column if not exists unit_net_yen           int;
alter table public.b2c_payments add column if not exists pickup_confirmation_id uuid references public.b2c_pickup_confirmations(id);
alter table public.b2c_payments add column if not exists hold_reason            text;
alter table public.b2c_payments add column if not exists checks_overridden      text[] not null default '{}';  -- 運営が根拠を確かめて解除した条件
alter table public.b2c_payments add column if not exists override_by            text;
alter table public.b2c_payments add column if not exists override_reason        text;
alter table public.b2c_payments add column if not exists pi_create_started_at   timestamptz;  -- PaymentIntent の作成を始めた時刻（冪等キーの 24時間の判断）
alter table public.b2c_payments add column if not exists confirm_attempt        int not null default 0;  -- 確定の試行の番号（確定の冪等キーに使う。確定の前に保存）
alter table public.b2c_payments add column if not exists confirm_started_at     timestamptz;
alter table public.b2c_payments add column if not exists first_failed_at        timestamptz;  -- 回収の案内の起点
alter table public.b2c_payments add column if not exists next_check_at          timestamptz;  -- 結果不明の照合の次の時刻
alter table public.b2c_payments add column if not exists refunded_yen           int not null default 0 check (refunded_yen >= 0);
alter table public.b2c_payments add column if not exists uncollectible_by       text;
alter table public.b2c_payments add column if not exists uncollectible_reason   text;
alter table public.b2c_payments add column if not exists uncollectible_at       timestamptz;
alter table public.b2c_payments drop constraint if exists b2c_payments_refunded_le_amount;
alter table public.b2c_payments add constraint b2c_payments_refunded_le_amount check (refunded_yen <= amount_yen);
alter table public.b2c_payments drop constraint if exists b2c_payments_uncollectible_who;
alter table public.b2c_payments add constraint b2c_payments_uncollectible_who
  check (status <> 'uncollectible' or (uncollectible_by is not null and uncollectible_at is not null and length(btrim(coalesce(uncollectible_reason, ''))) > 0));
-- 追加の請求は、同じ集荷の確認（または同じ訂正）から 1つだけ
create unique index if not exists b2c_payments_extra_once on public.b2c_payments(charge_key) where kind = 'extra';

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
  -- 請求を始めた後（PaymentIntent がある・処理中以降）は金額と個数を変えない
  if (old.stripe_payment_intent_id is not null
      or old.status in ('processing', 'unknown', 'requires_action', 'succeeded', 'refunded', 'partially_refunded', 'failed', 'uncollectible'))
     and (new.amount_yen is distinct from old.amount_yen or new.pieces is distinct from old.pieces) then
    raise exception 'b2c_payments: amount is fixed once charging started';
  end if;
  -- 回収不能から戻るのは、旅行者が後から払った時（succeeded）だけ
  if old.status = 'uncollectible' and new.status not in ('uncollectible', 'succeeded') then
    raise exception 'b2c_payments: uncollectible can only become succeeded';
  end if;
  -- 取り消した請求を再び使えるのは、PaymentIntent が無い時だけ（集荷の確認のやり直し）
  if old.status = 'cancelled' and new.status <> 'cancelled' and old.stripe_payment_intent_id is not null then
    raise exception 'b2c_payments: a cancelled payment with a payment intent cannot be reopened';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 3. 返金の状態 ---------------------------------------------------------------------
alter table public.b2c_refunds drop constraint if exists b2c_refunds_status_check;
alter table public.b2c_refunds add constraint b2c_refunds_status_check check (status in ('requested', 'pending', 'unknown', 'succeeded', 'failed'));
alter table public.b2c_refunds add column if not exists credential_id     text;
alter table public.b2c_refunds add column if not exists last_error        text;
alter table public.b2c_refunds add column if not exists stripe_started_at timestamptz;
create index if not exists b2c_refunds_payment on public.b2c_refunds(payment_id);

-- 4. 通知: 支払・返金の種類と、どの請求・返金の通知か -------------------------------------------
alter table public.b2c_outbox add column if not exists ref_id uuid;
create or replace function public.b2c_outbox_defaults() returns trigger language plpgsql as $$
declare
  o public.b2c_orders%rowtype;
begin
  new.priority := case new.kind
    when 'reminder_day'            then 10
    when 'reminder_eve'            then 20
    when 'payment_action_required' then 25
    when 'cancelled'               then 30
    when 'booking_confirmed'       then 30
    when 'payment_received'        then 35
    when 'refund_issued'           then 35
    when 'awaiting_hotel'          then 40
    else 50 end;
  if new.expires_at is null then
    select * into o from public.b2c_orders where id = new.order_id;
    new.expires_at := case new.kind
      when 'reminder_day'      then (o.pickup_date + time '11:00') at time zone 'Asia/Tokyo'
      when 'reminder_eve'      then (o.pickup_date + time '00:00') at time zone 'Asia/Tokyo'
      when 'booking_confirmed' then (o.pickup_date + time '11:00') at time zone 'Asia/Tokyo'
      when 'awaiting_hotel'    then coalesce(o.confirmation_due_at, now() + interval '1 day')
      when 'payment_action_required' then now() + interval '3 days'
      when 'payment_received'  then now() + interval '3 days'
      when 'refund_issued'     then now() + interval '3 days'
      else now() + interval '2 days' end;
  end if;
  return new;
end $$;

-- 5. 集荷の確認 -----------------------------------------------------------------------
--    戻り値 jsonb: {result: confirmed|not_found|order_not_confirmed|shipment_not_pickable|already_confirmed|already_charged|invalid_input,
--                   confirmation_id, payment_id, payment_status (scheduled|on_hold), scheduled_at, amount_yen}
create or replace function public.b2c_confirm_pickup(
  p_order_id uuid, p_operator_email text, p_credential_id text,
  p_evidence_type text, p_evidence_ref text, p_accepted_pieces int, p_reason text,
  p_now timestamptz default now(), p_grace interval default interval '30 minutes'
) returns jsonb language plpgsql as $$
declare
  o   public.b2c_orders%rowtype;
  s   public.shipments%rowtype;
  p   public.b2c_payments%rowtype;
  cid uuid;
  amt int;
  st  text;
begin
  if coalesce(btrim(p_operator_email), '') = '' or coalesce(btrim(p_credential_id), '') = '' or coalesce(btrim(p_reason), '') = ''
     or coalesce(btrim(p_evidence_ref), '') = '' or p_accepted_pieces is null or p_accepted_pieces < 1 or p_accepted_pieces > 50 then
    return jsonb_build_object('result', 'invalid_input');
  end if;
  select * into o from public.b2c_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.status <> 'confirmed' then return jsonb_build_object('result', 'order_not_confirmed', 'order_status', o.status); end if;
  select * into s from public.shipments where b2c_order_id = o.id for update;
  if not found then return jsonb_build_object('result', 'shipment_not_pickable', 'shipment_status', null); end if;
  if exists (select 1 from public.b2c_pickup_confirmations where shipment_id = s.id and revoked_at is null) then
    return jsonb_build_object('result', 'already_confirmed');
  end if;
  if s.status not in ('requested', 'pending', 'issued') then
    return jsonb_build_object('result', 'shipment_not_pickable', 'shipment_status', s.status);
  end if;
  select * into p from public.b2c_payments where order_id = o.id and kind = 'base' for update;
  if found and p.status <> 'cancelled' then return jsonb_build_object('result', 'already_charged', 'payment_status', p.status); end if;

  insert into public.b2c_pickup_confirmations(order_id, shipment_id, operator_email, credential_id, evidence_type, evidence_ref,
                                              booked_pieces, accepted_pieces, reason, prev_shipment_status, confirmed_at)
  values (o.id, s.id, p_operator_email, p_credential_id, p_evidence_type, btrim(p_evidence_ref), o.pieces, p_accepted_pieces, btrim(p_reason), s.status, p_now)
  returning id into cid;
  update public.shipments set status = 'picked_up', picked_up_at = p_now where id = s.id;

  -- 実際に集荷した個数で請求する。予約と違えば自動で確定しない（on_hold・運営が根拠を確かめる）
  amt := public.b2c_amount_for(o.unit_net_yen, p_accepted_pieces);
  st := case when p_accepted_pieces = o.pieces then 'scheduled' else 'on_hold' end;
  if p.id is null then
    insert into public.b2c_payments(order_id, kind, charge_key, amount_yen, pieces, unit_net_yen, status, scheduled_at,
                                    pickup_confirmation_id, hold_reason, created_by)
    values (o.id, 'base', 'base:' || o.id::text, amt, p_accepted_pieces, o.unit_net_yen, st, p_now + p_grace,
            cid, case when st = 'on_hold' then 'pieces_mismatch' end, p_operator_email)
    returning * into p;
  else
    update public.b2c_payments set status = st, amount_yen = amt, pieces = p_accepted_pieces, unit_net_yen = o.unit_net_yen,
           scheduled_at = p_now + p_grace, pickup_confirmation_id = cid, hold_reason = case when st = 'on_hold' then 'pieces_mismatch' end,
           checks_overridden = '{}', override_by = null, override_reason = null, last_error_code = null, last_error_message = null
     where id = p.id returning * into p;
  end if;

  insert into public.b2c_order_events(order_id, shipment_id, event, actor_type, operator_email, credential_id, reason, before_state, after_state)
  values (o.id, s.id, 'pickup_confirmed', 'operator', p_operator_email, p_credential_id, btrim(p_reason),
          jsonb_build_object('shipment_status', s.status, 'booked_pieces', o.pieces),
          jsonb_build_object('shipment_status', 'picked_up', 'accepted_pieces', p_accepted_pieces, 'evidence_type', p_evidence_type,
                             'evidence_ref', btrim(p_evidence_ref), 'payment_status', p.status, 'amount_yen', amt, 'scheduled_at', p.scheduled_at));
  return jsonb_build_object('result', 'confirmed', 'confirmation_id', cid, 'payment_id', p.id, 'payment_status', p.status,
                            'scheduled_at', p.scheduled_at, 'amount_yen', amt, 'pieces_mismatch', st = 'on_hold');
end $$;

-- 6. 集荷の確認の取消（30分の猶予の中・請求が始まる前だけ）---------------------------------------
--    戻り値: revoked / not_found / no_active / too_late / invalid_input
create or replace function public.b2c_revoke_pickup(
  p_order_id uuid, p_operator_email text, p_credential_id text, p_reason text, p_now timestamptz default now()
) returns text language plpgsql as $$
declare
  o public.b2c_orders%rowtype;
  c public.b2c_pickup_confirmations%rowtype;
  p public.b2c_payments%rowtype;
begin
  if coalesce(btrim(p_operator_email), '') = '' or coalesce(btrim(p_credential_id), '') = '' or coalesce(btrim(p_reason), '') = '' then
    return 'invalid_input';
  end if;
  select * into o from public.b2c_orders where id = p_order_id for update;
  if not found then return 'not_found'; end if;
  select * into c from public.b2c_pickup_confirmations where order_id = o.id and revoked_at is null for update;
  if not found then return 'no_active'; end if;
  select * into p from public.b2c_payments where order_id = o.id and kind = 'base' for update;
  -- 猶予の後、または請求を始めた後は取り消せない（誤りは返金で直す）
  if p.id is not null and (p.status not in ('scheduled', 'on_hold') or p.stripe_payment_intent_id is not null or p.scheduled_at <= p_now) then
    return 'too_late';
  end if;
  update public.b2c_pickup_confirmations set revoked_at = p_now, revoked_by = p_operator_email, revoked_credential_id = p_credential_id,
         revoke_reason = btrim(p_reason) where id = c.id;
  update public.shipments set status = c.prev_shipment_status, picked_up_at = null where id = c.shipment_id and status = 'picked_up';
  if p.id is not null then
    update public.b2c_payments set status = 'cancelled', last_error_code = 'pickup_revoked', hold_reason = null where id = p.id;
  end if;
  insert into public.b2c_order_events(order_id, shipment_id, event, actor_type, operator_email, credential_id, reason, before_state, after_state)
  values (o.id, c.shipment_id, 'pickup_confirmation_revoked', 'operator', p_operator_email, p_credential_id, btrim(p_reason),
          jsonb_build_object('shipment_status', 'picked_up', 'payment_status', p.status),
          jsonb_build_object('shipment_status', c.prev_shipment_status, 'payment_status', case when p.id is null then null else 'cancelled' end));
  return 'revoked';
end $$;

-- 7. 請求してよいかの再確認（null = よい。文字列 = 止める理由）-------------------------------------
create or replace function public.b2c_charge_check(p public.b2c_payments) returns text language plpgsql stable as $$
declare
  o public.b2c_orders%rowtype;
  c public.b2c_pickup_confirmations%rowtype;
  s public.shipments%rowtype;
  n_num  int;
  n_cnt  int;
  carrier int;
begin
  select * into o from public.b2c_orders where id = p.order_id;
  if o.status not in ('confirmed', 'completed') then return 'order_' || o.status; end if;
  if o.card_status <> 'registered' or o.stripe_payment_method_id is null or o.stripe_customer_id is null then return 'no_card'; end if;
  if o.consented_at is null or o.consent_version is null then return 'no_consent'; end if;
  select * into c from public.b2c_pickup_confirmations where id = p.pickup_confirmation_id;
  if not found or c.revoked_at is not null then return 'pickup_revoked'; end if;
  select * into s from public.shipments where id = c.shipment_id;
  if s.status not in ('picked_up', 'in_transit', 'delivered') then return 'shipment_' || s.status; end if;
  -- 佐川の正式な個数と矛盾しないこと。
  -- 佐川は複数個口でも問い合わせ番号は 1つ（マスター 31・33）なので、追跡番号の数は個数ではない。
  -- 正式な個数はお荷物問い合わせ API の detail_info.number（マスター 45・93）で、追跡の同期が
  -- shipments.tracking_detail[].pieceCount に入れる（feat/sagawa-tracking-api）。全番号の個数がそろった時だけ合計と比べる。
  select count(*), count(d -> 'pieceCount'), coalesce(sum((d ->> 'pieceCount')::int), 0)
    into n_num, n_cnt, carrier
    from jsonb_array_elements(case when jsonb_typeof(s.tracking_detail) = 'array' then s.tracking_detail else '[]'::jsonb end) d
   where jsonb_typeof(d -> 'pieceCount') = 'number' or d -> 'pieceCount' is null;
  if n_num > 0 and n_cnt = n_num and carrier <> c.accepted_pieces and not ('carrier_piece_mismatch' = any(p.checks_overridden)) then
    return 'carrier_piece_mismatch';
  end if;
  -- 金額は料金の控え（予約の時の 1個あたりの税抜の単価）と個数から
  if p.unit_net_yen is distinct from o.unit_net_yen or p.pieces is null or p.pieces < 1 then return 'amount_mismatch'; end if;
  if p.kind = 'base' then
    if p.pieces <> c.accepted_pieces or p.amount_yen <> public.b2c_amount_for(o.unit_net_yen, p.pieces) then return 'amount_mismatch'; end if;
    if c.accepted_pieces <> o.pieces and not ('pieces_mismatch' = any(p.checks_overridden)) then return 'pieces_mismatch'; end if;
  end if;
  if exists (select 1 from public.b2c_payments x where x.order_id = p.order_id and x.id <> p.id and x.status in ('processing', 'unknown', 'requires_action')) then
    return 'other_charge_active';
  end if;
  return null;
end $$;

-- 8. 請求の行の取り出し（30分の後。条件を満たさなければ on_hold。1つの処理だけ）----------------------
create or replace function public.b2c_claim_charges(p_now timestamptz default now(), p_limit int default 10, p_worker text default 'tick')
returns setof public.b2c_payments language plpgsql as $$
declare
  p public.b2c_payments%rowtype;
  why text;
begin
  for p in
    select * from public.b2c_payments
     where status = 'scheduled' and scheduled_at <= p_now
     order by scheduled_at, id
     limit greatest(1, least(p_limit, 50))
     for update skip locked
  loop
    why := public.b2c_charge_check(p);
    if why is not null then
      update public.b2c_payments set status = 'on_hold', hold_reason = why where id = p.id;
      insert into public.b2c_order_events(order_id, event, actor_type, reason, before_state, after_state)
      values (p.order_id, 'charge_on_hold', 'system', why, jsonb_build_object('payment_status', 'scheduled', 'payment_id', p.id),
              jsonb_build_object('payment_status', 'on_hold', 'hold_reason', why));
      continue;
    end if;
    update public.b2c_payments set status = 'processing', locked_by = p_worker, locked_at = p_now where id = p.id returning * into p;
    return next p;
  end loop;
end $$;

-- 9. 照合する請求の取り出し（結果不明・処理中のまま止まった）-------------------------------------------
create or replace function public.b2c_claim_reconcile(p_now timestamptz default now(), p_stale interval default interval '10 minutes',
                                                      p_limit int default 20, p_worker text default 'tick')
returns setof public.b2c_payments language plpgsql as $$
begin
  return query
  with c as (
    select id from public.b2c_payments
     where (status = 'unknown' and coalesce(next_check_at, '-infinity') <= p_now)
        or (status = 'processing' and locked_at < p_now - p_stale)
     order by updated_at
     limit greatest(1, least(p_limit, 50))
     for update skip locked
  )
  update public.b2c_payments x set status = 'processing', locked_by = p_worker, locked_at = p_now
    from c where x.id = c.id
  returning x.*;
end $$;

-- 10. 止めた請求の扱い（運営）-------------------------------------------------------------
--     解除できる理由は「運営が根拠を確かめれば請求してよいもの」だけ（予約との個数の違い・佐川の正式な個数との食い違い）。
--     予約の取消・集荷の確認の取消・区間の取消・カードなし・金額の不一致・他の請求の処理中は解除できない。
--     戻り値: released / cancelled / not_found / not_on_hold / not_overridable / invalid_input
create or replace function public.b2c_resolve_charge_hold(
  p_payment_id uuid, p_action text, p_operator_email text, p_credential_id text, p_reason text, p_now timestamptz default now()
) returns text language plpgsql as $$
declare
  p public.b2c_payments%rowtype;
begin
  if coalesce(btrim(p_operator_email), '') = '' or coalesce(btrim(p_credential_id), '') = '' or coalesce(btrim(p_reason), '') = ''
     or p_action not in ('release', 'cancel') then
    return 'invalid_input';
  end if;
  select * into p from public.b2c_payments where id = p_payment_id for update;
  if not found then return 'not_found'; end if;
  if p.status <> 'on_hold' then return 'not_on_hold'; end if;
  if p_action = 'release' then
    if p.hold_reason not in ('pieces_mismatch', 'carrier_piece_mismatch') then return 'not_overridable'; end if;
    update public.b2c_payments set status = 'scheduled', scheduled_at = greatest(scheduled_at, p_now),
           checks_overridden = array(select distinct unnest(checks_overridden || array[p.hold_reason])),
           override_by = p_operator_email, override_reason = btrim(p_reason), hold_reason = null
     where id = p.id;
  else
    update public.b2c_payments set status = 'cancelled', last_error_code = 'ops_cancelled', hold_reason = null where id = p.id;
  end if;
  insert into public.b2c_order_events(order_id, event, actor_type, operator_email, credential_id, reason, before_state, after_state)
  values (p.order_id, 'charge_hold_' || p_action, 'operator', p_operator_email, p_credential_id, btrim(p_reason),
          jsonb_build_object('payment_id', p.id, 'payment_status', 'on_hold', 'hold_reason', p.hold_reason, 'amount_yen', p.amount_yen, 'pieces', p.pieces),
          jsonb_build_object('payment_status', case when p_action = 'release' then 'scheduled' else 'cancelled' end));
  return case when p_action = 'release' then 'released' else 'cancelled' end;
end $$;

-- 11. 請求の後に分かった個数の違い（運営）--------------------------------------------------------
--     増えた → 追加の請求（予約の同意: 同じ 1個あたりの料金。額はサーバーが決める・30分の猶予）。
--     減った → 返金すべき額を返す（返金は運営が返金の操作で行う。自動では返金しない）。
--     戻り値 jsonb: {result: extra_scheduled|refund_due|no_difference|not_found|not_charged|invalid_input, ...}
create or replace function public.b2c_record_piece_correction(
  p_order_id uuid, p_actual_pieces int, p_evidence_type text, p_evidence_ref text,
  p_operator_email text, p_credential_id text, p_reason text, p_now timestamptz default now(), p_grace interval default interval '30 minutes'
) returns jsonb language plpgsql as $$
declare
  o       public.b2c_orders%rowtype;
  b       public.b2c_payments%rowtype;
  billed  int;
  diff    int;
  amt     int;
  n_extra int;
  x       public.b2c_payments%rowtype;
begin
  if coalesce(btrim(p_operator_email), '') = '' or coalesce(btrim(p_credential_id), '') = '' or coalesce(btrim(p_reason), '') = ''
     or coalesce(btrim(p_evidence_ref), '') = '' or p_actual_pieces is null or p_actual_pieces < 1 or p_actual_pieces > 50
     or p_evidence_type not in ('sagawa_tracking', 'sagawa_driver', 'hotel_report', 'other') then
    return jsonb_build_object('result', 'invalid_input');
  end if;
  select * into o from public.b2c_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  select * into b from public.b2c_payments where order_id = o.id and kind = 'base' for update;
  if not found or b.status not in ('succeeded', 'partially_refunded', 'refunded') then
    return jsonb_build_object('result', 'not_charged', 'payment_status', b.status);
  end if;
  -- 請求した個数 = 基本料金の個数 + 取り消していない追加の請求の個数
  select b.pieces + coalesce(sum(pieces), 0), count(*) into billed, n_extra from public.b2c_payments
   where order_id = o.id and kind = 'extra' and status not in ('cancelled');
  diff := p_actual_pieces - billed;
  if diff = 0 then return jsonb_build_object('result', 'no_difference', 'billed_pieces', billed); end if;
  if diff > 0 then
    amt := public.b2c_amount_for(o.unit_net_yen, p_actual_pieces) - public.b2c_amount_for(o.unit_net_yen, billed);
    insert into public.b2c_payments(order_id, kind, charge_key, amount_yen, pieces, unit_net_yen, status, scheduled_at,
                                    pickup_confirmation_id, created_by, checks_overridden)
    values (o.id, 'extra', 'extra:' || o.id::text || ':' || (n_extra + 1), amt, diff, o.unit_net_yen, 'scheduled', p_now + p_grace,
            b.pickup_confirmation_id, p_operator_email, array['carrier_piece_mismatch'])
    returning * into x;
  else
    amt := public.b2c_amount_for(o.unit_net_yen, billed) - public.b2c_amount_for(o.unit_net_yen, p_actual_pieces);
  end if;
  insert into public.b2c_order_events(order_id, event, actor_type, operator_email, credential_id, reason, before_state, after_state)
  values (o.id, case when diff > 0 then 'pieces_increased_after_charge' else 'pieces_decreased_after_charge' end, 'operator',
          p_operator_email, p_credential_id, btrim(p_reason),
          jsonb_build_object('billed_pieces', billed),
          jsonb_build_object('actual_pieces', p_actual_pieces, 'evidence_type', p_evidence_type, 'evidence_ref', btrim(p_evidence_ref),
                             'amount_yen', amt, 'extra_payment_id', x.id));
  if diff > 0 then
    return jsonb_build_object('result', 'extra_scheduled', 'payment_id', x.id, 'amount_yen', amt, 'pieces', diff, 'scheduled_at', x.scheduled_at);
  end if;
  return jsonb_build_object('result', 'refund_due', 'amount_yen', amt, 'payment_id', b.id, 'billed_pieces', billed);
end $$;

-- 12. 返金の受付（運営）。合計は請求額まで。返金のキーは連番で固定 --------------------------------------
--     戻り値 jsonb: {result: requested|not_found|not_refundable|exceeds_refundable|invalid_input, refund_id, refund_key, refundable_yen}
create or replace function public.b2c_request_refund(
  p_payment_id uuid, p_amount int, p_reason text, p_operator_email text, p_credential_id text
) returns jsonb language plpgsql as $$
declare
  p    public.b2c_payments%rowtype;
  used int;
  n    int;
  rid  uuid;
  rkey text;
begin
  if coalesce(btrim(p_operator_email), '') = '' or coalesce(btrim(p_credential_id), '') = '' or coalesce(btrim(p_reason), '') = ''
     or p_amount is null or p_amount <= 0 then
    return jsonb_build_object('result', 'invalid_input');
  end if;
  select * into p from public.b2c_payments where id = p_payment_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if p.status not in ('succeeded', 'partially_refunded') or p.stripe_payment_intent_id is null then
    return jsonb_build_object('result', 'not_refundable', 'payment_status', p.status);
  end if;
  select coalesce(sum(amount_yen) filter (where status in ('requested', 'pending', 'unknown', 'succeeded')), 0), count(*)
    into used, n from public.b2c_refunds where payment_id = p.id;
  if used + p_amount > p.amount_yen then
    return jsonb_build_object('result', 'exceeds_refundable', 'refundable_yen', p.amount_yen - used);
  end if;
  rkey := 'refund:' || p.id::text || ':' || (n + 1);
  insert into public.b2c_refunds(payment_id, amount_yen, reason, requested_by, credential_id, refund_key, status)
  values (p.id, p_amount, btrim(p_reason), p_operator_email, p_credential_id, rkey, 'requested') returning id into rid;
  insert into public.b2c_order_events(order_id, event, actor_type, operator_email, credential_id, reason, before_state, after_state)
  values (p.order_id, 'refund_requested', 'operator', p_operator_email, p_credential_id, btrim(p_reason),
          jsonb_build_object('payment_id', p.id, 'amount_yen', p.amount_yen, 'refunded_or_pending_yen', used),
          jsonb_build_object('refund_id', rid, 'refund_amount_yen', p_amount, 'refund_key', rkey));
  return jsonb_build_object('result', 'requested', 'refund_id', rid, 'refund_key', rkey, 'refundable_yen', p.amount_yen - used - p_amount);
end $$;

-- 返金の結果を反映し、請求の状態（一部・全額）を合わせる
create or replace function public.b2c_apply_refund_result(p_refund_id uuid, p_status text, p_stripe_refund_id text, p_error text default null)
returns text language plpgsql as $$
declare
  r public.b2c_refunds%rowtype;
  p public.b2c_payments%rowtype;
  done_yen int;
begin
  select * into r from public.b2c_refunds where id = p_refund_id for update;
  if not found then return 'not_found'; end if;
  if r.status = 'succeeded' and p_status <> 'succeeded' then return 'already_succeeded'; end if;
  if r.stripe_refund_id is not null and p_stripe_refund_id is not null and r.stripe_refund_id <> p_stripe_refund_id then return 'refund_id_mismatch'; end if;
  update public.b2c_refunds set status = p_status, stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id),
         last_error = p_error, updated_at = now() where id = r.id;
  select * into p from public.b2c_payments where id = r.payment_id for update;
  select coalesce(sum(amount_yen), 0) into done_yen from public.b2c_refunds where payment_id = p.id and status = 'succeeded';
  update public.b2c_payments set refunded_yen = done_yen,
         status = case when done_yen = 0 then status when done_yen >= amount_yen then 'refunded' else 'partially_refunded' end
   where id = p.id and status in ('succeeded', 'partially_refunded', 'refunded');
  if p_status = 'succeeded' and r.status <> 'succeeded' then
    insert into public.b2c_order_events(order_id, event, actor_type, reason, after_state)
    values (p.order_id, 'refund_succeeded', 'stripe', null, jsonb_build_object('refund_id', r.id, 'amount_yen', r.amount_yen, 'stripe_refund_id', p_stripe_refund_id, 'refunded_total_yen', done_yen));
  end if;
  return 'ok';
end $$;

-- 13. 回収不能（運営。14日を過ぎた未収だけ。自動にはしない）----------------------------------------
--     戻り値: marked / not_found / not_unpaid / too_early / invalid_input
create or replace function public.b2c_mark_uncollectible(
  p_payment_id uuid, p_operator_email text, p_credential_id text, p_reason text, p_now timestamptz default now()
) returns text language plpgsql as $$
declare
  p public.b2c_payments%rowtype;
begin
  if coalesce(btrim(p_operator_email), '') = '' or coalesce(btrim(p_credential_id), '') = '' or coalesce(btrim(p_reason), '') = '' then
    return 'invalid_input';
  end if;
  select * into p from public.b2c_payments where id = p_payment_id for update;
  if not found then return 'not_found'; end if;
  if p.status not in ('failed', 'requires_action') then return 'not_unpaid'; end if;
  if p.first_failed_at is null or p.first_failed_at > p_now - interval '14 days' then return 'too_early'; end if;
  update public.b2c_payments set status = 'uncollectible', uncollectible_by = p_operator_email, uncollectible_reason = btrim(p_reason), uncollectible_at = p_now
   where id = p.id;
  insert into public.b2c_order_events(order_id, event, actor_type, operator_email, credential_id, reason, before_state, after_state)
  values (p.order_id, 'payment_uncollectible', 'operator', p_operator_email, p_credential_id, btrim(p_reason),
          jsonb_build_object('payment_id', p.id, 'payment_status', p.status, 'amount_yen', p.amount_yen, 'first_failed_at', p.first_failed_at),
          jsonb_build_object('payment_status', 'uncollectible'));
  return 'marked';
end $$;

-- 14. 未収（新しい予約の受付を止める判断。B2C_PHASE1A_BETA_PLAN.md 5章: 未回収の請求が 2件、または合計 3万円で停止）--------
--     未回収 = 請求が失敗・本人認証待ち（failed / requires_action）と、回収不能（uncollectible）。失敗した時点から数える。
--     戻り値: {"count": 件数, "amount_yen": 合計（税込）}
drop function if exists public.b2c_unpaid_count(timestamptz);
create or replace function public.b2c_unpaid_summary() returns jsonb language sql stable as $$
  select jsonb_build_object('count', count(*)::int, 'amount_yen', coalesce(sum(amount_yen), 0)::int)
    from public.b2c_payments where status in ('failed', 'requires_action', 'uncollectible')
$$;

-- 権限: サーバー（service_role）だけ ------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'b2c_amount_for(int, int)',
    'b2c_confirm_pickup(uuid, text, text, text, text, int, text, timestamptz, interval)',
    'b2c_revoke_pickup(uuid, text, text, text, timestamptz)',
    'b2c_charge_check(public.b2c_payments)',
    'b2c_claim_charges(timestamptz, int, text)',
    'b2c_claim_reconcile(timestamptz, interval, int, text)',
    'b2c_resolve_charge_hold(uuid, text, text, text, text, timestamptz)',
    'b2c_record_piece_correction(uuid, int, text, text, text, text, text, timestamptz, interval)',
    'b2c_request_refund(uuid, int, text, text, text)',
    'b2c_apply_refund_result(uuid, text, text, text)',
    'b2c_mark_uncollectible(uuid, text, text, text, timestamptz)',
    'b2c_unpaid_summary()'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function public.%s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.b2c_pickup_confirmations to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.b2c_pickup_confirmations from anon, authenticated;
  end if;
end $$;
