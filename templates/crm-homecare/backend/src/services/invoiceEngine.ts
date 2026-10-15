// The client-invoice engine — ported from CVHC routes/billingRoutes.js (generateLineItems and its
// helpers). routes/billing.ts is the HTTP surface; everything that decides a NUMBER lives here so
// the review screen, single generation, batch generation, "Create Due Invoices" and the preview all
// get the same answer for the same days.
//
// The rules, as CVHC runs them today:
//
//   · THE SCHEDULE IS THE INVOICE. Each scheduled occurrence (the shared engine,
//     services/scheduleOccurrences.ts) is a billable visit. A clock-in VERIFIES the visit; it does
//     not set the price.
//   · Payer clients bill the SCHEDULED block (what the authorization covers). PRIVATE PAY bills the
//     CLOCK (office policy 2026-09-19) — except a punch longer than the schedule, which is usually a
//     missed clock-out and is held for review either way.
//   · Any day where the punch and the shift disagree by more than the 7-minute grace (the same grace
//     payroll uses) is handed to the person generating the invoice: the review step returns it with
//     needs_choice, and their per-day choice ({ [key]: 'scheduled' | 'clocked' }) is what bills.
//   · A punch with no schedule behind it does NOT bill by default (office policy 2026-09-04): it is
//     either a mis-punch or a visit whose schedule was never entered. Default skip, one-click "bill
//     the clocked time".
//   · Double-billing guards: overlapping duplicate schedules for one caregiver, a substitute whose
//     punch covers > 50% of the assigned caregiver's window, a coverer whose punch swallowed another
//     caregiver's window (credited to the coverer, bounded by what was worked), and twin punches.
//   · Overlapping schedules from two caregivers on the same day are FLAGGED (overlap_minutes) — a
//     handoff that was never trimmed bills both in full, so it is shown by name.
//   · Cancelled occurrences never bill; reason-coded cancellations are listed (skipped) so the
//     reviewer can see WHY a day is missing.
//   · Training (shadow) shifts never bill — the trainer's visit does.
//
// Deliberate differences from CVHC, each one CVHC's own stated rule applied where its code had not:
//   · NO silent default rate. CVHC's generateLineItems started from $25.00/h when nothing was
//     configured; its manual and edit paths already refused. Every path here uses resolveClientRate
//     and refuses with the same message when there is none.
//   · A per-15-minute rate bills units on EVERY path (CVHC's manual/edit paths multiplied hours by
//     a per-unit rate).
//   · Times are the AGENCY's clock (agencies.settings.timezone, else its state), not a hard-coded
//     America/Chicago; a punch belongs to the local day it happened on.
//   · Each line's amount is rounded to the cent, and the invoice total is the sum of its lines.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import { agencies, invoices } from '../../db/schema.ts'
import { companyRowTimeZone } from '../shared/index.ts'
import { scheduleOccurrencesCte } from './scheduleOccurrences.ts'

type Dbc = { execute: (q: any) => Promise<any> }
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]

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

/** Does this column exist? Other ports add columns this engine honours (is_training, cancel_reason,
 *  suspended_from); until they land the engine must still build an invoice. */
export async function columnExists(dbc: Dbc, table: string, column: string): Promise<boolean> {
  const r = await dbc.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column} LIMIT 1`)
  return rowsOf(r).length > 0
}
export async function tableExists(dbc: Dbc, table: string): Promise<boolean> {
  const r = await dbc.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_name = ${table} LIMIT 1`)
  return rowsOf(r).length > 0
}

/** The agency's clock: what it configured, else its state's zone, else UTC. */
export async function agencyTimeZone(): Promise<string> {
  try {
    const [a] = await db.select({ settings: agencies.settings, state: agencies.state }).from(agencies).limit(1)
    return companyRowTimeZone(a || null)
  } catch {
    return 'UTC'
  }
}

/** Today's date (YYYY-MM-DD) on the agency's clock. */
export function localToday(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

export const addDays = (dateStr: string, n: number) => {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

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

/** Old descriptions carried 24h times ("(13:30 - 17:30)"). Reformat on read; leave times that
 *  already carry AM/PM alone (re-reading "3:00 PM" as 3am printed "3:00 AM PM"). */
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

/** Stable key for one billable day: date + caregiver + the scheduled start it belongs to. An
 *  unscheduled punch has no scheduled start, so it keys off its own entry id. */
export function reconcileKey({ serviceDate, caregiverId, scheduledStart, timeEntryId }: {
  serviceDate: string; caregiverId: string; scheduledStart?: string | null; timeEntryId?: string | null
}) {
  return scheduledStart ? `${serviceDate}|${caregiverId}|${scheduledStart}` : `${serviceDate}|${caregiverId}|entry:${timeEntryId}`
}

export interface ResolvedRate { rate: number; rateType: string; source: 'referral_source_rate' | 'client_private_pay_rate' }

/**
 * The client record is the ONLY source of a billing rate. Private pay wins over a lingering
 * referral source (the client form hides that field when Private Pay is checked but keeps it).
 * A payer rate prefers the client's care type and the one effective for the period.
 * Returns null when nothing is configured so the caller fails loudly.
 */
export async function resolveClientRate(dbc: Dbc, client: any, periodStart: string, periodEnd: string): Promise<ResolvedRate | null> {
  const payerId = client.referred_by_id ?? client.referredById ?? null
  const careTypeId = client.care_type_id ?? client.careTypeId ?? null
  const privatePay = !!(client.is_private_pay ?? client.isPrivatePay)
  if (!privatePay && payerId) {
    // A rate RETIRED by a newer one (is_active false, end_date set) still prices the days before its
    // end date — otherwise entering October's rate makes September unbillable. CVHC filtered on
    // is_active alone; the dates are what bound a retired rate.
    const r = rowsOf(await dbc.execute(sql`
      SELECT rate_amount, rate_type FROM referral_source_rates
       WHERE referral_source_id = ${payerId}
         AND (care_type_id = ${careTypeId} OR care_type_id IS NULL)
         AND (is_active = true OR is_active IS NULL OR end_date IS NOT NULL)
         AND (effective_date IS NULL OR effective_date <= ${periodEnd}::date)
         AND (end_date IS NULL OR end_date >= ${periodStart}::date)
       ORDER BY CASE WHEN care_type_id = ${careTypeId} THEN 0 ELSE 1 END,
                effective_date DESC NULLS LAST
       LIMIT 1`))
    if (r[0]) return { rate: parseFloat(r[0].rate_amount), rateType: r[0].rate_type || 'hourly', source: 'referral_source_rate' }
  }
  const ppRate = client.private_pay_rate ?? client.privatePayRate
  if (ppRate) {
    return { rate: parseFloat(ppRate), rateType: (client.private_pay_rate_type ?? client.privatePayRateType) || 'hourly', source: 'client_private_pay_rate' }
  }
  return null
}

export const noRateRefusal = (client: any, what = 'create the invoice') => new BillingRefusal(400, {
  error: 'No billing rate configured for this client',
  message: `${client.first_name ?? client.firstName} ${client.last_name ?? client.lastName} has no rate set. Add it on the client (Clients → Edit → Private Pay Rate), or set a referral-source rate for their payer, then ${what}.`,
})

/** An hourly rate bills hours; any other rate is PER 15-MINUTE UNIT (units = hours × 4, to 2dp) —
 *  the claims engine's convention. */
export function lineAmount(hours: number, resolved: { rate: number; rateType: string }) {
  return resolved.rateType === 'hourly'
    ? round2(hours * resolved.rate)
    : round2((Math.round(hours * 4 * 100) / 100) * resolved.rate)
}

/** Stamp the authoritative rate on a submitted line and recompute its amount. An explicit rate of 0
 *  is a deliberate no-charge line and is kept (nobody fat-fingers 0.01 into 0). */
export function applyRate(item: any, resolved: ResolvedRate) {
  const hours = parseFloat(item.hours || 0) || 0
  const submitted = item.rate === '' || item.rate == null ? null : parseFloat(item.rate)
  const isWriteOff = submitted === 0
  const rate = isWriteOff ? 0 : resolved.rate
  return { hours, rate, amount: isWriteOff ? 0 : lineAmount(hours, resolved) }
}

export interface LineItem {
  time_entry_id: string | null
  schedule_id: string | null
  caregiver_id: string
  caregiver_first_name?: string
  caregiver_last_name?: string
  service_date: string
  start_time: string | null      // HH:MM shown/edited (the punch on a clocked line, else the shift)
  end_time: string | null
  visit_start: string | null     // HH:MM:SS — the visit's identity (scheduled start), stored on the line
  visit_end: string | null
  time_range: string
  description: string
  hours: number
  rate: number
  rate_type: string
  amount: number
  source: 'evv_confirmed' | 'scheduled' | 'unscheduled_evv'
  billed_basis: 'scheduled' | 'clocked' | 'unscheduled'
  scheduled_minutes: number | null
  clocked_minutes: number | null
}

export interface GenerateResult {
  lineItems: LineItem[]
  total: number
  reconcile: any[]
  skipped: any[]
  rate: ResolvedRate
  timeZone: string
}

/** The client row every generator reads. */
export async function loadBillingClient(dbc: Dbc, clientId: string) {
  const r = rowsOf(await dbc.execute(sql`
    SELECT id, first_name, last_name, email, referred_by_id, care_type_id, is_private_pay,
           private_pay_rate, private_pay_rate_type, is_active, billing_frequency_weeks,
           to_char(billed_through, 'YYYY-MM-DD') AS billed_through
      FROM clients WHERE id = ${clientId}`))
  return r[0] || null
}

/**
 * Every billable day for one client and period, and the line items they become.
 * options.choices: { [reconcileKey]: 'scheduled' | 'clocked' | 'skip' } — the reviewer's per-day
 * decisions. Anything not named bills its default.
 */
export async function generateLineItems(
  dbc: Dbc, client: any, periodStart: string, periodEnd: string, options: { choices?: Record<string, string> } = {},
): Promise<GenerateResult> {
  const choices = options.choices || {}
  const resolved = await resolveClientRate(dbc, client, periodStart, periodEnd)
  if (!resolved || !(resolved.rate > 0)) throw noRateRefusal(client)
  const privatePay = !!client.is_private_pay
  const amountFor = (hours: number) => lineAmount(hours, resolved)
  const tz = await agencyTimeZone()

  const [hasTraining, hasSuspended, hasCancelReason] = await Promise.all([
    columnExists(dbc, 'schedules', 'is_training'),
    columnExists(dbc, 'schedules', 'suspended_from'),
    columnExists(dbc, 'schedule_exceptions', 'cancel_reason'),
  ])
  const trainingJoin = hasTraining ? sql.raw(`LEFT JOIN schedules ts ON te.schedule_id = ts.id`) : sql.raw('')
  const trainingEntryFilter = hasTraining ? sql.raw(`AND (ts.is_training IS NOT TRUE OR ts.id IS NULL)`) : sql.raw('')
  const trainingScheduleFilter = hasTraining ? sql.raw(`AND s.is_training IS NOT TRUE`) : sql.raw('')

  // time_entries.start_time is a naive UTC instant; read it on the agency's clock.
  const local = (col: string) => sql.raw(`((${col} AT TIME ZONE 'UTC') AT TIME ZONE `)
  const entries = rowsOf(await dbc.execute(sql`
    SELECT te.id AS time_entry_id, te.caregiver_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           to_char(${local('te.start_time')}${tz}), 'YYYY-MM-DD') AS local_date,
           (EXTRACT(HOUR FROM ${local('te.start_time')}${tz})) * 60 + EXTRACT(MINUTE FROM ${local('te.start_time')}${tz})))::int AS start_min,
           CASE WHEN te.end_time IS NULL THEN NULL
                ELSE (EXTRACT(HOUR FROM ${local('te.end_time')}${tz})) * 60 + EXTRACT(MINUTE FROM ${local('te.end_time')}${tz})))::int END AS end_min,
           to_char(${local('te.start_time')}${tz}), 'FMHH12:MI AM') AS start_label,
           CASE WHEN te.end_time IS NULL THEN NULL ELSE to_char(${local('te.end_time')}${tz}), 'FMHH12:MI AM') END AS end_label,
           to_char(${local('te.start_time')}${tz}), 'HH24:MI') AS start_hhmm,
           CASE WHEN te.end_time IS NULL THEN NULL ELSE to_char(${local('te.end_time')}${tz}), 'HH24:MI') END AS end_hhmm,
           to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_iso,
           CASE WHEN te.end_time IS NULL THEN NULL ELSE to_char(te.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS end_iso,
           te.duration_minutes, te.billable_minutes,
           CASE WHEN te.end_time IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60.0 END AS raw_minutes
      FROM time_entries te
      JOIN users u ON te.caregiver_id = u.id
      ${trainingJoin}
     WHERE te.client_id = ${client.id}
       AND te.is_complete = true
       AND (${local('te.start_time')}${tz}))::date BETWEEN ${periodStart}::date AND ${periodEnd}::date
       ${trainingEntryFilter}
     ORDER BY te.start_time`))

  const occ = rowsOf(await dbc.execute(sql`
    WITH ${scheduleOccurrencesCte('occ', periodStart, periodEnd, { hasSuspendedFrom: hasSuspended })}
    SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS occ_date, occ.caregiver_id,
           occ.start_time::text AS start_time, occ.end_time::text AS end_time,
           s.notes, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id
      JOIN users u ON u.id = occ.caregiver_id
     WHERE occ.client_id = ${client.id}
       ${trainingScheduleFilter}
     ORDER BY occ.occ_date, occ.start_time`))

  // Days deliberately NOT billed: reason-coded cancellations, listed so the reviewer sees WHY.
  let skipped: any[] = []
  if (hasCancelReason) {
    skipped = rowsOf(await dbc.execute(sql`
      SELECT to_char(se.exception_date, 'YYYY-MM-DD') AS service_date, se.cancel_reason AS reason,
             se.override_notes AS notes, se.created_at AS reported_at,
             s.start_time::time::text AS scheduled_start, s.end_time::time::text AS scheduled_end,
             TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS caregiver_name,
             TRIM(COALESCE(cu.first_name, '') || ' ' || COALESCE(cu.last_name, '')) AS reported_by,
             cu.role AS reported_by_role
        FROM schedule_exceptions se
        JOIN schedules s ON s.id = se.schedule_id
        LEFT JOIN users u  ON u.id  = s.caregiver_id
        LEFT JOIN users cu ON cu.id = se.created_by
       WHERE se.exception_type = 'cancelled'
         AND se.cancel_reason IS NOT NULL
         AND COALESCE(se.override_client_id, s.client_id) = ${client.id}
         AND se.exception_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
       ORDER BY se.exception_date, s.start_time`))
  }

  const name = (x: any) => `${x.caregiver_first_name || ''} ${x.caregiver_last_name || ''}`.trim()
  const expectedVisits = occ.map((r) => ({
    date: r.occ_date as string, caregiver_id: r.caregiver_id as string,
    caregiver_first_name: r.caregiver_first_name, caregiver_last_name: r.caregiver_last_name,
    start_time: r.start_time as string, end_time: r.end_time as string,
    schedule_id: r.schedule_id as string, notes: r.notes,
  }))

  // ── Match each scheduled visit to a punch: same caregiver, same day, closest start ────────────
  const unmatchedEntries = [...entries]
  const visitsWithMatch = expectedVisits.map((v) => {
    const candidates = unmatchedEntries.filter((te) => te.caregiver_id === v.caregiver_id && te.local_date === v.date)
    if (!candidates.length) return { visit: v, entry: null as any }
    const vs = minutesOf(v.start_time) || 0
    candidates.sort((a, b) => Math.abs(a.start_min - vs) - Math.abs(b.start_min - vs))
    const matched = candidates[0]
    unmatchedEntries.splice(unmatchedEntries.indexOf(matched), 1)
    return { visit: v, entry: matched }
  })
  visitsWithMatch.sort((a, b) => a.visit.date.localeCompare(b.visit.date) || (a.visit.start_time || '').localeCompare(b.visit.start_time || ''))

  // Overlapping duplicate schedules for one caregiver: an unmatched scheduled visit that overlaps a
  // WORKED visit for the same caregiver and day is the same shift twice — never a second line.
  const matchedWindows = visitsWithMatch.filter((x) => x.entry).map((x) => ({
    caregiver_id: x.visit.caregiver_id, day: x.visit.date, start: minutesOf(x.visit.start_time), end: minutesOf(x.visit.end_time),
  }))
  const duplicatesWorkedShift = (v: any) => {
    const vs = minutesOf(v.start_time), ve = minutesOf(v.end_time)
    if (vs == null || ve == null) return false
    return matchedWindows.some((m) => m.caregiver_id === v.caregiver_id && m.day === v.date
      && m.start != null && m.end != null && vs < m.end && m.start < ve)
  }

  // A different caregiver's punch covering > 50% of a scheduled window means the visit happened
  // (someone else worked it); a small handoff overrun (16%) must not suppress the real line.
  const punchWindows: { day: string; start: number; end: number }[] = []
  for (const x of visitsWithMatch) if (x.entry && x.entry.end_min != null) punchWindows.push({ day: x.entry.local_date, start: x.entry.start_min, end: x.entry.end_min })
  for (const e of unmatchedEntries) if (e.end_min != null) punchWindows.push({ day: e.local_date, start: e.start_min, end: e.end_min })
  const coveredByActualWork = (v: any) => {
    const vs = minutesOf(v.start_time), ve = minutesOf(v.end_time)
    if (vs == null || ve == null || ve <= vs) return false
    let covered = 0
    for (const p of punchWindows) {
      if (p.day !== v.date || p.end <= p.start) continue
      covered += Math.max(0, Math.min(ve, p.end) - Math.max(vs, p.start))
    }
    return covered > (ve - vs) * 0.5
  }

  // Coverage extension: a caregiver who stayed past their shift and absorbed another (unclocked)
  // scheduled window is credited that window's scheduled minutes, so the covered hours bill once —
  // to the coverer — instead of to nobody. Bounded below by what was actually worked.
  const matchedPunchWindows = visitsWithMatch.filter((x) => x.entry && x.entry.end_min != null).map((x) => ({
    entryId: x.entry.time_entry_id, day: x.entry.local_date, start: x.entry.start_min as number, end: x.entry.end_min as number,
  }))
  const extraSchedMinByEntry = new Map<string, number>()
  for (const { visit, entry } of visitsWithMatch) {
    if (entry) continue
    if (duplicatesWorkedShift(visit)) continue
    if (!coveredByActualWork(visit)) continue
    const vs = minutesOf(visit.start_time), ve = minutesOf(visit.end_time)
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
  const punchLabel = (e: any) => (e.end_label ? `${e.start_label} - ${e.end_label}` : '')

  for (const { visit, entry } of visitsWithMatch) {
    if (!entry && (duplicatesWorkedShift(visit) || coveredByActualWork(visit))) continue
    let hours = 0
    let timeRangeLabel = ''
    let source: LineItem['source'] = 'scheduled'
    let timeEntryId: string | null = null
    let billedBasis: LineItem['billed_basis'] = 'scheduled'
    let schedMinutes: number | null = null, clockedMinutes: number | null = null
    let shownStart: string | null = null, shownEnd: string | null = null

    if (entry) {
      source = 'evv_confirmed'
      timeEntryId = entry.time_entry_id
      const actualMin = entry.duration_minutes ? Number(entry.duration_minutes) : (entry.raw_minutes != null ? Number(entry.raw_minutes) : 0)
      const ownSched = (minutesOf(visit.start_time) != null && minutesOf(visit.end_time) != null)
        ? (minutesOf(visit.end_time) as number) - (minutesOf(visit.start_time) as number) : null
      // Bill the combined block only when the punch is long enough to have covered it — otherwise a
      // phantom schedule row on top of a real visit would inflate the bill.
      const extraMin = extraSchedMinByEntry.get(entry.time_entry_id) || 0
      const schedMin = (ownSched != null && extraMin > 0 && actualMin >= ownSched + extraMin - PAY_GRACE_MIN) ? ownSched + extraMin : ownSched
      const haveSched = schedMin != null && schedMin > 0
      const disagrees = haveSched && Math.abs(actualMin - (schedMin as number)) > PAY_GRACE_MIN
      const key = reconcileKey({ serviceDate: visit.date, caregiverId: visit.caregiver_id, scheduledStart: visit.start_time, timeEntryId: entry.time_entry_id })
      const runsLong = haveSched && actualMin > (schedMin as number) + PAY_GRACE_MIN
      const defaultBasis = !haveSched ? 'clocked' : (privatePay && !runsLong) ? 'clocked' : 'scheduled'
      const chosen = !haveSched ? 'clocked'
        : choices[key] === 'clocked' ? 'clocked'
        : choices[key] === 'scheduled' ? 'scheduled'
        : defaultBasis
      const billedMin = chosen === 'clocked' ? actualMin : (schedMin as number)
      hours = billedMin / 60
      billedBasis = chosen as LineItem['billed_basis']
      schedMinutes = haveSched ? (schedMin as number) : null
      clockedMinutes = Math.round(actualMin)
      reconcile.push({
        key,
        service_date: visit.date,
        caregiver_id: visit.caregiver_id,
        caregiver_name: name(visit),
        scheduled_start: visit.start_time,
        scheduled_end: visit.end_time,
        scheduled_minutes: haveSched ? schedMin : null,
        scheduled_amount: haveSched ? amountFor((schedMin as number) / 60) : null,
        clocked_start: entry.start_iso,
        clocked_end: entry.end_iso,
        clocked_start_label: entry.start_label,
        clocked_end_label: entry.end_label,
        clocked_minutes: Math.round(actualMin),
        clocked_amount: amountFor(actualMin / 60),
        time_entry_id: entry.time_entry_id,
        // A private-pay punch that came in SHORT needs no decision — billing the clock is the
        // policy. A long punch (missed clock-out) still stops for review.
        needs_choice: disagrees && (!privatePay || runsLong),
        status: !haveSched ? 'unscheduled' : !disagrees ? 'match' : actualMin < (schedMin as number) ? 'short' : 'long',
        default_basis: defaultBasis,
        chosen_basis: chosen,
      })
      timeRangeLabel = punchLabel(entry)
      shownStart = entry.start_hhmm
      shownEnd = entry.end_hhmm
    } else {
      // No clock-in → bill scheduled. Nothing to reconcile.
      hours = hoursBetween(visit.start_time, visit.end_time)
      timeRangeLabel = `${fmtTime12(visit.start_time)} - ${fmtTime12(visit.end_time)}`
      billedBasis = 'scheduled'
      schedMinutes = Math.round(hours * 60)
      shownStart = String(visit.start_time).slice(0, 5)
      shownEnd = String(visit.end_time).slice(0, 5)
      reconcile.push({
        key: reconcileKey({ serviceDate: visit.date, caregiverId: visit.caregiver_id, scheduledStart: visit.start_time }),
        service_date: visit.date,
        caregiver_id: visit.caregiver_id,
        caregiver_name: name(visit),
        scheduled_start: visit.start_time,
        scheduled_end: visit.end_time,
        scheduled_minutes: Math.round(hours * 60),
        scheduled_amount: amountFor(hours),
        clocked_start: null, clocked_end: null, clocked_start_label: null, clocked_end_label: null,
        clocked_minutes: null, clocked_amount: null,
        time_entry_id: null,
        needs_choice: false,
        status: 'no_punch',
        default_basis: 'scheduled',
        chosen_basis: 'scheduled',
      })
    }

    if (hours <= 0) continue
    // Notes are internal and never printed on an invoice — a generic label plus the time range.
    const baseDesc = 'Home Care Services'
    lineItems.push({
      time_entry_id: timeEntryId,
      schedule_id: visit.schedule_id,
      caregiver_id: visit.caregiver_id,
      caregiver_first_name: visit.caregiver_first_name,
      caregiver_last_name: visit.caregiver_last_name,
      service_date: visit.date,
      start_time: shownStart,
      end_time: shownEnd,
      visit_start: visit.start_time,
      visit_end: visit.end_time,
      time_range: timeRangeLabel,
      description: timeRangeLabel ? `${baseDesc} (${timeRangeLabel})` : baseDesc,
      hours,
      rate: resolved.rate,
      rate_type: resolved.rateType,
      amount: amountFor(hours),
      source,
      billed_basis: billedBasis,
      scheduled_minutes: schedMinutes,
      clocked_minutes: clockedMinutes,
    })
  }

  // Twin-punch guard: an orphan punch whose window is mostly (> 50%) covered by this invoice's
  // already-billed punches for the same caregiver is a duplicate clock-in, not a second visit.
  const billedWindows = visitsWithMatch.filter((x) => x.entry && x.entry.end_min != null).map((x) => ({
    caregiver_id: x.visit.caregiver_id, day: x.entry.local_date, start: x.entry.start_min as number, end: x.entry.end_min as number,
  }))
  const mostlyBilledAlready = (e: any) => {
    const es = e.start_min, ee = e.end_min
    if (es == null || ee == null || ee <= es) return false
    let covered = 0
    for (const w of billedWindows) {
      if (w.caregiver_id !== e.caregiver_id || w.day !== e.local_date || w.end <= w.start) continue
      covered += Math.max(0, Math.min(ee, w.end) - Math.max(es, w.start))
    }
    return covered > (ee - es) * 0.5
  }

  // Orphan punches (worked but not on the schedule): default SKIP, explicit opt-in bills the clock.
  // billable_minutes is preferred — the clock-out path already zeroes double-taps.
  for (const e of unmatchedEntries) {
    let minutes = 0
    if (e.billable_minutes != null) minutes = Number(e.billable_minutes)
    else if (e.duration_minutes) minutes = Number(e.duration_minutes)
    else if (e.raw_minutes != null) minutes = Number(e.raw_minutes)
    const hours = minutes / 60
    if (minutes < 1) continue          // sub-minute "visits" are taps, not care
    if (mostlyBilledAlready(e)) continue
    const amount = amountFor(hours)
    const key = reconcileKey({ serviceDate: e.local_date, caregiverId: e.caregiver_id, timeEntryId: e.time_entry_id })
    const billIt = choices[key] === 'clocked'
    const label = punchLabel(e)
    if (billIt) {
      if (e.end_min != null) billedWindows.push({ caregiver_id: e.caregiver_id, day: e.local_date, start: e.start_min, end: e.end_min })
      const baseDesc = 'Home Care Services (unscheduled)'
      lineItems.push({
        time_entry_id: e.time_entry_id,
        schedule_id: null,
        caregiver_id: e.caregiver_id,
        caregiver_first_name: e.caregiver_first_name,
        caregiver_last_name: e.caregiver_last_name,
        service_date: e.local_date,
        start_time: e.start_hhmm,
        end_time: e.end_hhmm,
        visit_start: e.start_hhmm ? `${e.start_hhmm}:00` : null,
        visit_end: e.end_hhmm ? `${e.end_hhmm}:00` : null,
        time_range: label,
        description: label ? `${baseDesc} (${label})` : baseDesc,
        hours,
        rate: resolved.rate,
        rate_type: resolved.rateType,
        amount,
        billed_basis: 'unscheduled',
        scheduled_minutes: null,
        clocked_minutes: Math.round(minutes),
        source: 'unscheduled_evv',
      })
    }
    reconcile.push({
      key,
      service_date: e.local_date,
      caregiver_id: e.caregiver_id,
      caregiver_name: name(e),
      scheduled_start: null, scheduled_end: null, scheduled_minutes: null, scheduled_amount: null,
      clocked_start: e.start_iso,
      clocked_end: e.end_iso,
      clocked_start_label: e.start_label,
      clocked_end_label: e.end_label,
      clocked_minutes: Math.round(minutes),
      clocked_amount: amount,
      time_entry_id: e.time_entry_id,
      needs_choice: true,
      status: 'unscheduled',
      default_basis: 'skip',
      chosen_basis: billIt ? 'clocked' : 'skip',
    })
  }

  // Two scheduled visits on one day whose windows overlap both bill in full — almost always a
  // handoff that was never trimmed. Flag each by name; the fix is a schedule correction.
  for (const day of new Set(reconcile.map((r) => r.service_date))) {
    const dayRows = reconcile.filter((r) => r.service_date === day && r.scheduled_start != null && r.scheduled_end != null)
    for (let i = 0; i < dayRows.length; i++) {
      for (let j = i + 1; j < dayRows.length; j++) {
        const a = dayRows[i], b = dayRows[j]
        const as = minutesOf(a.scheduled_start), ae = minutesOf(a.scheduled_end)
        const bs = minutesOf(b.scheduled_start), be = minutesOf(b.scheduled_end)
        if (as == null || ae == null || bs == null || be == null) continue
        const ov = Math.min(ae, be) - Math.max(as, bs)
        if (ov <= 0) continue
        a.overlap_minutes = Math.max(a.overlap_minutes || 0, ov)
        b.overlap_minutes = Math.max(b.overlap_minutes || 0, ov)
        a.overlap_with = b.caregiver_name
        b.overlap_with = a.caregiver_name
      }
    }
  }

  lineItems.sort((a, b) => (a.service_date || '').localeCompare(b.service_date || ''))
  reconcile.sort((a, b) => (a.service_date || '').localeCompare(b.service_date || '') || (a.scheduled_start || '').localeCompare(b.scheduled_start || ''))
  const total = round2(lineItems.reduce((s, li) => s + li.amount, 0))
  return { lineItems, total, reconcile, skipped, rate: resolved, timeZone: tz }
}

/** A random, durable invoice code (the friendly number is seq_number). A short random tail keeps two
 *  invoices for one client created in the same millisecond (Create Due Invoices) from colliding. */
export function generateInvoiceNumber(clientId: string) {
  const timestamp = Date.now().toString(36).toUpperCase()
  const clientPart = String(clientId).slice(0, 4).toUpperCase()
  const tail = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `INV-${timestamp}${tail}-${clientPart}`
}

/** Insert line items (inside the caller's transaction). */
export async function insertLineItems(dbc: Dbc, invoiceId: string, items: any[]) {
  for (const item of items) {
    await dbc.execute(sql`
      INSERT INTO invoice_line_items (
        id, invoice_id, time_entry_id, caregiver_id, description, hours, rate, amount, service_date,
        billed_basis, scheduled_minutes, clocked_minutes, start_time, end_time
      ) VALUES (
        ${createId()}, ${invoiceId}, ${item.time_entry_id || null}, ${item.caregiver_id},
        ${clampLineItemDescription(item.description)}, ${item.hours}, ${item.rate}, ${item.amount},
        ${item.service_date || null}, ${item.billed_basis || null}, ${item.scheduled_minutes ?? null},
        ${item.clocked_minutes ?? null}, ${item.visit_start || null}, ${item.visit_end || null}
      )`)
  }
}

/**
 * Create one invoice with its lines, atomically, and move the client's billed_through forward so
 * "Create Due Invoices" resumes after it. The CLIENT ROW IS LOCKED first, so two clicks on Create
 * cannot both pass the "already invoiced for this period" check.
 * Returns the invoice row, or throws a BillingRefusal (409) when the period is already invoiced.
 */
export async function createInvoiceWithLines(opts: {
  client: any; periodStart: string; periodEnd: string; lineItems: any[]; total: number; notes?: string | null;
  advanceBilledThrough?: 'greatest' | 'set' | false; sentAt?: Date | null;
}) {
  const { client, periodStart, periodEnd, lineItems, total } = opts
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM clients WHERE id = ${client.id} FOR UPDATE`)
    const existing = rowsOf(await tx.execute(sql`
      SELECT id, invoice_number FROM invoices
       WHERE client_id = ${client.id} AND billing_period_start = ${periodStart}::date AND billing_period_end = ${periodEnd}::date`))
    if (existing.length) {
      throw new BillingRefusal(400, { error: `Invoice ${existing[0].invoice_number} already exists for this period`, existingInvoiceId: existing[0].id })
    }
    const due = addDays(periodEnd, 30)
    const inv = rowsOf(await tx.execute(sql`
      INSERT INTO invoices (
        id, client_id, invoice_number, billing_period_start, billing_period_end,
        subtotal, total, payment_status, payment_due_date, notes, referral_source_id, invoice_type, sent_at
      ) VALUES (
        ${createId()}, ${client.id}, ${generateInvoiceNumber(client.id)}, ${periodStart}::date, ${periodEnd}::date,
        ${round2(total)}, ${round2(total)}, 'pending', ${due}::date, ${opts.notes ?? null},
        ${client.is_private_pay ? null : (client.referred_by_id || null)},
        ${client.is_private_pay ? 'private_pay' : 'insurance'}, ${opts.sentAt ?? null}
      ) RETURNING *, to_char(billing_period_start, 'YYYY-MM-DD') AS period_start_text`))[0]
    await insertLineItems(tx as any, inv.id, lineItems)
    if (opts.advanceBilledThrough === 'set') {
      await tx.execute(sql`UPDATE clients SET billed_through = ${periodEnd}::date WHERE id = ${client.id}`)
    } else if (opts.advanceBilledThrough !== false) {
      await tx.execute(sql`UPDATE clients SET billed_through = GREATEST(COALESCE(billed_through, ${periodEnd}::date), ${periodEnd}::date) WHERE id = ${client.id}`)
    }
    return inv
  })
}

// ── Who outside the office may see an invoice ────────────────────────────────────────────────
// Invoices start as DRAFTS (sent_at NULL). The client/family portal, its PDF and the public pay page
// show one only once the office sends, releases or takes a payment on it (CVHC v55). One rule for
// every outside read: use isClientVisibleInvoice on a row, clientVisibleInvoiceSql() in a WHERE.
export function isClientVisibleInvoice(inv: { sent_at?: unknown; sentAt?: unknown; payment_status?: string | null; paymentStatus?: string | null } | null | undefined): boolean {
  if (!inv) return false
  const sent = inv.sent_at ?? inv.sentAt
  const status = inv.payment_status ?? inv.paymentStatus
  return sent != null || status === 'paid' || status === 'partial'
}
export function clientVisibleInvoiceSql() {
  return sql`(${invoices.sentAt} IS NOT NULL OR ${invoices.paymentStatus} IN ('paid', 'partial'))`
}
