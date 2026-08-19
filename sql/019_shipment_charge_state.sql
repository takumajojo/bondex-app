-- 019: 課金後の状態同期カラム (Stripe webhook 反映用)。
--
-- 本番課金 (015) の後段。集荷完了で課金が成立した後に Stripe 側で発生する
-- 「返金 / チャージバック(係争) / (再試行時の)決済失敗」を webhook で検知し、
-- shipments に状態として同期するためのカラム。今回は「検知＋DB状態同期のみ」
-- で、返金 UI や自動対応は含まない (運用が /operator で気づける状態にする)。
--
-- いずれも追加のみ・NULL 許容で既存動作に影響しない。

alter table shipments
  add column if not exists refunded_at             timestamptz,
  add column if not exists refund_amount_yen       integer,
  add column if not exists disputed_at             timestamptz,
  add column if not exists dispute_status          text,
  add column if not exists payment_failed_at       timestamptz,
  add column if not exists payment_failure_message text;

comment on column shipments.refunded_at is 'Stripe で返金が記録された日時 (charge.refunded)';
comment on column shipments.refund_amount_yen is '返金累計額 (税込・円。charge.amount_refunded)';
comment on column shipments.disputed_at is 'チャージバック(係争)が開始された日時 (charge.dispute.created)';
comment on column shipments.dispute_status is 'Stripe Dispute のステータス (needs_response / under_review / won / lost 等)';
comment on column shipments.payment_failed_at is 'PaymentIntent の決済失敗日時 (payment_intent.payment_failed)';
comment on column shipments.payment_failure_message is '決済失敗の理由 (Stripe last_payment_error.message)';
