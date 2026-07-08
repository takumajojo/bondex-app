# 別 PC で開発する手順 (BondEx)

コードは GitHub (`takumajojo/bondex-app`) に全て push 済み。
別 PC では「クローン → セットアップ → 環境変数」の 3 ステップで動く。

## 前提 (別 PC に必要なもの)

- **Git**
- **Node 20 以上**(推奨。現行は Node 24 で確認)+ npm — https://nodejs.org
- (推奨) **Vercel CLI** — 秘密情報を手でコピペせず一括取得するため
- (フォント差し替え時のみ) Python 3 + `pip install fonttools`

## 手順

```bash
# 1. クローン
git clone https://github.com/takumajojo/bondex-app.git
cd bondex-app

# 2. セットアップ (依存インストール + patch-package 自動適用)
bash scripts/setup.sh
#   ↑ 中で npm install が走る。postinstall で textkit のパッチ (日本語の
#     ハイフンなし改行) が自動適用される。フォントは patch 済みでコミット済み。

# 3. 環境変数 (どちらか)
#   【推奨】Vercel から一括取得:
npm i -g vercel
vercel login
vercel link            # 対象プロジェクト (bondex) を選ぶ
vercel env pull .env.local

#   【手動】テンプレートから:
cp .env.example .env.local
#   → Vercel の Project Settings → Environment Variables を見て値を埋める

# 4. 起動 / ビルド
npm run dev            # http://localhost:3000
npm run build          # 本番ビルド確認
```

## リポジトリに「入っているもの / 入っていないもの」

| 入っている (クローンで揃う) | 入っていない (別途) |
|---|---|
| ソース全部 / 依存定義 | 環境変数 (.env*) — Vercel から pull |
| U+2009 パッチ済みフォント (public/fonts) | Supabase の実データ |
| textkit の patch-package パッチ (patches/) | — |
| 公開サンプル PDF/PNG (public/samples) | — |

## 注意点

- **秘密情報は git に無い**。`.env*` は .gitignore 済み。`.env.example` は変数名だけ
  (値なし) で共有。実値は Vercel が一次情報。
- **フォントの再パッチは通常不要**。フォントファイルを差し替えたときだけ
  `python3 scripts/patch-fonts-thinspace.py` を実行 (U+2009 の幅0グリフを再付与)。
- **DB マイグレーション**: 新しい Supabase プロジェクトに向ける場合のみ、
  `sql/*.sql` を番号順に SQL Editor で実行 (既存の本番 DB を使うなら不要)。
- **Claude の作業コンテキスト** (~/JOJO/state/bondex.md, ~/.claude のメモリ) は
  リポジトリ外のローカルファイル。別 PC には引き継がれない。必要なら
  その 2 ファイルを手動でコピーする (git には含めない — 業務メモのため)。

## 動作チェック (別 PC で通ればOK)

```bash
npm run build          # ✓ Compiled successfully が出れば環境は正常
npm run dev            # /operator を開いて発行フローが動くか
```
