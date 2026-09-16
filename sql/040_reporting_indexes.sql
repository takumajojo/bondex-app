-- レポート/検索を件数が増えても速く保つためのインデックス (2026-09-16 谷口さん)。
-- 適用済み (Supabase migration reporting_indexes)。
-- 軸: どの代理店(agency) いつ(picked_up_at=集荷日 / shipment_date=発送日) どこに(to_prefecture) 何個。
create index if not exists idx_shipments_agency on shipments (agency);
create index if not exists idx_shipments_shipment_date on shipments (shipment_date);
create index if not exists idx_shipments_picked_up_at on shipments (picked_up_at);
create index if not exists idx_shipments_delivered_at on shipments (delivered_at);
create index if not exists idx_shipments_to_prefecture on shipments (to_prefecture);
create index if not exists idx_shipments_created_at on shipments (created_at);
