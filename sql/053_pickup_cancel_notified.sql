-- BondEx — 佐川への「集荷取消」連絡の記録（pickup_cancel_notified_at）
--
-- 佐川へ集荷依頼済み（pickup_requested_at あり）の区間が後からキャンセルされた場合、
-- 佐川へ集荷中止の連絡が必要。今日のTODOに「佐川 集荷取消」として出し、
-- 運用担当が「取消連絡済み」を押したらこの列に時刻を入れて TODO から消す。
--
-- null = 未連絡（対象なら TODO に出る）。
-- 適用状況: 未適用。コードのデプロイ前に本番 Supabase の SQL Editor で実行すること。

alter table shipments
  add column if not exists pickup_cancel_notified_at timestamptz;

comment on column shipments.pickup_cancel_notified_at is
  '集荷依頼済み区間のキャンセル時、佐川へ集荷取消を連絡した時刻。null=未連絡。';
