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

-- (2) 既存の稼働中番号は「残回数不明」として扱う (tracking_limit_reached は立てない・2026-10-26 谷口さん)。
--     ・tracking_limit_reached=true にするのは 429 を実際に受けた番号だけ (cron/即時照会が検知して記録)。
--     ・既存番号は queryCount を持たない = 残回数不明。照会は継続し、429 が返った時点で上限到達＝別一覧へ。
--     一律に上限到達扱いにすると、まだ残枠のある既存番号まで自動照会から外れて手動に回るため、やめる。
--     (poll-policy は queryCount 未知の番号を budget あり=照会可として扱い、429 で limitReached にする)。

-- 別一覧(429到達)を素早く引くための部分インデックス。
create index if not exists idx_shipments_limit_reached
  on shipments (tracking_limit_reached) where tracking_limit_reached = true;
