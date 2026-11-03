-- 集荷依頼の記録・送信の一時停止を解く。区間のロックが有効なときだけ解ける (無効なら何も変えずにエラー)。
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.shipments'::regclass and tgname = 'shipments_pickup_lock' and tgenabled = 'O') then
    raise exception '区間のロックが無効です。先に sql/072 を実行してください';
  end if;
  update public.pickup_request_settings
     set claims_paused = false, paused_reason = null, updated_at = now(), updated_by = 'sql/ops/pickup_claims_resume'
   where id;
end $$;
