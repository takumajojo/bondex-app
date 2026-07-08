# support@bondex.express メール設定 手順書

作成: 2026-07-03 / 対象: 谷口さん (Namecheap + Vercel + Gmail 前提)

## 現状 (2026-07-03 時点の DNS 実態)

`dig` で確認した bondex.express の DNS:

| 種別 | 値 | 意味 |
|---|---|---|
| NS | dns1/dns2.registrar-servers.com | **Namecheap BasicDNS** で管理 |
| MX | eforward1〜5.registrar-servers.com | **Namecheap メール転送が既に有効** |
| TXT(SPF) | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | 転送用 SPF 設定済み |
| A(@) | 76.76.21.21 | Vercel (サイト本体) |
| CNAME(www) | cname.vercel-dns.com | Vercel |

→ **メール転送の土台はできている。あとは転送ルールを 1 つ足すだけ。**
→ **Cloudflare へは移さない** (ネームサーバー移管で Vercel サイトを落とすリスクがあり、
  Namecheap 転送が使える今そのリスクを取る意味がない)。

---

## Part A: 受信を有効化する (5 分・無料・今すぐ)

ゲスト/ホテルが support@bondex.express に送ったメールを、既存の Gmail
(例: taniguchi@jojo-tokyo.com) に転送する。

1. https://ap.www.namecheap.com/ にログイン
2. Domain List → **bondex.express** の右の「MANAGE」
3. 上部タブ **Advanced DNS**(または Domain タブ内の「Redirect Email / Mail Settings」)
   - Mail Settings が **Email Forwarding** になっていることを確認 (既にそのはず)
4. **Redirect Email / Email Forwarding** セクションで「ADD FORWARDER」:
   - Alias: `support`
   - Forwards to: `taniguchi@jojo-tokyo.com` (受け取りたい実在の Gmail)
5. 保存 (反映は数分〜最大 30 分)

### 動作確認
- 別のメールから `support@bondex.express` 宛に送る → 指定 Gmail に届けば OK
- バウチャー/How to ship の QR (mailto:support@bondex.express) もこれで機能する

> 補足: 迷子防止に `info` や `hello` など複数エイリアスをまとめて `support` と
> 同じ Gmail に転送しておくと取りこぼしがない。

---

## Part B: 配送アラートの送信を有効化する (Resend・別作業)

lib/ops-alert.ts は配送の異常系 (遅延・調査中・集荷漏れ 等) を
support@bondex.express + ランオペ宛にメールで飛ばす。これは **送信** なので
Part A (受信) とは別に Resend のドメイン検証が必要。

1. https://resend.com にサインアップ → **Domains** → Add Domain → `bondex.express`
2. Resend が表示する DNS レコード (SPF/DKIM/場合により MX) を **Namecheap の
   Advanced DNS に追加**:
   - 既存の転送用 SPF (`v=spf1 include:spf.efwd... ~all`) と Resend の SPF を
     **1 本にマージ**する (SPF は 1 ドメイン 1 レコードのみ)。例:
     `v=spf1 include:spf.efwd.registrar-servers.com include:_spf.resend.com ~all`
   - DKIM の CNAME/TXT は Resend の指示どおり追加
3. Resend で「Verified」になったら **API Key** を発行
4. Vercel → bondex アプリ → Settings → Environment Variables に追加:
   - `RESEND_API_KEY` = 発行したキー
   - (任意) `ALERT_EMAIL` = 通知の宛先 (既定 support@bondex.express)
   - (任意) `ALERT_FROM_EMAIL` = 差出人 (既定 "BondEx Alerts <alerts@bondex.express>")
5. 再デプロイ後、配送異常時に BondEx + ランオペへメールが飛ぶようになる
   (未設定でもアラートは console.error に残るので取りこぼしはしない)

---

## Part C (任意・後回し可): support@ から「返信」する

Namecheap の無料転送は**受信のみ**。届いたメールに Gmail から普通に返信すると
差出人が個人/会社アドレス (taniguchi@jojo-tokyo.com) になり、support@ にならない。
support@bondex.express の名前で返信したい場合のみ、Gmail の「名前を指定して送信」
(Send mail as) に SMTP を設定する:

- **一番安い方法**: Part B で Resend を設定済みなら、Resend の SMTP
  (smtp.resend.com / 587 / user: `resend` / pass: API Key) を Gmail の
  「他のメールアドレスを追加」で登録 → support@bondex.express として返信可能。
- または Namecheap Private Email (有料・月数百円) を契約すると専用の受信箱 +
  SMTP が付く。

初期は Part A (受信) だけで十分。返信を support@ 名義にしたくなったら Part C。

---

## やることチェックリスト

- [ ] Part A: Namecheap で support → Gmail の転送ルール追加 (必須・今すぐ)
- [ ] Part B: Resend でドメイン検証 + Vercel に RESEND_API_KEY (配送アラート送信)
- [ ] Part C: Gmail Send-as で support@ 名義の返信 (任意・後回し可)
- WhatsApp は別タスク (アカウント作成後 Vercel に BONDEX_WHATSAPP_URL)
