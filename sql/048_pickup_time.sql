-- BondEx — 集荷時刻（pickup_time）を shipments に保存
--
-- ホテル案件は「チェックアウトまで」で運用できるが、民泊・バケーションレンタル
-- （Airbnb 等）案件ではフロントが無く、集荷時刻の指定が重要。配達時間帯
-- （delivery_time）と対になる集荷時刻を保持し、バウチャーに明示する。
--
-- 形式は自由テキスト（例: "9:30 AM" / "09:30"）。null = 未指定（従来どおり）。

alter table shipments
  add column if not exists pickup_time text;

comment on column shipments.pickup_time is
  '集荷時刻（任意・自由テキスト, 例 "9:30 AM"）。主に民泊/バケーションレンタルで使用。null=未指定。';
