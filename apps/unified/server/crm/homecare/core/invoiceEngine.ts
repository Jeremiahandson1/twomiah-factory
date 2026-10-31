// The client-invoice engine — moved from templates/crm-homecare/backend/src/services/invoiceEngine.ts (ported there
// from CVHC routes/billingRoutes.js). The billing routes are the HTTP surface; everything that decides a NUMBER lives
// here so the review screen, single generation, batch generation, "Create Due Invoices" and the preview all get the
// same answer for the same days. Its SQL is in server/data/homecareBilling.ts.
//
// The rules:
//   · THE SCHEDULE IS THE INVOICE. Each scheduled occurrence (the shared engine) is a billable visit. A clock-in
//     VERIFIES the visit; it does not set the price.
//   · Payer clients bill the SCHEDULED block. PRIVATE PAY bills the CLOCK — except a punch longer than the schedule,
//     which is usually a missed clock-out and is held for review either way.
//   · Any day where the punch and the shift disagree by more than the 7-minute grace is handed to the person
//     generating the invoice (needsChoice), and their per-day choice ({ [key]: 'scheduled' | 'clocked' }) bills.
//   · A punch with no schedule behind it does NOT bill by default: default skip, one-click "bill the clocked time".
//   · Double-billing guards: overlapping duplicate schedules for one caregiver, a substitute whose punch covers > 50%
//     of the assigned caregiver's window, a coverer whose punch swallowed another caregiver's window (credited to the
//     coverer, bounded by what was worked), and twin punches.
//   · Overlapping schedules from two caregivers on the same day are FLAGGED (overlapMinutes).
//   · Cancelled occurrences never bill; reason-coded cancellations are listed (skipped).
//   · Training (shadow) shifts never bill.
//   · NO silent default rate; a per-15-minute rate bills units on every path; times are the agency's clock; each line
//     is rounded to the cent and the invoice total is the sum of its lines.
//
// Changes from the template: every read and write is the company's (companyId first; every row written carries it);
// the lines, the reconcile rows and the client row are camelCase (RULEBOOK §2: the template's LineItem was snake_case —
// timeEntryId, serviceDate, rateType, billedBasis, scheduledMinutes … now); insertLineItems reads camelCase lines.
// The writes that need no raw SQL use the query builder.
import { and, eq } from 'drizzle-orm'
import { invoices, invoiceLineItems, invoicePayments, clientBillingSplits } from '../../../db/schema/index.ts'
import { splitLines, type SplitRule } from './splitBilling.ts'

/** The feature that applies a client's split-billing rules when invoices are made (not ready: hidden until tested). */
export const SPLIT_BILLING_FEATURE = 'care_split_billing'
import {
  referralSourceRateFor, billingClient, billingTimeEntries, billingOccurrences, cancelledBillingDays,
  lockClientForBilling, advanceBilledThrough, lockInvoiceMoney, rollUpInvoicePayments,
} from '../../../data/homecareBilling.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, type AgencyTime } from './agencyTime.ts'

/** Anything that runs queries: `d.db` or a transaction handle (inside a transaction, never `db`). */
type Dbc = any

/** Private pay by the one rule (core/payerFunding), as loadBillingClient computes it; the box alone otherwise. */
const isPrivateByRule = (client: any): boolean =>
  client?.privatePayByRule === true || client?.privatePayByRule === 't' || !!client?.isPrivatePay

/** A refusal the route turns into a 4xx with this body. */
export class BillingRefusal extends Error {
  status: number
  body: Record<string, unknown>
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error || 'Refused'))
    this.status = status
    this.body = body
  }
}

export const PAY_GRACE_MIN = 7
export const MAX_LINE_ITEM_DESC = 255
export const round2 = (n: number) => Math.round(n * 100) / 100

// "HH:MM[:SS]" → minutes since midnight
export const minutesOf = (hms: any): number | null => {
  if (hms == null || hms === '') return null
  const [h, m] = String(hms).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// hours between two "HH:MM" times on the same day, overnight-aware
export function hoursBetween(startHms: string | null, endHms: string | null): number {
  if (!startHms || !endHms) return 0
  let mins = (minutesOf(endHms) as number) - (minutesOf(startHms) as number)
  if (mins < 0) mins += 24 * 60
  return mins / 60
}

export function fmtTime12(hms: string | null | undefined): string {
  if (!hms) return ''
  const [h, m] = String(hms).split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${dh}:${(m || 0).toString().padStart(2, '0')} ${ampm}`
}

/** "13:30" → "1:30 PM"; anything else unchanged. */
export const to12h = (hhmm: any) => {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm
  return fmtTime12(hhmm)
}

/** Old descriptions carried 24h times ("(13:30 - 17:30)"). Reformat on read; leave times that already carry AM/PM alone. */
export function reformatTimesIn(text: any) {
  if (typeof text !== 'string') return text
  return text.replace(/\b(\d{1,2}):(\d{2})\b(?!\s*[AaPp][Mm]\b)/g, (match, h, m) => {
    const hr = parseInt(h, 10)
    if (hr < 0 || hr > 23) return match
    return fmtTime12(`${hr}:${m}`)
  })
}

/** Keep a description within 255 characters, preserving the trailing "(time range)". */
export function clampLineItemDescription(desc: any): string {
  const s = String(desc ?? '')
  if (s.length <= MAX_LINE_ITEM_DESC) return s
  const m = s.match(/\s*(\([^()]*\))\s*$/)
  const suffix = m ? ' ' + m[1] : ''
  const room = MAX_LINE_ITEM_DESC - suffix.length
  if (room <= 1) return s.slice(0, MAX_LINE_ITEM_DESC)
  const base = m ? s.slice(0, s.length - m[0].length) : s
  return base.slice(0, room - 1).trimEnd() + '…' + suffix
}

/** Stable key for one billable day: date + caregiver + the scheduled start it belongs to. An unscheduled punch keys off its own entry id. */
export function reconcileKey({ serviceDate, caregiverId, scheduledStart, timeEntryId }: {
  serviceDate: string; caregiverId: string; scheduledStart?: string | null; timeEntryId?: string | null
}) {
  return scheduledStart ? `${serviceDate}|${caregiverId}|${scheduledStart}` : `${serviceDate}|${caregiverId}|entry:${timeEntryId}`
}

export interface ResolvedRate { rate: number; rateType: string; source: 'referral_source_rate' | 'client_private_pay_rate' }

export const noRateRefusal = (client: any, what = 'create the invoice') => new BillingRefusal(400, {
  error: 'No billing rate configured for this client',
  message: `${client.firstName ?? client.first_name} ${client.lastName ?? client.last_name} has no rate set. Add it on the client (Clients → Edit → Private Pay Rate), or set a referral-source rate for their payer, then ${what}.`,
})

/** An hourly rate bills hours; any other rate is PER 15-MINUTE UNIT (units = hours × 4, to 2dp) — the claims engine's convention. */
export function lineAmount(hours: number, resolved: { rate: number; rateType: string }) {
  return resolved.rateType === 'hourly'
    ? round2(hours * resolved.rate)
    : round2((Math.round(hours * 4 * 100) / 100) * resolved.rate)
}

/** Stamp the authoritative rate on a submitted line and recompute its amount. An explicit rate of 0 is a deliberate no-charge line and is kept. */
export function applyRate(item: any, resolved: ResolvedRate) {
  const hours = parseFloat(item.hours || 0) || 0
  const submitted = item.rate === '' || item.rate == null ? null : parseFloat(item.rate)
  const isWriteOff = submitted === 0
  const rate = isWriteOff ? 0 : resolved.rate
  return { hours, rate, rateType: resolved.rateType, amount: isWriteOff ? 0 : lineAmount(hours, resolved) }
}

/**
 * How a stored line reads: quantity × rate = amount IN ONE UNIT. A per-15-minute rate prints "8 units × $7.50 / 15
 * min"; an hourly rate prints "2.00 h × $30.00 / h". The unit is the line's own rateType.
 */
export function lineQuantity(li: { hours: any; rate: any; rate_type?: string | null; rateType?: string | null }) {
  const hours = Number(li.hours) || 0
  const rate = Number(li.rate) || 0
  const perUnit = (li.rateType ?? li.rate_type) === '15min'
  if (perUnit) {
    const units = Math.round(hours * 4 * 100) / 100
    return { quantity: units, quantityLabel: `${Number.isInteger(units) ? units : units.toFixed(2)} unit${units === 1 ? '' : 's'}`, rateLabel: `$${rate.toFixed(2)} / 15 min`, unit: 'unit' as const }
  }
  return { quantity: hours, quantityLabel: `${hours.toFixed(2)} h`, rateLabel: `$${rate.toFixed(2)} / h`, unit: 'hour' as const }
}

export interface LineItem {
  timeEntryId: string | null
  scheduleId: string | null
  caregiverId: string
  caregiverFirstName?: string
  caregiverLastName?: string
  serviceDate: string
  startTime: string | null      // HH:MM shown/edited (the punch on a clocked line, else the shift)
  endTime: string | null
  visitStart: string | null     // HH:MM:SS — the visit's identity (scheduled start), stored on the line
  visitEnd: string | null
  timeRange: string
  description: string
  hours: number
  rate: number
  rateType: string
  amount: number
  source: 'evv_confirmed' | 'scheduled' | 'unscheduled_evv'
  billedBasis: 'scheduled' | 'clocked' | 'unscheduled'
  scheduledMinutes: number | null
  clockedMinutes: number | null
}

export interface GenerateResult {
  lineItems: LineItem[]
  total: number
  reconcile: any[]
  skipped: any[]
  rate: ResolvedRate
  timeZone: string
}

// ── Who outside the office may see an invoice ────────────────────────────────────────────────
// Invoices start as DRAFTS (sentAt null). The client/family portal, its PDF and the public pay page show one only once
// the office sends, releases or takes a payment on it. Use isClientVisibleInvoice on a row; clientVisibleInvoiceSql /
// releasedInvoiceSql (server/data/homecareBilling.ts) in a query.
export function isClientVisibleInvoice(inv: { sent_at?: unknown; sentAt?: unknown; payment_status?: string | null; paymentStatus?: string | null } | null | undefined): boolean {
  if (!inv) return false
  const sent = inv.sentAt ?? inv.sent_at
  const status = inv.paymentStatus ?? inv.payment_status
  return sent != null || status === 'paid' || status === 'partial'
}

/** A random, durable invoice code (the friendly number is seqNumber). A short random tail keeps two invoices for one client created in the same millisecond from colliding. */
export function generateInvoiceNumber(clientId: string) {
  const timestamp = Date.now().toString(36).toUpperCase()
  const clientPart = String(clientId).slice(0, 4).toUpperCase()
  const tail = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `INV-${timestamp}${tail}-${clientPart}`
}

/**
 * The billable days of one client and period, priced — pure, so the arithmetic can be asserted on its own. `entries`,
 * `occurrences` and `skipped` are the rows server/data/homecareBilling.ts reads (billingTimeEntries,
 * billingOccurrences, cancelledBillingDays).
 */
export function buildLineItems(input: {
  entries: any[]; occurrences: any[]; skipped: any[]; resolved: ResolvedRate; privatePay: boolean; timeZone: string
  choices?: Record<string, string>
}): GenerateResult {
  const { entries, occurrences: occ, skipped, resolved, privatePay } = input
  const choices = input.choices || {}
  const amountFor = (hours: number) => lineAmount(hours, resolved)

  const name = (x: any) => `${x.caregiverFirstName || ''} ${x.caregiverLastName || ''}`.trim()
  const expectedVisits = occ.map((r) => ({
    date: r.occDate as string, caregiverId: r.caregiverId as string,
    caregiverFirstName: r.caregiverFirstName, caregiverLastName: r.caregiverLastName,
    startTime: r.startTime as string, endTime: r.endTime as string,
    scheduleId: r.scheduleId as string, notes: r.notes,
  }))

  // ── Match each scheduled visit to a punch: same caregiver, same day, closest start ────────────
  const unmatchedEntries = [...entries]
  const visitsWithMatch = expectedVisits.map((v) => {
    const candidates = unmatchedEntries.filter((te) => te.caregiverId === v.caregiverId && te.localDate === v.date)
    if (!candidates.length) return { visit: v, entry: null as any }
    const vs = minutesOf(v.startTime) || 0
    candidates.sort((a, b) => Math.abs(a.startMin - vs) - Math.abs(b.startMin - vs))
    const matched = candidates[0]
    unmatchedEntries.splice(unmatchedEntries.indexOf(matched), 1)
    return { visit: v, entry: matched }
  })
  visitsWithMatch.sort((a, b) => a.visit.date.localeCompare(b.visit.date) || (a.visit.startTime || '').localeCompare(b.visit.startTime || ''))

  // Overlapping duplicate schedules for one caregiver: an unmatched scheduled visit that overlaps a WORKED visit for
  // the same caregiver and day is the same shift twice — never a second line.
  const matchedWindows = visitsWithMatch.filter((x) => x.entry).map((x) => ({
    caregiverId: x.visit.caregiverId, day: x.visit.date, start: minutesOf(x.visit.startTime), end: minutesOf(x.visit.endTime),
  }))
  const duplicatesWorkedShift = (v: any) => {
    const vs = minutesOf(v.startTime), ve = minutesOf(v.endTime)
    if (vs == null || ve == null) return false
    return matchedWindows.some((m) => m.caregiverId === v.caregiverId && m.day === v.date
      && m.start != null && m.end != null && vs < m.end && m.start < ve)
  }

  // A different caregiver's punch covering > 50% of a scheduled window means the visit happened (someone else worked
  // it); a small handoff overrun must not suppress the real line.
  const punchWindows: { day: string; start: number; end: number }[] = []
  for (const x of visitsWithMatch) if (x.entry && x.entry.endMin != null) punchWindows.push({ day: x.entry.localDate, start: x.entry.startMin, end: x.entry.endMin })
  for (const e of unmatchedEntries) if (e.endMin != null) punchWindows.push({ day: e.localDate, start: e.startMin, end: e.endMin })
  const coveredByActualWork = (v: any) => {
    const vs = minutesOf(v.startTime), ve = minutesOf(v.endTime)
    if (vs == null || ve == null || ve <= vs) return false
    let covered = 0
    for (const p of punchWindows) {
      if (p.day !== v.date || p.end <= p.start) continue
      covered += Math.max(0, Math.min(ve, p.end) - Math.max(vs, p.start))
    }
    return covered > (ve - vs) * 0.5
  }

  // Coverage extension: a caregiver who stayed past their shift and absorbed another (unclocked) scheduled window is
  // credited that window's scheduled minutes, so the covered hours bill once — to the coverer — instead of to nobody.
  const matchedPunchWindows = visitsWithMatch.filter((x) => x.entry && x.entry.endMin != null).map((x) => ({
    entryId: x.entry.timeEntryId, day: x.entry.localDate, start: x.entry.startMin as number, end: x.entry.endMin as number,
  }))
  const extraSchedMinByEntry = new Map<string, number>()
  for (const { visit, entry } of visitsWithMatch) {
    if (entry) continue
    if (duplicatesWorkedShift(visit)) continue
    if (!coveredByActualWork(visit)) continue
    const vs = minutesOf(visit.startTime), ve = minutesOf(visit.endTime)
    if (vs == null || ve == null || ve <= vs) continue
    let best: any = null, bestOverlap = 0
    for (const w of matchedPunchWindows) {
      if (w.day !== visit.date || w.end <= w.start) continue
      const ov = Math.max(0, Math.min(ve, w.end) - Math.max(vs, w.start))
      if (ov > bestOverlap) { bestOverlap = ov; best = w }
    }
    if (best && bestOverlap > (ve - vs) * 0.5) extraSchedMinByEntry.set(best.entryId, (extraSchedMinByEntry.get(best.entryId) || 0) + (ve - vs))
  }

  const lineItems: LineItem[] = []
  const reconcile: any[] = []
  const punchLabel = (e: any) => (e.endLabel ? `${e.startLabel} - ${e.endLabel}` : '')

  for (const { visit, entry } of visitsWithMatch) {
    if (!entry && (duplicatesWorkedShift(visit) || coveredByActualWork(visit))) continue
    let hours = 0
    let timeRangeLabel = ''
    let source: LineItem['source'] = 'scheduled'
    let timeEntryId: string | null = null
    let billedBasis: LineItem['billedBasis'] = 'scheduled'
    let schedMinutes: number | null = null, clockedMinutes: number | null = null
    let shownStart: string | null = null, shownEnd: string | null = null

    if (entry) {
      source = 'evv_confirmed'
      timeEntryId = entry.timeEntryId
      const actualMin = entry.durationMinutes ? Number(entry.durationMinutes) : (entry.rawMinutes != null ? Number(entry.rawMinutes) : 0)
      const ownSched = (minutesOf(visit.startTime) != null && minutesOf(visit.endTime) != null)
        ? (minutesOf(visit.endTime) as number) - (minutesOf(visit.startTime) as number) : null
      // Bill the combined block only when the punch is long enough to have covered it.
      const extraMin = extraSchedMinByEntry.get(entry.timeEntryId) || 0
      const schedMin = (ownSched != null && extraMin > 0 && actualMin >= ownSched + extraMin - PAY_GRACE_MIN) ? ownSched + extraMin : ownSched
      const haveSched = schedMin != null && schedMin > 0
      const disagrees = haveSched && Math.abs(actualMin - (schedMin as number)) > PAY_GRACE_MIN
      const key = reconcileKey({ serviceDate: visit.date, caregiverId: visit.caregiverId, scheduledStart: visit.startTime, timeEntryId: entry.timeEntryId })
      const runsLong = haveSched && actualMin > (schedMin as number) + PAY_GRACE_MIN
      const defaultBasis = !haveSched ? 'clocked' : (privatePay && !runsLong) ? 'clocked' : 'scheduled'
      const chosen = !haveSched ? 'clocked'
        : choices[key] === 'clocked' ? 'clocked'
        : choices[key] === 'scheduled' ? 'scheduled'
        : defaultBasis
      const billedMin = chosen === 'clocked' ? actualMin : (schedMin as number)
      hours = billedMin / 60
      billedBasis = chosen as LineItem['billedBasis']
      schedMinutes = haveSched ? (schedMin as number) : null
      clockedMinutes = Math.round(actualMin)
      reconcile.push({
        key,
        serviceDate: visit.date,
        caregiverId: visit.caregiverId,
        caregiverName: name(visit),
        scheduledStart: visit.startTime,
        scheduledEnd: visit.endTime,
        scheduledMinutes: haveSched ? schedMin : null,
        scheduledAmount: haveSched ? amountFor((schedMin as number) / 60) : null,
        clockedStart: entry.startIso,
        clockedEnd: entry.endIso,
        clockedStartLabel: entry.startLabel,
        clockedEndLabel: entry.endLabel,
        clockedMinutes: Math.round(actualMin),
        clockedAmount: amountFor(actualMin / 60),
        timeEntryId: entry.timeEntryId,
        // A private-pay punch that came in SHORT needs no decision — billing the clock is the policy. A long punch
        // (missed clock-out) still stops for review.
        needsChoice: disagrees && (!privatePay || runsLong),
        status: !haveSched ? 'unscheduled' : !disagrees ? 'match' : actualMin < (schedMin as number) ? 'short' : 'long',
        defaultBasis,
        chosenBasis: chosen,
      })
      // The line describes what it BILLS: the shift's hours when the scheduled block bills, the punch when the clock bills.
      if (chosen === 'clocked') {
        timeRangeLabel = punchLabel(entry)
        shownStart = entry.startHhmm
        shownEnd = entry.endHhmm
      } else {
        timeRangeLabel = `${fmtTime12(visit.startTime)} - ${fmtTime12(visit.endTime)}`
        shownStart = String(visit.startTime).slice(0, 5)
        shownEnd = String(visit.endTime).slice(0, 5)
      }
    } else {
      // No clock-in → bill scheduled. Nothing to reconcile.
      hours = hoursBetween(visit.startTime, visit.endTime)
      timeRangeLabel = `${fmtTime12(visit.startTime)} - ${fmtTime12(visit.endTime)}`
      billedBasis = 'scheduled'
      schedMinutes = Math.round(hours * 60)
      shownStart = String(visit.startTime).slice(0, 5)
      shownEnd = String(visit.endTime).slice(0, 5)
      reconcile.push({
        key: reconcileKey({ serviceDate: visit.date, caregiverId: visit.caregiverId, scheduledStart: visit.startTime }),
        serviceDate: visit.date,
        caregiverId: visit.caregiverId,
        caregiverName: name(visit),
        scheduledStart: visit.startTime,
        scheduledEnd: visit.endTime,
        scheduledMinutes: Math.round(hours * 60),
        scheduledAmount: amountFor(hours),
        clockedStart: null, clockedEnd: null, clockedStartLabel: null, clockedEndLabel: null,
        clockedMinutes: null, clockedAmount: null,
        timeEntryId: null,
        needsChoice: false,
        status: 'no_punch',
        defaultBasis: 'scheduled',
        chosenBasis: 'scheduled',
      })
    }

    if (hours <= 0) continue
    // Notes are internal and never printed on an invoice — a generic label plus the time range.
    const baseDesc = 'Home Care Services'
    lineItems.push({
      timeEntryId,
      scheduleId: visit.scheduleId,
      caregiverId: visit.caregiverId,
      caregiverFirstName: visit.caregiverFirstName,
      caregiverLastName: visit.caregiverLastName,
      serviceDate: visit.date,
      startTime: shownStart,
      endTime: shownEnd,
      visitStart: visit.startTime,
      visitEnd: visit.endTime,
      timeRange: timeRangeLabel,
      description: timeRangeLabel ? `${baseDesc} (${timeRangeLabel})` : baseDesc,
      hours,
      rate: resolved.rate,
      rateType: resolved.rateType,
      amount: amountFor(hours),
      source,
      billedBasis,
      scheduledMinutes: schedMinutes,
      clockedMinutes,
    })
  }

  // Twin-punch guard: an orphan punch whose window is mostly (> 50%) covered by this invoice's already-billed punches
  // for the same caregiver is a duplicate clock-in, not a second visit.
  const billedWindows = visitsWithMatch.filter((x) => x.entry && x.entry.endMin != null).map((x) => ({
    caregiverId: x.visit.caregiverId, day: x.entry.localDate, start: x.entry.startMin as number, end: x.entry.endMin as number,
  }))
  const mostlyBilledAlready = (e: any) => {
    const es = e.startMin, ee = e.endMin
    if (es == null || ee == null || ee <= es) return false
    let covered = 0
    for (const w of billedWindows) {
      if (w.caregiverId !== e.caregiverId || w.day !== e.localDate || w.end <= w.start) continue
      covered += Math.max(0, Math.min(ee, w.end) - Math.max(es, w.start))
    }
    return covered > (ee - es) * 0.5
  }

  // Orphan punches (worked but not on the schedule): default SKIP, explicit opt-in bills the clock. billableMinutes is
  // preferred — the clock-out path already zeroes double-taps.
  for (const e of unmatchedEntries) {
    let minutes = 0
    if (e.billableMinutes != null) minutes = Number(e.billableMinutes)
    else if (e.durationMinutes) minutes = Number(e.durationMinutes)
    else if (e.rawMinutes != null) minutes = Number(e.rawMinutes)
    const hours = minutes / 60
    if (minutes < 1) continue          // sub-minute "visits" are taps, not care
    if (mostlyBilledAlready(e)) continue
    const amount = amountFor(hours)
    const key = reconcileKey({ serviceDate: e.localDate, caregiverId: e.caregiverId, timeEntryId: e.timeEntryId })
    const billIt = choices[key] === 'clocked'
    const label = punchLabel(e)
    if (billIt) {
      if (e.endMin != null) billedWindows.push({ caregiverId: e.caregiverId, day: e.localDate, start: e.startMin, end: e.endMin })
      const baseDesc = 'Home Care Services (unscheduled)'
      lineItems.push({
        timeEntryId: e.timeEntryId,
        scheduleId: null,
        caregiverId: e.caregiverId,
        caregiverFirstName: e.caregiverFirstName,
        caregiverLastName: e.caregiverLastName,
        serviceDate: e.localDate,
        startTime: e.startHhmm,
        endTime: e.endHhmm,
        visitStart: e.startHhmm ? `${e.startHhmm}:00` : null,
        visitEnd: e.endHhmm ? `${e.endHhmm}:00` : null,
        timeRange: label,
        description: label ? `${baseDesc} (${label})` : baseDesc,
        hours,
        rate: resolved.rate,
        rateType: resolved.rateType,
        amount,
        billedBasis: 'unscheduled',
        scheduledMinutes: null,
        clockedMinutes: Math.round(minutes),
        source: 'unscheduled_evv',
      })
    }
    reconcile.push({
      key,
      serviceDate: e.localDate,
      caregiverId: e.caregiverId,
      caregiverName: name(e),
      scheduledStart: null, scheduledEnd: null, scheduledMinutes: null, scheduledAmount: null,
      clockedStart: e.startIso,
      clockedEnd: e.endIso,
      clockedStartLabel: e.startLabel,
      clockedEndLabel: e.endLabel,
      clockedMinutes: Math.round(minutes),
      clockedAmount: amount,
      timeEntryId: e.timeEntryId,
      needsChoice: true,
      status: 'unscheduled',
      defaultBasis: 'skip',
      chosenBasis: billIt ? 'clocked' : 'skip',
    })
  }

  // Two scheduled visits on one day whose windows overlap both bill in full — almost always a handoff that was never
  // trimmed. Flag each by name; the fix is a schedule correction.
  for (const day of new Set(reconcile.map((r) => r.serviceDate))) {
    const dayRows = reconcile.filter((r) => r.serviceDate === day && r.scheduledStart != null && r.scheduledEnd != null)
    for (let i = 0; i < dayRows.length; i++) {
      for (let j = i + 1; j < dayRows.length; j++) {
        const a = dayRows[i], b = dayRows[j]
        const as = minutesOf(a.scheduledStart), ae = minutesOf(a.scheduledEnd)
        const bs = minutesOf(b.scheduledStart), be = minutesOf(b.scheduledEnd)
        if (as == null || ae == null || bs == null || be == null) continue
        const ov = Math.min(ae, be) - Math.max(as, bs)
        if (ov <= 0) continue
        a.overlapMinutes = Math.max(a.overlapMinutes || 0, ov)
        b.overlapMinutes = Math.max(b.overlapMinutes || 0, ov)
        a.overlapWith = b.caregiverName
        b.overlapWith = a.caregiverName
      }
    }
  }

  lineItems.sort((a, b) => (a.serviceDate || '').localeCompare(b.serviceDate || ''))
  reconcile.sort((a, b) => (a.serviceDate || '').localeCompare(b.serviceDate || '') || (a.scheduledStart || '').localeCompare(b.scheduledStart || ''))
  const total = round2(lineItems.reduce((s, li) => s + li.amount, 0))
  return { lineItems, total, reconcile, skipped, rate: resolved, timeZone: input.timeZone }
}

export function createInvoiceEngine(d: CrmDeps, deps: { time: AgencyTime }) {
  const { time } = deps

  /**
   * The client record is the ONLY source of a billing rate. Private pay wins over a lingering referral source. A payer
   * rate prefers the client's care type and the one effective for the period. null when nothing is configured.
   */
  async function resolveClientRate(companyId: string, client: any, periodStart: string, periodEnd: string, q: Dbc = d.db): Promise<ResolvedRate | null> {
    const payerId = client.referredById ?? client.referred_by_id ?? null
    const careTypeId = client.careTypeId ?? client.care_type_id ?? null
    const privatePay = !!(client.isPrivatePay ?? client.is_private_pay)
    if (!privatePay && payerId) {
      const r = await referralSourceRateFor(q, companyId, payerId, careTypeId, periodStart, periodEnd)
      if (r) return { rate: parseFloat(r.rateAmount), rateType: r.rateType || 'hourly', source: 'referral_source_rate' }
    }
    const ppRate = client.privatePayRate ?? client.private_pay_rate
    if (ppRate) {
      return { rate: parseFloat(ppRate), rateType: (client.privatePayRateType ?? client.private_pay_rate_type) || 'hourly', source: 'client_private_pay_rate' }
    }
    return null
  }

  /** The client row every generator reads (camelCase), or null. */
  function loadBillingClient(companyId: string, clientId: string, q: Dbc = d.db) {
    return billingClient(q, companyId, clientId)
  }

  /**
   * Every billable day for one client and period, and the line items they become. options.choices: { [reconcileKey]:
   * 'scheduled' | 'clocked' | 'skip' } — the reviewer's per-day decisions. Anything not named bills its default.
   */
  async function generateLineItems(companyId: string, client: any, periodStart: string, periodEnd: string,
    options: { choices?: Record<string, string> } = {}, q: Dbc = d.db): Promise<GenerateResult> {
    const resolved = await resolveClientRate(companyId, client, periodStart, periodEnd, q)
    if (!resolved || !(resolved.rate > 0)) throw noRateRefusal(client)
    const tz = await time.timezone(companyId, q)
    const entries = await billingTimeEntries(q, companyId, client.id, periodStart, periodEnd, tz)
    const occurrences = await billingOccurrences(q, companyId, client.id, periodStart, periodEnd)
    const skipped = await cancelledBillingDays(q, companyId, client.id, periodStart, periodEnd)
    return buildLineItems({ entries, occurrences, skipped, resolved, privatePay: isPrivateByRule(client), timeZone: tz, choices: options.choices })
  }

  /** Insert line items (camelCase, as generateLineItems makes them) on one of the company's invoices — inside the caller's transaction. */
  async function insertLineItems(companyId: string, invoiceId: string, items: any[], q: Dbc = d.db) {
    for (const item of items) {
      // Every writer states the unit its rate is in — a line without it cannot print its own math.
      if (item.rateType !== '15min' && item.rateType !== 'hourly') throw new Error(`invoice line written without a rate_type (${item.rateType})`)
      await q.insert(invoiceLineItems).values({
        companyId,
        invoiceId,
        timeEntryId: item.timeEntryId || null,
        caregiverId: item.caregiverId,
        description: clampLineItemDescription(item.description),
        hours: String(item.hours),
        rate: String(item.rate),
        rateType: item.rateType,
        amount: String(item.amount),
        serviceDate: item.serviceDate || null,
        billedBasis: item.billedBasis || null,
        scheduledMinutes: item.scheduledMinutes ?? null,
        clockedMinutes: item.clockedMinutes ?? null,
        startTime: item.visitStart || null,
        endTime: item.visitEnd || null,
      })
    }
  }

  /**
   * Create one invoice with its lines, atomically, and move the client's billedThrough forward so "Create Due
   * Invoices" resumes after it. The CLIENT ROW IS LOCKED first, so two clicks on Create cannot both pass the "already
   * invoiced for this period" check. Returns the invoice row (camelCase, plus periodStartText), or throws a
   * BillingRefusal when the period is already invoiced.
   */
  async function createInvoiceWithLines(opts: {
    companyId: string; client: any; periodStart: string; periodEnd: string; lineItems: any[]; total: number; notes?: string | null
    advanceBilledThrough?: 'greatest' | 'set' | false; sentAt?: Date | null
  }) {
    const { companyId, client, periodStart, periodEnd, lineItems, total } = opts
    // Split billing (core/splitBilling.ts): asked before the transaction opens (it reads on its own connection).
    const splitOn = !!(await Promise.resolve(d.features.isFeatureEnabled(companyId, SPLIT_BILLING_FEATURE)).catch(() => false))
    return await d.db.transaction(async (tx: Dbc) => {
      await lockClientForBilling(tx, companyId, client.id)
      const existing = await tx.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber }).from(invoices)
        .where(and(eq(invoices.companyId, companyId), eq(invoices.clientId, client.id),
          eq(invoices.billingPeriodStart, periodStart), eq(invoices.billingPeriodEnd, periodEnd)))
      if (existing.length) {
        throw new BillingRefusal(400, { error: `Invoice ${existing[0].invoiceNumber} already exists for this period`, existingInvoiceId: existing[0].id })
      }
      const due = addDays(periodEnd, 30)
      const isPrivate = !!(client.isPrivatePay ?? client.is_private_pay)
      const advance = async () => {
        if (opts.advanceBilledThrough === 'set') await advanceBilledThrough(tx, companyId, client.id, periodEnd, 'set')
        else if (opts.advanceBilledThrough !== false) await advanceBilledThrough(tx, companyId, client.id, periodEnd, 'greatest')
      }
      // A client whose visits are split: one invoice per party — each payer's share, then the family's rest — made
      // together, so the period's "already invoiced" check above covers them all. The visits' hours count on the first.
      const rules: SplitRule[] = splitOn
        ? (await tx.select().from(clientBillingSplits).where(and(eq(clientBillingSplits.companyId, companyId), eq(clientBillingSplits.clientId, client.id))))
          .map((r: any) => ({ payerId: r.payerId, priority: r.priority, kind: r.kind, value: Number(r.value) }))
        : []
      if (rules.length) {
        const { parts } = splitLines(lineItems, rules)
        const splitGroupId = crypto.randomUUID()
        const made: any[] = []
        for (const [i, part] of parts.entries()) {
          const [row] = await tx.insert(invoices).values({
            companyId, clientId: client.id, invoiceNumber: generateInvoiceNumber(client.id) + (parts.length > 1 ? `-${i + 1}` : ''),
            billingPeriodStart: periodStart, billingPeriodEnd: periodEnd,
            subtotal: String(round2(part.total)), total: String(round2(part.total)), paymentStatus: 'pending', paymentDueDate: due,
            notes: opts.notes ?? null, referralSourceId: part.payerId, invoiceType: part.billTo === 'payer' ? 'insurance' : 'private_pay',
            billTo: part.billTo, splitGroupId, countsHours: i === 0, sentAt: opts.sentAt ?? null,
          }).returning()
          await insertLineItems(companyId, row.id, part.lines, tx)
          made.push(row)
        }
        await advance()
        // The family's part is the one the screen opens on (the payers' are listed with it); none left: the first payer's.
        const main = made.find((r) => r.billTo === 'family') ?? made[0]
        return { ...main, periodStartText: main.billingPeriodStart, splitParts: made.map((r) => ({ id: r.id, invoiceNumber: r.invoiceNumber, billTo: r.billTo, payerId: r.referralSourceId, total: r.total })) }
      }
      const referralSourceId = isPrivate ? null : ((client.referredById ?? client.referred_by_id) || null)
      const invoiceType = isPrivateByRule(client) ? 'private_pay' : 'insurance'
      const [inv] = await tx.insert(invoices).values({
        companyId,
        clientId: client.id,
        invoiceNumber: generateInvoiceNumber(client.id),
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        subtotal: String(round2(total)),
        total: String(round2(total)),
        paymentStatus: 'pending',
        paymentDueDate: due,
        notes: opts.notes ?? null,
        referralSourceId, invoiceType,
        // An insurance invoice naming its payer is the payer's to pay; any other is the family's (migration 0051's rule).
        billTo: invoiceType === 'insurance' && referralSourceId ? 'payer' : 'family',
        sentAt: opts.sentAt ?? null,
      }).returning()
      await insertLineItems(companyId, inv.id, lineItems, tx)
      await advance()
      return { ...inv, periodStartText: inv.billingPeriodStart }
    })
  }

  // ── Payments: the ledger is invoice_payments ─────────────────────────────────────────────
  // Every way money arrives on an invoice — Record Payment, Mark Paid, a Stripe checkout — writes ONE invoice_payments
  // row here, and amountPaid / paymentStatus are recomputed from the rows.

  /** Recompute amountPaid and the status from the payments that exist (inside the caller's tx). */
  function rollUpPayments(companyId: string, invoiceId: string, paymentDate: string | null, q: Dbc = d.db) {
    return rollUpInvoicePayments(q, companyId, invoiceId, paymentDate)
  }

  /**
   * Record one payment on an invoice, with the invoice row locked so two payments cannot both pass the balance check.
   * A payment past the balance is refused (409) unless allowOverpayment. amount 'balance' pays whatever is still due
   * (Mark Paid). A non-null reference already recorded on this invoice is not recorded twice (a re-delivered Stripe
   * webhook). Returns the payment row, or null when nothing was due or the reference was already recorded.
   */
  async function recordInvoicePayment(opts: {
    companyId: string; invoiceId: string; amount: number | 'balance'; paymentDate: string; method: string
    reference?: string | null; notes?: string | null; userId?: string | null; allowOverpayment?: boolean
  }) {
    const { companyId } = opts
    return await d.db.transaction(async (tx: Dbc) => {
      const inv = await lockInvoiceMoney(tx, companyId, opts.invoiceId)
      if (!inv) throw new BillingRefusal(404, { error: 'Invoice not found' })
      if (opts.reference) {
        const dup = await tx.select({ id: invoicePayments.id }).from(invoicePayments)
          .where(and(eq(invoicePayments.companyId, companyId), eq(invoicePayments.invoiceId, opts.invoiceId), eq(invoicePayments.referenceNumber, opts.reference)))
          .limit(1)
        if (dup.length) return null
      }
      const total = Number(inv.total), alreadyPaid = Number(inv.amountPaid), adjusted = Number(inv.amountAdjusted)
      const balanceDue = round2(total - alreadyPaid - adjusted)
      const amt = opts.amount === 'balance' ? balanceDue : round2(opts.amount)
      if (!(amt > 0)) {
        if (opts.amount === 'balance') { await rollUpInvoicePayments(tx, companyId, opts.invoiceId, opts.paymentDate); return null }
        throw new BillingRefusal(400, { error: 'Payment amount must be a positive number' })
      }
      if (!opts.allowOverpayment && round2(alreadyPaid + amt) > total - adjusted + 0.01) {
        throw new BillingRefusal(409, {
          error: `Payment of $${amt.toFixed(2)} exceeds the $${balanceDue.toFixed(2)} balance due on this invoice. It may already be recorded — check the invoice's payments before entering it again.`,
          balanceDue, alreadyPaid, total,
        })
      }
      const [p] = await tx.insert(invoicePayments).values({
        companyId,
        invoiceId: opts.invoiceId,
        amount: String(amt),
        paymentDate: opts.paymentDate,
        paymentMethod: opts.method,
        referenceNumber: opts.reference || null,
        notes: opts.notes || null,
        createdById: opts.userId || null,
      }).returning()
      await tx.update(invoices).set({ paymentMethod: opts.method })
        .where(and(eq(invoices.id, opts.invoiceId), eq(invoices.companyId, companyId)))
      await rollUpInvoicePayments(tx, companyId, opts.invoiceId, opts.paymentDate)
      return p
    })
  }

  return {
    resolveClientRate, loadBillingClient, generateLineItems, insertLineItems, createInvoiceWithLines,
    rollUpPayments, recordInvoicePayment,
  }
}

export type InvoiceEngine = ReturnType<typeof createInvoiceEngine>
