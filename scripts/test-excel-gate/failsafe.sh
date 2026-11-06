#!/usr/bin/env bash
# Excel の照合 (scripts/pickup-request/check-excel-rows.ts) が、照合できない時に「問題なし」と言わず止まることの試験
# (2026-11-06 監査 B-12)。本番・staging・外部には接続しない (DB は閉じた手元のポートを指す)。
#   実行: bash scripts/test-excel-gate/failsafe.sh
R="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$R"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
PASS=0; FAIL=0
expect_stop() { # 説明 終了コード 出力
  if [ "$2" -ne 0 ] && ! grep -q "すべて Excel に入れて問題ありません" <<<"$3"; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (exit=$2) $(head -c 200 <<<"$3")"; fi
}
echo '[{"31":"BDX-TEST01-L1","4":"2","12":"20261110"}]' > "$W/rows.json"
run() { env -u NEXT_PUBLIC_SUPABASE_URL -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY "$@" npx tsx scripts/pickup-request/check-excel-rows.ts "$W/rows.json" 2>&1; }
out=$(run); expect_stop "接続情報が無い → 止める" $? "$out"
out=$(run NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=test-key-not-real); expect_stop "DB につながらない → 止める" $? "$out"
out=$(NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=x npx tsx scripts/pickup-request/check-excel-rows.ts "$W/missing.json" 2>&1); expect_stop "rows のファイルが無い → 止める" $? "$out"
echo '{not json' > "$W/broken.json"
out=$(NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=x npx tsx scripts/pickup-request/check-excel-rows.ts "$W/broken.json" 2>&1); expect_stop "rows のファイルが壊れている → 止める" $? "$out"
echo
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
