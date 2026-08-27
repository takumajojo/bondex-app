// 代理店別ホテル通知の中核ロジックが「mode の値ごとに分岐する」ことを、
// 実際に出荷される lib/hotel-notification.ts をコンパイルして検証する。
//
// 実行 (プロジェクト直下):
//   npx tsc lib/hotel-notification.ts --outDir /tmp/hn --module esnext --target es2020 --ignoreConfig
//   cp scripts/verify-hotel-notification.mjs /tmp/hn/test.mjs
//   node /tmp/hn/test.mjs
//
// lib/hotel-notification.ts は依存ゼロの純関数のみなので、app の node_modules 無しで単体コンパイル可能。
import {
  modeToNoteTarget, resolveNoteTarget, applicableRoutes,
  HOTEL_NOTIFICATION_MODES, DEFAULT_HOTEL_NOTIFICATION_MODE, isHotelNotificationMode
} from "./hn-src.js"

let pass = 0, fail = 0
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  const ok = g === w
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  => ${g}${ok ? "" : `  (want ${w})`}`)
  ok ? pass++ : fail++
}

console.log("=== mode -> note_target (代理店既定・leg指定なし) ===")
eq("guest_only", modeToNoteTarget("guest_only"), "to")
eq("pickup_only", modeToNoteTarget("pickup_only"), "from")
eq("dual",        modeToNoteTarget("dual"),        "both")
eq("null(default)", modeToNoteTarget(null),        "to")

console.log("\n=== resolveNoteTarget: leg個別指定が代理店既定を上書き ===")
eq("leg=from over guest_only", resolveNoteTarget("from", "guest_only"), "from")
eq("leg=empty uses agency dual", resolveNoteTarget("", "dual"), "both")
eq("leg=null uses agency pickup_only", resolveNoteTarget(null, "pickup_only"), "from")
eq("leg=bad falls to agency mode", resolveNoteTarget("xxx", "dual"), "both")
eq("leg empty + agency null => to", resolveNoteTarget("", null), "to")

console.log("\n=== 各modeで『通知される両ルート』が異なる (=値ごとに分岐) ===")
for (const m of HOTEL_NOTIFICATION_MODES) {
  const t = modeToNoteTarget(m)
  const r = applicableRoutes(t)
  console.log(`  mode=${m.padEnd(11)} -> note_target=${t.padEnd(4)} -> pickup:${r.pickup}  guest:${r.guest}`)
}
eq("guest_only routes", applicableRoutes(modeToNoteTarget("guest_only")), {pickup:false,guest:true})
eq("pickup_only routes", applicableRoutes(modeToNoteTarget("pickup_only")), {pickup:true,guest:false})
eq("dual routes",        applicableRoutes(modeToNoteTarget("dual")),        {pickup:true,guest:true})

console.log("\n=== validation ===")
eq("isMode dual", isHotelNotificationMode("dual"), true)
eq("isMode junk", isHotelNotificationMode("nope"), false)
eq("default mode", DEFAULT_HOTEL_NOTIFICATION_MODE, "guest_only")

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAIL"}  (${pass} passed, ${fail} failed)`)
process.exit(fail === 0 ? 0 : 1)
