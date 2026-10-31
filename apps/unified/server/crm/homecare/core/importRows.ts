// CSV import (item 1, docs/parity/homecare-import.md): the pure half. Which column is which field (with how sure we are),
// and turning one row's cells into clean values or plain-English problems. No database here; the lookups for duplicates
// are core/csvImport.ts's. Pure.
import { parse } from 'csv-parse/sync'

export type ImportKind = 'clients' | 'caregivers' | 'schedules'
export const IMPORT_KINDS: readonly ImportKind[] = ['clients', 'caregivers', 'schedules']
export const MAX_IMPORT_ROWS = 2000
export const MAX_IMPORT_BYTES = 2_000_000

export interface FieldDef { key: string; label: string; required?: boolean; synonyms: string[] }

const f = (key: string, label: string, synonyms: string[], required = false): FieldDef => ({ key, label, required, synonyms })

export const FIELDS: Record<ImportKind, FieldDef[]> = {
  clients: [
    f('firstName', 'First name', ['first', 'first name', 'given name', 'client first name'], true),
    f('lastName', 'Last name', ['last', 'last name', 'surname', 'family name', 'client last name'], true),
    f('fullName', 'Full name (split into first and last)', ['name', 'full name', 'client', 'client name', 'patient name']),
    f('dateOfBirth', 'Date of birth', ['dob', 'birth date', 'birthdate', 'date of birth', 'birthday']),
    f('gender', 'Gender', ['sex', 'gender']),
    f('phone', 'Phone', ['phone', 'phone number', 'mobile', 'cell', 'telephone', 'home phone']),
    f('email', 'Email', ['email', 'e-mail', 'email address']),
    f('address', 'Street address', ['address', 'street', 'street address', 'address 1', 'address line 1']),
    f('city', 'City', ['city', 'town']),
    f('state', 'State', ['state', 'province']),
    f('zip', 'Zip', ['zip', 'zip code', 'postal code', 'postcode']),
    f('startDate', 'Start of care', ['start date', 'start of care', 'soc', 'service start', 'admission date']),
    f('serviceType', 'Service type', ['service', 'service type', 'type of care']),
    f('medicaidId', 'Medicaid ID', ['medicaid', 'medicaid id', 'medicaid number', 'member id']),
    f('isPrivatePay', 'Private pay (yes/no)', ['private pay', 'self pay', 'private']),
    f('privatePayRate', 'Private pay rate per hour', ['rate', 'bill rate', 'hourly rate', 'private pay rate']),
    f('notes', 'Notes', ['notes', 'comments', 'note']),
  ],
  caregivers: [
    f('firstName', 'First name', ['first', 'first name', 'given name'], true),
    f('lastName', 'Last name', ['last', 'last name', 'surname', 'family name'], true),
    f('fullName', 'Full name (split into first and last)', ['name', 'full name', 'caregiver', 'caregiver name', 'employee', 'employee name']),
    f('email', 'Email', ['email', 'e-mail', 'email address', 'work email'], true),
    f('phone', 'Phone', ['phone', 'phone number', 'mobile', 'cell', 'telephone']),
    f('hireDate', 'Hire date', ['hire date', 'hired', 'start date', 'date hired']),
    f('defaultPayRate', 'Pay rate per hour', ['pay rate', 'hourly rate', 'rate', 'wage', 'hourly wage']),
    f('address', 'Street address', ['address', 'street', 'street address']),
    f('city', 'City', ['city', 'town']),
    f('state', 'State', ['state', 'province']),
    f('zip', 'Zip', ['zip', 'zip code', 'postal code', 'postcode']),
  ],
  schedules: [
    f('clientName', 'Client name', ['client', 'client name', 'patient', 'patient name'], true),
    f('caregiverRef', 'Caregiver (name or email)', ['caregiver', 'caregiver name', 'caregiver email', 'employee', 'employee name', 'staff'], true),
    f('dayOfWeek', 'Weekday', ['day', 'day of week', 'weekday'], true),
    f('startTime', 'Start time', ['start', 'start time', 'from', 'time in'], true),
    f('endTime', 'End time', ['end', 'end time', 'to', 'time out'], true),
    f('frequency', 'Repeats', ['frequency', 'repeats', 'repeat', 'every']),
    f('startDate', 'Starts on', ['start date', 'effective date', 'starts', 'effective']),
    f('endDate', 'Ends on', ['end date', 'ends', 'last day']),
    f('notes', 'Notes', ['notes', 'comments']),
  ],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export interface MappingGuess { header: string; field: string | null; confidence: 'exact' | 'likely' | 'none' }

/** Which field each header most likely is. Exact = the header is the field's name; likely = a known synonym. A field is used once. */
export function guessMapping(kind: ImportKind, headers: string[]): MappingGuess[] {
  const defs = FIELDS[kind]
  const taken = new Set<string>()
  const out: MappingGuess[] = headers.map((header) => ({ header, field: null, confidence: 'none' as const }))
  // exact first, so a synonym never steals a field another column names outright
  for (const pass of ['exact', 'likely'] as const) {
    out.forEach((g, i) => {
      if (g.field) return
      const h = norm(headers[i])
      const hit = defs.find((d) => !taken.has(d.key) && (pass === 'exact' ? norm(d.key.replace(/([A-Z])/g, ' $1')) === h || norm(d.label) === h : d.synonyms.includes(h)))
      if (hit) { g.field = hit.key; g.confidence = pass; taken.add(hit.key) }
    })
  }
  return out
}

/** The file's header row and its rows as arrays, or a plain-English problem. */
export function readCsv(text: string): { headers: string[]; rows: string[][] } | { problem: string; code: string } {
  if (typeof text !== 'string' || !text.trim()) return { problem: 'The file is empty.', code: 'empty_file' }
  if (text.length > MAX_IMPORT_BYTES) return { problem: 'The file is too big. Split it into files under 2 MB.', code: 'file_too_big' }
  let records: string[][]
  try {
    records = parse(text.replace(/^﻿/, ''), { skip_empty_lines: true, relax_column_count: true, trim: true }) as string[][]
  } catch {
    return { problem: 'That does not look like a CSV file. Save the sheet as CSV and try again.', code: 'bad_csv' }
  }
  if (records.length < 2) return { problem: 'The file needs a header row and at least one row of data.', code: 'empty_file' }
  const [headers, ...rows] = records
  if (rows.length > MAX_IMPORT_ROWS) return { problem: `The file has ${rows.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`, code: 'too_many_rows' }
  return { headers: headers.map((h) => String(h ?? '').trim()), rows }
}

// ---- cell cleaners: each returns { value } or { problem } ----
type Cleaned = { value: any } | { problem: string }
const empty = (s: string | undefined) => s === undefined || s.trim() === ''

export function cleanDate(raw: string): Cleaned {
  const s = raw.trim()
  let y: number, m: number, d: number
  let hit = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (hit) { y = +hit[1]; m = +hit[2]; d = +hit[3] } else {
    hit = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
    if (!hit) return { problem: `"${s}" is not a date. Use year-month-day (2026-03-15) or month/day/year (3/15/2026).` }
    m = +hit[1]; d = +hit[2]; y = +hit[3]
    if (hit[3].length === 2) y += y > (new Date().getUTCFullYear() % 100) ? 1900 : 2000
  }
  const real = new Date(Date.UTC(y, m - 1, d))
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) return { problem: `"${s}" is not a real date.` }
  return { value: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

export function cleanPhone(raw: string): Cleaned {
  const digits = raw.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length !== 10) return { problem: `"${raw.trim()}" is not a 10-digit phone number.` }
  return { value: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` }
}

export function cleanEmail(raw: string): Cleaned {
  const s = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s } : { problem: `"${raw.trim()}" is not an email address.` }
}

export function cleanMoney(raw: string): Cleaned {
  const n = Number(raw.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 && n < 10_000 ? { value: n.toFixed(2) } : { problem: `"${raw.trim()}" is not an hourly rate.` }
}

export function cleanYesNo(raw: string): Cleaned {
  const s = raw.trim().toLowerCase()
  if (['y', 'yes', 'true', '1', 'x'].includes(s)) return { value: true }
  if (['n', 'no', 'false', '0'].includes(s)) return { value: false }
  return { problem: `"${raw.trim()}" should be yes or no.` }
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
export function cleanWeekday(raw: string): Cleaned {
  const s = raw.trim().toLowerCase()
  const byName = DAYS.findIndex((d) => d === s || (s.length >= 3 && d.startsWith(s)))
  if (byName >= 0) return { value: byName }
  if (/^[0-6]$/.test(s)) return { value: Number(s) }
  return { problem: `"${raw.trim()}" is not a weekday. Use Monday, Tue, or 0 (Sunday) to 6 (Saturday).` }
}

export function cleanTime(raw: string): Cleaned {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/)
  if (!m) return { problem: `"${raw.trim()}" is not a time. Use 9:00 AM or 14:30.` }
  let h = +m[1]
  const mi = m[2] ? +m[2] : 0
  if (m[3]) { if (h < 1 || h > 12) return { problem: `"${raw.trim()}" is not a time.` }; h = (h % 12) + (m[3].startsWith('p') ? 12 : 0) }
  if (h > 23 || mi > 59) return { problem: `"${raw.trim()}" is not a time.` }
  return { value: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` }
}

/** "Maria Lopez" or "Lopez, Maria" → first and last. */
export function splitName(raw: string): { first: string; last: string } | null {
  const s = raw.trim().replace(/\s+/g, ' ')
  if (!s) return null
  if (s.includes(',')) { const [last, first] = s.split(',').map((p) => p.trim()); return first && last ? { first, last } : null }
  const parts = s.split(' ')
  if (parts.length < 2) return null
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

const CLEANERS: Record<string, (raw: string) => Cleaned> = {
  dateOfBirth: cleanDate, startDate: cleanDate, endDate: cleanDate, hireDate: cleanDate,
  phone: cleanPhone, email: cleanEmail, privatePayRate: cleanMoney, defaultPayRate: cleanMoney,
  isPrivatePay: cleanYesNo, dayOfWeek: cleanWeekday, startTime: cleanTime, endTime: cleanTime,
}

export interface CleanRow { line: number; values: Record<string, any>; problems: Array<{ field: string; message: string }> }

/**
 * One file row's cells (by the chosen mapping) as clean values, or the problems with them. `line` is the row's number in the
 * spreadsheet (the header is line 1). Cross-checks that need the database (duplicates, who a name is) are done afterwards.
 */
export function cleanRow(kind: ImportKind, mapping: Record<string, string | null>, headers: string[], cells: string[], line: number): CleanRow {
  const values: Record<string, any> = {}
  const problems: CleanRow['problems'] = []
  const label = (key: string) => FIELDS[kind].find((d) => d.key === key)?.label ?? key
  headers.forEach((h, i) => {
    const key = mapping[h]
    if (!key || empty(cells[i])) return
    const raw = String(cells[i])
    const clean = CLEANERS[key]
    if (!clean) { values[key] = raw.trim(); return }
    const r = clean(raw)
    if ('problem' in r) problems.push({ field: key, message: `${label(key)}: ${r.problem}` })
    else values[key] = r.value
  })
  if (values.fullName !== undefined) {
    const parts = splitName(String(values.fullName))
    if (parts) { values.firstName ??= parts.first; values.lastName ??= parts.last }
    else problems.push({ field: 'fullName', message: 'Name: could not tell the first name from the last. Use "First Last" or "Last, First".' })
    delete values.fullName
  }
  for (const d of FIELDS[kind]) {
    if (d.required && d.key !== 'firstName' && d.key !== 'lastName' && values[d.key] === undefined && !problems.some((p) => p.field === d.key)) problems.push({ field: d.key, message: `${d.label} is empty.` })
  }
  if (kind !== 'schedules') {
    for (const k of ['firstName', 'lastName'] as const) if (!values[k] && !problems.some((p) => p.field === 'fullName')) problems.push({ field: k, message: `${k === 'firstName' ? 'First' : 'Last'} name is empty.` })
  }
  if (kind === 'schedules' && values.startTime && values.endTime && values.startTime === values.endTime) problems.push({ field: 'endTime', message: 'Start and end time cannot be the same.' })
  return { line, values, problems }
}

/** Fields that must be mapped to a column before anything can be read (a name may come from first+last or from one full-name column). */
export function unmappedRequired(kind: ImportKind, mapping: Record<string, string | null>): string[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean) as string[])
  const out: string[] = []
  for (const d of FIELDS[kind]) {
    if (!d.required) continue
    if ((d.key === 'firstName' || d.key === 'lastName') && mapped.has('fullName')) continue
    if (!mapped.has(d.key)) out.push(d.label)
  }
  return out
}
