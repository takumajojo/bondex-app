-- BondEx — 代理店の発行依頼(登録)+ Drive リンク提示
--
-- 新モデル (2026-07-10):
--   代理店は /agency/new で旅程を入力して「発行依頼」を登録する。この時点では
--   バウチャーもヤマト送り状も発行しない (Ship&co の従量課金を回避)。status は
--   'requested'。BondEx が後で発行し、書類 (バウチャー + ヤマト伝票) を Google Drive
--   の「予約番号フォルダ」に格納 → その drive_url を予約に登録すると、代理店ポータル
--   にリンクが表示される。
--
--   ヤマト送り状は出荷 1ヶ月前からしか発行できないため、出荷が 1ヶ月以上先の登録には
--   「1ヶ月前になったらまとめてご連絡します」という案内メールを自動送信する
--   (送信部品はアプリ側 /api/agency/booking。DB 変更は不要)。

-- 予約フォルダ (Google Drive) の共有 URL。BondEx が発行後に登録する。
alter table shipments
  add column if not exists drive_url text;

comment on column shipments.drive_url is '書類一式(バウチャー+ヤマト伝票)を格納した Google Drive フォルダの共有URL。代理店ポータルに表示。';

-- status には既存の pending/issued/... に加えて 'requested' (代理店の発行依頼・未発行) を使う。
-- shipments.status には CHECK 制約 (shipments_status_check) があり、そのままだと 'requested'
-- の INSERT が拒否される (saveShipment はエラーを握り潰すため無言で保存されない)。制約を作り直す。
alter table shipments drop constraint if exists shipments_status_check;
alter table shipments add constraint shipments_status_check
  check (status in ('requested','pending','issued','picked_up','in_transit','delivered','failed','cancelled'));
