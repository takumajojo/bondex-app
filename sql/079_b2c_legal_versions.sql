-- B2C（旅行者向け）の規約の版と同意の記録（B1・D5・G7。2026-11-05）。未適用。
-- 目的: 予約の時に同意した規約を、後から完全に再現できるようにする。
--   - b2c_legal_documents … 規約・キャンセル規定・特商法の表記・プライバシーポリシー・同意の欄の文言を、版×種類×言語で残す。
--                            追記だけ（書き換え・削除はできない）。本文と SHA-256 が一致しない行は入らない。
--   - b2c_orders に、予約の画面の同意（規約の版・言語・日時）と、カード登録の画面の同意（後日の請求の版・日時）を分けて残す。
--     これまでは、カード登録の時に consent_version・consented_at をカードの同意の版で上書きしていた
--     （予約の時の規約の版が残らなかった）。consent_version・consented_at は予約の画面の同意として残す（既存の判定が使う）。
--   - 請求の前の確認（b2c_charge_check）に「カード登録の同意があること」を足す。
-- 前提: sql/061（b2c_orders）・sql/074（b2c_charge_check）。074 の後に流す（b2c_charge_check を置き換えるため）。
-- 順番: アプリの前に流す（新しいアプリは新しい列に書く。古いアプリはこの SQL の後も動く: 新しい列に書かないだけ。
--   ただし古いアプリで予約を確定すると、下の制約で確定できない → B2C は機能フラグ OFF のまま流すこと）。
-- 本文の登録は scripts/b2c-legal/register-docs.ts が SQL を作る（公開する版を決めた時に流す）。
-- 再実行できる。戻すとき: sql/rollback/rollback_079.sql。
set local lock_timeout = '5s';

-- 1. 規約の本文（版ごと・追記だけ）---------------------------------------------------------------
create table if not exists public.b2c_legal_documents (
  version       text not null check (version ~ '^[0-9A-Za-z._-]{1,64}$'),
  kind          text not null check (kind in ('terms', 'cancellation', 'tokushoho', 'privacy', 'booking_consent', 'card_consent')),
  lang          text not null check (lang in ('ja', 'en')),
  body          text not null check (length(body) > 0),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  registered_at timestamptz not null default now(),
  primary key (version, kind, lang),
  constraint b2c_legal_documents_sha256_matches check (sha256 = encode(sha256(convert_to(body, 'UTF8')), 'hex'))
);
comment on table public.b2c_legal_documents is 'B2C の規約・同意の文言の版ごとの本文。追記だけ（sql/079）。予約の b2c_orders.terms_version・card_consent_version から引く';

create or replace function public.b2c_legal_documents_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'b2c_legal_documents は追記だけです（版の本文は書き換え・削除できません。新しい版を足してください）';
end $$;
drop trigger if exists b2c_legal_documents_append_only on public.b2c_legal_documents;
create trigger b2c_legal_documents_append_only before update or delete on public.b2c_legal_documents
  for each row execute function public.b2c_legal_documents_append_only();
drop trigger if exists b2c_legal_documents_no_truncate on public.b2c_legal_documents;
create trigger b2c_legal_documents_no_truncate before truncate on public.b2c_legal_documents
  for each statement execute function public.b2c_legal_documents_append_only();

alter table public.b2c_legal_documents enable row level security;
revoke execute on function public.b2c_legal_documents_append_only() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.b2c_legal_documents from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.b2c_legal_documents from service_role;
    grant select, insert on public.b2c_legal_documents to service_role;  -- 書き換え・削除の権限は渡さない
  end if;
end $$;

-- 2. 予約の同意の記録 -----------------------------------------------------------------------------
alter table public.b2c_orders add column if not exists terms_version        text;
alter table public.b2c_orders add column if not exists terms_lang           text;
alter table public.b2c_orders add column if not exists terms_consented_at   timestamptz;
alter table public.b2c_orders add column if not exists card_consent_version text;
alter table public.b2c_orders add column if not exists card_consented_at    timestamptz;
comment on column public.b2c_orders.terms_version is '予約の画面で同意した規約の版（b2c_legal_documents.version。kind=terms・cancellation・tokushoho・privacy・booking_consent）';
comment on column public.b2c_orders.terms_lang is '同意した時の画面の言語（ja・en）';
comment on column public.b2c_orders.card_consent_version is 'カード登録の画面で同意した後日の請求の文言の版（b2c_legal_documents.version・kind=card_consent）';

do $$ begin
  alter table public.b2c_orders add constraint b2c_orders_terms_lang_chk check (terms_lang is null or terms_lang in ('ja', 'en'));
exception when duplicate_object then null; end $$;

-- 既存の行: カード登録の時にカードの同意の版で上書きされていた行は、カードの同意の列へ写す。
-- 予約の時の規約の版は残っていないので、terms_version は空のまま（下書きの版の時期の試験の予約だけ）。
update public.b2c_orders
   set card_consent_version = consent_version, card_consented_at = consented_at
 where card_consent_version is null and consent_version like '%card%';

-- 確定・完了の予約は、カード登録の同意があること（新しい行から確かめる。既存の行は上で写した）
do $$ begin
  alter table public.b2c_orders add constraint b2c_orders_card_consent_chk
    check (status not in ('confirmed', 'completed') or (card_consent_version is not null and card_consented_at is not null)) not valid;
exception when duplicate_object then null; end $$;

-- 3. 請求の前の確認に「カード登録の同意」を足す（sql/074 の b2c_charge_check と同じ。足したのは no_card_consent の1行だけ）---
create or replace function public.b2c_charge_check(p public.b2c_payments) returns text language plpgsql stable as $$
declare
  o public.b2c_orders%rowtype;
  c public.b2c_pickup_confirmations%rowtype;
  s public.shipments%rowtype;
  n_num  int;
  n_cnt  int;
  carrier int;
begin
  select * into o from public.b2c_orders where id = p.order_id;
  if o.status not in ('confirmed', 'completed') then return 'order_' || o.status; end if;
  if o.card_status <> 'registered' or o.stripe_payment_method_id is null or o.stripe_customer_id is null then return 'no_card'; end if;
  if o.consented_at is null or o.consent_version is null then return 'no_consent'; end if;
  if o.card_consented_at is null or o.card_consent_version is null then return 'no_card_consent'; end if;
  select * into c from public.b2c_pickup_confirmations where id = p.pickup_confirmation_id;
  if not found or c.revoked_at is not null then return 'pickup_revoked'; end if;
  select * into s from public.shipments where id = c.shipment_id;
  if s.status not in ('picked_up', 'in_transit', 'delivered') then return 'shipment_' || s.status; end if;
  -- 佐川の正式な個数と矛盾しないこと。
  -- 佐川は複数個口でも問い合わせ番号は 1つ（マスター 31・33）なので、追跡番号の数は個数ではない。
  -- 正式な個数はお荷物問い合わせ API の detail_info.number（マスター 45・93）で、追跡の同期が
  -- shipments.tracking_detail[].pieceCount に入れる（feat/sagawa-tracking-api）。全番号の個数がそろった時だけ合計と比べる。
  select count(*), count(d -> 'pieceCount'), coalesce(sum((d ->> 'pieceCount')::int), 0)
    into n_num, n_cnt, carrier
    from jsonb_array_elements(case when jsonb_typeof(s.tracking_detail) = 'array' then s.tracking_detail else '[]'::jsonb end) d
   where jsonb_typeof(d -> 'pieceCount') = 'number' or d -> 'pieceCount' is null;
  if n_num > 0 and n_cnt = n_num and carrier <> c.accepted_pieces and not ('carrier_piece_mismatch' = any(p.checks_overridden)) then
    return 'carrier_piece_mismatch';
  end if;
  -- 金額は料金の控え（予約の時の 1個あたりの税抜の単価）と個数から
  if p.unit_net_yen is distinct from o.unit_net_yen or p.pieces is null or p.pieces < 1 then return 'amount_mismatch'; end if;
  if p.kind = 'base' then
    if p.pieces <> c.accepted_pieces or p.amount_yen <> public.b2c_amount_for(o.unit_net_yen, p.pieces) then return 'amount_mismatch'; end if;
    if c.accepted_pieces <> o.pieces and not ('pieces_mismatch' = any(p.checks_overridden)) then return 'pieces_mismatch'; end if;
  end if;
  if exists (select 1 from public.b2c_payments x where x.order_id = p.order_id and x.id <> p.id and x.status in ('processing', 'unknown', 'requires_action')) then
    return 'other_charge_active';
  end if;
  return null;
end $$;
