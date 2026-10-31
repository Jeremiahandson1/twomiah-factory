// Booth rent, the pure part (salon row 24): when a renter's rent falls due, what a form may say, and a renter's ledger and statement.
// No database here — boothRent.ts reads and writes; these are the rules, and they are what the tests pin down.
import { addMonthsClamped } from '@twomiah/tenant-backend'

export const FREQUENCIES = ['weekly', 'monthly'] as const
export type Frequency = (typeof FREQUENCIES)[number]
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const RENT_LIMITS = { minCents: 100, maxCents: 10_000_000 } as const

const YMD = /^\d{4}-\d{2}-\d{2}$/
export const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v
const pad = (n: number) => String(n).padStart(2, '0')
const weekdayOf = (ymd: string) => new Date(ymd + 'T00:00:00Z').getUTCDay()
export const plusDays = (ymd: string, n: number) => new Date(new Date(ymd + 'T00:00:00Z').getTime() + n * 86_400_000).toISOString().slice(0, 10)

/** The last day of the month of `ymd`. */
const monthEnd = (ymd: string) => { const [y, m] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
/** The due day of a month: the renter's day, or that month's last day when it has fewer ("the 31st" is the 30th in November). */
export const dueInMonth = (ym: string, dueDay: number) => `${ym.slice(0, 7)}-${pad(Math.min(dueDay, monthEnd(ym.slice(0, 7) + '-01')))}`

/** The first day the rent falls due on or after the start date. */
export function firstDue(startDate: string, frequency: Frequency, dueWeekday: number | null, dueDay: number | null): string {
  if (frequency === 'weekly') {
    const want = dueWeekday ?? weekdayOf(startDate)
    return plusDays(startDate, (want - weekdayOf(startDate) + 7) % 7)
  }
  const day = dueDay ?? Number(startDate.slice(8, 10))
  const here = dueInMonth(startDate, day)
  return here >= startDate ? here : dueInMonth(addMonthsClamped(startDate.slice(0, 7) + '-01', 1), day)
}

/** The period after `period`: seven days on, or the renter's day of the next month (clamped to that month's end). */
export function nextPeriod(period: string, frequency: Frequency, dueDay: number | null): string {
  if (frequency === 'weekly') return plusDays(period, 7)
  return dueInMonth(addMonthsClamped(period.slice(0, 7) + '-01', 1), dueDay ?? Number(period.slice(8, 10)))
}

/** The next due day on or after `from` for a changed schedule (a renter whose day was moved is billed from the new schedule, never twice for the same stretch). */
export function rescheduleFrom(from: string, frequency: Frequency, dueWeekday: number | null, dueDay: number | null): string {
  return firstDue(from, frequency, dueWeekday, dueDay)
}

export type RenterInput = { rentCents: number; frequency: Frequency; dueWeekday: number | null; dueDay: number | null; startDate: string; notes: string | null }

const wholeCents = (b: Record<string, unknown>): number | null | 'bad' => {
  if (b.rentCents !== undefined && b.rentCents !== null && b.rentCents !== '') { const n = Number(b.rentCents); return Number.isInteger(n) ? n : 'bad' }
  if (b.rent !== undefined && b.rent !== null && b.rent !== '') { const n = Number(b.rent); return Number.isFinite(n) ? Math.round(n * 100) : 'bad' }
  return null
}

/** A form to store, or the sentence for each box that is wrong. `current` fills what a partial update leaves out. */
export function parseRenter(body: unknown, opts: { current?: RenterInput; today: string }): { values: RenterInput } | { fields: Record<string, string> } {
  const b = (body ?? {}) as Record<string, unknown>
  const cur = opts.current
  const fields: Record<string, string> = {}
  const cents = wholeCents(b)
  let rentCents = cur?.rentCents ?? 0
  if (cents === 'bad') fields.rent = 'Rent must be a number.'
  else if (cents == null) { if (!cur) fields.rent = 'Enter the rent for each period.' }
  else if (cents < RENT_LIMITS.minCents || cents > RENT_LIMITS.maxCents) fields.rent = `Rent must be from $${RENT_LIMITS.minCents / 100} to $${RENT_LIMITS.maxCents / 100}.`
  else rentCents = cents

  const freq = b.frequency === undefined ? cur?.frequency : String(b.frequency)
  if (!freq || !(FREQUENCIES as readonly string[]).includes(freq)) fields.frequency = 'Choose weekly or monthly.'
  const frequency = (freq as Frequency) ?? 'weekly'

  let dueWeekday: number | null = cur && frequency === cur.frequency ? cur.dueWeekday : null
  let dueDay: number | null = cur && frequency === cur.frequency ? cur.dueDay : null
  if (b.dueWeekday !== undefined) dueWeekday = b.dueWeekday === null || b.dueWeekday === '' ? null : Number(b.dueWeekday)
  if (b.dueDay !== undefined) dueDay = b.dueDay === null || b.dueDay === '' ? null : Number(b.dueDay)
  if (frequency === 'weekly') {
    dueDay = null
    if (dueWeekday == null) { if (!fields.frequency) fields.dueWeekday = 'Choose the day of the week the rent is due.' }
    else if (!Number.isInteger(dueWeekday) || dueWeekday < 0 || dueWeekday > 6) fields.dueWeekday = 'Choose the day of the week the rent is due.'
  } else if (frequency === 'monthly') {
    dueWeekday = null
    if (dueDay == null) fields.dueDay = 'Choose the day of the month the rent is due (1 to 31).'
    else if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) fields.dueDay = 'The day of the month must be from 1 to 31.'
  }

  let startDate = cur?.startDate ?? ''
  if (b.startDate !== undefined) { if (isYmd(b.startDate)) startDate = b.startDate; else fields.startDate = 'Enter the start date as a date.' }
  else if (!cur) startDate = opts.today
  if (!startDate && !fields.startDate) fields.startDate = 'Enter the start date.'

  let notes = cur?.notes ?? null
  if (b.notes !== undefined) {
    const n = b.notes === null ? '' : String(b.notes).trim()
    if (n.length > 1000) fields.notes = 'Notes can be up to 1000 characters.'
    else notes = n || null
  }
  return Object.keys(fields).length ? { fields } : { values: { rentCents, frequency, dueWeekday, dueDay, startDate, notes } }
}

/** "$250 a week, due Fridays" — the rent in the words a person reads back. */
export function rentWords(r: { rentCents: number; frequency: string; dueWeekday: number | null; dueDay: number | null }): string {
  const money = `$${(r.rentCents / 100).toFixed(r.rentCents % 100 ? 2 : 0)}`
  if (r.frequency === 'weekly') return `${money} a week, due ${r.dueWeekday != null ? WEEKDAYS[r.dueWeekday] + 's' : 'weekly'}`
  const d = r.dueDay ?? 1
  const ord = d % 100 >= 11 && d % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[d % 10] ?? 'th'
  return `${money} a month, due on the ${d}${ord}`
}

// ---- ledger and statement

export type LedgerEvent = { date: string; at: number; kind: 'rent' | 'payment' | 'waived' | 'voided'; description: string; chargeCents: number; paymentCents: number; invoiceNumber: string | null; invoiceId: string | null }
export type LedgerLine = LedgerEvent & { balanceCents: number }

const KIND_ORDER: Record<LedgerEvent['kind'], number> = { rent: 0, waived: 1, voided: 2, payment: 3 }

/** Events in order (day, then the order they happened), each with the balance after it. A positive balance is what the renter owes. */
export function buildLedger(events: LedgerEvent[]): LedgerLine[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.at - b.at)
  let balance = 0
  return sorted.map((e) => { balance += e.chargeCents - e.paymentCents; return { ...e, balanceCents: balance } })
}

export type Statement = { from: string; to: string; openingCents: number; chargesCents: number; paymentsCents: number; closingCents: number; lines: LedgerLine[] }

/** The ledger between two days (both included): what was owed at the start, what happened, what is owed at the end. */
export function buildStatement(events: LedgerEvent[], from: string, to: string): Statement {
  const all = buildLedger(events)
  const before = all.filter((l) => l.date < from)
  const lines = all.filter((l) => l.date >= from && l.date <= to)
  const openingCents = before.length ? before[before.length - 1].balanceCents : 0
  const chargesCents = lines.reduce((t, l) => t + l.chargeCents, 0)
  const paymentsCents = lines.reduce((t, l) => t + l.paymentCents, 0)
  return { from, to, openingCents, chargesCents, paymentsCents, closingCents: openingCents + chargesCents - paymentsCents, lines }
}

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const dollars = (c: number) => (c / 100).toFixed(2)

/** The statement as a spreadsheet file the renter or the accountant can open. */
export function statementCsv(renterName: string, s: Statement): string {
  const rows: string[][] = [
    ['Statement for', renterName], ['From', s.from], ['To', s.to], ['Opening balance', dollars(s.openingCents)], [],
    ['Date', 'What', 'Invoice', 'Charged', 'Paid', 'Balance'],
    ...s.lines.map((l) => [l.date, l.description, l.invoiceNumber ?? '', l.chargeCents ? dollars(l.chargeCents) : '', l.paymentCents ? dollars(l.paymentCents) : '', dollars(l.balanceCents)]),
    [], ['Charged', dollars(s.chargesCents)], ['Paid', dollars(s.paymentsCents)], ['Closing balance', dollars(s.closingCents)],
  ]
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
