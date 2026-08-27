-- 020: 代理店別「ホテル通知設定」(案A)。
--
-- ホテル通知 = バウチャーPDFの申し送り欄 (発送元ホテル欄 / お届け先ホテル欄) への印字。
-- どちらに載せるかは shipments.note_target (from/to/both) が決める。
--
-- 本マイグレーションで追加するもの:
--  1) agencies.hotel_notification_mode … 代理店ごとの既定モード。leg 個別指定が無いとき
--     ここへ解決する (lib/hotel-notification.ts resolveNoteTarget)。値=データなので
--     代理店を増やしてもコード分岐は増えない。
--        guest_only → note_target 'to'   (お届け先のみ・既定)
--        pickup_only→ note_target 'from' (発送元のみ)
--        dual       → note_target 'both' (両方)
--  2) shipments.pickup_hotel_notified_at / guest_hotel_notified_at … 「両ルート」の
--     送信済み/未送信を明示フラグ(timestamptz)で持つ。null=未送信。
--     真実をDBに1個持つので画面表示と不整合しない。
--  3) shipments.note_target … 既に本番DBには存在するがマイグレーションが欠落していた
--     (schema drift)。冪等に追加して正典化する。
--
-- いずれも追加のみ・既存動作に影響しない。

alter table agencies
  add column if not exists hotel_notification_mode text not null default 'guest_only';

alter table shipments
  add column if not exists note_target              text,
  add column if not exists pickup_hotel_notified_at timestamptz,
  add column if not exists guest_hotel_notified_at  timestamptz;

comment on column agencies.hotel_notification_mode is
  '代理店の既定ホテル通知モード (guest_only=お届け先のみ / pickup_only=発送元のみ / dual=両方)。leg の note_target が優先。';
comment on column shipments.note_target is
  '申し送りの掲載先 from=発送元のみ / to=お届け先のみ(既定) / both=両方 (バウチャー専用)';
comment on column shipments.pickup_hotel_notified_at is
  '発送元ホテルへの通知(申し送り引き渡し)完了日時。null=未送信。';
comment on column shipments.guest_hotel_notified_at is
  'お届け先ホテルへの通知(申し送り引き渡し)完了日時。null=未送信。';
