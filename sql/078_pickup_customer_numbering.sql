-- Biz-Logi の顧客側採番 (BondEx が問合番号を採番して送る) の番号範囲・台帳・採番 (2026-11-04 SG 喜田様の正式回答・谷口さん指示)。未適用。
-- **オプション** (2026-11-04 谷口さん決定): 標準は Biz-Logi のシステム採番 (アプリの BIZLOGI_NUMBERING 未設定)。
--   この SQL を流しても、BIZLOGI_NUMBERING=customer にしない限り番号は払い出されず、送る電文も記録も変わらない。
--   送った番号 (assigned_number) は、顧客側採番で実際に送るときにアプリが pickup_set_assigned_number で書く
--   (区間の台帳から自動では写さない = システム採番で送った依頼に番号が付かない)。一度書いたら変えられない。
-- 前提: sql/067 (pickup_requests)・sql/068 (pickup_number_in_use。台帳があれば台帳も見る)。
--
-- SG の回答 (確定仕様):
--   - N01 集荷依頼プランで顧客側採番が使える。問合番号採番区分 (仕様書 p.28 1-7 shippingNumberType) = 1、
--     顧客指定問合番号 (p.35 1-9-1-49 shippingNumber・12桁・チェックデジット込み) に BondEx の番号を入れる
--   - 重複は E1-0206、範囲外は E1-0207 で返る (5.2)
-- 方針: 顧客側採番を使うと決めたときだけ範囲を登録する。**SG の専用の番号範囲が届くまで範囲は登録しない** (推測の番号を使わない)。
--   範囲が無ければ採番せず、Biz-Logi の送信はアプリが止める。
--
-- 仕組み:
--   pickup_number_ranges  … SG 指定の番号範囲 (接続先ごと)。番号の本体 (先頭11桁) の範囲と、次に払い出す本体
--   pickup_number_ledger  … 払い出した番号の台帳。番号が主キー (同じ番号は二度と払い出さない)
--                           1区間に有効な番号は1つ (部分一意インデックス)。同じ区間の送り直しは同じ番号
--   pickup_leg_number()   … 区間の番号を返す (有効な番号があればそれ、無ければ範囲から払い出す)。
--                           範囲の行を行ロックして払い出すので、同時に動いても重複しない
-- チェックデジット: 先頭11桁を 7 で割った余り (佐川の12桁の問合番号の規則。本番の実在番号 24件で一致を確認・
--   2026-11-04。SG の範囲の通知で計算方法が違えば check_digit_rule を変える)。
-- 番号を使わなくなる (台帳の active=false) のは:
--   佐川で依頼が取り消された (pickup_requests.state=cancelled) / 範囲外・桁数の誤りで佐川が受け付けなかった (retire)。
--   送信失敗 (failed・佐川に登録なし) と 依頼なしの確認 (void) は同じ番号で送り直す (番号を無駄にしない・二重にならない)。
-- 再実行できる。戻すとき: sql/rollback/rollback_067_072.sql の 078 の段。

-- 移行の表の確保 (2026-11-04 デッドロック対策・078)。関係する表を「待たずに」まとめて掴む (nowait)。
-- 掴めなければ何も持たずに 0.2秒待って掴み直す (待っている間は表を持たないので、利用者の操作とデッドロックしない)。
-- 掴んだ後は、この SQL が終わるまで (1秒未満) 利用者の操作のほうが待つだけで、失敗しない。
-- 10秒たっても掴めなければ、何も変えずに失敗する (少し待って流し直す)。1つのトランザクションの中で流すこと。
do $migration_lock$
declare
  targets text;
  deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  -- 存在する表だけ (例: 067 の前は pickup_requests が無い)
  select string_agg(t, ', ') into targets from unnest(array['public.shipments', 'public.pickup_requests', 'public.shipment_change_requests', 'public.operator_passkeys']) t where to_regclass(t) is not null;
  if targets is null then return; end if;
  loop
    begin
      execute format('lock table %s in access exclusive mode nowait', targets);
      return;
    exception when lock_not_available then
      -- 経過した時間で区切る（回数で数えると、1回ごとの手間の分だけ 10秒を超える: 実測 10.2〜12.4秒）
      if clock_timestamp() >= deadline then
        raise exception 'migration: 表 (%) を10秒以内に確保できませんでした。何も変えていません。少し待って流し直してください', targets;
      end if;
      perform pg_sleep(least(0.2, greatest(0.01, extract(epoch from (deadline - clock_timestamp())))));
    end;
  end loop;
end $migration_lock$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 番号範囲
create table if not exists public.pickup_number_ranges (
  id               uuid primary key default gen_random_uuid(),
  environment      text not null check (environment in ('test', 'production')),
  body_start       bigint not null check (body_start between 0 and 99999999999),  -- 先頭11桁 (チェックデジットを除く)
  body_end         bigint not null check (body_end between 0 and 99999999999),
  next_body        bigint not null,
  check_digit_rule text not null default 'mod7' check (check_digit_rule in ('mod7')),
  active           boolean not null default true,
  source_note      text not null check (length(btrim(source_note)) > 0),  -- SG の通知 (日付・担当・文書) を必ず書く
  created_at       timestamptz not null default now(),
  created_by       text not null,
  check (body_start <= body_end),
  check (next_body between body_start and body_end + 1)
);
-- 接続先ごとに使う範囲は1つ (使い切ったら active=false にして次の範囲を登録する)
create unique index if not exists pickup_number_ranges_one_active on public.pickup_number_ranges (environment) where active;
alter table public.pickup_number_ranges enable row level security;
revoke all on table public.pickup_number_ranges from public, anon, authenticated;

-- 2. 台帳
create table if not exists public.pickup_number_ledger (
  number         text primary key check (number ~ '^[0-9]{12}$'),
  shipment_id    uuid not null references public.shipments(id) on delete restrict,
  environment    text not null check (environment in ('test', 'production')),
  range_id       uuid not null references public.pickup_number_ranges(id),
  active         boolean not null default true,
  assigned_at    timestamptz not null default now(),
  retired_at     timestamptz,
  retired_reason text,
  check (active or retired_at is not null)
);
create unique index if not exists pickup_number_ledger_one_active_per_leg
  on public.pickup_number_ledger (shipment_id, environment) where active;
alter table public.pickup_number_ledger enable row level security;
revoke all on table public.pickup_number_ledger from public, anon, authenticated;

-- 3. 集荷依頼の記録に「送った番号」を残す (Biz-Logi の応答の番号と照合する・結果不明のときに番号で確かめる)
alter table public.pickup_requests add column if not exists assigned_number text check (assigned_number is null or assigned_number ~ '^[0-9]{12}$');

-- 4. チェックデジット
create or replace function public.sagawa_check_digit_ok(p_number text)
returns boolean language sql immutable as $$
  select p_number ~ '^[0-9]{12}$' and (left(p_number, 11)::bigint % 7) = right(p_number, 1)::int;
$$;

-- 5. 番号が使われているか: sql/068 の pickup_number_in_use が、この台帳があればほかの区間の番号も「使用中」に含める
--    (ここでは置き換えない。068 を流し直しても判定が古くならないように)。

-- 6. 区間の番号 (無ければ払い出す)。戻り値: ok・番号・理由 (no_number_range / number_range_exhausted / leg_not_found)
create or replace function public.pickup_leg_number(p_shipment_id uuid, p_environment text)
returns table (ok boolean, number text, reason text)
language plpgsql security definer set search_path = public as $$
declare
  rg      public.pickup_number_ranges;
  v_body  bigint;
  v_num   text;
  v_tries int := 0;
begin
  if p_environment not in ('test', 'production') then
    return query select false, null::text, 'invalid_environment'::text; return;
  end if;
  perform 1 from public.shipments where id = p_shipment_id for update;  -- 同じ区間の同時の払い出しを1つにする
  if not found then return query select false, null::text, 'leg_not_found'::text; return; end if;

  select l.number into v_num from public.pickup_number_ledger l
   where l.shipment_id = p_shipment_id and l.environment = p_environment and l.active;
  if v_num is not null then return query select true, v_num, 'existing'::text; return; end if;

  select * into rg from public.pickup_number_ranges r
   where r.environment = p_environment and r.active
   for update;  -- 範囲の行を掴む = 払い出しは1つずつ
  if not found then return query select false, null::text, 'no_number_range'::text; return; end if;

  v_body := rg.next_body;
  loop
    if v_body > rg.body_end then
      update public.pickup_number_ranges set next_body = v_body where id = rg.id;
      return query select false, null::text, 'number_range_exhausted'::text; return;
    end if;
    v_num := lpad(v_body::text, 11, '0') || (v_body % 7)::text;
    -- 手動 (Excel) の番号・ほかの区間の番号・以前に払い出した番号とぶつかる候補は飛ばす
    exit when not public.pickup_number_in_use(v_num, p_shipment_id)
          and not exists (select 1 from public.pickup_number_ledger l where l.number = v_num);
    v_body := v_body + 1;
    v_tries := v_tries + 1;
    if v_tries > 10000 then raise exception 'pickup_leg_number: 空いている番号が見つかりません (範囲 %)', rg.id; end if;
  end loop;

  insert into public.pickup_number_ledger (number, shipment_id, environment, range_id)
  values (v_num, p_shipment_id, p_environment, rg.id);
  update public.pickup_number_ranges set next_body = v_body + 1 where id = rg.id;
  return query select true, v_num, 'allocated'::text;
end;
$$;

-- 7. 番号を使わなくする (範囲外・桁数の誤りで佐川が受け付けなかった等)。次の送信は新しい番号になる
create or replace function public.pickup_retire_number(p_number text, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.pickup_number_ledger set active = false, retired_at = now(), retired_reason = left(coalesce(p_reason, ''), 500)
   where number = p_number and active;
  return found;
end;
$$;

-- 8. 送った番号の記録 (顧客側採番で送るときだけ・アプリが明示的に書く)。
--    書けるのは: Biz-Logi の依頼・送信中 (確保の直後・佐川へ送る前)・まだ番号が無い・区間に有効な台帳の番号と同じとき。
drop function if exists public.pickup_set_assigned_number(uuid, text);  -- 戻り値の形を変えても流し直せるように
create or replace function public.pickup_set_assigned_number(p_request_id uuid, p_number text)
returns table (ok boolean) language plpgsql security definer set search_path = public as $$
declare
  r public.pickup_requests;
begin
  select * into r from public.pickup_requests pr where pr.id = p_request_id for update;
  if not found or r.channel <> 'bizlogi' or r.state <> 'sending' or r.environment is null then
    return query select false; return;
  end if;
  if r.assigned_number is not null then return query select r.assigned_number = p_number; return; end if;
  if not exists (select 1 from public.pickup_number_ledger l
                  where l.number = p_number and l.shipment_id = r.shipment_id and l.environment = r.environment and l.active) then
    return query select false; return;
  end if;
  update public.pickup_requests pr set assigned_number = p_number where pr.id = p_request_id;
  return query select true;
end;
$$;

--    送った番号は一度書いたら変えられない (採番方式を切り替えても、送信中・結果不明・受付済みの依頼の番号は変わらない)。
--    佐川で取り消されたら番号を使わなくする (再利用しない)。
create or replace function public.pickup_requests_numbering()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- 確保の時点では番号を持たない (システム採番の依頼に番号が付かないように。顧客側採番はこの後アプリが書く)
    new.assigned_number := null;
    return new;
  end if;
  if old.assigned_number is not null and new.assigned_number is distinct from old.assigned_number then
    raise exception 'pickup_requests: 送った問合番号 (assigned_number) は変更できません';
  end if;
  if old.assigned_number is null and new.assigned_number is not null and old.state <> 'sending' then
    raise exception 'pickup_requests: 送った問合番号は送信中の依頼にだけ記録できます';
  end if;
  if new.state = 'cancelled' and old.state is distinct from 'cancelled' and new.assigned_number is not null then
    update public.pickup_number_ledger set active = false, retired_at = now(), retired_reason = '佐川で依頼を取消 (番号は再利用しない)'
     where number = new.assigned_number and active;
  end if;
  return new;
end;
$$;
drop trigger if exists pickup_requests_numbering_ins on public.pickup_requests;
create trigger pickup_requests_numbering_ins before insert on public.pickup_requests
  for each row execute function public.pickup_requests_numbering();
drop trigger if exists pickup_requests_numbering_upd on public.pickup_requests;
drop trigger if exists pickup_requests_numbering_guard on public.pickup_requests;
create trigger pickup_requests_numbering_guard before update on public.pickup_requests
  for each row execute function public.pickup_requests_numbering();

-- 9. 実行権限: サーバ (service_role) だけ
revoke all on function public.pickup_leg_number(uuid, text) from public, anon, authenticated;
revoke all on function public.pickup_retire_number(text, text) from public, anon, authenticated;
revoke all on function public.pickup_set_assigned_number(uuid, text) from public, anon, authenticated;
revoke all on function public.pickup_requests_numbering() from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.pickup_leg_number(uuid, text) to service_role';
  execute 'grant execute on function public.pickup_retire_number(text, text) to service_role';
  execute 'grant execute on function public.pickup_set_assigned_number(uuid, text) to service_role';
  execute 'grant select on table public.pickup_number_ranges, public.pickup_number_ledger to service_role';
exception when undefined_object then null; end $$;
