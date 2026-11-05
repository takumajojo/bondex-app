#!/usr/bin/env bash
# 試験環境（bondex-staging）の確認: 表・RLS・権限・匿名の利用者からの読み取り（公開の API 経由）・079 の決まり・B2B の区間。
# 書き込みを伴う確認は、1つのトランザクションの中で行い、最後に取り消す（試験環境にも残さない）。
# 本番には接続しない（apply.sh と同じ 3重の確認。匿名の鍵と URL も試験環境の ID であることを確かめる）。
set -uo pipefail
cd "$(dirname "$0")/../.."
STAGING_REF=oeucjrmuigtfnwowvzwr
PROD_REF=dscxftwfspgihkszfakk
C=${PSQL_CONTAINER:-supabase_db_supa-local}
get() { grep -E "^$1=" .env.staging.local | head -1 | cut -d= -f2-; }
if [ -n "${REHEARSAL_LOCAL_DB:-}" ]; then
  case "$REHEARSAL_LOCAL_DB" in bondex_stg_*) ;; *) echo "STOP: 予行演習のデータベース名は bondex_stg_*"; exit 1;; esac
  STAGING_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/$REHEARSAL_LOCAL_DB"; STAGING_URL=""; ANON=""
else
  STAGING_DB_URL=$(get STAGING_DB_URL); STAGING_URL=$(get NEXT_PUBLIC_SUPABASE_URL); ANON=$(get NEXT_PUBLIC_SUPABASE_ANON_KEY)
  for v in "$STAGING_DB_URL" "$STAGING_URL"; do
    case "$v" in *"$PROD_REF"*) echo "STOP: 本番の ID"; exit 1;; *"$STAGING_REF"*) ;; *) echo "STOP: 試験環境の ID が無い"; exit 1;; esac
  done
fi
PASS=0; FAIL=0
q() { docker exec -i -e PGURL="$STAGING_DB_URL" "$C" sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -qtA "$@"' psql "$@"; }
eq() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (期待: $2 / 実際: $3)"; fi; }
[ "$(q -c "select ref from staging_guard.marker")" = "$STAGING_REF" ] || { echo "STOP: 試験環境の印が無い"; exit 1; }

echo "1. 表と RLS"
q -F ' | ' -c "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1" > /tmp/staging_tables.txt
eq "public の表の数（本番 23 ＋ 移行で増える表）" "ok" "$( [ "$(wc -l < /tmp/staging_tables.txt | tr -d ' ')" -gt 23 ] && echo ok || echo ng)"
eq "RLS が無効の表は 0" "0" "$(grep -c '| f$' /tmp/staging_tables.txt)"
eq "B2C の表にポリシーは無い（匿名・ログイン利用者は 1行も読めない）" "0" "$(q -c "select count(*) from pg_policies where schemaname='public' and tablename like 'b2c_%'")"
eq "本番と同じポリシー 5つ（B2B の代理店の画面用）だけ" "5" "$(q -c "select count(*) from pg_policies where schemaname='public'")"

echo "2. 関数の実行の権限（匿名・ログイン利用者は B2C・集荷依頼の関数を呼べない）"
# トリガーの関数（直接は呼べない）と、引数から計算するだけの関数（表を読まない・呼んだ人の権限で動く）は除く:
#   pickup_cutoff_at(date) = 集荷日から締切を計算するだけ / pickup_locked_changes(shipments, shipments) = 渡された 2つの行を比べるだけ
ALLOWED="'pickup_cutoff_at','pickup_locked_changes'"
for role in anon authenticated; do
  eq "$role が実行できる b2c_*・pickup_*・legal の関数（トリガーと計算だけの関数を除く）は 0" "0" "$(q -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'b2c\_%' or p.proname like 'pickup\_%' or p.proname like '%legal%') and p.prorettype <> 'trigger'::regtype and p.proname not in ($ALLOWED) and has_function_privilege('$role', p.oid, 'execute')")"
done
eq "例外の 2つは呼んだ人の権限で動く（security definer ではない）" "0" "$(q -c "select count(*) from pg_proc where proname in ($ALLOWED) and prosecdef")"
eq "匿名・ログイン利用者が実行できる security definer の関数は 0（public 全体）" "0" "$(q -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))")"
eq "サーバー（service_role）は B2C の確定・取消・請求の関数を実行できる" "t|t|t|t" "$(q -c "select has_function_privilege('service_role','public.b2c_confirm_order(uuid)','execute')||'|'||has_function_privilege('service_role','public.b2c_cancel_order(uuid,text,text,text,text,text,text)','execute')||'|'||has_function_privilege('service_role','public.b2c_claim_charges(timestamptz,int,text)','execute')||'|'||has_function_privilege('service_role','public.b2c_request_refund(uuid,int,text,text,text)','execute')" | sed 's/true/t/g; s/false/f/g')"
eq "規約の本文の表: 匿名・ログイン利用者は読めない・サーバーは読み・追記だけ" "f|f|t|t|f|f" "$(q -c "select has_table_privilege('anon','public.b2c_legal_documents','select')||'|'||has_table_privilege('authenticated','public.b2c_legal_documents','select')||'|'||has_table_privilege('service_role','public.b2c_legal_documents','select')||'|'||has_table_privilege('service_role','public.b2c_legal_documents','insert')||'|'||has_table_privilege('service_role','public.b2c_legal_documents','update')||'|'||has_table_privilege('service_role','public.b2c_legal_documents','delete')" | sed 's/true/t/g; s/false/f/g')"

echo "3. 公開の API（匿名の鍵）から読めないこと"
if [ -n "$ANON" ]; then
  for t in b2c_orders b2c_payments b2c_legal_documents b2c_entry_links shipments agencies pickup_requests operator_passkeys; do
    out=$(curl -s -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$STAGING_URL/rest/v1/$t?select=*&limit=1")
    eq "匿名で $t を読む → 中身なし（[] か権限なし）" "ok" "$( { [ "$out" = "[]" ] || echo "$out" | grep -q 'permission denied\|"code"'; } && echo ok || echo "$out" | head -c 120)"
  done
  out=$(curl -s -X POST -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"p_order_id":"00000000-0000-0000-0000-000000000000"}' "$STAGING_URL/rest/v1/rpc/b2c_confirm_order")
  eq "匿名で予約の確定の関数（RPC）を呼ぶ → 拒否" "ok" "$(echo "$out" | grep -q 'permission denied\|42501\|PGRST' && echo ok || echo "$out" | head -c 120)"
else
  echo "  （匿名の鍵が .env.staging.local に無いので、公開の API の確認は飛ばした）"
fi

echo "4. 079 の決まりと B2B の区間（1つのトランザクション・最後に取り消す）"
res=$(q <<'SQL' 2>&1
begin;
do $$
declare o uuid; s uuid; ok_b2b text; r text;
begin
  insert into b2c_facilities (place_id, name, status, checked_by, last_verified_at) values ('stg_A','Staging Hotel A','verified','staging@example.invalid',now()), ('stg_B','Staging Hotel B','verified','staging@example.invalid',now()) on conflict do nothing;
  -- 予約（カードの同意なし）→ 確定できない
  insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot,
    pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode,
    card_status, consent_version, consented_at, terms_version, terms_lang, terms_consented_at, access_token_hash)
  select id, 'HNK001', 'Staging Guest', 'staging@example.invalid', '+819000000000', 'stg_A', 'stg_B',
    jsonb_build_object('name','Staging Hotel A','check_in',(current_date+3)::text), jsonb_build_object('name','Staging Hotel B','check_in',(current_date+5)::text,'check_out',(current_date+9)::text),
    current_date+5, current_date+6, 2, 'standard', 4980, 9960, 996, 10956, 'v1', 'card_pending', 'instant', 'registered',
    '2026-11-phase1a-draft', now(), '2026-11-phase1a-draft', 'ja', now(), 'tok_staging_verify'
  from b2c_entry_links limit 1 returning id into o;
  begin
    perform b2c_confirm_order(o);
    raise notice 'R1=NG';
  exception when check_violation then raise notice 'R1=ok';
  end;
  update b2c_orders set card_consent_version='2026-11-phase1a-card-draft', card_consented_at=now() where id=o;
  raise notice 'R2=%', (select b2c_confirm_order(o));
  raise notice 'R3=%', (select count(*) from shipments where b2c_order_id=o and channel='b2c');
  -- 二重請求の防止: 集荷の確認 → 30分の猶予 → 請求の取り出しは 1回だけ（DB の中だけ・Stripe には何も送らない）
  update b2c_orders set stripe_customer_id='cus_staging_dummy', stripe_payment_method_id='pm_staging_dummy' where id=o;
  insert into operator_passkeys(credential_id, public_key, operator_email) values ('staging-verify-cred', '\x00', 'ops-staging@example.invalid') on conflict do nothing;
  raise notice 'R7=%|%', (select b2c_confirm_pickup(o, 'ops-staging@example.invalid', 'staging-verify-cred', 'sagawa_tracking', 'staging-ref', 2, '試験環境の確認', now(), interval '30 minutes')->>'result'), (select status from b2c_payments where order_id=o and kind='base');
  raise notice 'R8=%', (select b2c_confirm_pickup(o, 'ops-staging@example.invalid', 'staging-verify-cred', 'sagawa_tracking', 'staging-ref', 2, '試験環境の確認（2回目）', now(), interval '30 minutes')->>'result');
  raise notice 'R9=%', (select count(*) from b2c_claim_charges(now() + interval '29 minutes', 10, 'staging-w0'));
  raise notice 'R10=%|%', (select count(*) from b2c_claim_charges(now() + interval '31 minutes', 10, 'staging-w1')), (select count(*) from b2c_claim_charges(now() + interval '31 minutes', 10, 'staging-w2'));
  begin
    insert into b2c_payments(order_id, kind, charge_key, amount_yen, scheduled_at, created_by) values (o, 'base', 'base:'||o, 100, now(), 'staging');
    raise notice 'R11=NG';
  exception when unique_violation then raise notice 'R11=ok';
  end;
  -- 規約の本文は書き換えられない
  begin
    update b2c_legal_documents set body = body || 'x' where kind='terms' and lang='ja';
    raise notice 'R4=NG';
  exception when others then raise notice 'R4=ok';
  end;
  raise notice 'R5=%', (select count(*) from b2c_legal_documents where sha256 = encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'));
  -- B2B の区間: 作成・状態の更新・課金の記録（集荷依頼の前なのでロックに当たらない）
  insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, status, suitcase_count, agency, representative, recipient)
    values ('BDX-STGVERIFY', 0, current_date+4, current_date+5, 'A', 'B', 'issued', 2, 'Staging Agency', 'R', 'R') returning id into s;
  update shipments set suitcase_count=3 where id=s;
  update shipments set status='picked_up' where id=s;
  update shipments set status='delivered', charged_at=now() where id=s;
  raise notice 'R6=%', (select status||'|'||suitcase_count||'|'||(charged_at is not null)||'|'||channel from shipments where id=s);
end $$;
rollback;
SQL
)
eq "R1: カードの同意が無い予約は確定できない" "ok" "$(echo "$res" | grep -o 'R1=[a-zA-Z]*' | cut -d= -f2)"
eq "R4: 規約の本文は書き換えられない" "ok" "$(echo "$res" | grep -o 'R4=[a-zA-Z]*' | cut -d= -f2)"
eq "R2: カードの同意がそろえば確定できる" "t" "$(echo "$res" | grep -o 'R2=[a-z]*' | cut -d= -f2)"
eq "R3: 確定で B2C の区間が 1つできる" "1" "$(echo "$res" | grep -o 'R3=[0-9]*' | cut -d= -f2)"
eq "R5: 登録した本文 12行すべてで本文と SHA-256 が一致" "12" "$(echo "$res" | grep -o 'R5=[0-9]*' | cut -d= -f2)"
eq "R7: 集荷の確認 → 請求の行は 30分後の予定（scheduled）" "confirmed|scheduled" "$(echo "$res" | grep -o 'R7=[a-z_|]*' | cut -d= -f2)"
eq "R8: 同じ予約の 2回目の集荷の確認は already_confirmed" "already_confirmed" "$(echo "$res" | grep -o 'R8=[a-z_]*' | cut -d= -f2)"
eq "R9: 29分の時点では請求を取り出さない" "0" "$(echo "$res" | grep -o 'R9=[0-9]*' | cut -d= -f2)"
eq "R10: 31分の時点で 1回だけ取り出し、続けて動かしても 2回目は 0（二重請求なし）" "1|0" "$(echo "$res" | grep -o 'R10=[0-9|]*' | cut -d= -f2)"
eq "R11: 同じ予約の基本料金の請求は 2行目を作れない（DB の一意の制約）" "ok" "$(echo "$res" | grep -o 'R11=[a-zA-Z]*' | cut -d= -f2)"
eq "R6: B2B の区間の作成・個数の変更・集荷・配達・課金の記録は変わらない" "delivered|3|true|b2b" "$(echo "$res" | grep -o 'R6=[^ ]*' | cut -d= -f2)"
eq "確認の後に試験のデータが残っていない（取り消した）" "0|0" "$(q -c "select (select count(*) from b2c_orders where access_token_hash='tok_staging_verify')||'|'||(select count(*) from shipments where booking_id='BDX-STGVERIFY')")"

echo "5. 外部への送信につながる設定が無いこと"
if [ "$(q -c "select count(*) from pg_extension where extname='pg_cron'")" = "1" ]; then JOBS=$(q -c "select count(*) from cron.job"); else JOBS=0; fi
eq "定期の処理（pg_cron）の登録は 0（外部への送信を有効にしない）" "0" "$JOBS"
eq "pg_net（DB からの外部への送信）は入れていない" "0" "$(q -c "select count(*) from pg_extension where extname='pg_net'")"
eq "Vault の秘密（cron_secret など）は 0件" "0" "$(q -c "select count(*) from vault.secrets" 2>/dev/null || echo 0)"
eq "本番の顧客・予約・決済のデータは無い（代理店・区間・B2C の予約が 0件）" "0|0|0" "$(q -c "select (select count(*) from agencies)||'|'||(select count(*) from shipments)||'|'||(select count(*) from b2c_orders)")"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
