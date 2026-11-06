-- P1-B2 実集荷個数確認・課金保留の DB 基盤 (2026-11-05)。
-- 通常配送 (fit/group) で「予約個数 ≠ 実集荷個数」による誤課金・誤請求を防ぐため、
-- 実個数確認が済むまでカード課金・請求確定を保留する土台を敷く。
--
-- 安全方針 (sql/065 と同じ):
--  - 追加型のみ。既存テーブル/データ/列の変更・削除は一切しない。
--  - 既存 shipments.suitcase_count (予約個数) は上書きしない。実個数は別列で独立保持。
--  - charge_hold_state の既定は 'auto' = 保留対象外 ＝ 既存の課金/請求挙動は1円も変わらない。
--    RPC 群は「定義するだけ」で、本番コード (chargeShipmentIfDue / buildMonthlyInvoice) からは
--    まだ呼ばない (P1-B2-3/4 で承認後に配線する)。よって本ファイル適用だけでは挙動不変。
--  - 新テーブルは RLS 有効・policy なし = service_role のみ (代理店には一切見せない)。
--  - set_updated_at() は sql/001 で定義済みのものを再利用 (再定義しない)。
--  - **本番DBには未適用**。隔離 PostgreSQL でのみ検証する冪等ファイル (承認後に別途適用)。
--
-- 課金保留の状態機械 (二重管理の回避):
--   charge_hold_state : auto → held → released          … 保留ライフサイクル (本ファイルの新設)
--   charged_at / charge_error (既存・不変)                 … 決済が成立したか (Stripe)
--   charge_claim_at / charge_claim_owner (新設)            … 課金権の in-flight リース (owner guard)
--   'held' はスティッキー: 自動解除しない (実個数確認=release だけが解除)。

-- ── 1. shipments への追加列 (独立3カウント + 保留状態 + 課金権リース) ──
alter table shipments
  add column if not exists charge_hold_state       text not null default 'auto'
    check (charge_hold_state in ('auto', 'held', 'released')),
  -- 佐川への事前連絡個数 (P1-B の notified_snapshot 由来・参考値)。
  add column if not exists prenotified_count        int,
  -- 実集荷個数 (佐川が実際に引き受けた個数) とその証跡。
  add column if not exists actual_count             int,
  add column if not exists actual_count_source      text
    check (actual_count_source is null or actual_count_source in ('operator_manual', 'sagawa_api')),
  add column if not exists actual_count_confirmed_at timestamptz,
  add column if not exists actual_count_confirmed_by text,
  add column if not exists sagawa_reply_note         text,
  -- 20個未満でも個数差異が判明している案件を保留対象にするフラグ。
  add column if not exists count_discrepancy_flag    boolean not null default false,
  -- ── 個数確認・料金確認・課金保留を独立3軸で管理 (v3.0 §3)。実個数入力だけでは解除しない ──
  --   個数確認: unconfirmed → confirmed / disputed
  add column if not exists count_status              text not null default 'unconfirmed'
    check (count_status in ('unconfirmed', 'confirmed', 'disputed')),
  --   料金確認: pending → calculated → approved / requires_customer_approval
  add column if not exists price_status              text not null default 'pending'
    check (price_status in ('pending', 'calculated', 'approved', 'requires_customer_approval')),
  -- 実個数で再計算した税抜小計 (Operator 確認用。amount_yen は書き換えない=請求本体不変)。
  add column if not exists recalc_amount_yen          int,
  -- 未集荷・追加集荷・配送トラブルが未解決か。実個数一致でも true の間は解除しない (v3.0 §2)。
  add column if not exists has_open_pickup_issue      boolean not null default false,
  -- 課金権の in-flight リース (claim_charge_right が使う)。
  add column if not exists charge_claim_at           timestamptz,
  add column if not exists charge_claim_owner        text,
  -- v3.2: claim 時点の集荷単位スナップショット (revalidate_charge_claim が送信直前の差分検知に使う)。
  add column if not exists charge_claim_unit_key     text,
  add column if not exists charge_claim_unit_total   int;

-- ── 1b. B2-1 料金確定の永続化 (v3.1) ──
-- 請求の正本は従来どおり amount_yen の1本。ここは「どの個数・単価・割引・計算版で、
-- 誰がいつ承認したか」の来歴を残す監査列。承認時に approved_amount_yen を確定し、
-- 保留解除 (release_charge_hold) で amount_yen := approved_amount_yen を原子反映する
-- (未課金のときのみ)。正本を2本にしない = invoice/charge は今後も amount_yen を読む。
alter table shipments
  add column if not exists price_calc_count         int,   -- 料金計算に使った個数 (通常=actual_count)
  add column if not exists approved_amount_yen       int,   -- 承認済み税抜金額 (release で amount_yen へ反映)
  add column if not exists approved_unit_price_yen   int,   -- 適用単価 (税抜/個)
  add column if not exists price_discount_basis      text,  -- 割引条件 'none' | 'group8' | 'contract_unit'
  add column if not exists price_calc_version        text,  -- 料金計算バージョン (例 'p1b2-v3.1')
  add column if not exists price_approved_by         text,
  add column if not exists price_approved_at         timestamptz,
  -- ── 1c. B2-3 課金試行の状態 (Stripe 結果不明時に新規課金を禁止する DB 側ガード) ──
  --   null=未試行 / in_flight=Stripe送信中 / succeeded / failed=明確な失敗(再試行可)
  --   / reconciliation_required=結果不明(タイムアウト等)。照合して解決するまで新規課金を作らない。
  add column if not exists charge_attempt_state      text
    check (charge_attempt_state is null or charge_attempt_state in
      ('in_flight', 'succeeded', 'failed', 'reconciliation_required')),
  add column if not exists charge_attempt_at         timestamptz,
  add column if not exists charge_attempt_pi_id      text,
  add column if not exists charge_attempt_count      int not null default 0;

comment on column shipments.approved_amount_yen is 'P1-B2 承認済み税抜金額。保留解除時に amount_yen へ原子反映する確定値 (未課金のみ)。';
comment on column shipments.charge_attempt_state is 'P1-B2 課金試行状態: in_flight/succeeded/failed/reconciliation_required。結果不明(reconciliation_required/in_flight)は新規課金を禁止。';

-- 結果不明 (要照合) の課金試行を速く引く部分索引 (reconcile ジョブ / Operator キュー用)。
create index if not exists shipments_charge_recon_idx
  on shipments (charge_attempt_at)
  where charge_attempt_state = 'reconciliation_required';

comment on column shipments.charge_hold_state is 'P1-B2 課金/請求の保留状態: auto=対象外(現行どおり課金) / held=実個数確認待ち(課金・請求しない) / released=確認済(課金可)。既定 auto。';
comment on column shipments.prenotified_count is '佐川へ事前連絡した個数 (参考)。';
comment on column shipments.actual_count is '佐川が実際に引き受けた実集荷個数。';
comment on column shipments.actual_count_source is '実個数の情報源: operator_manual / 将来 sagawa_api。';
comment on column shipments.count_discrepancy_flag is '20個未満でも個数差異が判明している案件を保留対象にする。';
comment on column shipments.count_status is 'P1-B2 個数確認状態: unconfirmed / confirmed / disputed。決済状態とは独立。';
comment on column shipments.price_status is 'P1-B2 料金確認状態: pending / calculated / approved / requires_customer_approval。';
comment on column shipments.recalc_amount_yen is '実個数で再計算した税抜小計 (Operator 確認用・表示専用)。amount_yen は書き換えない。';
comment on column shipments.has_open_pickup_issue is '未集荷/追加集荷/配送トラブルが未解決か。true の間は実個数一致でも解除しない。';
comment on column shipments.charge_claim_at is 'カード課金権の in-flight リース取得時刻 (owner guard)。';

-- held の Operator キュー (未確認の保留案件) を速く引く部分索引。
create index if not exists shipments_charge_held_idx
  on shipments (shipment_date)
  where charge_hold_state = 'held';

-- ── 2. 実個数確認の追記履歴 (更新せず常に INSERT) ──
create table if not exists public.shipment_count_confirmations (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  booking_id text not null,
  leg_index int not null default 0,
  -- その確認時点の3カウント (スナップショット)。
  declared_count int,                     -- 予約個数 (suitcase_count)
  prenotified_count int,                  -- 佐川事前連絡個数
  actual_count int,                       -- 実集荷個数
  source text not null default 'operator_manual'
    check (source in ('operator_manual', 'sagawa_api')),
  sagawa_reply text,                      -- 佐川側の回答・証跡 (Operator 入力)
  note text,
  -- 操作種別 (record_count | price_decision | release | auto_finalize)。
  action text not null default 'record_count',
  -- この操作で各状態がどう遷移したか (監査)。
  count_status_before text, count_status_after text,
  price_status_before text, price_status_after text,
  hold_state_before text,   hold_state_after text,
  confirmed_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists shipment_count_confirmations_shipment_idx
  on public.shipment_count_confirmations (shipment_id, created_at);
alter table public.shipment_count_confirmations enable row level security;
-- policy なし = service_role のみ。

-- ── 3. hotel_key / 正規化ヘルパ (lib/sagawa-bulk/core.ts の resolveHotelKey を SQL で忠実に再現) ──
create or replace function bondex_norm_text(s text) returns text
  language sql immutable as $$
  select btrim(regexp_replace(lower(coalesce(s, '')), '\s+', ' ', 'g'))
$$;

-- from_residence (jsonb) が有効な個人宅/民泊か (name/street/building/zip/city のいずれか非空)。
create or replace function bondex_is_residence(r jsonb) returns boolean
  language sql immutable as $$
  select r is not null and (
    coalesce(btrim(r->>'name'), '')     <> '' or
    coalesce(btrim(r->>'street'), '')   <> '' or
    coalesce(btrim(r->>'building'), '') <> '' or
    coalesce(btrim(r->>'zip'), '')      <> '' or
    coalesce(btrim(r->>'city'), '')     <> ''
  )
$$;

-- shipment 1行の集荷元ホテルキー。residence は NULL (集荷単位に含めない)。
-- place_id があれば 'pid:<id>' / 無ければ 'name:<norm(県)>/<norm(市)>/<norm(ホテル名)>'。
create or replace function bondex_shipment_hotel_key(
  p_place_id text, p_hotel_ja text, p_hotel text,
  p_prefecture text, p_city text, p_residence jsonb
) returns text language sql immutable as $$
  select case
    when bondex_is_residence(p_residence) then null
    when coalesce(btrim(p_place_id), '') <> '' then 'pid:' || btrim(p_place_id)
    else 'name:' || bondex_norm_text(p_prefecture) || '/' || bondex_norm_text(p_city) || '/' ||
         bondex_norm_text(coalesce(nullif(btrim(p_hotel_ja), ''), p_hotel))
  end
$$;

-- ── 4. 保留条件の評価 (読み取り専用)。閾値 20 (= lib/sagawa-bulk/core.ts BULK_THRESHOLD) ──
-- 通常配送 (fit/group)・非addition・非cancelled のみ対象。次のいずれかで hold:
--   (c) count_discrepancy_flag=true / (a) leg 単位 20個以上 / (b) 集荷単位(hotel_key×集荷日)合計 20個以上。
create or replace function evaluate_charge_hold(p_shipment_id uuid)
returns table(hold boolean, reason text, unit_total int, leg_pieces int)
language plpgsql stable as $$
declare s record; v_key text; v_total int;
begin
  select id, booking_type, coalesce(suitcase_count, 0) as pieces, shipment_date, status, is_addition,
         from_place_id, from_hotel_ja, from_hotel, from_prefecture, from_city, from_residence,
         coalesce(count_discrepancy_flag, false) as disc
    into s from shipments where id = p_shipment_id;
  if not found then
    return query select false, 'not_found'::text, 0, 0; return;
  end if;
  if s.is_addition or s.status = 'cancelled' or s.booking_type not in ('fit', 'group') then
    return query select false, 'not_subject'::text, 0, s.pieces; return;
  end if;
  if s.disc then
    return query select true, 'discrepancy'::text, s.pieces, s.pieces; return;
  end if;
  if s.pieces >= 20 then
    return query select true, 'leg_bulk'::text, s.pieces, s.pieces; return;
  end if;
  v_key := bondex_shipment_hotel_key(s.from_place_id, s.from_hotel_ja, s.from_hotel,
                                     s.from_prefecture, s.from_city, s.from_residence);
  if v_key is null then
    return query select false, 'no_unit'::text, s.pieces, s.pieces; return;
  end if;
  select coalesce(sum(coalesce(t.suitcase_count, 0)), 0) into v_total
  from shipments t
  where t.shipment_date = s.shipment_date
    and not t.is_addition and t.status <> 'cancelled' and t.booking_type in ('fit', 'group')
    and bondex_shipment_hotel_key(t.from_place_id, t.from_hotel_ja, t.from_hotel,
                                  t.from_prefecture, t.from_city, t.from_residence) = v_key;
  if v_total >= 20 then
    return query select true, 'unit_bulk'::text, v_total, s.pieces; return;
  end if;
  return query select false, 'below_threshold'::text, v_total, s.pieces;
end;
$$;

-- ── 5. 集荷単位に held を付与 (auto→held のみ=スティッキー・released は触らない) ──
-- 予約追加・個数変更・ホテル/集荷日変更の各経路から呼び、動的に保留を立てる (P1-B2-3 で配線)。
create or replace function apply_charge_holds_for_unit(p_hotel_key text, p_pickup_date date)
returns int language plpgsql as $$
declare v_total int; v_cnt int;
begin
  if p_hotel_key is null then return 0; end if;
  -- 集荷単位を直列化 (課金権取得 claim_charge_right と同じキー)。
  perform pg_advisory_xact_lock(hashtextextended(p_hotel_key || '|' || p_pickup_date::text, 0));
  select coalesce(sum(coalesce(t.suitcase_count, 0)), 0) into v_total
  from shipments t
  where t.shipment_date = p_pickup_date and not t.is_addition and t.status <> 'cancelled'
    and t.booking_type in ('fit', 'group')
    and bondex_shipment_hotel_key(t.from_place_id, t.from_hotel_ja, t.from_hotel,
                                  t.from_prefecture, t.from_city, t.from_residence) = p_hotel_key;
  if v_total < 20 then return 0; end if;
  update shipments set charge_hold_state = 'held'
  where shipment_date = p_pickup_date and not is_addition and status <> 'cancelled'
    and booking_type in ('fit', 'group') and charge_hold_state = 'auto'
    and bondex_shipment_hotel_key(from_place_id, from_hotel_ja, from_hotel,
                                  from_prefecture, from_city, from_residence) = p_hotel_key;
  get diagnostics v_cnt = row_count;
  return v_cnt;
end;
$$;

-- ── 6. 課金権の原子的取得 (Stripe 呼び出しの直前に差す・P1-B2-3 で配線) ──
-- 集荷単位を advisory lock で直列化し、キャッシュ列ではなく evaluate_charge_hold で "その場" 再評価する。
-- held なら claim を渡さず held を永続化。非held かつ未課金かつ lease 空/失効 のときだけ claim を立てる。
-- 戻り値 claimed=true のときだけ呼び出し側は Stripe 課金に進んでよい。
create or replace function claim_charge_right(
  p_shipment_id uuid, p_owner text, p_lease_seconds int default 120
) returns table(claimed boolean, reason text)
language plpgsql as $$
declare s record; v_key text; v_eval record;
begin
  select id, shipment_date, from_place_id, from_hotel_ja, from_hotel, from_prefecture, from_city, from_residence,
         charged_at, charge_hold_state, charge_claim_at, charge_attempt_state
    into s from shipments where id = p_shipment_id for update;
  if not found then return query select false, 'not_found'::text; return; end if;

  -- B2-3: 直前の課金試行が「結果不明」または「送信中」なら新規課金を一切作らない。
  -- lease 期限切れだけでは解除しない (指示 5-3)。解除は reconcile_charge_attempt / settle(failed) のみ。
  if s.charge_attempt_state = 'reconciliation_required' then
    return query select false, 'reconciliation_required'::text; return; end if;
  if s.charge_attempt_state = 'in_flight' then
    return query select false, 'charge_pending'::text; return; end if;

  -- v3.2: claim 時点の集荷単位キー (revalidate が送信直前にこのキーで再評価・差分検知する)。
  v_key := bondex_shipment_hotel_key(s.from_place_id, s.from_hotel_ja, s.from_hotel,
                                     s.from_prefecture, s.from_city, s.from_residence);

  -- released = Operator が実個数を確認し課金を許可済み。保留評価を飛ばして課金権へ進む
  -- (古い discrepancy フラグ等で誤ってブロックしない)。
  if s.charge_hold_state = 'released' then
    if s.charged_at is not null then return query select false, 'already_charged'::text; return; end if;
    if s.charge_claim_at is not null
       and s.charge_claim_at > now() - make_interval(secs => p_lease_seconds) then
      return query select false, 'claimed_by_other'::text; return;
    end if;
    update shipments set charge_claim_at = now(), charge_claim_owner = p_owner,
      charge_claim_unit_key = v_key, charge_claim_unit_total = null where id = p_shipment_id;
    return query select true, 'ok_released'::text; return;
  end if;

  if v_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_key || '|' || s.shipment_date::text, 0));
  end if;

  select * into v_eval from evaluate_charge_hold(p_shipment_id);
  if v_eval.hold then
    -- 表示用キャッシュを held に (released は尊重して触らない)。課金権は渡さない。
    update shipments set charge_hold_state = 'held'
      where id = p_shipment_id and charge_hold_state <> 'released';
    return query select false, ('held:' || v_eval.reason)::text; return;
  end if;

  if s.charged_at is not null then return query select false, 'already_charged'::text; return; end if;
  if s.charge_claim_at is not null
     and s.charge_claim_at > now() - make_interval(secs => p_lease_seconds) then
    return query select false, 'claimed_by_other'::text; return;
  end if;
  -- claim 時点の集荷単位 (キー + 合計) をスナップショット。送信直前の revalidate がこれと差分を見る。
  update shipments set charge_claim_at = now(), charge_claim_owner = p_owner,
    charge_claim_unit_key = v_key, charge_claim_unit_total = v_eval.unit_total where id = p_shipment_id;
  return query select true, 'ok'::text;
end;
$$;

-- ── 6b. 送信直前の課金権再評価 (v3.2 §2 — claim→Stripe送信の窓を塞ぐ) ──
-- claim→begin_charge_attempt の後、stripe.create の直前に TS が呼ぶ。集荷単位を advisory lock で直列化し
-- "その場" 再評価する。claim 後に別予約が足されて単位が大口化 (hold) していたら、課金権と試行を解放して
-- 送信を止める (held へ戻す)。外部 Stripe 通信はこの関数の外・この短い Tx の後に行う (DB を長時間保持しない)。
-- 残存窓 (本関数のコミット〜stripe.create 呼び出し) に入った変更は、送信済み扱いで結果照合・調整の対象。
create or replace function revalidate_charge_claim(
  p_shipment_id uuid, p_owner text, p_lease_seconds int default 120
) returns table(ok boolean, reason text)
language plpgsql as $$
declare s record; v_eval record;
begin
  select id, shipment_date, from_place_id, from_hotel_ja, from_hotel, from_prefecture, from_city, from_residence,
         charged_at, charge_hold_state, charge_claim_at, charge_claim_owner,
         charge_claim_unit_key, charge_claim_unit_total, charge_attempt_state
    into s from shipments where id = p_shipment_id for update;
  if not found then return query select false, 'not_found'::text; return; end if;
  if s.charged_at is not null then return query select false, 'already_charged'::text; return; end if;
  if s.charge_claim_owner is distinct from p_owner then
    return query select false, 'claim_owner_mismatch'::text; return; end if;
  if s.charge_claim_at is null or s.charge_claim_at <= now() - make_interval(secs => p_lease_seconds) then
    return query select false, 'claim_expired'::text; return; end if;
  if s.charge_attempt_state is distinct from 'in_flight' then
    return query select false, ('attempt_state:' || coalesce(s.charge_attempt_state, 'null'))::text; return; end if;
  -- released は Operator 確認済み = 単位の再評価をスキップして送信続行。
  if s.charge_hold_state = 'released' then return query select true, 'ok_released'::text; return; end if;

  if s.charge_claim_unit_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(s.charge_claim_unit_key || '|' || s.shipment_date::text, 0));
  end if;
  select * into v_eval from evaluate_charge_hold(p_shipment_id);
  if v_eval.hold then
    -- claim 後に単位が大口化/差異発生 → 送信を止め held に戻し、課金権と試行を解放 (再課金は確認後)。
    update shipments set
      charge_hold_state = case when charge_hold_state <> 'released' then 'held' else charge_hold_state end,
      charge_claim_at = null, charge_claim_owner = null,
      charge_attempt_state = null, charge_attempt_at = null
    where id = p_shipment_id;
    insert into public.shipment_charge_attempts(shipment_id, owner, outcome, stripe_status, error)
      values (p_shipment_id, p_owner, 'failed', 'revalidate', ('unit_changed_hold:' || v_eval.reason));
    return query select false, ('unit_changed_hold:' || v_eval.reason)::text; return;
  end if;
  -- まだ hold ではない。単位合計が claim 時と変わっていたら監査記録して続行 (課金安全には影響しない変化)。
  if s.charge_claim_unit_total is distinct from v_eval.unit_total then
    insert into public.shipment_charge_attempts(shipment_id, owner, outcome, stripe_status, error)
      values (p_shipment_id, p_owner, 'in_flight', 'revalidate',
              ('unit_total ' || coalesce(s.charge_claim_unit_total, 0) || '->' || coalesce(v_eval.unit_total, 0)));
    update shipments set charge_claim_unit_total = v_eval.unit_total where id = p_shipment_id;
  end if;
  return query select true, 'ok'::text;
end;
$$;

-- ── 7. 個数確認 / 料金確認 / 保留解除 を独立操作に分離 (v3.0 §3) ──
-- 原則の順序: 個数記録 → 料金計算 → 料金承認 → 解除。**実個数を入力しただけでは解除しない**。
-- amount_yen / suitcase_count は変更しない (請求本体の反映は P1-B2-3 以降で承認後)。

-- 7-1. 実個数の記録のみ。count_status を confirmed/disputed に。charge_hold_state は動かさない。
create or replace function record_pickup_count(
  p_shipment_id uuid, p_actual_count int,
  p_source text default 'operator_manual', p_sagawa_reply text default null,
  p_note text default null, p_disputed boolean default false,
  p_open_issue boolean default null,   -- 未集荷/追加集荷/トラブルの有無 (null=据え置き)
  p_confirmed_by text default 'operator'
) returns table(ok boolean, reason text, declared int, actual int,
                discrepancy boolean, count_status text, hold_state text)
language plpgsql as $$
declare s record; v_disc boolean; v_cs text;
begin
  if p_confirmed_by is null or btrim(p_confirmed_by) = '' then
    return query select false,'confirmed_by_required'::text,0,0,false,null::text,null::text; return; end if;
  if p_source not in ('operator_manual','sagawa_api') then
    return query select false,'bad_source'::text,0,0,false,null::text,null::text; return; end if;
  if p_actual_count is null or p_actual_count < 0 or p_actual_count > 999 then
    return query select false,'bad_actual_count'::text,0,0,false,null::text,null::text; return; end if;
  select sh.id,sh.booking_id,sh.leg_index,coalesce(sh.suitcase_count,0) as declared,sh.prenotified_count,
         sh.count_status,sh.charge_hold_state into s from shipments sh where sh.id=p_shipment_id for update;
  if not found then return query select false,'not_found'::text,0,0,false,null::text,null::text; return; end if;
  v_disc := (p_actual_count <> s.declared);
  v_cs := case when p_disputed then 'disputed' else 'confirmed' end;
  update shipments set
    actual_count=p_actual_count, actual_count_source=p_source,
    actual_count_confirmed_at=now(), actual_count_confirmed_by=p_confirmed_by,
    sagawa_reply_note=coalesce(p_sagawa_reply,sagawa_reply_note),
    count_discrepancy_flag=v_disc, count_status=v_cs,
    has_open_pickup_issue=coalesce(p_open_issue,has_open_pickup_issue)
  where id=p_shipment_id;
  insert into public.shipment_count_confirmations
    (shipment_id,booking_id,leg_index,declared_count,prenotified_count,actual_count,
     source,sagawa_reply,note,action,count_status_before,count_status_after,
     hold_state_before,hold_state_after,confirmed_by)
  values (s.id,s.booking_id,s.leg_index,s.declared,s.prenotified_count,p_actual_count,
     p_source,p_sagawa_reply,p_note,'record_count',s.count_status,v_cs,
     s.charge_hold_state,s.charge_hold_state,p_confirmed_by);
  return query select true,'ok'::text,s.declared,p_actual_count,v_disc,v_cs,s.charge_hold_state;
end; $$;

-- 7-2. 料金確認状態の更新 (v3.1: 承認時に承認金額と来歴を永続化)。再計算額は TS の lineSubtotalYen が
--      算出して渡す (正本)。許可遷移のみ。approved では approved_amount_yen を確定し (= release で amount_yen
--      へ反映)、適用単価・割引条件・計算版・計算個数・承認者/日時を監査列に残す。
drop function if exists apply_price_decision(uuid, int, text, text);
create or replace function apply_price_decision(
  p_shipment_id uuid, p_recalc_amount int, p_decision text, p_by text default 'operator',
  p_unit_price int default null, p_discount_basis text default null,
  p_calc_version text default null, p_calc_count int default null
) returns table(ok boolean, reason text, price_status text)
language plpgsql as $$
declare v_before text; v_bk text; v_leg int; v_amount int; v_approved int;
begin
  if p_decision not in ('calculated','approved','requires_customer_approval') then
    return query select false,'bad_decision'::text,null::text; return; end if;
  select sh.price_status,sh.booking_id,sh.leg_index,sh.amount_yen
    into v_before,v_bk,v_leg,v_amount from shipments sh where sh.id=p_shipment_id for update;
  if not found then return query select false,'not_found'::text,null::text; return; end if;
  -- 料金保護A: 増額 (requires_customer_approval) は Operator では承認できない。
  -- 代理店本人の承認 (agency_decide_price) だけが approved へ進められる (指示 原則2)。
  if p_decision='approved' and v_before='requires_customer_approval' then
    return query select false,'needs_agency_approval'::text,v_before; return; end if;
  if not (
    (p_decision='calculated' and v_before in ('pending','calculated')) or
    (p_decision='approved' and v_before in ('calculated','approved')) or
    -- 初回記録で増額が判明した場合、pending から直接 requires_customer_approval に遷移できる
    -- (confirm-pickup-count の record 経路は pending のまま呼ぶため)。
    (p_decision='requires_customer_approval' and v_before in ('pending','calculated','requires_customer_approval'))
  ) then
    return query select false,('illegal_transition:'||v_before||'->'||p_decision)::text,v_before; return;
  end if;
  if p_decision='approved' then
    -- 承認額の正本候補: 渡された再計算額 → 既存 recalc → 現行 amount_yen の順。
    v_approved := coalesce(p_recalc_amount, (select recalc_amount_yen from shipments where id=p_shipment_id), v_amount);
    update shipments set price_status='approved',
      recalc_amount_yen=coalesce(p_recalc_amount,recalc_amount_yen),
      approved_amount_yen=v_approved,
      approved_unit_price_yen=coalesce(p_unit_price,approved_unit_price_yen),
      price_discount_basis=coalesce(p_discount_basis,price_discount_basis),
      price_calc_version=coalesce(p_calc_version,price_calc_version),
      price_calc_count=coalesce(p_calc_count,price_calc_count),
      price_approved_by=p_by, price_approved_at=now()
    where id=p_shipment_id;
  else
    update shipments set price_status=p_decision,
      recalc_amount_yen=coalesce(p_recalc_amount,recalc_amount_yen) where id=p_shipment_id;
  end if;
  insert into public.shipment_count_confirmations
    (shipment_id,booking_id,leg_index,action,price_status_before,price_status_after,confirmed_by)
  values (p_shipment_id,v_bk,v_leg,'price_decision',v_before,p_decision,p_by);
  return query select true,'ok'::text,p_decision;
end; $$;

-- 7-3. 保留解除。全前提を DB で検証: count=confirmed かつ price=approved かつ 未解決の集荷問題なし の
--      ときだけ held→released。実個数が一致していても has_open_pickup_issue の間は解除しない (v3.0 §2)。
create or replace function release_charge_hold(p_shipment_id uuid, p_by text default 'operator')
returns table(ok boolean, reason text, hold_state text)
language plpgsql as $$
declare s record;
begin
  select id,booking_id,leg_index,charge_hold_state,count_status,price_status,
         coalesce(has_open_pickup_issue,false) as issue, charged_at, approved_amount_yen
    into s from shipments where id=p_shipment_id for update;
  if not found then return query select false,'not_found'::text,null::text; return; end if;
  if s.charge_hold_state <> 'held' then
    return query select false,('not_held:'||s.charge_hold_state)::text,s.charge_hold_state; return; end if;
  if s.count_status <> 'confirmed' then
    return query select false,('count_not_confirmed:'||s.count_status)::text,s.charge_hold_state; return; end if;
  if s.price_status <> 'approved' then
    return query select false,('price_not_approved:'||s.price_status)::text,s.charge_hold_state; return; end if;
  if s.issue then
    return query select false,'open_pickup_issue'::text,s.charge_hold_state; return; end if;
  -- B2-2 STEP4: 保留解除と承認金額の確定を同一 UPDATE で原子的に行う。未課金のときだけ amount_yen を
  -- 承認額へ反映 (正本は amount_yen 1本)。課金済みは触らない (差額は返金/追加請求で運用)。
  update shipments set charge_hold_state='released',
    amount_yen = case when charged_at is null and approved_amount_yen is not null
                      then approved_amount_yen else amount_yen end
  where id=p_shipment_id;
  insert into public.shipment_count_confirmations
    (shipment_id,booking_id,leg_index,action,hold_state_before,hold_state_after,confirmed_by)
  values (s.id,s.booking_id,s.leg_index,'release','held','released',p_by);
  return query select true,'ok'::text,'released'::text;
end; $$;

-- 7-4. 個数一致・料金一致・問題なしの自動確定 (v3.0 §2A)。1トランザクションで 記録→承認→解除。
--      price_matches / no_open_issue / breakdown_confirmed は呼び出し側 (TS) が判定して渡す。
--      条件を満たさなければ記録のみ行い、finalized=false (needs_operator) で Operator 確認へ回す。
create or replace function auto_finalize_pickup(
  p_shipment_id uuid, p_actual_count int, p_recalc_amount int,
  p_price_matches boolean, p_no_open_issue boolean, p_breakdown_confirmed boolean,
  p_source text default 'operator_manual', p_sagawa_reply text default null,
  p_by text default 'operator'
) returns table(ok boolean, finalized boolean, reason text,
                declared int, actual int, count_status text, price_status text, hold_state text)
language plpgsql as $$
declare s record; v_match boolean; v_hold text; v_price text;
begin
  select sh.id,sh.booking_id,sh.leg_index,coalesce(sh.suitcase_count,0) as declared,
         sh.charge_hold_state,sh.price_status,sh.amount_yen,sh.charged_at
    into s from shipments sh where sh.id=p_shipment_id for update;
  if not found then return query select false,false,'not_found'::text,0,0,null::text,null::text,null::text; return; end if;
  -- まず実個数を記録 (count_status=confirmed・問題なしなら issue クリア)。
  perform record_pickup_count(p_shipment_id,p_actual_count,p_source,p_sagawa_reply,null,false,
                              case when p_no_open_issue then false else null end,p_by);
  v_match := (p_actual_count = s.declared) and coalesce(p_price_matches,false)
             and coalesce(p_no_open_issue,false) and coalesce(p_breakdown_confirmed,false);
  if v_match then
    v_hold := case when s.charge_hold_state='held' then 'released' else s.charge_hold_state end;
    -- 一致確定: 承認額を永続化し (正本 amount_yen は未課金のとき反映)、保留を解除する。
    update shipments set price_status='approved',
      recalc_amount_yen=coalesce(p_recalc_amount,recalc_amount_yen),
      approved_amount_yen=coalesce(p_recalc_amount,recalc_amount_yen,amount_yen),
      price_approved_by=p_by, price_approved_at=now(), charge_hold_state=v_hold,
      amount_yen = case when charged_at is null then coalesce(p_recalc_amount,amount_yen) else amount_yen end
      where id=p_shipment_id;
    insert into public.shipment_count_confirmations
      (shipment_id,booking_id,leg_index,action,price_status_before,price_status_after,
       hold_state_before,hold_state_after,confirmed_by)
    values (s.id,s.booking_id,s.leg_index,'auto_finalize',s.price_status,'approved',
       s.charge_hold_state,v_hold,p_by);
    return query select true,true,'finalized'::text,s.declared,p_actual_count,
                        'confirmed'::text,'approved'::text,v_hold; return;
  end if;
  -- 条件未達 → 記録のみ。料金は計算済にして Operator へ (増額の要顧客承認判断は呼び出し側で設定)。
  if coalesce(p_recalc_amount,0) > 0 and s.price_status = 'pending' then
    v_price := 'calculated';
    update shipments set price_status='calculated', recalc_amount_yen=p_recalc_amount where id=p_shipment_id;
  else
    v_price := s.price_status;
  end if;
  return query select true,false,'needs_operator'::text,s.declared,p_actual_count,
                      'confirmed'::text,v_price,s.charge_hold_state;
end; $$;

-- ── 8. 集荷単位の予約別内訳 (読み取り専用・Operator の照合ビュー用) ──
-- 指定 shipment と同一 (hotel_key × 集荷日) の通常配送 leg を、予約別に列挙する。
-- A社30 + B社20 のような重複を「予約ごとに独立」表示し、按分せず内訳確定を促す。
-- 注: ここは drop せず create or replace のみにする。drop + create (同一シグネチャ) だと再実行時に
--   関数が作り直されて EXECUTE 権限が既定 (PUBLIC) に戻り、sql/072 の権限制限が巻き戻るため
--   (create or replace は既存の権限を保持する)。本関数は 066 のみで定義し <=065 に無いので drop 不要。
create or replace function pickup_unit_summary(p_shipment_id uuid)
returns table(
  shipment_id uuid, booking_id text, leg_index int, agency text,
  declared int, prenotified int, actual int,
  charge_hold_state text, count_status text, price_status text,
  discrepancy boolean, actual_confirmed_at timestamptz
) language plpgsql stable as $$
declare s record; v_key text;
begin
  select shipment_date, from_place_id, from_hotel_ja, from_hotel, from_prefecture, from_city, from_residence
    into s from shipments where id = p_shipment_id;
  if not found then return; end if;
  v_key := bondex_shipment_hotel_key(s.from_place_id, s.from_hotel_ja, s.from_hotel,
                                     s.from_prefecture, s.from_city, s.from_residence);
  if v_key is null then
    -- 集荷単位を成さない (residence 等) → 当該 leg 単独で返す。
    return query
      select t.id, t.booking_id, t.leg_index, t.agency,
             coalesce(t.suitcase_count, 0), t.prenotified_count, t.actual_count,
             t.charge_hold_state, t.count_status, t.price_status,
             coalesce(t.count_discrepancy_flag, false), t.actual_count_confirmed_at
      from shipments t where t.id = p_shipment_id;
    return;
  end if;
  return query
    select t.id, t.booking_id, t.leg_index, t.agency,
           coalesce(t.suitcase_count, 0), t.prenotified_count, t.actual_count,
           t.charge_hold_state, t.count_status, t.price_status,
           coalesce(t.count_discrepancy_flag, false), t.actual_count_confirmed_at
    from shipments t
    where t.shipment_date = s.shipment_date and not t.is_addition and t.status <> 'cancelled'
      and t.booking_type in ('fit', 'group')
      and bondex_shipment_hotel_key(t.from_place_id, t.from_hotel_ja, t.from_hotel,
                                    t.from_prefecture, t.from_city, t.from_residence) = v_key
    order by t.booking_id, t.leg_index;
end;
$$;

-- ── 9. B2-3 課金試行の台帳 (Stripe 送信の前後を追記で記録・二重課金を DB 側でも防ぐ) ──
-- Stripe の idempotencyKey だけに頼らず、DB 側でも「結果不明のまま次の課金を作らない」を保証する。
create table if not exists public.shipment_charge_attempts (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  owner text,                       -- 課金権 owner (charge_<uuid>)
  idempotency_key text,             -- Stripe idempotencyKey (charge_<shipmentId>)
  pi_id text,                       -- PaymentIntent ID (判明後)
  outcome text not null
    check (outcome in ('in_flight','succeeded','failed','reconciliation_required',
                       'reconciled_succeeded','reconciled_failed')),
  stripe_status text,               -- pi.status または error.type
  error text,
  created_at timestamptz not null default now()
);
create index if not exists shipment_charge_attempts_shipment_idx
  on public.shipment_charge_attempts (shipment_id, created_at);
alter table public.shipment_charge_attempts enable row level security;
-- policy なし = service_role のみ。

-- 9-1. Stripe 送信の直前に試行開始を記録 (claim 成功後・create 前に TS が呼ぶ)。
--      in_flight にすると claim_charge_right が以後の新規課金を拒否する (結果確定まで)。
create or replace function begin_charge_attempt(
  p_shipment_id uuid, p_owner text, p_idempotency_key text
) returns table(ok boolean, reason text)
language plpgsql as $$
declare s record;
begin
  select charged_at, charge_attempt_state into s from shipments where id=p_shipment_id for update;
  if not found then return query select false,'not_found'::text; return; end if;
  if s.charged_at is not null then return query select false,'already_charged'::text; return; end if;
  if s.charge_attempt_state in ('in_flight','reconciliation_required') then
    return query select false,('attempt_blocked:'||s.charge_attempt_state)::text; return; end if;
  update shipments set charge_attempt_state='in_flight', charge_attempt_at=now(),
    charge_attempt_count=coalesce(charge_attempt_count,0)+1 where id=p_shipment_id;
  insert into public.shipment_charge_attempts(shipment_id,owner,idempotency_key,outcome)
    values (p_shipment_id,p_owner,p_idempotency_key,'in_flight');
  return query select true,'ok'::text;
end; $$;

-- 9-2. Stripe 送信の結果を記録 (TS が create の後に呼ぶ)。
--   succeeded              … 状態 succeeded (charged_at は recordShipmentCharge が別途 CAS で立てる)
--   failed                 … 明確な失敗 (カード拒否/requires_action)。claim を解放し再試行可。
--   reconciliation_required… 結果不明 (タイムアウト/通信/API)。claim を保持し新規課金を禁止。照合待ち。
create or replace function settle_charge_attempt(
  p_shipment_id uuid, p_owner text, p_outcome text,
  p_pi_id text default null, p_stripe_status text default null, p_error text default null
) returns table(ok boolean, state text)
language plpgsql as $$
begin
  if p_outcome not in ('succeeded','failed','reconciliation_required') then
    return query select false,'bad_outcome'::text; return; end if;
  update shipments set
    charge_attempt_state=p_outcome,
    charge_attempt_pi_id=coalesce(p_pi_id,charge_attempt_pi_id),
    -- 失敗のみ claim を解放 (再試行可)。不明/成功は claim を保持。
    charge_claim_at=case when p_outcome='failed' then null else charge_claim_at end,
    charge_claim_owner=case when p_outcome='failed' then null else charge_claim_owner end
  where id=p_shipment_id;
  insert into public.shipment_charge_attempts(shipment_id,owner,pi_id,outcome,stripe_status,error)
    values (p_shipment_id,p_owner,p_pi_id,p_outcome,p_stripe_status,p_error);
  return query select true,p_outcome;
end; $$;

-- 9-3. 結果不明/送信中の照合解決 (Stripe を問い合わせたうえで TS/Webhook が呼ぶ)。
--   p_resolved='succeeded' … charged_at を CAS で立て (二重課金防止)、状態 succeeded。charged=このコールで初確定か。
--   p_resolved='failed'    … 未課金が確定。状態 failed・claim 解放 → 再試行可。
create or replace function reconcile_charge_attempt(
  p_shipment_id uuid, p_resolved text, p_pi_id text default null, p_amount_yen int default null
) returns table(ok boolean, state text, charged boolean)
language plpgsql as $$
declare s record; v_charged boolean := false;
begin
  if p_resolved not in ('succeeded','failed') then
    return query select false,'bad_resolved'::text,false; return; end if;
  select charged_at, charge_attempt_state into s from shipments where id=p_shipment_id for update;
  if not found then return query select false,'not_found'::text,false; return; end if;
  if p_resolved='succeeded' then
    v_charged := (s.charged_at is null);  -- このコールで初めて確定したか
    update shipments set charged_at=coalesce(charged_at,now()),
      stripe_payment_intent_id=coalesce(p_pi_id,stripe_payment_intent_id),
      charge_amount_yen=coalesce(p_amount_yen,charge_amount_yen),
      charge_attempt_state='succeeded', charge_attempt_pi_id=coalesce(p_pi_id,charge_attempt_pi_id)
    where id=p_shipment_id;
    insert into public.shipment_charge_attempts(shipment_id,pi_id,outcome,stripe_status)
      values (p_shipment_id,p_pi_id,'reconciled_succeeded','reconcile');
  else
    update shipments set charge_attempt_state='failed',
      charge_claim_at=null, charge_claim_owner=null where id=p_shipment_id;
    insert into public.shipment_charge_attempts(shipment_id,pi_id,outcome,stripe_status)
      values (p_shipment_id,p_pi_id,'reconciled_failed','reconcile');
  end if;
  return query select true,p_resolved,v_charged;
end; $$;

-- ── 10. B2-4 月次請求の計上台帳 (追加型・フラグ ON のときだけ buildMonthlyInvoice が使う) ──
-- 1 leg を生涯1回だけ計上する (unique)。held は再評価で除外、確定後は金額を凍結 (不変)、
-- 締め後に確定した保留 leg は「計上月=実行月」で翌月/調整として拾う (原発送月は shipment_date で表示)。
create table if not exists public.shipment_invoice_postings (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  agency text not null,
  billed_month text not null,            -- 計上月 YYYY-MM (= 請求書の対象月)
  shipment_date date,                    -- 原発送日 (明細表示・調整判定用)
  net_yen int not null,                  -- 計上時に凍結した税抜額 (確定後は不変)
  gross_yen int not null,                -- 税込 (凍結)
  invoice_no text,
  note text,
  posted_at timestamptz not null default now(),
  -- 1 leg = 生涯1回だけ計上 (複数月への二重計上を物理的に防ぐ)。制約名は on conflict で明示参照する
  -- (RETURNS TABLE の OUT 変数 shipment_id と列名が衝突するため、列指定ではなく制約名で解決)。
  constraint shipment_invoice_postings_uq unique (shipment_id)
);
create index if not exists shipment_invoice_postings_month_idx
  on public.shipment_invoice_postings (agency, billed_month);
alter table public.shipment_invoice_postings enable row level security;
-- policy なし = service_role のみ。

-- 10-1. 請求対象 leg の確定・計上 (claim_invoice_postings / post_invoice_legs) は sql/067 が唯一の定義元。
--   この表 (shipment_invoice_postings) と RLS は 066 が作るが、計上関数は 067 でのみ定義する。理由:
--   067 は voided_at 列を足し、ここで作る一意制約 shipment_invoice_postings_uq を drop して
--   部分一意インデックス (shipment_id) where voided_at is null に差し替える。もし 066 でも
--   claim_invoice_postings を定義すると、(a) 定義が 2 ファイルに重複し、(b) 067 適用後に 066 を
--   単独再実行すると関数が旧版へ巻き戻って drop 済み制約 shipment_invoice_postings_uq を参照し、
--   月次請求の実行時にエラー + void 済み leg の二重計上を招く。計上関数は 067 に一本化する
--   (migration 再実行・部分適用でも最終状態が壊れないため。sql/067 §6 を参照)。
