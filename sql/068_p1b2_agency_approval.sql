-- P1-B2 v3.4 Track B｜代理店の増額承認フロー (2026-11-06)。
--
-- 料金保護 方式A: 実集荷個数で再計算し、予約時提示額を超える (増額) 場合だけ代理店承認を必須にする。
-- Operator の承認だけでは増額課金を許可しない (増額は代理店本人の承認が必要)。減額・一致は対象外。
--
-- 安全方針 (sql/066/067 と同じ):
--  - 追加型のみ。既存テーブル/データ/RLS は変更しない。
--  - 金額はサーバー保存値が正本。クライアント送信額は信用せず、照合のみに使う。
--  - 新テーブルは RLS 有効・policy なし = service_role のみ (API 層で代理店所有権を検証)。
--  - **本番DBには未適用**。隔離 PostgreSQL でのみ検証する冪等ファイル (承認後に別途適用)。
--
-- 承認状態: approval_not_required / approval_pending / approved / declined / expired / superseded

create table if not exists public.shipment_price_approvals (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  booking_id text not null,
  leg_index int not null default 0,
  agency_id uuid not null,                 -- 承認すべき代理店 (agencies.id・不変)
  state text not null default 'approval_pending'
    check (state in ('approval_not_required','approval_pending','approved','declined','expired','superseded')),
  declared_count int,
  actual_count int,
  -- 金額は税抜(net)・税込(gross)を区別して保存。gross = net + floor(net/10) (grossOf と一致)。
  quoted_net_yen int, quoted_gross_yen int,       -- 予約時提示
  recalc_net_yen int, recalc_gross_yen int,       -- 実個数で再計算
  increase_net_yen int, increase_gross_yen int,   -- 増額分 (recalc - quoted)
  tax_rate numeric not null default 0.1,
  quote_version int not null default 1,           -- 見積バージョン (条件変更で +1)
  expires_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
-- 1 shipment につき「生きている」承認 (pending/approved) は最大1件 (部分一意)。
create unique index if not exists shipment_price_approvals_active_uq
  on public.shipment_price_approvals (shipment_id) where state in ('approval_pending','approved');
create index if not exists shipment_price_approvals_agency_idx
  on public.shipment_price_approvals (agency_id, state);
alter table public.shipment_price_approvals enable row level security;
-- policy なし = service_role のみ。

-- 当該 shipment の代理店 (shipments.agency 名) を agencies.id に解決する (所有権判定は id を正とする)。
create or replace function bondex_shipment_agency_id(p_shipment_id uuid) returns uuid
language sql stable as $$
  select a.id from public.shipments s join public.agencies a on a.name = s.agency where s.id = p_shipment_id
$$;

-- B-1. 増額の承認要求を作成する (confirm-pickup-count の record 経路から呼ぶ)。
--   recalc <= quoted (減額/一致) なら approval_not_required。増額なら旧 pending を superseded にして新規 pending。
create or replace function request_price_approval(
  p_shipment_id uuid, p_quoted_net int, p_recalc_net int, p_actual_count int,
  p_quote_version int default 1, p_expires_at timestamptz default null
) returns table(state text, approval_id uuid, increase_net int)
language plpgsql as $$
declare s record; v_agency uuid; v_inc int; v_id uuid; v_qgross int; v_rgross int;
begin
  select id, booking_id, leg_index, coalesce(suitcase_count,0) as declared
    into s from shipments where id = p_shipment_id for update;
  if not found then return query select 'not_found'::text, null::uuid, 0; return; end if;
  v_agency := bondex_shipment_agency_id(p_shipment_id);
  if v_agency is null then return query select 'agency_unresolved'::text, null::uuid, 0; return; end if;
  v_inc := coalesce(p_recalc_net,0) - coalesce(p_quoted_net,0);
  -- 既存の生きている承認は supersede (条件が変わったので再承認が必要)。
  -- state 列は OUT 変数 state と衝突するためテーブル修飾する。
  update public.shipment_price_approvals set state='superseded'
    where shipment_price_approvals.shipment_id = p_shipment_id
      and shipment_price_approvals.state in ('approval_pending','approved');
  if v_inc <= 0 then
    -- 減額・一致は代理店承認不要。
    return query select 'approval_not_required'::text, null::uuid, v_inc; return;
  end if;
  v_qgross := p_quoted_net + (p_quoted_net / 10);
  v_rgross := p_recalc_net + (p_recalc_net / 10);
  insert into public.shipment_price_approvals(
    shipment_id, booking_id, leg_index, agency_id, state, declared_count, actual_count,
    quoted_net_yen, quoted_gross_yen, recalc_net_yen, recalc_gross_yen,
    increase_net_yen, increase_gross_yen, quote_version, expires_at)
  values (p_shipment_id, s.booking_id, s.leg_index, v_agency, 'approval_pending', s.declared, p_actual_count,
    p_quoted_net, v_qgross, p_recalc_net, v_rgross, v_inc, (v_rgross - v_qgross), p_quote_version, p_expires_at)
  returning id into v_id;
  -- 増額は代理店承認が必要 = price_status を要承認へ (承認後に条件が再変化した場合も approved→rca に戻す)。
  update shipments set price_status = 'requires_customer_approval' where id = p_shipment_id;
  return query select 'approval_pending'::text, v_id, v_inc;
end; $$;

-- B-2. 代理店による承認/拒否 (API が resolveAgencyFromRequest で得た agency_id を渡す)。
--   所有権 (agency_id 一致)・バージョン一致・期限・二重決定・金額サーバー再検証・冪等 を保証。
--   approved のときだけ shipments.price_status='approved' + approved_amount_yen を確定 (増額の課金を解錠)。
create or replace function agency_decide_price(
  p_shipment_id uuid, p_agency_id uuid, p_quote_version int, p_decision text,
  p_expected_recalc_net int default null
) returns table(ok boolean, reason text, state text)
language plpgsql as $$
declare ap record; v_owner uuid;
begin
  if p_decision not in ('approved','declined') then
    return query select false, 'bad_decision'::text, null::text; return; end if;
  -- 所有権: 当該 shipment の代理店 id と一致するか (名前ではなく id で判定)。
  v_owner := bondex_shipment_agency_id(p_shipment_id);
  if v_owner is null or v_owner <> p_agency_id then
    return query select false, 'not_owner'::text, null::text; return; end if;
  select * into ap from public.shipment_price_approvals
    where shipment_price_approvals.shipment_id = p_shipment_id
      and shipment_price_approvals.state in ('approval_pending','approved')
    order by created_at desc limit 1 for update;
  if not found then return query select false, 'no_active_approval'::text, null::text; return; end if;
  -- 冪等: 既に承認済みで再度 approved → 同じ結果を返す (二重課金・二重遷移しない)。
  if ap.state = 'approved' then
    if p_decision = 'approved' then return query select true, 'already_approved'::text, 'approved'::text; return;
    else return query select false, 'already_approved'::text, 'approved'::text; return; end if;
  end if;
  if ap.quote_version <> p_quote_version then
    return query select false, ('version_mismatch:'||ap.quote_version)::text, ap.state; return; end if;
  if ap.expires_at is not null and ap.expires_at <= now() then
    update public.shipment_price_approvals set state='expired' where id = ap.id;
    return query select false, 'expired'::text, 'expired'::text; return; end if;
  -- サーバー側金額の再検証: クライアント表示額 (任意) が保存済み再計算額と一致するか。正本は保存値。
  if p_expected_recalc_net is not null and p_expected_recalc_net <> ap.recalc_net_yen then
    return query select false, 'amount_mismatch'::text, ap.state; return; end if;

  if p_decision = 'declined' then
    update public.shipment_price_approvals set state='declined', decided_by=('agency:'||p_agency_id::text), decided_at=now()
      where id = ap.id;
    -- price_status は requires_customer_approval のまま (保留維持)。
    insert into public.shipment_count_confirmations(shipment_id,booking_id,leg_index,action,
      price_status_before,price_status_after,confirmed_by)
      values (p_shipment_id, ap.booking_id, ap.leg_index, 'agency_price_decision',
              'requires_customer_approval','requires_customer_approval', 'agency:'||p_agency_id::text);
    return query select true, 'declined'::text, 'declined'::text; return;
  end if;

  -- approved: 承認を確定し、増額を解錠 (price_status=approved + 承認額=サーバー保存の recalc_net)。
  update public.shipment_price_approvals set state='approved', decided_by=('agency:'||p_agency_id::text), decided_at=now()
    where id = ap.id;
  update shipments set price_status='approved',
    approved_amount_yen = ap.recalc_net_yen,
    recalc_amount_yen = coalesce(recalc_amount_yen, ap.recalc_net_yen),
    price_approved_by = ('agency:'||p_agency_id::text), price_approved_at = now()
    where id = p_shipment_id;
  insert into public.shipment_count_confirmations(shipment_id,booking_id,leg_index,action,
    price_status_before,price_status_after,confirmed_by)
    values (p_shipment_id, ap.booking_id, ap.leg_index, 'agency_price_decision',
            'requires_customer_approval','approved', 'agency:'||p_agency_id::text);
  return query select true, 'approved'::text, 'approved'::text;
end; $$;
