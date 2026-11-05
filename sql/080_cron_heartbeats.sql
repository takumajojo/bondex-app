-- 080: 定期の処理（cron）の最後の実行の記録（2026-11-05・B2C 公開前の監視の強化）
--
-- 目的: 定期の処理が止まったこと・失敗が続いていることを、その処理とは別の仕組み（GitHub Actions の 1時間おきの見張り・
--       /api/cron/heartbeat-check）で見つける。pg_cron・Vercel が止まっても、見張りは GitHub 側から動く。
-- 追加だけ（既存の表・関数は変えない）。何度流しても同じ（if not exists）。切り戻し: drop table public.cron_heartbeats;
-- アプリより先に流してよい（表が無い間は、アプリは記録を飛ばすだけで処理は続く: lib/cron-heartbeat.ts）。

create table if not exists public.cron_heartbeats (
  name                  text primary key,
  last_started_at       timestamptz,
  last_ok_at            timestamptz,
  last_error_at         timestamptz,
  last_error            text,
  consecutive_failures  int not null default 0 check (consecutive_failures >= 0),
  updated_at            timestamptz not null default now()
);
alter table public.cron_heartbeats enable row level security;
comment on table public.cron_heartbeats is
  '定期の処理の最後の実行の記録（lib/cron-heartbeat.ts）。見張り: /api/cron/heartbeat-check（.github/workflows/cron-heartbeat.yml）。service_role だけ。';

-- 匿名・ログイン利用者には何も許さない（本番の既定の全権限を引き継がない）
revoke all on public.cron_heartbeats from public, anon, authenticated;
grant select, insert, update on public.cron_heartbeats to service_role;

-- 1回の実行の結果を記録する（1行の upsert。失敗の続いた回数はここで数える）
create or replace function public.cron_heartbeat_record(p_name text, p_ok boolean, p_error text default null, p_now timestamptz default now())
returns void language plpgsql as $$
begin
  insert into public.cron_heartbeats as h (name, last_started_at, last_ok_at, last_error_at, last_error, consecutive_failures, updated_at)
  values (p_name, p_now, case when p_ok then p_now end, case when p_ok then null else p_now end, case when p_ok then null else left(p_error, 500) end,
          case when p_ok then 0 else 1 end, p_now)
  on conflict (name) do update set
    last_started_at      = p_now,
    last_ok_at           = case when p_ok then p_now else h.last_ok_at end,
    last_error_at        = case when p_ok then h.last_error_at else p_now end,
    last_error           = case when p_ok then h.last_error else left(p_error, 500) end,
    consecutive_failures = case when p_ok then 0 else h.consecutive_failures + 1 end,
    updated_at           = p_now;
end $$;
revoke execute on function public.cron_heartbeat_record(text, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cron_heartbeat_record(text, boolean, text, timestamptz) to service_role;
