"use client"

import React, { useEffect, useRef, useState, useId } from "react"
import { Search, Loader2, MapPin, X } from "lucide-react"
import { Input } from "@/components/ui/input"

/**
 * Hotel search input with Google Places autocomplete dropdown.
 *
 * Behavior:
 *   - User types → 400ms debounce → calls /api/places/search → shows top candidates
 *   - Arrow keys navigate the list, Enter selects, Esc closes
 *   - Click a candidate → `onSelect` fires with full place info → input shows selected hotel name
 *   - Editing the input after selection clears the linked placeId (caller decides via onChange)
 *
 * Accessibility: implements the WAI-ARIA combobox pattern with role="combobox", aria-expanded,
 * aria-controls, aria-activedescendant. Listbox uses role="listbox" + role="option".
 */

export interface PlaceCandidate {
  placeId: string
  name: string
  address: string
  city: string
  prefecture: string
}

interface HotelSearchInputProps {
  value: string
  placeholder?: string
  lang?: "ja" | "en"
  /** Selected hotel ID — if present, search is suppressed until user types again. */
  selectedPlaceId?: string
  onChange: (value: string) => void
  onSelect: (candidate: PlaceCandidate) => void
  className?: string
  inputId?: string
  ariaLabel?: string
  /** Search endpoint. Default = operator (cookie-auth). Agencies pass the agency route. */
  endpoint?: string
  /** Extra headers (e.g. Bearer token) for agency-authenticated calls. */
  getAuthHeaders?: () => Promise<Record<string, string>>
}

const DEBOUNCE_MS = 400
const MIN_CHARS = 2

export function HotelSearchInput({
  value,
  placeholder,
  lang = "ja",
  selectedPlaceId,
  onChange,
  onSelect,
  className = "h-9 text-sm",
  inputId,
  ariaLabel,
  endpoint = "/api/places/search",
  getAuthHeaders,
}: HotelSearchInputProps) {
  const reactId = useId()
  const listboxId = inputId ? `${inputId}-listbox` : `hotel-listbox-${reactId}`

  // endpoint / getAuthHeaders は検索 deps に入れず、常に最新を ref 経由で参照 (再検索の暴発防止)
  const endpointRef = useRef(endpoint)
  endpointRef.current = endpoint
  const getAuthRef = useRef(getAuthHeaders)
  getAuthRef.current = getAuthHeaders

  const [candidates, setCandidates] = useState<PlaceCandidate[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [errorMsg, setErrorMsg] = useState("")

  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastQueryRef = useRef<string>("")

  // Debounced search whenever `value` changes (skip if a place is already linked).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setErrorMsg("")
    const trimmed = value.trim()
    if (selectedPlaceId && trimmed === lastQueryRef.current) {
      // Selected and not edited — don't fire search.
      return
    }
    if (trimmed.length < MIN_CHARS) {
      setCandidates([])
      setIsOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const extra = getAuthRef.current ? await getAuthRef.current() : {}
        const res = await fetch(endpointRef.current, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...extra },
          body: JSON.stringify({ query: trimmed, lang }),
        })
        const data = (await res.json().catch(() => null)) as {
          candidates?: PlaceCandidate[]
          error?: string
        } | null
        if (!res.ok || !data) {
          setErrorMsg(data?.error || "Search failed")
          setCandidates([])
          setIsOpen(false)
          return
        }
        const list = Array.isArray(data.candidates) ? data.candidates : []
        setCandidates(list)
        setIsOpen(list.length > 0)
        setHighlighted(list.length > 0 ? 0 : -1)
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Search failed")
      } finally {
        setIsLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, lang, selectedPlaceId])

  // Click outside closes the dropdown.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleSelect = (c: PlaceCandidate) => {
    lastQueryRef.current = c.name
    onSelect(c)
    setIsOpen(false)
    setHighlighted(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || candidates.length === 0) {
      if (e.key === "ArrowDown" && candidates.length > 0) {
        e.preventDefault()
        setIsOpen(true)
        setHighlighted(0)
      }
      return
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlighted((i) => (i + 1) % candidates.length)
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlighted((i) => (i <= 0 ? candidates.length - 1 : i - 1))
        break
      case "Enter":
        if (highlighted >= 0 && highlighted < candidates.length) {
          e.preventDefault()
          handleSelect(candidates[highlighted])
        }
        break
      case "Escape":
        e.preventDefault()
        setIsOpen(false)
        setHighlighted(-1)
        break
      case "Tab":
        setIsOpen(false)
        break
    }
  }

  const showCheckmark = !!selectedPlaceId && value.trim() === lastQueryRef.current

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          id={inputId}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (candidates.length > 0) setIsOpen(true)
          }}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            isOpen && highlighted >= 0 ? `${listboxId}-opt-${highlighted}` : undefined
          }
          aria-label={ariaLabel}
          className={`${className} pr-9`}
          autoComplete="off"
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center">
          {isLoading ? (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" strokeWidth={1.5} />
          ) : showCheckmark ? (
            <span className="text-emerald-600 text-xs font-medium">✓</span>
          ) : (
            <Search className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
          )}
        </div>
      </div>

      {errorMsg && !isOpen && (
        <p className="mt-1 text-[10px] text-amber-600" role="alert">
          {errorMsg}
        </p>
      )}

      {isOpen && candidates.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 w-full bg-white border border-border rounded-lg shadow-lg max-h-72 overflow-auto"
        >
          {candidates.map((c, i) => (
            <li
              key={c.placeId}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                // Prevent input blur before click registers.
                e.preventDefault()
                handleSelect(c)
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={`px-3 py-2 cursor-pointer border-b border-border last:border-b-0 ${
                i === highlighted ? "bg-muted" : "hover:bg-muted/60"
              }`}
            >
              <p className="text-sm font-medium text-foreground leading-tight">{c.name}</p>
              <p className="text-[11px] text-muted-foreground flex items-start gap-1 mt-0.5">
                <MapPin className="w-3 h-3 shrink-0 mt-0.5" strokeWidth={1.5} />
                <span className="leading-tight">{c.address}</span>
              </p>
            </li>
          ))}
          <li className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/30 flex items-center gap-1.5">
            <X className="w-3 h-3" strokeWidth={1.5} />
            Esc キーで閉じる · ↑↓ で選択 · Enter で確定
          </li>
        </ul>
      )}
    </div>
  )
}
