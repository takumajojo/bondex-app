-- whatsapp_processed に RLS を有効化 (2026-10-07)。sql/045 でテーブル作成時に付け忘れていたため、
-- public スキーマで RLS 無効＝URL(anon)を知れば誰でも read/edit/delete 可能な状態だった。
-- Supabase Security Advisor の rls_disabled_in_public (ERROR) を解消する。
--
-- webhook (app/api/whatsapp/webhook) は getSupabase()=service_role で書き込む (RLS バイパス) ため
-- 動作に影響なし。anon/公開アクセスのみ遮断される。ポリシーは作らない
-- (= service_role 以外は全拒否。他の内部テーブル shipment_change_requests 等と同じ方針)。
-- ※本番には適用済み。記録・新規DB構築のため冪等に残す。
alter table public.whatsapp_processed enable row level security;
