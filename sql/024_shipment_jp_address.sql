-- 区間の日本語表記 (都道府県 + 日本語ホテル名) を保存する列を追加。
-- 管理ダッシュボードの「区間」列を「東京都 新宿ワシントンホテル」の形で表示するため。
-- いずれも発行時に Google Places から解決した値を保存する (未発行/旧データは null)。
alter table shipments
  add column if not exists from_prefecture text,
  add column if not exists from_hotel_ja  text,
  add column if not exists to_prefecture  text,
  add column if not exists to_hotel_ja    text;

comment on column shipments.from_prefecture is '発送元の都道府県 (日本語)。例: 東京都。発行時に Google Places から解決。';
comment on column shipments.from_hotel_ja  is '発送元ホテルの日本語表記。発行時に Google Places の name から解決。null=英語名にフォールバック。';
comment on column shipments.to_prefecture  is 'お届け先の都道府県 (日本語)。例: 京都府。';
comment on column shipments.to_hotel_ja    is 'お届け先ホテルの日本語表記。null=英語名にフォールバック。';
