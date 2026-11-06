-- P1-B2｜サーバー専用 RPC の EXECUTE を service_role に限定する多層防御 (2026-11-06, v3.7 で署名厳密化)。
--
-- 背景: 066〜071 が新設した RPC は、すべて Next.js の API ルート (getSupabase=service_role) から
-- だけ呼ぶ。ブラウザ (anon/authenticated) からは一切呼ばない。ところが PostgreSQL の既定では
-- 関数の EXECUTE は PUBLIC に付与されるため、理屈上は代理店の authenticated ロールが PostgREST 経由で
-- 直接 rpc を叩けてしまう。実害は shipments/新テーブルの RLS (shipments は SELECT のみ authenticated 可・
-- 書き込みポリシー無し / 新テーブルは policy 無し=service_role のみ) が二重に防ぐため「現状は」発生しないが、
-- sql/055 (sagawa tracking gate) が確立した「サーバー専用関数は PUBLIC/anon/authenticated から revoke し
-- service_role にだけ grant する」規約に 066〜071 が従っていなかった。本ファイルでその規約に揃える。
--
-- 安全方針: 追加型のみ・冪等 (権限の付け替えだけ)。service_role から呼ぶ本番コードの挙動は一切変わらない
-- (service_role には grant する)。既存テーブル/列/データ/RLS には触れない。**本番DB未適用**。隔離PGで検証。
--
-- 署名厳密化 (v3.7): 対象は「スキーマ名・関数名・引数シグネチャ」で完全一致させる。proname だけの一括一致は
-- 同名の別スキーマ関数やオーバーロードされた別シグネチャを巻き込みうるため使わない。下の sigs[] は
-- 066〜071 が public に作る 35 関数の正確なシグネチャ (型のみ)。to_regprocedure は「その正確なシグネチャが
-- 存在すれば」その 1 本だけを解決し、無ければ NULL を返す (他を一切巻き込まない)。066〜071 の適用後に
-- 本ファイルを流す前提なので、解決できないシグネチャが 1 つでもあれば権限付与に穴が開いた証拠として
-- 例外で停止する (サイレントにスキップしない)。35 関数名はいずれも sql<=065 に定義が無い (= 既存/BtoC 関数と
-- 衝突しない) ことを確認済み。
--
-- 再実行: 冪等。2 回目以降も同じ revoke/grant を適用するだけで状態は変わらない。
-- 適用順序: 必ず 066〜071 のあと (最後)。

do $$
declare
  sig     text;
  target  regprocedure;
  missing text[] := '{}';
  sigs    text[] := array[
    'public.agency_decide_price(uuid,uuid,integer,text,integer)',
    'public.apply_charge_holds_for_unit(text,date)',
    'public.apply_price_decision(uuid,integer,text,text,integer,text,text,integer)',
    'public.auto_finalize_pickup(uuid,integer,integer,boolean,boolean,boolean,text,text,text)',
    'public.begin_charge_attempt(uuid,text,text)',
    'public.bondex_is_residence(jsonb)',
    'public.bondex_norm_text(text)',
    'public.bondex_shipment_agency_id(uuid)',
    'public.bondex_shipment_hotel_key(text,text,text,text,text,jsonb)',
    'public.charge_hold_agency_enabled_by_name(text)',
    'public.charge_hold_should_gate(uuid)',
    'public.charge_hold_unit_disposition(uuid)',
    'public.claim_charge_right(uuid,text,integer)',
    'public.claim_invoice_postings(text,text)',
    'public.enqueue_price_notification(uuid,uuid,integer,text)',
    'public.evaluate_charge_hold(uuid)',
    'public.invoice_approve(text,text,text)',
    'public.invoice_effective_status(text,text)',
    'public.invoice_mark_paid(text,text)',
    'public.invoice_mark_sent(text,text,text)',
    'public.invoice_prepare(text,text,text,integer,integer)',
    'public.invoice_reissue(text,text,text)',
    'public.invoice_void(text,text,text,text)',
    'public.mark_charge_operator_review(uuid)',
    'public.mark_price_notification_failed(uuid,text)',
    'public.mark_price_notification_sent(uuid)',
    'public.operator_count_queue(integer)',
    'public.pickup_unit_summary(uuid)',
    'public.post_invoice_legs(text,text)',
    'public.reconcile_charge_attempt(uuid,text,text,integer)',
    'public.record_pickup_count(uuid,integer,text,text,text,boolean,boolean,text)',
    'public.release_charge_hold(uuid,text)',
    'public.request_price_approval(uuid,integer,integer,integer,integer,timestamp with time zone)',
    'public.revalidate_charge_claim(uuid,text,integer)',
    'public.settle_charge_attempt(uuid,text,text,text,text,text)'
  ];
begin
  foreach sig in array sigs loop
    target := to_regprocedure(sig);   -- その正確なシグネチャだけを解決。無ければ NULL (他を巻き込まない)。
    if target is null then
      missing := missing || sig;
      continue;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', target::regprocedure);
    execute format('grant execute on function %s to service_role', target::regprocedure);
  end loop;
  if array_length(missing, 1) is not null then
    raise exception 'sql/072: 対象 RPC のシグネチャが見つからず権限付与が未完了です (066〜071 の適用後に実行すること): %',
      array_to_string(missing, ', ');
  end if;
end $$;
