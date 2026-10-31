// /api/schedules-enhanced — list schedules, and the Schedule Hub / grid's create (single, recurring, bi-weekly, split,
// training). Moved from templates/crm-homecare/backend/src/routes/schedulesEnhanced.ts (POST ported there from the CVHC
// home care CRM, clinicalRoutes.js POST /schedules-enhanced).
//
// Permissions: the list is care-schedule:read; the create is care-schedule:create (the template's requireAdmin).
// Fixed in the move: the template's list answered every schedule to any signed-in person; no caregiver screen reads it,
// and a caregiver now gets their own shifts only (apps/unified/tests/homecare-scheduling.test.ts).
//
// Replies: the list is a list reply ({ data, pagination }); a create answers the row (camelCase) with its advice, a
// split shift { splitShift, segments, … } as before. The 409 on a duplicate is { error, code: 'duplicate' }.
import { Hono } from 'hono'
import { and, eq, gte, lte } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { schedules, user, clients } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { schedTs, hms, shiftHours, shiftTimesError, DATE_RE } from '../core/scheduleOccurrences.ts'
import { alignRepeatAnchor } from '../core/repeats.ts'
import { frequencyFromRequest } from './repeatInput.ts'
import { insertSchedule, oneTimeOverlap, oneTimeTwin } from '../../../data/homecareScheduling.ts'
import { isCaregiver, who, type SchedulingShared } from './shared.ts'

const isDup = (e: any) => e?.code === '23505' || /unique|duplicate key/i.test(e?.message || '')

export function createSchedulesEnhancedRoutes(core: HomecareCore, d: CrmDeps, shared: SchedulingShared) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  // GET /api/schedules-enhanced
  app.get('/', perm('care-schedule:read'), async (c) => {
    const { user: me, companyId, me: myId } = who(c)
    const { startDate, endDate, caregiverId, clientId } = c.req.query()
    const conditions: any[] = [eq(schedules.companyId, companyId), eq(schedules.isActive, true)]
    if (isCaregiver(d, me)) conditions.push(eq(schedules.caregiverId, myId))
    else if (caregiverId) conditions.push(eq(schedules.caregiverId, caregiverId))
    if (clientId) conditions.push(eq(schedules.clientId, clientId))
    if (startDate) conditions.push(gte(schedules.startTime, new Date(startDate)))
    if (endDate) conditions.push(lte(schedules.startTime, new Date(endDate)))

    const rows = await db
      .select({
        id: schedules.id,
        clientId: schedules.clientId,
        caregiverId: schedules.caregiverId,
        title: schedules.title,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
        frequency: schedules.frequency,
        effectiveDate: schedules.effectiveDate,
        anchorDate: schedules.anchorDate,
        scheduleType: schedules.scheduleType,
        isActive: schedules.isActive,
        dayOfWeek: schedules.dayOfWeek,
        notes: schedules.notes,
        createdAt: schedules.createdAt,
        updatedAt: schedules.updatedAt,
        caregiverFirstName: user.firstName,
        caregiverLastName: user.lastName,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(schedules)
      .leftJoin(user, and(eq(schedules.caregiverId, user.id), eq(user.companyId, companyId)))
      .leftJoin(clients, and(eq(schedules.clientId, clients.id), eq(clients.companyId, companyId)))
      .where(and(...conditions))

    return listAll(c, rows)
  })

  // POST /api/schedules-enhanced
  app.post('/', perm('care-schedule:create'), async (c) => {
    const { companyId, me } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const { caregiverId, clientId, scheduleType, date, notes, splitShift, isTraining } = b
    const startTime = hms(b.startTime), endTime = hms(b.endTime)
    if (!caregiverId || !clientId || !startTime || !endTime) return fail(c, 400, 'Missing required fields')
    const timesError = shiftTimesError(startTime, endTime, b.overnight)
    if (timesError) return fail(c, 400, timesError)

    const asked = await frequencyFromRequest(d, companyId, b)
    if ('error' in asked) return fail(c, 400, asked.error, asked.code)
    const frequency = asked.frequency
    const dayOfWeek = b.dayOfWeek === '' || b.dayOfWeek === null || b.dayOfWeek === undefined ? null : Number(b.dayOfWeek)
    const isRecurring = dayOfWeek !== null
    if (isRecurring && !(Number.isInteger(dayOfWeek) && dayOfWeek! >= 0 && dayOfWeek! <= 6)) return fail(c, 400, 'dayOfWeek must be 0 (Sunday) to 6 (Saturday).')
    if (!isRecurring && !(date && DATE_RE.test(date))) return fail(c, 400, 'A one-time shift needs its date (YYYY-MM-DD).')

    // A recurring pattern's effective date is never in the past (it would back-bill / back-pay); a past start date is
    // pulled forward to today and the response says so.
    const today = await core.time.today(companyId)
    let effectiveDate: string | null = b.effectiveDate || null
    let effectiveDateClamped = false
    if (isRecurring) {
      if (effectiveDate && effectiveDate < today) effectiveDateClamped = true
      effectiveDate = (effectiveDate && effectiveDate >= today) ? effectiveDate : today
    }
    // Bi-weekly: the anchor sits on the row's own weekday (see core/biweekly.ts).
    let anchorDate: string | null = b.anchorDate || null
    if (isRecurring && (frequency || 'weekly') !== 'weekly') {
      anchorDate = alignRepeatAnchor({ frequency, anchorDate: b.anchorDate, effectiveDate, dayOfWeek })
    }

    let totalHours = shiftHours(startTime, endTime)
    if (splitShift?.startTime && splitShift?.endTime) totalHours += shiftHours(splitShift.startTime, splitShift.endTime)
    const authCheck = isTraining ? { warnings: [] as string[] } : await shared.checkAuthorizationBalance(companyId, clientId, totalHours)
    const base = isRecurring ? effectiveDate! : date

    // A recurring pattern may end on a day (the create forms' "End Date"; the template's forms showed it and never
    // sent it). The occurrence engine stops at it (data/homecareCore.ts). Not before the pattern starts.
    const endDate: string | null = isRecurring && b.endDate ? String(b.endDate) : null
    if (endDate && !DATE_RE.test(endDate)) return fail(c, 400, 'endDate must be a date (YYYY-MM-DD).')
    if (endDate && endDate < effectiveDate!) return fail(c, 400, 'The end date is before the schedule starts.')

    const insert = (start: string, end: string, split?: { group: string; segment: number }) => insertSchedule(db, companyId, {
      caregiverId, clientId, scheduleType: scheduleType || (isRecurring ? 'recurring' : 'one-time'), dayOfWeek,
      date: isRecurring ? null : date, startTs: schedTs(start, base), endTs: schedTs(end, base), notes: notes || null,
      frequency: frequency || 'weekly', effectiveDate, anchorDate, split: split ?? null, isTraining: !!isTraining, endDate,
    })

    // An expired credential: refused when the agency blocks it, otherwise a flag on the reply (empty without care_cert_reminders).
    const refused = (await core.certReminders.blockedFor(companyId, [String(caregiverId)], base))[String(caregiverId)]
    if (refused?.length) return fail(c, 409, `This caregiver has an expired credential (${refused.join(', ')}) and cannot be put on a shift until it is renewed.`, 'credential_expired')
    const credentialWarnings = (await core.certReminders.expiredFor(companyId, [String(caregiverId)], base))[String(caregiverId)] || []

    // A one-time shift overlapping one the caregiver already has that day.
    const oneTimeConflict = async (start: string, end: string) => !isRecurring && await oneTimeOverlap(db, companyId, caregiverId, date, start, end)

    try {
      if (splitShift) {
        const s2 = hms(splitShift.startTime), e2 = hms(splitShift.endTime)
        if (!s2 || !e2) return fail(c, 400, 'Split shift requires startTime and endTime')
        if (s2 <= endTime) return fail(c, 400, 'Split shift segment 2 must start after segment 1 ends')
        if (e2 <= s2) return fail(c, 400, 'Split shift segment 2 must end after it starts')
        if (await oneTimeConflict(startTime, endTime)) return fail(c, 400, 'Caregiver has a conflicting schedule during segment 1')
        if (await oneTimeConflict(s2, e2)) return fail(c, 400, 'Caregiver has a conflicting schedule during segment 2')
        const group = createId()
        const id1 = await insert(startTime, endTime, { group, segment: 1 })
        const id2 = await insert(s2, e2, { group, segment: 2 })
        const segments = [await core.schedules.scheduleById(companyId, id1), await core.schedules.scheduleById(companyId, id2)]
        await core.notify.recordAudit(companyId, me, 'CREATE', 'schedules', id1, null, { splitShift: true, segments })
        return one(c, { splitShift: true, segments, effectiveDateClamped, effectiveDate, anchorDate, authWarnings: authCheck.warnings, credentialWarnings }, 201)
      }

      // One-time duplicate guard: a double-submit returns the existing row, not a billable twin.
      if (!isRecurring) {
        const existing = await oneTimeTwin(db, companyId, { caregiverId, clientId, date, start: startTime, end: endTime })
        if (existing) return one(c, { ...existing, duplicate: true, effectiveDateClamped, effectiveDate, authWarnings: authCheck.warnings, credentialWarnings }, 200)
      }
      const id = await insert(startTime, endTime)
      const row = await core.schedules.scheduleById(companyId, id)
      await core.notify.recordAudit(companyId, me, 'CREATE', 'schedules', id, null, row)
      return one(c, { ...row, effectiveDateClamped, effectiveDate, anchorDate, authWarnings: authCheck.warnings, credentialWarnings }, 201)
    } catch (e: any) {
      if (isDup(e)) return fail(c, 409, 'This caregiver already has this exact shift (same client, day, and time).', 'duplicate')
      throw e
    }
  })

  return app
}
