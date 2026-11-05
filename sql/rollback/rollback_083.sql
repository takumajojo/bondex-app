-- rollback_083: claim_pickup_request を sql/067 の定義に戻す (Biz-Logi の確保で変更申請・印を DB では見なくなる。アプリの確認だけになる)。
-- データは変えない。何度流しても同じ。
create or replace function public.claim_pickup_request(
  p_shipment_id     uuid,
  p_channel         text,
  p_environment     text,
  p_manage_number   text,
  p_piece_count     int,
  p_pickup_date     date,
  p_actor           text,
  p_owner           text,
  p_note            text
) returns table (claimed boolean, request_id uuid, reason text, snapshot jsonb)
language plpgsql
as $$
declare
  s public.shipments;
  v_id uuid;
  v_state text := case when p_channel = 'manual' then 'accepted' else 'sending' end;
  v_snap jsonb;
begin
  if p_channel not in ('manual', 'bizlogi') then
    return query select false, null::uuid, 'invalid_channel'::text, null::jsonb;
    return;
  end if;

  -- 一時停止中、または区間のロック (sql/068 のトリガー) が無効な間は、手動・Biz-Logi とも記録・送信しない。
  -- トリガーがまだ無い (068 の前) ときはスイッチだけで判断する (067 は停止の状態で作る)。
  if coalesce((select claims_paused from public.pickup_request_settings where id), true) then
    return query select false, null::uuid, 'claims_paused'::text, null::jsonb;
    return;
  end if;
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.shipments'::regclass and tgname = 'shipments_pickup_lock' and tgenabled = 'D') then
    return query select false, null::uuid, 'pickup_lock_disabled'::text, null::jsonb;
    return;
  end if;

  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then
    return query select false, null::uuid, 'shipment_not_found'::text, null::jsonb;
    return;
  end if;
  if s.status = 'cancelled' then
    return query select false, null::uuid, 'shipment_cancelled'::text, null::jsonb;
    return;
  end if;
  v_snap := public.pickup_snapshot_json(s);
  -- Biz-Logi は「佐川の番号がまだ無い」区間だけ。番号があるのは佐川側に依頼が存在する証拠。
  if p_channel = 'bizlogi' and jsonb_typeof(s.tracking_numbers) = 'array'
     and jsonb_array_length(s.tracking_numbers) > 0 then
    return query select false, null::uuid, 'tracking_number_exists'::text, null::jsonb;
    return;
  end if;
  -- BondEx の当面の運用ルール: Biz-Logi は 1〜19個の通常配送だけ (2026-11-04 谷口さん。佐川 API の上限ではない =
  -- 佐川の個口数は2桁まで)。20個以上は佐川へ事前連絡が必要なため
  -- BondEx で確認して手動手配する。団体 (booking_type='group') も手動。手動 (Excel) の記録には影響しない。
  if p_channel = 'bizlogi' and coalesce(s.suitcase_count, 0) >= 20 then
    return query select false, null::uuid, 'too_many_pieces'::text, null::jsonb;
    return;
  end if;
  if p_channel = 'bizlogi' and coalesce(s.booking_type, 'fit') = 'group' then
    return query select false, null::uuid, 'group_booking'::text, null::jsonb;
    return;
  end if;
  if exists (
    select 1 from public.pickup_requests r
     where r.shipment_id = p_shipment_id
       and r.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')
  ) then
    return query select false, null::uuid, 'live_request_exists'::text, null::jsonb;
    return;
  end if;

  begin
    insert into public.pickup_requests
      (shipment_id, booking_id, leg_index, channel, state, environment, user_manage_number,
       piece_count, pickup_date, requested_by, attempt_owner, note, sent_at, resolved_at, resolved_by, request_snapshot)
    values
      (p_shipment_id, s.booking_id, s.leg_index, p_channel, v_state,
       case when p_channel = 'bizlogi' then p_environment else null end,
       p_manage_number, p_piece_count, p_pickup_date, p_actor, p_owner, p_note,
       now(),
       case when p_channel = 'manual' then now() else null end,
       case when p_channel = 'manual' then p_actor else null end,
       v_snap)
    returning id into v_id;
  exception when unique_violation then
    return query select false, null::uuid, 'live_request_exists'::text, null::jsonb;
    return;
  end;

  if p_channel = 'manual' then
    update public.shipments
       set pickup_requested_at = coalesce(pickup_requested_at, now())
     where id = p_shipment_id;
  end if;

  return query select true, v_id, 'claimed'::text, v_snap;
end;
$$;

revoke all on function public.claim_pickup_request(uuid, text, text, text, int, date, text, text, text) from public, anon, authenticated;
