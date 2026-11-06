-- P1-B2 v3.4 Track C｜代理店単位の段階導入制御 (2026-11-06)。
--
-- Global Flag (SAGAWA_COUNT_HOLD_ENABLED・env) は全体マスタ。その上で、対象代理店だけに新機能を
-- 適用する「Allowlist」を **DB で・不変の agency_id で** 管理する (env 変数より安全=再デプロイ不要・
-- 監査可能・動的・id 固定)。代理店名による判定はしない (shipments.agency 名は agencies.id へ解決して判定)。
--
-- 集荷単位をまたぐ混在 (A社=対象 + B社=対象外が同一ホテル同日) は scheme C を採用:
--   対象外代理店が混在する集荷単位は「自動課金を停止して Operator 確認へ」(operator_review)。
--   対象外代理店の既存課金動作を無断で変える代わりに、安全側 (課金停止=Operator判断) に倒す。
--
-- 安全方針: 追加型のみ。既存 claim_charge_right / claim_invoice_postings は変更しない
-- (適用判定は本ファイルの disposition 関数を charge.ts / buildMonthlyInvoice が参照して分岐する)。
-- 新テーブルは RLS 有効・policy なし = service_role のみ。**本番DB未適用**。

create table if not exists public.charge_hold_agency_optin (
  agency_id  uuid primary key references public.agencies(id) on delete cascade,
  enabled_at timestamptz not null default now(),
  enabled_by text,
  note text
);
alter table public.charge_hold_agency_optin enable row level security;
-- policy なし = service_role のみ。

-- 代理店 (agencies.id) が allowlist 対象か。判定は id で行う (shipments.agency 名は id に解決してから)。
create or replace function charge_hold_agency_enabled_by_name(p_name text) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.charge_hold_agency_optin o
    join public.agencies a on a.id = o.agency_id
    where a.name = p_name
  )
$$;

-- 集荷単位の適用判定 (課金と請求書で同じ関数を使う)。
--   legacy          : 段階導入の対象外 = 従来動作 (保留しない・通常課金/通常請求)。
--   hold            : 対象 = P1-B2 の保留・確定フローを適用。
--   operator_review : 対象/対象外が同一集荷単位に混在 = 自動課金を止めて Operator 確認 (scheme C)。
create or replace function charge_hold_unit_disposition(p_shipment_id uuid) returns text
language plpgsql stable as $$
declare s record; v_key text; v_self boolean; v_any boolean; v_all boolean;
begin
  select id, shipment_date, from_place_id, from_hotel_ja, from_hotel, from_prefecture, from_city,
         from_residence, is_addition, status, booking_type, agency
    into s from shipments where id = p_shipment_id;
  if not found then return 'legacy'; end if;
  -- 通常配送 (fit/group)・非addition・非cancelled のみが段階導入の対象。それ以外は従来動作。
  if s.is_addition or s.status = 'cancelled' or s.booking_type not in ('fit','group') then
    return 'legacy';
  end if;
  v_self := charge_hold_agency_enabled_by_name(s.agency);
  v_key := bondex_shipment_hotel_key(s.from_place_id, s.from_hotel_ja, s.from_hotel,
                                     s.from_prefecture, s.from_city, s.from_residence);
  if v_key is null then
    -- 集荷単位を成さない (residence 等) → 自社の opt-in だけで判定。
    return case when v_self then 'hold' else 'legacy' end;
  end if;
  select bool_or(charge_hold_agency_enabled_by_name(t.agency)),
         bool_and(charge_hold_agency_enabled_by_name(t.agency))
    into v_any, v_all
  from shipments t
  where t.shipment_date = s.shipment_date and not t.is_addition and t.status <> 'cancelled'
    and t.booking_type in ('fit','group')
    and bondex_shipment_hotel_key(t.from_place_id, t.from_hotel_ja, t.from_hotel,
                                  t.from_prefecture, t.from_city, t.from_residence) = v_key;
  if not coalesce(v_any, false) then return 'legacy'; end if;       -- 単位に対象代理店なし
  if coalesce(v_all, false) then return 'hold'; end if;            -- 単位の全員が対象
  return 'operator_review';                                         -- 混在 (scheme C)
end; $$;

-- charge.ts が「P1-B2 の課金フロー (claim/begin/revalidate) を通すか」を事前判定するゲート。
-- false (legacy) のとき charge.ts は従来どおり即課金する (対象外=従来動作)。
create or replace function charge_hold_should_gate(p_shipment_id uuid) returns boolean
language sql stable as $$ select charge_hold_unit_disposition(p_shipment_id) in ('hold','operator_review') $$;

-- 混在集荷単位 (operator_review) の leg を held にして Operator 確認へ回す (auto のときだけ・released は尊重)。
-- charge.ts が disposition='operator_review' のとき claim の代わりに呼ぶ (自動課金はしない)。
create or replace function mark_charge_operator_review(p_shipment_id uuid) returns text
language plpgsql as $$
begin
  -- auto かつ未課金のときだけ held 化 (課金済み=巻き戻さない・released/held は尊重)。
  update shipments set charge_hold_state = 'held'
    where id = p_shipment_id and charge_hold_state = 'auto' and charged_at is null;
  insert into public.shipment_count_confirmations(shipment_id, booking_id, leg_index, action,
    hold_state_before, hold_state_after, confirmed_by)
  select id, booking_id, leg_index, 'operator_review', 'auto', 'held', 'system:staged_rollout'
    from shipments where id = p_shipment_id and charge_hold_state = 'held' and charged_at is null;
  return 'operator_review';
end; $$;
