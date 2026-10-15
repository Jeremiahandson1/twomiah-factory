/**
 * The caregiver's visits, expanded from GET /api/schedules/:caregiverId?includeMovedIn=1.
 *
 * The home care backend has no caregiver-scoped "my occurrences" endpoint: the phone gets the raw
 * schedule rows (recurring patterns + one-time rows, each recurring row carrying its per-date
 * exceptions) and expands them itself, the way the agency's web caregiver page does. The rules
 * below mirror the server engine (crm-homecare backend/src/services/scheduleOccurrences.ts):
 *
 *  1. Recurring-ness is `day_of_week` being set — never `schedule_type`.
 *  2. Bi-weekly lives in `frequency` ('biweekly' or 'bi-weekly') and runs on its anchor fortnight:
 *     whole days from COALESCE(anchor_date, effective_date, created_at), floored to weeks, even = on.
 *  3. effective_date / end_date bound RECURRING rows only; a one-time row's date is its occurrence.
 *  4. A cancelled occurrence does not exist. A 'modified' one takes its override times / client, and
 *     one moved to another caregiver is not this caregiver's.
 *  5. A suspended schedule generates nothing on/after suspended_from.
 *  6. A row with no start or end time is not a visit.
 *
 * Pure — no React Native imports — so it runs under `bun run tests/mobile/care-app.test.ts`.
 */
import { addDaysYmd, dayDiff, dowOfYmd, minutesOf, isYmd } from './time'

export interface ScheduleException {
  exception_date: string
  exception_type: string
  override_start_time?: string | null
  override_end_time?: string | null
  override_caregiver_id?: string | null
  override_client_id?: string | null
  override_notes?: string | null
  cancel_reason?: string | null
}

export interface ScheduleRow {
  id: string
  caregiver_id?: string | null
  client_id: string
  day_of_week: number | null
  date: string | null
  start_time: string | null
  end_time: string | null
  frequency?: string | null
  effective_date?: string | null
  anchor_date?: string | null
  end_date?: string | null
  suspended_from?: string | null
  created_at?: string | null
  notes?: string | null
  client_first_name?: string | null
  client_last_name?: string | null
  client_address?: string | null
  client_city?: string | null
  care_type_name?: string | null
  is_training?: boolean | null
  moved_in?: boolean | null
  exceptions?: ScheduleException[]
}

export interface Visit {
  /** Unique per occurrence: scheduleId|date|start. */
  key: string
  scheduleId: string
  date: string
  startTime: string
  endTime: string
  clientId: string
  clientName: string
  clientAddress: string | null
  clientCity: string | null
  notes: string | null
  careType: string | null
  recurring: boolean
  movedIn: boolean
  isTraining: boolean
}

const ymd10 = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).slice(0, 10)
  return isYmd(s) ? s : null
}

export const isRecurring = (s: Pick<ScheduleRow, 'day_of_week'>) => s.day_of_week !== null && s.day_of_week !== undefined

/** Server rule 2: bi-weekly on the anchor's fortnight. */
export function isBiweeklyOn(dateYmd: string, anchorYmd: string | null): boolean {
  if (!anchorYmd) return true
  const weeks = Math.floor(dayDiff(anchorYmd, dateYmd) / 7)
  return ((weeks % 2) + 2) % 2 === 0
}

const isBiweekly = (f: unknown) => {
  const v = String(f || '').toLowerCase()
  return v === 'biweekly' || v === 'bi-weekly'
}

export const isSuspendedOn = (s: Pick<ScheduleRow, 'suspended_from'>, dateYmd: string) => {
  const from = ymd10(s.suspended_from)
  return !!from && dateYmd >= from
}

/** Does a RECURRING row produce a visit on this calendar date (before exceptions)? */
export function recurringOn(s: ScheduleRow, dateYmd: string): boolean {
  if (!isRecurring(s)) return false
  if (dowOfYmd(dateYmd) !== Number(s.day_of_week)) return false
  const eff = ymd10(s.effective_date)
  if (eff && dateYmd < eff) return false
  const end = ymd10(s.end_date)
  if (end && dateYmd > end) return false
  if (isBiweekly(s.frequency) && !isBiweeklyOn(dateYmd, ymd10(s.anchor_date) || eff || ymd10(s.created_at))) return false
  if (isSuspendedOn(s, dateYmd)) return false
  return true
}

/** Server rule 4. Returns the occurrence's times/client for that date, or null when it doesn't happen. */
export function applyException(s: ScheduleRow, dateYmd: string): { startTime: string | null; endTime: string | null; clientId: string } | null {
  const ex = (s.exceptions || []).find((e) => ymd10(e.exception_date) === dateYmd)
  const base = { startTime: s.start_time, endTime: s.end_time, clientId: s.client_id }
  if (!ex) return base
  if (ex.exception_type === 'cancelled') return null
  if (ex.exception_type === 'modified') {
    if (ex.override_caregiver_id && s.caregiver_id && !s.moved_in && ex.override_caregiver_id !== s.caregiver_id) return null
    return {
      startTime: ex.override_start_time || s.start_time,
      endTime: ex.override_end_time || s.end_time,
      clientId: ex.override_client_id || s.client_id,
    }
  }
  return base
}

const nameOf = (s: ScheduleRow) => `${s.client_first_name || ''} ${s.client_last_name || ''}`.trim()

/**
 * Every visit from `fromYmd` for `days` days, sorted by date then start. A moved-in (covering)
 * shift identical to one of the caregiver's own on the same day is shown once.
 * `clientNames` fills in the name when an exception moved the visit to another client.
 */
export function expandVisits(rows: ScheduleRow[], fromYmd: string, days: number, clientNames: Record<string, string> = {}): Visit[] {
  const toYmd = addDaysYmd(fromYmd, Math.max(0, days - 1))
  const out: Visit[] = []
  const push = (s: ScheduleRow, date: string) => {
    const occ = applyException(s, date)
    if (!occ || minutesOf(occ.startTime) == null || minutesOf(occ.endTime) == null) return
    const sameClient = occ.clientId === s.client_id
    out.push({
      key: `${s.id}|${date}|${occ.startTime}`,
      scheduleId: s.id,
      date,
      startTime: String(occ.startTime),
      endTime: String(occ.endTime),
      clientId: occ.clientId,
      clientName: (sameClient ? nameOf(s) : '') || clientNames[occ.clientId] || 'Client',
      clientAddress: sameClient ? s.client_address || null : null,
      clientCity: sameClient ? s.client_city || null : null,
      notes: s.notes || null,
      careType: s.care_type_name || null,
      recurring: isRecurring(s),
      movedIn: s.moved_in === true,
      isTraining: s.is_training === true,
    })
  }
  for (const s of rows || []) {
    if (isRecurring(s)) {
      for (let i = 0; i < days; i++) {
        const d = addDaysYmd(fromYmd, i)
        if (recurringOn(s, d)) push(s, d)
      }
    } else {
      const d = ymd10(s.date)
      if (!d || d < fromYmd || d > toYmd || isSuspendedOn(s, d)) continue
      push(s, d)
    }
  }
  const own = new Set(out.filter((v) => !v.movedIn).map((v) => `${v.clientId}|${v.date}|${v.startTime}|${v.endTime}`))
  const deduped = out.filter((v) => !v.movedIn || !own.has(`${v.clientId}|${v.date}|${v.startTime}|${v.endTime}`))
  deduped.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
  return deduped
}

export type NextUp =
  | { state: 'none' }
  | { state: 'done' }
  | { state: 'in_progress' | 'overdue'; visit: Visit; minutesPastEnd: number }
  | { state: 'due_now' | 'starting_soon' | 'next'; visit: Visit; minutesUntilStart: number }

/**
 * What the caregiver should do right now, from today's visits (the web caregiver page's "next up" strip):
 * the visit they are clocked into; else the first visit that hasn't ended.
 */
export function nextUp(today: Visit[], nowMinutes: number, activeClientId?: string | null): NextUp {
  if (!today.length) return { state: 'none' }
  const endOf = (v: Visit) => {
    const s = minutesOf(v.startTime)!, e = minutesOf(v.endTime)!
    return e < s ? e + 24 * 60 : e
  }
  if (activeClientId) {
    const v = today.find((x) => x.clientId === activeClientId)
    if (v) {
      const past = nowMinutes - endOf(v)
      return { state: past > 0 ? 'overdue' : 'in_progress', visit: v, minutesPastEnd: Math.max(0, past) }
    }
  }
  const v = today.find((x) => endOf(x) >= nowMinutes)
  if (!v) return { state: 'done' }
  const until = minutesOf(v.startTime)! - nowMinutes
  if (until <= 0) return { state: 'due_now', visit: v, minutesUntilStart: 0 }
  return { state: until <= 30 ? 'starting_soon' : 'next', visit: v, minutesUntilStart: until }
}

/** Scheduled hours across a list of visits. */
export function totalHours(visits: Visit[]): number {
  let m = 0
  for (const v of visits) {
    const s = minutesOf(v.startTime)!, e = minutesOf(v.endTime)!
    m += e < s ? e + 1440 - s : e - s
  }
  return m / 60
}
