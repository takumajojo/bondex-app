-- 042: キャンセルの監査証跡
--
-- 背景: 2026-09-16 に BDX-VT3WBN が cancelled になった際、「誰が・どの経路で
-- 取り消したか」が DB に一切残っておらず、代理店の自己取消か運営操作かを即断
-- できなかった。以後は取り消しのたびに必ず記録し、推測ゼロで判別できるようにする。
--
-- cancel_source: 'agency'（代理店ポータルのセルフ取消）
--                'operator'（運営ダッシュボードの操作・個数調整での区間キャンセル）
--                'system'（自動処理）
-- cancelled_by:  実行主体の識別子（代理店名 / 'operator' など）
-- cancelled_at:  取り消し時刻

alter table shipments
  add column if not exists cancelled_at   timestamptz,
  add column if not exists cancelled_by   text,
  add column if not exists cancel_source  text;

-- 既知の実績の遡及記録: BDX-VT3WBN は代理店(Discovery Hidden Japan)の自己取消と本人確認済み。
update shipments
set cancelled_at  = updated_at,
    cancelled_by  = 'Discovery Hidden Japan株式会社 / Ed Williams',
    cancel_source = 'agency'
where booking_id = 'BDX-VT3WBN'
  and status = 'cancelled'
  and cancel_source is null;
