-- 佐川への集荷依頼の記録 (2026-11-03 谷口さん承認・Biz-Logi 導入 Phase 1-a)。未適用。
--
-- 目的: 世田谷営業所への手動依頼 (佐川指定 Excel) と Biz-Logi API (N01) の両方を1か所で記録し、
-- 同じ区間への集荷依頼が二重にならないことを DB の一意制約で保証する。
-- shipments.status (配送状態) とは独立に持つ。status='requested' は「佐川へ依頼済み」を意味しない。
--
-- state (集荷依頼状態):
--   sending        送信中 (Biz-Logi へ送る直前に確保。送信結果の保存までこの状態)
--   accepted       依頼受付済み (Biz-Logi が問合番号を返した / 手動依頼を運営が記録した)
--   unknown        依頼結果不明 (通信断・タイムアウト・応答不正・保存失敗)。自動再送しない
--   failed         依頼失敗 (Biz-Logi がエラーコードを返した = 発行受付IDなし・課金なし・佐川に登録なし)
--   needs_review   依頼済みか不明 (移行時の既存データ)。運営の確認待ち
--   change_pending キャンセル・変更対応中 (世田谷営業所へ連絡中。佐川の反映確認の返信待ち)
--   cancelled      佐川側で取消済み (反映確認の返信を受けた)
--   void           無効 (運営が「佐川に依頼は無い」と確認した記録。誤記録の取り消しを含む)
-- 「有効な依頼」= sending / accepted / unknown / needs_review / change_pending。
-- 1区間に有効な依頼は1件まで (下の部分一意インデックス)。有効な依頼がない区間が「未依頼」。

create table if not exists public.pickup_requests (
  id                 uuid primary key default gen_random_uuid(),
  shipment_id        uuid not null references public.shipments(id) on delete restrict,
  booking_id         text not null,
  leg_index          int  not null,
  channel            text not null check (channel in ('manual', 'bizlogi')),
  state              text not null check (state in
                       ('sending', 'accepted', 'unknown', 'failed', 'needs_review', 'change_pending', 'cancelled', 'void')),
  -- Biz-Logi の接続先 (test / production)。手動は null。
  environment        text check (environment in ('test', 'production')),
  user_manage_number text,
  shipping_number    text,
  print_request_id   text,
  piece_count        int,
  pickup_date        date,
  result_codes       jsonb,
  error              text,
  note               text,
  -- 操作した運営担当者 (依頼・確認)。運営ログインは共有のため画面で名前を入力してもらう。
  requested_by       text,
  resolved_by        text,
  -- 送信の試行を確保した実行の識別子。結果の保存はこの所有者からのみ受け付ける。
  attempt_owner      text,
  -- 依頼した時点の内容 (発送元・到着先・集荷日・配達日・時間帯・個数)。区間の今の内容と比べ、
  -- 依頼後に変わっていれば「世田谷へ変更連絡が必要」として TODO に出す (lib/pickup-request/snapshot.ts)。
  request_snapshot   jsonb,
  -- 「送信中」のまま止まった記録をアラート済みにした時刻 (アラートは1回だけ)。
  stale_alerted_at   timestamptz,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz,
  resolved_at        timestamptz,
  updated_at         timestamptz not null default now()
);

create unique index if not exists pickup_requests_one_live_per_leg
  on public.pickup_requests (shipment_id)
  where state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending');

create index if not exists pickup_requests_shipment_idx on public.pickup_requests (shipment_id, created_at desc);
create index if not exists pickup_requests_state_idx on public.pickup_requests (state)
  where state in ('sending', 'unknown', 'needs_review', 'change_pending');

-- サーバ (service role) からのみ使う。匿名・代理店からは読めない。
alter table public.pickup_requests enable row level security;

-- 受付締切 = 集荷前日 18:30 JST (2026-11-04 谷口さん決定)。lib/pickup-cutoff.ts の pickupCutoffAt と同じ値。
-- 18:30:00 ちょうど以降は締切後 (now() >= pickup_cutoff_at)。B2B・B2C の DB 関数はこれを使う。
create or replace function public.pickup_cutoff_at(p_pickup_date date)
returns timestamptz language sql immutable as $$
  select ((p_pickup_date - 1)::text || 'T09:30:00Z')::timestamptz;
$$;

-- 集荷依頼の記録・送信の一時停止スイッチ (1行だけ)。2026-11-04 谷口さん指示 (本番移行の安全策)。
-- 本番移行は「DB を先に入れる (区間のロック=sql/068 のトリガーは無効) → アプリ切替 → ロック有効化 (sql/072)」の順。
-- ロックが無効の間に有効な依頼ができると、依頼済みの区間を DB が守れない。そこで claims_paused=true で作り、
-- sql/072 がロックの有効化と同じトランザクションで false にする。運営の注意に頼らず DB で止める。
-- 切り戻し (sql/rollback/pause_pickup_lock.sql) はロックを無効にするのと同時に true へ戻す。
create table if not exists public.pickup_request_settings (
  id             boolean primary key default true check (id),
  claims_paused  boolean not null default true,
  lock_enabled   boolean not null default false,
  paused_reason  text,
  updated_at     timestamptz not null default now(),
  updated_by     text
);
-- 既存データの移行 (下) を済ませた時刻。2回目以降の適用では移行しない (後から作られた区間を「要確認」にしない)
alter table public.pickup_request_settings add column if not exists backfill_done_at timestamptz;
insert into public.pickup_request_settings (id, claims_paused, lock_enabled, paused_reason, updated_by)
values (true, true, false, '本番移行中: 区間のロック (sql/072) の有効化まで停止', 'sql/067')
on conflict (id) do nothing;
alter table public.pickup_request_settings enable row level security;
revoke all on table public.pickup_request_settings from public, anon, authenticated;
do $$ begin
  execute 'grant select on table public.pickup_request_settings to service_role';
exception when undefined_object then null; end $$;  -- service_role が無い試験用 DB

-- ─────────────────────────────────────────────────────────────────────────────
-- 依頼内容 (request_snapshot)。lib/pickup-request/snapshot.ts の pickupSnapshot と同じキー・同じ形。
-- 確保・変更の反映・移行のすべてでこの関数を使い、DB の中 (行ロック中) で作る。
create or replace function public.pickup_snapshot_json(s public.shipments)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'from_hotel', s.from_hotel, 'from_place_id', s.from_place_id, 'from_residence', s.from_residence,
    'to_hotel', s.to_hotel, 'to_place_id', s.to_place_id, 'to_residence', s.to_residence,
    'shipment_date', s.shipment_date, 'expected_arrival', s.expected_arrival,
    'delivery_time', s.delivery_time, 'suitcase_count', s.suitcase_count);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 依頼の確保。外部送信の「前」に呼び、claimed=true を受け取った実行だけが送信する。
--   p_channel='bizlogi' → state='sending' で確保
--   p_channel='manual'  → state='accepted' で記録し、shipments.pickup_requested_at を入れる
-- 区間の行ロックで判定と挿入を直列化し、最後は部分一意インデックスで二重を物理的に止める。
-- 依頼内容 (snapshot) はロック中の区間から DB の中で作って返す。送信側は電文の元にした内容と照合し、
-- 一致しなければ送らない (読み取りから確保までの間に変更が入った場合)。確保の後は sql/068 のトリガーが
-- 区間の書き換えを止めるので、送る内容と DB の内容が一致する。
create or replace function public.claim_pickup_request(
  p_shipment_id     uuid,
  p_channel         text,
  p_environment     text,
  p_manage_number   text,
  p_piece_count     int,
  p_pickup_date     date,
  p_actor           text,
  p_owner           text,
  p_note            text
) returns table (claimed boolean, request_id uuid, reason text, snapshot jsonb)
language plpgsql
as $$
declare
  s public.shipments;
  v_id uuid;
  v_state text := case when p_channel = 'manual' then 'accepted' else 'sending' end;
  v_snap jsonb;
begin
  if p_channel not in ('manual', 'bizlogi') then
    return query select false, null::uuid, 'invalid_channel'::text, null::jsonb;
    return;
  end if;

  -- 一時停止中、または区間のロック (sql/068 のトリガー) が無効な間は、手動・Biz-Logi とも記録・送信しない。
  -- トリガーがまだ無い (068 の前) ときはスイッチだけで判断する (067 は停止の状態で作る)。
  if coalesce((select claims_paused from public.pickup_request_settings where id), true) then
    return query select false, null::uuid, 'claims_paused'::text, null::jsonb;
    return;
  end if;
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.shipments'::regclass and tgname = 'shipments_pickup_lock' and tgenabled = 'D') then
    return query select false, null::uuid, 'pickup_lock_disabled'::text, null::jsonb;
    return;
  end if;

  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then
    return query select false, null::uuid, 'shipment_not_found'::text, null::jsonb;
    return;
  end if;
  if s.status = 'cancelled' then
    return query select false, null::uuid, 'shipment_cancelled'::text, null::jsonb;
    return;
  end if;
  v_snap := public.pickup_snapshot_json(s);
  -- Biz-Logi は「佐川の番号がまだ無い」区間だけ。番号があるのは佐川側に依頼が存在する証拠。
  if p_channel = 'bizlogi' and jsonb_typeof(s.tracking_numbers) = 'array'
     and jsonb_array_length(s.tracking_numbers) > 0 then
    return query select false, null::uuid, 'tracking_number_exists'::text, null::jsonb;
    return;
  end if;
  -- Biz-Logi は当面 1〜19個の通常配送だけ (2026-11-04 谷口さん)。20個以上は佐川へ事前連絡が必要なため
  -- BondEx で確認して手動手配する。団体 (booking_type='group') も手動。手動 (Excel) の記録には影響しない。
  if p_channel = 'bizlogi' and coalesce(s.suitcase_count, 0) >= 20 then
    return query select false, null::uuid, 'too_many_pieces'::text, null::jsonb;
    return;
  end if;
  if p_channel = 'bizlogi' and coalesce(s.booking_type, 'fit') = 'group' then
    return query select false, null::uuid, 'group_booking'::text, null::jsonb;
    return;
  end if;
  if exists (
    select 1 from public.pickup_requests r
     where r.shipment_id = p_shipment_id
       and r.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')
  ) then
    return query select false, null::uuid, 'live_request_exists'::text, null::jsonb;
    return;
  end if;

  begin
    insert into public.pickup_requests
      (shipment_id, booking_id, leg_index, channel, state, environment, user_manage_number,
       piece_count, pickup_date, requested_by, attempt_owner, note, sent_at, resolved_at, resolved_by, request_snapshot)
    values
      (p_shipment_id, s.booking_id, s.leg_index, p_channel, v_state,
       case when p_channel = 'bizlogi' then p_environment else null end,
       p_manage_number, p_piece_count, p_pickup_date, p_actor, p_owner, p_note,
       now(),
       case when p_channel = 'manual' then now() else null end,
       case when p_channel = 'manual' then p_actor else null end,
       v_snap)
    returning id into v_id;
  exception when unique_violation then
    return query select false, null::uuid, 'live_request_exists'::text, null::jsonb;
    return;
  end;

  if p_channel = 'manual' then
    update public.shipments
       set pickup_requested_at = coalesce(pickup_requested_at, now())
     where id = p_shipment_id;
  end if;

  return query select true, v_id, 'claimed'::text, v_snap;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 状態の遷移 (送信結果の保存・運営の確認)。遷移元の状態を指定し、一致したときだけ適用する。
-- shipments への反映も同じトランザクションで行う:
--   → accepted : 問合番号が渡され、shipments.tracking_numbers が空なら [番号] を入れる (上書きしない)。
--                pickup_requested_at が空なら now を入れる。
--   → void     : この区間に他の有効な依頼が無ければ pickup_requested_at を null に戻す。
-- 配送状態 (shipments.status) は一切変えない。
create or replace function public.transition_pickup_request(
  p_request_id      uuid,
  p_from_states     text[],
  p_to_state        text,
  p_owner           text,
  p_actor           text,
  p_shipping_number text,
  p_print_request_id text,
  p_result_codes    jsonb,
  p_error           text,
  p_note            text,
  p_snapshot        jsonb
) returns table (applied boolean, state text, reason text)
language plpgsql
as $$
declare
  r public.pickup_requests;
  v_number text := nullif(btrim(coalesce(p_shipping_number, '')), '');
begin
  if p_to_state not in ('sending', 'accepted', 'unknown', 'failed', 'needs_review', 'change_pending', 'cancelled', 'void') then
    return query select false, null::text, 'invalid_state'::text;
    return;
  end if;

  select * into r from public.pickup_requests where id = p_request_id for update;
  if not found then
    return query select false, null::text, 'not_found'::text;
    return;
  end if;
  if not (r.state = any (p_from_states)) then
    return query select false, r.state, 'state_mismatch'::text;
    return;
  end if;
  -- 送信結果 (sending からの遷移) は、その送信を確保した実行からだけ受け付ける。
  if r.state = 'sending' and p_owner is not null and r.attempt_owner is distinct from p_owner then
    return query select false, r.state, 'owner_mismatch'::text;
    return;
  end if;
  if p_to_state = 'accepted' and r.channel = 'bizlogi' and v_number is null and r.shipping_number is null then
    return query select false, r.state, 'shipping_number_required'::text;
    return;
  end if;

  begin
    update public.pickup_requests
       set state            = p_to_state,
           shipping_number  = coalesce(v_number, shipping_number),
           print_request_id = coalesce(nullif(btrim(coalesce(p_print_request_id, '')), ''), print_request_id),
           result_codes     = coalesce(p_result_codes, result_codes),
           error            = coalesce(p_error, error),
           note             = case when p_note is null then note
                                   when note is null then p_note
                                   else note || E'\n' || p_note end,
           resolved_by      = case when p_to_state in ('sending', 'unknown') then resolved_by else coalesce(p_actor, resolved_by) end,
           resolved_at      = case when p_to_state in ('sending', 'unknown') then resolved_at else now() end,
           -- 変更が佐川に反映されたと記録したときなど、新しい依頼内容を渡されたら置き換える
           request_snapshot = coalesce(p_snapshot, request_snapshot),
           updated_at       = now()
     where id = p_request_id;
  exception when unique_violation then
    -- void/failed/cancelled から有効な状態へ戻そうとして、別の有効な依頼と衝突した。
    return query select false, r.state, 'live_request_exists'::text;
    return;
  end;

  if p_to_state = 'accepted' and exists (
       select 1 from public.shipments x where x.id = r.shipment_id and x.status = 'cancelled') then
    -- 取消済みの区間に佐川の受付が返ってきた (確保の前に取消された等)。区間には番号を書かず、
    -- 依頼記録にだけ残して運営に佐川への取消連絡を促す (2026-11-04 谷口さん承認・取消済み区間への番号保存の防止)。
    update public.pickup_requests
       set note = concat_ws(E'\n', note, '区間は取消済みのため番号を区間に保存していません。佐川へ取消の連絡が必要です'),
           updated_at = now()
     where id = r.id;
    return query select true, p_to_state, 'applied_shipment_cancelled'::text;
    return;
  end if;

  if p_to_state = 'accepted' then
    update public.shipments
       set tracking_numbers = case
             when v_number is not null
              and (tracking_numbers is null or jsonb_typeof(tracking_numbers) <> 'array'
                   or jsonb_array_length(tracking_numbers) = 0)
             then jsonb_build_array(v_number)
             else tracking_numbers end,
           pickup_requested_at = coalesce(pickup_requested_at, now())
     where id = r.shipment_id;
  elsif p_to_state = 'void' then
    if not exists (
      select 1 from public.pickup_requests x
       where x.shipment_id = r.shipment_id and x.id <> r.id
         and x.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')
    ) then
      update public.shipments set pickup_requested_at = null where id = r.shipment_id;
    end if;
  end if;

  return query select true, p_to_state, 'applied'::text;
end;
$$;

revoke all on function public.claim_pickup_request(uuid, text, text, text, int, date, text, text, text) from public, anon, authenticated;
revoke all on function public.pickup_snapshot_json(public.shipments) from public, anon, authenticated;
revoke all on function public.transition_pickup_request(uuid, text[], text, text, text, text, text, jsonb, text, text, jsonb) from public, anon, authenticated;

-- 受付後の変更 (ホテル・日程・個数・代表者名・取消・番号) の管理と、依頼中の区間の書き換え禁止は
-- sql/068 (shipment_change_requests への統合・shipments のトリガー) で行う (2026-11-04 谷口さん承認)。

-- ─────────────────────────────────────────────────────────────────────────────
-- 既存データの移行 (1回だけ。pickup_request_settings.backfill_done_at で2回目以降は何もしない)。佐川への依頼状況を3つに分ける:
--   1. 手動依頼済みが確認できる … 佐川の問合番号がある / 集荷済み以降 → manual・accepted
--   2. 依頼済みか不明           … 「依頼済み」印 (pickup_requested_at) はあるが番号も配送の進行も無い、
--                                 または旧発行で issued だが印も番号も無い (今日以降の発送分のみ)
--                                 → manual・needs_review (運営の確認待ち。Biz-Logi からは送れない)
--   3. 未依頼が確認できる       … 上のどちらでもない (記録を作らない = 未依頼)
-- 取消済みの区間は対象外。shipments は変更しない。
insert into public.pickup_requests
  (shipment_id, booking_id, leg_index, channel, state, shipping_number, note, sent_at, resolved_at, resolved_by, requested_by,
   pickup_date, piece_count, request_snapshot)
select s.id, s.booking_id, s.leg_index, 'manual',
       case when (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0)
                 or s.status in ('picked_up', 'in_transit', 'delivered')
            then 'accepted' else 'needs_review' end,
       case when jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0
            then s.tracking_numbers ->> 0 end,
       case when (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0)
                 or s.status in ('picked_up', 'in_transit', 'delivered')
            then '移行(062): 佐川の問合番号または集荷以降の配送記録あり'
            when s.pickup_requested_at is not null
            then '移行(062): 依頼済み印はあるが問合番号なし。佐川への依頼有無を確認してください'
            else '移行(062): 旧発行で手配済みだが依頼済み印も問合番号もなし。佐川への依頼有無を確認してください' end,
       s.pickup_requested_at,
       case when (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0)
                 or s.status in ('picked_up', 'in_transit', 'delivered')
            then now() end,
       case when (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0)
                 or s.status in ('picked_up', 'in_transit', 'delivered')
            then 'migration-062' end,
       'migration-062',
       s.shipment_date,
       s.suitcase_count,
       -- 移行時点の内容を依頼内容とみなす
       public.pickup_snapshot_json(s)
  from public.shipments s
 where s.status <> 'cancelled'
   and (
         (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0)
      or s.status in ('picked_up', 'in_transit', 'delivered')
      or (s.shipment_date >= (now() at time zone 'Asia/Tokyo')::date
          and (s.pickup_requested_at is not null or s.status = 'issued'))
       )
   and not exists (select 1 from public.pickup_requests r where r.shipment_id = s.id)
   and not exists (select 1 from public.pickup_request_settings x where x.id and x.backfill_done_at is not null);
update public.pickup_request_settings set backfill_done_at = now() where id and backfill_done_at is null;
