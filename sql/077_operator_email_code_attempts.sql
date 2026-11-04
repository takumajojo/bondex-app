-- =============================================================================
-- 077_operator_email_code_attempts.sql — 運営のパスキーの登録の本人確認（メールの 6桁のコード）の総当たり対策
-- Stage 6 の Blocker B2（docs/b2c/B2C_STAGE6_LAUNCH_READINESS.md）。たくまさん承認 2026-11-04。
--
-- 旧: コードの HMAC を cookie に入れるだけで、試行の回数の制限が無く（端末・IP ごとの回数の制限だけ）、
--     成功の後も同じコードを使え、コードを送り直せば何度でも試せた。
-- 新:
--   1. コードごとの記録（operator_email_challenges）を DB に持ち、失敗 5回でそのコードを無効にする（locked）。
--   2. 試行の回数は端末・IP ではなく DB の記録で数える。
--   3. コードは 1回限り（登録が終わったら used。以後は使えない）。
--   4. 送り直しで回数を戻せない: 新しいコードは、同じメールの直前のコードの失敗の回数を引き継ぎ、前のコードは無効（superseded）。
--      失敗 5回で止まったメールには 60分コードを出さない。同じメールに出すコードは 60分に 5回まで。
--   5. 試行は 1つの関数の中で行をロックして数える（同時に送っても 5回を超えて試せない）。
--   6. 発行・失敗・無効化・成功を監査の記録（operator_auth_events）に残す。コードそのものは記録しない（DB にも残さない）。
--   コードは保存せず、HMAC(サーバーの秘密, コードの記録の ID ':' コード) だけを保存する（lib/operator-session.ts）。
-- B2B のパスキーのログイン・登録済みのパスキー・運営のパスワードの認証には触れない。再実行できる。
-- 本番への適用は別の承認（アプリのデプロイより前に流す。無いとメールのコードでの新しい登録はできない＝安全側）。
-- =============================================================================

create table if not exists public.operator_email_challenges (
  id           uuid primary key,
  email        text not null check (email = lower(btrim(email)) and length(email) between 3 and 320),
  code_hash    text not null check (length(code_hash) >= 32),
  status       text not null default 'active' check (status in ('active', 'verified', 'used', 'locked', 'superseded', 'expired')),
  attempts     int  not null default 0 check (attempts >= 0),
  max_attempts int  not null default 5 check (max_attempts between 1 and 10),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  verified_at  timestamptz,
  used_at      timestamptz,
  locked_at    timestamptz
);
create index if not exists operator_email_challenges_email on public.operator_email_challenges(email, created_at desc);
alter table public.operator_email_challenges enable row level security;

create table if not exists public.operator_auth_events (
  id           bigint generated always as identity primary key,
  event        text not null,   -- code_issued / code_issue_refused / code_failed / code_locked / code_verified / code_used / code_rejected
  email        text,
  challenge_id uuid,
  attempts     int,
  detail       text,            -- 理由（locked_out・rate_limited・expired 等）。コードは入れない
  created_at   timestamptz not null default now()
);
create index if not exists operator_auth_events_email on public.operator_auth_events(email, created_at desc);
alter table public.operator_auth_events enable row level security;

-- 発行。戻り値: issued / locked_out（60分以内に失敗 5回で止まった）/ rate_limited（60分に 5回まで）
create or replace function public.operator_email_challenge_issue(
  p_id uuid, p_email text, p_code_hash text, p_now timestamptz default now(), p_ttl interval default interval '10 minutes'
) returns text language plpgsql as $$
declare
  e text := lower(btrim(p_email));
  inherited int;
  n_recent int;
begin
  -- 同じメールの発行・試行を 1つずつにする（同時に送り直しても回数を戻せない）
  perform pg_advisory_xact_lock(hashtextextended('operator-email:' || e, 0));
  if exists (select 1 from public.operator_email_challenges where email = e and status = 'locked' and locked_at > p_now - interval '60 minutes') then
    insert into public.operator_auth_events(event, email, detail) values ('code_issue_refused', e, 'locked_out');
    return 'locked_out';
  end if;
  select count(*) into n_recent from public.operator_email_challenges where email = e and created_at > p_now - interval '60 minutes';
  if n_recent >= 5 then
    insert into public.operator_auth_events(event, email, detail) values ('code_issue_refused', e, 'rate_limited');
    return 'rate_limited';
  end if;
  -- 直前の有効なコードの失敗の回数を引き継ぎ、前のコードは無効にする
  select coalesce(max(attempts), 0) into inherited from public.operator_email_challenges
   where email = e and status in ('active', 'verified') and created_at > p_now - interval '60 minutes';
  update public.operator_email_challenges set status = 'superseded' where email = e and status in ('active', 'verified');
  insert into public.operator_email_challenges(id, email, code_hash, attempts, created_at, expires_at)
  values (p_id, e, p_code_hash, inherited, p_now, p_now + p_ttl);
  insert into public.operator_auth_events(event, email, challenge_id, attempts) values ('code_issued', e, p_id, inherited);
  return 'issued';
end $$;

-- 試行。p_consume=false は登録の第1段（確認だけ・verified）、true は第2段（使い切る・used）。
-- 戻り値: ok / wrong（失敗・まだ使える）/ locked（失敗 5回で無効）/ used / superseded / expired / not_found
create or replace function public.operator_email_challenge_attempt(
  p_id uuid, p_email text, p_code_hash text, p_consume boolean, p_now timestamptz default now()
) returns text language plpgsql as $$
declare
  e text := lower(btrim(p_email));
  c public.operator_email_challenges%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('operator-email:' || e, 0));
  select * into c from public.operator_email_challenges where id = p_id for update;
  if not found or c.email <> e then
    insert into public.operator_auth_events(event, email, challenge_id, detail) values ('code_rejected', e, p_id, 'not_found');
    return 'not_found';
  end if;
  if c.status in ('used', 'locked', 'superseded', 'expired') then
    insert into public.operator_auth_events(event, email, challenge_id, attempts, detail) values ('code_rejected', e, p_id, c.attempts, c.status);
    return c.status;
  end if;
  if c.expires_at <= p_now then
    update public.operator_email_challenges set status = 'expired' where id = c.id;
    insert into public.operator_auth_events(event, email, challenge_id, attempts, detail) values ('code_rejected', e, p_id, c.attempts, 'expired');
    return 'expired';
  end if;
  if c.attempts >= c.max_attempts then
    update public.operator_email_challenges set status = 'locked', locked_at = coalesce(locked_at, p_now) where id = c.id;
    insert into public.operator_auth_events(event, email, challenge_id, attempts, detail) values ('code_rejected', e, p_id, c.attempts, 'locked');
    return 'locked';
  end if;
  if c.code_hash = p_code_hash then
    if p_consume then
      update public.operator_email_challenges set status = 'used', used_at = p_now, verified_at = coalesce(verified_at, p_now) where id = c.id;
      insert into public.operator_auth_events(event, email, challenge_id, attempts) values ('code_used', e, p_id, c.attempts);
    else
      update public.operator_email_challenges set status = 'verified', verified_at = coalesce(verified_at, p_now) where id = c.id;
      insert into public.operator_auth_events(event, email, challenge_id, attempts) values ('code_verified', e, p_id, c.attempts);
    end if;
    return 'ok';
  end if;
  update public.operator_email_challenges set attempts = c.attempts + 1,
         status = case when c.attempts + 1 >= c.max_attempts then 'locked' else status end,
         locked_at = case when c.attempts + 1 >= c.max_attempts then p_now else locked_at end
   where id = c.id;
  if c.attempts + 1 >= c.max_attempts then
    insert into public.operator_auth_events(event, email, challenge_id, attempts) values ('code_locked', e, p_id, c.attempts + 1);
    return 'locked';
  end if;
  insert into public.operator_auth_events(event, email, challenge_id, attempts) values ('code_failed', e, p_id, c.attempts + 1);
  return 'wrong';
end $$;

-- 権限: サーバー（service_role）だけ
do $$
begin
  revoke all on public.operator_email_challenges, public.operator_auth_events from public;
  revoke execute on function public.operator_email_challenge_issue(uuid, text, text, timestamptz, interval) from public;
  revoke execute on function public.operator_email_challenge_attempt(uuid, text, text, boolean, timestamptz) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.operator_email_challenges, public.operator_auth_events from anon, authenticated';
    execute 'revoke execute on function public.operator_email_challenge_issue(uuid, text, text, timestamptz, interval) from anon, authenticated';
    execute 'revoke execute on function public.operator_email_challenge_attempt(uuid, text, text, boolean, timestamptz) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update on public.operator_email_challenges, public.operator_auth_events to service_role';
    execute 'grant execute on function public.operator_email_challenge_issue(uuid, text, text, timestamptz, interval) to service_role';
    execute 'grant execute on function public.operator_email_challenge_attempt(uuid, text, text, boolean, timestamptz) to service_role';
  end if;
end $$;
