-- BondEx — 荷物の品目 (品名) を shipments に保存
--
-- これまで送り状の品名は常に「スーツケース」固定だった。代理店が品目
-- (小包/スーツケース/スキー/ゴルフ/その他=自由記述) を選べるようにし、選んだ品名を
-- 送り状(佐川/ヤマト)の品名欄に反映する。item_type には解決済みの日本語品名を保存
-- (例: スーツケース / スキー / 自由記述)。null/空は「スーツケース」扱い。

alter table shipments
  add column if not exists item_type text;

comment on column shipments.item_type is
  '送り状の品名 (解決済み日本語。例: スーツケース/小包/スキー/ゴルフ/自由記述)。null=スーツケース扱い。';
