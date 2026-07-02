-- 007: 追跡番号ごとの詳細ステータスを保存する列を追加
--
-- 背景:
--   /api/cron/sync-tracking は Ship&co から取得した current_status を
--   leg 全体の集約ステータス (shipments.status) にしか反映しておらず、
--   個々の追跡番号ごとの現在地・更新日時は破棄していた。
--   公開トラッキングページ (/track/[bookingId]) では各追跡番号がヤマトの
--   外部サイトへの直リンクになっているだけで、「今どこにあるか」が
--   BondEx 上で分からない状態だった。
--
-- yamato_tracking_detail の中身 (1 leg あたり):
--   [
--     {
--       "number": "487738926360",
--       "status": "in_transit",       -- BondEx の ShipmentStatus 語彙にマップ済み (null もあり得る)
--       "rawStatus": "OUT_FOR_DELIVERY", -- Ship&co の生ステータス文字列 (未確定語彙のため保持)
--       "location": "Osaka Sorting Center",
--       "date": "2026-07-09T14:30:00Z",
--       "checkedAt": "2026-07-09T15:00:03Z" -- cron がこの情報を取得した時刻
--     },
--     ...
--   ]

alter table shipments
  add column if not exists yamato_tracking_detail jsonb;
