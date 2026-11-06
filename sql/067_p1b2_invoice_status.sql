-- P1-B2 v3.2 Track B｜請求書の確定・再発行・二重計上防止 (2026-11-06)。
--
-- v3.1 の shipment_invoice_postings (1 leg 生涯1回・金額凍結) に、請求書ドキュメントの
-- 明示的な状態機械と再発行/調整履歴を足す。カード決済と請求書で同じ料金確定条件を使い、
-- 承認済み・送信済みの請求書は黙って金額を書き換えない。
--
-- 安全方針 (sql/065/066 と同じ):
--  - 追加型のみ。既存 invoice_sends の列・データ・RLS はそのまま (status 等を ADD するだけ)。
--  - レガシー行 (status=null) は既存の暗黙状態 (approved_at/sent_to_agency_at) から導出 = 現行挙動不変。
--  - RPC 群は定義するだけ。本番コード (cron/monthly-invoices・invoice-send) からは Flag 配下で呼ぶ
--    (本ファイル適用＋Flag OFF のままでは挙動不変)。
--  - 新テーブルは RLS 有効・policy なし = service_role のみ。
--  - **本番DBには未適用**。隔離 PostgreSQL でのみ検証する冪等ファイル (承認後に別途適用)。
--
-- 請求書の状態機械 (invoice_sends.status):
--   draft → prepared → approved → sent → paid     (正常系)
--   draft/prepared/approved/sent → voided → (reissue) → draft(v+1)   (訂正系)
--   ※ 下書き (draft/prepared) は料金変更で再計算してよい。approved 以降は金額凍結 (void→reissue のみ)。

-- ── 1. invoice_sends に状態機械と再発行の列を追加 ──
alter table invoice_sends
  add column if not exists status             text
    check (status is null or status in ('draft','prepared','approved','sent','paid','voided')),
  add column if not exists prepared_at         timestamptz,
  add column if not exists prepared_total_yen  int,
  add column if not exists prepared_piece_count int,
  add column if not exists paid_at             timestamptz,
  add column if not exists voided_at           timestamptz,
  add column if not exists void_reason         text,
  add column if not exists void_by             text,
  add column if not exists invoice_version     int not null default 1,
  add column if not exists reissue_of          text;   -- 直前に void した invoice_no

comment on column invoice_sends.status is 'P1-B2 請求書状態: draft/prepared/approved/sent/paid/voided。null=レガシー(approved_at/sent_to_agency_at から導出)。';
comment on column invoice_sends.prepared_total_yen is '確定時に凍結した請求総額(税込)。承認/送信後は不変。';

-- ── 2. 計上台帳に void 列を足し、unique を「非void のみ」の部分一意へ切替 ──
-- void された計上は履歴として残しつつ、再発行で同一 leg を再計上できるようにする (生涯1回は "非void" で担保)。
alter table shipment_invoice_postings
  add column if not exists voided_at timestamptz,
  add column if not exists billed_version int not null default 1;
alter table shipment_invoice_postings drop constraint if exists shipment_invoice_postings_uq;
create unique index if not exists shipment_invoice_postings_active_uq
  on shipment_invoice_postings (shipment_id) where voided_at is null;

-- ── 3. 請求書の訂正/再発行履歴 (追記のみ) ──
create table if not exists public.invoice_versions (
  id uuid primary key default gen_random_uuid(),
  agency text not null,
  month  text not null,
  invoice_no text,
  invoice_version int not null default 1,
  action text not null
    check (action in ('prepared','approved','sent','paid','voided','reissued','recomputed')),
  status_before text,
  status_after  text,
  total_yen int,
  piece_count int,
  reason text,
  acted_by text,
  created_at timestamptz not null default now()
);
create index if not exists invoice_versions_agency_month_idx
  on public.invoice_versions (agency, month, created_at);
alter table public.invoice_versions enable row level security;
-- policy なし = service_role のみ。

-- ── 4. 現在の実効ステータスを導出 (レガシー行=status null の後方互換) ──
create or replace function invoice_effective_status(p_agency text, p_month text)
returns text language plpgsql stable as $$
declare r record;
begin
  select status, approved_at, sent_to_agency_at, paid_at, voided_at
    into r from invoice_sends where agency=p_agency and month=p_month;
  if not found then return null; end if;
  if r.status is not null then return r.status; end if;
  -- レガシー導出 (既存の暗黙状態)。
  if r.voided_at is not null then return 'voided'; end if;
  if r.paid_at is not null then return 'paid'; end if;
  if r.sent_to_agency_at is not null then return 'sent'; end if;
  if r.approved_at is not null then return 'approved'; end if;
  return 'prepared';
end; $$;

-- ── 5. 状態遷移 RPC (すべて (agency,month) を advisory lock で直列化・外部I/Oは含まない) ──

-- 5-1. prepared: 明細・金額を確定 (draft/未作成/prepared からのみ・再 prepare は再計算を許容)。
--      approved/sent/paid は黙って金額を書き換えない (already_finalized)。
create or replace function invoice_prepare(
  p_agency text, p_month text, p_invoice_no text, p_total_yen int, p_piece_count int
) returns table(ok boolean, status text, reason text)
language plpgsql as $$
declare cur text;
begin
  perform pg_advisory_xact_lock(hashtextextended('invdoc|'||p_agency||'|'||p_month, 0));
  cur := invoice_effective_status(p_agency, p_month);
  if cur in ('approved','sent','paid') then
    return query select false, cur, 'already_finalized'::text; return; end if;
  if cur = 'voided' then
    return query select false, 'voided'::text, 'use_reissue'::text; return; end if;
  insert into invoice_sends(agency, month, invoice_no, status, prepared_at, prepared_total_yen, prepared_piece_count)
    values (p_agency, p_month, p_invoice_no, 'prepared', now(), p_total_yen, p_piece_count)
  on conflict (agency, month) do update set
    invoice_no = excluded.invoice_no, status='prepared', prepared_at=now(),
    prepared_total_yen=excluded.prepared_total_yen, prepared_piece_count=excluded.prepared_piece_count;
  insert into public.invoice_versions(agency,month,invoice_no,invoice_version,action,status_before,status_after,total_yen,piece_count)
    select p_agency,p_month,p_invoice_no,invoice_version,'prepared',cur,'prepared',p_total_yen,p_piece_count
    from invoice_sends where agency=p_agency and month=p_month;
  return query select true, 'prepared'::text, 'ok'::text;
end; $$;

-- 5-2. approved: prepared → approved。
create or replace function invoice_approve(p_agency text, p_month text, p_by text default 'operator')
returns table(ok boolean, status text, reason text)
language plpgsql as $$
declare cur text;
begin
  perform pg_advisory_xact_lock(hashtextextended('invdoc|'||p_agency||'|'||p_month, 0));
  cur := invoice_effective_status(p_agency, p_month);
  if cur <> 'prepared' then return query select false, coalesce(cur,'none'), ('not_prepared:'||coalesce(cur,'none'))::text; return; end if;
  update invoice_sends set status='approved', approved_at=coalesce(approved_at,now()), approved_by=p_by
    where agency=p_agency and month=p_month;
  insert into public.invoice_versions(agency,month,invoice_no,invoice_version,action,status_before,status_after,total_yen,piece_count,acted_by)
    select p_agency,p_month,invoice_no,invoice_version,'approved',cur,'approved',prepared_total_yen,prepared_piece_count,p_by
    from invoice_sends where agency=p_agency and month=p_month;
  return query select true, 'approved'::text, 'ok'::text;
end; $$;

-- 5-3. sent: approved → sent (sent_to_agency_at IS NULL の CAS で二重送付記録を防ぐ)。
create or replace function invoice_mark_sent(p_agency text, p_month text, p_to text default null)
returns table(ok boolean, status text, reason text)
language plpgsql as $$
declare cur text; v_n int;
begin
  perform pg_advisory_xact_lock(hashtextextended('invdoc|'||p_agency||'|'||p_month, 0));
  cur := invoice_effective_status(p_agency, p_month);
  if cur <> 'approved' then return query select false, coalesce(cur,'none'), ('not_approved:'||coalesce(cur,'none'))::text; return; end if;
  update invoice_sends set status='sent', sent_to_agency_at=now(),
    sent_to = (select array(select distinct e from unnest(coalesce(sent_to,'{}')||case when p_to is null then '{}'::text[] else array[p_to] end) e))
    where agency=p_agency and month=p_month and sent_to_agency_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then return query select false, cur, 'already_sent'::text; return; end if;
  insert into public.invoice_versions(agency,month,invoice_no,invoice_version,action,status_before,status_after,total_yen,piece_count)
    select p_agency,p_month,invoice_no,invoice_version,'sent',cur,'sent',prepared_total_yen,prepared_piece_count
    from invoice_sends where agency=p_agency and month=p_month;
  return query select true, 'sent'::text, 'ok'::text;
end; $$;

-- 5-4. paid: sent → paid。
create or replace function invoice_mark_paid(p_agency text, p_month text)
returns table(ok boolean, status text, reason text)
language plpgsql as $$
declare cur text;
begin
  perform pg_advisory_xact_lock(hashtextextended('invdoc|'||p_agency||'|'||p_month, 0));
  cur := invoice_effective_status(p_agency, p_month);
  if cur <> 'sent' then return query select false, coalesce(cur,'none'), ('not_sent:'||coalesce(cur,'none'))::text; return; end if;
  update invoice_sends set status='paid', paid_at=now() where agency=p_agency and month=p_month;
  insert into public.invoice_versions(agency,month,invoice_no,invoice_version,action,status_before,status_after,total_yen,piece_count)
    select p_agency,p_month,invoice_no,invoice_version,'paid',cur,'paid',prepared_total_yen,prepared_piece_count
    from invoice_sends where agency=p_agency and month=p_month;
  return query select true, 'paid'::text, 'ok'::text;
end; $$;

-- 5-5. voided: prepared/approved/sent を取消 (paid は不可)。履歴を残し、当該月の計上を void して leg を解放。
create or replace function invoice_void(p_agency text, p_month text, p_reason text, p_by text default 'operator')
returns table(ok boolean, status text, reason text)
language plpgsql as $$
declare cur text;
begin
  if p_reason is null or btrim(p_reason)='' then return query select false, null::text, 'reason_required'::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('invdoc|'||p_agency||'|'||p_month, 0));
  cur := invoice_effective_status(p_agency, p_month);
  if cur not in ('prepared','approved','sent') then
    return query select false, coalesce(cur,'none'), ('not_voidable:'||coalesce(cur,'none'))::text; return; end if;
  insert into public.invoice_versions(agency,month,invoice_no,invoice_version,action,status_before,status_after,total_yen,piece_count,reason,acted_by)
    select p_agency,p_month,invoice_no,invoice_version,'voided',cur,'voided',prepared_total_yen,prepared_piece_count,p_reason,p_by
    from invoice_sends where agency=p_agency and month=p_month;
  update invoice_sends set status='voided', voided_at=now(), void_reason=p_reason, void_by=p_by
    where agency=p_agency and month=p_month;
  -- 当該月の計上を void = leg を解放 (再発行で修正額を再計上できる。生涯1回は "非void" で担保)。
  update shipment_invoice_postings set voided_at=now()
    where agency=p_agency and billed_month=p_month and voided_at is null;
  return query select true, 'voided'::text, 'ok'::text;
end; $$;

-- 5-6. reissue: voided → 新バージョンの draft (invoice_no/承認/送付をクリアし version+1)。解放済み leg を再計上可能に。
create or replace function invoice_reissue(p_agency text, p_month text, p_by text default 'operator')
returns table(ok boolean, status text, reason text, new_version int)
language plpgsql as $$
declare cur text; v_old text; v_ver int;
begin
  perform pg_advisory_xact_lock(hashtextextended('invdoc|'||p_agency||'|'||p_month, 0));
  cur := invoice_effective_status(p_agency, p_month);
  if cur <> 'voided' then return query select false, coalesce(cur,'none'), ('not_voided:'||coalesce(cur,'none'))::text, null::int; return; end if;
  select invoice_no, invoice_version into v_old, v_ver from invoice_sends where agency=p_agency and month=p_month;
  update invoice_sends set status='draft', invoice_version=v_ver+1, reissue_of=v_old,
    invoice_no=null, prepared_at=null, prepared_total_yen=null, prepared_piece_count=null,
    approved_at=null, approved_by=null, sent_to_agency_at=null, sent_to=null,
    paid_at=null, voided_at=null, void_reason=null, void_by=null
    where agency=p_agency and month=p_month;
  insert into public.invoice_versions(agency,month,invoice_no,invoice_version,action,status_before,status_after,reason,acted_by)
    values (p_agency,p_month,v_old,v_ver+1,'reissued','voided','draft',('reissue_of:'||coalesce(v_old,'')),p_by);
  return query select true, 'draft'::text, 'ok'::text, v_ver+1;
end; $$;

-- ── 6. claim_invoice_postings を「非void のみ」計上に再定義 (void された leg は再計上可能) ──
-- 066 版との差分: 既計上判定と on conflict と戻り値をすべて voided_at is null に限定。
-- INSERT は RETURNS TABLE の OUT 変数 shipment_id と列名が衝突する (on conflict (shipment_id) が曖昧)
-- ため、OUT 変数を持たない void 関数へ切り出す (claim 側の advisory lock と同一 Tx で実行)。
create or replace function post_invoice_legs(p_agency text, p_month text) returns void
language plpgsql as $$
declare m_from date; m_to date;
begin
  m_from := (p_month || '-01')::date;
  m_to := (m_from + interval '1 month' - interval '1 day')::date;
  insert into public.shipment_invoice_postings(shipment_id, agency, billed_month, shipment_date, net_yen, gross_yen)
  select t.id, p_agency, p_month, t.shipment_date,
         coalesce(t.amount_yen,0),
         coalesce(t.amount_yen,0) + (coalesce(t.amount_yen,0) / 10)   -- grossOf: net + floor(net/10)
  from shipments t
  where t.agency = p_agency
    and t.status in ('issued','picked_up','in_transit','delivered')
    and coalesce(t.amount_yen,0) > 0
    and not exists (select 1 from public.shipment_invoice_postings p
                    where p.shipment_id = t.id and p.voided_at is null)   -- 非void の計上が無いものだけ
    and (
      (t.shipment_date between m_from and m_to)
      or (t.charge_hold_state = 'released' and t.shipment_date < m_from)
    )
    and (
      t.charge_hold_state = 'released'
      or (t.charge_hold_state = 'auto' and not (select hold from evaluate_charge_hold(t.id)))
    )
  on conflict (shipment_id) where voided_at is null do nothing;   -- 部分一意インデックスを推論
end; $$;

create or replace function claim_invoice_postings(p_agency text, p_month text)
returns table(shipment_id uuid, booking_id text, leg_index int, shipment_date date,
              net_yen int, gross_yen int, billed_month text, is_adjustment boolean)
language plpgsql as $$
declare m_from date;
begin
  if p_agency is null or p_month !~ '^\d{4}-\d{2}$' then return; end if;
  m_from := (p_month || '-01')::date;
  perform pg_advisory_xact_lock(hashtextextended('inv|'||p_agency||'|'||p_month, 0));
  perform post_invoice_legs(p_agency, p_month);   -- 計上 (同一 Tx・ロック配下)
  return query
    select p.shipment_id, t.booking_id, t.leg_index, p.shipment_date,
           p.net_yen, p.gross_yen, p.billed_month,
           (p.shipment_date < m_from) as is_adjustment
    from public.shipment_invoice_postings p
    join shipments t on t.id = p.shipment_id
    where p.agency = p_agency and p.billed_month = p_month and p.voided_at is null
    order by p.shipment_date, t.booking_id, t.leg_index;
end; $$;
