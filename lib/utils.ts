import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------------------------------------------------------------------------
// File naming — shared between the voucher-generation API route and the
// operator UI's download links, so both always agree on the same name.
// Agencies manage many bookings; "bondex-voucher-BDX-260702-637.pdf" tells
// them nothing when scanning a downloads folder. We lead with their own
// tour number (what they search for), then our booking id (support lookup),
// then the representative's name (recognizable at a glance).
// ---------------------------------------------------------------------------
export function slugifyForFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics (Ō → O, etc.)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function buildVoucherFileName(info: {
  bookingId: string
  tourNumber?: string
  representativeLabel: string
  kind?: 'voucher' | 'ops'
}): string {
  const parts = ['BondEx']
  if (info.tourNumber) parts.push(slugifyForFileName(info.tourNumber))
  parts.push(info.bookingId)
  const rep = slugifyForFileName(info.representativeLabel)
  if (rep) parts.push(rep)
  parts.push(info.kind === 'ops' ? 'Ops' : 'Voucher')
  return `${parts.join('_')}.pdf`
}
