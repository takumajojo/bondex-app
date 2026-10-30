-- 055: 佐川お荷物問い合わせAPI の全体速度制限ゲート・手動確認理由・通知の一度きり判定
--
-- 背景: 佐川お荷物問い合わせAPI は「1秒に1リクエスト・1リクエストに番号10件まで」
--   (お荷物問い合わせ API連携 操作マニュアル 第1版 2023-06-27 Page.1)。
--   cron・番号入力時の即時照会・運営の手動テスト・再試行は別々の関数実行(別プロセス)で
--   動くため、プロセス内の待ち合わせだけでは合計で守れない。DB の1行を行ロックして
--   「最後に送り始めた時刻」を記録し、そこから間隔があいたときだけ次の送信を許可する。
--
--   番号 054 は別作業(集荷リマインド sql/054_pickup_reminder.sql)が使う予定のため 055 とした。
--
-- 追加:
--   carrier_rate_gate          : キーごとの「最後の送信開始時刻」「一時停止(利用制限・設定エラー時)」
--   try_begin_send()           : いま送ってよいかを判定し、許可したら送信開始時刻を記録する (行ロックで直列化)
--   block_carrier()            : 利用制限・障害時に、以後の送信を一定時間止める
--   claim_alert_once()         : 同じ警告を cooldown 内に二度送らないための判定
--   shipments.tracking_manual_reason : 自動照会できず手動確認に回した理由 (NULL=自動照会中)
--
-- いずれも service_role 専用 (anon / authenticated には実行権限を与えない)。

create table if not exists public.carrier_rate_gate (
  key            text primary key,
  last_sent_at   timestamptz,
  blocked_until  timestamptz,
  block_reason   text,
  last_alert_at  timestamptz,
  updated_at     timestamptz not null default now()
);
alter table public.carrier_rate_gate enable row level security;
-- ポリシーは作らない = anon/authenticated からは読み書きできない (service_role は RLS を通過)。

-- 送信の開始許可 (「いま送ってよいか」を1件ずつ判定する)。
--   前回の送信開始 (last_sent_at) から p_interval_ms 以上たっていれば、いまを送信開始として記録して
--   granted=true を返す。たっていなければ記録せず、あと何ミリ秒待てばよいかを返す (呼び出し側は待って聞き直す)。
--   行ロック下で判定・記録するので、別々の接続から同時に呼ばれても許可は1つずつしか出ない。
--
--   未来の枠を予約して待つ方式はとらない: 予約後に処理が遅れた実行が、次の実行の枠に食い込んで
--   送信開始が重なる (2026-10-28 の複数接続試験で 302ms 間隔まで縮むことを確認)。
--   許可は「いま」にしか出さず、呼び出し側は許可までの往復が長すぎたら (= 自分が遅れていたら)
--   その許可を捨てて聞き直す (lib/tracking/rate-gate.ts)。
create or replace function public.try_begin_send(p_key text, p_interval_ms integer)
returns table (granted boolean, wait_ms integer, blocked_until timestamptz, block_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now  timestamptz := clock_timestamp();
  v_row  public.carrier_rate_gate%rowtype;
  v_next timestamptz;
begin
  if p_interval_ms is null or p_interval_ms < 1000 then
    raise exception 'try_begin_send: interval must be >= 1000ms';
  end if;
  insert into public.carrier_rate_gate (key) values (p_key) on conflict (key) do nothing;
  select * into v_row from public.carrier_rate_gate g where g.key = p_key for update;
  -- ロック待ちの間に時間が進むので、ロック取得後の時刻で判定する。
  v_now := clock_timestamp();

  -- 一時停止中は許可しない (利用制限・設定エラー)。
  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, 0, v_row.blocked_until, v_row.block_reason;
    return;
  end if;

  v_next := coalesce(v_row.last_sent_at, '-infinity'::timestamptz) + make_interval(secs => p_interval_ms / 1000.0);
  if v_next > v_now then
    return query select false, ceil(extract(epoch from (v_next - v_now)) * 1000)::integer, null::timestamptz, null::text;
    return;
  end if;

  update public.carrier_rate_gate g set last_sent_at = v_now, updated_at = v_now where g.key = p_key;
  return query select true, 0, null::timestamptz, null::text;
end;
$$;

-- 以後 p_until まで送信を止める (既により長く止まっていれば延ばすだけで縮めない)。
create or replace function public.block_carrier(p_key text, p_until timestamptz, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.carrier_rate_gate (key, blocked_until, block_reason)
  values (p_key, p_until, p_reason)
  on conflict (key) do update
    set blocked_until = greatest(coalesce(public.carrier_rate_gate.blocked_until, excluded.blocked_until), excluded.blocked_until),
        block_reason  = excluded.block_reason,
        updated_at    = now();
end;
$$;

-- 同じ警告を cooldown 内に二度出さない。true を返した呼び出しだけが警告を送る。
create or replace function public.claim_alert_once(p_key text, p_cooldown_minutes integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_hit integer;
begin
  insert into public.carrier_rate_gate (key, last_alert_at) values (p_key, v_now)
  on conflict (key) do nothing;
  get diagnostics v_hit = row_count;
  if v_hit > 0 then return true; end if;
  update public.carrier_rate_gate g
     set last_alert_at = v_now, updated_at = v_now
   where g.key = p_key
     and (g.last_alert_at is null or g.last_alert_at < v_now - make_interval(mins => p_cooldown_minutes));
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

revoke all on function public.try_begin_send(text, integer) from public, anon, authenticated;
revoke all on function public.block_carrier(text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.claim_alert_once(text, integer) from public, anon, authenticated;
grant execute on function public.try_begin_send(text, integer) to service_role;
grant execute on function public.block_carrier(text, timestamptz, text) to service_role;
grant execute on function public.claim_alert_once(text, integer) to service_role;

-- 自動照会できない区間 (照会先が無い・ヤマトで Ship&co 解約後 等) の理由。NULL = 自動照会中。
-- 既存の tracking_limit_reached (Ship&co 15回上限) とは別に持つ (過去の上限履歴を消さないため)。
alter table public.shipments add column if not exists tracking_manual_reason text;

-- 手動確認一覧を素早く引くための部分インデックス。
create index if not exists shipments_tracking_manual_idx
  on public.shipments (shipment_date)
  where tracking_manual_reason is not null;

-- 副作用の済み印 (lib/tracking/effects-recovery.ts)。ステータス保存後に通知の途中で止まった区間を回収するため。
--   pickup_notified_at  : 集荷メールを送った (または宛先が無く送るものが無かった)
--   delivered_pushed_at : 配達完了の WhatsApp/LINE を送った
-- 配達完了メールは既存の delivered_notified_at、課金は既存の charged_at を使う。
alter table public.shipments add column if not exists pickup_notified_at timestamptz;
alter table public.shipments add column if not exists delivered_pushed_at timestamptz;

-- 既存の区間は「送信済み」とみなす (適用直後の回収で過去の便へ通知を送り直さないため)。
--
-- ★ この back-fill は「初回だけ」実行する。マイグレーションを再適用しても二度目は走らせない。
--   理由: 二度目を走らせると、初回以降に正規に発生した「未通知の新しい区間」(pickup_notified_at
--   がまだ NULL = これから通知すべき区間) まで「送信済み」と塗りつぶし、本来送るべき集荷/配達の
--   通知を握りつぶしてしまう。初回適用済みかを専用テーブルに記録し、済みなら何もしない。
--   (検証用の SQL: docs/tracking-recovery-runbook.md「sql/055 の再適用安全性」を参照。)
create table if not exists public._tracking_backfills (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table public._tracking_backfills enable row level security;
-- ポリシーは作らない = anon/authenticated からは触れない (service_role は RLS を通過)。

do $$
begin
  if exists (select 1 from public._tracking_backfills where name = '055_notified_backfill') then
    raise notice '055 back-fill already applied; skipping (preserves markers set after the initial back-fill)';
    return;
  end if;

  update public.shipments
     set pickup_notified_at = coalesce(picked_up_at, now())
   where status in ('picked_up', 'in_transit', 'delivered')
     and pickup_notified_at is null;
  update public.shipments
     set delivered_pushed_at = coalesce(delivered_at, now())
   where status = 'delivered'
     and delivered_pushed_at is null;

  insert into public._tracking_backfills (name) values ('055_notified_backfill');
end $$;
