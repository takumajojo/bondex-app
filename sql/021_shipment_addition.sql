-- 021: 旅行中の「追加」依頼の清算カラム。
--
-- 追加 = 既存予約(booking_id)に旅行中に足された区間/個数。
-- 同じ booking_id(BDX番号)と tour_number(代理店番号)を引き継ぐので、
-- 追加であることは is_addition フラグで区別する。
--
-- 清算方針:
--  - 追加は集荷時の自動課金の対象外にする(is_addition=true は chargeShipmentIfDue が skip)。
--  - カード代理店: Stripe Checkout の決済リンクで清算 → 支払い完了で charged_at をセット。
--    リンクは stripe_checkout_session_id / stripe_checkout_url に保持。
--  - 請求書代理店: 月次請求に「追加」明細として計上(charged_at は請求書運用に委ねる)。
--
-- いずれも追加のみ・既存動作に影響しない。

alter table shipments
  add column if not exists is_addition                boolean not null default false,
  add column if not exists addition_note              text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_checkout_url        text;

comment on column shipments.is_addition is '旅行中の追加依頼か。true は集荷時の自動課金対象外(決済リンク/請求書で清算)。';
comment on column shipments.addition_note is '追加の理由・メモ(任意)。';
comment on column shipments.stripe_checkout_session_id is 'カード清算用 Stripe Checkout セッションID。';
comment on column shipments.stripe_checkout_url is 'カード清算用の決済リンク(代理店へ提示/送付)。';
