-- yamato_ 表記の是正 (2026-09-29)。BondEx は佐川/ヤマト両対応で、これらは配送キャリア非依存の
-- 保存列。「yamato_」の名残が実態(佐川の問合番号も入る)と食い違い紛らわしいため汎用名へ改名する。
--   yamato_tracking        -> tracking_numbers   (jsonb・問合番号/伝票No)
--   yamato_tracking_detail -> tracking_detail     (jsonb・追跡明細)
--   yamato_label_url       -> label_url           (text・送り状PDFのURL)
--   yamato_issuable_from   -> issuable_from        (date・発行可能日)
-- 対象外(ヤマト固有で残す): Ship&co サービス種別 yamato_takkyubin / yamato_regular、
--   クレーム番号 claims.yamato_case_number。
-- ★適用はコードデプロイと同時(一括切替)。旧名を参照する版が動いている間は不整合になるため、
--   新コードのデプロイと本SQLの実行を近接させること。
-- 冪等: 旧列が存在するときだけ改名(再実行・適用済みでも安全)。

do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'shipments' and column_name = 'yamato_tracking') then
    alter table shipments rename column yamato_tracking to tracking_numbers;
  end if;
  if exists (select 1 from information_schema.columns
             where table_name = 'shipments' and column_name = 'yamato_tracking_detail') then
    alter table shipments rename column yamato_tracking_detail to tracking_detail;
  end if;
  if exists (select 1 from information_schema.columns
             where table_name = 'shipments' and column_name = 'yamato_label_url') then
    alter table shipments rename column yamato_label_url to label_url;
  end if;
  if exists (select 1 from information_schema.columns
             where table_name = 'shipments' and column_name = 'yamato_issuable_from') then
    alter table shipments rename column yamato_issuable_from to issuable_from;
  end if;
end $$;
