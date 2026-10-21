-- 代理店ごとの単価 (税抜・1個あたり) を持たせる。
--
-- 背景 (2026-10-21 谷口さん指示): 契約で単価が代理店ごとに変わる。既定は 4,980円
-- (lib/pricing.ts の PRICING.regularPrice) のまま、代理店ごとに上書きできるようにする。
--
-- NULL = 既定単価 (4,980) を使う。設定があればその代理店の新規作成分からその単価で請求する。
-- 既存便の amount_yen は変更しない (遡及なし)。
-- ツアー別の上書きは別途、作成画面で amount_yen に直接入れる形で対応する (この列は代理店の既定)。

alter table agencies add column if not exists unit_price_yen integer;

comment on column agencies.unit_price_yen is
  '代理店の既定単価 (税抜・円/個)。NULL=全体既定 4,980円。新規作成分の amount_yen 算出に使う。';

-- 値域の軽い担保 (正の値のみ)。NULL は許可。
alter table agencies drop constraint if exists agencies_unit_price_yen_positive;
alter table agencies add constraint agencies_unit_price_yen_positive
  check (unit_price_yen is null or unit_price_yen > 0);
