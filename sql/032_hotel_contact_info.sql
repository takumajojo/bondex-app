-- 032_hotel_contact_info.sql (2026-09-07 谷口さん指示)
--
-- ホテル連絡の「電話 / メール・連絡先・メモ(断られた/折り返し待ち 等)」を区間ごとに保持する。
-- 連絡「済み」の時刻は既存の pickup_hotel_notified_at / guest_hotel_notified_at を継続利用し、
-- ここには“どうやって・どこへ連絡するか”と“連絡の顛末メモ”だけを持たせる。
--
-- 形 (どちらのルートも任意):
--   {
--     "pickup": { "method": "phone" | "email" | "", "value": "03-1234-5678", "memo": "16時折り返し" },
--     "guest":  { "method": "phone" | "email" | "", "value": "front@hotel.jp", "memo": "断られた: クローク満杯" }
--   }
--
-- 追加のみ・既定は空オブジェクト。既存行・既存クエリに影響しない。
alter table shipments
  add column if not exists hotel_contact_info jsonb not null default '{}'::jsonb;

comment on column shipments.hotel_contact_info is
  'ホテル連絡の手段/連絡先/メモ (pickup=発送元, guest=お届け先)。連絡済み時刻は *_hotel_notified_at を使う。';
