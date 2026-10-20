/**
 * The caregiver's visits, expanded from GET /api/schedules/:caregiverId?includeMovedIn=1.
 *
 * The phone gets the raw schedule rows (recurring patterns + one-time rows, each carrying its per-date
 * exceptions) and expands them itself, so the last good roster still works with no signal. The rows
 * are the unified server's camelCase (apps/unified/server/data/homecareCore.ts SCHED_COLS / EXC_COLS:
 * dates 'YYYY-MM-DD', times wall-clock 'HH:MM:SS'). The rules below mirror the server engine
 * (apps/unified/server/data/homecareCore.ts, the occurrence CTE):
 *
 *  1. Recurring-ness is `dayOfWeek` being set — never `scheduleType`.
 *  2. Bi-weekly lives in `frequency` ('biweekly' or 'bi-weekly') and runs on its anchor fortnight:
 *     whole days from COALESCE(anchorDate, effectiveDate, createdAt), floored to weeks, even = on.
 *  3. effectiveDate / endDate bound RECURRING rows only; a one-time row's date is its occurrence.
 *  4. A cancelled occurrence does not exist. A 'modified' one takes its override times / client, and
 *     one moved to another caregiver is not this caregiver's.
 *  5. A suspended schedule generates nothing on/after suspendedFrom.
 *  6. A row with no start or end time is not a visit.
 *
 * Pure — no React Native imports — so it runs under `bun run tests/mobile/care-app.test.ts`.
 */
import { addDaysYmd, dayDiff, dowOfYmd, minutesOf, isYmd } from './time'

export interface ScheduleException {
  exceptionDate: string
  exceptionType: string
  overrideStartTime?: string | null
  overrideEndTime?: string | null
  overrideCaregiverId?: string | null
  overrideClientId?: string | null
  overrideNotes?: string | null
  cancelReason?: string | null
}

export interface ScheduleRow {
  id: string
  caregiverId?: string | null
  clientId: string
  dayOfWeek: number | null
  date: string | null
  startTime: string | null
  endTime: string | null
  frequency?: string | null
  effectiveDate?: string | null
  anchorDate?: string | null
  endDate?: string | null
  suspendedFrom?: string | null
  createdAt?: string | null
  notes?: string | null
  clientFirstName?: string | null
  clientLastName?: string | null
  clientAddress?: string | null
  clientCity?: string | null
  careTypeName?: string | null
  isTraining?: boolean | null
  movedIn?: boolean | null
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

export const isRecurring = (s: Pick<ScheduleRow, 'dayOfWeek'>) => s.dayOfWeek !== null && s.dayOfWeek !== undefined

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

export const isSuspendedOn = (s: Pick<ScheduleRow, 'suspendedFrom'>, dateYmd: string) => {
  const from = ymd10(s.suspendedFrom)
  return !!from && dateYmd >= from
}

/** Does a RECURRING row produce a visit on this calendar date (before exceptions)? */
export function recurringOn(s: ScheduleRow, dateYmd: string): boolean {
  if (!isRecurring(s)) return false
  if (dowOfYmd(dateYmd) !== Number(s.dayOfWeek)) return false
  const eff = ymd10(s.effectiveDate)
  if (eff && dateYmd < eff) return false
  const end = ymd10(s.endDate)
  if (end && dateYmd > end) return false
  if (isBiweekly(s.frequency) && !isBiweeklyOn(dateYmd, ymd10(s.anchorDate) || eff || ymd10(s.createdAt))) return false
  if (isSuspendedOn(s, dateYmd)) return false
  return true
}

/** Server rule 4. Returns the occurrence's times/client for that date, or null when it doesn't happen. */
export function applyException(s: ScheduleRow, dateYmd: string): { startTime: string | null; endTime: string | null; clientId: string } | null {
  const ex = (s.exceptions || []).find((e) => ymd10(e.exceptionDate) === dateYmd)
  const base = { startTime: s.startTime, endTime: s.endTime, clientId: s.clientId }
  if (!ex) return base
  if (ex.exceptionType === 'cancelled') return null
  if (ex.exceptionType === 'modified') {
    if (ex.overrideCaregiverId && s.caregiverId && !s.movedIn && ex.overrideCaregiverId !== s.caregiverId) return null
    return {
      startTime: ex.overrideStartTime || s.startTime,
      endTime: ex.overrideEndTime || s.endTime,
      clientId: ex.overrideClientId || s.clientId,
    }
  }
  return base
}

const nameOf = (s: ScheduleRow) => `${s.clientFirstName || ''} ${s.clientLastName || ''}`.trim()

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
    const sameClient = occ.clientId === s.clientId
    out.push({
      key: `${s.id}|${date}|${occ.startTime}`,
      scheduleId: s.id,
      date,
      startTime: String(occ.startTime),
      endTime: String(occ.endTime),
      clientId: occ.clientId,
      clientName: (sameClient ? nameOf(s) : '') || clientNames[occ.clientId] || 'Client',
      clientAddress: sameClient ? s.clientAddress || null : null,
      clientCity: sameClient ? s.clientCity || null : null,
      notes: s.notes || null,
      careType: s.careTypeName || null,
      recurring: isRecurring(s),
      movedIn: s.movedIn === true,
      isTraining: s.isTraining === true,
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
