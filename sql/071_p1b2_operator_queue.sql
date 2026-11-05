-- P1-B2 v3.5 Track D｜Operator の実個数確認・料金承認待ちキュー (読み取り専用) (2026-11-06)。
--
-- 既存 Operator 画面に「確認待ち案件」を1箇所で出すための read-only RPC。書き込みはしない。
-- 対象: 保留中 (held)・料金計算/増額承認待ち・個数争議 の通常配送 leg。P1-B の大口/重複アラートと別に、
-- 「実個数を確認し料金を確定する」導線をまとめる。追加型のみ・RLS に触れない。**本番DB未適用**。

create or replace function operator_count_queue(p_limit int default 200)
returns table(
  shipment_id uuid, booking_id text, leg_index int, agency text,
  from_hotel text, to_hotel text, shipment_date date,
  declared int, actual int, discrepancy boolean,
  amount_yen int, recalc_amount_yen int, approved_amount_yen int,
  count_status text, price_status text, charge_hold_state text,
  has_open_pickup_issue boolean, approval_state text, updated_at timestamptz
) language sql stable as $$
  select
    s.id, s.booking_id, s.leg_index, s.agency,
    s.from_hotel, s.to_hotel, s.shipment_date,
    coalesce(s.suitcase_count,0), s.actual_count,
    coalesce(s.count_discrepancy_flag,false),
    s.amount_yen, s.recalc_amount_yen, s.approved_amount_yen,
    coalesce(s.count_status,'unconfirmed'), coalesce(s.price_status,'pending'),
    coalesce(s.charge_hold_state,'auto'), coalesce(s.has_open_pickup_issue,false),
    (select a.state from public.shipment_price_approvals a
       where a.shipment_id = s.id and a.state in ('approval_pending','approved')
       order by a.created_at desc limit 1),
    s.updated_at
  from public.shipments s
  where not s.is_addition and s.status <> 'cancelled' and s.booking_type in ('fit','group')
    and (
      coalesce(s.charge_hold_state,'auto') = 'held'
      or coalesce(s.price_status,'pending') in ('calculated','requires_customer_approval')
      or coalesce(s.count_status,'unconfirmed') = 'disputed'
    )
  order by s.updated_at desc nulls last
  limit greatest(coalesce(p_limit,200), 1)
$$;
