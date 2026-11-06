#!/usr/bin/env bash
# Excel の照合を、読み取りだけの役割 (sql/ops/excel_check_readonly.sql) で通す試験 (2026-11-07)。
# 手元の専用のコンテナ (Supabase の Postgres・PostgREST) と、Supabase のゲートウェイの決まり (apikey は anon・service_role の
# 鍵だけ) をまねる中継だけを使う。本番・staging・外部には接続しない。Docker が要る。
#   実行: bash scripts/test-excel-gate/readonly-role-e2e.sh
#   build_sheet.py も通す時: BUILD_SHEET=/path/to/output/sagawa-pickup/build_sheet.py bash scripts/test-excel-gate/readonly-role-e2e.sh
set -u
R="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$R"
W=$(mktemp -d); PG=opsguard-e2e-pg-$$; RE=opsguard-e2e-rest-$$
PGP=$((56000 + RANDOM % 900)); RP=$((PGP + 1)); GP=$((PGP + 2))
SECRET=local-e2e-jwt-secret-not-real-at-least-32-chars
cleanup() { [ -n "${GW:-}" ] && kill "$GW" 2>/dev/null; docker stop "$RE" "$PG" >/dev/null 2>&1; rm -rf "$W"; }
trap cleanup EXIT
PASS=0; FAIL=0
ok() { if [ "$2" = 0 ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 ${3:-}"; fi }

docker run -d --rm --name "$PG" -e POSTGRES_PASSWORD=localtestonly -p 127.0.0.1:$PGP:5432 public.ecr.aws/supabase/postgres:17.11.0.011 >/dev/null || exit 1
for i in $(seq 1 60); do docker exec "$PG" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 2; done; sleep 4
P="docker exec -i $PG psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tAq"
$P <<'SQL' >/dev/null
create table shipments (id uuid primary key, booking_id text, leg_index int, status text, tracking_numbers jsonb default '[]', pickup_requested_at timestamptz, suitcase_count int, shipment_date date, expected_arrival date);
create table pickup_requests (id uuid primary key default gen_random_uuid(), shipment_id uuid references shipments(id), channel text, state text);
create table shipment_change_requests (id uuid primary key default gen_random_uuid(), shipment_id uuid references shipments(id), kind text, stage text);
alter table shipments enable row level security; alter table pickup_requests enable row level security; alter table shipment_change_requests enable row level security;
insert into shipments values ('11111111-1111-1111-1111-111111111111','BDX-T1',0,'issued','[]',null,2,'2026-11-10',null),('22222222-2222-2222-2222-222222222222','BDX-T2',0,'issued','[]',null,1,'2026-11-10',null),('33333333-3333-3333-3333-333333333333','BDX-T3',0,'issued','[]',null,1,'2026-11-10',null);
insert into pickup_requests(shipment_id,channel,state) values ('11111111-1111-1111-1111-111111111111','bizlogi','accepted');
insert into shipment_change_requests(shipment_id,kind,stage) values ('22222222-2222-2222-2222-222222222222','cancel','requested');
SQL
$P < sql/ops/excel_check_readonly.sql >/dev/null || { echo "SQL の適用に失敗"; exit 1; }
docker exec "$PG" psql -U supabase_admin -d postgres -tAqc "alter role authenticator with password 'localtestonly'"
docker run -d --rm --name "$RE" -p 127.0.0.1:$RP:3000 -e PGRST_DB_URI="postgres://authenticator:localtestonly@host.docker.internal:$PGP/postgres" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$SECRET public.ecr.aws/supabase/postgrest:v16.5 >/dev/null || exit 1

mint() { node -e 'const c=require("crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const p=JSON.parse(process.argv[1]);const h=b({alg:"HS256",typ:"JWT"}),q=b(p);process.stdout.write(h+"."+q+"."+c.createHmac("sha256",process.argv[2]).update(h+"."+q).digest("base64url"))' "$1" "$SECRET"; }
NOW=$(date +%s)
ANON=$(mint '{"role":"anon"}'); SR=$(mint '{"role":"service_role"}')
RO=$(mint "{\"role\":\"bondex_excel_reader\",\"exp\":$((NOW+3600))}")
RO_OLD=$(mint "{\"role\":\"bondex_excel_reader\",\"exp\":$((NOW-60))}")

# ゲートウェイのまね: apikey が anon・service_role の鍵でなければ 401。/rest/v1 を外して PostgREST へ。Authorization が無ければ apikey を使う
cat > "$W/gw.cjs" <<'JS'
const http = require("http")
const [port, up, anon, sr] = process.argv.slice(2)
http.createServer((req, res) => {
  const k = req.headers["apikey"]
  if (k !== anon && k !== sr) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"message":"Invalid API key"}') }
  const headers = { ...req.headers, host: `127.0.0.1:${up}` }
  if (!headers.authorization) headers.authorization = `Bearer ${k}`
  const r = http.request({ host: "127.0.0.1", port: up, path: req.url.replace(/^\/rest\/v1/, ""), method: req.method, headers }, (u) => { res.writeHead(u.statusCode, u.headers); u.pipe(res) })
  r.on("error", () => { res.writeHead(502); res.end('{"message":"upstream"}') })
  req.pipe(r)
}).listen(Number(port), "127.0.0.1")
JS
node "$W/gw.cjs" $GP $RP "$ANON" "$SR" & GW=$!
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$RP/" && break; sleep 1; done

row() { echo "[{\"31\":\"$1\",\"4\":\"$2\",\"12\":\"20261110\"}]" > "$W/$3"; }
row BDX-T1-L1 2 t1.json; row BDX-T2-L1 1 t2.json; row BDX-T3-L1 1 t3.json
chk() { # env の追加… rows
  local f=$1; shift
  env -u SUPABASE_SERVICE_ROLE_KEY -u EXCEL_CHECK_READONLY_KEY -u NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$GP "$@" npx tsx scripts/pickup-request/check-excel-rows.ts "$W/$f" --ops-mode=excel-check 2>&1
}
allok() { grep -q "すべて Excel に入れて問題ありません" <<<"$1"; }

echo "[ゲートウェイの決まり]"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$GP/rest/v1/rpc/excel_check_snapshot?p_booking_ids=%7BBDX-T3%7D" -H "apikey: $RO")
ok "役割の鍵を apikey に入れる → ゲートウェイが 401 (以前の作りは本番で通らなかった)" $([ "$code" = 401 ] && echo 0 || echo 1) "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$GP/rest/v1/rpc/excel_check_snapshot?p_booking_ids=%7BBDX-T3%7D" -H "apikey: $ANON" -H "Authorization: Bearer $RO")
ok "apikey=anon・Bearer=役割の鍵 → 200" $([ "$code" = 200 ] && echo 0 || echo 1) "$code"
body=$(curl -s -X PATCH "http://127.0.0.1:$GP/rest/v1/shipments?id=eq.33333333-3333-3333-3333-333333333333" -H "apikey: $ANON" -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"status":"cancelled"}')
ok "役割の鍵で表を書き換える → 42501" $(grep -q 42501 <<<"$body" && echo 0 || echo 1) "$body"
body=$(curl -s "http://127.0.0.1:$GP/rest/v1/rpc/excel_check_snapshot?p_booking_ids=%7BBDX-T1%7D" -H "apikey: $ANON")
ok "anon だけで関数 → 42501" $(grep -q 42501 <<<"$body" && echo 0 || echo 1) "$body"

echo "[照合 (check-excel-rows.ts・役割の鍵)]"
RK=(EXCEL_CHECK_READONLY_KEY=$RO NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON)
out=$(chk t3.json "${RK[@]}"); rc=$?; ok "依頼なし → OK" $([ $rc = 0 ] && allok "$out" && echo 0 || echo 1) "$out"
out=$(chk t1.json "${RK[@]}"); rc=$?; ok "依頼済み (Biz-Logi 受付済み・RLS の表) → NG で止まる" $([ $rc != 0 ] && grep -q "集荷依頼の記録があります" <<<"$out" && echo 0 || echo 1) "$out"
out=$(chk t2.json "${RK[@]}"); rc=$?; ok "取消の申請中 → NG で止まる" $([ $rc != 0 ] && grep -q "申請" <<<"$out" && echo 0 || echo 1) "$out"
out=$(chk t3.json EXCEL_CHECK_READONLY_KEY=$RO_OLD NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON); rc=$?; ok "期限切れの鍵 → 止まる" $([ $rc != 0 ] && ! allok "$out" && echo 0 || echo 1) "$out"
out=$(chk t3.json EXCEL_CHECK_READONLY_KEY=$RO); rc=$?; ok "公開の鍵が無い → 止まる" $([ $rc != 0 ] && ! allok "$out" && echo 0 || echo 1) "$out"
$P -c "revoke execute on function public.excel_check_snapshot(text[]) from bondex_excel_reader; notify pgrst, 'reload schema';" >/dev/null; sleep 2
out=$(chk t3.json "${RK[@]}"); rc=$?; ok "権限が無い (実行の権限を外した) → 止まる" $([ $rc != 0 ] && ! allok "$out" && echo 0 || echo 1) "$out"
$P -c "grant execute on function public.excel_check_snapshot(text[]) to bondex_excel_reader; notify pgrst, 'reload schema';" >/dev/null; sleep 2
$P -c "alter function public.excel_check_snapshot(text[]) rename to excel_check_snapshot_bak; create function public.excel_check_snapshot(p_booking_ids text[]) returns jsonb language sql stable as \$\$ select '{\"legs\":[],\"requests\":[]}'::jsonb \$\$; grant execute on function public.excel_check_snapshot(text[]) to bondex_excel_reader; notify pgrst, 'reload schema';" >/dev/null; sleep 2
out=$(chk t3.json "${RK[@]}"); rc=$?; ok "結果を確かめられない (complete が無い) → 止まる" $([ $rc != 0 ] && ! allok "$out" && echo 0 || echo 1) "$out"
$P -c "drop function public.excel_check_snapshot(text[]); alter function public.excel_check_snapshot_bak(text[]) rename to excel_check_snapshot; notify pgrst, 'reload schema';" >/dev/null; sleep 2
out=$(NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 EXCEL_CHECK_READONLY_KEY=$RO NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON npx tsx scripts/pickup-request/check-excel-rows.ts "$W/t3.json" --ops-mode=excel-check 2>&1); rc=$?
ok "DB に届かない → 止まる" $([ $rc != 0 ] && ! allok "$out" && echo 0 || echo 1) "$out"

if [ -n "${BUILD_SHEET:-}" ]; then
  echo "[build_sheet.py (役割の鍵・控えは一時の場所)]"
  BS="$W/bs"; mkdir -p "$BS"
  python3 -I - "$(dirname "$BUILD_SHEET")" "$BS" <<'PY'
import json, sys, glob, os
src = sorted(glob.glob(os.path.join(sys.argv[1], "rows-2026-11-*.json")))[-1]
base = json.load(open(src, encoding="utf-8"))[0]
for ref, p, name in [("BDX-T1-L1", "2", "t1"), ("BDX-T3-L1", "1", "t3")]:
    d = dict(base); d["31"] = ref; d["4"] = p; d["12"] = "20261110"; d.pop("28", None)
    json.dump([d], open(f"{sys.argv[2]}/{name}.json", "w"), ensure_ascii=False)
PY
  printf 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:%s\nNEXT_PUBLIC_SUPABASE_ANON_KEY=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\nEXCEL_CHECK_READONLY_KEY=%s\n' $GP "$ANON" "$SR" "$RO" > "$BS/env"
  bs() { BONDEX_EXCEL_CHECK_REPO="$R" BONDEX_EXCEL_LEDGER="$BS/ledger.jsonl" BONDEX_EXCEL_CHECK_ENV="$BS/env" python3 "$BUILD_SHEET" "$BS/$1.json" "$BS/out-$2" 2>&1; }
  n() { ls "$BS"/out-$1.* 2>/dev/null | wc -l | tr -d ' '; }
  out=$(bs t1 a); rc=$?; ok "依頼済み → Excel を作らない" $([ $rc != 0 ] && [ "$(n a)" = 0 ] && echo 0 || echo 1) "$out"
  out=$(bs t3 b); rc=$?; ok "依頼なし → Excel を作る" $([ $rc = 0 ] && [ "$(n b)" = 2 ] && echo 0 || echo 1) "$out"
  out=$(bs t3 c); rc=$?; ok "同じ区間をもう一度 → 控えで止まる" $([ $rc != 0 ] && [ "$(n c)" = 0 ] && echo 0 || echo 1) "$out"
  $P -c "revoke execute on function public.excel_check_snapshot(text[]) from bondex_excel_reader; notify pgrst, 'reload schema';" >/dev/null; sleep 2
  rm -f "$BS/ledger.jsonl"; out=$(bs t3 e); rc=$?; ok "権限が無い → Excel を作らない" $([ $rc != 0 ] && [ "$(n e)" = 0 ] && echo 0 || echo 1) "$out"
fi
echo
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
