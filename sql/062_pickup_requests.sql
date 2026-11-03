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

-- ─────────────────────────────────────────────────────────────────────────────
-- 依頼の確保。外部送信の「前」に呼び、claimed=true を受け取った実行だけが送信する。
--   p_channel='bizlogi' → state='sending' で確保
--   p_channel='manual'  → state='accepted' で記録し、shipments.pickup_requested_at を入れる
-- 区間の行ロックで判定と挿入を直列化し、最後は部分一意インデックスで二重を物理的に止める。
create or replace function public.claim_pickup_request(
  p_shipment_id     uuid,
  p_channel         text,
  p_environment     text,
  p_manage_number   text,
  p_piece_count     int,
  p_pickup_date     date,
  p_actor           text,
  p_owner           text,
  p_note            text,
  p_snapshot        jsonb
) returns table (claimed boolean, request_id uuid, reason text)
language plpgsql
as $$
declare
  s public.shipments;
  v_id uuid;
  v_state text := case when p_channel = 'manual' then 'accepted' else 'sending' end;
begin
  if p_channel not in ('manual', 'bizlogi') then
    return query select false, null::uuid, 'invalid_channel'::text;
    return;
  end if;

  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then
    return query select false, null::uuid, 'shipment_not_found'::text;
    return;
  end if;
  if s.status = 'cancelled' then
    return query select false, null::uuid, 'shipment_cancelled'::text;
    return;
  end if;
  -- Biz-Logi は「佐川の番号がまだ無い」区間だけ。番号があるのは佐川側に依頼が存在する証拠。
  if p_channel = 'bizlogi' and jsonb_typeof(s.tracking_numbers) = 'array'
     and jsonb_array_length(s.tracking_numbers) > 0 then
    return query select false, null::uuid, 'tracking_number_exists'::text;
    return;
  end if;
  -- Biz-Logi は当面 1〜19個の通常配送だけ (2026-11-04 谷口さん)。20個以上は佐川へ事前連絡が必要なため
  -- BondEx で確認して手動手配する。団体 (booking_type='group') も手動。手動 (Excel) の記録には影響しない。
  if p_channel = 'bizlogi' and coalesce(s.suitcase_count, 0) >= 20 then
    return query select false, null::uuid, 'too_many_pieces'::text;
    return;
  end if;
  if p_channel = 'bizlogi' and coalesce(s.booking_type, 'fit') = 'group' then
    return query select false, null::uuid, 'group_booking'::text;
    return;
  end if;
  if exists (
    select 1 from public.pickup_requests r
     where r.shipment_id = p_shipment_id
       and r.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')
  ) then
    return query select false, null::uuid, 'live_request_exists'::text;
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
       p_snapshot)
    returning id into v_id;
  exception when unique_violation then
    return query select false, null::uuid, 'live_request_exists'::text;
    return;
  end;

  if p_channel = 'manual' then
    update public.shipments
       set pickup_requested_at = coalesce(pickup_requested_at, now())
     where id = p_shipment_id;
  end if;

  return query select true, v_id, 'claimed'::text;
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

revoke all on function public.claim_pickup_request(uuid, text, text, text, int, date, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.transition_pickup_request(uuid, text[], text, text, text, text, text, jsonb, text, text, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 集荷依頼の受付後の変更 (ホテル・問い合わせ番号) の管理 (2026-11-04 谷口さん)。
-- 受付後は API で変更できないため、世田谷営業所へ連絡し、佐川の回答 (承認) を受けてから BondEx の情報を変える。
-- 流れ: requested (変更希望を登録) → contacted (世田谷へ連絡) → approved / rejected (佐川の回答)
--       → applied (BondEx のホテル・番号へ反映)。連絡前なら withdrawn (取り下げ)。
-- 佐川の回答前は shipments のホテル情報を一切変えない。新しい集荷依頼は送らない (有効な依頼1件のまま)。
-- 問い合わせ番号は「維持 (kept)」と「振り直し (changed)」の両方に対応する (SG への質問 C-10 は回答待ち)。
create table if not exists public.pickup_change_requests (
  id                   uuid primary key default gen_random_uuid(),
  shipment_id          uuid not null references public.shipments(id) on delete restrict,
  pickup_request_id    uuid not null references public.pickup_requests(id) on delete restrict,
  -- 変えるホテル (guest=到着先 / pickup=発送元)。null はホテルを変えない (番号の振り直しだけ)。
  side                 text check (side in ('guest', 'pickup')),
  new_hotel            text,
  new_hotel_ja         text,
  new_place_id         text,
  new_city             text,
  new_prefecture       text,
  reason               text not null,
  state                text not null default 'requested'
                         check (state in ('requested', 'contacted', 'approved', 'rejected', 'applied', 'withdrawn')),
  number_policy        text check (number_policy in ('kept', 'changed')),
  new_shipping_number  text,
  -- 反映時に退避する旧情報 (履歴)
  old_shipping_number  text,
  old_tracking_numbers jsonb,
  old_tracking_detail  jsonb,
  old_hotel            text,
  old_hotel_ja         text,
  old_place_id         text,
  hotel_change_id      uuid,
  requested_by         text not null,
  contacted_by         text,
  contact_note         text,
  contacted_at         timestamptz,
  answered_by          text,
  answer_note          text,
  answered_at          timestamptz,
  applied_by           text,
  applied_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- 1区間に進行中の変更は1件まで
create unique index if not exists pickup_change_requests_one_open_per_leg
  on public.pickup_change_requests (shipment_id)
  where state in ('requested', 'contacted', 'approved');
create index if not exists pickup_change_requests_shipment_idx on public.pickup_change_requests (shipment_id, created_at desc);
alter table public.pickup_change_requests enable row level security;

-- 問い合わせ番号が他の区間で使われていないか (shipments の番号・集荷依頼の記録の両方)
create or replace function public.pickup_number_in_use(p_number text, p_shipment_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.shipments x
     where x.id <> p_shipment_id and jsonb_typeof(x.tracking_numbers) = 'array'
       and x.tracking_numbers ? p_number
  ) or exists (
    select 1 from public.pickup_requests r
     where r.shipment_id <> p_shipment_id and r.shipping_number = p_number
       and r.state not in ('void', 'failed')
  );
$$;

-- 変更希望の登録。受付済み (accepted) の集荷依頼がある・集荷前・取消でない区間だけ。
create or replace function public.create_pickup_change(
  p_shipment_id uuid, p_side text, p_new_hotel text, p_new_hotel_ja text, p_new_place_id text,
  p_new_city text, p_new_prefecture text, p_reason text, p_actor text
) returns table (ok boolean, change_id uuid, reason text)
language plpgsql as $$
declare
  s public.shipments;
  r public.pickup_requests;
  v_id uuid;
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then return query select false, null::uuid, 'shipment_not_found'::text; return; end if;
  if s.status = 'cancelled' then return query select false, null::uuid, 'shipment_cancelled'::text; return; end if;
  if s.status in ('picked_up', 'in_transit', 'delivered') then
    return query select false, null::uuid, 'picked_up_or_later'::text; return;
  end if;
  select * into r from public.pickup_requests x
   where x.shipment_id = p_shipment_id and x.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')
   for update;
  if not found then return query select false, null::uuid, 'no_live_request'::text; return; end if;
  if r.state <> 'accepted' then return query select false, null::uuid, ('request_' || r.state)::text; return; end if;
  if btrim(coalesce(p_reason, '')) = '' then return query select false, null::uuid, 'reason_required'::text; return; end if;
  if p_side is not null and (p_side not in ('guest', 'pickup')
      or btrim(coalesce(p_new_hotel, '')) = '' or btrim(coalesce(p_new_place_id, '')) = '') then
    return query select false, null::uuid, 'hotel_required'::text; return;
  end if;
  begin
    insert into public.pickup_change_requests
      (shipment_id, pickup_request_id, side, new_hotel, new_hotel_ja, new_place_id, new_city, new_prefecture, reason, requested_by)
    values
      (p_shipment_id, r.id, p_side, nullif(btrim(p_new_hotel), ''), nullif(btrim(p_new_hotel_ja), ''), nullif(btrim(p_new_place_id), ''),
       nullif(btrim(p_new_city), ''), nullif(btrim(p_new_prefecture), ''), btrim(p_reason), p_actor)
    returning id into v_id;
  exception when unique_violation then
    return query select false, null::uuid, 'open_change_exists'::text; return;
  end;
  return query select true, v_id, 'created'::text;
end;
$$;

-- 連絡・佐川の回答・取り下げ。回答 (approve) では番号の扱い (kept / changed) を必ず記録する。
create or replace function public.step_pickup_change(
  p_change_id uuid, p_step text, p_actor text, p_note text, p_number_policy text, p_new_number text
) returns table (ok boolean, state text, reason text)
language plpgsql as $$
declare
  c public.pickup_change_requests;
  r public.pickup_requests;
  v_num text := nullif(regexp_replace(coalesce(p_new_number, ''), '[^0-9]', '', 'g'), '');
begin
  select * into c from public.pickup_change_requests where id = p_change_id for update;
  if not found then return query select false, null::text, 'not_found'::text; return; end if;
  select * into r from public.pickup_requests where id = c.pickup_request_id for update;

  if p_step = 'withdraw' then
    if c.state <> 'requested' then return query select false, c.state, 'state_mismatch'::text; return; end if;
    update public.pickup_change_requests set state = 'withdrawn', answer_note = p_note, answered_by = p_actor, answered_at = now(), updated_at = now() where id = c.id;
    return query select true, 'withdrawn'::text, 'ok'::text; return;
  end if;

  if btrim(coalesce(p_note, '')) = '' then return query select false, c.state, 'note_required'::text; return; end if;

  if p_step = 'contact' then
    if c.state <> 'requested' then return query select false, c.state, 'state_mismatch'::text; return; end if;
    if r.state <> 'accepted' then return query select false, c.state, ('request_' || r.state)::text; return; end if;
    update public.pickup_change_requests set state = 'contacted', contacted_by = p_actor, contact_note = p_note, contacted_at = now(), updated_at = now() where id = c.id;
    update public.pickup_requests set state = 'change_pending', updated_at = now(),
           note = concat_ws(E'\n', note, p_actor || ': 受付後の変更を世田谷へ連絡 (' || p_note || ')')
     where id = r.id;
    return query select true, 'contacted'::text, 'ok'::text; return;
  end if;

  if p_step = 'approve' then
    if c.state <> 'contacted' then return query select false, c.state, 'state_mismatch'::text; return; end if;
    if p_number_policy not in ('kept', 'changed') then return query select false, c.state, 'number_policy_required'::text; return; end if;
    if p_number_policy = 'changed' then
      if v_num is null or v_num !~ '^[0-9]{10,12}$' then return query select false, c.state, 'invalid_number'::text; return; end if;
      if v_num = r.shipping_number then return query select false, c.state, 'same_number'::text; return; end if;
      if public.pickup_number_in_use(v_num, c.shipment_id) then return query select false, c.state, 'number_in_use'::text; return; end if;
    end if;
    if p_number_policy = 'kept' and v_num is not null then return query select false, c.state, 'number_not_expected'::text; return; end if;
    update public.pickup_change_requests set state = 'approved', number_policy = p_number_policy,
           new_shipping_number = case when p_number_policy = 'changed' then v_num end,
           answered_by = p_actor, answer_note = p_note, answered_at = now(), updated_at = now()
     where id = c.id;
    return query select true, 'approved'::text, 'ok'::text; return;
  end if;

  if p_step = 'reject' then
    if c.state <> 'contacted' then return query select false, c.state, 'state_mismatch'::text; return; end if;
    update public.pickup_change_requests set state = 'rejected', answered_by = p_actor, answer_note = p_note, answered_at = now(), updated_at = now() where id = c.id;
    -- 佐川が変更を受けなかった = 元の依頼のまま有効。区間の情報は変えない。
    update public.pickup_requests set state = 'accepted', updated_at = now(),
           note = concat_ws(E'\n', note, p_actor || ': 受付後の変更は佐川の回答で不可 (' || p_note || ')')
     where pickup_requests.id = r.id and pickup_requests.state = 'change_pending';
    return query select true, 'rejected'::text, 'ok'::text; return;
  end if;

  return query select false, c.state, 'invalid_step'::text;
end;
$$;

-- 承認済みの変更を BondEx へ反映する (1トランザクション)。
--   ホテル: shipments を更新し、shipment_hotel_changes に履歴を残す (apply_hotel_change と同じ更新内容。
--           apply_hotel_change は問合番号がある区間を拒否するため、佐川の承認を条件にこの関数で行う)。
--   番号:   changed なら旧番号・旧追跡明細を退避し、区間の番号を新番号に置き換える (追跡は新番号で始まり、旧番号は照会しない)。
--   集荷依頼: change_pending → accepted。依頼内容 (request_snapshot) を今の内容で作り直す。
create or replace function public.apply_pickup_change(p_change_id uuid, p_actor text)
returns table (ok boolean, reason text, hotel_change_id uuid)
language plpgsql as $$
declare
  c public.pickup_change_requests;
  r public.pickup_requests;
  s public.shipments;
  v_hc uuid;
  v_cancel_task boolean;
begin
  select * into c from public.pickup_change_requests where id = p_change_id for update;
  if not found then return query select false, 'not_found'::text, null::uuid; return; end if;
  if c.state <> 'approved' then return query select false, ('state_' || c.state)::text, null::uuid; return; end if;
  select * into s from public.shipments where id = c.shipment_id for update;
  if s.status = 'cancelled' then return query select false, 'shipment_cancelled'::text, null::uuid; return; end if;
  if s.status in ('picked_up', 'in_transit', 'delivered') then return query select false, 'picked_up_or_later'::text, null::uuid; return; end if;
  select * into r from public.pickup_requests where id = c.pickup_request_id for update;
  if r.state <> 'change_pending' then return query select false, ('request_' || r.state)::text, null::uuid; return; end if;
  if c.number_policy = 'changed' and public.pickup_number_in_use(c.new_shipping_number, c.shipment_id) then
    return query select false, 'number_in_use'::text, null::uuid; return;
  end if;

  update public.pickup_change_requests set
    old_shipping_number = r.shipping_number,
    old_tracking_numbers = s.tracking_numbers,
    old_tracking_detail = case when c.number_policy = 'changed' then s.tracking_detail end,
    old_hotel = case c.side when 'guest' then s.to_hotel when 'pickup' then s.from_hotel end,
    old_hotel_ja = case c.side when 'guest' then s.to_hotel_ja when 'pickup' then s.from_hotel_ja end,
    old_place_id = case c.side when 'guest' then s.to_place_id when 'pickup' then s.from_place_id end
  where id = c.id;

  if c.side = 'guest' then
    v_cancel_task := s.guest_hotel_notified_at is not null;
    update public.shipments set
      to_hotel = c.new_hotel, to_hotel_ja = c.new_hotel_ja, to_place_id = c.new_place_id,
      to_city = coalesce(c.new_city, to_city), to_prefecture = c.new_prefecture,
      guest_hotel_notified_at = null,
      hotel_contact_info = coalesce(hotel_contact_info, '{}'::jsonb) - 'guest',
      updated_at = now()
    where id = s.id;
  elsif c.side = 'pickup' then
    v_cancel_task := s.pickup_hotel_notified_at is not null;
    update public.shipments set
      from_hotel = c.new_hotel, from_hotel_ja = c.new_hotel_ja, from_place_id = c.new_place_id,
      from_city = coalesce(c.new_city, from_city), from_prefecture = c.new_prefecture,
      pickup_hotel_notified_at = null,
      hotel_contact_info = coalesce(hotel_contact_info, '{}'::jsonb) - 'pickup',
      updated_at = now()
    where id = s.id;
  end if;
  if c.side is not null then
    insert into public.shipment_hotel_changes(
      shipment_id, booking_id, leg_index, side, old_hotel, new_hotel, old_hotel_ja, new_hotel_ja, old_place_id, new_place_id,
      over_deadline, reason, old_slip_task, old_hotel_cancel_task, changed_by, agency
    )
    select c.shipment_id, s.booking_id, s.leg_index, c.side, x.old_hotel, c.new_hotel, x.old_hotel_ja, c.new_hotel_ja, x.old_place_id, c.new_place_id,
           false, '集荷依頼の受付後の変更 (佐川の回答: ' || coalesce(c.answer_note, '') || ')', false, coalesce(v_cancel_task, false),
           'operator:' || coalesce(p_actor, ''), s.agency
      from public.pickup_change_requests x where x.id = c.id
    returning id into v_hc;
  end if;

  if c.number_policy = 'changed' then
    update public.shipments set tracking_numbers = jsonb_build_array(c.new_shipping_number), tracking_detail = null,
           tracking_limit_reached = false, updated_at = now()
     where id = s.id;
  end if;

  update public.pickup_requests p set
    state = 'accepted',
    shipping_number = case when c.number_policy = 'changed' then c.new_shipping_number else p.shipping_number end,
    request_snapshot = (select jsonb_build_object(
         'from_hotel', y.from_hotel, 'from_place_id', y.from_place_id, 'from_residence', y.from_residence,
         'to_hotel', y.to_hotel, 'to_place_id', y.to_place_id, 'to_residence', y.to_residence,
         'shipment_date', y.shipment_date, 'expected_arrival', y.expected_arrival,
         'delivery_time', y.delivery_time, 'suitcase_count', y.suitcase_count)
       from public.shipments y where y.id = s.id),
    resolved_by = p_actor, resolved_at = now(), updated_at = now(),
    note = concat_ws(E'\n', p.note, p_actor || ': 受付後の変更を反映'
           || case when c.number_policy = 'changed' then ' (問合番号 ' || coalesce(r.shipping_number, '-') || ' → ' || c.new_shipping_number || ')' else ' (問合番号は維持)' end)
  where p.id = r.id;

  update public.pickup_change_requests set state = 'applied', applied_by = p_actor, applied_at = now(), hotel_change_id = v_hc, updated_at = now()
   where id = c.id;
  return query select true, 'applied'::text, v_hc;
end;
$$;

revoke all on function public.create_pickup_change(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.step_pickup_change(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_pickup_change(uuid, text) from public, anon, authenticated;
revoke all on function public.pickup_number_in_use(text, uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 既存データの移行 (1回だけ)。佐川への依頼状況を3つに分ける:
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
       -- lib/pickup-request/snapshot.ts の pickupSnapshot と同じ形 (移行時点の内容を依頼内容とみなす)
       jsonb_build_object(
         'from_hotel', s.from_hotel, 'from_place_id', s.from_place_id, 'from_residence', s.from_residence,
         'to_hotel', s.to_hotel, 'to_place_id', s.to_place_id, 'to_residence', s.to_residence,
         'shipment_date', s.shipment_date, 'expected_arrival', s.expected_arrival,
         'delivery_time', s.delivery_time, 'suitcase_count', s.suitcase_count)
  from public.shipments s
 where s.status <> 'cancelled'
   and (
         (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0)
      or s.status in ('picked_up', 'in_transit', 'delivered')
      or (s.shipment_date >= (now() at time zone 'Asia/Tokyo')::date
          and (s.pickup_requested_at is not null or s.status = 'issued'))
       )
   and not exists (select 1 from public.pickup_requests r where r.shipment_id = s.id);
