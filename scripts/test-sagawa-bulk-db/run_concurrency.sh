#!/usr/bin/env bash
# P1-B 実PostgreSQL 競合テスト — 独立した2接続 (2つの psql バックエンド) による並列実行。
# 本番同等イメージ supabase/postgres:17.11 を隔離起動し、実際の sql/065 を適用して検証する。
# 偽物 (in-memory) ではなく、PostgreSQL の行ロック・ON CONFLICT・条件付きUPDATE を実機で確認する。
#
#   実行:  bash scripts/test-sagawa-bulk-db/run_concurrency.sh   (要 Docker)
#
# 検証内容 (全5シナリオ):
#   S1 同一集荷単位の同時作成   — 素INSERTはunique violation / upsertは1行に収束 (applyGroupPlan 修正)
#   S2 通知claimの同時取得       — 条件付きUPDATEで勝者は1本だけ (claimBulkNotify)
#   S3 Operator連絡済み×再集計   — 再集計はデータ列のみ更新し notified を巻き戻さない (status CAS)
#   S4 予約追加×再集計           — 2つの並行 recompute が収束・メンバー冪等 (upsert)
#   S5 lease期限切れ後の再取得   — 期限切れ pending は再claim可・新鮮は不可
set -uo pipefail

IMG="public.ecr.aws/supabase/postgres:17.11.0.011"
NAME="bondex-p1b-conc-$$"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"   # scripts/test-sagawa-bulk-db/ → リポジトリルート
PASS=0; FAIL=0
U1="00000000-0000-0000-0000-000000000001"

psql() { docker exec -i "$NAME" psql -U postgres -d postgres "$@"; }
val()  { psql -tA -c "$1" 2>/dev/null | tr -d '[:space:]'; }
ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
ng()   { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }
chk()  { if [ "$2" = "$3" ]; then ok "$1 (=$2)"; else ng "$1 (actual=$2 expected=$3)"; fi; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null || { echo "docker が必要です"; exit 2; }

echo "=== 起動: $IMG (隔離コンテナ $NAME) ==="
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMG" >/dev/null || { echo "docker run 失敗"; exit 2; }

# supabase/postgres イメージは初期化中に一度 DB を再起動するため、連続成功＋安定待ちで本起動を待つ。
echo -n "   DB 起動待ち"
streak=0
for i in $(seq 1 90); do
  if psql -tA -c "select 1" >/dev/null 2>&1; then streak=$((streak+1)); else streak=0; fi
  if [ "$streak" -ge 4 ]; then echo " ready"; break; fi
  echo -n "."; sleep 1
  if [ "$i" = "90" ]; then echo " タイムアウト"; exit 2; fi
done

echo "=== スキーマ適用 (prereq + 実 sql/065) ==="
# 初期化直後の再起動タイミングに当たっても落ちないよう、適用はリトライする。
apply() { # apply <file> <label>
  for a in $(seq 1 40); do
    if psql -v ON_ERROR_STOP=1 < "$1" >/dev/null 2>/tmp/apply.err; then return 0; fi
    if grep -qiE "shutting down|starting up|the database system|connection to server" /tmp/apply.err; then sleep 2; continue; fi
    echo "   $2 適用エラー: $(cat /tmp/apply.err)"; return 1
  done
  echo "   $2 適用リトライ上限"; return 1
}
apply "$HERE/prereq.sql" "prereq" || exit 2
if apply "$REPO/sql/065_sagawa_bulk_pickups.sql" "sql/065"; then
  ok "sql/065 が実 PostgreSQL にクリーン適用 (新列 booking_count/is_bulk/is_duplicate 含む)"
else
  ng "sql/065 適用失敗"; exit 2
fi
psql -c "insert into public.shipments(id) values ('11111111-0000-0000-0000-000000000001'),('22222222-0000-0000-0000-000000000002') on conflict do nothing;" >/dev/null

CLAIM_WHERE="(notify_key <> 'KH' OR notify_state = 'idle' OR notify_state = 'failed' OR (notify_state = 'pending' AND notify_claimed_at < now() - interval '10 minutes'))"

echo ""
echo "=== S1: 同一集荷単位の同時作成 (2接続) ==="
psql -c "truncate public.sagawa_bulk_pickups cascade;" >/dev/null
( psql -v ON_ERROR_STOP=1 >/tmp/s1old_a 2>&1 <<SQL
BEGIN;
INSERT INTO public.sagawa_bulk_pickups(hotel_key,key_source,pickup_date,total_pieces,leg_count,member_hash,status)
 VALUES ('pid:OLD','place_id','2026-12-01',20,1,'h','pending');
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 1.0
psql -v ON_ERROR_STOP=1 >/tmp/s1old_b 2>&1 <<SQL
INSERT INTO public.sagawa_bulk_pickups(hotel_key,key_source,pickup_date,total_pieces,leg_count,member_hash,status)
 VALUES ('pid:OLD','place_id','2026-12-01',25,1,'h','pending');
SQL
BRC=$?
wait
if [ "$BRC" != "0" ] && grep -qi "duplicate key" /tmp/s1old_b; then
  ok "[旧挙動実証] 素の INSERT 同時実行は unique violation (→ upsert 修正が必要)"
else
  ng "[旧挙動実証] 期待した unique violation が出ない (brc=$BRC)"
fi

psql -c "truncate public.sagawa_bulk_pickups cascade;" >/dev/null
UPSERT="INSERT INTO public.sagawa_bulk_pickups(hotel_key,key_source,pickup_date,total_pieces,leg_count,member_hash,status) VALUES ('pid:H1','place_id','2026-12-01',%P%,1,'h','pending') ON CONFLICT (hotel_key,pickup_date) DO UPDATE SET total_pieces=excluded.total_pieces;"
( psql -v ON_ERROR_STOP=1 >/tmp/s1_a 2>&1 <<SQL
BEGIN;
${UPSERT/\%P\%/20}
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 1.0
psql -v ON_ERROR_STOP=1 >/tmp/s1_b 2>&1 <<SQL
${UPSERT/\%P\%/25}
SQL
BRC=$?
wait
ARC_OK=$(grep -qiE "error|violation" /tmp/s1_a && echo bad || echo good)
chk "S1 upsert 同時実行: 衝突しても集荷単位は 1 行に収束" "$(val "select count(*) from public.sagawa_bulk_pickups where hotel_key='pid:H1' and pickup_date='2026-12-01';")" "1"
if [ "$BRC" = "0" ] && [ "$ARC_OK" = "good" ]; then ok "S1 upsert 同時実行: 両接続とも例外なし"; else ng "S1 upsert で例外 (brc=$BRC a=$ARC_OK): $(cat /tmp/s1_b)"; fi

echo ""
echo "=== S2: 通知 claim の同時取得 (条件付きUPDATE・2接続) ==="
psql -c "truncate public.sagawa_bulk_pickups cascade;
 insert into public.sagawa_bulk_pickups(id,hotel_key,key_source,pickup_date,total_pieces,leg_count,member_hash,status,notify_state)
 values ('$U1','pid:H2','place_id','2026-12-01',20,1,'h','pending','idle');" >/dev/null
CLAIM="UPDATE public.sagawa_bulk_pickups SET notify_state='pending', notify_key='KH', notify_attempt_owner='%O%', notify_claimed_at=now() WHERE id='$U1' AND $CLAIM_WHERE;"
( psql >/tmp/s2_a 2>&1 <<SQL
BEGIN;
${CLAIM/\%O\%/A}
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 1.0
psql >/tmp/s2_b 2>&1 <<SQL
${CLAIM/\%O\%/B}
SQL
wait
echo "   A tag: $(grep -o 'UPDATE [0-9]*' /tmp/s2_a | tail -1) / B tag: $(grep -o 'UPDATE [0-9]*' /tmp/s2_b | tail -1)"
chk "S2 claim: 勝者は1本だけ (最終 owner=A)" "$(val "select notify_attempt_owner from public.sagawa_bulk_pickups where id='$U1';")" "A"
chk "S2 claim: B の条件付きUPDATE は 0 行 (二重送信しない)" "$(grep -o 'UPDATE [0-9]*' /tmp/s2_b | tail -1)" "UPDATE 0"
chk "S2 claim: A の条件付きUPDATE は 1 行" "$(grep -o 'UPDATE [0-9]*' /tmp/s2_a | tail -1)" "UPDATE 1"

echo ""
echo "=== S3: Operator『連絡済み』× 再集計 の競合 (status lost-update 防止) ==="
psql -c "truncate public.sagawa_bulk_pickups cascade;
 insert into public.sagawa_bulk_pickups(id,hotel_key,key_source,pickup_date,total_pieces,leg_count,member_hash,status)
 values ('$U1','pid:H3','place_id','2026-12-01',10,1,'h','pending');" >/dev/null
psql -c "UPDATE public.sagawa_bulk_pickups SET status='notified', notified_at=now(), notified_by='op' WHERE id='$U1';" >/dev/null
psql -c "UPDATE public.sagawa_bulk_pickups SET total_pieces=99, status='pending' WHERE id='$U1';" >/dev/null
chk "S3 [旧挙動実証] 再集計が status を書くと notified→pending に巻き戻る (lost update)" "$(val "select status from public.sagawa_bulk_pickups where id='$U1';")" "pending"

psql -c "truncate public.sagawa_bulk_pickups cascade;
 insert into public.sagawa_bulk_pickups(id,hotel_key,key_source,pickup_date,total_pieces,leg_count,member_hash,status)
 values ('$U1','pid:H3','place_id','2026-12-01',10,1,'h','pending');" >/dev/null
( psql >/tmp/s3_a 2>&1 <<SQL
BEGIN;
UPDATE public.sagawa_bulk_pickups SET total_pieces=99, leg_count=3, booking_count=2, is_bulk=true WHERE id='$U1';
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 1.0
psql >/tmp/s3_b 2>&1 <<SQL
UPDATE public.sagawa_bulk_pickups SET status='notified', notified_at=now(), notified_by='op' WHERE id='$U1';
SQL
wait
chk "S3 [新挙動] 再集計(データ列のみ)×Operator(notified) 同時 → status=notified を保持" "$(val "select status from public.sagawa_bulk_pickups where id='$U1';")" "notified"
chk "S3 [新挙動] 同時更新でデータ列(total_pieces=99)も反映" "$(val "select total_pieces from public.sagawa_bulk_pickups where id='$U1';")" "99"

echo ""
echo "=== S4: 予約追加 × 再集計 (2つの並行 recompute が収束・メンバー冪等) ==="
psql -c "truncate public.sagawa_bulk_pickups cascade;" >/dev/null
GID_SUB="(SELECT id FROM public.sagawa_bulk_pickups WHERE hotel_key='pid:H4' AND pickup_date='2026-12-01')"
( psql -v ON_ERROR_STOP=1 >/tmp/s4_a 2>&1 <<SQL
BEGIN;
INSERT INTO public.sagawa_bulk_pickups(hotel_key,key_source,pickup_date,total_pieces,leg_count,booking_count,is_duplicate,member_hash,status)
 VALUES ('pid:H4','place_id','2026-12-01',5,1,1,false,'h','pending')
 ON CONFLICT (hotel_key,pickup_date) DO UPDATE SET total_pieces=public.sagawa_bulk_pickups.total_pieces + excluded.total_pieces, leg_count=public.sagawa_bulk_pickups.leg_count + 1;
INSERT INTO public.sagawa_bulk_pickup_members(group_id,shipment_id,booking_id,leg_index,pieces)
 VALUES ($GID_SUB,'11111111-0000-0000-0000-000000000001','BDX-A',0,5)
 ON CONFLICT (group_id,shipment_id) DO UPDATE SET pieces=excluded.pieces, removed_at=null;
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 1.0
psql -v ON_ERROR_STOP=1 >/tmp/s4_b 2>&1 <<SQL
INSERT INTO public.sagawa_bulk_pickups(hotel_key,key_source,pickup_date,total_pieces,leg_count,booking_count,is_duplicate,member_hash,status)
 VALUES ('pid:H4','place_id','2026-12-01',4,1,1,false,'h','pending')
 ON CONFLICT (hotel_key,pickup_date) DO UPDATE SET total_pieces=public.sagawa_bulk_pickups.total_pieces + excluded.total_pieces, leg_count=public.sagawa_bulk_pickups.leg_count + 1;
INSERT INTO public.sagawa_bulk_pickup_members(group_id,shipment_id,booking_id,leg_index,pieces)
 VALUES ($GID_SUB,'22222222-0000-0000-0000-000000000002','BDX-B',0,4)
 ON CONFLICT (group_id,shipment_id) DO UPDATE SET pieces=excluded.pieces, removed_at=null;
SQL
BRC=$?
wait
chk "S4 並行 recompute: 集荷単位は 1 行に収束 (unique 衝突なし)" "$(val "select count(*) from public.sagawa_bulk_pickups where hotel_key='pid:H4';")" "1"
chk "S4 並行 recompute: 両予約のメンバーが揃う (2件・重複なし)" "$(val "select count(*) from public.sagawa_bulk_pickup_members m join public.sagawa_bulk_pickups g on g.id=m.group_id where g.hotel_key='pid:H4' and m.removed_at is null;")" "2"
if [ "$BRC" = "0" ] && ! grep -qiE "error|violation" /tmp/s4_a; then ok "S4 並行 recompute: 例外なし"; else ng "S4 例外: $(cat /tmp/s4_b)"; fi

echo ""
echo "=== S5: lease 期限切れ後の再取得 (実時刻ベース) ==="
psql -c "truncate public.sagawa_bulk_pickups cascade;
 insert into public.sagawa_bulk_pickups(id,hotel_key,key_source,pickup_date,total_pieces,leg_count,member_hash,status,notify_state,notify_key,notify_attempt_owner,notify_claimed_at)
 values ('$U1','pid:H5','place_id','2026-12-01',20,1,'h','pending','pending','KH','old', now() - interval '20 minutes');" >/dev/null
R1=$(psql -tA 2>&1 <<SQL | grep -o 'UPDATE [0-9]*' | tail -1
UPDATE public.sagawa_bulk_pickups SET notify_state='pending', notify_key='KH', notify_attempt_owner='new', notify_claimed_at=now() WHERE id='$U1' AND $CLAIM_WHERE;
SQL
)
chk "S5 lease 期限切れ (20分前) の pending は再 claim 可 (UPDATE 1)" "$R1" "UPDATE 1"
chk "S5 再 claim 後の owner=new" "$(val "select notify_attempt_owner from public.sagawa_bulk_pickups where id='$U1';")" "new"
R2=$(psql -tA 2>&1 <<SQL | grep -o 'UPDATE [0-9]*' | tail -1
UPDATE public.sagawa_bulk_pickups SET notify_state='pending', notify_key='KH', notify_attempt_owner='new2', notify_claimed_at=now() WHERE id='$U1' AND $CLAIM_WHERE;
SQL
)
chk "S5 lease 内 (新鮮) の同一キー再 claim は不可 (UPDATE 0)" "$R2" "UPDATE 0"

echo ""
echo "============================================================"
echo "  実PostgreSQL 競合テスト: PASS=$PASS  FAIL=$FAIL"
echo "============================================================"
[ "$FAIL" = "0" ]
