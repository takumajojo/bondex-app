-- 029: フェーズ1 事故防止の土台 (2026-08-31 スケール監査対応)
--
-- 監査で見つかった「お金が二重に動く」経路を塞ぐための3点セット。
--   a) booking_requests : 予約APIの冪等キー (タイムアウト再送 → 予約・伝票の二重を防止)
--   b) issue_claimed_at : 送り状発行の先取りロック (cron と手動の並走 → Ship&co 二重発行を防止)
--   c) cron_locks       : cron の実行ロック (GitHub Actions の誤判定リトライ → 二重起動を防止)

create table if not exists public.booking_requests (
  request_key text primary key,
  booking_id  text not null,
  agency      text not null,
  created_at  timestamptz not null default now()
);
alter table public.booking_requests enable row level security;
comment on table public.booking_requests is
  '予約APIの冪等キー。タイムアウト再送で予約・伝票が二重にならないための記録。RLSポリシーなし=サーバー専用。';

alter table public.shipments
  add column if not exists issue_claimed_at timestamptz;
comment on column public.shipments.issue_claimed_at is
  '送り状発行処理の先取り時刻。10分以内に他プロセスが取得済みなら発行を中断する。';

create table if not exists public.cron_locks (
  name       text primary key,
  locked_at  timestamptz not null default now()
);
alter table public.cron_locks enable row level security;
comment on table public.cron_locks is
  'cron の二重起動防止ロック。locked_at が15分より古ければ stale として取得可。RLSポリシーなし=サーバー専用。';
