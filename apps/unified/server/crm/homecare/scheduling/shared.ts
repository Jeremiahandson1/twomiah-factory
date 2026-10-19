// What this group's routers share: who is a caregiver, authorization advice for staffing a shift, and filling an open
// shift's one visit. Moved from templates/crm-homecare/backend/src/helpers/authorizationCheck.ts and the assignShift of
// routes/openShifts.ts (which routes/schedulingHub.ts imported); their SQL is in server/data/homecareScheduling.ts.
import type { Context } from 'hono'
import type { CrmDeps } from '../../deps.ts'
import { clientPrivatePay } from '../../../data/homecareCore.ts'
import {
  currentAuthorization, scheduleDayOfWeek, exceptionOn, calloutToCover, coverDate, deleteException, reassignOneTime, insertSchedule,
} from '../../../data/homecareScheduling.ts'
import { toAuthUnits } from '../core/authUnits.ts'
import { schedTs } from '../core/scheduleOccurrences.ts'
import { addDays } from '../core/agencyTime.ts'

/**
 * "Is this person a caregiver?" — the question the template asked with `!isOffice(user)` where it narrowed a read to
 * the caregiver's own rows. A stored role may be `caregiver` (a moved tenant) or `field` (a new one); both normalise to
 * the field rung. Everyone above it (manager, admin, owner) holds the area's permissions and sees the agency's rows.
 */
export const isCaregiver = (d: CrmDeps, user: any): boolean => d.permissions.normalizeRole(user?.role) === 'field'

/** The signed-in user's id. */
export const userIdOf = (user: any): string => user?.userId || user?.id

/** The signed-in user and their company. */
export function who(c: Context): { user: any; companyId: string; me: string } {
  const user = c.get('user' as never) as any
  return { user, companyId: user.companyId, me: userIdOf(user) }
}

/** The Sun–Sat week holding `ymd`. */
export const weekStartOf = (ymd: string) => addDays(ymd, -new Date(`${ymd}T12:00:00Z`).getUTCDay())

/** A thrown refusal with a status (assignShift's "no visit to fill"). */
export class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

export function createSchedulingShared(d: CrmDeps) {
  /**
   * Authorization ADVICE for staffing a shift. It never blocks: scheduling is not billing, and refusing to staff a
   * shift is the most expensive response to a paperwork gap. Every shortfall is a warning; `allowed` is always true.
   * A private-pay client (by the flag or by its payer's type) gets no advice.
   */
  async function checkAuthorizationBalance(companyId: string, clientId: string | null | undefined, shiftHours: number): Promise<{
    allowed: true; warnings: string[]; authorization: any | null
  }> {
    const warnings: string[] = []
    if (!clientId) return { allowed: true, warnings, authorization: null }
    if (await clientPrivatePay(d.db, companyId, clientId)) return { allowed: true, warnings, authorization: null }

    const auth = await currentAuthorization(d.db, companyId, clientId)
    if (!auth) return { allowed: true, warnings: ['No active authorization on file for this client'], authorization: null }

    const remaining = parseFloat(auth.remainingUnits) || 0
    // One shift is shiftHours × 4 quarter-hours, one visit, one day — in the authorization's unit.
    const requested = toAuthUnits(auth.unitType, { quarterHours: shiftHours * 4, visits: 1, days: 1 })
    const threshold = parseFloat(auth.lowUnitsAlertThreshold) || 0

    if (auth.healthStatus === 'expired') {
      warnings.push(`Authorization ${auth.authNumber || ''} expired on ${auth.endYmd} — this shift may not be billable until it's renewed`.replace('  ', ' '))
    }
    if (remaining < requested) {
      warnings.push(`Authorization balance looks short: ${remaining} ${auth.unitType || 'unit'} remaining, ${requested} needed for this shift — check ${auth.authNumber ? 'auth ' + auth.authNumber : 'the authorization'} before billing`)
    }
    if (auth.healthStatus === 'low') {
      warnings.push(`Authorization running low: ${remaining} units remaining (${auth.pctUsed}% used)`)
    }
    if (auth.healthStatus === 'expiring_soon') {
      const daysLeft = Math.ceil((new Date(`${auth.endYmd}T00:00:00Z`).getTime() - Date.now()) / 86400000)
      warnings.push(`Authorization expires in ${daysLeft} days (${auth.endYmd})`)
    }
    if (remaining - requested <= threshold) {
      warnings.push(`After this shift, only ${(remaining - requested).toFixed(1)} units will remain`)
    }
    return { allowed: true, warnings, authorization: auth }
  }

  /**
   * Put an open shift's ONE visit on `caregiverId`. Shared by approve, smart-fill, the first-to-accept claim and
   * auto-fill, so all of them fill a shift the same way.
   *  - No schedule behind it: the fill is its own one-time visit.
   *  - Recurring pattern: a per-occurrence 'modified' exception — reassigning the pattern would move every past and
   *    future occurrence.
   *  - A caregiver call-out CANCELS the day and posts it; filling it brings the visit back on the new caregiver. Any
   *    other cancellation (client refused, in hospital…) means there is no visit to fill (409).
   * `s` is an open shift in the API shape (clientId, scheduleId, shiftDate, startTime, endTime, notes).
   */
  async function assignShift(companyId: string, s: any, caregiverId: string, actorId: string): Promise<void> {
    const day = s.shiftDate
    if (!s.scheduleId) {
      await insertSchedule(d.db, companyId, {
        caregiverId, clientId: s.clientId, scheduleType: 'one-time', dayOfWeek: null, date: day,
        startTs: schedTs(s.startTime, day), endTs: schedTs(s.endTime, day), notes: s.notes || null, frequency: 'weekly',
      })
      return
    }
    const sched = await scheduleDayOfWeek(d.db, companyId, s.scheduleId)
    const isRecurring = !!sched && sched.dayOfWeek !== null
    const exc = await exceptionOn(d.db, companyId, s.scheduleId, day)
    const isCallout = !!exc && exc.exceptionType === 'cancelled' && exc.cancelReason === 'caregiver_callout'
    if (exc && exc.exceptionType === 'cancelled' && !isCallout) {
      throw new HttpError(409, 'This visit was cancelled on the schedule — there is no visit to fill.')
    }
    if (isRecurring) {
      if (isCallout) await calloutToCover(d.db, companyId, exc!.id, caregiverId)
      else await coverDate(d.db, companyId, s.scheduleId, day, caregiverId, actorId, true)
    } else {
      if (isCallout) await deleteException(d.db, companyId, exc!.id)
      await reassignOneTime(d.db, companyId, s.scheduleId, caregiverId)
    }
  }

  return { checkAuthorizationBalance, assignShift }
}

export type SchedulingShared = ReturnType<typeof createSchedulingShared>
