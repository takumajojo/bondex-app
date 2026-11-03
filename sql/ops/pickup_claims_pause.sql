-- 集荷依頼の記録・送信だけを一時停止する (区間のロックはそのまま)。緊急停止用 (例: Biz-Logi の障害・誤送信の疑い)。
-- 手動 (Excel) の記録も止まる。世田谷営業所への依頼は手作業で行い、再開後に記録する。
update public.pickup_request_settings
   set claims_paused = true, paused_reason = '運営による一時停止',
       updated_at = now(), updated_by = 'sql/ops/pickup_claims_pause'
 where id;
