// /api/schedules-all — every active schedule with its per-date exceptions, and the scoped Edit Shift. Moved from
// templates/crm-homecare/backend/src/routes/schedulesAll.ts (ported there from the CVHC home care CRM).
//
// Permissions: the list is care-schedule:read; Edit Shift is care-schedule:update (the template's requireAdmin).
//
// Fixed in the move: the template answered the list to any signed-in person in full, so a caregiver could read every
// caregiver's shifts and clients. No caregiver screen reads it (it is the office's grid); a caregiver now gets their
// own shifts only (apps/unified/tests/homecare-scheduling.test.ts).
//
// Replies: the list is a list reply ({ data, pagination }) of camelCase rows; an edit answers the row with
// `_scope` (and `_exception`, `_endedPatternId`, `_effectiveFrom`, `_note`) as the template did.
import { Hono } from 'hono'
import { createId } from '@paralleldrive/cuid2'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { schedTs, hms, shiftTimesError, DATE_RE } from '../core/scheduleOccurrences.ts'
import { alignBiweeklyAnchor } from '../core/biweekly.ts'
import { addDays } from '../core/agencyTime.ts'
import { allActiveSchedules, editScheduleInPlace, mergeModifiedException, splitPatternFrom } from '../../../data/homecareScheduling.ts'
import { isCaregiver, who } from './shared.ts'

export function createSchedulesAllRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  // GET /api/schedules-all
  app.get('/', perm('care-schedule:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const rows = await core.schedules.attachExceptions(companyId, await allActiveSchedules(db, companyId, isCaregiver(d, user) ? me : null))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  // PUT /api/schedules-all/:id — Edit Shift.
  //
  // Editing a RECURRING shift used to rewrite history: the pattern is a single row and every past occurrence is
  // re-derived from it, so changing the time silently changed every week already worked. An edit must therefore say
  // WHICH occurrences it means:
  //   scope=this      — override that ONE date with a 'modified' exception (a past date is allowed: correcting what
  //                     really ran at payday is the workflow). Requires editDate.
  //   scope=following — the shift changed as of editDate: the old pattern ends the day before and a new one carries the
  //                     edits. Weeks before editDate keep the old row.
  //   scope=all       — rewrite the pattern in place, history included. Only when asked by name.
  // There is NO default for a recurring shift — a silent default is wrong for somebody. One-time shifts are a single
  // occurrence and are always edited in place.
  app.put('/:id', perm('care-schedule:update'), async (c) => {
    const { companyId, me: actor } = who(c)
    const scheduleId = c.req.param('id')
    const b = await c.req.json().catch(() => ({})) as any
    const { clientId, caregiverId, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate, anchorDate: rawAnchorDate, endDate, isTraining } = b
    const scope = String(b.scope || c.req.query('scope') || '').toLowerCase()
    const editDate: string | null = b.editDate || c.req.query('editDate') || null

    if ((startTime && !hms(startTime)) || (endTime && !hms(endTime))) return fail(c, 400, 'Times must be HH:MM.')
    if (startTime && endTime && hms(startTime) === hms(endTime)) return fail(c, 400, 'Start and end time cannot be the same')
    if (scope && !['this', 'following', 'all'].includes(scope)) return fail(c, 400, `Invalid scope '${scope}'. Use this | following | all.`)
    if (editDate && !DATE_RE.test(editDate)) return fail(c, 400, 'editDate must be YYYY-MM-DD.')

    const before = await core.schedules.scheduleById(companyId, scheduleId, true)
    if (!before) return fail(c, 404, 'Schedule not found')
    // The times the row ends up with (a field left out keeps its value) must pass the one rule.
    if (startTime || endTime) {
      const timesError = shiftTimesError(startTime || before.startTime, endTime || before.endTime, b.overnight)
      if (timesError) return fail(c, 400, timesError)
    }
    const isRecurring = before.dayOfWeek !== null && before.dayOfWeek !== undefined
    const today = await core.time.today(companyId)

    const resultingFrequency = frequency || before.frequency || 'weekly'
    const resultingDow = (dayOfWeek !== undefined && dayOfWeek !== null && dayOfWeek !== '') ? Number(dayOfWeek) : before.dayOfWeek
    const alignAnchor = (fromDate: string | null) => {
      if (resultingFrequency !== 'biweekly' || resultingDow === null || resultingDow === undefined) return rawAnchorDate || null
      return alignBiweeklyAnchor({
        anchorDate: rawAnchorDate || before.anchorDate, effectiveDate: fromDate, dayOfWeek: resultingDow,
        previous: { anchorDate: before.anchorDate, dayOfWeek: before.dayOfWeek },
      })
    }

    // In-place edit of this exact row (one-time shifts, and explicit scope=all). The times keep the row's own base
    // date; reassignment happens in the same statement, on the row actually written.
    const editInPlace = async () => {
      const newDow = dayOfWeek !== undefined && dayOfWeek !== '' ? (dayOfWeek === null ? null : Number(dayOfWeek)) : before.dayOfWeek
      const newDate = newDow === null || newDow === undefined ? (date || before.date) : null
      const base = newDate || effectiveDate || before.effectiveDate || today
      await editScheduleInPlace(db, companyId, scheduleId, {
        clientId: clientId || null, caregiverId: caregiverId || null, dayOfWeek: newDow ?? null, date: newDate,
        startTs: schedTs(startTime || before.startTime, base), endTs: schedTs(endTime || before.endTime, base),
        notes: notes === undefined ? before.notes : (notes || null), frequency: frequency || null,
        effectiveDate: effectiveDate || null, anchorDate: alignAnchor(effectiveDate || before.effectiveDate),
        ...(endDate !== undefined ? { endDate: endDate || null } : {}),
        ...(isTraining !== undefined ? { isTraining: !!isTraining } : {}),
      })
      return core.schedules.scheduleById(companyId, scheduleId)
    }

    try {
      if (!isRecurring) {
        const row = await editInPlace()
        await core.notify.recordAudit(companyId, actor, 'UPDATE', 'schedules', scheduleId, before, row)
        return one(c, { ...row, _scope: 'one-time' })
      }

      if (!scope) {
        return fail(c, 400, "This is a repeating shift, so the change needs a scope: 'this' (just that day), 'following' (that day onward), or 'all' (every occurrence, past included).", 'scope_required')
      }

      if (scope === 'all') {
        const row = await editInPlace()
        await core.notify.recordAudit(companyId, actor, 'UPDATE', 'schedules', scheduleId, before, row)
        return one(c, { ...row, _scope: 'all' })
      }

      if (scope === 'this') {
        if (!editDate) return fail(c, 400, "scope='this' requires editDate (the occurrence being changed).")
        const ex = await mergeModifiedException(db, companyId, {
          scheduleId, date: editDate, start: hms(startTime), end: hms(endTime), clientId: clientId || null,
          caregiverId: caregiverId || null, notes: notes || null, actor,
        })
        await core.notify.recordAudit(companyId, actor, 'UPDATE', 'schedules', scheduleId, before, { scope: 'this', editDate, exception: ex })
        return one(c, { ...before, _scope: 'this', _exception: ex })
      }

      // scope=following — fromDate may be in the past (an effective-dated correction).
      const fromDate = editDate || today
      if (before.effectiveDate && before.effectiveDate >= fromDate) {
        const row = await editInPlace()
        await core.notify.recordAudit(companyId, actor, 'UPDATE', 'schedules', scheduleId, before, row)
        return one(c, { ...row, _scope: 'following', _note: 'pattern had not started yet; edited in place' })
      }
      const newId = createId()
      await splitPatternFrom(db, companyId, scheduleId, {
        newId, fromDate, endBefore: addDays(fromDate, -1), clientId: clientId || null, caregiverId: caregiverId || null,
        startTs: schedTs(startTime || before.startTime, fromDate), endTs: schedTs(endTime || before.endTime, fromDate),
        frequency: frequency || null, anchorDate: alignAnchor(fromDate), dayOfWeek: resultingDow ?? null,
        notes: notes === undefined ? undefined : (notes || null), endDate: before.endDate ?? null,
        isTraining: isTraining === undefined ? undefined : !!isTraining,
      })
      const created = await core.schedules.scheduleById(companyId, newId)
      await core.notify.recordAudit(companyId, actor, 'UPDATE', 'schedules', scheduleId, before, { scope: 'following', endedOn: fromDate, replacedBy: newId, newPattern: created })
      return one(c, { ...created, _scope: 'following', _endedPatternId: scheduleId, _effectiveFrom: fromDate })
    } catch (e: any) {
      if (e?.code === '23505' || /unique|duplicate key/i.test(e?.message || '')) {
        return fail(c, 409, 'That change would duplicate an existing active recurring shift for this caregiver and client.')
      }
      throw e
    }
  })

  return app
}
