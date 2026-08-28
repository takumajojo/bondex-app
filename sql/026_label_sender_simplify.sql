-- 026: 差出人の選択肢から業種カテゴリーを廃止する
--
-- 025 では差出人を「ランドオペレーター / 旅行代理店」と業種で分けていたが、
-- 実務で必要なのは「封筒にどの名前が載るか」だけで、相手の業種は関係ない
-- (谷口さん 2026-08-28)。カテゴリーを外し、名義の3択に整理する。
--
--   land_operator → agency (御社名義・代理店マスタの ship_address を使う)
--   travel_agent  → other  (他社名義・依頼ごとに名称と住所を入力)
--   bondex        → 変更なし (BondEx 名義・既定)
--
-- 適用時点の実データは全5行が既定値 (bondex/agency) のため、値の移行は無害。

alter table public.shipments
  drop constraint if exists shipments_label_sender_check;

update public.shipments set label_sender = 'agency' where label_sender = 'land_operator';
update public.shipments set label_sender = 'other'  where label_sender = 'travel_agent';

alter table public.shipments
  add constraint shipments_label_sender_check
  check (label_sender in ('bondex', 'agency', 'other'));

comment on column public.shipments.label_sender is
  '送り状を郵送する際の差出人: bondex=BondEx名義 / agency=御社名義(登録済みの発送先住所) / other=他社名義(依頼ごとに入力)';
comment on column public.shipments.label_sender_info is
  '差出人の名称・住所 (ResidenceAddress 形)。other のとき必須。agency は発送時点のスナップショット。';
