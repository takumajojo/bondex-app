-- 英語の施設名 (英語の請求書・バウチャーで使用)。発送元/お届け先それぞれの英語表記を保存する。
-- バウチャー再生成時に、英語名(日本語を含まない解決結果)を補完する (lib/voucher-regen.tsx)。
-- ※本番DBには別途適用済み。記録・新規DB構築のために冪等 (add column if not exists) で残す (2026-10-05)。
alter table shipments add column if not exists from_hotel_en text;
alter table shipments add column if not exists to_hotel_en text;
