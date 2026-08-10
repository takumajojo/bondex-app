-- BondEx — 個人宅（ホテル以外）の配送元/配送先住所を shipments に保存
--
-- これまで発送元・お届け先はホテル名を Google Places で解決する前提だった。個人宅は
-- 検索に出ないため、代理店が構造化フィールド（氏名/電話/郵便番号/都道府県/市区町村/
-- 番地/建物）で直接入力する。その内容を jsonb で保存し、①即発行 ②1ヶ月前の運営再発行
-- ③バウチャー住所表示 で参照する。null = ホテル（従来どおり Places 解決）。
--
-- jsonb の形（lib/residence.ts ResidenceAddress）:
--   { name, phone, zip, prefecture, city, street, building }

alter table shipments
  add column if not exists from_residence jsonb,
  add column if not exists to_residence jsonb;

comment on column shipments.from_residence is
  '発送元が個人宅のときの構造化住所 (lib/residence.ts ResidenceAddress)。null=ホテル。';
comment on column shipments.to_residence is
  'お届け先が個人宅のときの構造化住所 (lib/residence.ts ResidenceAddress)。null=ホテル。';
