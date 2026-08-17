-- BondEx — テスト代理店の課金免除フラグ
--
-- billing_exempt=true の代理店は、どんなに配送手配しても一切課金しない
-- (カード登録は可能・集荷完了しても課金スキップ／月次請求書の対象からも除外)。
-- 用途: 「BondEx Test Agency」をテスト環境として動かすため (2026-08-10 谷口さん指示)。

alter table agencies
  add column if not exists billing_exempt boolean not null default false;

comment on column agencies.billing_exempt is
  'true=課金免除(テスト代理店)。カード課金(lib/charge.ts)・月次請求(cron/monthly-invoices)の両方でスキップ。';
