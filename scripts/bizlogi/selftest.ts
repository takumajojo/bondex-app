/**
 * 自己テスト — 佐川 Biz-Logi API をモックして電文の構築・検証・解析を確かめる。
 *
 *   npx tsx scripts/bizlogi/selftest.ts
 *
 * 実接続なし・課金なし (fetch を差し替える)。検証するのは以下:
 *   1. XML の組み立て/解析 (CDATA・エスケープ・省略項目)
 *   2. 全角/半角・桁数の正規化 (管理番号のハイフン除去、郵便番号、住所の25文字分割)
 *   3. 結果コード辞書 (仕様書 5.2 の全コード)
 *   4. BondEx の1区間 → 集荷依頼つき出荷情報への変換
 *   5. 送信前検証 (当日集荷・30日超・顧客コード11桁・記事17文字超 を送る前に止める)
 *   6. レスポンス解析 (正常 / エラー有り)
 *   7. クライアント: BIZLOGI_LIVE でない限り発行依頼を送らない、通信失敗の扱い
 */

import {
  BizLogiClient,
  BizLogiConfigError,
  BizLogiTransportError,
  BizLogiValidationError,
  KNOWN_RESULT_CODES,
  bizLogiConfigFromEnv,
  buildPickupDetail,
  buildShippingRequestXml,
  describeResultCode,
  maskSecrets,
  normalizeManageNumber,
  normalizeTel,
  normalizeYubin,
  parseShippingResponse,
  splitLines,
  validateShippingDetail,
  type BizLogiConfig,
  type PickupLegInput,
} from "../../lib/bizlogi"
import { buildXml, cdata, childText, parseXml } from "../../lib/bizlogi/xml"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`)
  }
}

async function throws(fn: () => unknown | Promise<unknown>, type: new (...a: never[]) => Error): Promise<Error | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return e instanceof type ? e : null
  }
}

const TODAY = "20261009"
const KOKYAKU = "123456789012" // ダミーの12桁

const LEG: PickupLegInput = {
  legRef: "BDX-TEST01-L1",
  kokyakuCode: KOKYAKU,
  origin: {
    name: "ホテルグルーヴ新宿",
    postalCode: "160-0021",
    address: "東京都新宿区歌舞伎町１-２９-１　東急歌舞伎町タワー",
    tel: "03-0000-0000",
  },
  destination: {
    name: "ダイワロイネットホテル京都八条口",
    postalCode: "6018017",
    address: "京都府京都市南区東九条北烏丸町９－２",
    tel: "０７５－０００－００００",
  },
  guestName: "Mr. John Smith",
  suitcaseCount: 2,
  pickupDate: "2026-10-12",
  pickupTimeCode: "09",
  deliveryDate: "2026-10-14",
  deliverySlot: "before-noon",
  notes: ["BondEx手荷物配送", "品名 スーツケース", "ツアーT0000"],
}

const CONFIG: BizLogiConfig = {
  baseUrl: "https://beccl-st.biz-blue.net/api",
  environment: "test",
  customerId: "testcustomer",
  loginPassword: "p&ss<w>rd==",
  okuriCode: "N01",
  live: false,
  numbering: "system", // 以前からの試験はシステム採番 (区分0)。顧客側採番は 16章
}

const OK_RESPONSE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<shippingResponse>
  <printOutFlg>1</printOutFlg><okuriCode>A501</okuriCode><outputLevel>000</outputLevel>
  <resultCode>S0-0001</resultCode>
  <printRequestId>9001-1</printRequestId>
  <printDataList><printDataDetail>
    <userManageNumber>BDXTEST01L1</userManageNumber>
    <resultCodeList><resultCode>S0-0001</resultCode></resultCodeList>
    <shippingNumberList><shippingNumber>100000000011</shippingNumber><shippingNumber>100000000022</shippingNumber></shippingNumberList>
  </printDataDetail></printDataList>
</shippingResponse>`

// 仕様書のエラー例と同じ形 (タグ名が printOutFlag になっており、発行受付IDも残っている)
const ERROR_RESPONSE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<shippingResponse>
  <printOutFlag>1</printOutFlag><okuriCode>A501</okuriCode><outputLevel>000</outputLevel>
  <resultCode>E8-0001</resultCode>
  <printRequestId>9001-1</printRequestId>
  <printDataList><printDataDetail>
    <userManageNumber>BDXTEST01L1</userManageNumber>
    <resultCodeList><resultCode>E2-0004</resultCode><resultCode>E1-0093</resultCode></resultCodeList>
  </printDataDetail></printDataList>
</shippingResponse>`

function mockFetch(handler: (url: string, body: string) => { status?: number; body: string } | Error) {
  const calls: Array<{ url: string; body: string; contentType: string }> = []
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "")
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url: String(url), body, contentType: headers["Content-Type"] })
    const r = handler(String(url), body)
    if (r instanceof Error) throw r
    return new Response(r.body, { status: r.status ?? 200 })
  }) as typeof fetch
  return { impl, calls }
}

async function main() {
  console.log("1. XML")
  {
    const xml = buildXml(["a", [["b", "x<&>y"], ["c", cdata("p]]>q")], ["d", ""], ["e", [["f", undefined]]], ["g", 0]]])
    const root = parseXml(xml)
    check("エスケープした値が往復する", childText(root, "b") === "x<&>y")
    check("CDATA (]]> を含む) が往復する", childText(root, "c") === "p]]>q")
    check("空の任意項目は出力しない", !xml.includes("<d>") && !xml.includes("<e>"))
    check("数値 0 は出力する", childText(root, "g") === "0")
    check("自己終了タグと宣言を解析できる", parseXml(`<?xml version="1.0"?><r><x/><y>1</y></r>`).children.length === 2)
  }

  console.log("2. 文字の正規化")
  {
    check("管理番号のハイフン除去", normalizeManageNumber("BDX-8QRV2Y-L1") === "BDX8QRV2YL1")
    check("全角の管理番号も半角英数字へ", normalizeManageNumber("ＢＤＸ－８ＱＲＶ２Ｙ－Ｌ１") === "BDX8QRV2YL1")
    check("郵便番号はハイフン無し7桁", normalizeYubin("160-0021") === "1600021" && normalizeYubin("１６０－００２１") === "1600021")
    check("7桁でない郵便番号は弾く", normalizeYubin("160-002") === null)
    check("全角の電話番号を半角へ", normalizeTel("０７５－０００－００００") === "075-000-0000")
    check("数字以外を含む電話番号は弾く", normalizeTel("03-xxxx") === null)
    const lines = splitLines("東京都新宿区歌舞伎町１-２９-１　東急歌舞伎町タワー", 25, 3)
    check("住所を空白位置で25文字以内に分割", !!lines && lines.length === 2 && lines.every((l) => Array.from(l).length <= 25), lines)
    check("収まらない住所は切り捨てず null", splitLines("あ".repeat(80), 25, 3) === null)
  }

  console.log("3. 結果コード辞書")
  {
    // 仕様書の行番号: 0-1〜0-2 (2) + 1-1〜1-135 (135) + 2-1〜2-22 (22) + 3-1 (1) + 8-1〜8-3 (3) + 9-1 (1) = 164
    check("仕様書 5.2 の全コードを収録 (164件)", KNOWN_RESULT_CODES.length === 164, KNOWN_RESULT_CODES.length)
    check("コード形式が XY-9999", KNOWN_RESULT_CODES.every((c) => /^[SEW][0-9]-\d{4}$/.test(c)))
    check("E2-0004 = 入力を直す", describeResultCode("E2-0004").action === "input")
    check("E1-0093 (集荷依頼契約なし) = 契約の問題", describeResultCode("E1-0093").action === "contract")
    check("E3-0001 = 認証", describeResultCode("E3-0001").action === "auth")
    check("E2-0006 = 時間を置く", describeResultCode("E2-0006").action === "wait")
    check("W2-0003 (中継エリア) は警告", describeResultCode("W2-0003").severity === "warning")
    check("未知のコードも落ちずにエラー扱い", describeResultCode("E1-9999").unknown === true && describeResultCode("E1-9999").severity === "error")
  }

  console.log("4. 区間 → 集荷依頼データ")
  const built = buildPickupDetail(LEG)
  if (!built.ok) {
    check("変換に成功する", false, built.issues)
    return
  }
  const detail = built.detail
  {
    check("管理番号は記号なし", detail.userManageNumber === "BDXTEST01L1")
    check("依頼主 = 発送元ホテル (気付)", detail.irai?.nm[0] === "ホテルグルーヴ新宿 気付" && detail.irai?.nm[1] === "Mr. John Smith様", detail.irai?.nm)
    check("届先 = 到着ホテル (気付)", detail.otodokeNm[0] === "ダイワロイネットホテル京都八条口 気付", detail.otodokeNm)
    check("郵便番号・電話が半角", detail.irai?.yubin === "1600021" && detail.otodokeTel === "075-000-0000")
    check("集荷日・配達日・時間帯コード", detail.shukaIrai?.shukaIraiShiteiDate === "20261012" && detail.shiteiDate === "20261014" && detail.shiteiTimeCode === "01")
    check("スーツケース既定サイズ 160", detail.weight1 === "160")
    check("事前検証を通る", validateShippingDetail(detail, TODAY).length === 0, validateShippingDetail(detail, TODAY))

    const long = buildPickupDetail({ ...LEG, guestName: "Mr. Bartholomew Featherstonehaugh-Montgomery III" })
    check("宛名が収まらないときは切り捨てずエラー", !long.ok)
    const badSlot = buildPickupDetail({ ...LEG, deliverySlot: "before-ten" })
    check("佐川に無い時間帯はエラー", !badSlot.ok)
  }

  console.log("5. 電文と送信前検証")
  {
    const xml = buildShippingRequestXml({ customerId: CONFIG.customerId, loginPassword: CONFIG.loginPassword, issue: false, details: [detail] }, TODAY)
    const root = parseXml(xml)
    const d = root.children.find((c) => c.name === "printDataList")!.children[0]
    check("ルートは shippingRequest", root.name === "shippingRequest")
    check("確認機能は printOutFlg=0", childText(root, "printOutFlg") === "0")
    check("パスワードが往復する (CDATA)", childText(root.children[0], "loginPassword") === CONFIG.loginPassword)
    check("ログ用にパスワードを伏せられる", !maskSecrets(xml).includes(CONFIG.loginPassword))
    check("iraiPrintFlg=1 (実集荷先)", childText(d, "iraiPrintFlg") === "1")
    check("集荷依頼情報が入る", childText(d.children.find((c) => c.name === "shukaIraiData"), "shukaIraiShiteiTimeCode") === "09")
    const order = d.children.map((c) => c.name)
    check(
      "要素が仕様書の項番順",
      order.indexOf("haisoKosu") < order.indexOf("otodokeAdd1") &&
        order.indexOf("otodokeTel") < order.indexOf("iraiPrintFlg") &&
        order.indexOf("iraiTel") < order.indexOf("shippingDate") &&
        order.indexOf("binsyuCode") < order.indexOf("shiteiDate") &&
        order.indexOf("motoChakuCode") < order.indexOf("shukaIraiData"),
      order,
    )

    const fields = (over: Partial<typeof detail>) => validateShippingDetail({ ...detail, ...over }, TODAY).map((i) => i.field)
    check("ハイフン入り管理番号を止める", fields({ userManageNumber: "BDX-TEST01-L1" }).includes("userManageNumber"))
    check("集荷依頼の管理番号は15桁まで", fields({ userManageNumber: "A".repeat(16) }).includes("userManageNumber"))
    check("11桁の顧客コードを止める", fields({ kokyakuCode: "16031040000" }).includes("kokyakuCode"))
    check("当日の集荷依頼を止める", fields({ shukaIrai: { ...detail.shukaIrai!, shukaIraiShiteiDate: TODAY } }).includes("shukaIraiShiteiDate"))
    check("31日先の集荷依頼を止める", fields({ shukaIrai: { ...detail.shukaIrai!, shukaIraiShiteiDate: "20261109" } }).includes("shukaIraiShiteiDate"))
    check("30日先は通す", !fields({ shippingDate: "20261108", shiteiDate: "20261110", shukaIrai: { ...detail.shukaIrai!, shukaIraiShiteiDate: "20261108" } }).length)
    check("記事18文字を止める (集荷依頼は17文字)", fields({ kiji: ["あ".repeat(18)] }).includes("kiji1"))
    check("26文字の住所を止める", fields({ otodokeAdd: ["あ".repeat(26)] }).includes("otodokeAdd1"))
    check("配達指定日が発送日以前なら止める", fields({ shiteiDate: "20261012" }).includes("shiteiDate"))
    check(
      "送り状お届日は 送信日 < お届日 < 集荷日",
      fields({ shukaIrai: { ...detail.shukaIrai!, denpyoOtodokeDate: "20261012" } }).includes("shukaIraiDenpyoOtodokeDate") &&
        !fields({ shukaIrai: { ...detail.shukaIrai!, denpyoOtodokeDate: "20261011" } }).length,
    )
    check(
      "発行依頼で送り状コードが無ければ止める",
      !!(await throws(
        () => buildShippingRequestXml({ customerId: "a", loginPassword: "b", issue: true, details: [detail] }, TODAY),
        BizLogiValidationError,
      )),
    )
    check(
      "同じ管理番号の重複を止める",
      !!(await throws(
        () => buildShippingRequestXml({ customerId: "a", loginPassword: "b", issue: false, details: [detail, detail] }, TODAY),
        BizLogiValidationError,
      )),
    )
  }

  console.log("6. レスポンス解析")
  {
    const ok = parseShippingResponse(OK_RESPONSE)
    check("正常: 発行受付IDと問合番号 (個口数ぶん)", ok.ok && ok.printRequestId === "9001-1" && ok.details[0].shippingNumbers.length === 2)
    const ng = parseShippingResponse(ERROR_RESPONSE)
    check("エラー: ok=false", !ng.ok && ng.result.code === "E8-0001")
    check("エラー: 発行受付IDを採用しない", ng.printRequestId === null)
    check("エラー: 明細のコードを日本語化", ng.details[0].resultCodes.map((c) => c.action).join(",") === "input,contract", ng.details[0].resultCodes)
  }

  console.log("7. クライアント")
  {
    const m1 = mockFetch(() => ({ body: OK_RESPONSE.replace("9001-1", "") }))
    const res = await new BizLogiClient(CONFIG, m1.impl).checkShipping([detail], TODAY)
    check("確認機能: /shipping へ application/xml で POST", m1.calls[0]?.url === `${CONFIG.baseUrl}/shipping` && m1.calls[0]?.contentType === "application/xml")
    check("確認機能: printOutFlg=0 で送る", m1.calls[0]?.body.includes("<printOutFlg>0</printOutFlg>") && res.printRequestId === null)

    const m2 = mockFetch(() => ({ body: OK_RESPONSE }))
    const blocked = await throws(() => new BizLogiClient(CONFIG, m2.impl).requestShipping([detail], TODAY), BizLogiConfigError)
    check("BIZLOGI_LIVE でなければ発行依頼を送らない (通信ゼロ)", !!blocked && m2.calls.length === 0)

    const m3 = mockFetch(() => ({ body: OK_RESPONSE }))
    const live = await new BizLogiClient({ ...CONFIG, live: true }, m3.impl).requestShipping([detail], TODAY)
    check("live: 発行依頼は printOutFlg=1・問合番号を返す", m3.calls[0].body.includes("<printOutFlg>1</printOutFlg>") && live.details[0].shippingNumbers[0] === "100000000011")

    const m4 = mockFetch(() => new Error("socket hang up"))
    const te = await throws(() => new BizLogiClient({ ...CONFIG, live: true }, m4.impl).requestShipping([detail], TODAY), BizLogiTransportError)
    check("通信失敗は TransportError (1回だけ送信・自動再送なし)", !!te && m4.calls.length === 1)

    const m5 = mockFetch(() => ({ status: 503, body: "Service Unavailable" }))
    const he = await throws(() => new BizLogiClient(CONFIG, m5.impl).checkShipping([detail], TODAY), BizLogiTransportError)
    check("HTTP 503 は TransportError", (he as BizLogiTransportError | null)?.status === 503)

    // 導入チェックシート: 下敷画像表示フラグは 1 を既定に (省略すると佐川側は非表示扱い)
    check("下敷画像: 既定で backLayerFlg=1 を outputLevel の直後に送る", /<outputLevel>000<\/outputLevel>\s*<backLayerFlg>1<\/backLayerFlg>/.test(m1.calls[0]?.body ?? ""))
    const noLayer = buildShippingRequestXml({ customerId: "c", loginPassword: "p", issue: false, backLayerFlg: 0, details: [detail] }, TODAY)
    check("下敷画像: 明示すれば 0 も送れる", noLayer.includes("<backLayerFlg>0</backLayerFlg>"))
    const n01 = buildShippingRequestXml({ customerId: "c", loginPassword: "p", issue: true, okuriCode: "N01", details: [detail] }, TODAY)
    check("送り状コード N01 をそのまま送る", n01.includes("<okuriCode>N01</okuriCode>"))
    const m8 = mockFetch(() => ({ body: `<retryPrintResponse><resultCode>S0-0001</resultCode><printRequestId>2084-1</printRequestId></retryPrintResponse>` }))
    const rp = await new BizLogiClient(CONFIG, m8.impl).retryPrint(["175653596241"])
    check("再発行: /retryprint に backLayerFlg=1 を付けて送る", m8.calls[0]?.url.endsWith("/retryprint") && /<\/customerAuth>\s*<backLayerFlg>1<\/backLayerFlg>\s*<shippingNumberList>/.test(m8.calls[0]?.body ?? "") && rp.printRequestId === "2084-1")

    const m6 = mockFetch((url) =>
      url.endsWith("/checkaddress")
        ? {
            body: `<checkAddressResponse><resultCode>S0-0001</resultCode><requestYubin>6018017</requestYubin>
              <addressList><addressInfo><todofukenName>京都府</todofukenName><shikuchosonName>京都市南区</shikuchosonName><choikiName>東九条北烏丸町</choikiName></addressInfo></addressList>
              <yubinList><yubin>6018017</yubin></yubinList><depotCode>0000</depotCode><depotName>テスト</depotName><depotTel>0120-000-000</depotTel></checkAddressResponse>`,
          }
        : { status: 404, body: "" },
    )
    const addr = await new BizLogiClient(CONFIG, m6.impl).checkAddress("6018017", "京都府京都市南区東九条北烏丸町")
    check("住所チェック: 一致と担当営業所", addr.matched && addr.depot?.code === "0000" && addr.addresses[0].choiki === "東九条北烏丸町")

    const m7 = mockFetch(() => ({ body: `<checkAddressResponse><resultCode>E2-0001</resultCode></checkAddressResponse>` }))
    const mismatch = await new BizLogiClient(CONFIG, m7.impl).checkAddress("6048102", "東京都品川区勝島")
    check("住所チェック: 不一致", !mismatch.matched && mismatch.result.code === "E2-0001")

    check("env: 必須キーの不足を名指しする", /BIZLOGI_CUSTOMER_ID/.test((await throws(() => bizLogiConfigFromEnv({ BIZLOGI_BASE_URL: "https://x.test" }), BizLogiConfigError))?.message ?? ""))
    const dummyEnv = { BIZLOGI_BASE_URL: "https://dummy.sgsystems.co.jp/rest/getxml", BIZLOGI_CUSTOMER_ID: "a", BIZLOGI_LOGIN_PASSWORD: "b", BIZLOGI_ENV: "production" }
    check("env: 仕様書のダミーURLを弾く", /ダミー/.test((await throws(() => bizLogiConfigFromEnv(dummyEnv), BizLogiConfigError))?.message ?? ""))
    const cfg = bizLogiConfigFromEnv({ ...dummyEnv, BIZLOGI_BASE_URL: "https://real.example.test/rest/getxml/", BIZLOGI_LIVE: "TRUE" })
    check("env: 末尾スラッシュ除去・LIVE は厳密に \"true\" のみ", cfg.baseUrl.endsWith("/getxml") && cfg.live === false)

    // 2026-11-03 安全策: テスト/本番の取り違え防止・送り状コードの限定
    const testEnv = { BIZLOGI_BASE_URL: "https://beccl-st.biz-blue.net/api", BIZLOGI_CUSTOMER_ID: "a", BIZLOGI_LOGIN_PASSWORD: "b", BIZLOGI_ENV: "test", BIZLOGI_OKURI_CODE: "N01" }
    check("env: BIZLOGI_ENV 未設定は不足として名指し", /BIZLOGI_ENV/.test((await throws(() => bizLogiConfigFromEnv({ ...testEnv, BIZLOGI_ENV: undefined }), BizLogiConfigError))?.message ?? ""))
    check("env: test + テスト環境ホスト は通る", bizLogiConfigFromEnv(testEnv).environment === "test")
    check("env: production なのにテスト環境ホストは拒否", !!(await throws(() => bizLogiConfigFromEnv({ ...testEnv, BIZLOGI_ENV: "production" }), BizLogiConfigError)))
    check("env: test なのに本番ホストは拒否", !!(await throws(() => bizLogiConfigFromEnv({ ...testEnv, BIZLOGI_BASE_URL: "https://prod.example.test/api" }), BizLogiConfigError)))
    check("env: 許可外の送り状コード (A501) は拒否", /A501/.test((await throws(() => bizLogiConfigFromEnv({ ...testEnv, BIZLOGI_OKURI_CODE: "A501" }), BizLogiConfigError))?.message ?? ""))
    const m9 = mockFetch(() => ({ body: OK_RESPONSE }))
    const badCode = await throws(() => new BizLogiClient({ ...CONFIG, live: true, okuriCode: "A501" }, m9.impl).requestShipping([detail], TODAY), BizLogiConfigError)
    check("発行依頼: 許可外の送り状コードなら通信ゼロで拒否", !!badCode && m9.calls.length === 0)
    const m10 = mockFetch(() => ({ body: OK_RESPONSE }))
    const noCode = await throws(() => new BizLogiClient({ ...CONFIG, live: true, okuriCode: undefined }, m10.impl).requestShipping([detail], TODAY), BizLogiConfigError)
    check("発行依頼: 送り状コード未設定なら通信ゼロで拒否", !!noCode && m10.calls.length === 0)
  }

  console.log("16. 顧客側採番 (2026-11-04 SG 正式回答・仕様書 p.28 1-7 / p.35 1-9-1-49)")
  {
    const { sagawaCheckDigitOk } = await import("../../lib/bizlogi/shipping")
    const { judgeUsage } = await import("../../lib/pickup-request/recovery")
    const num = (body: string) => body + String(Number(BigInt(body) % BigInt(7)))
    const n1 = num("99999000001")
    check("チェックデジット: 先頭11桁 mod 7", sagawaCheckDigitOk(n1) && !sagawaCheckDigitOk(n1.slice(0, 11) + String((Number(n1[11]) + 1) % 10)) && !sagawaCheckDigitOk("12345"))
    const xml = buildShippingRequestXml({ customerId: "c", loginPassword: "p", issue: true, okuriCode: "N01", shippingNumberType: 1, details: [{ ...detail, shippingNumber: n1 }] }, TODAY)
    const pos = (t: string) => xml.indexOf(`<${t}>`)
    check("採番区分 1 を送る", xml.includes("<shippingNumberType>1</shippingNumberType>"))
    check("項目の順番: backLayerFlg (1-6) → shippingNumberType (1-7) → printDataList (1-9)", pos("backLayerFlg") < pos("shippingNumberType") && pos("shippingNumberType") < pos("printDataList"))
    check("項目の順番: shukaIraiData (1-9-1-48) の後に shippingNumber (1-9-1-49)", pos("shukaIraiData") > 0 && xml.indexOf("</shukaIraiData>") < pos("shippingNumber") && xml.includes(`<shippingNumber>${n1}</shippingNumber>`))
    const sysXml = buildShippingRequestXml({ customerId: "c", loginPassword: "p", issue: false, details: [detail] }, TODAY)
    check("システム採番 (区分省略) では採番区分も番号も送らない", !sysXml.includes("shippingNumberType") && !sysXml.includes("<shippingNumber>"))
    const noNum = await throws(async () => buildShippingRequestXml({ customerId: "c", loginPassword: "p", issue: true, okuriCode: "N01", shippingNumberType: 1, details: [detail] }, TODAY), BizLogiValidationError)
    check("区分 1 で番号なしは送る前に止める", !!noNum && /問合番号 \(12桁\) が必須/.test(noNum.message))
    const badCd = await throws(async () => buildShippingRequestXml({ customerId: "c", loginPassword: "p", issue: true, okuriCode: "N01", shippingNumberType: 1, details: [{ ...detail, shippingNumber: n1.slice(0, 11) + String((Number(n1[11]) + 1) % 10) }] }, TODAY), BizLogiValidationError)
    check("チェックデジットが違う番号は送る前に止める", !!badCd && /チェックデジット/.test(badCd.message))
    const len = await throws(async () => buildShippingRequestXml({ customerId: "c", loginPassword: "p", issue: true, okuriCode: "N01", shippingNumberType: 1, details: [{ ...detail, shippingNumber: "12345678901" }] }, TODAY), BizLogiValidationError)
    check("12桁でない番号は送る前に止める", !!len && /12桁/.test(len.message))
    const sysWithNum = await throws(async () => buildShippingRequestXml({ customerId: "c", loginPassword: "p", issue: false, details: [{ ...detail, shippingNumber: n1 }] }, TODAY), BizLogiValidationError)
    check("システム採番で番号を送ろうとしたら止める", !!sysWithNum)
    const m = mockFetch(() => ({ body: OK_RESPONSE }))
    await new BizLogiClient({ ...CONFIG, numbering: "customer" }, m.impl).checkShipping([{ ...detail, shippingNumber: n1 }], TODAY)
    check("クライアント: 顧客側採番の設定なら区分 1 で送る", String(m.calls[0]?.body ?? "").includes("<shippingNumberType>1</shippingNumberType>"))
    const cfgDefault = bizLogiConfigFromEnv({ BIZLOGI_BASE_URL: "https://beccl-st.biz-blue.net/api", BIZLOGI_ENV: "test", BIZLOGI_CUSTOMER_ID: "x", BIZLOGI_LOGIN_PASSWORD: "y" })
    check("設定の既定はシステム採番 (BIZLOGI_NUMBERING 未設定)", cfgDefault.numbering === "system")
    const cfgCustomer = bizLogiConfigFromEnv({ BIZLOGI_BASE_URL: "https://beccl-st.biz-blue.net/api", BIZLOGI_ENV: "test", BIZLOGI_CUSTOMER_ID: "x", BIZLOGI_LOGIN_PASSWORD: "y", BIZLOGI_NUMBERING: "customer" })
    check("顧客側採番は BIZLOGI_NUMBERING=customer と明示したときだけ", cfgCustomer.numbering === "customer" && bizLogiConfigFromEnv({ BIZLOGI_BASE_URL: "https://beccl-st.biz-blue.net/api", BIZLOGI_ENV: "test", BIZLOGI_CUSTOMER_ID: "x", BIZLOGI_LOGIN_PASSWORD: "y", BIZLOGI_NUMBERING: "Customer " }).numbering === "system")
    const m0 = mockFetch(() => ({ body: OK_RESPONSE }))
    await new BizLogiClient(cfgDefault, m0.impl).checkShipping([detail], TODAY)
    check("クライアント: 既定 (システム採番) では採番区分も番号も送らない", !String(m0.calls[0]?.body ?? "").includes("shippingNumber"))
    check("利用実績の照合: 発行数 = 受付済み → 発行されていない可能性", judgeUsage({ sagawaCount: 3, localAccepted: 3, localUnknown: 1 }).verdict === "likely_not_issued")
    check("利用実績の照合: 発行数 = 受付済み + 結果不明 → 発行されている可能性", judgeUsage({ sagawaCount: 4, localAccepted: 3, localUnknown: 1 }).verdict === "likely_all_issued")
    check("利用実績の照合: 結果不明2件のうち1件だけ → 件数では決められない", judgeUsage({ sagawaCount: 4, localAccepted: 3, localUnknown: 2 }).verdict === "ambiguous")
    check("利用実績の照合: 合わない → 世田谷・SG へ", judgeUsage({ sagawaCount: 9, localAccepted: 3, localUnknown: 1 }).verdict === "mismatch")
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
