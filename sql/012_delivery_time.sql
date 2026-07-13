-- BondEx — 配達時間帯 (delivery_time) を shipments に保存
--
-- これまで配達時間帯は発行時に Ship&co へ送るだけで DB には残していなかった。
-- 代理店の「発行依頼」で希望の配達時間帯を受け取り、発行時に BondEx が参照できるよう
-- shipments に保存する。値は lib/yamato-delivery.ts の DELIVERY_TIME_SLOTS のいずれか。

alter table shipments
  add column if not exists delivery_time text;

comment on column shipments.delivery_time is
  'ヤマトお届け時間帯 (not-specified/before-noon/before-ten/before-five/14-16/16-18/18-20/19-21)。代理店の希望値。発行時に参照。';
