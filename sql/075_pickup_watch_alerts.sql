-- 集荷依頼の監視の通知を、同じ案件に重ねて送らないための記録 (2026-11-04 谷口さん指示・未適用)。
-- 監視は追跡の定時処理から切り離した専用のジョブ /api/cron/pickup-watch が行う (lib/pickup-request/watch.ts)。
-- 1つの通知の単位 = 「集荷日・区間・種類・段階」。同じ単位は1回だけ通知する。
--   段階: before (19:00〜19:59。佐川の締め前) / after (20:00 以降。締め超過) — 締めを越えたら1回だけ再通知する。
--   送信失敗は失敗した記録ごと (再送してまた失敗したら、新しい失敗として通知する)。
-- 送信中のまま止まった依頼は従来どおり pickup_requests.stale_alerted_at で1回だけ (この表は使わない)。
-- 再実行できる。戻すとき: drop function public.pickup_watch_claim(text[]); drop table public.pickup_watch_alerts;

create table if not exists public.pickup_watch_alerts (
  alert_key   text primary key,
  alerted_at  timestamptz not null default now()
);
create index if not exists pickup_watch_alerts_at on public.pickup_watch_alerts (alerted_at);
alter table public.pickup_watch_alerts enable row level security;
revoke all on table public.pickup_watch_alerts from public, anon, authenticated;

-- 渡したキーのうち、まだ通知していないものだけを記録して返す (同時に動いても1回だけ)
create or replace function public.pickup_watch_claim(p_keys text[])
returns setof text language sql security definer set search_path = public as $$
  insert into public.pickup_watch_alerts (alert_key)
  select distinct k from unnest(p_keys) k
  on conflict (alert_key) do nothing
  returning alert_key;
$$;
revoke all on function public.pickup_watch_claim(text[]) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.pickup_watch_claim(text[]) to service_role';
exception when undefined_object then null; end $$;
