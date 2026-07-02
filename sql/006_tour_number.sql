-- 006: ツアー番号 (旅行会社側の予約管理番号) と団体名表示フラグを追加
--
-- 背景 (堀部様 FB, 2026-07-01):
--   「予約管理用にツアー番号を入力できる欄が欲しい。ダッシュボードで
--    お客様の名前とツアー番号の両方で管理できるようになると助かる」
--   「請求書はお客様名＋各旅行会社のツアー番号を反映してほしい」
--
-- tour_number は booking 単位 (1 booking = 複数 leg = 複数行) の値なので、
-- 本来は bookings 側に持たせたいところだが、Phase A は shipments が唯一の
-- テーブルなので同じ booking_id の全行に同じ値を複製して持たせる。
-- (Phase B で bookings テーブルを切り出す際に正規化する)

alter table shipments
  add column if not exists tour_number text,
  add column if not exists group_name  text;   -- ファミリー/団体名 (voucher 表示は任意)

-- ダッシュボードでの「お客様名 or ツアー番号」検索用
create index if not exists shipments_tour_number_idx on shipments (tour_number);
