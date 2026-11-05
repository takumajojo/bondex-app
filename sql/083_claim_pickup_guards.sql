-- 083: 集荷依頼の確保 (claim_pickup_request) で、Biz-Logi の送信を DB でも止める条件を足す (2026-11-07 監査 B-14・B-01)。
-- 前提: sql/067 (claim_pickup_request)・sql/068 (shipment_change_requests.stage/kind) を先に適用する。
--
-- 足す条件 (Biz-Logi だけ。手動 = Excel で依頼済みの記録は止めない。佐川側に依頼がある事実の記録を失わないため):
--   open_change_exists : 処理中の変更・取消の申請 (stage が requested・contacted・approved、kind が correction 以外) がある。
--                        アプリの確認 (lib/pickup-request/bizlogi.ts openChangeErrors) と確保の間に入った申請を止める。
--                        create_shipment_change (sql/068) も区間の行を for update で掴むので、確保と申請は直列になる
--                        (確保が先なら申請は「依頼済み」の申請になり、申請が先なら確保はここで拒否される)。
--   pickup_marked      : 有効な依頼の記録が無いのに「集荷手配済み」の印 (pickup_requested_at) がある
--                        (移行中に古いアプリで Excel 依頼した区間など)。アプリの確認 (precheck) と同じ条件。
--
-- 何度流しても同じ結果になる (create or replace だけ。データは変えない)。切り戻しは sql/rollback/rollback_083.sql。
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
  if p_channel = 'bizlogi' and jsonb_typeof(s.tracking_numbers) = 'array'
     and jsonb_array_length(s.tracking_numbers) > 0 then
    return query select false, null::uuid, 'tracking_number_exists'::text, null::jsonb;
    return;
  end if;
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
  -- 083: 有効な依頼が無いのに印だけがある区間は、Biz-Logi では送らない (Excel で依頼済みの可能性)
  if p_channel = 'bizlogi' and s.pickup_requested_at is not null then
    return query select false, null::uuid, 'pickup_marked'::text, null::jsonb;
    return;
  end if;
  -- 083: 処理中の変更・取消の申請がある区間は、Biz-Logi では送らない (旧い内容で依頼してしまう)
  if p_channel = 'bizlogi' and exists (
    select 1 from public.shipment_change_requests c
     where c.shipment_id = p_shipment_id
       and c.stage in ('requested', 'contacted', 'approved')
       and c.kind is distinct from 'correction'
  ) then
    return query select false, null::uuid, 'open_change_exists'::text, null::jsonb;
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
