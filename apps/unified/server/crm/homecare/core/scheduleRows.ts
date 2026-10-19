// How a schedule row leaves the API. Moved from templates/crm-homecare/backend/src/helpers/scheduleRows.ts; the SQL
// (SCHED_COLS, EXC_COLS, the reads) is in server/data/homecareCore.ts.
//
// Changes: the rows are camelCase (RULEBOOK §2: caregiverId, startTime, anchorDate, exceptionDate …; dates still
// 'YYYY-MM-DD', times still wall-clock 'HH:MM:SS'), and every read is the company's. The template's generic `rows` /
// `one` / `rowsOf` executors are not here: only server/data/ runs raw SQL, so a route group writes its own named
// queries there, composing the fragments in data/homecareCore.ts.
import { scheduleById as readSchedule, exceptionsForSchedules } from '../../../data/homecareCore.ts'
import type { CrmDeps } from '../../deps.ts'

export const isOffice = (user: any) => user?.role === 'admin' || user?.role === 'owner'
export const userIdOf = (user: any): string => user?.userId || user?.id

export function createScheduleRows(d: CrmDeps) {
  /** One of the company's schedule rows in the API shape, or null. */
  function scheduleById(companyId: string, id: string, activeOnly = false): Promise<any | null> {
    return readSchedule(d.db, companyId, id, activeOnly)
  }

  /**
   * Attach each pattern's per-date exceptions (`exceptions`), so a client expanding it can tell that an occurrence
   * was cancelled or rescheduled — without this a cancelled visit still shows, and the phone's auto-clock-in would
   * clock somebody in to it. Every row gets its exceptions: a one-time visit can be cancelled as well.
   */
  async function attachExceptions(companyId: string, list: any[]): Promise<any[]> {
    const ids = list.map((s) => s.id).filter(Boolean)
    if (!ids.length) return list.map((s) => ({ ...s, exceptions: [] }))
    const exc = await exceptionsForSchedules(d.db, companyId, ids)
    const byId: Record<string, any[]> = {}
    for (const e of exc) (byId[e.scheduleId] ||= []).push(e)
    return list.map((s) => ({ ...s, exceptions: byId[s.id] || [] }))
  }

  return { scheduleById, attachExceptions }
}
