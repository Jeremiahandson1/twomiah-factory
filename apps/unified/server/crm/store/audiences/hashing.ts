// Customer details as the ad platforms want them (store_audiences, 2026-10-31, parity row 7): each value NORMALISED the way the
// platform documents, then SHA-256 hashed (lower-case hex). Nothing readable leaves the shop in an audience file.
//   Meta  (Customer File Custom Audiences): email trimmed + lower-cased; phone digits only with the country code (no +); first / last
//         name lower-case letters only; city lower-case letters only (no spaces); state the 2-letter code lower-case; zip the first 5
//         digits (US); country the 2-letter code lower-case. Every one of those is hashed.
//   Google (Customer Match): email trimmed + lower-cased, and for gmail.com / googlemail.com the dots before @ removed; phone E.164
//         (+15551234567); first / last name lower-case, trimmed. Email, phone and names are hashed; country code and postal code are
//         sent as they are.
// The country is the United States unless the details say otherwise: a contact here has no country field, only state and zip, and
// every store in this product is a US one (the cart's country box asks for "US").
import { createHash } from 'node:crypto'

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

export interface AudienceContact { name: string | null; email: string | null; phone: string | null; mobile: string | null; city: string | null; state: string | null; zip: string | null }

/** A shopper's name as a first name and a last name: the first word, and everything after it. */
export function splitName(name: string | null | undefined): { first: string; last: string } {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: '', last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

const letters = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}]/gu, '')

export function normEmail(email: string | null | undefined): string | null {
  const e = String(email ?? '').trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null
}
/** Google's rule: a gmail address has no dots in front of the @. */
export function normGoogleEmail(email: string | null | undefined): string | null {
  const e = normEmail(email)
  if (!e) return null
  const [local, domain] = e.split('@')
  return domain === 'gmail.com' || domain === 'googlemail.com' ? `${local.replace(/\./g, '')}@${domain}` : e
}
/** Digits with the country code: 10 digits are a US number (1 in front); 11 digits starting 1 are already one; others must come with their code (+). */
export function normPhoneDigits(phone: string | null | undefined): string | null {
  const raw = String(phone ?? '').trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? digits : null
  if (digits.length === 10) return `1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return digits
  return null
}
export const normName = (n: string | null | undefined): string | null => { const v = letters(String(n ?? '')); return v || null }
export const normCity = (c: string | null | undefined): string | null => { const v = letters(String(c ?? '')); return v || null }
export const normState = (s: string | null | undefined): string | null => { const v = String(s ?? '').trim().toLowerCase(); return /^[a-z]{2}$/.test(v) ? v : null }
export const normZip = (z: string | null | undefined): string | null => { const v = String(z ?? '').replace(/\D/g, '').slice(0, 5); return v.length === 5 ? v : null }

export interface MetaRow { em: string | null; ph: string | null; fn: string | null; ln: string | null; ct: string | null; st: string | null; zip: string | null; country: string | null }
export interface GoogleRow { email: string | null; phone: string | null; first: string | null; last: string | null; country: string | null; zip: string | null }

const h = (v: string | null) => (v ? sha256(v) : null)

/** One contact as a Meta row (hashed); null when nothing in it can identify anyone (no email and no phone). */
export function metaRow(c: AudienceContact): MetaRow | null {
  const em = normEmail(c.email), ph = normPhoneDigits(c.mobile) ?? normPhoneDigits(c.phone)
  if (!em && !ph) return null
  const n = splitName(c.name), st = normState(c.state), zip = normZip(c.zip)
  return { em: h(em), ph: h(ph), fn: h(normName(n.first)), ln: h(normName(n.last)), ct: h(normCity(c.city)), st: h(st), zip: h(zip), country: st || zip ? sha256('us') : null }
}

/** One contact as a Google Customer Match row (hashed where Google asks for it); null when it identifies no one. */
export function googleRow(c: AudienceContact): GoogleRow | null {
  const email = normGoogleEmail(c.email), ph = normPhoneDigits(c.mobile) ?? normPhoneDigits(c.phone)
  if (!email && !ph) return null
  const n = splitName(c.name), zip = normZip(c.zip), st = normState(c.state)
  const first = String(n.first).trim().toLowerCase(), last = String(n.last).trim().toLowerCase()
  return { email: h(email), phone: ph ? sha256(`+${ph}`) : null, first: first ? sha256(first) : null, last: last ? sha256(last) : null, country: st || zip ? 'US' : null, zip }
}

const csvCell = (v: string | null) => (v == null ? '' : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const csv = (head: string[], rows: Array<Array<string | null>>) => [head.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n'

/** Meta's file: header `email,phone,fn,ln,ct,st,zip,country`, every cell a hash. */
export function metaCsv(rows: MetaRow[]): string {
  return csv(['email', 'phone', 'fn', 'ln', 'ct', 'st', 'zip', 'country'], rows.map((r) => [r.em, r.ph, r.fn, r.ln, r.ct, r.st, r.zip, r.country]))
}
/** Google's file: Customer Match's own header; email, phone and names hashed, country and zip plain. */
export function googleCsv(rows: GoogleRow[]): string {
  return csv(['Email', 'Phone', 'First Name', 'Last Name', 'Country', 'Zip'], rows.map((r) => [r.email, r.phone, r.first, r.last, r.country, r.zip]))
}
