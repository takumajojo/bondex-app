-- 個数変更の監査ログ。
-- 集荷時に「受付個数 ≠ 実個数」（例 3個→2個）や「預かれず 0個＝区間キャンセル」が
-- 起きたとき、いつ・何個→何個・理由 を記録する（誰が は現状 operator 単独運用のため未記録・将来拡張可）。
-- 各要素の形:
--   { "at": ISO文字列, "from": 数値, "to": 数値, "reason": "mismatch|not_collected|customer_change|other",
--     "note": 文字列, "cancelled": bool, "old_amount": 数値, "new_amount": 数値, "was_charged": bool }
alter table shipments
  add column if not exists count_change_log jsonb not null default '[]'::jsonb;
