-- =============================================================================
-- 063_b2c_outbox_hardening.sql — B2C の通知の送信待ち（b2c_outbox）の滞留・再試行・重複・期限切れの対策（Stage 4 の追加）
--
-- 何を直すか（docs/b2c/B2C_NOTIFICATION_TEMPLATES.md 4章）:
--   1. 古い順だけで取らない: 重要度（priority）→ 送信の期限（expires_at）が近い順 → 予定の時刻の順に取る。
--      集荷の当日・前日のリマインドは、古い通常の通知の後ろに並ばない。
--   2. 期限を過ぎた通知は送らない（expired）。前日のリマインドを当日に「明日は集荷日」と送る、などを DB で止める。
--   3. 送信の結果が分からない時（送った直後に DB の記録が失敗した・相手の応答が来なかった）を unknown として分ける。
--      - 送り始める前に send_started_at を記録する。記録が無いまま止まった行は「まだ送っていない」ので安全に再試行する。
--      - 送り始めた後に止まった行は、送信手段が冪等（同じ冪等キーの再送を相手が 1通にまとめる: Resend のメール 24時間）の
--        時だけ自動で再試行する。冪等でない手段（WhatsApp・SMTP）は自動で再送せず unknown にして運営が照合する。
--   4. 取る処理は 1つの SQL（FOR UPDATE SKIP LOCKED）。同時に動いても同じ行を 2つの処理が取らない。
--   5. 運営への知らせ（failed・unknown・expired は 1行 1回、滞留は 1時間に 1回）の記録。
--
-- 再実行できる（if not exists / create or replace）。適用はローカルの試験の DB だけ。本番への適用は別の承認。
-- =============================================================================

-- 1. 列と状態 ------------------------------------------------------------------
alter table public.b2c_outbox drop constraint if exists b2c_outbox_status_check;
alter table public.b2c_outbox add constraint b2c_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled', 'expired', 'unknown'));
alter table public.b2c_outbox add column if not exists priority        smallint not null default 50;  -- 小さいほど先
alter table public.b2c_outbox add column if not exists expires_at      timestamptz;  -- これを過ぎたら送らない
alter table public.b2c_outbox add column if not exists send_started_at timestamptz;  -- 外に送り始めた時刻（送る前に記録）
alter table public.b2c_outbox add column if not exists first_send_at   timestamptz;  -- 最初に送り始めた時刻（冪等キーの有効期間の判断）
alter table public.b2c_outbox add column if not exists send_idempotent boolean not null default false;  -- 今回の送信手段が冪等か
alter table public.b2c_outbox add column if not exists ops_alerted_at  timestamptz;  -- failed / unknown / expired を運営に知らせた時刻
alter table public.b2c_outbox add column if not exists resolved_by     text;         -- 運営が照合した人（unknown・failed の処理）
alter table public.b2c_outbox add column if not exists resolved_note   text;
create index if not exists b2c_outbox_claim on public.b2c_outbox(priority, expires_at, next_attempt_at) where status = 'pending';
create index if not exists b2c_outbox_problems on public.b2c_outbox(status) where status in ('failed', 'unknown', 'expired', 'sending');

-- 2. 積む時に重要度と期限を決める（どの経路で積んでも同じ: DB の関数・リマインド・運営の再送） ----------
create or replace function public.b2c_outbox_defaults() returns trigger language plpgsql as $$
declare
  o public.b2c_orders%rowtype;
begin
  new.priority := case new.kind
    when 'reminder_day'      then 10   -- 当日 11:00 までに届かないと意味がない
    when 'reminder_eve'      then 20
    when 'cancelled'         then 30   -- 取消は荷物を預けないための連絡
    when 'booking_confirmed' then 30
    when 'awaiting_hotel'    then 40
    else 50 end;
  if new.expires_at is null then
    select * into o from public.b2c_orders where id = new.order_id;
    new.expires_at := case new.kind
      when 'reminder_day'      then (o.pickup_date + time '11:00') at time zone 'Asia/Tokyo'
      when 'reminder_eve'      then (o.pickup_date + time '00:00') at time zone 'Asia/Tokyo'  -- 当日になったら「明日は集荷日」は誤り
      when 'booking_confirmed' then (o.pickup_date + time '11:00') at time zone 'Asia/Tokyo'
      when 'awaiting_hotel'    then coalesce(o.confirmation_due_at, now() + interval '1 day')
      when 'cancelled'         then now() + interval '2 days'
      else now() + interval '2 days' end;
  end if;
  return new;
end $$;
drop trigger if exists b2c_outbox_defaults on public.b2c_outbox;
create trigger b2c_outbox_defaults before insert on public.b2c_outbox
  for each row execute function public.b2c_outbox_defaults();

-- 既にある行にも同じ規則を当てる（送る前の行だけ）
update public.b2c_outbox x set
  priority = case x.kind when 'reminder_day' then 10 when 'reminder_eve' then 20 when 'cancelled' then 30
                         when 'booking_confirmed' then 30 when 'awaiting_hotel' then 40 else 50 end,
  expires_at = coalesce(x.expires_at, case x.kind
    when 'reminder_day'      then (o.pickup_date + time '11:00') at time zone 'Asia/Tokyo'
    when 'reminder_eve'      then (o.pickup_date + time '00:00') at time zone 'Asia/Tokyo'
    when 'booking_confirmed' then (o.pickup_date + time '11:00') at time zone 'Asia/Tokyo'
    when 'awaiting_hotel'    then coalesce(o.confirmation_due_at, x.created_at + interval '1 day')
    else x.created_at + interval '2 days' end)
from public.b2c_orders o
where o.id = x.order_id and x.status in ('pending', 'sending') and x.expires_at is null;

-- 3. 止まった送信の片付けと期限切れ -------------------------------------------------
--    p_now は試験で時刻を指定するため（本番は now()）。
--    戻り値: {"recovered": 送る前に止まって再試行に戻した数, "idempotent_retry": 冪等な手段で再試行に戻した数,
--            "unknown": 結果が分からず運営の照合に回した数, "expired": 期限切れにした数}
create or replace function public.b2c_outbox_maintain(p_now timestamptz default now(), p_stale interval default interval '10 minutes')
returns jsonb language plpgsql as $$
declare
  n_rec int := 0; n_idem int := 0; n_unk int := 0; n_exp int := 0;
begin
  with s as (
    select id, send_started_at, first_send_at, send_idempotent from public.b2c_outbox
     where status = 'sending' and locked_at < p_now - p_stale
     for update skip locked
  ), u as (
    update public.b2c_outbox x set
      status = case
        when s.send_started_at is null then 'pending'
        when s.send_idempotent and coalesce(s.first_send_at, s.send_started_at) > p_now - interval '23 hours' then 'pending'
        else 'unknown' end,
      last_error = case
        when s.send_started_at is null then 'stale_before_send'
        when s.send_idempotent and coalesce(s.first_send_at, s.send_started_at) > p_now - interval '23 hours' then 'stale_after_send_idempotent_retry'
        else 'stale_after_send_outcome_unknown' end,
      locked_at = null,
      next_attempt_at = p_now
    from s where x.id = s.id
    returning x.status, x.last_error
  )
  select count(*) filter (where last_error = 'stale_before_send'),
         count(*) filter (where last_error = 'stale_after_send_idempotent_retry'),
         count(*) filter (where status = 'unknown')
    into n_rec, n_idem, n_unk from u;

  with e as (
    update public.b2c_outbox set status = 'expired', locked_at = null,
           last_error = coalesce('expired_before_send; last: ' || last_error, 'expired_before_send')
     where status = 'pending' and expires_at is not null and expires_at <= p_now
    returning 1
  ) select count(*) into n_exp from e;

  return jsonb_build_object('recovered', n_rec, 'idempotent_retry', n_idem, 'unknown', n_unk, 'expired', n_exp);
end $$;

-- 4. 送る行を取る（重要度 → 期限 → 予定の時刻の順。取った行は sending。同時に動いても重ならない） -------
create or replace function public.b2c_outbox_claim(p_now timestamptz default now(), p_limit int default 20, p_skew interval default interval '60 seconds')
returns setof public.b2c_outbox language plpgsql as $$
begin
  return query
  with c as (
    select id from public.b2c_outbox
     where status = 'pending'
       and next_attempt_at <= p_now + p_skew
       and (expires_at is null or expires_at > p_now)
     order by priority, expires_at nulls last, next_attempt_at, id
     limit greatest(1, least(p_limit, 200))
     for update skip locked
  )
  update public.b2c_outbox x set status = 'sending', locked_at = p_now, send_started_at = null
    from c where x.id = c.id
  returning x.*;
end $$;

-- 5. 滞留の状況（運営への知らせの判断に使う） ----------------------------------------
create or replace function public.b2c_outbox_health(p_now timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'pending_total',        count(*) filter (where status = 'pending'),
    'overdue_15m',          count(*) filter (where status = 'pending' and next_attempt_at < p_now - interval '15 minutes'),
    'reminder_overdue_10m', count(*) filter (where status = 'pending' and kind in ('reminder_day', 'reminder_eve') and next_attempt_at < p_now - interval '10 minutes'),
    'oldest_overdue_min',   coalesce(floor(extract(epoch from (p_now - min(next_attempt_at) filter (where status = 'pending'))) / 60), 0),
    'sending_stuck',        count(*) filter (where status = 'sending' and locked_at < p_now - interval '10 minutes'),
    'unalerted_problems',   count(*) filter (where status in ('failed', 'unknown', 'expired') and ops_alerted_at is null)
  ) from public.b2c_outbox
$$;

-- 6. 運営への知らせの間引き（同じ種類の知らせを p_every に 1回だけ） --------------------------
create table if not exists public.b2c_ops_alert_gate (
  alert_key    text primary key,
  last_sent_at timestamptz not null
);
alter table public.b2c_ops_alert_gate enable row level security;

create or replace function public.b2c_ops_alert_gate_try(p_key text, p_now timestamptz default now(), p_every interval default interval '60 minutes')
returns boolean language plpgsql as $$
declare
  n int;
begin
  insert into public.b2c_ops_alert_gate(alert_key, last_sent_at) values (p_key, p_now)
  on conflict (alert_key) do update set last_sent_at = excluded.last_sent_at
    where public.b2c_ops_alert_gate.last_sent_at <= p_now - p_every;
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke execute on function public.b2c_outbox_maintain(timestamptz, interval) from public, anon, authenticated;
revoke execute on function public.b2c_outbox_claim(timestamptz, int, interval) from public, anon, authenticated;
revoke execute on function public.b2c_outbox_health(timestamptz) from public, anon, authenticated;
revoke execute on function public.b2c_ops_alert_gate_try(text, timestamptz, interval) from public, anon, authenticated;
grant execute on function public.b2c_outbox_maintain(timestamptz, interval) to service_role;
grant execute on function public.b2c_outbox_claim(timestamptz, int, interval) to service_role;
grant execute on function public.b2c_outbox_health(timestamptz) to service_role;
grant execute on function public.b2c_ops_alert_gate_try(text, timestamptz, interval) to service_role;
grant select, insert, update on public.b2c_ops_alert_gate to service_role;
