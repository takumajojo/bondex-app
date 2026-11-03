-- ホテル変更の DB 関数 apply_hotel_change が、改名前の列 yamato_tracking を参照したまま残っていた (2026-11-03 監査で発見)。
-- 適用済み (2026-11-03・Supabase migration 20261103143313 fix_hotel_change_tracking_column)。
-- 適用前の定義のバックアップ (ロールバック用) は、リポジトリ外の運用フォルダに保管している。
--
-- sql/044 (2026-09-29) で shipments.yamato_tracking を tracking_numbers に改名したが、関数は作り直していない。
-- PL/pgSQL は実行時に列を解決するため、呼ぶと必ず
--   ERROR: record "s" has no field "yamato_tracking"
-- で失敗する (PGlite で 033〜036 を当てて改名後に呼び、再現済み)。代理店のセルフ変更・運営のホテル変更の両方が使う。
-- 本番の記録では、ホテル変更は 2026-09-15 の1件のみで、改名後は1件も成功していない。
--
-- 修正内容: 本番の現在の定義 (pg_get_functiondef で取得・2026-11-03) から、列名 yamato_tracking を
-- tracking_numbers に置き換えただけ。それ以外 (引数・判定・更新内容・hotel_contact_info の扱い) は本番と同一。
-- CREATE OR REPLACE は既存の実行権限を保つ。

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
$function$;
