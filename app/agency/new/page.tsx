"use client"

import { useEffect, useState, useCallback, useMemo, useRef, Fragment, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { HotelSearchInput, type PlaceCandidate } from "@/components/hotel-search-input"
import {
  Loader2, Check, Plus, Trash2, ArrowLeft, Info,
  ClipboardList, CalendarClock, PackageCheck, MailCheck, ChevronRight, FolderOpen,
  UploadCloud, Sparkles, Download, AlertTriangle, ExternalLink, type LucideIcon,
} from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import {
  type LabelTo,
  type LabelSender,
  DEFAULT_LABEL_DELIVERY,
  resolveLabelParcels,
  senderFieldLabel,
  defaultLabelMailDue,
} from "@/lib/label-delivery"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"
import { isNextDayEarlySlotRisky } from "@/lib/yamato-delivery"
import { DEFAULT_CARRIER, carrierConfig, slotLabel } from "@/lib/carrier"
import { EMPTY_RESIDENCE, residenceError, type ResidenceAddress } from "@/lib/residence"
import { ITEM_TYPES, type ItemTypeKey } from "@/lib/item-types"

/** 発送元/お届け先の種別。hotel=Google Places 検索 / residence=個人宅の手入力。 */
type EndpointKind = "hotel" | "residence"

type Leg = {
  fromKind: EndpointKind
  fromHotel: string
  fromPlaceId: string
  fromCity: string
  fromResidence: ResidenceAddress
  toKind: EndpointKind
  toHotel: string
  toPlaceId: string
  toCity: string
  toResidence: ResidenceAddress
  shipmentDate: string
  expectedArrival: string
  fromCheckIn: string
  toCheckOut: string
  deliveryTime: string
  recipient: string
  suitcaseCount: number
  itemType: ItemTypeKey
  itemOther: string
  notes: string
  noteTarget: "from" | "to" | "both"
}

const emptyLeg = (): Leg => ({
  fromKind: "hotel",
  fromHotel: "",
  fromPlaceId: "",
  fromCity: "",
  fromResidence: { ...EMPTY_RESIDENCE },
  toKind: "hotel",
  toHotel: "",
  toPlaceId: "",
  toCity: "",
  toResidence: { ...EMPTY_RESIDENCE },
  shipmentDate: "",
  expectedArrival: "",
  fromCheckIn: "",
  toCheckOut: "",
  deliveryTime: "before-noon", // 既定は午前中着 (ランオペの基本希望)。翌日着×午前中はタイト警告を出す
  recipient: "",
  suitcaseCount: 1,
  itemType: "suitcase", // 既定はスーツケース (従来どおり)
  itemOther: "",
  notes: "",
  noteTarget: "to", // 既定はお届け先ホテル宛
})

const GUEST_LANGS: Array<[string, string]> = [
  ["en", "English"],
  ["zh", "中文"],
  ["it", "Italiano"],
  ["fr", "Français"],
  ["es", "Español"],
]

const messages = {
  en: {
    // ---- 送り状(紙)の郵送先・差出人 ----
    ldHeading: "Where should we send the printed labels?",
    ldBody:
      "BondEx prints the Sagawa labels and mails them so the traveler has them before drop-off. Choose where they should arrive and whose name should be on the envelope.",
    ldToLabel: "Send the labels to",
    ldToAgency: "Your office",
    ldToAgencyDesc: "We mail everything to your registered address.",
    ldToHotel: "The hotel",
    ldToHotelDesc: "Addressed to the traveler, c/o the hotel.",
    ldSplitLabel: "This trip has more than one leg",
    ldSplitOnce: "Send everything to the first hotel",
    ldSplitOnceDesc: "One envelope with all legs' labels.",
    ldSplitEach: "Send each leg to its own hotel",
    ldSplitEachDesc: "One envelope per leg, to that leg's departure hotel.",
    ldSenderLabel: "Sender on the envelope",
    ldSenderBondex: "BondEx (JOJO Inc.)",
    ldSenderLand: "Your company",
    ldSenderLandDesc: "Uses your registered shipping address.",
    ldSenderAgent: "Another company",
    ldSenderAgentDesc: "A travel agency, etc. Enter the details below.",
    ldSenderMissing:
      "Your shipping address is not registered yet. Contact BondEx to register it, or choose another sender.",
    ldAgentName: "Name on the envelope",
    ldAgentPhone: "Phone",
    ldAgentZip: "Postal code",
    ldAgentPref: "Prefecture",
    ldAgentCity: "City / ward",
    ldAgentStreet: "Street address",
    ldAgentBuilding: "Building (optional)",
    ldReview: "Printed labels",
    ldDueLabel: "Labels needed by (mailing deadline)",
    ldDueHint:
      "Sagawa labels can only be issued from 30 days before the ship date. If unset, we mail by 5 business days before shipping.",
    ldDueRange: "Label mailing date must be between 30 days before shipping and the day before shipping",
    back: "Back to portal",
    badge: "New issuance request",
    title: "Register a booking",
    lead: "Enter the trip details. BondEx will prepare the voucher and shipping labels and share a Google Drive folder link here — no label is issued (or charged) at this step.",
    autoHeading: "Auto-fill from an itinerary",
    autoBody: "Upload an itinerary or guest roster (PDF, image, Excel, or CSV). We'll read hotels, dates and the lead traveler into the form — and if it's a roster with luggage-request marks, we'll fill the group luggage list with the requesting guests. You can edit anything afterward.",
    autoRosterDone: (n: number) =>
      `Loaded ${n} luggage request(s) from the roster into the luggage list (booking type set to Group). Please enter the hotels and dates below.`,
    autoChipsTitle: "If your file shows these, you don't need to type them:",
    chipWho: "WHO (guest names)",
    chipWhen: "WHEN (ship date)",
    chipWhere: "WHERE (hotels)",
    chipCount: "HOW MANY (bags)",
    autoMissingTitle: (n: number) => `${n} item(s) still need your input — please fill them in the form below:`,
    missingLeader: "Tour leader name (Group details)",
    missingLuggage: "Luggage list (Group details)",
    missingRep: "Lead traveler name",
    rosterPasteLabel: "Guest names (paste, one per line)",
    rosterPastePh: "Rahul Patel\nAmit Sharma\nPriya Singh",
    rosterBuildBtn: "Create luggage list",
    lugListTitle: "Luggage list — set bags per guest",
    lugColGuest: "Guest",
    lugColBags: "Bags",
    lugAddRow: "Add guest",
    lugClear: "Start over",
    lugTotal: (g: number, b: number) => `${g} guest(s) ・ ${b} bag(s) total — applied to every leg`,
    rvGroupHeading: "Group",
    rvLeader: "Tour leader",
    rvLuggage: "Luggage list",
    dupFrom: (id: string) => `Duplicated from ${id}`,
    dupNote: "Route and settings are pre-filled. Enter the new dates and traveler name below.",
    autoButton: "Upload itinerary",
    autoParsing: "Reading the itinerary…",
    autoDone: "Loaded — please review the fields below.",
    autoErr: "Couldn't read the itinerary. Please fill in the form manually.",
    representative: "Lead traveler name",
    representativePlaceholder: "e.g. John Smith",
    tourNumber: "Your booking number",
    tourNumberPlaceholder: "e.g. JPT2607-045 (your own reference)",
    travelerCount: "Travelers",
    guestLanguage: "Voucher language (for the traveler)",
    legHeading: "Leg",
    fromHotel: "From (hotel / pickup)",
    toHotel: "To (hotel / delivery)",
    hotelSearchPlaceholder: "Type a hotel name (Google Maps)",
    kindHotel: "Hotel",
    kindResidence: "Private residence",
    resName: "Full name",
    resNamePlaceholder: "Recipient / sender name",
    resPhone: "Phone",
    resPhonePlaceholder: "e.g. 090-1234-5678",
    resZip: "Postal code",
    resZipPlaceholder: "e.g. 1500001",
    resPref: "Prefecture",
    resPrefPlaceholder: "e.g. Tokyo",
    resCity: "City / ward",
    resCityPlaceholder: "e.g. Shibuya-ku",
    resStreet: "Street & number",
    resStreetPlaceholder: "e.g. Jingumae 1-2-3",
    resBuilding: "Building / room (optional)",
    resBuildingPlaceholder: "e.g. Sunny Mansion 305",
    zipLoading: "Looking up the address…",
    zipNotFound: "No address found for this postal code — please enter it manually.",
    resFieldLabels: {
      name: "full name",
      phone: "phone",
      zip: "postal code (7 digits)",
      prefecture: "prefecture",
      city: "city / ward",
      street: "street & number",
    } as Record<string, string>,
    bookingName: "Booking name (on voucher)",
    bookingNamePlaceholder: "Same as representative if blank",
    groupName: "Group name (optional)",
    groupNamePlaceholder: "e.g. Johnson Family",
    bookingTypeLabel: "Booking type",
    btFit: "FIT",
    btFitDesc: "Individual travelers or small parties of up to 9 guests.",
    btGroup: "Group",
    btGroupDesc: "Group tours with 10 or more guests.",
    grpSection: "Group details",
    leaderName: "Tour leader / guide name",
    leaderPhone: "Tour leader phone",
    leaderWhatsapp: "Tour leader WhatsApp",
    luggageList: "Luggage list (one line = one bag)",
    luggageListHint:
      "Paste guest names, one per line. The number of lines becomes the number of bags for every leg. Use “-” for unnamed bags — you can edit names later on the group dashboard.",
    luggageCountNote: (n: number) => `${n} bag(s) — applied to every leg`,
    grpCountLocked: "Set by the luggage list",
    grpLuggageRequired: "Please enter at least one line in the luggage list.",
    grpLeaderRequired: "Please enter the tour leader's name.",
    grpDashboardLink: "Open group dashboard",
    fromCheckIn: "Check-in date at the delivery hotel",
    toCheckOut: "Check-out at delivery hotel (optional)",
    deliveryTime: "Delivery time slot",
    nextDayRisk:
      "This schedule is tight — with a morning slot we can't promise the arrival date. To lock the date in, remove the time slot. Keep \"Before noon\" anyway?",
    removeTimeSlot: "Remove the time slot (lock the date)",
    deliverySlots: {
      "not-specified": "Not specified",
      "before-noon": "Before noon",
      "before-ten": "Before 10:00",
      "before-five": "Before 17:00",
      "14-16": "14:00 – 16:00",
      "16-18": "16:00 – 18:00",
      "18-20": "18:00 – 20:00",
      "19-21": "19:00 – 21:00",
    } as Record<string, string>,
    dupTitle: "Possible duplicate request",
    dupBody: "A request with the same traveler and ship date already exists:",
    dupProceed: "Register anyway",
    shipmentDate: "Ship date",
    expectedArrival: "Arrival date",
    recipient: "Recipient (optional)",
    recipientPlaceholder: "Defaults to the delivery hotel front desk",
    suitcases: "Pieces",
    itemLabel: "Item type",
    itemOtherLabel: "Describe the item",
    itemOtherPlaceholder: "e.g. Musical instrument",
    rvItem: "Item",
    notes: "Message to the hotel (optional)",
    noteTargetLabel: "Show on",
    noteTargetTo: "Delivery hotel",
    noteTargetFrom: "Pickup hotel",
    noteTargetBoth: "Both",
    addLeg: "Add leg",
    removeLeg: "Remove",
    submit: "Review before issuing",
    submitting: "Submitting…",
    // 確認(プレビュー)ステップ
    confirmBadge: "Step 2 of 3 — Review",
    confirmTitle: "Please review before issuing",
    confirmLead: "Check the details below and the voucher preview. Nothing is issued or charged until you confirm.",
    reviewHeading: "Booking details",
    previewHeading: "Voucher preview",
    previewLoading: "Building the preview…",
    previewUnavailable: "Preview unavailable — you can still review the details above.",
    previewOpenTab: "Open in a new tab",
    previewFallbackNote: "If the preview is blank (e.g. on Safari), use \"Open in a new tab\" above.",
    backToEdit: "Back to edit",
    confirmIssue: "Issue with these details",
    confirmIssuing: "Issuing…",
    valTitle: "Please fix the following before continuing:",
    errPastDate: (n: number) => `Leg ${n}: the ship date is in the past — please check the year.`,
    errArrivalBeforeShip: (n: number) => `Leg ${n}: the arrival date is before the ship date.`,
    errMissingHotel: (n: number) => `Leg ${n}: both the origin and destination hotel are required.`,
    errMissingCheckIn: (n: number) => `Leg ${n}: the check-in date at the delivery hotel is required (the hotel looks up the booking by name + check-in date).`,
    errResidence: (n: number, side: string, field: string) => `Leg ${n}: the ${side} (private residence) needs a ${field}.`,
    sideFrom: "origin",
    sideTo: "destination",
    errItemOther: (n: number) => `Leg ${n}: please describe the item (you chose "Other").`,
    rvGuest: "Lead traveler",
    rvTour: "Tour no.",
    rvLang: "Voucher language",
    rvLeg: "Leg",
    rvRoute: "Route",
    rvShip: "Ship",
    rvArrive: "Arrive",
    rvBags: "Bags",
    rvSlot: "Time slot",
    rvNote: "Message to hotel",
    flowHeading: "How it works",
    flow: [
      { title: "Register request", sub: "Enter the itinerary (you are here)", key: false },
      { title: "Until 1 month before shipping", sub: "shipping labels can't be created earlier", key: true },
      { title: "BondEx issues the documents", sub: "Voucher + shipping labels", key: false },
      { title: "Drive folder shared to your email", sub: "Open the voucher & labels inside", key: true },
    ],
    // 出荷が1ヶ月以内 → その場で発行してすぐDL
    flowSoon: [
      { title: "Register request", sub: "Enter the itinerary (you are here)", key: false },
      { title: "Issued on the spot", sub: "Within a month — voucher + shipping label", key: true },
      { title: "Download immediately", sub: "A copy is kept in the shared Drive", key: true },
    ],
    monthNote:
      "shipping labels can only be created from one month before the ship date. Once it's within a month we'll prepare everything and share a Google Drive folder with your registered email — the voucher and labels will be inside.",
    issueFailTitle: "The shipping label could not be issued",
    issueFailBody:
      "The booking is saved and the voucher is ready, but the shipping label for the leg(s) below could not be created. Please check the ship/arrival dates and hotel names, then edit the booking — or contact BondEx.",
    issueFailLeg: (n: number) => `Leg ${n}`,
    doneTitle: "Request received",
    doneBooking: "Booking number",
    doneShareHeading: "How you'll receive the documents",
    doneWait:
      "The voucher is ready — download it right now from the button below (for your final documents and internal records). The shipping label can only be created from about a month before shipping, so we'll prepare it once the ship date is within a month and place it in your booking folder on the shared drive.",
    doneSoon:
      "Your shipment is within a month, so we'll prepare the documents (voucher and shipping labels) right away and share a Google Drive folder with your registered email.",
    doneReadyHeading: "Your documents are ready",
    doneReadyBody:
      "The voucher and shipping label have been issued — download them right below. A copy is also kept in the shared Google Drive.",
    dlVoucher: "Download voucher",
    howtoToggle: "Include the \"How to use this service\" guide",
    howtoToggleSub:
      "Appends a 1-page traveler guide (same language as the voucher) as the voucher's last page — one page even for multi-leg trips. Hand it to the traveler together with the voucher.",
    howtoStandalonePrefix: "Need the guide on its own?",
    dlHowto: "Download the guide",
    dlLabel: "Download shipping label",
    dlLeg: (n: number) => `Shipping label (leg ${n})`,
    doneBack: "Back to portal",
    errGeneric: "Could not register the request. Please try again.",
    errNetwork: "Network error. Please check your connection.",
    notLoggedIn: "Your session expired. Please sign in again.",
  },
  ja: {
    // ---- 送り状(紙)の郵送先・差出人 ----
    ldHeading: "送り状（紙）のお届け先",
    ldBody:
      "BondEx が佐川の送り状を印刷し、お荷物をお預けになる前に届くよう郵送します。どこへ届けるか、封筒の差出人を誰にするかをお選びください。",
    ldToLabel: "送り状の送付先",
    ldToAgency: "御社宛",
    ldToAgencyDesc: "ご登録の住所へまとめてお送りします。",
    ldToHotel: "ホテル宛",
    ldToHotelDesc: "ホテル気付で旅行者様宛にお送りします。",
    ldSplitLabel: "区間が複数あります",
    ldSplitOnce: "最初のホテルへまとめて送る",
    ldSplitOnceDesc: "全区間ぶんを1通でお送りします。",
    ldSplitEach: "区間ごとに各ホテルへ送る",
    ldSplitEachDesc: "その区間の発送元ホテルへ1通ずつお送りします。",
    ldSenderLabel: "封筒の差出人",
    ldSenderBondex: "BondEx（株式会社JOJO）",
    ldSenderLand: "御社名義",
    ldSenderLandDesc: "ご登録の発送先住所を使用します。",
    ldSenderAgent: "他社名義",
    ldSenderAgentDesc: "旅行代理店など。以下にご入力ください。",
    ldSenderMissing:
      "御社の発送先住所が未登録です。BondEx へご連絡いただくか、別の差出人をお選びください。",
    ldAgentName: "封筒に載せる名称",
    ldAgentPhone: "電話番号",
    ldAgentZip: "郵便番号",
    ldAgentPref: "都道府県",
    ldAgentCity: "市区町村",
    ldAgentStreet: "番地・町名",
    ldAgentBuilding: "建物名（任意）",
    ldReview: "送り状の郵送",
    ldDueLabel: "いつまでに送り状が必要ですか（投函期限）",
    ldDueHint:
      "佐川の送り状は発送日の30日前から発行できます。ご指定がなければ発送日の5営業日前までに投函します。",
    ldDueRange: "送り状の投函期限は「発送30日前〜発送前日」の範囲でご指定ください",
    back: "ポータルに戻る",
    badge: "新規発行依頼",
    title: "発行依頼を登録",
    lead: "旅程をご入力ください。BondEx がバウチャーと配送伝票を用意し、Google Drive フォルダのリンクをこちらでご案内します。この段階では送り状は発行されません（課金もありません）。",
    autoHeading: "旅程表・名簿から自動入力",
    autoBody: "旅程表または名簿（PDF・画像・Excel・CSV）をアップロードすると、ホテル・日付・代表者を読み取って下のフォームに反映します。配送依頼の印（YES等）が付いた名簿なら、依頼者だけを団体の荷物リストに自動反映します。読み取り後は自由に修正できます。",
    autoRosterDone: (n: number) =>
      `名簿から配送依頼 ${n} 名分を荷物リストに反映しました（予約タイプを「団体」にしました）。ホテル・日付は下のフォームでご入力ください。`,
    autoChipsTitle: "ファイルにこれが書いてあれば、手入力は不要です:",
    chipWho: "誰が（お名前）",
    chipWhen: "いつ（発送日）",
    chipWhere: "どこへ（ホテル）",
    chipCount: "何個（個数）",
    autoMissingTitle: (n: number) => `あと ${n} 箇所の入力が必要です — 下のフォームでご入力ください:`,
    missingLeader: "添乗員のお名前（団体情報）",
    missingLuggage: "荷物リスト（団体情報）",
    missingRep: "代表者名",
    rosterPasteLabel: "ゲスト名（1行に1名ずつ貼り付け）",
    rosterPastePh: "Rahul Patel\nAmit Sharma\nPriya Singh",
    rosterBuildBtn: "荷物リストを作成",
    lugListTitle: "荷物リスト — ゲストごとに個数を設定",
    lugColGuest: "ゲスト",
    lugColBags: "個数",
    lugAddRow: "1名追加",
    lugClear: "やり直す",
    lugTotal: (g: number, b: number) => `${g} 名 ・ 合計 ${b} 個 — 全区間に適用されます`,
    rvGroupHeading: "団体",
    rvLeader: "添乗員",
    rvLuggage: "荷物リスト",
    dupFrom: (id: string) => `複製元: ${id}`,
    dupNote: "行程と設定は入力済みです。新しい日付と代表者名をご入力ください。",
    autoButton: "旅程表を読み込む",
    autoParsing: "旅程表を読み取り中…",
    autoDone: "読み込みました。下の内容をご確認ください。",
    autoErr: "旅程表を読み取れませんでした。お手数ですが手入力でお願いします。",
    representative: "代表者名",
    representativePlaceholder: "例: 山田 太郎 / John Smith",
    tourNumber: "貴社の予約番号",
    tourNumberPlaceholder: "例: JPT2607-045（貴社管理用の番号）",
    travelerCount: "人数",
    guestLanguage: "バウチャー言語（お客様向け）",
    legHeading: "区間",
    fromHotel: "発送元（ホテル・集荷）",
    toHotel: "お届け先（ホテル・配達）",
    hotelSearchPlaceholder: "ホテル名を入力（Google マップ検索）",
    kindHotel: "ホテル",
    kindResidence: "個人宅",
    resName: "氏名",
    resNamePlaceholder: "受取人・発送人のお名前",
    resPhone: "電話番号",
    resPhonePlaceholder: "例: 090-1234-5678",
    resZip: "郵便番号",
    resZipPlaceholder: "例: 1500001",
    resPref: "都道府県",
    resPrefPlaceholder: "例: 東京都",
    resCity: "市区町村",
    resCityPlaceholder: "例: 渋谷区",
    resStreet: "番地・町名",
    resStreetPlaceholder: "例: 神宮前1-2-3",
    resBuilding: "建物名・部屋番号（任意）",
    resBuildingPlaceholder: "例: サニーマンション305",
    zipLoading: "住所を検索中…",
    zipNotFound: "該当する郵便番号が見つかりません。手入力してください。",
    resFieldLabels: {
      name: "氏名",
      phone: "電話番号",
      zip: "郵便番号（7桁）",
      prefecture: "都道府県",
      city: "市区町村",
      street: "番地・町名",
    } as Record<string, string>,
    bookingName: "予約者名（バウチャー表示）",
    bookingNamePlaceholder: "空欄なら代表者と同じ",
    groupName: "団体名（任意）",
    groupNamePlaceholder: "例: 山田ご一行",
    bookingTypeLabel: "予約タイプ",
    btFit: "FIT",
    btFitDesc: "個人のお客様・9名までの小グループ",
    btGroup: "団体",
    btGroupDesc: "10名以上の団体ツアー",
    grpSection: "団体情報",
    leaderName: "添乗員（ツアーリーダー）氏名",
    leaderPhone: "添乗員 電話番号",
    leaderWhatsapp: "添乗員 WhatsApp",
    luggageList: "荷物リスト（1行 = 1個）",
    luggageListHint:
      "ゲスト名を1行に1名ずつ貼り付けてください。行数がそのまま全区間の個数になります。名前未定の荷物は「-」でOK（後から団体ダッシュボードで編集できます）。",
    luggageCountNote: (n: number) => `${n} 個 — 全区間に適用されます`,
    grpCountLocked: "荷物リストで確定",
    grpLuggageRequired: "荷物リストを1行以上ご入力ください。",
    grpLeaderRequired: "添乗員のお名前をご入力ください。",
    grpDashboardLink: "団体ダッシュボードを開く",
    fromCheckIn: "お届け先ホテルのチェックイン日（お客様の到着日）",
    toCheckOut: "お届け先ホテルのチェックアウト日（任意）",
    deliveryTime: "配達時間帯",
    nextDayRisk:
      "この日程だと「午前中」では配達日をお約束できません。日付を確実にするには時間指定を外してください。それでも午前中にしますか？",
    removeTimeSlot: "時間指定を外す（日付を確実にする）",
    deliverySlots: {
      "not-specified": "指定なし",
      "before-noon": "午前中",
      "before-ten": "10時まで",
      "before-five": "17時まで",
      "14-16": "14時〜16時",
      "16-18": "16時〜18時",
      "18-20": "18時〜20時",
      "19-21": "19時〜21時",
    } as Record<string, string>,
    dupTitle: "重複の可能性があります",
    dupBody: "同じ代表者・同じ発送日の依頼が既にあります：",
    dupProceed: "このまま登録する",
    shipmentDate: "発送日",
    expectedArrival: "到着日",
    recipient: "受取人（任意）",
    recipientPlaceholder: "未入力ならお届け先ホテルのフロント宛",
    suitcases: "個数",
    itemLabel: "品目",
    itemOtherLabel: "品目（自由記述）",
    itemOtherPlaceholder: "例: 楽器",
    rvItem: "品目",
    notes: "ホテルへの申し送り（任意）",
    noteTargetLabel: "掲載先",
    noteTargetTo: "お届け先ホテル",
    noteTargetFrom: "発送元ホテル",
    noteTargetBoth: "両方",
    addLeg: "区間を追加",
    removeLeg: "削除",
    submit: "確認画面へ進む",
    // 確認(プレビュー)ステップ
    confirmBadge: "ステップ 2 / 3 — 内容確認",
    confirmTitle: "発行前に内容をご確認ください",
    confirmLead: "下記の内容とバウチャーのプレビューをご確認ください。確定するまで発行も課金もされません。",
    reviewHeading: "予約内容",
    previewHeading: "バウチャー プレビュー",
    previewLoading: "プレビューを作成中…",
    previewUnavailable: "プレビューを表示できませんでした。上記の内容はご確認いただけます。",
    previewOpenTab: "新しいタブで開く",
    previewFallbackNote: "プレビューが空白の場合（Safari など）は、上の「新しいタブで開く」からご確認ください。",
    backToEdit: "入力に戻って修正",
    confirmIssue: "この内容で発行する",
    confirmIssuing: "発行中…",
    valTitle: "発行前に次の点をご確認ください:",
    errPastDate: (n: number) => `区間${n}: 発送日が過去の日付です。年をご確認ください。`,
    errArrivalBeforeShip: (n: number) => `区間${n}: 到着日が発送日より前になっています。`,
    errMissingHotel: (n: number) => `区間${n}: 発送元・発送先ホテルの両方が必要です。`,
    errMissingCheckIn: (n: number) => `区間${n}: お届け先ホテルのチェックイン日は必須です（受取ホテルが「予約名＋チェックイン日」で照会するため）。`,
    errResidence: (n: number, side: string, field: string) => `区間${n}: ${side}（個人宅）の${field}をご入力ください。`,
    sideFrom: "発送元",
    sideTo: "お届け先",
    errItemOther: (n: number) => `区間${n}: 品目で「その他」を選んだ場合は内容をご入力ください。`,
    rvGuest: "ご予約者",
    rvTour: "ツアー番号",
    rvLang: "バウチャー言語",
    rvLeg: "区間",
    rvRoute: "経路",
    rvShip: "発送",
    rvArrive: "到着",
    rvBags: "個数",
    rvSlot: "時間帯",
    rvNote: "ホテルへの申し送り",
    submitting: "送信中…",
    flowHeading: "この後の流れ",
    flow: [
      { title: "発行依頼を登録", sub: "旅程を入力（今ここ）", key: false },
      { title: "出荷1ヶ月前まで", sub: "配送伝票は1ヶ月前から発行", key: true },
      { title: "BondExが書類を発行", sub: "バウチャー＋配送伝票", key: false },
      { title: "Driveフォルダをメールで共有", sub: "中の書類をご利用ください", key: true },
    ],
    // 出荷が1ヶ月以内 → その場で発行してすぐDL
    flowSoon: [
      { title: "発行依頼を登録", sub: "旅程を入力（今ここ）", key: false },
      { title: "その場で発行", sub: "1ヶ月以内なので即発行（バウチャー＋伝票）", key: true },
      { title: "すぐにダウンロード", sub: "共有ドライブにも保管します", key: true },
    ],
    monthNote:
      "配送伝票（送り状）は出荷日の1ヶ月前からしか発行できません。1ヶ月前になりましたら書類一式をご用意し、ご登録のメールアドレス宛に Google Drive フォルダを共有します（中にバウチャー・配送伝票が入ります）。",
    issueFailTitle: "送り状を発行できませんでした",
    issueFailBody:
      "予約は保存され、バウチャーもご利用いただけますが、下記の区間の送り状を作成できませんでした。発送日・到着日と、ホテル名をご確認のうえ修正いただくか、BondEx までご連絡ください。",
    issueFailLeg: (n: number) => `区間${n}`,
    doneTitle: "発行依頼を受け付けました",
    doneBooking: "予約番号",
    doneShareHeading: "書類の受け取り方法",
    doneWait:
      "バウチャーは今すぐ下のボタンからダウンロードいただけます（ファイナルドキュメントへの同封・社内のツアーファイル保管にご利用ください）。配送伝票（送り状）は出荷の約1ヶ月前からしか発行できないため、出荷日の1ヶ月前になりましたら弊社で発行し、共有ドライブの予約番号フォルダに格納してご連絡します。",
    doneSoon:
      "出荷まで1ヶ月以内のため、すぐに書類一式（バウチャー・配送伝票）をご用意し、ご登録のメールアドレス宛に Google Drive フォルダを共有します。",
    doneReadyHeading: "書類の準備ができました",
    doneReadyBody:
      "バウチャーと配送伝票（送り状）を発行しました。下のボタンからすぐにダウンロードできます。共有ドライブにも保管しています。",
    dlVoucher: "バウチャーをダウンロード",
    howtoToggle: "「How to use this service」ガイドを同梱する",
    howtoToggleSub:
      "お客様お渡し用の1枚もののご案内を、バウチャーの最終ページに追加します（バウチャーと同じ言語・複数区間でも1枚）。バウチャーと合わせてお客様へお渡しください。",
    howtoStandalonePrefix: "ガイド単体が必要な場合は",
    dlHowto: "ご利用ガイドをダウンロード",
    dlLabel: "送り状をダウンロード",
    dlLeg: (n: number) => `送り状をダウンロード（区間${n}）`,
    doneBack: "ポータルに戻る",
    errGeneric: "発行依頼の登録に失敗しました。もう一度お試しください。",
    errNetwork: "通信エラーです。接続をご確認ください。",
    notLoggedIn: "セッションが切れました。再度サインインしてください。",
  },
} as const

const inputCls =
  "w-full h-11 rounded-xl border border-[#CBD5E1] px-3 text-[14px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#C8102E]/40 focus:border-[#C8102E]"

type Msg = (typeof messages)["ja"]

/** 個人宅の構造化住所フィールド一式。ホテル検索の代わりに表示する。 */
function ResidenceFields({
  value,
  onChange,
  getAuthHeaders,
  t,
  idPrefix,
}: {
  value: ResidenceAddress
  onChange: (patch: Partial<ResidenceAddress>) => void
  getAuthHeaders: () => Promise<Record<string, string>>
  t: Msg
  idPrefix: string
}) {
  const [zipLoading, setZipLoading] = useState(false)
  const [zipNotFound, setZipNotFound] = useState(false)
  // 直近で検索した7桁を覚え、同じ番号で二重に叩かない。
  const lastLookedUp = useRef("")

  // 郵便番号 → 都道府県/市区町村を自動補完 (町域は番地欄が空のときだけ先頭に入れる)。
  const lookupPostal = useCallback(
    async (zip7: string, currentStreet: string) => {
      if (lastLookedUp.current === zip7) return
      lastLookedUp.current = zip7
      setZipNotFound(false)
      setZipLoading(true)
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(`/api/agency/postal?zip=${zip7}`, { headers })
        const d = (await res.json().catch(() => ({}))) as {
          ok?: boolean; found?: boolean; prefecture?: string; city?: string; town?: string
        }
        if (res.ok && d.ok && d.found) {
          const patch: Partial<ResidenceAddress> = {
            prefecture: d.prefecture || "",
            city: d.city || "",
          }
          // 番地欄が空なら町域(例: 神宮前)を初期値に入れておく。既入力は尊重して上書きしない。
          if (!currentStreet.trim() && d.town) patch.street = d.town
          onChange(patch)
        } else if (res.ok && d.ok && d.found === false) {
          setZipNotFound(true)
        }
      } catch {
        /* ネットワーク失敗時は手入力継続 (エラーは出さない) */
      } finally {
        setZipLoading(false)
      }
    },
    [getAuthHeaders, onChange],
  )

  const onZipChange = (raw: string) => {
    onChange({ zip: raw })
    const digits = raw.replace(/[^\d]/g, "")
    if (digits.length === 7) {
      void lookupPostal(digits, value.street)
    } else {
      lastLookedUp.current = ""
      setZipNotFound(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3">
      <Field label={t.resName} htmlFor={`${idPrefix}-name`} required>
        <input id={`${idPrefix}-name`} className={inputCls} value={value.name} maxLength={60}
          placeholder={t.resNamePlaceholder} autoComplete="off"
          onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label={t.resPhone} htmlFor={`${idPrefix}-phone`} required>
        <input id={`${idPrefix}-phone`} className={inputCls} value={value.phone} maxLength={20}
          inputMode="tel" placeholder={t.resPhonePlaceholder} autoComplete="off"
          onChange={(e) => onChange({ phone: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.resZip} htmlFor={`${idPrefix}-zip`} required>
          <input id={`${idPrefix}-zip`} className={inputCls} value={value.zip} maxLength={8}
            inputMode="numeric" placeholder={t.resZipPlaceholder} autoComplete="off"
            onChange={(e) => onZipChange(e.target.value)} />
          {zipLoading && <span className="block text-[11px] text-[#64748B] mt-0.5">{t.zipLoading}</span>}
          {zipNotFound && <span className="block text-[11px] text-amber-700 mt-0.5">{t.zipNotFound}</span>}
        </Field>
        <Field label={t.resPref} htmlFor={`${idPrefix}-pref`} required>
          <input id={`${idPrefix}-pref`} className={inputCls} value={value.prefecture} maxLength={10}
            placeholder={t.resPrefPlaceholder} autoComplete="off"
            onChange={(e) => onChange({ prefecture: e.target.value })} />
        </Field>
      </div>
      <Field label={t.resCity} htmlFor={`${idPrefix}-city`} required>
        <input id={`${idPrefix}-city`} className={inputCls} value={value.city} maxLength={40}
          placeholder={t.resCityPlaceholder} autoComplete="off"
          onChange={(e) => onChange({ city: e.target.value })} />
      </Field>
      <Field label={t.resStreet} htmlFor={`${idPrefix}-street`} required>
        <input id={`${idPrefix}-street`} className={inputCls} value={value.street} maxLength={60}
          placeholder={t.resStreetPlaceholder} autoComplete="off"
          onChange={(e) => onChange({ street: e.target.value })} />
      </Field>
      <Field label={t.resBuilding} htmlFor={`${idPrefix}-bld`}>
        <input id={`${idPrefix}-bld`} className={inputCls} value={value.building} maxLength={60}
          placeholder={t.resBuildingPlaceholder} autoComplete="off"
          onChange={(e) => onChange({ building: e.target.value })} />
      </Field>
    </div>
  )
}

/** 発送元/お届け先の入力（ホテル検索 ⇄ 個人宅トグル）。 */
function EndpointField({
  side,
  leg,
  index,
  t,
  locale,
  placesAuthHeaders,
  update,
  patchResidence,
}: {
  side: "from" | "to"
  leg: Leg
  index: number
  t: Msg
  locale: "ja" | "en"
  placesAuthHeaders: () => Promise<Record<string, string>>
  update: (patch: Partial<Leg>) => void
  patchResidence: (patch: Partial<ResidenceAddress>) => void
}) {
  const isFrom = side === "from"
  const kind = isFrom ? leg.fromKind : leg.toKind
  const sectionLabel = isFrom ? t.fromHotel : t.toHotel
  const hotelValue = isFrom ? leg.fromHotel : leg.toHotel
  const placeId = isFrom ? leg.fromPlaceId : leg.toPlaceId
  const residence = isFrom ? leg.fromResidence : leg.toResidence
  const setKind = (k: EndpointKind) => update(isFrom ? { fromKind: k } : { toKind: k })
  const onHotelChange = (v: string) =>
    update(isFrom ? { fromHotel: v, fromPlaceId: "" } : { toHotel: v, toPlaceId: "" })
  const onHotelSelect = (c: PlaceCandidate) =>
    update(
      isFrom
        ? { fromHotel: c.name, fromPlaceId: c.placeId, fromCity: c.city }
        : { toHotel: c.name, toPlaceId: c.placeId, toCity: c.city },
    )

  const tabBase =
    "flex-1 h-8 rounded-lg text-[12px] font-medium transition-colors border"
  const tabOn = "bg-[#C8102E] text-white border-[#C8102E]"
  const tabOff = "bg-white text-[#64748B] border-[#CBD5E1] hover:bg-[#F1F5F9]"

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-[#334155]">{sectionLabel}</span>
        <div className="flex gap-1 w-[168px]" role="group" aria-label={sectionLabel}>
          <button type="button" onClick={() => setKind("hotel")}
            className={`${tabBase} ${kind === "hotel" ? tabOn : tabOff}`} aria-pressed={kind === "hotel"}>
            {t.kindHotel}
          </button>
          <button type="button" onClick={() => setKind("residence")}
            className={`${tabBase} ${kind === "residence" ? tabOn : tabOff}`} aria-pressed={kind === "residence"}>
            {t.kindResidence}
          </button>
        </div>
      </div>
      {kind === "residence" ? (
        <ResidenceFields
          value={residence}
          onChange={patchResidence}
          getAuthHeaders={placesAuthHeaders}
          t={t}
          idPrefix={`${side}${index}`}
        />
      ) : (
        <HotelSearchInput
          inputId={`${side}${index}`}
          value={hotelValue}
          placeholder={t.hotelSearchPlaceholder}
          lang={locale}
          selectedPlaceId={placeId || undefined}
          endpoint="/api/agency/places/search"
          getAuthHeaders={placesAuthHeaders}
          className="h-11 text-[15px]"
          ariaLabel={sectionLabel}
          onChange={onHotelChange}
          onSelect={onHotelSelect}
        />
      )}
    </div>
  )
}

/** ローカル(日本)日付の YYYY-MM-DD。過去日チェックに使う。 */
function todayYmd(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 発行前の入力チェック。過去日・到着<発送などを確定前に止める。
 * (2026-07: 発送日を前年で入力し送り状が出ない事故があったため確認画面で必ず弾く)
 */
function validateLegs(
  legs: Leg[],
  m: {
    errPastDate: (n: number) => string
    errArrivalBeforeShip: (n: number) => string
    errMissingHotel: (n: number) => string
    errMissingCheckIn: (n: number) => string
    errResidence: (n: number, side: string, field: string) => string
    resFieldLabels: Record<string, string>
    sideFrom: string
    sideTo: string
    errItemOther: (n: number) => string
  },
): string[] {
  const today = todayYmd()
  const errs: string[] = []
  legs.forEach((leg, i) => {
    const n = i + 1
    // 発送元: ホテルはホテル名必須 / 個人宅は構造化住所を検証
    if (leg.fromKind === "residence") {
      const e = residenceError(leg.fromResidence)
      if (e) errs.push(m.errResidence(n, m.sideFrom, m.resFieldLabels[e]))
    } else if (!leg.fromHotel.trim()) {
      errs.push(m.errMissingHotel(n))
    }
    // お届け先: 同上
    if (leg.toKind === "residence") {
      const e = residenceError(leg.toResidence)
      if (e) errs.push(m.errResidence(n, m.sideTo, m.resFieldLabels[e]))
    } else if (!leg.toHotel.trim()) {
      errs.push(m.errMissingHotel(n))
    }
    // お届け先ホテルのチェックイン日は「予約名+チェックイン日」でホテルが照合するため必須。
    // 個人宅は照合が無いので不要。早期配達もあるため発送日との前後は縛らない。
    if (leg.toKind !== "residence" && !leg.fromCheckIn) errs.push(m.errMissingCheckIn(n))
    if (leg.itemType === "other" && !leg.itemOther.trim()) errs.push(m.errItemOther(n))
    if (leg.shipmentDate && leg.shipmentDate < today) errs.push(m.errPastDate(n))
    if (leg.shipmentDate && leg.expectedArrival && leg.expectedArrival < leg.shipmentDate)
      errs.push(m.errArrivalBeforeShip(n))
  })
  return errs
}

export default function AgencyNewBookingPage() {
  const router = useRouter()
  const { locale, setLocale } = useAgencyLocale()
  const t = messages[locale]
  const [authChecked, setAuthChecked] = useState(false)
  const [representative, setRepresentative] = useState("")
  const [tourNumber, setTourNumber] = useState("")
  const [bookingName, setBookingName] = useState("")
  const [groupName, setGroupName] = useState("")
  const [travelerCount, setTravelerCount] = useState(1)
  const [guestLanguage, setGuestLanguage] = useState("en")
  // 団体 (Group) — FIT が既定。group のとき添乗員情報と荷物リストを追加入力。
  // 荷物リストは2段階UX: ①名簿(名前)を貼り付け → ②「荷物リストを作成」で構造化し、
  // ゲストごとの個数を手入力できる (名簿に個数が無いのが普通のため・谷口さん指示)。
  const [bookingType, setBookingType] = useState<"fit" | "group">("fit")
  // ── 送り状(紙)の郵送先・差出人。既定は「御社宛・差出人 BondEx」。
  const [labelTo, setLabelTo] = useState<LabelTo>(DEFAULT_LABEL_DELIVERY.to)
  const [labelSplit, setLabelSplit] = useState(DEFAULT_LABEL_DELIVERY.split)
  const [labelSender, setLabelSender] = useState<LabelSender>(DEFAULT_LABEL_DELIVERY.sender)
  const [agentInfo, setAgentInfo] = useState<ResidenceAddress>({ ...EMPTY_RESIDENCE })
  // 投函期限。既定 = 最初の発送日の5営業日前。手で触ったら自動追従をやめる。
  const [labelMailDue, setLabelMailDue] = useState("")
  const labelDueTouched = useRef(false)
  // 貴社名義で送れるかは「発送先住所が登録済みか」で決まる (未登録なら選ばせない)。
  const [hasShipAddress, setHasShipAddress] = useState<boolean | null>(null)
  const [leaderName, setLeaderName] = useState("")
  const [leaderPhone, setLeaderPhone] = useState("")
  const [leaderWhatsapp, setLeaderWhatsapp] = useState("")
  const [rosterText, setRosterText] = useState("") // 貼り付け用ステージング
  const [luggageEntries, setLuggageEntries] = useState<Array<{ name: string; bags: number }>>([])
  const buildEntriesFromRoster = () => {
    const names = rosterText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 50)
    if (names.length > 0) setLuggageEntries(names.map((name) => ({ name, bags: 1 })))
  }
  // API へは「1要素=1個」のフラット配列で送る (名前の繰り返し=複数個。API/DB/バウチャー集約は既存のまま)
  const luggageNames = luggageEntries.flatMap((e) =>
    Array.from({ length: Math.max(1, Math.min(9, e.bags)) }, () => e.name.trim()),
  ).slice(0, 50)

  const [legs, setLegs] = useState<Leg[]>([emptyLeg()])
  const [dupMatches, setDupMatches] = useState<
    Array<{ booking_id: string; representative: string; shipment_date: string }>
  >([])
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle")
  const [error, setError] = useState("")
  const [result, setResult] = useState<{
    bookingId: string
    needsLabelWait: boolean
    allIssued: boolean
    labels: Array<{ legIndex: number; url: string }>
    issueFailures: Array<{ legIndex: number; error?: string }>
  } | null>(null)
  const [dlBusy, setDlBusy] = useState(false)
  // バウチャーにご利用ガイドを同梱するか (既定 ON)。成功画面のDLボタンに反映。
  const [includeHowto, setIncludeHowto] = useState(true)
  // 入力 → 確認(プレビュー) → 完了 の3ステップ。done は status==="done" で表現。
  const [step, setStep] = useState<"input" | "confirm">("input")
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string>("")
  const [valErrors, setValErrors] = useState<string[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseNote, setParseNote] = useState("")
  const [parseError, setParseError] = useState("")

  useEffect(() => {
    const sb = getBrowserSupabase()
    if (!sb) {
      setAuthChecked(true)
      return
    }
    void sb.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/agency/login?next=/agency/new")
      else setAuthChecked(true)
    })
  }, [router])

  // 差出人「貴社名義」を選べるかの判定に使う。RLS で自社行のみ返る。
  useEffect(() => {
    const sb = getBrowserSupabase()
    if (!sb) return
    void sb
      .from("agencies")
      .select("ship_address")
      .maybeSingle()
      .then(({ data }) => {
        const addr = (data as { ship_address?: unknown } | null)?.ship_address
        setHasShipAddress(Boolean(addr && typeof addr === "object"))
      })
  }, [])

  // ── 予約の複製 (?dup=BDX-XXX): 元予約の行程・設定をプレフィルし、日付/代表者/Refは空に。
  //    「どの旅か」はバナー (複製元 + 代表者 + 行程) で常時見えるようにする。
  const [dupInfo, setDupInfo] = useState<{ bookingId: string; rep: string; route: string } | null>(null)
  useEffect(() => {
    const dup = new URLSearchParams(window.location.search).get("dup")?.trim()
    if (!dup) return
    ;(async () => {
      const sb = getBrowserSupabase()
      if (!sb) return
      const { data: rows } = await sb
        .from("shipments")
        .select("*")
        .eq("booking_id", dup)
        .order("leg_index", { ascending: true })
      if (!rows || rows.length === 0) return
      const first = rows[0] as Record<string, unknown>
      // 品目の逆引き: DBは解決済み日本語品名 → key へ (見つからなければ「その他」)
      const itemKeyOf = (stored: unknown): { itemType: ItemTypeKey; itemOther: string } => {
        const s = typeof stored === "string" ? stored.trim() : ""
        if (!s) return { itemType: "suitcase", itemOther: "" }
        const hit = ITEM_TYPES.find((x) => x.ja === s)
        return hit ? { itemType: hit.key, itemOther: "" } : { itemType: "other", itemOther: s.slice(0, 20) }
      }
      setLegs(
        (rows as Record<string, unknown>[]).map((r) => {
          const it = itemKeyOf(r.item_type)
          const fromRes = (r.from_residence as ResidenceAddress | null) ?? null
          const toRes = (r.to_residence as ResidenceAddress | null) ?? null
          return {
            fromKind: (fromRes ? "residence" : "hotel") as "hotel" | "residence",
            fromHotel: fromRes ? "" : ((r.from_hotel as string) ?? ""),
            fromPlaceId: (r.from_place_id as string) ?? "",
            fromCity: (r.from_city as string) ?? "",
            fromResidence: { ...EMPTY_RESIDENCE, ...(fromRes ?? {}) },
            toKind: (toRes ? "residence" : "hotel") as "hotel" | "residence",
            toHotel: toRes ? "" : ((r.to_hotel as string) ?? ""),
            toPlaceId: (r.to_place_id as string) ?? "",
            toCity: (r.to_city as string) ?? "",
            toResidence: { ...EMPTY_RESIDENCE, ...(toRes ?? {}) },
            // 日付は新しい旅なので全て空 (発送日入力で連動オートフィル)
            shipmentDate: "",
            expectedArrival: "",
            fromCheckIn: "",
            toCheckOut: "",
            deliveryTime: ((r.delivery_time as string) || "before-noon"),
            recipient: "",
            suitcaseCount: (r.suitcase_count as number) ?? 1,
            itemType: it.itemType,
            itemOther: it.itemOther,
            notes: (r.notes as string) ?? "",
            noteTarget: (["from", "to", "both"].includes(r.note_target as string)
              ? (r.note_target as "from" | "to" | "both")
              : "to"),
          }
        }),
      )
      // 予約レベル: 行程系は引き継ぎ、個人情報系 (代表者/Ref) は空に
      setGroupName((first.group_name as string) ?? "")
      setBookingName((first.booking_name as string) ?? "")
      setGuestLanguage((first.guest_language as string) || "en")
      const tc = Number(first.traveler_count)
      if (tc >= 1) setTravelerCount(tc)
      if (first.booking_type === "group") {
        setBookingType("group")
        setLeaderName((first.tour_leader_name as string) ?? "")
        setLeaderPhone((first.tour_leader_phone as string) ?? "")
        setLeaderWhatsapp((first.tour_leader_whatsapp as string) ?? "")
        const { data: lugs } = await sb
          .from("group_luggage")
          .select("guest_name, luggage_no")
          .eq("booking_id", dup)
          .eq("leg_index", 0)
          .order("luggage_no", { ascending: true })
        if (lugs && lugs.length > 0) {
          const byName = new Map<string, number>()
          for (const l of lugs) {
            const nm = ((l.guest_name as string) || "").trim() || "—"
            byName.set(nm, (byName.get(nm) ?? 0) + 1)
          }
          setLuggageEntries(Array.from(byName.entries()).map(([name, bags]) => ({ name, bags })))
        }
      }
      const routeChain = (rows as Record<string, unknown>[])
        .map((r) => `${r.from_hotel} → ${r.to_hotel}`)
        .join(" ／ ")
      setDupInfo({ bookingId: dup, rep: (first.representative as string) ?? "", route: routeChain })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // AI 読み込み後の「不足している情報」チェックリスト。入力が埋まるとリアルタイムで消える。
  // (validateLegs の項目 + 代表者名 + 団体の必須項目)
  // 投函期限の選択可能範囲。
  // 下限 = 伝票が全て発行できる日 (佐川は発送30日前から発行可能):
  //   一括郵送は全区間の伝票が揃う必要があるため「最終区間の発送日-30日」、
  //   分送は最初の封筒が最初の区間の伝票だけで送れるため「最初の区間の発送日-30日」。
  // 上限 = 最初の発送日の前日 (当日に投函しても間に合わない)。
  const labelDueRange = useMemo(() => {
    const ymdAdd = (ymd: string, days: number): string => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
      if (!m) return ""
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))
      d.setUTCDate(d.getUTCDate() + days)
      return d.toISOString().slice(0, 10)
    }
    const ships = legs.map((l) => l.shipmentDate).filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
    if (ships.length === 0) return null
    const first = ships.reduce((a, b) => (a < b ? a : b))
    const last = ships.reduce((a, b) => (a > b ? a : b))
    const issuableFrom = ymdAdd(labelTo === "hotel" && labelSplit ? first : last, -30)
    return { min: issuableFrom, max: ymdAdd(first, -1), first }
  }, [legs, labelTo, labelSplit])

  // 既定値: 最初の発送日の5営業日前 (範囲内に収める)。手動変更後は追従しない。
  useEffect(() => {
    if (labelDueTouched.current || !labelDueRange) return
    const def = defaultLabelMailDue(labelDueRange.first) || labelDueRange.max
    const clamped =
      def < labelDueRange.min ? labelDueRange.min : def > labelDueRange.max ? labelDueRange.max : def
    setLabelMailDue(clamped)
  }, [labelDueRange])


  const missingAfterParse = useMemo(() => {
    const list = validateLegs(legs, t)
    if (!representative.trim()) list.unshift(t.missingRep)
    if (bookingType === "group") {
      if (!leaderName.trim()) list.push(t.missingLeader)
      if (luggageNames.length === 0) list.push(t.missingLuggage)
    }
    // 投函期限が選択範囲外なら止める (伝票が発行できない期間には送れない)
    if (labelMailDue && labelDueRange && (labelMailDue < labelDueRange.min || labelMailDue > labelDueRange.max)) {
      list.push(t.ldDueRange)
    }
    // 差出人に旅行代理店を選んだら住所一式が必須 (封筒に刷るため)
    if (labelSender === "other") {
      const missing = residenceError(agentInfo)
      if (missing) list.push(`${t.ldSenderAgent}: ${senderFieldLabel(missing, locale)}`)
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, representative, bookingType, leaderName, luggageNames.length, locale, labelSender, agentInfo, labelMailDue, labelDueRange])

  // 確認画面用: 送り状が何通どこへ届くか
  const labelParcels = useMemo(
    () =>
      resolveLabelParcels(
        { to: labelTo, split: labelSplit, sender: labelSender, senderInfo: null, mailDue: null },
        legs.map((l, i) => ({
          legIndex: i,
          fromHotel: l.fromHotel || "—",
          shipmentDate: l.shipmentDate || "—",
          suitcaseCount: l.suitcaseCount,
        })),
        { agencyName: t.ldToAgency, travelerName: representative || "—" },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labelTo, labelSplit, labelSender, legs, representative, locale],
  )
  const labelSenderLabel =
    labelSender === "bondex" ? t.ldSenderBondex
    : labelSender === "agency" ? t.ldSenderLand
    : agentInfo.name || t.ldSenderAgent

  const updateLeg = (i: number, patch: Partial<Leg>) =>
    setLegs((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  // 発送日の変更に、依存する日付(到着日・お届け先チェックイン/アウト)を必ず連動させる。
  // 発送日だけ変えて他が据え置きになるケースは業務上あり得ない(谷口さん指示)。
  //  - 既に発送日が入っていた場合: 変更差分(日数)だけ全日付をスライド(手動調整のオフセット維持)
  //  - 初回入力(または旧値が不正)の場合: 到着=翌日 / チェックイン=発送日(お客様は同日移動が標準) /
  //    チェックアウトは値がある時だけ発送日に合わせる(任意項目のため空は空のまま)
  const DATE_RE_LOCAL = /^\d{4}-\d{2}-\d{2}$/
  const addDaysYmd = (ymd: string, days: number): string => {
    const d = new Date(`${ymd}T00:00:00Z`)
    if (isNaN(d.getTime())) return ymd
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  const onShipDateChange = (i: number, value: string) =>
    setLegs((prev) =>
      prev.map((leg, idx) => {
        if (idx !== i) return leg
        const patch: Partial<Leg> = { shipmentDate: value }
        if (DATE_RE_LOCAL.test(value)) {
          const delta = DATE_RE_LOCAL.test(leg.shipmentDate)
            ? Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${leg.shipmentDate}T00:00:00Z`)) / 86_400_000)
            : null
          patch.expectedArrival =
            delta !== null && DATE_RE_LOCAL.test(leg.expectedArrival)
              ? addDaysYmd(leg.expectedArrival, delta)
              : addDaysYmd(value, 1)
          patch.fromCheckIn =
            delta !== null && DATE_RE_LOCAL.test(leg.fromCheckIn)
              ? addDaysYmd(leg.fromCheckIn, delta)
              : value
          if (DATE_RE_LOCAL.test(leg.toCheckOut)) {
            patch.toCheckOut = delta !== null ? addDaysYmd(leg.toCheckOut, delta) : value
          }
        }
        return { ...leg, ...patch }
      }),
    )
  // 個人宅住所は関数型で最新状態にマージ (郵便番号の非同期補完が古い state を上書きしないように)。
  const patchResidence = (i: number, side: "from" | "to", patch: Partial<ResidenceAddress>) =>
    setLegs((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l
        return side === "from"
          ? { ...l, fromResidence: { ...l.fromResidence, ...patch } }
          : { ...l, toResidence: { ...l.toResidence, ...patch } }
      }),
    )
  const addLeg = () => setLegs((prev) => [...prev, emptyLeg()])
  const removeLeg = (i: number) => setLegs((prev) => prev.filter((_, idx) => idx !== i))

  // ホテル検索 (Google Places) を代理店ルートに Bearer 付きで叩かせる
  const placesAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const sb = getBrowserSupabase()
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [])

  // フロー図の出し分け: 入力中の最短発送日が1ヶ月以内なら「すぐ発行」版を表示。
  // 日付未入力なら1ヶ月ルールを説明する待機版をデフォルト表示。
  const previewNeedsWait = useMemo(() => {
    const dates = legs.map((l) => l.shipmentDate).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    if (dates.length === 0) return true
    const earliest = [...dates].sort()[0]
    const days = Math.round((new Date(`${earliest}T00:00:00`).getTime() - Date.now()) / 86_400_000)
    return days > 30
  }, [legs])

  // 旅程表 (PDF/画像) を AI 解析してフォームに反映。発行はしないので課金なし。
  const onParseFile = async (file: File) => {
    setParseError("")
    setParseNote("")
    setParsing(true)
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) {
        setParseError(t.notLoggedIn)
        return
      }
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/agency/itinerary/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        guest?: { travelerCount?: number; travelers?: Array<{ name?: string; title?: string }> }
        shipments?: Array<{
          shipmentDate?: string
          expectedArrival?: string
          from?: { hotel?: string; city?: string }
          to?: { hotel?: string; city?: string; checkIn?: string; checkOut?: string }
          recipient?: string
        }>
        luggageRoster?: Array<{ name?: string; bags?: number }>
      }
      if (!res.ok) {
        setParseError(data.error || t.autoErr)
        return
      }
      const ships = Array.isArray(data.shipments) ? data.shipments : []
      // 名簿ドキュメント対応: 配送依頼のあるゲストのリスト (YES行のみ)。
      const roster = (Array.isArray(data.luggageRoster) ? data.luggageRoster : []).filter(
        (r): r is { name: string; bags?: number } => typeof r?.name === "string" && r.name.trim().length > 0,
      )
      if (ships.length === 0 && roster.length === 0) {
        setParseError(t.autoErr)
        return
      }
      // 名簿 → 構造化荷物リスト(名前＋個数)へ反映し、予約タイプを団体に切替。
      // 個数は名簿に書いてあれば採用、無ければ1(あとで画面のステッパーで手修正可)。
      if (roster.length > 0) {
        setLuggageEntries(
          roster.slice(0, 50).map((r) => ({
            name: r.name.trim(),
            bags: Math.max(1, Math.min(9, Math.floor(Number(r.bags) || 1))),
          })),
        )
        setBookingType("group")
      }
      const ymd = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "")
      const firstTraveler = data.guest?.travelers?.[0]
      const rep =
        ships[0]?.recipient ||
        (firstTraveler ? [firstTraveler.title, firstTraveler.name].filter(Boolean).join(" ").trim() : "") ||
        (roster.length > 0 ? roster[0].name.trim() : "")
      if (rep) setRepresentative(rep)
      const tc = Number(data.guest?.travelerCount) || (data.guest?.travelers?.length ?? 0)
      if (tc >= 1) setTravelerCount(tc)
      // 名簿のみ (行程なし) の場合は区間を触らずに完了
      if (ships.length === 0) {
        setParseNote(t.autoRosterDone(roster.length))
        return
      }
      setLegs(
        ships.map((s) => ({
          // 旅程表はホテル前提。個人宅は手動でトグルして入力する。
          fromKind: "hotel" as const,
          fromHotel: s.from?.hotel || "",
          fromPlaceId: "", // AI 解析では placeId は付かない → 必要なら候補から選び直す
          fromCity: s.from?.city || "",
          fromResidence: { ...EMPTY_RESIDENCE },
          toKind: "hotel" as const,
          toHotel: s.to?.hotel || "",
          toPlaceId: "",
          toCity: s.to?.city || "",
          toResidence: { ...EMPTY_RESIDENCE },
          shipmentDate: ymd(s.shipmentDate),
          expectedArrival: ymd(s.expectedArrival) || ymd(s.shipmentDate),
          // お届け先ホテルのチェックイン日(お客様の到着日)/チェックアウト日:
          // 旅程表に記載があれば転記、なければ発送日を自動で入れる(谷口さん要望)。
          fromCheckIn: ymd(s.to?.checkIn) || ymd(s.shipmentDate),
          toCheckOut: ymd(s.to?.checkOut) || ymd(s.shipmentDate),
          deliveryTime: "before-noon",
          recipient: s.recipient || "",
          suitcaseCount: 1, // 旅程表には個数が無いことが多い → 既定 1、後で修正
          itemType: "suitcase" as const, // 旅程表からは判別不可 → 既定スーツケース。必要なら手動変更
          itemOther: "",
          notes: "",
          noteTarget: "to" as const,
        })),
      )
      setParseNote(t.autoDone)
    } catch {
      setParseError(t.autoErr)
    } finally {
      setParsing(false)
    }
  }

  // 実際の登録 (重複チェックを通過 or「このまま登録」後に呼ぶ)
  const submitBooking = async () => {
    setError("")
    setDupMatches([])
    setStatus("submitting")
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) {
        setError(t.notLoggedIn)
        setStatus("error")
        return
      }
      const res = await fetch("/api/agency/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          representative,
          tourNumber,
          bookingName,
          groupName,
          travelerCount,
          guestLanguage,
          legs,
          bookingType,
          labelDelivery: {
            to: labelTo,
            split: labelSplit,
            sender: labelSender,
            senderInfo: labelSender === "other" ? agentInfo : null,
            mailDue: labelMailDue || null,
          },
          ...(bookingType === "group"
            ? {
                tourLeaderName: leaderName,
                tourLeaderPhone: leaderPhone,
                tourLeaderWhatsapp: leaderWhatsapp,
                luggageNames,
              }
            : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || t.errGeneric)
        setStatus("error")
        return
      }
      setResult({
        bookingId: data.bookingId,
        needsLabelWait: Boolean(data.needsLabelWait),
        allIssued: Boolean(data.allIssued),
        labels: Array.isArray(data.labels) ? data.labels : [],
        issueFailures: Array.isArray(data.issueFailures) ? data.issueFailures : [],
      })
      setStatus("done")
    } catch {
      setError(t.errNetwork)
      setStatus("error")
    }
  }

  // 成功画面からバウチャーを直接DL (代理店 JWT で自社限定エンドポイントを叩く)。
  // includeHowto=false のときだけ ?howto=0 でご利用ガイドの同梱を外す (既定は同梱)。
  const downloadVoucher = async (bookingId: string) => {
    setDlBusy(true)
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) {
        setError(t.notLoggedIn)
        return
      }
      const howtoParam = includeHowto ? "" : "&howto=0"
      const res = await fetch(
        `/api/agency/voucher?booking_id=${encodeURIComponent(bookingId)}${howtoParam}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) {
        alert(t.errNetwork)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${bookingId}_voucher.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert(t.errNetwork)
    } finally {
      setDlBusy(false)
    }
  }

  // 確認画面用のバウチャープレビューを取得 (DB書込・発行なし)
  const fetchPreview = async () => {
    setPreviewBusy(true)
    setPreviewError("")
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return ""
    })
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) {
        setPreviewError(t.notLoggedIn)
        return
      }
      const res = await fetch("/api/agency/voucher-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ representative, tourNumber, bookingName, groupName, guestLanguage, includeHowto, legs }),
      })
      if (!res.ok) {
        setPreviewError(`${t.previewUnavailable} (HTTP ${res.status})`)
        return
      }
      setPreviewUrl(URL.createObjectURL(await res.blob()))
    } catch {
      setPreviewError(t.previewUnavailable)
    } finally {
      setPreviewBusy(false)
    }
  }

  // 入力 → 確認へ。ここでは発行しない (検証 + 二重依頼チェックのみ)。
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError("")
    setDupMatches([])
    // 入力検証 (過去日・到着<発送・ホテル未入力) — 誤りは確定前に必ず止める
    const errs = validateLegs(legs, t)
    // 団体の追加検証: 添乗員名と荷物リスト
    if (bookingType === "group") {
      if (!leaderName.trim()) errs.push(t.grpLeaderRequired)
      if (luggageNames.length === 0) errs.push(t.grpLuggageRequired)
    }
    setValErrors(errs)
    if (errs.length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    // 二重依頼チェック (自社内・警告のみ)。マッチしたら止めて確認を促す。
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (token) {
        const dates = Array.from(new Set(legs.map((l) => l.shipmentDate).filter(Boolean)))
        if (representative && dates.length > 0) {
          const res = await fetch("/api/agency/duplicate-check", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ names: [representative], dates }),
          })
          const data = (await res.json().catch(() => ({ matches: [] }))) as {
            matches?: Array<{ booking_id: string; representative: string; shipment_date: string }>
          }
          const matches = Array.isArray(data.matches) ? data.matches : []
          if (matches.length > 0) {
            setDupMatches(matches)
            return // 警告を出して止める (「このまま確認へ」で goToConfirm)
          }
        }
      }
    } catch {
      /* 重複チェック失敗は無視して確認へ進む (ベストエフォート) */
    }
    goToConfirm()
  }

  // 確認ステップへ遷移し、プレビューを読み込む
  const goToConfirm = () => {
    setDupMatches([])
    setStep("confirm")
    window.scrollTo({ top: 0, behavior: "smooth" })
    void fetchPreview()
  }

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" strokeWidth={1.5} />
      </main>
    )
  }

  if (status === "done" && result) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 sm:px-6 py-10">
        <div className="w-full max-w-2xl mx-auto space-y-5">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <Check className="w-6 h-6 text-emerald-700" strokeWidth={2.5} />
            </div>
            <h1 className="text-[18px] font-bold text-[#0F172A]">{t.doneTitle}</h1>
            <p className="text-[12px] text-muted-foreground mt-3">{t.doneBooking}</p>
            <p className="font-mono text-[15px] text-[#0F172A]">{result.bookingId}</p>
            {bookingType === "group" && (
              <a
                href={`/agency/groups/${encodeURIComponent(result.bookingId)}`}
                className="inline-flex items-center justify-center mt-4 h-10 px-5 rounded-xl bg-[#0F172A] text-white text-[13px] font-bold hover:bg-[#1E293B]"
              >
                {t.grpDashboardLink} →
              </a>
            )}
          </div>

          {/* 1ヶ月以内なのに送り状を発行できなかった区間があるときの明示 (無言で「待ち」にしない) */}
          {result.issueFailures.length > 0 && (
            <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
              <p className="text-[14px] font-bold text-red-800 flex items-center gap-1.5">
                <AlertTriangle className="w-4.5 h-4.5 shrink-0" strokeWidth={2} />
                {t.issueFailTitle}
              </p>
              <p className="text-[13px] text-red-700 leading-[1.9] mt-2">{t.issueFailBody}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {result.issueFailures.map((f) => (
                  <li key={f.legIndex} className="text-[12px] font-bold text-red-800 bg-red-100 rounded px-2 py-0.5">
                    {t.issueFailLeg(f.legIndex + 1)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* バウチャー出力時に「ご利用ガイド」を最終ページに同梱するか選べる (既定 ON・複数区間でも1枚) */}
          <label className="flex items-start gap-2.5 rounded-xl border border-[#E5E7EB] bg-white p-3.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeHowto}
              onChange={(e) => setIncludeHowto(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border shrink-0"
            />
            <span>
              <span className="block text-[13px] font-bold text-[#0F172A]">{t.howtoToggle}</span>
              <span className="block text-[12px] text-muted-foreground leading-[1.7] mt-0.5">{t.howtoToggleSub}</span>
            </span>
          </label>

          {result.allIssued ? (
            /* 1ヶ月以内 → 即発行済み。その場でDL */
            <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6">
              <div className="flex items-center gap-2 mb-3">
                <Check className="w-5 h-5 text-emerald-700" strokeWidth={2.5} />
                <p className="text-[15px] font-bold text-emerald-900">{t.doneReadyHeading}</p>
              </div>
              <p className="text-[14px] text-emerald-800 leading-[2] mb-4">{t.doneReadyBody}</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => downloadVoucher(result.bookingId)}
                  disabled={dlBusy}
                  className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl bg-[#C8102E] text-white text-[13px] font-bold hover:bg-[#a00d25] disabled:opacity-50"
                >
                  {dlBusy ? "…" : t.dlVoucher}
                </button>
                {result.labels.map((l) => (
                  <a
                    key={l.legIndex}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl border border-[#C8102E] text-[#C8102E] text-[13px] font-bold hover:bg-[#FFF1F2]"
                  >
                    {result.labels.length > 1 ? t.dlLeg(l.legIndex + 1) : t.dlLabel}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            /* 1ヶ月超 → 発行窓の外。窓が開いたら発行してご連絡 */
            <>
              <div className="rounded-2xl border-2 border-[#FED7AA] bg-[#FFF7ED] p-6">
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen className="w-5 h-5 text-[#C8102E]" strokeWidth={2} />
                  <p className="text-[15px] font-bold text-[#9A3412]">{t.doneShareHeading}</p>
                </div>
                <p className="text-[14px] text-[#7C2D12] leading-[2] mb-4">{t.doneWait}</p>
                {/* バウチャーは Ship&co 不要 = 1ヶ月超の依頼でも今すぐDLできる */}
                <button
                  type="button"
                  onClick={() => downloadVoucher(result.bookingId)}
                  disabled={dlBusy}
                  className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl bg-[#C8102E] text-white text-[13px] font-bold hover:bg-[#a00d25] disabled:opacity-50"
                >
                  {dlBusy ? "…" : t.dlVoucher}
                </button>
              </div>
              <FlowDiagram heading={t.flowHeading} steps={t.flow} icons={FLOW_ICONS} />
            </>
          )}

          {/* ご利用ガイド単体が欲しいとき用の控えめなリンク (バウチャーには既定で同梱済み) */}
          <p className="text-center text-[12px] text-muted-foreground">
            {t.howtoStandalonePrefix}{" "}
            <a
              href={`/api/howto?lang=${guestLanguage}&dl=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-[#0F172A] underline underline-offset-2 hover:text-[#C8102E]"
            >
              {t.dlHowto}
            </a>
          </p>

          <div className="text-center">
            <Link
              href="/agency"
              className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl bg-[#0F172A] text-white text-[14px] font-bold hover:bg-[#1E293B]"
            >
              {t.doneBack}
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // ── ステップ2: 確認(プレビュー)。ここでは発行しない。戻る=入力へ / 発行=完了へ ──
  if (step === "confirm") {
    return (
      <main className="min-h-screen bg-slate-50 px-4 sm:px-6 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <button
              type="button"
              onClick={() => setStep("input")}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              {t.backToEdit}
            </button>
            <AgencyLocaleToggle locale={locale} onChange={setLocale} />
          </div>

          <div className="mb-6">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">{t.confirmBadge}</p>
            <h1 className="text-[22px] font-bold text-[#0F172A] mt-1">{t.confirmTitle}</h1>
            <p className="text-[13px] text-[#64748B] mt-2 leading-relaxed">{t.confirmLead}</p>
          </div>

          {error && (
            <p className="text-[13px] text-red-600 mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3" role="alert">
              {error}
            </p>
          )}

          {/* 内容サマリ */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 md:p-6 space-y-4">
            <p className="text-[13px] font-bold text-[#0F172A]">{t.reviewHeading}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <ReviewRow label={t.rvGuest} value={representative} />
              {tourNumber ? <ReviewRow label={t.rvTour} value={tourNumber} /> : null}
              <ReviewRow label={t.rvLang} value={(GUEST_LANGS.find(([c]) => c === guestLanguage)?.[1]) || guestLanguage} />
            </div>

            {/* 送り状(紙)が何通どこへ届くかを確定前に見せる。
                「1通と思っていたら区間ごとに届いた」といった行き違いを防ぐ。 */}
            <div className="rounded-xl border border-[#E5E7EB] bg-slate-50/60 p-4 mt-3">
              <p className="text-[12px] font-bold text-[#334155] mb-2">{t.ldReview}</p>
              <div className="space-y-1">
                {labelParcels.map((p, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 text-[12px]">
                    <span className="text-[#0F172A]">{p.addressee}</span>
                    <span className="text-[#64748B] shrink-0">{p.detail}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#64748B] mt-2">
                {t.ldSenderLabel}: {labelSenderLabel}
                {labelMailDue ? ` ／ ${t.ldDueLabel}: ${labelMailDue}` : ""}
              </p>
            </div>

            {/* 団体: 添乗員と荷物リストも確認画面で必ず見せる */}
            {bookingType === "group" && (
              <div className="rounded-xl border border-[#E5E7EB] bg-slate-50/60 p-4 mt-3">
                <p className="text-[12px] font-bold text-[#334155] mb-2">
                  {t.rvGroupHeading}
                  {groupName ? ` — ${groupName}` : ""}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] mb-3">
                  <ReviewRow label={t.rvLeader} value={[leaderName, leaderPhone].filter(Boolean).join(" ・ ") || "—"} span />
                </div>
                <p className="text-[11px] uppercase tracking-wider text-[#94A3B8] mb-1">{t.rvLuggage}</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                  {luggageEntries.map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-[12px] border-b border-[#F1F5F9] py-1">
                      <span className="text-[#0F172A] truncate">
                        <span className="font-mono text-[10px] text-[#94A3B8] mr-1.5">{String(i + 1).padStart(2, "0")}</span>
                        {e.name || "—"}
                      </span>
                      <span className={`tabular-nums font-bold ${e.bags > 1 ? "text-[#C8102E]" : "text-[#334155]"}`}>
                        ×{e.bags}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[12px] font-bold text-[#0F172A] mt-2 text-right">
                  {t.lugTotal(luggageEntries.length, luggageNames.length)}
                </p>
              </div>
            )}
            <div className="space-y-3 pt-1">
              {legs.map((leg, i) => {
                const fromLabel = leg.fromKind === "residence"
                  ? `${leg.fromResidence.name}（${t.kindResidence}）`
                  : leg.fromHotel
                const toLabel = leg.toKind === "residence"
                  ? `${leg.toResidence.name}（${t.kindResidence}）`
                  : leg.toHotel
                const resLine = (r: ResidenceAddress) => {
                  const zip = r.zip ? `〒${r.zip} ` : ""
                  const bld = r.building ? ` ${r.building}` : ""
                  return `${zip}${r.prefecture}${r.city}${r.street}${bld}`.trim()
                }
                const itemDef = ITEM_TYPES.find((x) => x.key === leg.itemType)
                const itemLabel = leg.itemType === "other"
                  ? (leg.itemOther.trim() || (locale === "ja" ? "その他" : "Other"))
                  : (itemDef ? (locale === "ja" ? itemDef.ja : itemDef.en) : leg.itemType)
                return (
                <div key={i} className="rounded-xl border border-[#E5E7EB] bg-slate-50/60 p-4">
                  <p className="text-[12px] font-bold text-[#334155] mb-2">{t.rvLeg} {i + 1}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                    <ReviewRow label={t.rvRoute} value={`${fromLabel} → ${toLabel}`} span />
                    {leg.fromKind === "residence" ? <ReviewRow label={t.fromHotel} value={resLine(leg.fromResidence)} span /> : null}
                    {leg.toKind === "residence" ? <ReviewRow label={t.toHotel} value={resLine(leg.toResidence)} span /> : null}
                    <ReviewRow label={t.rvShip} value={leg.shipmentDate} />
                    <ReviewRow label={t.rvArrive} value={leg.expectedArrival} />
                    <ReviewRow label={t.rvItem} value={itemLabel} />
                    <ReviewRow label={t.rvBags} value={String(leg.suitcaseCount)} />
                    <ReviewRow label={t.rvSlot} value={slotLabel(leg.deliveryTime, locale)} />
                    {leg.notes ? <ReviewRow label={t.rvNote} value={leg.notes} span /> : null}
                  </div>
                </div>
                )
              })}
            </div>
          </div>

          {/* ご利用ガイド同梱トグル (プレビューに反映) */}
          <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#E5E7EB] bg-white p-3.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeHowto}
              onChange={(e) => { setIncludeHowto(e.target.checked); void fetchPreview() }}
              className="mt-0.5 h-4 w-4 rounded border-border shrink-0"
            />
            <span>
              <span className="block text-[13px] font-bold text-[#0F172A]">{t.howtoToggle}</span>
              <span className="block text-[12px] text-muted-foreground leading-[1.7] mt-0.5">{t.howtoToggleSub}</span>
            </span>
          </label>

          {/* バウチャー プレビュー */}
          <div className="mt-4 rounded-2xl border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-[13px] font-bold text-[#0F172A]">{t.previewHeading}</p>
              {/* 別タブで開く = ブラウザ非依存の確実な表示 (Safari等は iframe 内の
                  blob PDF を描画しないため、ネイティブのPDFビューアで開けるようにする)。 */}
              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[#0F172A] text-white text-[12px] font-bold hover:bg-[#1E293B]"
                >
                  <ExternalLink className="w-3.5 h-3.5" strokeWidth={2} />
                  {t.previewOpenTab}
                </a>
              )}
            </div>
            {previewBusy ? (
              <div className="h-[60vh] flex items-center justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" strokeWidth={1.8} />
                <span className="text-[13px]">{t.previewLoading}</span>
              </div>
            ) : previewError ? (
              <p className="text-[13px] text-red-600 py-8 text-center">{previewError}</p>
            ) : previewUrl ? (
              <>
                {/* Chrome/Firefox/Edge はインライン表示。Safari 等で空白の場合は上の
                    「新しいタブで開く」からご確認ください。 */}
                <iframe title={t.previewHeading} src={previewUrl} className="w-full h-[70vh] rounded-lg border border-[#E5E7EB]" />
                <p className="text-[11px] text-muted-foreground mt-2 text-center">{t.previewFallbackNote}</p>
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground py-8 text-center">{t.previewUnavailable}</p>
            )}
          </div>

          {/* アクション: 戻る / 発行 */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setStep("input")}
              className="sm:flex-1 h-12 rounded-xl border border-[#0F172A] text-[#0F172A] text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-slate-50"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={2} />
              {t.backToEdit}
            </button>
            <button
              type="button"
              onClick={() => void submitBooking()}
              disabled={status === "submitting"}
              className="sm:flex-1 h-12 rounded-xl bg-[#C8102E] text-white text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#A00D25] disabled:opacity-50"
            >
              {status === "submitting" ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : <Check className="w-4 h-4" strokeWidth={2.5} />}
              {status === "submitting" ? t.confirmIssuing : t.confirmIssue}
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 sm:px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/agency"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            {t.back}
          </Link>
          <AgencyLocaleToggle locale={locale} onChange={setLocale} />
        </div>

        <div className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">{t.badge}</p>
          <h1 className="text-[22px] font-bold text-[#0F172A] mt-1">{t.title}</h1>
          <p className="text-[13px] text-[#64748B] mt-2 leading-relaxed">{t.lead}</p>
        </div>

        <div className="mb-6">
          <FlowDiagram
            heading={t.flowHeading}
            steps={previewNeedsWait ? t.flow : t.flowSoon}
            icons={previewNeedsWait ? FLOW_ICONS : FLOW_ICONS_SOON}
          />
        </div>

        {/* 入力検証エラー (過去日など) — 確認へ進む前に表示 */}
        {valErrors.length > 0 && (
          <div className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4" role="alert">
            <p className="text-[13px] font-bold text-red-800 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2} />
              {t.valTitle}
            </p>
            <ul className="mt-1.5 space-y-0.5 list-disc pl-5">
              {valErrors.map((msg, i) => (
                <li key={i} className="text-[12px] text-red-700">{msg}</li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-5">
          {/* 複製バナー: どの旅の複製か常に見えるように (代表者 + 行程チェーン) */}
          {dupInfo && (
            <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-4">
              <p className="text-[12px] font-bold text-[#1E40AF]">
                {t.dupFrom(dupInfo.bookingId)}
                {dupInfo.rep ? ` ・ ${dupInfo.rep}` : ""}
              </p>
              <p className="text-[12px] text-[#1D4ED8] mt-0.5 leading-relaxed">{dupInfo.route}</p>
              <p className="text-[11px] text-[#3B82F6] mt-1">{t.dupNote}</p>
            </div>
          )}

          {/* 予約タイプ (FIT / 団体) — 最優先の選択なので最上部 (谷口さん指示) */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 md:p-6">
            <p className="text-[12px] font-medium text-[#334155] mb-2">
              {t.bookingTypeLabel} <span className="text-[#C8102E]">*</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBookingType("fit")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  bookingType === "fit"
                    ? "border-[#C8102E] ring-1 ring-[#C8102E] bg-[#FFF7F7]"
                    : "border-[#E5E7EB] bg-white hover:border-[#CBD5E1]"
                }`}
              >
                <p className="text-[14px] font-bold text-[#0F172A]">{t.btFit}</p>
                <p className="text-[11px] text-[#64748B] mt-0.5">{t.btFitDesc}</p>
              </button>
              <button
                type="button"
                onClick={() => setBookingType("group")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  bookingType === "group"
                    ? "border-[#C8102E] ring-1 ring-[#C8102E] bg-[#FFF7F7]"
                    : "border-[#E5E7EB] bg-white hover:border-[#CBD5E1]"
                }`}
              >
                <p className="text-[14px] font-bold text-[#0F172A]">{t.btGroup}</p>
                <p className="text-[11px] text-[#64748B] mt-0.5">{t.btGroupDesc}</p>
              </button>
            </div>
          </div>

          {/* ── 送り状(紙)のお届け先 ──
              BondEx が印刷した佐川の送り状を、旅行者がお預けになる前に手元へ届ける必要がある。
              どこへ送るか / 封筒の差出人を誰にするかを依頼時に選ぶ (谷口さん 2026-08-28)。 */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
            <p className="text-[13px] font-bold text-[#0F172A]">{t.ldHeading}</p>
            <p className="text-[12px] text-[#64748B] mt-1 leading-relaxed">{t.ldBody}</p>

            {/* 送付先 */}
            <p className="text-[12px] font-semibold text-[#334155] mt-4 mb-2">{t.ldToLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["agency", t.ldToAgency, t.ldToAgencyDesc],
                ["hotel", t.ldToHotel, t.ldToHotelDesc],
              ] as const).map(([val, title, desc]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setLabelTo(val)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    labelTo === val
                      ? "border-[#C8102E] ring-1 ring-[#C8102E] bg-[#FFF7F7]"
                      : "border-[#E5E7EB] bg-white hover:border-[#CBD5E1]"
                  }`}
                >
                  <p className="text-[14px] font-bold text-[#0F172A]">{title}</p>
                  <p className="text-[11px] text-[#64748B] mt-0.5">{desc}</p>
                </button>
              ))}
            </div>

            {/* ホテル宛かつ複数区間のときだけ「まとめて/区間ごと」を聞く */}
            {labelTo === "hotel" && legs.length > 1 && (
              <>
                <p className="text-[12px] font-semibold text-[#334155] mt-4 mb-2">
                  {t.ldSplitLabel}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    [false, t.ldSplitOnce, t.ldSplitOnceDesc],
                    [true, t.ldSplitEach, t.ldSplitEachDesc],
                  ] as const).map(([val, title, desc]) => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => setLabelSplit(val)}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        labelSplit === val
                          ? "border-[#C8102E] ring-1 ring-[#C8102E] bg-[#FFF7F7]"
                          : "border-[#E5E7EB] bg-white hover:border-[#CBD5E1]"
                      }`}
                    >
                      <p className="text-[13px] font-bold text-[#0F172A]">{title}</p>
                      <p className="text-[11px] text-[#64748B] mt-0.5">{desc}</p>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* いつまでに送るか。伝票は発送30日前からしか発行できないため範囲を制約 */}
            <p className="text-[12px] font-semibold text-[#334155] mt-4 mb-2">{t.ldDueLabel}</p>
            <input
              type="date"
              className={`${inputCls} max-w-[220px]`}
              value={labelMailDue}
              min={labelDueRange?.min}
              max={labelDueRange?.max}
              onChange={(e) => {
                labelDueTouched.current = true
                setLabelMailDue(e.target.value)
              }}
            />
            <p className="text-[11px] text-[#64748B] mt-1.5">{t.ldDueHint}</p>

            {/* 差出人 */}
            <p className="text-[12px] font-semibold text-[#334155] mt-4 mb-2">{t.ldSenderLabel}</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                ["bondex", t.ldSenderBondex, ""],
                ["agency", t.ldSenderLand, t.ldSenderLandDesc],
                ["other", t.ldSenderAgent, t.ldSenderAgentDesc],
              ] as const).map(([val, title, desc]) => {
                // 発送先住所が未登録なら「貴社名義」は選べない (宛名不備で郵送が止まるため)
                const disabled = val === "agency" && hasShipAddress === false
                return (
                  <button
                    key={val}
                    type="button"
                    disabled={disabled}
                    onClick={() => setLabelSender(val)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      disabled
                        ? "border-[#E5E7EB] bg-[#F8FAFC] cursor-not-allowed opacity-60"
                        : labelSender === val
                          ? "border-[#C8102E] ring-1 ring-[#C8102E] bg-[#FFF7F7]"
                          : "border-[#E5E7EB] bg-white hover:border-[#CBD5E1]"
                    }`}
                  >
                    <p className="text-[13px] font-bold text-[#0F172A]">{title}</p>
                    {desc && <p className="text-[11px] text-[#64748B] mt-0.5">{desc}</p>}
                  </button>
                )
              })}
            </div>
            {labelSender === "agency" && hasShipAddress === false && (
              <p className="text-[11px] text-[#C8102E] mt-2">{t.ldSenderMissing}</p>
            )}

            {/* 旅行代理店名義のときだけ住所を聞く */}
            {labelSender === "other" && (
              <div className="mt-3 grid gap-3 rounded-xl bg-[#F8FAFC] p-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.ldAgentName} htmlFor="agName" required>
                    <input id="agName" className={inputCls} value={agentInfo.name}
                      onChange={(e) => setAgentInfo({ ...agentInfo, name: e.target.value })} />
                  </Field>
                  <Field label={t.ldAgentPhone} htmlFor="agPhone" required>
                    <input id="agPhone" className={inputCls} value={agentInfo.phone}
                      onChange={(e) => setAgentInfo({ ...agentInfo, phone: e.target.value })} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.ldAgentZip} htmlFor="agZip" required>
                    <input id="agZip" className={inputCls} value={agentInfo.zip}
                      onChange={(e) => setAgentInfo({ ...agentInfo, zip: e.target.value })} />
                  </Field>
                  <Field label={t.ldAgentPref} htmlFor="agPref" required>
                    <input id="agPref" className={inputCls} value={agentInfo.prefecture}
                      onChange={(e) => setAgentInfo({ ...agentInfo, prefecture: e.target.value })} />
                  </Field>
                </div>
                <Field label={t.ldAgentCity} htmlFor="agCity" required>
                  <input id="agCity" className={inputCls} value={agentInfo.city}
                    onChange={(e) => setAgentInfo({ ...agentInfo, city: e.target.value })} />
                </Field>
                <Field label={t.ldAgentStreet} htmlFor="agStreet" required>
                  <input id="agStreet" className={inputCls} value={agentInfo.street}
                    onChange={(e) => setAgentInfo({ ...agentInfo, street: e.target.value })} />
                </Field>
                <Field label={t.ldAgentBuilding} htmlFor="agBld">
                  <input id="agBld" className={inputCls} value={agentInfo.building}
                    onChange={(e) => setAgentInfo({ ...agentInfo, building: e.target.value })} />
                </Field>
              </div>
            )}
          </div>

          {/* 旅程表・名簿の AI 自動読み込み (任意) */}
          <div className="rounded-2xl border border-dashed border-[#C8102E]/40 bg-[#FFF5F6] p-5">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 rounded-full bg-[#C8102E]/10 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-[#C8102E]" strokeWidth={1.9} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-[#0F172A]">{t.autoHeading}</p>
                <p className="text-[12px] text-[#64748B] mt-1 leading-relaxed">{t.autoBody}</p>
                {/* 何が読み取れるかを視覚化: 誰が・いつ・どこへ・何個 */}
                <p className="text-[11px] font-medium text-[#334155] mt-3">{t.autoChipsTitle}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {[t.chipWho, t.chipWhen, t.chipWhere, t.chipCount].map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1 rounded-full bg-white border border-[#C8102E]/30 px-2.5 py-1 text-[11px] font-medium text-[#C8102E]"
                    >
                      <Check className="w-3 h-3" strokeWidth={2.5} />
                      {c}
                    </span>
                  ))}
                </div>
                <label
                  className={`inline-flex items-center gap-2 mt-3 h-10 px-4 rounded-xl text-[13px] font-bold text-white ${
                    parsing ? "bg-[#94A3B8] cursor-wait" : "bg-[#0F172A] hover:bg-[#1E293B] cursor-pointer"
                  }`}
                >
                  {parsing ? (
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <UploadCloud className="w-4 h-4" strokeWidth={2} />
                  )}
                  {parsing ? t.autoParsing : t.autoButton}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                    className="hidden"
                    disabled={parsing}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void onParseFile(f)
                      e.target.value = ""
                    }}
                  />
                </label>
                {parseNote && (
                  <p className="text-[12px] text-emerald-700 mt-2 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" strokeWidth={2} />
                    {parseNote}
                  </p>
                )}
                {parseError && <p className="text-[12px] text-red-600 mt-2">{parseError}</p>}
                {/* 読み込み後の不足情報チェックリスト — 埋まると自動で消える (複製時も表示) */}
                {(parseNote || dupInfo) && missingAfterParse.length > 0 && (
                  <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
                    <p className="text-[12px] font-bold text-amber-900">
                      {t.autoMissingTitle(missingAfterParse.length)}
                    </p>
                    <ul className="mt-1.5 space-y-0.5">
                      {missingAfterParse.map((m, i) => (
                        <li key={i} className="text-[12px] text-amber-800 flex items-start gap-1.5">
                          <span className="mt-[3px] w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 予約全体の情報 */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 md:p-6 grid md:grid-cols-2 gap-4">
            {/* 配送会社(佐川)の氏名欄上限に合わせ、氏名系は 40 文字までに制限。
                送り状側でも安全のため自動短縮するが、入力段階でも超過を防ぐ。 */}
            <Field label={t.representative} htmlFor="rep" required>
              <input id="rep" className={inputCls} value={representative} maxLength={40}
                onChange={(e) => setRepresentative(e.target.value)} required
                placeholder={t.representativePlaceholder} autoComplete="off" />
            </Field>
            <Field label={t.tourNumber} htmlFor="tour">
              <input id="tour" className={inputCls} value={tourNumber} maxLength={40}
                onChange={(e) => setTourNumber(e.target.value)}
                placeholder={t.tourNumberPlaceholder} autoComplete="off" />
            </Field>
            <Field label={t.bookingName} htmlFor="bookingName">
              <input id="bookingName" className={inputCls} value={bookingName} maxLength={40}
                onChange={(e) => setBookingName(e.target.value)}
                placeholder={t.bookingNamePlaceholder} autoComplete="off" />
            </Field>
            <Field label={t.groupName} htmlFor="groupName">
              <input id="groupName" className={inputCls} value={groupName} maxLength={40}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={t.groupNamePlaceholder} autoComplete="off" />
            </Field>
            <Field label={t.guestLanguage} htmlFor="gl">
              <select id="gl" className={inputCls} value={guestLanguage}
                onChange={(e) => setGuestLanguage(e.target.value)}>
                {GUEST_LANGS.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* 団体情報 (bookingType='group' のときのみ) */}
          {bookingType === "group" && (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 md:p-6 space-y-4">
              <p className="text-[13px] font-semibold text-[#334155]">{t.grpSection}</p>
              <div className="grid md:grid-cols-3 gap-4">
                <Field label={t.leaderName} htmlFor="ldName" required>
                  <input id="ldName" className={inputCls} value={leaderName} maxLength={60}
                    onChange={(e) => setLeaderName(e.target.value)} autoComplete="off" />
                </Field>
                <Field label={t.leaderPhone} htmlFor="ldPhone">
                  <input id="ldPhone" type="tel" className={inputCls} value={leaderPhone} maxLength={40}
                    onChange={(e) => setLeaderPhone(e.target.value)} autoComplete="off" />
                </Field>
                <Field label={t.leaderWhatsapp} htmlFor="ldWa">
                  <input id="ldWa" className={inputCls} value={leaderWhatsapp} maxLength={60}
                    onChange={(e) => setLeaderWhatsapp(e.target.value)} autoComplete="off" />
                </Field>
              </div>
              {luggageEntries.length === 0 ? (
                // ── ステップ1: 名簿(名前だけ)を貼り付け → リスト化。個数はまだ入れない。
                <>
                  <Field label={t.rosterPasteLabel} htmlFor="lugList" required>
                    <textarea
                      id="lugList"
                      value={rosterText}
                      onChange={(e) => setRosterText(e.target.value)}
                      rows={7}
                      placeholder={t.rosterPastePh}
                      className={`${inputCls} resize-y min-h-[130px] py-3 font-mono text-[13px]`}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={buildEntriesFromRoster}
                    disabled={rosterText.trim().length === 0}
                    className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-[#0F172A] text-white text-[13px] font-bold hover:bg-[#1E293B] disabled:opacity-40"
                  >
                    {t.rosterBuildBtn} →
                  </button>
                </>
              ) : (
                // ── ステップ2: ゲストごとに個数を手入力 (＋名前修正・行追加/削除)
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-medium text-[#334155]">{t.lugListTitle}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setLuggageEntries([])
                        setRosterText("")
                      }}
                      className="text-[11px] text-[#64748B] hover:text-[#0F172A] underline underline-offset-2"
                    >
                      {t.lugClear}
                    </button>
                  </div>
                  <div className="rounded-xl border border-[#E5E7EB] overflow-hidden">
                    <div className="grid grid-cols-[2rem_1fr_7.5rem_2rem] items-center gap-2 bg-slate-50 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#94A3B8]">
                      <span>No.</span>
                      <span>{t.lugColGuest}</span>
                      <span className="text-center">{t.lugColBags}</span>
                      <span />
                    </div>
                    <div className="max-h-[340px] overflow-y-auto divide-y divide-[#F1F5F9]">
                      {luggageEntries.map((e, i) => (
                        <div key={i} className="grid grid-cols-[2rem_1fr_7.5rem_2rem] items-center gap-2 px-3 py-1.5">
                          <span className="text-[11px] font-mono text-[#94A3B8]">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <input
                            value={e.name}
                            maxLength={80}
                            onChange={(ev) =>
                              setLuggageEntries((prev) =>
                                prev.map((x, xi) => (xi === i ? { ...x, name: ev.target.value } : x)),
                              )
                            }
                            className="h-9 rounded-lg border border-transparent hover:border-[#E5E7EB] focus:border-[#C8102E] px-2 text-[13px] outline-none"
                          />
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                setLuggageEntries((prev) =>
                                  prev.map((x, xi) => (xi === i ? { ...x, bags: Math.max(1, x.bags - 1) } : x)),
                                )
                              }
                              className="w-7 h-7 rounded-lg border border-[#E5E7EB] text-[#334155] hover:bg-slate-50 text-[14px] leading-none"
                            >
                              −
                            </button>
                            <span className={`w-8 text-center text-[13px] tabular-nums font-bold ${e.bags > 1 ? "text-[#C8102E]" : "text-[#0F172A]"}`}>
                              {e.bags}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setLuggageEntries((prev) =>
                                  prev.map((x, xi) => (xi === i ? { ...x, bags: Math.min(9, x.bags + 1) } : x)),
                                )
                              }
                              className="w-7 h-7 rounded-lg border border-[#E5E7EB] text-[#334155] hover:bg-slate-50 text-[14px] leading-none"
                            >
                              ＋
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLuggageEntries((prev) => prev.filter((_, xi) => xi !== i))}
                            className="text-[#94A3B8] hover:text-red-600"
                            title={t.removeLeg}
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setLuggageEntries((prev) => [...prev, { name: "", bags: 1 }])}
                      disabled={luggageEntries.length >= 50}
                      className="text-[12px] text-[#0F172A] font-medium underline underline-offset-2 disabled:opacity-40"
                    >
                      ＋ {t.lugAddRow}
                    </button>
                    <p className="text-[12px] font-bold text-[#0F172A]">
                      {t.lugTotal(luggageEntries.length, luggageNames.length)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 区間 */}
          {legs.map((leg, i) => (
            <div key={i} className="rounded-2xl border border-[#E5E7EB] bg-white p-5 md:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-[#334155]">
                  {t.legHeading} {i + 1}
                </p>
                {legs.length > 1 && (
                  <button type="button" onClick={() => removeLeg(i)}
                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700">
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                    {t.removeLeg}
                  </button>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-4 items-start">
                <EndpointField side="from" leg={leg} index={i} t={t} locale={locale}
                  placesAuthHeaders={placesAuthHeaders} update={(patch) => updateLeg(i, patch)}
                  patchResidence={(patch) => patchResidence(i, "from", patch)} />
                <EndpointField side="to" leg={leg} index={i} t={t} locale={locale}
                  placesAuthHeaders={placesAuthHeaders} update={(patch) => updateLeg(i, patch)}
                  patchResidence={(patch) => patchResidence(i, "to", patch)} />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Field label={t.shipmentDate} htmlFor={`sd${i}`} required>
                  <input id={`sd${i}`} type="date" className={inputCls} value={leg.shipmentDate}
                    onChange={(e) => onShipDateChange(i, e.target.value)} required />
                </Field>
                <Field label={t.expectedArrival} htmlFor={`ea${i}`} required>
                  <input id={`ea${i}`} type="date" className={inputCls} value={leg.expectedArrival}
                    min={leg.shipmentDate || undefined}
                    onChange={(e) => updateLeg(i, { expectedArrival: e.target.value })} required />
                </Field>
                {/* 品目 (送り状の品名に反映)。既定スーツケース。その他は自由記述。 */}
                <Field label={t.itemLabel} htmlFor={`it${i}`}>
                  <select id={`it${i}`} className={inputCls} value={leg.itemType}
                    onChange={(e) => updateLeg(i, { itemType: e.target.value as ItemTypeKey })}>
                    {ITEM_TYPES.map((it) => (
                      <option key={it.key} value={it.key}>{locale === "ja" ? it.ja : it.en}</option>
                    ))}
                  </select>
                </Field>
                {leg.itemType === "other" && (
                  <Field label={t.itemOtherLabel} htmlFor={`io${i}`} required>
                    <input id={`io${i}`} className={inputCls} value={leg.itemOther} maxLength={20}
                      placeholder={t.itemOtherPlaceholder} autoComplete="off"
                      onChange={(e) => updateLeg(i, { itemOther: e.target.value })} required />
                  </Field>
                )}
                <Field label={t.suitcases} htmlFor={`sc${i}`} required>
                  {bookingType === "group" ? (
                    // 団体は個数=荷物リストの行数で確定 (手入力させない)
                    <div className={`${inputCls} flex items-center bg-[#F8FAFC] text-[#64748B]`}>
                      {luggageNames.length || "—"}（{t.grpCountLocked}）
                    </div>
                  ) : (
                    <input id={`sc${i}`} type="number" min={1} max={50} className={inputCls}
                      value={leg.suitcaseCount}
                      onChange={(e) => updateLeg(i, { suitcaseCount: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                      required />
                  )}
                </Field>
                {/* お届け先ホテルのチェックイン日 (=お客様の到着日)。受取ホテルが「予約名+
                    チェックイン日」で照合するため必須。早期配達を希望する人もいるので発送日
                    との前後関係は縛らない (2026-07 谷口さん指示)。個人宅はホテル照合が無いので非表示。 */}
                {leg.toKind !== "residence" && (
                  <>
                    <Field label={t.fromCheckIn} htmlFor={`ci${i}`} required>
                      <input id={`ci${i}`} type="date" className={inputCls} value={leg.fromCheckIn}
                        onChange={(e) => updateLeg(i, { fromCheckIn: e.target.value })} required />
                    </Field>
                    <Field label={t.toCheckOut} htmlFor={`co${i}`}>
                      <input id={`co${i}`} type="date" className={inputCls} value={leg.toCheckOut}
                        min={leg.expectedArrival || undefined}
                        onChange={(e) => updateLeg(i, { toCheckOut: e.target.value })} />
                    </Field>
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`dt${i}`} className="text-[12px] font-medium text-[#334155]">
                  {t.deliveryTime}
                </label>
                <select id={`dt${i}`} className={inputCls} value={leg.deliveryTime}
                  onChange={(e) => updateLeg(i, { deliveryTime: e.target.value })}>
                  {carrierConfig(DEFAULT_CARRIER).timeSlots.map((slot) => (
                    <option key={slot} value={slot}>{slotLabel(slot, locale)}</option>
                  ))}
                </select>
                {isNextDayEarlySlotRisky(leg.shipmentDate, leg.expectedArrival, leg.deliveryTime) && (
                  <div className="mt-1.5 rounded-lg border border-amber-400 bg-amber-50 p-3 space-y-2">
                    <p className="text-[12px] text-amber-900 font-medium flex items-start gap-1.5 leading-relaxed">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2} />
                      {t.nextDayRisk}
                    </p>
                    <button
                      type="button"
                      onClick={() => updateLeg(i, { deliveryTime: "not-specified" })}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 underline underline-offset-2 hover:text-amber-950"
                    >
                      {t.removeTimeSlot}
                    </button>
                  </div>
                )}
              </div>
              <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
                <Field label={t.notes} htmlFor={`nt${i}`}>
                  {/* バウチャーのホテル欄に収まるよう 60 文字までに制限 (堀部さんFB) */}
                  <input id={`nt${i}`} className={inputCls} value={leg.notes} maxLength={60}
                    onChange={(e) => updateLeg(i, { notes: e.target.value })} />
                  <span className="block text-right text-[11px] text-muted-foreground mt-0.5">
                    {leg.notes.length}/60
                  </span>
                </Field>
                {/* 申し送りの掲載先 (堀部さんFB): 発送元 / お届け先(既定) / 両方 */}
                <Field label={t.noteTargetLabel} htmlFor={`ntt${i}`}>
                  <select id={`ntt${i}`} className={inputCls} value={leg.noteTarget}
                    onChange={(e) => updateLeg(i, { noteTarget: e.target.value as Leg["noteTarget"] })}>
                    <option value="to">{t.noteTargetTo}</option>
                    <option value="from">{t.noteTargetFrom}</option>
                    <option value="both">{t.noteTargetBoth}</option>
                  </select>
                </Field>
              </div>
            </div>
          ))}

          <button type="button" onClick={addLeg}
            className="inline-flex items-center gap-1.5 text-sm text-[#C8102E] font-medium hover:underline">
            <Plus className="w-4 h-4" strokeWidth={2} />
            {t.addLeg}
          </button>

          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" strokeWidth={1.6} />
            <p className="text-[12px] text-amber-900 leading-relaxed">{t.monthNote}</p>
          </div>

          {error && <p className="text-[13px] text-red-600" role="alert">{error}</p>}

          {/* 二重依頼の警告 (自社内・止めるだけ・そのまま登録可) */}
          {dupMatches.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" strokeWidth={1.7} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-amber-900">{t.dupTitle}</p>
                  <p className="text-[12px] text-amber-800 mt-1">{t.dupBody}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {dupMatches.slice(0, 5).map((m) => (
                      <li key={m.booking_id} className="text-[12px] text-amber-900 font-mono">
                        {m.booking_id} ・ {m.representative} ・ {m.shipment_date}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={goToConfirm}
                    className="mt-3 h-9 px-4 rounded-lg bg-amber-600 text-white text-[13px] font-bold hover:bg-amber-700 disabled:opacity-50"
                  >
                    {t.dupProceed}
                  </button>
                </div>
              </div>
            </div>
          )}

          <button type="submit" disabled={status === "submitting" || !representative}
            className="w-full h-12 rounded-xl bg-[#C8102E] text-white text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#A00D25] disabled:opacity-50 disabled:cursor-not-allowed">
            {status === "submitting" ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : t.submit}
          </button>
        </form>
      </div>
    </main>
  )
}

const FLOW_ICONS: LucideIcon[] = [ClipboardList, CalendarClock, PackageCheck, MailCheck]
// 1ヶ月以内 (待ち無し) 版: 待機ステップが無いのでカレンダー時計を使わない
const FLOW_ICONS_SOON: LucideIcon[] = [ClipboardList, PackageCheck, Download]

function FlowDiagram({
  heading,
  steps,
  icons = FLOW_ICONS,
}: {
  heading: string
  steps: ReadonlyArray<{ title: string; sub: string; key: boolean }>
  icons?: LucideIcon[]
}) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
      <p className="text-[12px] font-semibold text-[#334155] mb-4">{heading}</p>
      <div className="flex flex-col md:flex-row md:items-stretch gap-2">
        {steps.map((s, i) => {
          const Icon = icons[i] ?? ClipboardList
          return (
            <Fragment key={i}>
              <div
                className={`flex-1 rounded-xl p-3 flex md:flex-col items-center md:text-center gap-3 md:gap-2 ${
                  s.key ? "bg-[#FFF7ED] border border-[#FED7AA]" : "bg-[#F8FAFC] border border-[#E5E7EB]"
                }`}
              >
                <div
                  className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                    s.key ? "bg-[#C8102E] text-white" : "bg-white border border-[#CBD5E1] text-[#475569]"
                  }`}
                >
                  <Icon className="w-4 h-4" strokeWidth={1.9} />
                </div>
                <div className="min-w-0">
                  <p className={`text-[12px] font-bold ${s.key ? "text-[#9A3412]" : "text-[#0F172A]"}`}>
                    <span className="mr-1 text-[10px] font-mono opacity-60">{i + 1}</span>
                    {s.title}
                  </p>
                  <p className="text-[11px] text-[#64748B] mt-0.5 leading-snug">{s.sub}</p>
                </div>
              </div>
              {i < steps.length - 1 && (
                <div className="flex items-center justify-center text-[#CBD5E1]" aria-hidden>
                  <ChevronRight className="w-4 h-4 rotate-90 md:rotate-0" strokeWidth={2.2} />
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function Field({ label, htmlFor, required, children }: {
  label: string; htmlFor: string; required?: boolean; children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-[#334155]">
        {label}
        {required && <span className="text-[#C8102E] ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}

// 確認画面の 1 行 (ラベル: 値)。span=true で 2 カラム全幅。
function ReviewRow({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <span className="block text-[11px] text-muted-foreground">{label}</span>
      <span className="block text-[13px] text-[#0F172A] font-medium break-words">{value || "—"}</span>
    </div>
  )
}
