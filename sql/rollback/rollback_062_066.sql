-- 段階A〜C の本番適用の切り戻し (緊急時のみ・承認のうえで実行)。未実行。
-- 前提: アプリを先に段階C の前のデプロイへ戻す (Vercel の Instant Rollback)。古いアプリは pickup_requests・
--       変更申請の新しい列・施設台帳を使わないので、DB を戻すのはアプリを戻した後でよい。
-- 戻す順番は適用の逆: 066 → 064 → 065 → 062。各ブロックは単独でも実行できる。
-- データは消す前に *_rollback_backup に写す (後で調べる・やり直すため)。

begin;

-- ── 066: 変更受付締切を元の値に戻す
update public.shipments s set change_deadline_at = b.change_deadline_at
  from public.change_deadline_backup_066 b where b.shipment_id = s.id;

-- ── 064: トリガー・関数を外し、変更申請の表を元の形に戻す
drop trigger if exists shipments_pickup_lock on public.shipments;
drop trigger if exists shipment_change_requests_guard on public.shipment_change_requests;
create table if not exists public.shipment_change_requests_rollback_backup as
  select * from public.shipment_change_requests where kind not in ('fields', 'correction');
-- 段階C の申請 (kind つき) は旧画面で扱えないので、未処理のものは却下扱いにして残す
update public.shipment_change_requests set status = 'rejected', decision_note = coalesce(decision_note, '') || ' [切り戻しで却下扱い]'
 where kind not in ('fields', 'correction') and status = 'pending';
drop function if exists public.apply_shipment_change(uuid, text);
drop function if exists public.step_shipment_change(uuid, text, text, text, text, text);
drop function if exists public.create_shipment_change(uuid, text, jsonb, text, text, text, text);
drop function if exists public.shipments_pickup_lock();
drop function if exists public.shipment_change_requests_guard();
drop function if exists public.pickup_locked_changes(public.shipments, public.shipments);
drop function if exists public.change_kind_allowed_keys(text);
drop function if exists public.pickup_number_in_use(text, uuid);
drop index if exists public.shipment_change_requests_one_open_per_leg;
drop index if exists public.shipment_change_requests_pickup_idx;
alter table public.shipment_change_requests
  drop constraint if exists shipment_change_requests_kind_check,
  drop constraint if exists shipment_change_requests_stage_check,
  drop constraint if exists shipment_change_requests_policy_check,
  drop column if exists kind, drop column if exists stage, drop column if exists pickup_request_id,
  drop column if exists needs_sagawa, drop column if exists requested_actor,
  drop column if exists contact_note, drop column if exists contacted_by, drop column if exists contacted_at,
  drop column if exists answer_note, drop column if exists answered_by, drop column if exists answered_at,
  drop column if exists number_policy, drop column if exists new_shipping_number, drop column if exists old_shipping_number,
  drop column if exists old_tracking_numbers, drop column if exists old_tracking_detail, drop column if exists large_lot,
  drop column if exists hotel_change_id, drop column if exists apply_txid, drop column if exists applied_by,
  drop column if exists applied_at, drop column if exists updated_at;

-- ── 065: 施設台帳 (どこからも使っていない。中身は写してから消す)
create table if not exists public.facilities_rollback_backup as select * from public.facilities;
create table if not exists public.facility_checks_rollback_backup as select * from public.facility_checks;
drop table if exists public.facility_checks cascade;
drop table if exists public.facility_place_ids cascade;
drop table if exists public.facility_source_records cascade;
drop table if exists public.survey_regions cascade;
drop table if exists public.facilities cascade;
drop table if exists public.facility_settings cascade;
drop function if exists public.facility_register_place(text);
drop function if exists public.facility_link_place(uuid, text, text);
drop function if exists public.facility_register_residence(text, text, text);
drop function if exists public.facility_set_status(uuid, text, text, text, text, text, jsonb, text, text, text);
drop function if exists public.facility_gate(text, text);
drop function if exists public.facility_gate_residence(text, text);
drop function if exists public.b2c_facility_status(text);
drop function if exists public.facilities_status_guard();
drop function if exists public.facility_checks_guard();
drop function if exists public.facility_checks_immutable();

-- ── 062: 集荷依頼の記録 (古いアプリは使わない。区間の依頼済み印・番号はそのまま残る)
create table if not exists public.pickup_requests_rollback_backup as select * from public.pickup_requests;
drop function if exists public.claim_pickup_request(uuid, text, text, text, int, date, text, text, text);
drop function if exists public.transition_pickup_request(uuid, text[], text, text, text, text, text, jsonb, text, text, jsonb);
drop function if exists public.pickup_snapshot_json(public.shipments);
drop table if exists public.pickup_requests;

commit;

-- 確認 (結果を記録する)
select 'triggers' k, count(*) from pg_trigger where tgname in ('shipments_pickup_lock', 'shipment_change_requests_guard')
union all select 'pickup_requests table', count(*) from information_schema.tables where table_name = 'pickup_requests'
union all select 'scr new columns', count(*) from information_schema.columns where table_name = 'shipment_change_requests' and column_name in ('kind', 'stage');
