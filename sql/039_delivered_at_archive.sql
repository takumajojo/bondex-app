-- 配達完了して2営業日経った配送をアクティブ一覧から外し、過去履歴で見られるようにする
-- (2026-09-16 谷口さん)。削除はしない。適用済み (Supabase migration delivered_at_for_archive)。
-- delivered_at: 配達完了の時刻。sync-tracking / 手動ステータス変更が記録する。
alter table shipments add column if not exists delivered_at timestamptz;

-- 既存の配達完了は expected_arrival(予定配達日) の正午JSTで補完する。
-- ※updated_at は後続の編集(pickup_ack_at 更新など)で汚染されるため使わない。
update shipments
  set delivered_at = (expected_arrival || 'T12:00:00+09:00')::timestamptz
  where status='delivered' and expected_arrival is not null;

-- アクティブ一覧の除外・過去履歴の抽出は listShipments が行う
-- (基準=配達完了日が2営業日前以前 → delivered_at < (2営業日前+1日)0時JST)。
