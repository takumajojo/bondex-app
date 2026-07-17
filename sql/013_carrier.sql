-- BondEx — 配送キャリア (佐川 / ヤマト) を shipments に保存
--
-- BondEx はスーツケース配送で佐川を主軸にする (安価)。発行時にキャリアを選び、
-- どちらで発行したかを記録する。既定は 'sagawa'。値は lib/carrier.ts の Carrier。

alter table shipments
  add column if not exists carrier text not null default 'sagawa';

comment on column shipments.carrier is '配送キャリア (sagawa=佐川 / yamato=ヤマト)。既定=佐川。';
