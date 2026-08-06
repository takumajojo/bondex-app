# 02. リレーション / ロールアップ / 関数

Notionのリレーションは **双方向**（一方を作ると相手側に自動でプロパティができる）です。
下表は「1本のリレーション」を1行で表し、両側のプロパティ名を示します。**この本数だけ作れば配線完了**です。

## 2.1 リレーション一覧（これで全接続）

| # | A側DB.プロパティ | B側DB.プロパティ | 種別 |
|---|------------------|------------------|------|
| R1 | DMC.**Meetings** | Meetings.**会社** | 1:N |
| R2 | DMC.**Documents** | Documents.**関連DMC** | 1:N |
| R3 | DMC.**PoC** | PoC.**参加企業** | N:N |
| R4 | DMC.**PoC(ランドオペ)** | PoC.**ランドオペ** | 1:N |
| R5 | DMC.**Travelers** | Travelers.**ランドオペ** | 1:N |
| R6 | DMC.**Stakeholders** | Stakeholders.**関連DMC** | N:N |
| R7 | DMC.**Decision Log** | Decision Log.**関連DMC** | N:N |
| R8 | Meetings.**関連先(Stakeholder)** | Stakeholders.**Meetings** | N:N |
| R9 | Meetings.**関連PoC** | PoC.**Meetings** | N:N |
| R10 | Meetings.**添付資料** | Documents.**関連Meeting** | N:N |
| R11 | Travelers.**PoC** | PoC.**Travelers** | 1:N |
| R12 | Travelers.**利用ホテル** | Stakeholders.**利用実績(Travelers-ホテル)** | N:N |
| R13 | Travelers.**購入店舗** | Stakeholders.**購入実績(Travelers-店舗)** | N:N |
| R14 | Stakeholders.**PoC** | PoC.**ホテル** / **空港** | N:N |
| R15 | Stakeholders.**Documents** | Documents.**関連Stakeholder** | N:N |
| R16 | PoC.**Documents** | Documents.**関連PoC** | N:N |
| R17 | PoC.**Decision** | Decision Log.**関連PoC** | N:N |
| R18 | Documents.**関連Decision** | Decision Log.**関連Documents** | N:N |

> R3とR4はDMC↔PoC間の2本（「参加企業=複数」「ランドオペ=主担当1社」）。用途が違うので別リレーションにする。
> R14は「ホテル」「空港」の2ロールをPoC側で別プロパティにし、Stakeholders側の1プロパティ`PoC`で受ける
> （Notionは同一2DB間の複数リレーションを許容。混乱を避けるため命名を明確に）。

## 2.2 Rollup 定義

Rollupは「Relation経由で相手DBの値を集計」する。設定は Relation選択 → 対象プロパティ → 計算方法。

| DB | Rollupプロパティ | 経由Relation | 対象プロパティ | 計算 |
|----|------------------|-------------|---------------|------|
| DMC | Meeting数 | Meetings | （任意） | Count all |
| DMC | 最新Meeting日 | Meetings | 日時 | Latest date |
| DMC | PoC数 | PoC | （任意） | Count all |
| DMC | 累計配送件数 | Travelers | 配送件数 | Sum |
| PoC | 実績参加人数 | Travelers | 旅行人数 | Sum |
| PoC | 実績配送件数 | Travelers | 配送件数 | Sum |
| PoC | 実績配送金額 | Travelers | 配送金額 | Sum |

## 2.3 Formula 定義

Notionの新Formula構文（`prop("名前")`）で記載。プロパティ名は日本語のまま参照可。

### DMC.要フォロー
次回アクション期日が今日以前なら警告。空なら空白。
```
if(
  empty(prop("次回アクション期日")),
  "",
  if(
    dateBetween(prop("次回アクション期日"), now(), "days") <= 0,
    "⚠️ 要フォロー",
    "🟢 予定あり"
  )
)
```

### Travelers.旅行日数
```
if(
  or(empty(prop("旅行開始日")), empty(prop("旅行終了日"))),
  0,
  dateBetween(prop("旅行終了日"), prop("旅行開始日"), "days") + 1
)
```

### Travelers.一人あたり配送金額
```
if(prop("旅行人数") > 0, round(prop("配送金額") / prop("旅行人数")), 0)
```

### Travelers.一件あたり重量
```
if(prop("配送件数") > 0, round((prop("配送重量") / prop("配送件数")) * 10) / 10, 0)
```

### PoC.期間(日)
```
if(
  or(empty(prop("開始日")), empty(prop("終了日"))),
  0,
  dateBetween(prop("終了日"), prop("開始日"), "days") + 1
)
```

### PoC.利用率（表示形式: パーセント）
```
if(prop("目標配送件数") > 0, prop("実績配送件数") / prop("目標配送件数"), 0)
```
> プロパティの表示形式(Number format)を **Percent** にすると 0.87 → 87% と表示。

### PoC.達成率(売上)（表示形式: パーセント）
```
if(prop("目標売上") > 0, prop("実績配送金額") / prop("目標売上"), 0)
```

### Decision Log.要見直し（任意の便利Formula）
```
if(
  empty(prop("次回見直し日")),
  "",
  if(dateBetween(prop("次回見直し日"), now(), "days") <= 0, "🔁 見直し時期", "")
)
```

## 2.4 分析用の派生ビュー（Rollupを増やさず、ビューのGroup/集計で見る）

過剰なRollupを作らず、Travelersの数値はビュー側の **Group by + Sum** で分析する（[04-dashboard.md](./04-dashboard.md)参照）。

| 分析 | ビュー設定 |
|------|-----------|
| 国別配送件数 | Travelers を `国籍` でGroup、`配送件数` の列でSum |
| 月別需要 | Travelers を `旅行開始日`(月) でGroup、`旅行人数`/`配送件数` Sum |
| ランドオペ別売上 | Travelers を `ランドオペ` でGroup、`配送金額` Sum |
| 空港別 | Travelers を `帰国空港` でGroup |
| トラブル率 | Travelers を `トラブル有無` でGroup、Count |
