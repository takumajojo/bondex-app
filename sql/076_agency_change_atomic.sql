-- 代理店の変更 (日程・個数・代表者名) を1つのトランザクションで反映する (2026-11-04 谷口さん指示・未適用)。
-- 前提: sql/067 (pickup_requests・pickup_cutoff_at)、sql/068 (create_shipment_change・区間のロック)。
--
-- 背景: app/api/agency/shipment/[id] は「対象区間の日程・個数」と「予約の全区間の代表者名」を別々の書き込みで
--   更新していた。2つ目が失敗すると片方だけ変わる。代表者名の変更申請も区間ごとに別々に登録しており、
--   途中で失敗すると一部の区間だけ申請が残った。また、同じ予約の別の区間が佐川へ依頼済みだと、代表者名の
--   直接更新がロック (sql/068) で毎回失敗し、何度やり直しても変更申請に切り替わらなかった。
--
-- この関数は1回の呼び出し = 1トランザクション。途中で1つでも失敗したら全部を取り消す (部分更新を残さない)。
--   1. 対象区間を変更申請にする (p_leg_kind = dates / count) か、直接反映する (p_leg_patch)
--   2. 代表者名 (p_rep) は予約の変更可能な区間ごとに:
--        佐川へ依頼済み (有効な集荷依頼あり) または受付締切 (集荷前日 18:30) 後 → 変更申請 (kind=representative)
--        それ以外 → 直接反映
-- 判定と書き込みは区間の行ロックの後に行う。区間のロック (sql/068 のトリガー) はそのまま効く
--   (直接反映しようとした区間に、同時に集荷依頼が入ったら例外 = 全部取り消し → アプリは「もう一度」を案内)。
-- 失敗の理由は例外の文言 'agency_change:<理由>' で返す (理由は create_shipment_change と同じ語 + locked)。
-- 再実行できる。戻すとき: drop function public.agency_change_atomic(uuid, jsonb, text, jsonb, jsonb, text, text, text);

create or replace function public.agency_change_atomic(
  p_shipment_id        uuid,
  p_leg_patch          jsonb,   -- 対象区間に直接反映: shipment_date / expected_arrival / suitcase_count / amount_yen。空 = なし
  p_leg_kind           text,    -- 対象区間を変更申請にする種類 (dates / count)。null = 申請しない
  p_leg_request_fields jsonb,   -- その申請の項目
  p_rep                jsonb,   -- 代表者名 {representative, recipient?}。null = 変えない
  p_reason             text,
  p_agency             text,
  p_actor              text
) returns table (direct_legs int, requested_legs int, change_ids uuid[])
language plpgsql security definer set search_path = public as $$
declare
  s        public.shipments;
  l        public.shipments;
  v_patch  jsonb := coalesce(p_leg_patch, '{}'::jsonb);
  v_direct int := 0;
  v_req    int := 0;
  v_ids    uuid[] := '{}';
  v_ok     boolean;
  v_id     uuid;
  v_reason text;
  v_n      int;
  v_key    text;
begin
  for v_key in select jsonb_object_keys(v_patch) loop
    if v_key not in ('shipment_date', 'expected_arrival', 'suitcase_count', 'amount_yen') then
      raise exception 'agency_change:field_not_allowed:%', v_key;
    end if;
  end loop;
  if p_leg_kind is not null and p_leg_kind not in ('dates', 'count') then
    raise exception 'agency_change:invalid_kind';
  end if;
  if p_rep is not null and btrim(coalesce(p_rep->>'representative', '')) = '' then
    raise exception 'agency_change:representative_required';
  end if;

  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'agency_change:shipment_not_found'; end if;

  -- 1. 対象区間
  if p_leg_kind is not null then
    select x.ok, x.change_id, x.reason into v_ok, v_id, v_reason
      from public.create_shipment_change(s.id, p_leg_kind, coalesce(p_leg_request_fields, '{}'::jsonb), p_reason, 'agency', p_agency, p_actor) x;
    if not v_ok then raise exception 'agency_change:%', v_reason; end if;
    v_req := v_req + 1; v_ids := v_ids || v_id;
  elsif v_patch <> '{}'::jsonb then
    update public.shipments set
      shipment_date    = case when v_patch ? 'shipment_date'    then (v_patch->>'shipment_date')::date    else shipment_date end,
      expected_arrival = case when v_patch ? 'expected_arrival' then (v_patch->>'expected_arrival')::date else expected_arrival end,
      suitcase_count   = case when v_patch ? 'suitcase_count'   then (v_patch->>'suitcase_count')::int    else suitcase_count end,
      amount_yen       = case when v_patch ? 'amount_yen'       then (v_patch->>'amount_yen')::int        else amount_yen end,
      updated_at = now()
    where id = s.id and status in ('requested', 'pending', 'issued') and label_url is null;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'agency_change:locked'; end if;
    v_direct := v_direct + 1;
  end if;

  -- 2. 代表者名 (予約の変更可能な区間ごと。区間の順番で行ロック = 同時の変更とデッドロックしない)
  if p_rep is not null then
    for l in
      select * from public.shipments
       where booking_id = s.booking_id and status in ('requested', 'pending', 'issued') and label_url is null
       order by id
       for update
    loop
      if exists (select 1 from public.pickup_requests r where r.shipment_id = l.id
                  and r.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending'))
         or now() >= public.pickup_cutoff_at(l.shipment_date) then
        select x.ok, x.change_id, x.reason into v_ok, v_id, v_reason
          from public.create_shipment_change(l.id, 'representative', p_rep, p_reason, 'agency', p_agency, p_actor) x;
        if not v_ok then raise exception 'agency_change:%', v_reason; end if;
        v_req := v_req + 1; v_ids := v_ids || v_id;
      else
        update public.shipments set
          representative = p_rep->>'representative',
          recipient = case when p_rep ? 'recipient' then p_rep->>'recipient' else recipient end,
          updated_at = now()
        where id = l.id;
        if l.id <> s.id or v_patch = '{}'::jsonb then v_direct := v_direct + 1; end if;
      end if;
    end loop;
  end if;

  return query select v_direct, v_req, v_ids;
end;
$$;
revoke all on function public.agency_change_atomic(uuid, jsonb, text, jsonb, jsonb, text, text, text) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.agency_change_atomic(uuid, jsonb, text, jsonb, jsonb, text, text, text) to service_role';
exception when undefined_object then null; end $$;
