# BondEx

> インバウンド旅行者の手荷物を、宿泊施設からホテル・空港・自宅まで配送する「ハンズフリー観光」プラットフォーム

[![Built with Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)

---

## 概要

**BondEx** は、訪日インバウンド旅行者の「重い荷物を引きずって観光する」という課題を解決するための、荷物配送サービスのデジタル基盤です。宿泊施設・配送事業者・旅行者を接続し、チェックアウト後の手荷物を次の宿泊先・空港・自宅まで安全に届けます。

単なる荷物配送ツールではなく、**現場の例外処理を最小化する「Decision OS」** として設計されています。通常運用時は静かに動作し、例外発生時にのみ次のアクションを宿泊施設スタッフに提示する——という設計思想で、限られた人員でもオペレーションが回るプロダクト構造を目指しています。

---

## 解決する課題

- 訪日旅行者のチェックアウト後の荷物移動負担(観光時間の損失、移動の物理的制約)
- 宿泊施設フロントでの一時保管スペース不足
- 国内配送インフラ(ヤマト・佐川)の英語対応不足
- 荷物受け渡し時の認証・トラブル対応の属人化

---

## プロダクト構成

3つのロール別UIで構成されています。

### 🧳 Traveler(旅行者)
モバイルファーストのWebアプリ。荷物個数・サイズ入力、配送先選択、希望日時、決済までを完結。多言語対応(英語/日本語/中国語ほか)。

### 🏨 Hotel Staff(宿泊施設スタッフ)
タブレット/モバイル向けWebアプリ。荷物のチェックイン処理、注文一覧、例外対応フロー、簡易ログイン認証。

### 🛠 Admin / CS(管理者・カスタマーサポート)
デスクトップ向けダッシュボード。ホテル登録・管理、注文一覧、決済失敗対応、運用全体の可視化。

---

## 技術スタック

| 領域 | 採用技術 |
|------|---------|
| フレームワーク | Next.js 16 (App Router) |
| UIライブラリ | React 19 |
| 言語 | TypeScript 5 |
| スタイリング | Tailwind CSS 4 |
| UIコンポーネント | Radix UI / shadcn/ui |
| フォーム | React Hook Form + Zod |
| 決済 | Stripe |
| 配送連携 | Ship&co API |
| 地図・施設情報 | Google Maps Platform / Places API |
| 荷物画像解析 | Anthropic Claude API |
| QRコード | qrcode / jsQR |
| 可視化 | Recharts / Mermaid |
| デプロイ | Vercel |

---

## セットアップ

### 必要環境

- Node.js 20以上
- npm 10以上

### インストール

```bash
git clone https://github.com/takumajojo/bondex-app.git
cd bondex-app
npm install
```

### 環境変数

プロジェクトルートに `.env` ファイルを作成し、以下を設定してください。

```env
NEXT_PUBLIC_BACKEND_URL=
NEXT_PUBLIC_SHIPANDCO_TEST=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
GOOGLE_MAPS_API_KEY=
ANTHROPIC_API_KEY=
```

### 開発サーバー起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 にアクセス。

### 本番ビルド

```bash
npm run build
npm run start
```

---

## ディレクトリ構成

---

## 既知の制約 (POC段階の限界)

本リポジトリは POC (Proof of Concept) として外部バックエンドへの依存を排除し、
すべての機能を Next.js 単体で完結させている。本番運用に向けて以下の制約がある:

### 写真アップロード (in-memory Map 保管)
- サーバープロセスが再起動すると保管中の画像はすべて消失する
- 開発時 (`npm run dev`) はファイル編集による HMR でも Map がリセットされる
- Vercel Serverless Functions で動かす場合、upload と GET が別 Lambda インスタンスに
  振られる可能性があり 404 になり得る
- 本番では Vercel Blob / Cloudinary / S3 などの外部ストレージに移行が必要

### 注文管理 (localStorage 保管)
- ブラウザの localStorage に保管されるため、シークレットモードでは消失
- 異なるデバイス・ブラウザ間で同期されない
- ブラウザのストレージクォータ超過で書き込み失敗の可能性
- 本番では DB (PostgreSQL / Supabase / Neon 等) への移行が必要

### Ship&co 連携 (スタブ化)
- 配送ラベル生成・追跡・キャリア一覧 等は POC ではスタブ化されており、
  UI 上で「Feature not available in POC」のエラーが表示される
- 本格運用 (BondEx v3) では Ship&co API への直接連携を実装予定

### Stripe 決済
- Test mode (sk_test_...) で動作することを前提としている
- Live mode (sk_live_...) への切り替えは本番デプロイ時に環境変数を変更
