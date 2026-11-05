# WhatsApp 自動応答 Webhook

顧客が BondEx の WhatsApp 番号へ **予約番号（BDX-…）または佐川/ヤマトの追跡番号** を送ると、
配送状況を自動返信する。顧客起点＝24時間のカスタマーサービス枠内なので、返信は自由文
（テンプレート審査は不要）。

- エンドポイント: `POST/GET https://bondex.express/api/whatsapp/webhook`
- 実装: `app/api/whatsapp/webhook/route.ts` / `lib/whatsapp.ts` / `lib/whatsapp-tracking.ts`
- 検索キー: `shipments.booking_id`（バウチャー番号）/ `shipments.tracking_numbers[]`（キャリア追跡番号）

## 必要な環境変数（Vercel）

| Key | 用途 | 備考 |
|---|---|---|
| `WHATSAPP_CLOUD_TOKEN` | 返信の送信（System User 永続トークン） | 設定済み |
| `WHATSAPP_PHONE_NUMBER_ID` | 送信元番号ID | 設定済み |
| `WHATSAPP_WEBHOOK_TOKEN` | GET 検証トークン（任意のランダム文字列） | Meta と同じ値を入れる |
| `WHATSAPP_APP_SECRET` | POST の署名検証（Meta アプリの App Secret） | **必須。未設定だと POST はすべて 401**（2026-11-07 監査 B-11。以前は未設定だと検証をスキップしていた） |

## DB migration

`sql/045_whatsapp_processed.sql` を Supabase で実行（べき等性＝重複返信防止）。

## Meta 側の設定（手動）

1. Meta アプリ → WhatsApp → **Configuration / 設定** → Webhook。
2. **コールバックURL**: `https://bondex.express/api/whatsapp/webhook`
3. **検証トークン**: `WHATSAPP_WEBHOOK_TOKEN` と同じ値。
4. **購読フィールド**: `messages` を ON。
5. ⚠️ アプリが **公開(Live)** でないと本番の顧客メッセージは届かない（非公開はテストWebhookのみ）。
   本番運用にはアプリ公開＋ビジネス認証が必要。

## テスト（curl）

**1. Webhook 検証（GET）** — `WHATSAPP_WEBHOOK_TOKEN=your_token` を設定して:
```bash
curl -s "http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=test_challenge_123&hub.verify_token=your_token"
# 期待: test_challenge_123
```

**2. メッセージ受信（POST）** — 署名は必須（Meta の仕様: `X-Hub-Signature-256: sha256=<本文のバイト列の HMAC-SHA256（鍵 = App Secret）の16進>`）。
ローカルで試すときは、手元の試験用の鍵で署名を作って付ける（本番の App Secret を手元のコマンドに書かない）:
```bash
BODY='{"entry":[{"changes":[{"value":{"contacts":[{"wa_id":"819000000000"}],"messages":[{"from":"819000000000","id":"wamid.test1","type":"text","text":{"body":"BDX-7Q2KPG"}}]}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" -hex | sed 's/^.* //')"
curl -s -X POST "http://localhost:3000/api/whatsapp/webhook" -H "Content-Type: application/json" -H "X-Hub-Signature-256: $SIG" --data-binary "$BODY"
# 期待: {"success":true}  (返信は WHATSAPP_CLOUD_TOKEN 設定時のみ実送信)。署名なし・不一致・鍵の未設定は 401
```
自動の試験: `npm run test:whatsapp-signature`（外へは送らない）。

**3. 重複メッセージ（べき等性）** — 同じ `id` で2回 POST → 2回目は返信をスキップ
（`whatsapp_processed` の unique 制約で検知）。

## 制限・今後

- Phase 1: テキストのみ。画像/ファイルは対象外。
- Phase 2: WhatsApp Flows（ボタン/フォームUI）統合。
- 注意: WhatsApp は日本での普及が低い（主に海外/訪日客向け）。国内向けは LINE / メールが有効。
