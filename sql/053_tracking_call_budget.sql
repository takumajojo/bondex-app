-- 053: 追跡15回予算・完了メール再送・429上限管理
--
-- 背景: Ship&co は追跡番号あたり15回で 429 TRACKING_LIMIT_EXCEEDED を返す
--   (公式 developer.shipandco.com・2026-10-26 診断 #86 で確定)。
--   #83 再開後に 15分毎 cron が同一番号を照会し続けて使い切ったため、
--   照会を配分し、番号ごとの回数を管理する。
--
-- 追加カラム:
--   delivered_notified_at  : 配達完了メールを送信済みの時刻。
--                            「delivered かつ NULL」を次回 cron が拾って再送 → 失敗時リトライ。
--                            非NULL なら送らない → 重複防止。
--   tracking_limit_reached : その区間の追跡番号が 15回上限(429)に達した。自動照会から外し、
--                            operator 画面の別一覧で手動確認する。

alter table shipments add column if not exists delivered_notified_at timestamptz;
alter table shipments add column if not exists tracking_limit_reached boolean not null default false;

-- (1) 既に配達完了の過去便は「通知済み」とみなす。
--     → カラム追加後に、過去の delivered 便へ完了メールを誤って再送しないため (再送対象から除外)。
update shipments
set delivered_notified_at = coalesce(delivered_at, now())
where status = 'delivered' and delivered_notified_at is null;

-- (2) 既存の稼働中(未終端・追跡番号あり)の区間は「上限到達扱い」にする。
--     → 10/24 以降 15分毎に大量照会済みで残枠が読めないため、新カウンターで "残り15回" と
--       誤認させない。これらは別一覧で手動確認し、手動で配達完了を登録する (当面の運用)。
update shipments
set tracking_limit_reached = true
where status not in ('delivered','cancelled','failed')
  and tracking_numbers is not null
  and jsonb_array_length(tracking_numbers) > 0;

-- 別一覧(429到達)を素早く引くための部分インデックス。
create index if not exists idx_shipments_limit_reached
  on shipments (tracking_limit_reached) where tracking_limit_reached = true;
