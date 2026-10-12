"use client"

// 個人宅（ホテル以外＝民泊・Airbnb・個人宅など、Google Maps に出ない住所）の構造化入力。
// 代理店ポータル(app/agency/new)の ResidenceFields と同じ考え方を、運営発行画面でも使える
// よう汎用化した共有コンポーネント。郵便番号(7桁)で都道府県・市区町村を自動補完する。
// postalUrl は呼び出し側の認証に合わせて差し替える（運営=/api/operator/postal、代理店=/api/agency/postal）。

import { useCallback, useRef, useState } from "react"
import type { ResidenceAddress } from "@/lib/residence"

const L = {
  ja: {
    hint: "民泊・個人宅などGoogle Mapsに無い住所はここに直接入力できます（佐川の「郵便番号↔住所」照合に合う形で送り状を作ります）。",
    name: "氏名", namePh: "受取人／発送人のお名前",
    phone: "電話番号（日本で連絡がつく番号）", phonePh: "例) 090-1234-5678",
    zip: "郵便番号", zipPh: "例) 1500001",
    pref: "都道府県", prefPh: "例) 東京都",
    city: "市区町村", cityPh: "例) 渋谷区 / 京都市南区",
    street: "番地・町名", streetPh: "例) 神南1-2-3",
    bld: "建物名・部屋番号（任意）", bldPh: "例) ○○マンション101",
    loading: "住所を検索中…",
    notFound: "該当する郵便番号が見つかりません。手入力してください。",
  },
  en: {
    hint: "Minpaku / private homes not on Google Maps can be entered directly here (structured for the courier's postal↔address check).",
    name: "Name", namePh: "Recipient / sender name",
    phone: "Phone (a number reachable in Japan)", phonePh: "e.g. 090-1234-5678",
    zip: "Postal code", zipPh: "e.g. 1500001",
    pref: "Prefecture", prefPh: "e.g. Tokyo",
    city: "City / ward", cityPh: "e.g. Shibuya-ku",
    street: "Street address", streetPh: "e.g. Jinnan 1-2-3",
    bld: "Building / room (optional)", bldPh: "e.g. ABC Apt 101",
    loading: "Looking up…",
    notFound: "Postal code not found. Please enter the address manually.",
  },
}

const inputCls =
  "w-full h-9 rounded-lg border border-border bg-white px-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-foreground/10"

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-muted-foreground">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </div>
      {children}
    </div>
  )
}

export function ResidenceFields({
  value,
  onChange,
  locale = "ja",
  idPrefix = "res",
  postalUrl = "/api/agency/postal",
  getHeaders,
}: {
  value: ResidenceAddress
  onChange: (patch: Partial<ResidenceAddress>) => void
  locale?: "ja" | "en"
  idPrefix?: string
  postalUrl?: string
  getHeaders?: () => Promise<Record<string, string>>
}) {
  const t = L[locale] ?? L.ja
  const [zipLoading, setZipLoading] = useState(false)
  const [zipNotFound, setZipNotFound] = useState(false)
  // 直近で検索した7桁を覚え、同じ番号で二重に叩かない。
  const lastLookedUp = useRef("")

  // 郵便番号 → 都道府県/市区町村を自動補完（町域は番地欄が空のときだけ先頭に入れる）。
  const lookupPostal = useCallback(
    async (zip7: string, currentStreet: string) => {
      if (lastLookedUp.current === zip7) return
      lastLookedUp.current = zip7
      setZipNotFound(false)
      setZipLoading(true)
      try {
        const headers = getHeaders ? await getHeaders() : {}
        const res = await fetch(`${postalUrl}?zip=${zip7}`, { headers })
        const d = (await res.json().catch(() => ({}))) as {
          ok?: boolean; found?: boolean; prefecture?: string; city?: string; town?: string
        }
        if (res.ok && d.ok && d.found) {
          const patch: Partial<ResidenceAddress> = { prefecture: d.prefecture || "", city: d.city || "" }
          if (!currentStreet.trim() && d.town) patch.street = d.town
          onChange(patch)
        } else if (res.ok && d.ok && d.found === false) {
          setZipNotFound(true)
        }
      } catch {
        /* ネットワーク失敗時は手入力を継続（エラーは出さない） */
      } finally {
        setZipLoading(false)
      }
    },
    [getHeaders, onChange, postalUrl],
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
    <div className="space-y-3 rounded-xl border border-border bg-slate-50 p-3">
      <p className="text-[11px] text-muted-foreground leading-relaxed">{t.hint}</p>
      <Field label={t.name} required>
        <input className={inputCls} value={value.name} maxLength={60} placeholder={t.namePh}
          autoComplete="off" onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label={t.phone} required>
        <input className={inputCls} value={value.phone} maxLength={20} inputMode="tel" placeholder={t.phonePh}
          autoComplete="off" onChange={(e) => onChange({ phone: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.zip} required>
          <input className={inputCls} value={value.zip} maxLength={8} inputMode="numeric" placeholder={t.zipPh}
            autoComplete="off" onChange={(e) => onZipChange(e.target.value)} />
          {zipLoading && <span className="block text-[11px] text-muted-foreground mt-0.5">{t.loading}</span>}
          {zipNotFound && <span className="block text-[11px] text-amber-700 mt-0.5">{t.notFound}</span>}
        </Field>
        <Field label={t.pref} required>
          <input className={inputCls} value={value.prefecture} maxLength={10} placeholder={t.prefPh}
            autoComplete="off" onChange={(e) => onChange({ prefecture: e.target.value })} />
        </Field>
      </div>
      <Field label={t.city} required>
        <input className={inputCls} value={value.city} maxLength={40} placeholder={t.cityPh}
          autoComplete="off" onChange={(e) => onChange({ city: e.target.value })} />
      </Field>
      <Field label={t.street} required>
        <input className={inputCls} value={value.street} maxLength={60} placeholder={t.streetPh}
          autoComplete="off" onChange={(e) => onChange({ street: e.target.value })} />
      </Field>
      <Field label={t.bld}>
        <input className={inputCls} value={value.building} maxLength={60} placeholder={t.bldPh}
          autoComplete="off" onChange={(e) => onChange({ building: e.target.value })} />
      </Field>
    </div>
  )
}
