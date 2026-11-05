#!/usr/bin/env bash
# B1（規約の版・同意の記録・未集荷・締切）の DB 試験。ローカルの PostgreSQL の試験専用データベースだけ（本番・Supabase には接続しない）。
#   実行: bash scripts/test-b2c/db/b1_legal_db.sh   （Supabase CLI のローカル DB コンテナ supabase_db_supa-local を使う）
#   他の作業と DB を分けるため、既定のデータベースは bondex_b1legal_test（B1_TEST_DB で変えられる）。終わったら消す。
# 確かめること:
#   L. sql/079: 規約の本文は追記だけ・本文と SHA-256 の一致・権限・再実行・既存の行の写し・確定にはカードの同意が要る・請求の前の確認
#   M. D1: 旅行者の予約の区間が未集荷のアラートの対象になる（集荷日の 18:00 以降）・二重に通知しない・集荷の確認が無ければ請求の行を作らない
#   N. D0: DB の締切 18:30（確定・取消の判定）
set -uo pipefail
R="$(cd "$(dirname "$0")/../../.." && pwd)"
C=supabase_db_supa-local; DB=${B1_TEST_DB:-bondex_b1legal_test}
PASS=0; FAIL=0
q() { docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qtA "$@"; }
apply() { for f in "$@"; do q -1 < "$R/$f" >/dev/null 2>/tmp/b1legal_err.txt || { echo "  適用失敗: $f"; grep -m3 ERROR /tmp/b1legal_err.txt; FAIL=$((FAIL+1)); return 1; }; done; }
eq() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (期待: $2 / 実際: $3)"; fi; }
err_has() { local out; out=$(q -c "$2" 2>&1); if echo "$out" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 ($out)"; fi; }

# 接続先の確認: ローカルのコンテナであること
HOST=$(docker exec -i $C psql -U postgres -d postgres -tAc "select coalesce(inet_server_addr()::text, 'local-socket')")
case "$HOST" in 127.*|172.*|10.*|192.168.*|local-socket|::1) ;; *) echo "refusing: not a local address ($HOST)"; exit 1;; esac

docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
q -c "grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" >/dev/null
apply scripts/test-b2c/db/000_base_from_prod.sql sql/043_shipment_change_requests.sql sql/033_hotel_change_schema.sql sql/063_fix_hotel_change_tracking_column.sql
EXPAND=(sql/067_pickup_requests.sql sql/069_facilities.sql sql/068_change_requests_pickup_lock.sql sql/061_b2c_mvp.sql sql/062_b2c_stage4.sql sql/073_b2c_outbox_hardening.sql sql/071_b2c_cutoff_1830.sql sql/074_b2c_stage5_payments.sql sql/075_pickup_watch_alerts.sql sql/076_agency_change_atomic.sql sql/077_operator_email_code_attempts.sql sql/078_pickup_customer_numbering.sql)
apply "${EXPAND[@]}"

q -c "insert into b2c_entry_links (referrer_code, referrer_name, token_hash) values ('HKU','Hankyu','t-$RANDOM');
      insert into b2c_facilities (place_id,name,status,checked_by,last_verified_at) values ('P1','H1','verified','op',now()),('P2','H2','verified','op',now()) on conflict do nothing;" >/dev/null
# 予約（カード登録済み）。$1 = 集荷日のオフセット(日)、$2 = 追加の列（"col1, col2" と "val1, val2"）
order() {
  local cols=${2:-} vals=${3:-}
  q -c "insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot,
          pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode, card_status, consent_version, consented_at, access_token_hash, stripe_customer_id, stripe_payment_method_id $cols)
        select id,'HKU','Guest','g@example.com','+819000000000','P1','P2',
          jsonb_build_object('name','H1','check_in',(current_date)::text),
          jsonb_build_object('name','H2','check_in',(current_date+$1)::text,'check_out',(current_date+$1+5)::text),
          current_date+$1,current_date+$1+1,2,'standard',4980,9960,996,10956,'v1','card_pending','instant','registered','2026-11-phase1a-draft',now(),md5(random()::text),'cus_test','pm_test' $vals
        from b2c_entry_links limit 1 returning id" | head -1
}

echo "L0. 079 の前の予約（カード登録の時に同意の版が上書きされていた形）"
O_OLD_CARD=$(order 5)
q -c "update b2c_orders set consent_version='2026-11-phase1a-card-draft' where id='$O_OLD_CARD'" >/dev/null
O_OLD_CONF=$(order 6); q -c "select b2c_confirm_order('$O_OLD_CONF')" >/dev/null
eq "079 の前に確定した予約がある（カードの同意の列が無い時代の行）" confirmed "$(q -c "select status from b2c_orders where id='$O_OLD_CONF'")"

echo "V0. 新しいアプリ × 079 の前の DB（アプリを先に出してしまった場合）"
err_has "新しいアプリの予約の書き込み（terms_version）は 079 の前の DB では失敗する（中途半端な予約を作らない）" "insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, confirmation_mode, access_token_hash, terms_version) select id,'HKU','G','g@example.invalid','+819000000000','P1','P2','{}','{}',current_date+5,current_date+6,1,'standard',4980,4980,498,5478,'v1','instant','tok_v0','x' from b2c_entry_links limit 1" "terms_version"
eq "その時、予約は 1件も増えていない" "2" "$(q -c "select count(*) from b2c_orders")"

echo "V1. 079 の途中で失敗した場合（1つのトランザクション）"
(cat "$R/sql/079_b2c_legal_versions.sql"; echo "select 1/0; -- 途中の失敗の再現") | q -1 >/dev/null 2>&1
eq "途中で失敗すると何も変わらない（表・列・関数とも元のまま）" "f|0|f" "$(q -c "select (to_regclass('public.b2c_legal_documents') is not null)||'|'||(select count(*) from information_schema.columns where table_name='b2c_orders' and column_name='card_consent_version')||'|'||(select prosrc like '%no_card_consent%' from pg_proc where proname='b2c_charge_check')" | sed 's/false/f/g; s/true/t/g')"

echo "L. sql/079 規約の版と同意の記録"
apply sql/079_b2c_legal_versions.sql && eq "079 を適用できる" ok ok
apply sql/079_b2c_legal_versions.sql && eq "079 を2回流しても失敗しない" ok ok
eq "上書きされていた行は、カードの同意の列へ写す" "2026-11-phase1a-card-draft|true" "$(q -c "select card_consent_version||'|'||(card_consented_at is not null) from b2c_orders where id='$O_OLD_CARD'")"
eq "予約の時の規約の版が残っていない行は空のまま（推測で埋めない）" "" "$(q -c "select coalesce(terms_version,'') from b2c_orders where id='$O_OLD_CARD'")"
eq "079 の前に確定した行は制約に引っかからない（NOT VALID・既存の行は確かめない）" confirmed "$(q -c "select status from b2c_orders where id='$O_OLD_CONF'")"
eq "b2c_charge_check は 079 の版（カードの同意を確かめる）" t "$(q -c "select prosrc like '%no_card_consent%' from pg_proc where proname='b2c_charge_check'")"
eq "カードの同意が無い確定の予約は請求しない (no_card_consent)" no_card_consent "$(q -c "select b2c_charge_check(jsonb_populate_record(null::b2c_payments, jsonb_build_object('order_id','$O_OLD_CONF')))")"

npx --prefix "$R" tsx "$R/scripts/b2c-legal/register-docs.ts" > /tmp/b1legal_register.sql 2>/dev/null
q < /tmp/b1legal_register.sql >/dev/null 2>/tmp/b1legal_err.txt; eq "今の版の本文 12行を登録できる" "12" "$(q -c "select count(*) from b2c_legal_documents")"
q < /tmp/b1legal_register.sql >/dev/null 2>&1; eq "同じ登録を2回流しても増えない・止まらない（本文が同じ）" "12" "$(q -c "select count(*) from b2c_legal_documents")"
eq "日本語・英語 × 規約・キャンセル規定・特商法・プライバシー・予約の同意・カードの同意" "en:6|ja:6" "$(q -c "select string_agg(lang||':'||n, '|' order by lang) from (select lang, count(*) n from b2c_legal_documents group by lang) x")"
err_has "本文の書き換えはできない" "update b2c_legal_documents set body = body || 'x', sha256 = encode(sha256(convert_to(body || 'x','UTF8')),'hex') where kind='terms' and lang='ja'" "追記だけ"
err_has "本文の削除はできない" "delete from b2c_legal_documents where kind='terms'" "追記だけ"
err_has "表ごとの消去 (truncate) もできない" "truncate b2c_legal_documents" "追記だけ"
err_has "本文と SHA-256 が合わない行は入らない" "insert into b2c_legal_documents (version, kind, lang, body, sha256) values ('x1','terms','ja','abc', repeat('0',64))" "b2c_legal_documents_sha256_matches"
err_has "知らない種類は入らない" "insert into b2c_legal_documents (version, kind, lang, body, sha256) values ('x1','faq','ja','abc', encode(sha256(convert_to('abc','UTF8')),'hex'))" "check constraint"
# 登録済みの本文と、流そうとしている本文が違う場合（版を上げずに本文を変えた）: 確かめの段で止まること
python3 -c "import re,sys; s=open('/tmp/b1legal_register.sql').read(); i=s.index('do \$\$ begin'); t=s[i:]; t=re.sub(r\"(kind = 'terms' and lang = 'ja'\\) is distinct from ')[0-9a-f]{64}\", lambda m: m.group(1)+'0'*64, t, count=1); open('/tmp/b1legal_tamper.sql','w').write(s[:i]+t)"
TAMPER=$(q < /tmp/b1legal_tamper.sql 2>&1 | grep -c "本文が登録済みの版と違います" || true)
eq "登録済みの版と違う本文を流すと止まる（版を上げずに本文を変えない）" 1 "$TAMPER"
eq "サーバー (service_role) は読み・追記だけ（書き換え・削除の権限なし）" "true|true|false|false" "$(q -c "select has_table_privilege('service_role','b2c_legal_documents','select')||'|'||has_table_privilege('service_role','b2c_legal_documents','insert')||'|'||has_table_privilege('service_role','b2c_legal_documents','update')||'|'||has_table_privilege('service_role','b2c_legal_documents','delete')")"
eq "旅行者の側 (anon・authenticated) は読めない" "false|false" "$(q -c "select has_table_privilege('anon','b2c_legal_documents','select')||'|'||has_table_privilege('authenticated','b2c_legal_documents','select')")"

O_NEW=$(order 5 ", terms_version, terms_lang, terms_consented_at" ", '2026-11-phase1a-draft', 'en', now()")
err_has "カードの同意が無い予約は確定できない（新しい行）" "select b2c_confirm_order('$O_NEW')" "b2c_orders_card_consent_chk"
q -c "update b2c_orders set card_consent_version='2026-11-phase1a-card-draft', card_consented_at=now() where id='$O_NEW'" >/dev/null
eq "カードの同意がそろえば確定できる" t "$(q -c "select b2c_confirm_order('$O_NEW')")"
eq "予約から、同意した規約の本文（英語）を引ける" "true|true" "$(q -c "select (d.body like '%Terms of Service%')||'|'||(d.sha256 = encode(sha256(convert_to(d.body,'UTF8')),'hex')) from b2c_orders o join b2c_legal_documents d on d.version=o.terms_version and d.lang=o.terms_lang and d.kind='terms' where o.id='$O_NEW'")"
eq "予約から、カード登録の同意の文言を引ける（少ない個数の請求・集荷されなければ請求しない、を含む）" "true|true" "$(q -c "select (d.body like '%if fewer%')||'|'||(d.body like '%not picked up, we do not charge%') from b2c_orders o join b2c_legal_documents d on d.version=o.card_consent_version and d.lang=o.terms_lang and d.kind='card_consent' where o.id='$O_NEW'")"
eq "予約の時の版の本文は、後で新しい版を足しても変わらない" "1" "$(q -c "insert into b2c_legal_documents (version, kind, lang, body, sha256) values ('2027-01-v1','terms','en','new terms', encode(sha256(convert_to('new terms','UTF8')),'hex')); select count(*) from b2c_orders o join b2c_legal_documents d on d.version=o.terms_version and d.lang=o.terms_lang and d.kind='terms' where o.id='$O_NEW' and d.body like '%[DRAFT v3]%'")"

echo "V2. 古いアプリ × 079 の後の DB（移行の間・B2C は OFF のまま流す理由）"
O_OLDAPP=$(order 5)
q -c "update b2c_orders set consent_version='2026-11-phase1a-card-draft', consented_at=now() where id='$O_OLDAPP'" >/dev/null  # 古いアプリのカード登録（同意の版を上書き）
err_has "古いアプリでカード登録した予約は確定できない（同意の記録が無いまま請求の対象にしない）" "select b2c_confirm_order('$O_OLDAPP')" "b2c_orders_card_consent_chk"
eq "その予約は配送データを作らない" 0 "$(q -c "select count(*) from shipments where b2c_order_id='$O_OLDAPP'")"
O_OLDDRAFT=$(order 5)
eq "古いアプリの予約の下書き（新しい列なし）は書ける" "card_pending" "$(q -c "select status from b2c_orders where id='$O_OLDDRAFT'")"

echo "V3. B2B への影響が無い"
B2B=$(q -c "insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, status, suitcase_count, agency, representative, recipient) values ('BDX-B1V3',0,current_date+3,current_date+4,'A','B','issued',2,'AG','R','R') returning id" | head -1)
q -c "update shipments set status='picked_up' where id='$B2B'" >/dev/null && q -c "update shipments set status='delivered', charged_at=now() where id='$B2B'" >/dev/null
eq "B2B の区間の作成・集荷・配達・課金の記録は 079 の後も変わらない" "delivered|t|b2b" "$(q -c "select status||'|'||(charged_at is not null)||'|'||coalesce(channel,'b2b') from shipments where id='$B2B'" | sed 's/true/t/')"
eq "079 は B2B の表（shipments）に列も制約も足していない" "0" "$(q -c "select count(*) from information_schema.columns where table_name='shipments' and column_name like '%consent%'")"

echo "M. D1 未集荷（旅行者の予約の区間）"
O_MISS=$(order 3 ", terms_version, terms_lang, terms_consented_at, card_consent_version, card_consented_at" ", '2026-11-phase1a-draft','ja', now(), '2026-11-phase1a-card-draft', now()")
q -c "select b2c_confirm_order('$O_MISS')" >/dev/null
S_MISS=$(q -c "select id from shipments where b2c_order_id='$O_MISS'")
q -c "update shipments set shipment_date = current_date where id='$S_MISS'" >/dev/null  # 集荷日の夕方になった（集荷の確認が無いまま）
# lib/shipments-db.ts listPickupMisses と同じ条件
MISS_SQL="select count(*) from shipments where status in ('requested','pending','issued') and shipment_date <= current_date and pickup_alert_sent_at is null and id='$S_MISS'"
eq "旅行者の予約の区間は issued で作られ、未集荷の対象になる" "issued|1" "$(q -c "select status from shipments where id='$S_MISS'")|$(q -c "$MISS_SQL")"
eq "区間の情報: 経路 b2c・代理店名は BondEx Direct（代理店へのメールの宛先にならない名前）" "b2c|BondEx Direct" "$(q -c "select channel||'|'||agency from shipments where id='$S_MISS'")"
q -c "update shipments set pickup_alert_sent_at = now() where id='$S_MISS'" >/dev/null  # markPickupAlerted と同じ
eq "通知した区間は次の回に対象にならない（二重に通知しない）" 0 "$(q -c "$MISS_SQL")"
eq "集荷の確認が無いので、請求の行は無い" 0 "$(q -c "select count(*) from b2c_payments where order_id='$O_MISS'")"
eq "集荷の確認の記録も無い" 0 "$(q -c "select count(*) from b2c_pickup_confirmations where order_id='$O_MISS'")"

echo "N. D0 締切 18:30（DB）"
eq "締切は集荷の前日 18:30 JST" "18:30" "$(q -c "select to_char(pickup_cutoff_at(current_date+5) at time zone 'Asia/Tokyo','HH24:MI')")"
eq "18:29:59 は締切前・18:30:00 は締切後" "false|true" "$(q -c "select (timestamptz '2026-11-13 09:29:59+00' >= pickup_cutoff_at('2026-11-14'))||'|'||(timestamptz '2026-11-13 09:30:00+00' >= pickup_cutoff_at('2026-11-14'))")"
O_PAST=$(order 0 ", terms_version, terms_lang, terms_consented_at, card_consent_version, card_consented_at" ", '2026-11-phase1a-draft','ja', now(), '2026-11-phase1a-card-draft', now()")
eq "締切を過ぎた予約は DB が確定しない" f "$(q -c "select b2c_confirm_order('$O_PAST')")"

echo "R. 切り戻し (sql/rollback/rollback_079.sql)"
apply sql/rollback/rollback_079.sql && eq "切り戻しを流せる・同意の記録と本文は残る" "t|t" "$(q -c "select count(*)>0 from b2c_legal_documents")|$(q -c "select count(*)>0 from b2c_orders where card_consent_version is not null")"
apply sql/079_b2c_legal_versions.sql && eq "切り戻しの後に 079 を流し直せる" ok ok

docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" >/dev/null 2>&1
echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
