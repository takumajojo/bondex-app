-- 代理店セルフのホテル変更 (2026-09-14)。適用済み (Supabase migration hotel_change_require_unissued)。
-- apply_hotel_change に p_require_unissued (既定 false) を追加。
--   true のとき: 行ロック下で status ∈ {requested, pending}(未発行) 以外なら 'unissued_required' を raise。
--   代理店ルートは true で呼ぶ → 「事前チェックと RPC の間に cron が発行」する競合を原子的に遮断。
--   運営ルートは引数を渡さない(=false) ので挙動不変(発行済み-未集荷でも変更でき旧伝票破棄タスクを生成)。
-- 既存の 12 引数版を drop してから 13 引数版を作る(オーバーロード曖昧化を避ける。既定値により
-- 運営の 12 引数呼び出しはそのまま解決される)。
drop function if exists apply_hotel_change(
  uuid, text, text, text, text, text, text, boolean, text, boolean, text, text
);

create or replace function apply_hotel_change(
  p_shipment_id     uuid,
  p_side            text,
  p_new_hotel       text,
  p_new_hotel_ja    text,
  p_new_place_id    text,
  p_new_city        text,
  p_new_prefecture  text,
  p_over_deadline   boolean,
  p_reason          text,
  p_old_slip_task   boolean,
  p_changed_by      text,
  p_agency          text,
  p_require_unissued boolean default false
) returns uuid
language plpgsql
as $$
declare
  s shipments%rowtype;
  v_old_hotel text; v_old_hotel_ja text; v_old_place_id text;
  v_cancel_task boolean;
  v_change_id uuid;
begin
  if p_side not in ('guest','pickup') then raise exception 'invalid_side'; end if;
  select * into s from shipments where id = p_shipment_id for update;
  if not found then raise exception 'shipment_not_found'; end if;

  -- 代理店セルフ用の厳しめゲート: 未発行(requested/pending)以外は不可 (行ロック下で原子的に判定)
  if coalesce(p_require_unissued,false) and s.status not in ('requested','pending') then
    raise exception 'unissued_required: issued or beyond - self-service change not allowed';
  end if;

  if (s.yamato_tracking is not null
      and jsonb_typeof(s.yamato_tracking) = 'array'
      and jsonb_array_length(s.yamato_tracking) > 0)
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
$$;
