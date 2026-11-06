-- Excel の照合 (scripts/pickup-request/check-excel-rows.ts) 専用の読み取りだけの役割 (2026-11-07・未適用・適用は谷口さんの承認の後)。
-- 運営の端末に service_role の鍵 (書き込みもできる・RLS を通らない) を置かずに照合するためのもの。
--
-- 役割 bondex_excel_reader は表を直接読めない。読めるのは関数 excel_check_snapshot だけ:
--   表を直接読ませると、RLS で見えない行が「無い」ことになり、依頼済みの区間を「依頼なし」と誤って OK にしうる。
--   関数は定義者の権限で全部の行を読み、照合に要る列だけを返す (書き込みは無い・STABLE)。
-- 前提: 067 (pickup_requests)・068 (shipment_change_requests の stage・kind) の適用の後 (2026-11-07 の本番には pickup_requests が無い)。
-- 鍵: Supabase のゲートウェイは apikey に anon・service_role の鍵しか受け付けない。この役割の鍵 (role=bondex_excel_reader・exp 必須) は
--   Authorization: Bearer で送る。旧来の JWT の秘密 (HS256) で作る (本番は 2026-11-07 時点で旧来の方式)。
-- 戻し方: 末尾の「戻し方」を流す。

begin;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'bondex_excel_reader') then
    create role bondex_excel_reader nologin noinherit;
  end if;
end $$;

-- PostgREST (authenticator) がこの役割に切り替えられるようにする (鍵の role がこの名前の時だけ)
grant bondex_excel_reader to authenticator;
-- anon (3s)・authenticated (8s) と同じく、長い問い合わせを止める
alter role bondex_excel_reader set statement_timeout = '8s';
grant usage on schema public to bondex_excel_reader;

create or replace function public.excel_check_snapshot(p_booking_ids text[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with legs as (
    select s.id, s.booking_id, s.leg_index, s.status, s.tracking_numbers, s.pickup_requested_at,
           s.suitcase_count, s.shipment_date, s.expected_arrival
    from shipments s
    where s.booking_id = any(coalesce(p_booking_ids, '{}'::text[]))
  )
  select jsonb_build_object(
    'complete', true,
    'legs', coalesce((select jsonb_agg(to_jsonb(l)) from legs l), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r)) from pickup_requests r where r.shipment_id in (select id from legs)), '[]'::jsonb),
    'open_changes', coalesce((
      select jsonb_agg(jsonb_build_object('shipment_id', c.shipment_id, 'kind', c.kind, 'stage', c.stage))
      from shipment_change_requests c
      where c.shipment_id in (select id from legs)
        and c.stage in ('requested', 'contacted', 'approved')
        and c.kind is distinct from 'correction'
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.excel_check_snapshot(text[]) from public, anon, authenticated;
grant execute on function public.excel_check_snapshot(text[]) to bondex_excel_reader, service_role;
-- 本番の public では、新しい関数に anon・authenticated の実行の権限が自動で付く (pg_default_acl・2026-11-07 の読み取りで確認)。
-- 上の revoke はそのために要る。消さない
notify pgrst, 'reload schema';

commit;

-- 確かめ (読むだけ):
--   select has_function_privilege('bondex_excel_reader', 'public.excel_check_snapshot(text[])', 'execute');  -- true
--   select has_table_privilege('bondex_excel_reader', 'public.shipments', 'select,insert,update,delete');      -- false
--   select has_function_privilege('anon', 'public.excel_check_snapshot(text[])', 'execute');                 -- false
--   select has_function_privilege('authenticated', 'public.excel_check_snapshot(text[])', 'execute');        -- false
--
-- 戻し方:
--   begin;
--   drop function if exists public.excel_check_snapshot(text[]);
--   revoke usage on schema public from bondex_excel_reader;
--   revoke bondex_excel_reader from authenticator;
--   drop role if exists bondex_excel_reader;
--   commit;
