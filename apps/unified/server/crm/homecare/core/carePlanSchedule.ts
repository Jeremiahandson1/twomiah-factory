// A client's recurring visit schedule in words, for saving onto a care plan ("Fill from current schedule") and for
// noticing when the live schedule has drifted from what a plan recorded. Moved from
// templates/crm-homecare/backend/src/services/carePlanSchedule.ts; the reads are in server/data/.
//
// A pattern is listed when it produces at least one visit in the next WINDOW_DAYS days, expanded ONLY through the
// shared schedule engine, so ended, inactive, suspended and not-yet-started rows drop out exactly the way they do for
// billing and payroll. The text describes the PATTERN (day, times, caregiver, frequency, end date, paused-from date) —
// not one-week overrides or one-time visits.
//
// One change: the schedule is the company's (getClientVisitSchedule takes its id first).
import { clientOccurrenceCount } from '../../../data/homecareCore.ts'
import { clientSchedulePatterns } from '../../../data/homecareEvv.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, type AgencyTime } from './agencyTime.ts'

export const WINDOW_DAYS = 28
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const fmtTime = (t: string) => {
  const [h, m] = String(t).split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}
const fmtDate = (d: string) => { const [y, m, day] = d.split('-').map(Number); return `${m}/${day}/${y}` }

export function createCarePlanSchedule(d: CrmDeps, deps: { time: AgencyTime }) {
  async function getClientVisitSchedule(companyId: string, clientId: string) {
    const today = await deps.time.today(companyId)
    const until = addDays(today, WINDOW_DAYS - 1)
    const patterns = await clientSchedulePatterns(d.db, companyId, clientId, today, until)
    const upcoming = await clientOccurrenceCount(d.db, companyId, clientId, today, until, true)

    const recurring = patterns
      .filter((x) => x.dayOfWeek !== null && x.dayOfWeek !== undefined && x.startTime && x.endTime)
      .sort((a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7)
        || String(a.startTime).localeCompare(String(b.startTime))
        || String(a.caregiver).localeCompare(String(b.caregiver)))
    const lines = recurring.map((x) => {
      const biweekly = x.frequency === 'biweekly' || x.frequency === 'bi-weekly'
      let line = `${DAY_NAMES[x.dayOfWeek]} ${fmtTime(x.startTime)} – ${fmtTime(x.endTime)} · ${x.caregiver || 'Unassigned'} · ${biweekly ? 'every other week' : 'weekly'}`
      if (x.endDate) line += ` · through ${fmtDate(x.endDate)}`
      if (x.suspendedFrom) line += ` · paused from ${fmtDate(x.suspendedFrom)}`
      return line
    })

    return {
      asOf: today,
      windowDays: WINDOW_DAYS,
      text: lines.join('\n'),
      lines,
      upcomingVisits: upcoming,
    }
  }
  return { getClientVisitSchedule }
}
