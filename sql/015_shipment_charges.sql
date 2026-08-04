-- 015: カード課金 (集荷完了時に off_session で1件ずつ) の記録カラム。
--
-- 課金は STRIPE_CHARGE_LIVE=true かつ本番 Stripe キーがある時のみ実行される。
-- charged_at が二重課金防止のキー: 一度課金したら再度課金しない。
-- 失敗は charge_error に残し charged_at は据え置く (=再試行可能)。

alter table shipments
  add column if not exists charged_at               timestamptz,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists charge_amount_yen         integer,
  add column if not exists charge_error              text;

comment on column shipments.charged_at is '集荷完了時のカード課金実行日時 (二重課金防止キー)';
comment on column shipments.stripe_payment_intent_id is '課金に使った Stripe PaymentIntent ID';
comment on column shipments.charge_amount_yen is '課金額 (税込・円)';
comment on column shipments.charge_error is 'カード課金失敗時のエラー文言';
