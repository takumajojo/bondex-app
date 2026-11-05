-- =============================================================================
-- 082_b2c_charge_safety.sql — B2C の請求の安全の修正（2026-11-06 監査 audit/b2c-1106）。
-- 変えるもの（どれも create or replace。表・列・データは変えない）:
--   1. b2c_charge_check: 取消の申請（shipment_change_requests kind=cancel・stage requested/contacted/approved）が
--      残っている予約は請求を始めない（on_hold・hold_reason=cancel_pending）。これまでは申請中でも 30分後に請求していた。
--   2. b2c_resolve_charge_hold: cancel_pending を解除できる理由に足す（申請が却下・取り下げになった後に運営が解除する。
--      解除の後の取り出しで条件を再確認するので、申請が残っていれば再び止まる）。
--   3. b2c_confirm_pickup: 追跡の同期が先に picked_up・in_transit・delivered に進めた区間でも集荷の確認ができる
--      （これまでは shipment_not_pickable で請求の予定を作れず、集荷・配達した予約が請求されないままだった）。
--      集荷の前の区間だけ picked_up にし、追跡で進んだ状態・集荷の時刻は変えない。
--   4. b2c_revoke_pickup: 3 の区間（確認の前から集荷済み以降）を取り消しても、区間の状態・集荷の時刻を戻さない。
--   5. b2c_record_piece_correction: 追加の請求のキーの番号を、取り消した追加も含めて数える
--      （これまでは取り消した追加の後の訂正が charge_key の一意の制約で失敗した）。
-- 本番・staging への適用は別の承認。試験: scripts/test-b2c/charge_db_pglite.mjs（PGlite・メモリ内）。
-- 戻すとき: sql/rollback/rollback_082.sql（074・079 の定義に戻す）。
-- =============================================================================

do $migration_lock$
declare
  targets text;
  deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  -- 存在する表だけ (例: 067 の前は pickup_requests が無い)
  select string_agg(t, ', ') into targets from unnest(array['public.shipments', 'public.shipment_change_requests', 'public.operator_passkeys']) t where to_regclass(t) is not null;
  if targets is null then return; end if;
  loop
    begin
      execute format('lock table %s in access exclusive mode nowait', targets);
      return;
    exception when lock_not_available then
      -- 経過した時間で区切る（回数で数えると、1回ごとの手間の分だけ 10秒を超える: 実測 10.2〜12.4秒）
      if clock_timestamp() >= deadline then
        raise exception 'migration: 表 (%) を10秒以内に確保できませんでした。何も変えていません。少し待って流し直してください', targets;
      end if;
      perform pg_sleep(least(0.2, greatest(0.01, extract(epoch from (deadline - clock_timestamp())))));
    end;
  end loop;
end $migration_lock$;

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
  if o.card_consented_at is null or o.card_consent_version is null then return 'no_card_consent'; end if;
  select * into c from public.b2c_pickup_confirmations where id = p.pickup_confirmation_id;
  if not found or c.revoked_at is not null then return 'pickup_revoked'; end if;
  select * into s from public.shipments where id = c.shipment_id;
  if s.status not in ('picked_up', 'in_transit', 'delivered') then return 'shipment_' || s.status; end if;
  -- 082: 取消の申請（佐川の確認待ち・旅行者の My Booking・運営）が残っている間は請求を始めない（運営が申請の結果を確かめる）
  if exists (select 1 from public.shipment_change_requests r where r.shipment_id = s.id and r.kind = 'cancel'
              and r.stage in ('requested', 'contacted', 'approved')) then
    return 'cancel_pending';
  end if;
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
    -- 082: cancel_pending も解除できる（解除の後の取り出しで条件を再確認するので、申請が残っていれば再び止まる）
    if p.hold_reason not in ('pieces_mismatch', 'carrier_piece_mismatch', 'cancel_pending') then return 'not_overridable'; end if;
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
  -- 082: 追跡の同期（sync-tracking・reconcile）が佐川のスキャンで先に集荷済み以降に進めた区間も、運営が確認できる
  if s.status not in ('requested', 'pending', 'issued', 'picked_up', 'in_transit', 'delivered') then
    return jsonb_build_object('result', 'shipment_not_pickable', 'shipment_status', s.status);
  end if;
  select * into p from public.b2c_payments where order_id = o.id and kind = 'base' for update;
  if found and p.status <> 'cancelled' then return jsonb_build_object('result', 'already_charged', 'payment_status', p.status); end if;

  insert into public.b2c_pickup_confirmations(order_id, shipment_id, operator_email, credential_id, evidence_type, evidence_ref,
                                              booked_pieces, accepted_pieces, reason, prev_shipment_status, confirmed_at)
  values (o.id, s.id, p_operator_email, p_credential_id, p_evidence_type, btrim(p_evidence_ref), o.pieces, p_accepted_pieces, btrim(p_reason), s.status, p_now)
  returning id into cid;
  -- 082: 集荷の前の区間だけ picked_up にする（追跡で進んだ in_transit・delivered を戻さない。集荷の時刻は追跡の値を残す）
  update public.shipments set status = case when s.status in ('requested', 'pending', 'issued') then 'picked_up' else s.status end,
         picked_up_at = coalesce(s.picked_up_at, p_now) where id = s.id;

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
  -- 082: 確認の前から集荷済み以降（追跡で前進済み）だった区間は、状態と集荷の時刻を変えない
  update public.shipments set status = c.prev_shipment_status, picked_up_at = null
   where id = c.shipment_id and status = 'picked_up' and c.prev_shipment_status in ('requested', 'pending', 'issued');
  if p.id is not null then
    update public.b2c_payments set status = 'cancelled', last_error_code = 'pickup_revoked', hold_reason = null where id = p.id;
  end if;
  insert into public.b2c_order_events(order_id, shipment_id, event, actor_type, operator_email, credential_id, reason, before_state, after_state)
  values (o.id, c.shipment_id, 'pickup_confirmation_revoked', 'operator', p_operator_email, p_credential_id, btrim(p_reason),
          jsonb_build_object('shipment_status', 'picked_up', 'payment_status', p.status),
          jsonb_build_object('shipment_status', c.prev_shipment_status, 'payment_status', case when p.id is null then null else 'cancelled' end));
  return 'revoked';
end $$;

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
  n_all   int;
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
  -- 082: 追加の請求のキーの番号は、取り消した追加も含めて数える（charge_key は一意。取り消した追加と同じキーにしない）
  select count(*) into n_all from public.b2c_payments where order_id = o.id and kind = 'extra';
  diff := p_actual_pieces - billed;
  if diff = 0 then return jsonb_build_object('result', 'no_difference', 'billed_pieces', billed); end if;
  if diff > 0 then
    amt := public.b2c_amount_for(o.unit_net_yen, p_actual_pieces) - public.b2c_amount_for(o.unit_net_yen, billed);
    insert into public.b2c_payments(order_id, kind, charge_key, amount_yen, pieces, unit_net_yen, status, scheduled_at,
                                    pickup_confirmation_id, created_by, checks_overridden)
    values (o.id, 'extra', 'extra:' || o.id::text || ':' || (n_all + 1), amt, diff, o.unit_net_yen, 'scheduled', p_now + p_grace,
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
