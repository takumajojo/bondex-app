-- 佐川の運賃照会CSV（実支払い）から取り込む「区間ごとの実原価（税抜・円）」。
--
-- 背景(2026-10-21 谷口さん): 実績レポートの佐川原価は運賃表からの概算。運賃改定(10/21)前後や
-- 実際の請求差を正確に見るため、佐川の運賃照会CSVの「合計」を区間に取り込んで実原価として持つ。
-- レポートは「実原価があれば実原価、無ければ運賃表概算」で粗利を出す。
--
-- 追加のみ。NULL=未取込（概算を使う）。

alter table shipments add column if not exists sagawa_cost_actual_yen integer;

comment on column shipments.sagawa_cost_actual_yen is
  '佐川の運賃照会CSVから取り込んだ実原価(税抜・円/区間合計)。NULL=未取込(レポートは運賃表概算を使用)。';
