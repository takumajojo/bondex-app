/**
 * 運営のセッション（v1: 従来・v2: パスキーの端末つき）の試験。B2B の入場（v1）が今までどおり通ることも確かめる。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-b2c/operator-session.ts
 */
import assert from "node:assert/strict"

async function main() {
  process.env.OPERATOR_PASSWORD ||= "test-only-session-secret"
  process.env.OPERATOR_SESSION_SECRET ||= "test-only-session-secret"
  const { issueOperatorSession, verifyOperatorSession, operatorSessionCredentialId } = await import("@/lib/operator-session")
  const v1 = await issueOperatorSession()
  assert.ok(v1 && v1.startsWith("v1."))
  assert.equal(await verifyOperatorSession(v1), true)
  assert.equal(await operatorSessionCredentialId(v1), null)

  const cred = "AbCdEfGhIjKlMnOpQrStUv_-0123"
  const v2 = await issueOperatorSession(cred)
  assert.ok(v2 && v2.startsWith("v2."))
  assert.equal(await verifyOperatorSession(v2), true)
  assert.equal(await operatorSessionCredentialId(v2), cred)

  // 端末の ID を書き換えると署名が合わない
  const forged = v2!.replace(cred, "ZZZZEfGhIjKlMnOpQrStUv_-0123")
  assert.equal(await verifyOperatorSession(forged), false)
  assert.equal(await operatorSessionCredentialId(forged), null)
  // 形式外の credential_id は v1 として発行される（端末の識別を持たない）
  const odd = await issueOperatorSession("bad id!")
  assert.ok(odd && odd.startsWith("v1."))
  console.log("  ok  運営のセッション: v1 は従来どおり通り、v2 は端末を持ち、改ざんは拒否")
}
main().catch((e) => { console.error(e); process.exit(1) })
