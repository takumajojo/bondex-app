-- 追跡通知の「送信権」を DB 側で原子的に取得する (レビュー 7c234a4 是正の第4〜5弾)。
-- 旧実装の「読み取り → 無条件 upsert」は last-writer-wins で、遅れた実行が sent/manual を pending へ
-- 戻し、初回試行時刻 first_attempt_at を上書きし得た。これを行ロック付きの関数で原子化する:
--   - 送信権を取得できた実行だけが claimed=true を受け取り、外部送信する (ネットワーク送信は関数の外)。
--   - first_attempt_at・idempotency_key は一度確定したら変更しない。固定の冪等キーを戻り値で返す
--     (呼び出し側は再計算せず、この値をそのまま送信に使う)。
--   - sent/manual は pending へ戻さない。
--   - 起点が欠損した未確定行は now で補完して送らず manual へ回す。窓(24h)を越えた未確定も manual。
--   - 送信権には有効期限 (lease) がある。期限内に pending が生きている間は別実行へ渡さない (送信中の
--     二重送信を防ぐ)。前の所有者が停止しても、期限切れで送信権を回収できる (回収の10分猶予と整合)。
--   - 結果保存は、その試行の所有権 (attempt_owner) と pending 状態を確認してからのみ適用する。

-- 送信権の取得。戻り値 claimed=true の実行だけが外部送信する。
create or replace function public.claim_tracking_send(
  p_shipment_id     uuid,
  p_kind            text,
  p_recipient       text,
  p_idempotency_key text,
  p_owner           text,
  p_now             timestamptz,
  p_window_ms       bigint,   -- 重複防止窓 (ms)。これを越えた未確定は自動再送しない。
  p_lease_ms        bigint    -- 送信権の有効期限 (ms)。期限内の pending は別実行へ渡さない。期限切れで回収。
) returns table (claimed boolean, state text, first_attempt_at timestamptz, idempotency_key text)
language plpgsql
as $$
declare
  v_window interval := make_interval(secs => (p_window_ms / 1000.0)::double precision);
  v_lease  interval := make_interval(secs => (p_lease_ms  / 1000.0)::double precision);
  r public.tracking_notifications;
begin
  -- 同じ (shipment, kind, recipient) を同時に触る実行を直列化する (行ロック)。送信はこの外で行う。
  select * into r from public.tracking_notifications t
   where t.shipment_id = p_shipment_id and t.kind = p_kind and t.recipient = p_recipient
   for update;

  if not found then
    -- 初回。起点・固定の冪等キー・所有者・送信権の起点時刻を記録して送信権を得る。
    -- 存在しない行には行ロックが効かないため、同時 INSERT は一意制約 (PK) で1つに絞られる。
    -- 競合に敗れた実行は unique_violation を捕まえ、勝者の行をロックして読み直し既存行分岐へ合流する。
    begin
      insert into public.tracking_notifications
        (shipment_id, kind, recipient, state, first_attempt_at, idempotency_key, attempt_owner, updated_at)
      values
        (p_shipment_id, p_kind, p_recipient, 'pending', p_now, p_idempotency_key, p_owner, p_now);
      return query select true, 'pending'::text, p_now, p_idempotency_key;
      return;
    exception when unique_violation then
      select * into r from public.tracking_notifications t
       where t.shipment_id = p_shipment_id and t.kind = p_kind and t.recipient = p_recipient
       for update;
    end;
  end if;

  -- 終端は送らない (sent/manual を pending へ戻さない)。固定の冪等キーはそのまま返す。
  if r.state in ('sent','manual') then
    return query select false, r.state, r.first_attempt_at, r.idempotency_key;
    return;
  end if;

  -- 明確な失敗 (failed) は二重送信の恐れがなく常に再送可。起点は保持 (欠損時のみ now で補完)。
  -- coalesce の列参照を明示する (戻り値の出力列 first_attempt_at との曖昧さ=実行時エラーを避ける)。
  if r.state = 'failed' then
    update public.tracking_notifications
       set state = 'pending', attempt_owner = p_owner, updated_at = p_now,
           first_attempt_at = coalesce(public.tracking_notifications.first_attempt_at, p_now)
     where shipment_id = p_shipment_id and kind = p_kind and recipient = p_recipient;
    return query select true, 'pending'::text, coalesce(r.first_attempt_at, p_now), r.idempotency_key;
    return;
  end if;

  -- ここから未確定 (pending/ambiguous = 送ったか不明の可能性がある)。
  -- 起点が欠損・不正 → now で補完して送らず manual へ (推測で再送しない)。
  if r.first_attempt_at is null then
    update public.tracking_notifications
       set state = 'manual', first_attempt_at = p_now, updated_at = p_now,
           error = 'missing first_attempt_at'
     where shipment_id = p_shipment_id and kind = p_kind and recipient = p_recipient;
    return query select false, 'manual'::text, p_now, r.idempotency_key;
    return;
  end if;

  -- 送信権の有効期限内に pending が生きている = 別の実行が送信中。送信権を渡さない (二重送信を避ける)。
  -- ambiguous は「完了済み」の試行 (送信中ではない) なので対象外。前の所有者が停止しても、期限切れ
  -- (p_now - updated_at >= lease) になれば下の分岐で回収する。
  if r.state = 'pending' and r.updated_at is not null and (p_now - r.updated_at) < v_lease then
    return query select false, 'pending'::text, r.first_attempt_at, r.idempotency_key;
    return;
  end if;

  -- 重複防止窓を越えた未確定 → 自動再送せず manual へ。
  if p_now - r.first_attempt_at >= v_window then
    update public.tracking_notifications
       set state = 'manual', updated_at = p_now, error = 'unconfirmed beyond dedup window'
     where shipment_id = p_shipment_id and kind = p_kind and recipient = p_recipient;
    return query select false, 'manual'::text, r.first_attempt_at, r.idempotency_key;
    return;
  end if;

  -- 窓内で送信権が空いている (ambiguous、または pending で lease 期限切れ=前の所有者が停止)。
  -- 同じ起点・固定の冪等キーで送信権を取り直す。二重配信は固定の冪等キーで Resend が排除し、
  -- 結果保存は所有権 (attempt_owner) を確認するため、重なっても状態・起点は壊れない。
  update public.tracking_notifications
     set state = 'pending', attempt_owner = p_owner, updated_at = p_now
   where shipment_id = p_shipment_id and kind = p_kind and recipient = p_recipient;
  return query select true, 'pending'::text, r.first_attempt_at, r.idempotency_key;
end;
$$;

-- 結果の保存。送信権を取得した実行 (attempt_owner 一致) かつ pending のときだけ適用する。
-- 遅れた実行・期限切れで回収された側・他の所有者の書き込みで状態・起点を上書きさせない。
-- first_attempt_at/idempotency_key は不変。
create or replace function public.record_tracking_result(
  p_shipment_id uuid,
  p_kind        text,
  p_recipient   text,
  p_owner       text,
  p_state       text,
  p_error       text,
  p_now         timestamptz
) returns table (applied boolean)
language plpgsql
as $$
begin
  update public.tracking_notifications
     set state = p_state, error = p_error, updated_at = p_now
   where shipment_id = p_shipment_id and kind = p_kind and recipient = p_recipient
     and attempt_owner = p_owner and state = 'pending';
  return query select found;
end;
$$;
