"use client";

import React from "react";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  GitBranch,
  History,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";


const requirements = {
  lastUpdated: "2026-02-09",
  version: "6.4.0",

  
  overview: {
    title: "BondEx Phase 1 要件定義書",
    catchphrase: "Enjoy a miniature 36-hour adventure without luggage",
    purpose: {
      title: "目的（Why BondEx?）",
      items: [
        {
          label: "旅行者の解放",
          description:
            "「荷物を持たずに移動したい」というインバウンド旅行者の潜在需要を解放し、「中抜き宿泊（Skip-stop travel）」による自由な回遊行動（寄り道消費）を創出する。",
        },
        {
          label: "フロント業務のゼロ化",
          description:
            "アナログな配送手続き（伝票記入・計測・現金授受）を撤廃し、宿泊施設の負担を「限りなくゼロ」にする。",
        },
        {
          label: "プロフィットセンター化",
          description:
            "荷物預かり業務を「コスト（無料奉仕）」から「収益源（プロフィット）」へ転換させる。",
        },
      ],
    },
    designPhilosophy:
      "Decision OS - 人間の判断を完全に排除する剛直な物流ステートマシン。人間は事実の入力（写真撮影・制約条件の提供）のみ行い、すべての判定・状態遷移・例外処理はシステムが自動で実行する。Approve/Reject/Confirm/Choose は一切存在しない。写真が唯一の真実の情報源（Single Source of Truth）であり、撮影した瞬間にアクションが自動確定する。",
  },

  
  phase1Scope: {
    targetArea: "日本全国",
    routes: {
      from: "BondEx提携ホテル（システム導入済み拠点）",
      to: "日本全国の任意の施設・住所（ホテル・旅館・空港・駅・デポ等。施設名検索または手動住所入力で指定）",
    },
    carrier: "提携配送業者（ヤマト運輸・佐川急便等）の通常便",
    exclusions: ["個人宅宛", "当日便"],
  },

  
  actors: [
    {
      id: "user",
      name: "ユーザー（旅行者）",
      responsibilities: [
        "スマホで全て完結（入力・決済）",
        "自己責任原則: 荷物の状態証明（写真撮影）、重量制限への同意",
        "貼り付け作業（Self-Labeling）: 発行されたシール伝票を自分で荷物に貼り付ける",
      ],
    },
    {
      id: "hotel",
      name: "ホテル（発送元）",
      responsibilities: [
        "場所の提供",
        "QRスキャン → 荷物写真撮影（撮影で自動的に受付完了。判断は一切不要）",
        "シール出力と手渡し",
        "荷物の引き渡し",
        "問題がある場合のみ「Flag issue」（理由入力なし、システムが非同期処理）",
        "日英切替対応（Language Switcher）",
      ],
      exclusions: [
        "Accept / Reject の判断",
        "理由の選択・入力",
        "確認ダイアログへの応答",
        "伝票の手書き作成",
        "現金授受",
        "配送日の確約",
        "梱包",
        "ユーザー端末とのペアリング操作",
        "配送停止の判断",
        "ステータスの手動変更",
        "サイズの編集",
        "決済操作",
      ],
    },
    {
      id: "system",
      name: "BondExシステム",
      responsibilities: [
        "配送判定ロジック",
        "料金計算",
        "決済（差額請求含む）",
        "Ship&co連携（ラベル生成）",
        "トラブル対応窓口（CS）",
      ],
    },
    {
      id: "carrier",
      name: "配送業者（Carrier）",
      responsibilities: [
        "集荷",
        "配送",
        "※集荷時には既に「正規の配送伝票」が貼られている状態とする",
      ],
    },
  ],

  
  dataStructure: {
    units: [
      "1 Package = 1 Tag = 1 伝票（Label）",
      "1 Order: ユーザーの1回の決済単位（複数Packageを包含可能）",
    ],
    qrTag: {
      description: "ホテルに常備される使い捨て紙タグ（ID識別用）",
      states: ["UNUSED（在庫）", "ASSIGNED（紐付け済）", "INVALIDATED（使用済/破損）"],
    },
  },

  
  businessFlow: [
    { step: 1, name: "依頼", description: "ユーザーが客室/ロビーでQRをスキャンし、WEBアプリを起動" },
    { step: 2, name: "入力", description: "荷物情報（サイズ選択・コンディション写真任意）、配送先、配送希望日・時間帯を入力" },
    { step: 3, name: "決済", description: "システムが算出した変動料金を支払う" },
    {
      step: 4,
      name: "受付",
      description:
        "ユーザーが物理タグを荷物に装着し、フロントへ提示。スタッフがホテル端末でQRをスキャン",
    },
    {
      step: 5,
      name: "印刷",
      description: "スキャンと同時に、ホテルのプリンターから配送伝票（シール）が出力される",
    },
    { step: 6, name: "貼付", description: "スタッフがシールをちぎって渡し、ユーザー自身が荷物に貼る" },
    {
      step: 7,
      name: "集荷",
      description: "配送業者が、荷物に貼られた伝票バーコードをスキャンして集荷完了",
    },
  ],

  
  statusTransitions: {
    statuses: [
      { code: "CREATED", name: "データ作成済み" },
      { code: "PAID", name: "決済完了" },
      { code: "CHECKED_IN", name: "ホテル受付完了（兼 伝票発行・印刷済み）" },
      { code: "HANDED_TO_CARRIER", name: "集荷完了（配送業者へ引渡済）" },
      { code: "IN_TRANSIT", name: "配送中" },
      { code: "DELIVERED", name: "配達完了（売上確定）" },
      { code: "AUTO_CANCELLED", name: "自動キャンセル（締切時刻経過）" },
      { code: "CARRIER_REFUSED", name: "配送業者による引受不可" },
    ],
    cancelPolicy:
      "CHECKED_IN（受付完了）以降のキャンセル・返金は不可。PAIDのままCHECKED_INに遷移しない取引は、所定の締切時刻経過後に自動キャンセル（AUTO_CANCELLED）とし、返金対象とする。",
    autoCancelDeadline:
      "ホテル設定の集荷締切を優先し、未設定の場合はデフォルト値（当日22:00）を適用",
  },

  
  pricingEngine: {
    concept: "ユーザーへの請求額（Sales）と配送業者への原価（Cost）を明確に分離",
    calculation: [
      "Zone判定: 発送元・発送先の郵便番号から配送ゾーンを判定",
      "Price Table参照: 内部マスタ（BondEx Pricing Master）を参照し、サイズごとの販売価格を決定",
      "計算式: User_Price = Carrier_Cost（原価）+ BondEx_Margin（手数料/利益）",
    ],
    surchargePolicy: {
      principle: "荷物は送り返さず、差額を徴収して配送する",
      flow: [
        "配送業者が重量オーバーを指摘",
        "CSまたはフロントが管理画面でサイズ区分を変更",
        "システムが差額を計算し、保存済みトークン（Off-Session Payment）で即時決済を実行",
      ],
    },
    paymentFailureHandling: {
      system:
        "追加決済が不成立（Decline）となった場合、システムは配送ステータスを維持し、「決済要確認」フラグを設定のうえ、CS部門へのアラート通知のみを実施",
      operation:
        "当該取引につきましては、BondEx CSがお客様と個別に連絡を取り、回収対応。システムによる配送の停止・制御機能は実装しない",
    },
  },

  
  hotelPayout: {
    formula: "Payout = Fixed Reward（報酬: 配送料の15%）+ Actual Carrier Cost（立替原価の実費）",
    costDetermination:
      "ラベル発行時およびサイズ変更時に、Ship&co APIまたはマスタから取得した「実際の配送料金」をDB上の actual_carrier_cost カラムに保存・更新",
  },

  
  notificationPolicy: {
    channels: [
      { type: "SMS", status: "認証コード送信用（Contact Info Step 4）。配送通知には使用しない。" },
      {
        type: "Email",
        status: "AWS SES / SendGrid / Resend を利用、BondExドメインから送信",
        note: "Ship&coのヤマト運輸自動通知メールはOFF（フィッシング詐欺誤認防止）。認証コード送信にも使用。",
      },
    ],
    timing: ["認証コード送信（Email/SMS選択可）", "予約確定（booking_confirmed）", "集荷完了（追跡番号通知 / delivery_complete）", "ラベル生成（label_generated）", "例外発生時"],
    emailApi: "/api/email - 3種類のメールテンプレート（booking_confirmed / delivery_complete / label_generated）。RESEND_API_KEY 未設定時はコンソールモック出力。",
  },

  
  dataRetention: {
    photos: "配送完了（DELIVERED）から7日間保持、その後自動削除",
    labelData: "再印刷用に30日間保持",
  },

  
  photoPolicy: {
    traveler: {
      maxPhotos: 3,
      purpose: "荷物状態の記録（最低1枚必須）。取っ手やキャスターが見える全体写真を推奨。複数枚に分けてもOK。",
      timing: "Step 3（Luggage Details）で撮影",
    },
    hotel: {
      maxPhotos: 3,
      purpose: "荷物状態の公式記録（ホテルスタッフがチェックイン時に撮影）",
      timing: "QRスキャン後に撮影。撮影完了で受付が自動確定。",
    },
    overrideRule: "ホテル撮影写真がゲスト撮影写真を上書きし、公式記録（Final Record）となる",
    sizeNote: "サイズ不一致は写真の問題ではなくシステムが自動調整するため、Reject理由にならない",
  },

  
  shipcoIntegration: {
    addressLogic: {
      input: "施設名検索（Google Places API）または手動住所入力（郵便番号・都道府県・市区町村・番地・建物名）",
      normalization: "郵便番号からShip&co指定の province/address1 をセット",
      guestInfo: "to_address.address2 の末尾に Ref: [Guest Name] C/I: [Date] を追記",
    },
    productMapping: [
      { field: "品名", value: "Clothes / 衣類 等（英語/日本語併記）" },
      { field: "申告価格", value: "一律 10,000 JPY（損害補償の申告用）" },
    ],
    sizeDefinitions: [
      { size: "S", dimensions: "100サイズ", weight: "10kg" },
      { size: "M", dimensions: "120サイズ", weight: "15kg" },
      { size: "L", dimensions: "160サイズ", weight: "20kg" },
      { size: "LL", dimensions: "200サイズ", weight: "25kg" },
    ],
    labelTrigger:
      "ホテルスタッフが荷物写真を撮影した瞬間に自動でAPIコールしてラベル取得・即時印刷（ボタン操作不要）",
  },

  
  printerPolicy: {
    hardware: {
      printer: "感熱式（Thermal）Bluetoothラベルプリンター（インク交換不要、メンテナンスフリー）",
      control: "ホテルの受付用タブレット/スマートフォンと常時ペアリング",
      prohibited: "ユーザー自身のスマホから直接印刷させる機能は実装しない",
    },
    labelSizes: [
      { carrier: "ヤマト運輸", size: "PDF_4.5X7.8" },
      { carrier: "佐川急便", size: "PDF_4.2X8.3_BLUE" },
    ],
    printContent: ["Size: [L]（最優先）", "C/I: [MM/DD]（受取日）"],
    selfLabeling: [
      "スタッフがスキャン → シールが出力される",
      "スタッフはシールをちぎってユーザーに渡す",
      "ユーザー自身が荷物にシールを貼り付ける（貼り間違い防止・自己確認）",
    ],
  },

  
  deliveryDateLogic: {
    earliestDate: [
      "17:00までの受付 → 最短配送日 = 明日",
      "17:00以降の受付 → 最短配送日 = 明後日",
    ],
    range: "最短日 〜 14日後の範囲で指定可能（途中で1泊旅行をするニーズに対応）",
    timeSlot: {
      description: "廃止（Decision OS v2）: 時間帯はシステムが自動割当。ユーザーに選択させない。",
      whenAvailable: [
        "全配送先: システムが配送先タイプ・業者スケジュールに基づき最適時間を自動決定",
        "'Automatically scheduled' を表示（ユーザーには選択UI非表示）",
      ],
      whenNotAvailable: [
        "空港・デポ・駅: 'Expected arrival: By XX:XX' + 'Automatically scheduled' を表示",
        "時間帯セレクタは全配送先で非表示",
      ],
    },
    timeSensitive: {
      description: "空港・デポなど時間制約のある配送先では、自動スケジューリングを適用",
      rules: [
        "空港宛: 'Flight time must be after 14:00 on the delivery date' を警告表示",
        "時刻入力（フリーフォーム）は実装しない。システム側で自動判定。",
        "ユーザーに判断を委ねる文言は使わない",
      ],
    },
    reassurance: {
      description: "不安軽減セクション（'Good to know'）を常時表示",
      items: [
        "ホテルフロントで受け取るため、本人不在でも問題ない",
        "ホテルスタッフが到着まで安全に保管する",
        "変更があればメールで通知される",
      ],
    },
  },

  
  userRoles: [
    {
      id: "traveler",
      name: "Traveler（旅行者）",
      device: "モバイル優先",
      description: "荷物配送を予約し、配送状況を追跡する",
      uxGoal: "「安心感の醸成」と「フロントへの質問回避」",
    },
    {
      id: "hotel",
      name: "Hotel Staff（施設スタッフ）",
      device: "タブレット（日英切替対応）",
      description: "QRスキャン → 写真撮影で自動受付完了。判断ゼロ。問題時のみ Flag issue。",
      uxGoal: "フロントスタッフは「判断しない」。写真撮影で自動確定。Accept/Reject/Confirm は存在しない。",
    },
    {
      id: "admin",
      name: "Admin/CS（管理者・カスタマーサポート）",
      device: "デスクトップ",
      description: "全体監視、例外対応、サイズ変更、決済失敗処理",
      uxGoal:
        "収益の可視化（「ホテルの受取報酬額」を強調）、アラート（集荷未完了、QR在庫不足）",
    },
  ],

  
  flows: {
    traveler: {
      name: "Traveler Flow",
      screens: [
        {
          id: "landing",
          name: "LP / 開始画面",
          path: "/?role=traveler&step=landing",
          description: "サービス紹介、予約開始のCTA。左上にHomeへ戻るボタン。",
          elements: [
            "キャッチコピー: 'Enjoy a miniature 36-hour adventure without luggage'",
            "ヒーローイラスト",
            "信頼メッセージ: 'Japan's delivery infrastructure, built in' / 'Reliable by design'",
            "Start Booking ボタン（単一CTA）",
            "左上: Home に戻るボタン（ChevronLeft + 'Home'）",
          ],
        },
        {
          id: "destination",
          name: "Step 1: 配送先・Trip Plan 入力",
          path: "/?role=traveler&step=destination",
          description: "施設検索、到着日時、Booking Name・予約確認書アップロード（必須）、受取人名。",
          elements: [
            "入力モード切替: Search / Enter address",
            "【Search モード】施設名検索（Google Places API連携）",
            "【Enter address モード】郵便番号、都道府県、市区町村、番地、建物名、施設名（任意）",
            "配送先タイプ自動判定: hotel / airport / depot / station / other",
            "【条件付き】Step 1.5: 類似施設が見つかった場合の確認画面（郵便番号 or 電話番号）",
            "Trip Plan セクション:",
            "  - Arrival Date（日付ピッカー）",
            "  - Arrival Time（時間のみ選択、分は:00固定、<select> 00:00〜23:00）",
            "  - 【条件付き】Flight Number（空港宛のみ表示）",
            "  - 【条件付き】空港宛: 'Flight time must be after 14:00' 警告表示",
            "Booking Name 入力（必須）",
            "Booking Confirmation アップロード（必須、画像/PDF対応、ファイル名・サイズ表示、削除可能）",
            "Recipient Name:",
            "  - 「Same as booking name」チェックボックス（デフォルトON）",
            "  - チェックOFF時のみ入力欄表示（入力必須）",
          ],
        },
        {
          id: "delivery-date",
          name: "Step 2: 配送日選択",
          path: "/?role=traveler&step=delivery-date",
          description: "日付のみ選択。時間帯はシステムが自動割当。ユーザーに時間の判断を委ねない。",
          elements: [
            "日付選択リスト（最短日 〜 14日後、Earliest possible バッジ付き）",
            "Logistics Promise: 到着予定時刻 + 'Automatically scheduled' 表示",
            "  - Time slot selector は廃止（Decision OS: 選択肢を排除）",
            "  - システムが配送先タイプ・配送業者スケジュールに基づき最適時間を自動決定",
            "【条件付き】空港宛: 'Flight time must be after 14:00' 警告表示",
            "不安軽減セクション（常時表示 'Good to know'）:",
            "  - ホテルフロント受取であること",
            "  - ユーザー不在でも問題ないこと",
            "  - 変更があればメール通知されること",
          ],
        },
        {
          id: "luggage",
          name: "Step 3: Luggage Details（荷物詳細）",
          path: "/?role=traveler&step=luggage",
          description: "写真撮影（最小1枚・最大3枚）、サイズ選択（自動推定）、推定重量入力。複数荷物に対応。",
          elements: [
            "写真セクション（ページ最上部）:",
            "  - 自由リスト形式（最小1枚必須、最大3枚）",
            "  - ガイド: 'Include handles and casters. Multiple photos OK.'",
            "  - 1枚目の写真でサイズ自動推定 → サイズカード・推定重量を自動選択",
            "  - 全写真削除時にサイズ・重量をリセット",
            "サイズカード 4種（S/M/L/LL）:",
            "  - 各カードに上限表示（例: 'Up to 100 cm | Up to 10 kg'）",
            "  - 自動推定時に 'Auto' バッジ表示",
            "  - infoアイコン → 寸法・重量のビジュアルモーダル",
            "推定重量入力（1kg刻み、自動推定時は 'Auto-estimated' 表示）",
            "Need Exact size? 計測説明セクション",
            "「Add another luggage」ボタン（複数荷物の一括登録）",
            "  - 2個目以降にアイテム番号ラベル + 削除ボタン",
            "Continue 押下時 → 確認モーダル（Before you continue）:",
            "  - 禁止物品の不含有確認（View list → 利用規約の Luggage Guidelines セクションへ）",
            "  - サイズ自動調整の説明",
            "  - 'By continuing, you agree to our Terms of Service.'（目立つ表示・背景付きカード）",
            "  - 'Agree and continue' ボタンで次画面へ（押さないと遷移不可）",
          ],
        },
        {
          id: "contact",
          name: "Step 4: 連絡先入力 + 認証",
          path: "/?role=traveler&step=contact",
          description: "Email・電話番号入力後、Email/SMS選択 → 6桁認証コード入力の3フェーズ認証フロー。",
          elements: [
            "Phase 1: 連絡先入力",
            "  - メールアドレス入力（必須）",
            "  - メールアドレス確認入力（一致バリデーション）",
            "  - 電話番号入力（必須、国コード付き）",
            "Phase 2: 認証方法選択",
            "  - Email / SMS 選択画面（マスク済みアドレス・番号を表示）",
            "Phase 3: 認証コード入力",
            "  - 6桁コード入力（1桁ずつ独立入力欄、ペースト対応、自動フォーカス移動）",
            "  - 60秒クールダウン付き再送ボタン（Resend code）",
            "  - 送信方法変更リンク（'Use SMS/email instead'）",
            "戻るボタン: フェーズに応じて動的遷移（verify→method→input→前画面）",
          ],
        },
        {
          id: "payment",
          name: "Step 5: 決済",
          path: "/?role=traveler&step=payment",
          description: "Apple Pay / Google Pay を優先表示。自動追加請求の説明を強調。",
          elements: [
            "料金表示:",
            "  - 各アイテムの明細（サイズ別単価）",
            "  - Pay now: 現在の確定金額（太字・大きく表示）",
            "  - Estimated total (max): サイズ差額が発生した場合の最大想定額",
            "自動追加請求の説明（料金カード内、背景付きカード）:",
            "  - 太字: 'Up to ~may be charged automatically'",
            "  - 説明: サイズ差額がこの決済方法に自動請求される旨 + メール通知",
            "決済手段レイアウト（上から順に全て常時表示）:",
            "  1. Apple Pay ボタン（黒背景）",
            "  2. Google Pay ボタン（白背景・ボーダー）",
            "  3. 'or' テキスト区切り線",
            "  4. クレジットカード入力フォーム（常時表示・非折りたたみ）",
          ],
        },
        {
          id: "completion",
          name: "Step 6: Booking Confirmed（予約確定）",
          path: "/?role=traveler&step=completion",
          description: "いつ・どこで・何をするかを3秒で理解できる構成。実QRコード生成。",
          elements: [
            "配送サマリーカード（QRの上、アイコン+短文、固定順）:",
            "  - Pickup from: ホテル名 + Front desk",
            "  - Deliver to: 配送先名 + 配送日 + 個数",
            "  - Check in by: 日付+17:00 太字 + 'Late check-in may delay your delivery'",
            "QRコード（qrcode ライブラリで実生成、注文IDをエンコード）:",
            "  - 'Show this at the hotel front desk'",
            "  - 注意書き: 'Scan only at hotel front desk' / 'QR becomes invalid after check-in'",
            "What to do（3ステップ、横並び、アイコン主体）",
            "CTA: 'View delivery status'（1つのみ）",
          ],
        },
        {
          id: "status",
          name: "Step 7: Delivery Status（配送状況詳細）",
          path: "/?role=traveler&step=status",
          description: "ユーザーが想定できる言葉でステータス表示。技術用語・内部状態は禁止。",
          elements: [
            "現在ステータス（上部固定・太字・強調色・大表示）:",
            "  - Booking confirmed → Waiting for hotel check-in → Picked up by carrier → In transit → Delivered",
            "タイムライン（縦型、完了/現在/未来で色分け）",
            "キャリアトラッキング（集荷後のみ表示）: 配送業者名 + 追跡番号（コピー可能）",
            "配送先表示（施設名+配送日）",
            "不安先回り文言 + Help連絡先",
          ],
        },
      ],
      footer: {
        description: "全画面共通フッター",
        links: [
          "Privacy Policy（/legal/privacy）",
          "Terms of Service（/legal/terms）",
          "SCTA - 特定商取引法に基づく表記（/legal/commercial-transactions）",
        ],
      },
    },
    hotel: {
      name: "Hotel Staff Flow",
      screens: [
        {
          id: "login",
          name: "ログイン",
          path: "/?role=hotel&step=login",
          description: "施設スタッフのログイン（日英切替対応）。デモ用認証情報マップ（SAKURA01 / KYOTO02 / OSAKA03 / DEMO）。",
          elements: [
            "Hotel Code 入力（施設ID）",
            "パスワード入力",
            "ログインボタン（バリデーション: ホテルコード未検出 / パスワード不一致エラー表示）",
            "sessionStorage によるセッション管理（8時間有効）",
            "デモ用ヒントボックス（DEMO / demo）",
            "Language Switcher（EN / JA）全画面共通",
          ],
        },
        {
          id: "order-list",
          name: "本日の受取一覧",
          path: "/?role=hotel&step=order-list",
          description: "本日到着予定の荷物一覧（3ステータスモデル）",
          elements: [
            "ホテル名・支店名をヘッダーに明記",
            "ステータスガイド（Legend）: 折りたたみ可、色+アイコン+文言",
            "  - 来館待ち（Waiting for guest）: 黄色 / 時計アイコン",
            "  - 配送業者引渡待ち（Ready for pickup）: 緑 / チェックアイコン",
            "  - フラグ済（Flagged）: 赤 / 旗アイコン（システムが非同期処理中）",
            "ステータスフィルタ（ピルボタン: All / 来館待ち / 引渡待ち / フラグ済）",
            "検索バー（予約ID / ゲスト名）",
            "Todayのオーダーは太字で強調",
            "各注文カード → タップで注文詳細画面へ",
            "QRスキャンボタン（FAB）",
          ],
        },
        {
          id: "order-detail",
          name: "注文詳細（閲覧専用）",
          path: "/?role=hotel&step=order-list",
          description: "注文情報・配送トラッキングの閲覧。編集不可。",
          elements: [
            "ステータス大表示",
            "ゲスト名・荷物数・サイズ・チェックイン日",
            "配送トラッキング（閲覧専用）: 配送業者名・追跡番号（コピー可）",
            "  - ステップ表示: 集荷待ち → 配送中 → 営業所留め → 配達完了",
            "配送シール再発行ボタン（来館待ち / 引渡待ちのみ、確認モーダル付き）",
            "「閲覧のみ。編集はできません。」注記表示",
          ],
        },
        {
          id: "check-in",
          name: "QRスキャン / 写真撮影",
          path: "/?role=hotel&step=check-in",
          description: "実カメラ起動 → BarcodeDetector APIでリアルタイムQRスキャン → 写真撮影で自動確定。",
          elements: [
            "QRスキャナー（実カメラ起動、BarcodeDetector API でリアルタイムスキャン）",
            "スキャン前: プロンプト画面（'Scan customer QR code'）",
            "スキャン成功 → 認証済みバッジ表示 + 荷物情報表示（ゲスト名・サイズ・チェックイン日）",
            "スキャン結果が注文IDと不一致時: アラートで不一致を通知",
            "ゲスト撮影写真の表示（参考用、あれば表示。なければ「No photos provided」）",
            "ホテル撮影エリア（最大3枚）: 荷物状態の公式記録。撮影完了で自動的に受付確定。",
            "「Capture luggage photo」ボタン（1枚撮影で受付確定 + ラベル印刷トリガー）",
            "Flag issue ボタン（控えめな表示、理由入力なし、タップのみ。システムが非同期処理）",
            "Accept / Reject / 確認ダイアログ / 理由選択 は一切なし",
          ],
        },
        {
          id: "accept-success",
          name: "受付完了 / 印刷",
          path: "/?role=hotel&step=accept-success",
          description: "写真撮影完了と同時にラベル自動印刷。確認画面なし。",
          elements: [
            "完了メッセージ: 「Luggage recorded」（Accept/承認の文言は使わない）",
            "ラベル印刷状況",
            "Self-Labeling案内: 「シールをゲストに渡し、本人に貼ってもらう」",
            "一覧に戻るボタン",
          ],
        },
        {
          id: "exception",
          name: "例外対応",
          path: "/?role=hotel&step=exception",
          description: "QR破損時の再紐付け（Re-assign）",
          elements: [
            "問題の種類選択",
            "手動での注文検索（予約ID / ゲスト名）",
            "再割り当て（再決済不要）",
          ],
        },
      ],
    },
    admin: {
      name: "Admin/CS Dashboard",
      screens: [
        {
          id: "overview",
          name: "ダッシュボード",
          path: "/?role=admin&step=overview",
          description: "収益可視化、要対応アラート",
          elements: [
            "Your Earnings（ホテルの受取報酬額）強調表示",
            "要対応アイテム（決済失敗、未回収、運送会社例外）",
            "アラート: 集荷未完了、QR在庫不足",
            "本日の統計",
          ],
        },
        {
          id: "orders",
          name: "Order一覧",
          path: "/?role=admin&step=orders",
          description: "全注文の検索・フィルタリング",
          elements: [
            "検索バー",
            "ステータスフィルター",
            "日付フィルター",
            "注文一覧テーブル",
          ],
        },
        {
          id: "order-detail",
          name: "Order詳細 / トラブル対応",
          path: "/?role=admin&step=order-detail",
          description: "Order編集・差額請求、手書き伝票モード",
          elements: [
            "注文情報全項目",
            "証拠写真ビューア（Evidence Photo）",
            "サイズ変更（Carrier Evidence Note必須）",
            "手書き伝票モード: プリンター故障時のフェイルセーフ",
            "[Nice to have] 追跡番号の手動登録（Manual Tracking Number）",
            "タイムラインログ",
          ],
        },
        {
          id: "payment-failure",
          name: "決済失敗一覧",
          path: "/?role=admin&step=payment-failure",
          description: "決済失敗の一覧と対応（配送は停止しない）",
          elements: [
            "決済失敗一覧",
            "リトライボタン",
            "手動解決オプション",
            "重要: 決済失敗でも配送は停止しない（CSが個別対応）",
          ],
        },
        {
          id: "hotels",
          name: "ホテル一覧",
          path: "/?role=admin&step=hotels",
          description: "登録済みホテルの一覧・検索・ステータス管理",
          elements: [
            "ホテル一覧（Active / Paused ステータス表示）",
            "検索（ホテル名・エリア）",
            "各ホテルの注文数表示",
            "Add new hotel ボタン",
          ],
        },
        {
          id: "hotel-register",
          name: "ホテル新規登録（Admin専用）",
          path: "/?role=admin&step=hotel-register",
          description: "配送動作・集荷ルール・キャリア設定を定義。契約条件は別管理。",
          elements: [
            "基本情報: ホテル名、支店名、住所、運用担当者連絡先",
            "配送・キャリア: 配送業者選択（Yamato/Sagawa）、集荷方式（定時/オンデマンド/持込）、カットオフ時刻、当日配送可否",
            "受取ルール: 受取可能時間帯、1日最大受付数、保管場所",
            "プリンター・ラベル: プリンタータイプ（Bluetooth感熱/USB感熱/なし）、ラベルサイズ（62mm/100mm）",
            "運用メモ: Admin内部メモ（ホテル・ゲストには非表示）",
          ],
        },
      ],
    },
  },

  
  kpiAccounting: {
    timezone: "すべてのイベント時刻（PAID / CHECKED_IN / HANDED_TO_CARRIER / DELIVERED）は JST で保存",
    dailyKpi: "業務KPI（日次）の集計日は、原則として CHECKED_IN の発生日時を基準とする",
    revenue: "ホテル売上の計上は DELIVERED 時点で確定",
    exclusions: "AUTO_CANCELLED / CARRIER_REFUSED 等の例外ステータスは、KPIにはカウントするが精算対象外",
  },

  
  legalPages: {
    description: "Traveler フッターからリンク。全ページ英語表記。",
    pages: [
      { name: "Privacy Policy", path: "/legal/privacy", sections: "情報収集、処理の法的根拠、利用目的、第三者共有・国際移転、データ保持、権利、セキュリティ、児童、海外ユーザー、決済処理、ポリシー変更、連絡先（全12セクション）" },
      { name: "Terms of Service", path: "/legal/terms", sections: "サービス概要、利用資格、予約と決済、荷物ガイドライン（#luggage-guidelines アンカー付き）、配送タイミング、紛失・破損、キャンセル、フェアユース、サービス変更、準拠法（全10セクション）" },
      { name: "SCTA（特定商取引法に基づく表記）", path: "/legal/commercial-transactions", sections: "販売業者、代表者、所在地、連絡先、価格、支払方法・時期、キャンセル規定等をテーブル形式で表記" },
    ],
  },

  
};


function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-muted/50 flex items-center justify-between text-left hover:bg-muted transition-colors"
      >
        <span className="font-medium">{title}</span>
        {isOpen ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>
      {isOpen && <div className="p-4">{children}</div>}
    </div>
  );
}

export default function RequirementsPage() {
  return (
    <div className="min-h-screen bg-background">
      {}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-muted-foreground" />
              <h1 className="font-semibold">Requirements Document</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>v{requirements.version}</span>
            <span>|</span>
            <span>Updated: {requirements.lastUpdated}</span>
          </div>
        </div>
      </header>

      {}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {}
        <Section title="1. プロジェクト概要と哲学">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold">{requirements.overview.title}</h3>
              <p className="text-sm text-muted-foreground italic mt-1">
                {requirements.overview.catchphrase}
              </p>
            </div>

            <div>
              <h4 className="font-medium mb-3">{requirements.overview.purpose.title}</h4>
              <div className="space-y-3">
                {requirements.overview.purpose.items.map((item, i) => (
                  <div key={i} className="border-l-2 border-accent pl-3">
                    <p className="font-medium text-sm">{item.label}</p>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-medium text-sm text-muted-foreground">Design Philosophy</h4>
              <p className="mt-1">{requirements.overview.designPhilosophy}</p>
            </div>
          </div>
        </Section>

        {}
        <Section title="1.2 Phase 1 スコープ">
          <div className="space-y-3 text-sm">
            <div className="flex gap-2">
              <span className="font-medium w-24 shrink-0">対象エリア:</span>
              <span>{requirements.phase1Scope.targetArea}</span>
            </div>
            <div className="flex gap-2">
              <span className="font-medium w-24 shrink-0">発送元:</span>
              <span>{requirements.phase1Scope.routes.from}</span>
            </div>
            <div className="flex gap-2">
              <span className="font-medium w-24 shrink-0">配送先:</span>
              <span>{requirements.phase1Scope.routes.to}</span>
            </div>
            <div className="flex gap-2">
              <span className="font-medium w-24 shrink-0">配送業者:</span>
              <span>{requirements.phase1Scope.carrier}</span>
            </div>
            <div className="flex gap-2">
              <span className="font-medium w-24 shrink-0">除外対象:</span>
              <span>{requirements.phase1Scope.exclusions.join("、")}</span>
            </div>
          </div>
        </Section>

        {}
        <Section title="2. 登場人物と責任分界">
          <div className="space-y-4">
            {requirements.actors.map((actor) => (
              <div key={actor.id} className="border border-border rounded-lg p-4">
                <h4 className="font-medium">{actor.name}</h4>
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">責任:</p>
                  <ul className="text-sm space-y-1">
                    {actor.responsibilities.map((r, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-muted-foreground">-</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {actor.exclusions && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">行わないこと:</p>
                    <ul className="text-sm space-y-1">
                      {actor.exclusions.map((e, i) => (
                        <li key={i} className="flex items-start gap-2 text-muted-foreground">
                          <span>x</span>
                          <span>{e}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        {}
        <Section title="3. 基本データ構造">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-sm mb-2">単位定義</h4>
              <ul className="text-sm space-y-1">
                {requirements.dataStructure.units.map((u, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground">-</span>
                    <span>{u}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-sm mb-2">QR Tag（物理タグ）</h4>
              <p className="text-sm text-muted-foreground">{requirements.dataStructure.qrTag.description}</p>
              <p className="text-sm mt-1">
                状態遷移: {requirements.dataStructure.qrTag.states.join(" → ")}
              </p>
            </div>
          </div>
        </Section>

        {}
        <Section title="4. 業務フロー概要（Printer運用版）">
          <div className="space-y-2">
            {requirements.businessFlow.map((step) => (
              <div key={step.step} className="flex gap-3 text-sm">
                <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                  {step.step}
                </span>
                <div>
                  <span className="font-medium">{step.name}: </span>
                  <span className="text-muted-foreground">{step.description}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {}
        <Section title="5. ステータス遷移">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {requirements.statusTransitions.statuses.map((s, i) => (
                <React.Fragment key={s.code}>
                  <div className="px-3 py-1 bg-muted rounded text-sm">
                    <span className="font-mono text-xs">{s.code}</span>
                    <span className="text-muted-foreground ml-2">{s.name}</span>
                  </div>
                  {i < requirements.statusTransitions.statuses.length - 1 && i < 5 && (
                    <span className="text-muted-foreground self-center">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-sm">
              <p className="font-medium mb-1">キャンセルポリシー</p>
              <p className="text-muted-foreground">{requirements.statusTransitions.cancelPolicy}</p>
            </div>
            <div className="text-sm">
              <p className="font-medium">自動キャンセル締切</p>
              <p className="text-muted-foreground">{requirements.statusTransitions.autoCancelDeadline}</p>
            </div>
          </div>
        </Section>

        {}
        <Section title="6. 料金ロジック（Pricing Engine）">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{requirements.pricingEngine.concept}</p>

            <div>
              <h4 className="font-medium text-sm mb-2">料金計算ロジック</h4>
              <ul className="text-sm space-y-1">
                {requirements.pricingEngine.calculation.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-medium text-sm mb-2">重量・サイズ超過時の対応（Surcharge Policy）</h4>
              <p className="text-sm text-muted-foreground mb-2">
                方針: {requirements.pricingEngine.surchargePolicy.principle}
              </p>
              <ul className="text-sm space-y-1">
                {requirements.pricingEngine.surchargePolicy.flow.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <h4 className="font-medium text-sm mb-2">決済失敗時の対応</h4>
              <p className="text-sm"><span className="font-medium">システム挙動:</span> {requirements.pricingEngine.paymentFailureHandling.system}</p>
              <p className="text-sm mt-1"><span className="font-medium">CS運用:</span> {requirements.pricingEngine.paymentFailureHandling.operation}</p>
            </div>
          </div>
        </Section>

        {}
        <Section title="7. ホテル支払額（Payout）">
          <div className="space-y-2 text-sm">
            <p><span className="font-medium">計算式:</span> {requirements.hotelPayout.formula}</p>
            <p><span className="font-medium">原価確定:</span> {requirements.hotelPayout.costDetermination}</p>
          </div>
        </Section>

        {}
        <Section title="8. Ship&co連携・技術仕様">
          <div className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">配送先住所の構築ロジック</h4>
              <ul className="space-y-1">
                <li><span className="text-muted-foreground">入力:</span> {requirements.shipcoIntegration.addressLogic.input}</li>
                <li><span className="text-muted-foreground">正規化:</span> {requirements.shipcoIntegration.addressLogic.normalization}</li>
                <li><span className="text-muted-foreground">受取照合情報:</span> {requirements.shipcoIntegration.addressLogic.guestInfo}</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-2">サイズ・重量定義（安全係数）</h4>
              <div className="grid grid-cols-3 gap-2">
                {requirements.shipcoIntegration.sizeDefinitions.map((s) => (
                  <div key={s.size} className="p-2 bg-muted rounded text-center">
                    <div className="font-medium">{s.size}</div>
                    <div className="text-xs text-muted-foreground">{s.dimensions} / {s.weight}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-1">伝票発行タイミング</h4>
              <p className="text-muted-foreground">{requirements.shipcoIntegration.labelTrigger}</p>
            </div>
          </div>
        </Section>

        {}
        <Section title="9. プリンター方針">
          <div className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">ハードウェア構成</h4>
              <ul className="space-y-1">
                <li><span className="text-muted-foreground">プリンター:</span> {requirements.printerPolicy.hardware.printer}</li>
                <li><span className="text-muted-foreground">制御端末:</span> {requirements.printerPolicy.hardware.control}</li>
                <li className="text-destructive"><span className="text-muted-foreground">禁止:</span> {requirements.printerPolicy.hardware.prohibited}</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-2">Self-Labeling オペレーション</h4>
              <ul className="space-y-1">
                {requirements.printerPolicy.selfLabeling.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {}
        <Section title="8.5 通知ポリシー">
          <div className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">通知チャネル</h4>
              <ul className="space-y-2">
                {requirements.notificationPolicy.channels.map((ch, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="font-medium w-16 shrink-0">{ch.type}:</span>
                    <div>
                      <span>{ch.status}</span>
                      {ch.note && <p className="text-xs text-muted-foreground mt-0.5">{ch.note}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-1">通知タイミング</h4>
              <ul className="space-y-1">
                {requirements.notificationPolicy.timing.map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground">-</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3 p-3 bg-muted/50 rounded-lg">
              <h4 className="font-medium text-sm mb-1">Email API</h4>
              <p className="text-muted-foreground text-sm">{requirements.notificationPolicy.emailApi}</p>
            </div>
          </div>
        </Section>

        {}
        <Section title="9. データ保持ポリシー">
          <div className="space-y-2 text-sm">
            <p><span className="font-medium">写真データ:</span> {requirements.dataRetention.photos}</p>
            <p><span className="font-medium">ラベルデータ:</span> {requirements.dataRetention.labelData}</p>
          </div>
        </Section>

        {}
        <Section title="9.5 写真ポリシー">
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 border border-border rounded-lg">
                <h4 className="font-medium mb-2">ゲスト撮影（Traveler）</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>最大枚数: {requirements.photoPolicy.traveler.maxPhotos}枚</li>
                  <li>用途: {requirements.photoPolicy.traveler.purpose}</li>
                  <li>タイミング: {requirements.photoPolicy.traveler.timing}</li>
                </ul>
              </div>
              <div className="p-3 border-2 border-foreground/20 rounded-lg">
                <h4 className="font-medium mb-2">ホテル撮影（Hotel Staff）</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>最大枚数: {requirements.photoPolicy.hotel.maxPhotos}枚</li>
                  <li>用途: {requirements.photoPolicy.hotel.purpose}</li>
                  <li>タイミング: {requirements.photoPolicy.hotel.timing}</li>
                </ul>
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="font-medium">上書きルール</p>
              <p className="text-muted-foreground mt-1">{requirements.photoPolicy.overrideRule}</p>
            </div>
            <p className="text-muted-foreground">{requirements.photoPolicy.sizeNote}</p>
          </div>
        </Section>

        {}
        <Section title="10. 配送日ロジック">
          <div className="space-y-2 text-sm">
            <div>
              <h4 className="font-medium mb-1">最短配送日の算出</h4>
              <ul className="space-y-1">
                {requirements.deliveryDateLogic.earliestDate.map((d, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground">-</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p><span className="font-medium">選択範囲:</span> {requirements.deliveryDateLogic.range}</p>
            {}
            <div className="mt-3 p-3 bg-muted/50 rounded-lg">
              <h4 className="font-medium text-sm mb-1">時間帯選択（Time Slot）</h4>
              <p className="text-muted-foreground text-sm mb-2">{requirements.deliveryDateLogic.timeSlot.description}</p>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <p className="text-xs font-medium mb-1">指定可能な場合（ホテル等）</p>
                  <ul className="space-y-1">
                    {requirements.deliveryDateLogic.timeSlot.whenAvailable.map((r: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                        <span>-</span><span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium mb-1">指定不可な場合（空港等）</p>
                  <ul className="space-y-1">
                    {requirements.deliveryDateLogic.timeSlot.whenNotAvailable.map((r: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                        <span>-</span><span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {}
            {requirements.deliveryDateLogic.timeSensitive && (
              <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                <h4 className="font-medium text-sm mb-1">時間制約のある配送先</h4>
                <p className="text-muted-foreground text-sm mb-2">{requirements.deliveryDateLogic.timeSensitive.description}</p>
                <ul className="space-y-1">
                  {requirements.deliveryDateLogic.timeSensitive.rules.map((r: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground">-</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {}
            <div className="mt-3 p-3 bg-muted/50 rounded-lg">
              <h4 className="font-medium text-sm mb-1">不安軽減（Good to know）</h4>
              <p className="text-muted-foreground text-sm mb-2">{requirements.deliveryDateLogic.reassurance.description}</p>
              <ul className="space-y-1">
                {requirements.deliveryDateLogic.reassurance.items.map((r: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground">-</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {}
        <Section title="10.5 法的ページ（Legal）">
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{requirements.legalPages.description}</p>
            {requirements.legalPages.pages.map((page, i) => (
              <div key={i} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">{page.name}</h4>
                  <Link href={page.path}>
                    <Button variant="outline" size="sm">View</Button>
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{page.sections}</p>
              </div>
            ))}
          </div>
        </Section>

        {}
        <Section title="11. 集計・計上の基準">
          <div className="space-y-2 text-sm">
            <p><span className="font-medium">タイムゾーン:</span> {requirements.kpiAccounting.timezone}</p>
            <p><span className="font-medium">日次KPI:</span> {requirements.kpiAccounting.dailyKpi}</p>
            <p><span className="font-medium">売上計上:</span> {requirements.kpiAccounting.revenue}</p>
            <p><span className="font-medium">除外:</span> {requirements.kpiAccounting.exclusions}</p>
          </div>
        </Section>

        {}
        <Section title="12. ユーザーロールと画面">
          <div className="grid gap-4 md:grid-cols-3">
            {requirements.userRoles.map((role) => (
              <div key={role.id} className="p-4 border border-border rounded-lg">
                <h4 className="font-medium">{role.name}</h4>
                <p className="text-xs text-muted-foreground mt-1">{role.device}</p>
                <p className="text-sm mt-2">{role.description}</p>
                <p className="text-xs text-muted-foreground mt-2 italic">{role.uxGoal}</p>
              </div>
            ))}
          </div>
        </Section>

        {}
        <Section title="A-1. ユーザー画面（Traveler Flow）">
          <div className="space-y-4">
            {requirements.flows.traveler.screens.map((screen, index) => (
              <div key={screen.id} className="border border-border rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">
                        {index === 0 ? "Entry" : index === 8 ? "End" : `Step ${index}`}
                      </span>
                      <h4 className="font-medium">{screen.name}</h4>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{screen.description}</p>
                  </div>
                  <Link href={screen.path}>
                    <Button variant="outline" size="sm">
                      View
                    </Button>
                  </Link>
                </div>
                <div className="mt-3">
                  <h5 className="text-xs font-medium text-muted-foreground mb-2">Elements:</h5>
                  <ul className="text-sm space-y-1">
                    {screen.elements.map((element, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-muted-foreground">-</span>
                        <span>{element}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {}
        <Section title="A-2. ホテル受付画面（Hotel Staff Flow）" defaultOpen={false}>
          <div className="space-y-4">
            {requirements.flows.hotel.screens.map((screen, index) => (
              <div key={screen.id} className="border border-border rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">
                        {index === 0 ? "Entry" : `Screen ${index + 1}`}
                      </span>
                      <h4 className="font-medium">{screen.name}</h4>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{screen.description}</p>
                  </div>
                  <Link href={screen.path}>
                    <Button variant="outline" size="sm">
                      View
                    </Button>
                  </Link>
                </div>
                <div className="mt-3">
                  <h5 className="text-xs font-medium text-muted-foreground mb-2">Elements:</h5>
                  <ul className="text-sm space-y-1">
                    {screen.elements.map((element, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-muted-foreground">-</span>
                        <span>{element}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {}
        <Section title="A-3. Admin画面（Admin/CS Dashboard）" defaultOpen={false}>
          <div className="space-y-4">
            {requirements.flows.admin.screens.map((screen, index) => (
              <div key={screen.id} className="border border-border rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">
                        {index === 0 ? "Entry" : `Screen ${index + 1}`}
                      </span>
                      <h4 className="font-medium">{screen.name}</h4>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{screen.description}</p>
                  </div>
                  <Link href={screen.path}>
                    <Button variant="outline" size="sm">
                      View
                    </Button>
                  </Link>
                </div>
                <div className="mt-3">
                  <h5 className="text-xs font-medium text-muted-foreground mb-2">Elements:</h5>
                  <ul className="text-sm space-y-1">
                    {screen.elements.map((element, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-muted-foreground">-</span>
                        <span>{element}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {}
        <div className="flex justify-center gap-4 pt-4">
          <Link href="/changelog">
            <Button variant="outline">
              <History className="w-4 h-4 mr-2" />
              Changelog
            </Button>
          </Link>
          <Link href="/flowchart">
            <Button variant="outline">
              <GitBranch className="w-4 h-4 mr-2" />
              Screen Flow Diagram
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
