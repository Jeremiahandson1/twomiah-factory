// Home care's scheduling and open-shift SQL (docs/UNIFIED_HOMECARE_PLAN.md, step 3, the `scheduling` group). Moved from
// templates/crm-homecare/backend/src/routes/{schedules,schedulesAll,schedulesEnhanced,scheduleExceptions,schedulingHub,
// openShifts,shiftSwaps,noShow,forecast}.ts and helpers/authorizationCheck.ts, which ran these as raw SQL (RULEBOOK §2:
// raw SQL lives here). One named function per query; every one is scoped to the company (`companyId` comes after the
// executor) and returns camelCase. `users` is `"user"`, and a caregiver is `role IN ('caregiver', 'field')`: a moved
// tenant's caregivers keep the stored `caregiver`, a new tenant's are `field` (verticals/homecare/settings.ts).
import { sql, type SQL } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, camelFirst, rowsOf } from '@twomiah/tenant-backend'
import { SCHED_COLS, EXC_COLS, inList, occurrencesCte, authUnitsToHoursSql, type Q, agencyClock } from './homecareCore.ts'
import { billedInRangeSql, invoiceServiceDateSql } from './homecareBilling.ts'

/** A caregiver's stored role: the template's `caregiver` or the unified `field`. */
const IS_CAREGIVER = (alias = 'u'): SQL => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`bad alias: ${alias}`)
  return sql.raw(`${alias}.role IN ('caregiver', 'field')`)
}

// ══ Schedules (routes/schedules.ts, schedulesAll.ts, schedulesEnhanced.ts) ══════════════════════════════════════

/** Recurring patterns that have ended (end_date before today) are history, not "my schedule". */
const notEnded = (today: string) => sql`(s.day_of_week IS NULL OR s.end_date IS NULL OR s.end_date >= ${today}::date)`

/**
 * A caregiver's active patterns, ended ones left out. `detail` adds the client's address and care type (the phone's
 * list); without it, the client's name only (the Schedule Hub's list).
 */
export async function caregiverPatterns(q: Q, companyId: string, caregiverId: string, today: string, detail: boolean): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ${SCHED_COLS()}, c.first_name AS client_first_name, c.last_name AS client_last_name
           ${detail ? sql`, c.address AS client_address, c.city AS client_city, ct.name AS care_type_name` : sql``}
      FROM schedules s
      JOIN clients c ON s.client_id = c.id AND c.company_id = ${companyId}
      ${detail ? sql`LEFT JOIN care_types ct ON c.care_type_id = ct.id AND ct.company_id = ${companyId}` : sql``}
     WHERE s.company_id = ${companyId} AND s.caregiver_id = ${caregiverId} AND s.is_active = true AND ${notEnded(today)}
     ORDER BY s.day_of_week, s.date, s.start_time`))
}

/** Days moved ONTO this caregiver from someone else's pattern, from today on, as one-time shifts. */
export async function movedInShifts(q: Q, companyId: string, caregiverId: string, today: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT s.id, s.schedule_type, s.notes, COALESCE(s.is_training, false) AS is_training,
           to_char(se.exception_date, 'YYYY-MM-DD') AS date,
           NULL::int AS day_of_week,
           to_char(COALESCE(se.override_start_time, s.start_time::time), 'HH24:MI:SS') AS start_time,
           to_char(COALESCE(se.override_end_time, s.end_time::time), 'HH24:MI:SS') AS end_time,
           ${caregiverId}::text AS caregiver_id,
           COALESCE(se.override_client_id, s.client_id) AS client_id,
           c.first_name AS client_first_name, c.last_name AS client_last_name,
           c.address AS client_address, c.city AS client_city, ct.name AS care_type_name,
           TRUE AS moved_in
      FROM schedule_exceptions se
      JOIN schedules s ON s.id = se.schedule_id AND s.company_id = ${companyId}
      JOIN clients c ON c.id = COALESCE(se.override_client_id, s.client_id) AND c.company_id = ${companyId}
      LEFT JOIN care_types ct ON c.care_type_id = ct.id AND ct.company_id = ${companyId}
     WHERE se.company_id = ${companyId}
       AND se.override_caregiver_id = ${caregiverId}
       AND s.caregiver_id <> ${caregiverId}
       AND se.exception_type = 'modified'
       AND s.is_active = true
       AND se.exception_date >= ${today}::date
     ORDER BY se.exception_date`))
}

/** A caregiver's dated visits between two days, through the schedule engine. */
export async function caregiverOccurrences(q: Q, companyId: string, caregiverId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, from, to)}
    SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS date,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           occ.minutes, occ.is_modified, occ.is_training, occ.client_id,
           (occ.pattern_caregiver_id IS DISTINCT FROM occ.caregiver_id) AS moved_in,
           s.day_of_week IS NOT NULL AS is_recurring, s.notes,
           c.first_name AS client_first_name, c.last_name AS client_last_name,
           c.address AS client_address, c.city AS client_city, c.latitude AS client_latitude, c.longitude AS client_longitude
      FROM occ JOIN schedules s ON s.id = occ.schedule_id JOIN clients c ON c.id = occ.client_id AND c.company_id = ${companyId}
     WHERE occ.caregiver_id = ${caregiverId}
     ORDER BY occ.occ_date, occ.start_time`))
}

/** A one-time visit with exactly these caregiver, client, date and times (the double-submit guard), or null. */
export async function oneTimeTwin(q: Q, companyId: string, v: { caregiverId: string; clientId: string; date: string; start: string; end: string }): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT ${SCHED_COLS()} FROM schedules s
     WHERE s.company_id = ${companyId} AND s.is_active = true AND s.day_of_week IS NULL
       AND s.caregiver_id = ${v.caregiverId} AND s.client_id = ${v.clientId} AND s.date = ${v.date}::date
       AND s.start_time::time = ${v.start}::time AND s.end_time::time = ${v.end}::time
     LIMIT 1`)) ?? null
}

/** Does this caregiver already have a one-time visit that day overlapping [start, end)? (POST /schedules-enhanced) */
export async function oneTimeOverlap(q: Q, companyId: string, caregiverId: string, date: string, start: string, end: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`
    SELECT id FROM schedules WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND is_active = true AND date = ${date}::date
       AND NOT (end_time::time <= ${start}::time OR start_time::time >= ${end}::time) LIMIT 1`)).length > 0
}

export interface NewSchedule {
  caregiverId: string
  clientId: string
  scheduleType: string
  dayOfWeek: number | null
  date: string | null
  /** 'YYYY-MM-DD HH:MM:SS' (core/scheduleOccurrences.ts schedTs). */
  startTs: string | null
  endTs: string | null
  notes?: string | null
  effectiveDate?: string | null
  anchorDate?: string | null
  frequency?: string
  isTraining?: boolean
  split?: { group: string; segment: number } | null
}

/** Write one schedule row (active), in the company. Returns its id. */
export async function insertSchedule(q: Q, companyId: string, v: NewSchedule & { endDate?: string | null; repeatGroupId?: string | null }): Promise<string> {
  const id = createId()
  await q.execute(sql`
    INSERT INTO schedules (id, company_id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes,
                           frequency, effective_date, anchor_date, is_split_shift, split_shift_group_id, split_segment,
                           is_training, end_date, repeat_group_id, is_active, status, created_at, updated_at)
    VALUES (${id}, ${companyId}, ${v.caregiverId}, ${v.clientId}, ${v.scheduleType}, ${v.dayOfWeek}, ${v.date}::date,
            ${v.startTs}::timestamp, ${v.endTs}::timestamp, ${v.notes ?? null}, ${v.frequency || 'weekly'},
            ${v.effectiveDate ?? null}::date, ${v.anchorDate ?? null}::date, ${!!v.split}, ${v.split?.group ?? null},
            ${v.split?.segment ?? null}, ${!!v.isTraining}, ${v.endDate ?? null}::date, ${v.repeatGroupId ?? null}, true, 'active', NOW(), NOW())`)
  return id
}

/** An active caregiver of the company (first and last name), or null. */
export async function activeCaregiver(q: Q, companyId: string, id: string): Promise<{ id: string; firstName: string; lastName: string } | null> {
  return camelFirst(await q.execute(sql`SELECT u.id, u.first_name, u.last_name FROM "user" u
    WHERE u.id = ${id} AND u.company_id = ${companyId} AND ${IS_CAREGIVER()} AND u.is_active = true`)) ?? null
}

/** Another of this caregiver's active rows on that date overlapping [start, end)? (the reassign check) */
export async function dateOverlap(q: Q, companyId: string, caregiverId: string, excludeId: string, date: string, start: string, end: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`
    SELECT id FROM schedules
     WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND is_active = true AND id <> ${excludeId} AND date = ${date}::date
       AND NOT (end_time::time <= ${start}::time OR start_time::time >= ${end}::time) LIMIT 1`)).length > 0
}

/** Hand the whole row to another caregiver. */
export async function setScheduleCaregiver(q: Q, companyId: string, id: string, caregiverId: string): Promise<void> {
  await q.execute(sql`UPDATE schedules SET caregiver_id = ${caregiverId}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
}

/** Hand an ACTIVE row to another caregiver; its id, or null when it is no longer active. (shift swap approve) */
export async function setActiveScheduleCaregiver(q: Q, companyId: string, id: string, caregiverId: string): Promise<string | null> {
  return rowsOf(await q.execute(sql`UPDATE schedules SET caregiver_id = ${caregiverId}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId} AND is_active = true RETURNING id`))[0]?.id ?? null
}

/** Cancel one occurrence (a 'cancelled' exception), keeping an earlier reason when none is given. */
export async function cancelOccurrence(q: Q, companyId: string, scheduleId: string, date: string, actor: string, cancelReason: string | null): Promise<void> {
  await q.execute(sql`
    INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, created_by, cancel_reason, created_at)
    VALUES (${createId()}, ${companyId}, ${scheduleId}, ${date}::date, 'cancelled', ${actor}, ${cancelReason}, NOW())
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
      exception_type = 'cancelled',
      cancel_reason = COALESCE(EXCLUDED.cancel_reason, schedule_exceptions.cancel_reason)`)
}

/** End an active pattern on `endDate`. */
export async function endActivePattern(q: Q, companyId: string, id: string, endDate: string, repeatGroupId?: string | null): Promise<void> {
  await q.execute(sql`UPDATE schedules SET end_date = ${endDate}::date, updated_at = NOW() WHERE company_id = ${companyId} AND is_active = true
    AND ${repeatGroupId ? sql`repeat_group_id = ${repeatGroupId}` : sql`id = ${id}`}`)
}

/** Which rows a delete means: one row, the active halves of a split shift, or every weekday of a repeating shift made on several. */
export type ScheduleTarget = { id: string } | { splitGroup: string } | { repeatGroup: string }
const targetSql = (t: ScheduleTarget): SQL => ('splitGroup' in t ? sql`split_shift_group_id = ${t.splitGroup} AND is_active = true`
  : 'repeatGroup' in t ? sql`repeat_group_id = ${t.repeatGroup} AND is_active = true` : sql`id = ${t.id}`)

/** Take rows off the schedule (is_active false). Returns their ids. */
export async function deactivateSchedules(q: Q, companyId: string, t: ScheduleTarget): Promise<string[]> {
  return rowsOf(await q.execute(sql`UPDATE schedules SET is_active = false, updated_at = NOW() WHERE company_id = ${companyId} AND ${targetSql(t)} RETURNING id`)).map((r) => r.id)
}

/** End rows on `endDate`. Returns their ids. */
export async function endSchedules(q: Q, companyId: string, t: ScheduleTarget, endDate: string): Promise<string[]> {
  return rowsOf(await q.execute(sql`UPDATE schedules SET end_date = ${endDate}::date, updated_at = NOW() WHERE company_id = ${companyId} AND ${targetSql(t)} RETURNING id`)).map((r) => r.id)
}

/** An active row's client, or null. */
export async function activeScheduleClient(q: Q, companyId: string, id: string): Promise<{ id: string; clientId: string } | null> {
  return camelFirst(await q.execute(sql`SELECT id, client_id FROM schedules WHERE id = ${id} AND company_id = ${companyId} AND is_active = true`)) ?? null
}

/** Every active row of a client. */
export async function activeScheduleIdsForClient(q: Q, companyId: string, clientId: string): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT id FROM schedules WHERE company_id = ${companyId} AND client_id = ${clientId} AND is_active = true`)).map((r) => r.id)
}

/** Suspend service from `fromDate` (scope: these rows, or every active row of a client). Returns the ids. */
export async function suspendSchedules(q: Q, companyId: string, scope: { ids: string[] } | { clientId: string }, fromDate: string): Promise<string[]> {
  if ('ids' in scope && !scope.ids.length) return []
  const which = 'ids' in scope ? sql`id IN (${inList(scope.ids)})` : sql`client_id = ${scope.clientId}`
  return rowsOf(await q.execute(sql`UPDATE schedules SET suspended_from = ${fromDate}::date, updated_at = NOW()
    WHERE company_id = ${companyId} AND ${which} AND is_active = true RETURNING id`)).map((r) => r.id)
}

/** Resume suspended service (the same scopes). Returns the ids. */
export async function resumeSchedules(q: Q, companyId: string, scope: { ids: string[] } | { clientId: string }): Promise<string[]> {
  if ('ids' in scope && !scope.ids.length) return []
  const which = 'ids' in scope ? sql`id IN (${inList(scope.ids)})` : sql`client_id = ${scope.clientId}`
  return rowsOf(await q.execute(sql`UPDATE schedules SET suspended_from = NULL, updated_at = NOW()
    WHERE company_id = ${companyId} AND ${which} AND is_active = true AND suspended_from IS NOT NULL RETURNING id`)).map((r) => r.id)
}

/** Every active schedule with caregiver and client names (GET /schedules-all); `caregiverId` keeps one caregiver's. */
export async function allActiveSchedules(q: Q, companyId: string, caregiverId: string | null = null): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ${SCHED_COLS()},
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           cl.first_name AS client_first_name, cl.last_name AS client_last_name
      FROM schedules s
      JOIN "user" u ON s.caregiver_id = u.id AND u.company_id = ${companyId}
      JOIN clients cl ON s.client_id = cl.id AND cl.company_id = ${companyId}
     WHERE s.company_id = ${companyId} AND s.is_active = true ${caregiverId ? sql`AND s.caregiver_id = ${caregiverId}` : sql``}
     ORDER BY s.day_of_week, s.date, s.start_time`))
}

/** Edit Shift, in place: the columns PUT /schedules-all/:id rewrites on the row itself. */
export async function editScheduleInPlace(q: Q, companyId: string, id: string, v: {
  clientId: string | null; caregiverId: string | null; dayOfWeek: number | null; date: string | null
  startTs: string | null; endTs: string | null; notes: string | null; frequency: string | null
  effectiveDate: string | null; anchorDate: string | null; endDate?: string | null; isTraining?: boolean
}): Promise<void> {
  await q.execute(sql`
    UPDATE schedules SET
      client_id = COALESCE(${v.clientId}, client_id),
      caregiver_id = COALESCE(${v.caregiverId}, caregiver_id),
      day_of_week = ${v.dayOfWeek},
      date = ${v.date}::date,
      start_time = ${v.startTs}::timestamp,
      end_time = ${v.endTs}::timestamp,
      notes = ${v.notes},
      frequency = COALESCE(${v.frequency}, frequency),
      effective_date = COALESCE(${v.effectiveDate}::date, effective_date),
      anchor_date = COALESCE(${v.anchorDate}::date, anchor_date),
      ${v.endDate !== undefined ? sql`end_date = ${v.endDate}::date,` : sql``}
      ${v.isTraining !== undefined ? sql`is_training = ${v.isTraining},` : sql``}
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId} AND is_active = true`)
}

/** Override ONE date of a pattern ('modified'), merging with an earlier override of that date. Returns the exception. */
export async function mergeModifiedException(q: Q, companyId: string, v: {
  scheduleId: string; date: string; start: string | null; end: string | null; clientId: string | null
  caregiverId: string | null; notes: string | null; actor: string
}): Promise<any> {
  return camelFirst(await q.execute(sql`
    INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, override_start_time, override_end_time,
                                     override_client_id, override_caregiver_id, override_notes, created_by, created_at)
    VALUES (${createId()}, ${companyId}, ${v.scheduleId}, ${v.date}::date, 'modified', ${v.start}::time, ${v.end}::time,
            ${v.clientId}, ${v.caregiverId}, ${v.notes}, ${v.actor}, NOW())
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
      exception_type = 'modified',
      override_start_time   = COALESCE(EXCLUDED.override_start_time,   schedule_exceptions.override_start_time),
      override_end_time     = COALESCE(EXCLUDED.override_end_time,     schedule_exceptions.override_end_time),
      override_client_id    = COALESCE(EXCLUDED.override_client_id,    schedule_exceptions.override_client_id),
      override_caregiver_id = COALESCE(EXCLUDED.override_caregiver_id, schedule_exceptions.override_caregiver_id),
      override_notes        = COALESCE(EXCLUDED.override_notes,        schedule_exceptions.override_notes)
    RETURNING id, schedule_id, to_char(exception_date, 'YYYY-MM-DD') AS exception_date, exception_type,
              to_char(override_start_time, 'HH24:MI:SS') AS override_start_time,
              to_char(override_end_time, 'HH24:MI:SS') AS override_end_time,
              override_client_id, override_caregiver_id, override_notes`))
}

/**
 * Edit Shift, scope=following: in one transaction the old pattern ends the day before `fromDate` and a new one carries
 * the edits (every other column copied from the old row). Returns nothing; the caller reads the new row by `newId`.
 */
export async function splitPatternFrom(db: any, companyId: string, id: string, v: {
  newId: string; fromDate: string; endBefore: string; clientId: string | null; caregiverId: string | null
  startTs: string | null; endTs: string | null; frequency: string | null; anchorDate: string | null; dayOfWeek: number | null
  notes: string | null | undefined; endDate: string | null; isTraining: boolean | undefined
}): Promise<void> {
  await db.transaction(async (tx: any) => {
    // 1) Freeze history: the old pattern stops the day before the change.
    await tx.execute(sql`UPDATE schedules SET end_date = ${v.endBefore}::date, updated_at = NOW()
                         WHERE id = ${id} AND company_id = ${companyId} AND is_active = true`)
    // 2) A new pattern carrying the edits.
    await tx.execute(sql`
      INSERT INTO schedules (id, company_id, client_id, caregiver_id, title, start_time, end_time, frequency, effective_date, anchor_date,
                             schedule_type, is_active, day_of_week, date, status, notes, care_type_id, end_date,
                             is_split_shift, split_shift_group_id, split_segment, is_training, suspended_from, created_at, updated_at)
      SELECT ${v.newId}, company_id, COALESCE(${v.clientId}, client_id), COALESCE(${v.caregiverId}, caregiver_id), title,
             ${v.startTs}::timestamp, ${v.endTs}::timestamp,
             COALESCE(${v.frequency}, frequency), ${v.fromDate}::date, COALESCE(${v.anchorDate}::date, anchor_date),
             schedule_type, true, ${v.dayOfWeek}, NULL, status,
             ${v.notes === undefined ? sql`notes` : sql`${v.notes}`}, care_type_id,
             ${v.endDate}::date, is_split_shift, split_shift_group_id, split_segment,
             ${v.isTraining === undefined ? sql`is_training` : sql`${v.isTraining}`}, suspended_from, NOW(), NOW()
        FROM schedules WHERE id = ${id} AND company_id = ${companyId}`)
  })
}

// ══ Schedule exceptions (routes/scheduleExceptions.ts) ══════════════════════════════════════════════════════════

/** The company's exceptions, optionally of one schedule and between two dates (at most 1000). */
export async function listExceptions(q: Q, companyId: string, f: { scheduleId?: string; from?: string; to?: string }): Promise<any[]> {
  const conds = [sql`se.company_id = ${companyId}`]
  if (f.scheduleId) conds.push(sql`se.schedule_id = ${f.scheduleId}`)
  if (f.from) conds.push(sql`se.exception_date >= ${f.from}::date`)
  if (f.to) conds.push(sql`se.exception_date <= ${f.to}::date`)
  return camelRows(await q.execute(sql`SELECT ${EXC_COLS} FROM schedule_exceptions se WHERE ${sql.join(conds, sql` AND `)} ORDER BY se.exception_date LIMIT 1000`))
}

/** Is this one of the company's ACTIVE schedules? */
export async function activeScheduleExists(q: Q, companyId: string, id: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`SELECT id FROM schedules WHERE id = ${id} AND company_id = ${companyId} AND is_active = true`)).length > 0
}

/** Create or REPLACE the exception for one occurrence. Returns its id. */
export async function replaceException(q: Q, companyId: string, v: {
  scheduleId: string; date: string; type: string; start: string | null; end: string | null; caregiverId: string | null
  clientId: string | null; notes: string | null; actor: string; cancelReason: string | null
}): Promise<string> {
  return rowsOf(await q.execute(sql`
    INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, override_start_time, override_end_time,
                                     override_caregiver_id, override_client_id, override_notes, created_by, cancel_reason, created_at)
    VALUES (${createId()}, ${companyId}, ${v.scheduleId}, ${v.date}::date, ${v.type}, ${v.start}::time, ${v.end}::time,
            ${v.caregiverId}, ${v.clientId}, ${v.notes}, ${v.actor}, ${v.cancelReason}, NOW())
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
      exception_type = EXCLUDED.exception_type,
      override_start_time = EXCLUDED.override_start_time,
      override_end_time = EXCLUDED.override_end_time,
      override_caregiver_id = EXCLUDED.override_caregiver_id,
      override_client_id = EXCLUDED.override_client_id,
      override_notes = EXCLUDED.override_notes,
      cancel_reason = EXCLUDED.cancel_reason
    RETURNING id`))[0].id
}

/** One of the company's exceptions in the API shape, or null. */
export async function exceptionById(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${EXC_COLS} FROM schedule_exceptions se WHERE se.id = ${id} AND se.company_id = ${companyId}`)) ?? null
}

/** Remove one of the company's exceptions (the original occurrence comes back). */
export async function deleteException(q: Q, companyId: string, id: string): Promise<void> {
  await q.execute(sql`DELETE FROM schedule_exceptions WHERE id = ${id} AND company_id = ${companyId}`)
}

// ══ The Schedule Hub (routes/schedulingHub.ts) ═══════════════════════════════════════════════════════════════════

/** Scheduled hours per caregiver over [from, to], through the engine. */
export async function hoursByCaregiver(q: Q, companyId: string, from: string, to: string): Promise<Record<string, number>> {
  const r = rowsOf(await q.execute(sql`WITH ${occurrencesCte(companyId, from, to)} SELECT caregiver_id, SUM(hours) AS h FROM occ GROUP BY caregiver_id`))
  return Object.fromEntries(r.map((x) => [x.caregiver_id, Number(x.h) || 0]))
}

/** A caregiver's weekly cap (caregiver_availability), 40 when none is set. */
export async function maxHoursOf(q: Q, companyId: string, caregiverId: string): Promise<number> {
  return Number(rowsOf(await q.execute(sql`SELECT max_hours_per_week FROM caregiver_availability WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId}`))[0]?.max_hours_per_week) || 40
}

/** The company's active caregivers (all, or just `only`), by first name. */
export async function activeCaregivers(q: Q, companyId: string, only: string | null): Promise<{ id: string; firstName: string; lastName: string }[]> {
  return camelRows(await q.execute(sql`SELECT u.id, u.first_name, u.last_name FROM "user" u
    WHERE u.company_id = ${companyId} AND ${IS_CAREGIVER()} AND u.is_active = true ${only ? sql`AND u.id = ${only}` : sql``} ORDER BY u.first_name`))
}

/** The ids of the company's active caregivers. */
export async function activeCaregiverIds(q: Q, companyId: string): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT u.id FROM "user" u WHERE u.company_id = ${companyId} AND ${IS_CAREGIVER()} AND u.is_active = true`)).map((r) => r.id)
}

/** Every occurrence of a week (one caregiver's, or all), for the week view. */
export async function weekOccurrences(q: Q, companyId: string, ws: string, we: string, only: string | null): Promise<any[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, ws, we)}
    SELECT occ.schedule_id AS id, occ.caregiver_id, occ.client_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS occ_date,
           EXTRACT(DOW FROM occ.occ_date)::int AS dow,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           occ.minutes, occ.is_modified, occ.is_training, s.day_of_week, to_char(s.date, 'YYYY-MM-DD') AS date, s.notes, s.frequency,
           cl.first_name AS client_first_name, cl.last_name AS client_last_name
      FROM occ JOIN schedules s ON s.id = occ.schedule_id LEFT JOIN clients cl ON cl.id = occ.client_id AND cl.company_id = ${companyId}
     ${only ? sql`WHERE occ.caregiver_id = ${only}` : sql``}
     ORDER BY occ.start_time`))
}

/** Every occurrence of a range as (caregiver, client, hours). */
export async function occurrenceHours(q: Q, companyId: string, from: string, to: string): Promise<{ caregiverId: string; clientId: string; hours: number }[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, from, to)} SELECT caregiver_id, client_id, hours FROM occ`))
}

/** Active caregivers with their weekly cap and availability status (coverage overview). */
export async function caregiverCapacity(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT u.id, u.first_name, u.last_name, COALESCE(ca.max_hours_per_week, 40) AS max_hours,
      COALESCE(ca.status, 'available') AS availability_status
    FROM "user" u LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id AND ca.company_id = ${companyId}
    WHERE u.company_id = ${companyId} AND ${IS_CAREGIVER()} AND u.is_active = true ORDER BY u.first_name, u.last_name`))
}

/** Active clients with their weekly authorized units. */
export async function activeClientUnits(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT id, first_name, last_name, weekly_authorized_units FROM clients
    WHERE company_id = ${companyId} AND is_active = true ORDER BY first_name, last_name`))
}

/** Hours per caregiver per day of a week, every active caregiver × every day. */
export async function conflictHeatmapRows(q: Q, companyId: string, ws: string, we: string): Promise<any[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, ws, we)},
      days AS (SELECT generate_series(${ws}::date, ${we}::date, '1 day'::interval)::date AS d),
      cgs AS (SELECT u.id, u.first_name, u.last_name, COALESCE(ca.max_hours_per_week, 40) AS max_hours_per_week
                FROM "user" u LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id AND ca.company_id = ${companyId}
               WHERE u.company_id = ${companyId} AND ${IS_CAREGIVER()} AND u.is_active = true),
      sh AS (SELECT caregiver_id, occ_date AS d, ROUND(SUM(hours)::numeric, 2) AS hours, COUNT(*) AS shift_count FROM occ GROUP BY caregiver_id, occ_date)
    SELECT cgs.id, cgs.first_name, cgs.last_name, cgs.max_hours_per_week, to_char(days.d, 'YYYY-MM-DD') AS day,
           COALESCE(sh.hours, 0) AS hours, COALESCE(sh.shift_count, 0) AS shift_count
      FROM cgs CROSS JOIN days LEFT JOIN sh ON sh.caregiver_id = cgs.id AND sh.d = days.d
     ORDER BY cgs.last_name, cgs.first_name, days.d`))
}

/** A caregiver's visits on `date` overlapping [start, end) (POST /check-conflicts). */
export async function caregiverOverlaps(q: Q, companyId: string, caregiverId: string, date: string, start: string, end: string): Promise<any[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT occ.schedule_id AS id, s.day_of_week, to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           cl.first_name, cl.last_name
      FROM occ JOIN schedules s ON s.id = occ.schedule_id LEFT JOIN clients cl ON cl.id = occ.client_id AND cl.company_id = ${companyId}
     WHERE occ.caregiver_id = ${caregiverId} AND (occ.start_time, occ.end_time) OVERLAPS (${start}::time, ${end}::time)`))
}

/** Does this caregiver have a visit on `date` overlapping [start, end)? `notCancelledPattern` skips a pattern whose status is 'cancelled' (the claim check). */
export async function hasOverlap(q: Q, companyId: string, caregiverId: string, date: string, start: string, end: string, notCancelledPattern = false): Promise<boolean> {
  return rowsOf(await q.execute(sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT occ.schedule_id FROM occ JOIN schedules s ON s.id = occ.schedule_id
     WHERE occ.caregiver_id = ${caregiverId} AND (occ.start_time, occ.end_time) OVERLAPS (${start}::time, ${end}::time)
       ${notCancelledPattern ? sql`AND COALESCE(s.status, '') <> 'cancelled'` : sql``}
     LIMIT 1`)).length > 0
}

/** The caregivers busy on `date` during [start, end). */
export async function busyCaregiverIds(q: Q, companyId: string, date: string, start: string, end: string): Promise<string[]> {
  return rowsOf(await q.execute(sql`WITH ${occurrencesCte(companyId, date, date)} SELECT DISTINCT caregiver_id FROM occ
    WHERE (start_time, end_time) OVERLAPS (${start}::time, ${end}::time)`)).map((r) => r.caregiver_id)
}

/** A person's first and last name (anyone in the company), or null. */
export async function personName(q: Q, companyId: string, id: string): Promise<{ firstName: string; lastName: string } | null> {
  return camelFirst(await q.execute(sql`SELECT first_name, last_name FROM "user" WHERE id = ${id} AND company_id = ${companyId}`)) ?? null
}

/** A person's phone (anyone in the company), or null. */
export async function personPhone(q: Q, companyId: string, id: string): Promise<string | null> {
  return rowsOf(await q.execute(sql`SELECT phone FROM "user" WHERE id = ${id} AND company_id = ${companyId}`))[0]?.phone ?? null
}

/** A client's first and last name, or null. */
export async function clientName(q: Q, companyId: string, id: string): Promise<{ firstName: string; lastName: string } | null> {
  return camelFirst(await q.execute(sql`SELECT first_name, last_name FROM clients WHERE id = ${id} AND company_id = ${companyId}`)) ?? null
}

/** A client's position, or null. */
export async function clientPosition(q: Q, companyId: string, id: string): Promise<{ latitude: string | null; longitude: string | null } | null> {
  return camelFirst(await q.execute(sql`SELECT latitude, longitude FROM clients WHERE id = ${id} AND company_id = ${companyId}`)) ?? null
}

/** A caregiver's other clients' visits that day, with where they are (POST /check-travel-time). */
export async function dayVisitsElsewhere(q: Q, companyId: string, caregiverId: string, clientId: string, date: string): Promise<any[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           cl.first_name, cl.last_name, cl.latitude, cl.longitude
      FROM occ JOIN clients cl ON cl.id = occ.client_id AND cl.company_id = ${companyId}
     WHERE occ.caregiver_id = ${caregiverId} AND occ.client_id <> ${clientId} ORDER BY occ.start_time`))
}

/** A caregiver's one-time and recurring hours over a range. */
export async function caregiverHoursSplit(q: Q, companyId: string, caregiverId: string, from: string, to: string): Promise<{ oneTime: number; recurring: number }> {
  const r = rowsOf(await q.execute(sql`WITH ${occurrencesCte(companyId, from, to)}
    SELECT SUM(CASE WHEN s.day_of_week IS NULL THEN occ.hours ELSE 0 END) AS one_time, SUM(CASE WHEN s.day_of_week IS NOT NULL THEN occ.hours ELSE 0 END) AS recurring
      FROM occ JOIN schedules s ON s.id = occ.schedule_id WHERE occ.caregiver_id = ${caregiverId}`))[0]
  return { oneTime: Number(r?.one_time) || 0, recurring: Number(r?.recurring) || 0 }
}

/** The client a suggestion is for: care type, position, preferred and do-not-use caregivers. */
export async function clientForSuggestions(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT c.id, c.first_name, c.last_name, c.care_type_id, c.latitude, c.longitude,
      c.preferred_caregivers, c.do_not_use_caregivers, c.required_skills, c.preferred_caregiver_gender, c.preferred_language,
      ct.name AS care_type_name
    FROM clients c LEFT JOIN care_types ct ON c.care_type_id = ct.id AND ct.company_id = ${companyId}
    WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}

const DAY_COLS = new Set(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])

/** Every active caregiver with what the ranking reads: pay, position, availability that weekday, time off that date. */
export async function caregiversForSuggestions(q: Q, companyId: string, dayCol: string | null, date: string | null): Promise<any[]> {
  if (dayCol && !DAY_COLS.has(dayCol)) throw new Error(`bad day: ${dayCol}`)
  return camelRows(await q.execute(sql`SELECT u.id, u.first_name, u.last_name, u.phone, u.default_pay_rate, u.latitude, u.longitude,
      cp.capabilities, cp.gender, cp.languages,
      ca.status AS availability_status, ca.max_hours_per_week,
      ${dayCol ? sql.raw(`ca.${dayCol}_available`) : sql`NULL::boolean`} AS day_available,
      ${dayCol ? sql.raw(`to_char(ca.${dayCol}_start_time, 'HH24:MI')`) : sql`NULL::text`} AS day_start_time,
      ${dayCol ? sql.raw(`to_char(ca.${dayCol}_end_time, 'HH24:MI')`) : sql`NULL::text`} AS day_end_time,
      EXISTS (SELECT 1 FROM caregiver_time_off t WHERE t.company_id = ${companyId} AND t.caregiver_id = u.id AND ${date}::date IS NOT NULL
               AND (t.status = 'approved' OR t.type = 'blackout') AND t.start_date <= ${date}::date AND t.end_date >= ${date}::date) AS is_blacked_out
    FROM "user" u LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id AND ca.company_id = ${companyId}
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id AND cp.company_id = ${companyId}
    WHERE u.company_id = ${companyId} AND ${IS_CAREGIVER()} AND u.is_active = true ORDER BY u.first_name`))
}

/** Completed visits per caregiver for one client. */
export async function visitCountsForClient(q: Q, companyId: string, clientId: string): Promise<Record<string, number>> {
  const r = rowsOf(await q.execute(sql`SELECT caregiver_id, COUNT(*) AS n FROM time_entries
    WHERE company_id = ${companyId} AND client_id = ${clientId} AND is_complete = true GROUP BY caregiver_id`))
  return Object.fromEntries(r.map((x) => [x.caregiver_id, Number(x.n)]))
}

/** Completed visits per client per caregiver: { clientId: { caregiverId: n } }. */
export async function visitCountsByClient(q: Q, companyId: string): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {}
  for (const r of rowsOf(await q.execute(sql`SELECT caregiver_id, client_id, COUNT(*) AS n FROM time_entries
      WHERE company_id = ${companyId} AND is_complete = true GROUP BY caregiver_id, client_id`))) {
    (out[r.client_id] ||= {})[r.caregiver_id] = Number(r.n)
  }
  return out
}

/** Open shifts with a start time between two dates, most urgent first (auto-fill). */
export async function openShiftsToFill(q: Q, companyId: string, start: string, end: string): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT os.id, os.client_id, os.schedule_id, to_char(os.date, 'YYYY-MM-DD') AS shift_date,
      to_char(os.start_time, 'HH24:MI:SS') AS start_time, to_char(os.end_time, 'HH24:MI:SS') AS end_time, os.notes,
      cl.first_name AS client_first, cl.last_name AS client_last, cl.latitude AS client_lat, cl.longitude AS client_lng
    FROM open_shifts os JOIN clients cl ON os.client_id = cl.id AND cl.company_id = ${companyId}
    WHERE os.company_id = ${companyId} AND os.status = 'open' AND os.date >= ${start}::date AND os.date <= ${end}::date AND os.start_time IS NOT NULL
    ORDER BY CASE os.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, os.date, os.start_time`))
}

// ══ Authorization advice (helpers/authorizationCheck.ts) ═════════════════════════════════════════════════════════

/** The client's active authorization covering today (the one ending soonest), with its balance and health, or null. */
export async function currentAuthorization(q: Q, companyId: string, clientId: string): Promise<any | null> {
  const { today } = await agencyClock(q, companyId) // the agency's day (CURRENT_DATE was the database's, UTC)
  return camelFirst(await q.execute(sql`
    SELECT a.*, to_char(a.end_date, 'YYYY-MM-DD') AS end_ymd,
      (a.authorized_units - a.used_units) AS remaining_units,
      ROUND((a.used_units / NULLIF(a.authorized_units, 0)) * 100, 1) AS pct_used,
      CASE
        WHEN a.end_date < ${today}::date THEN 'expired'
        WHEN a.authorized_units - a.used_units <= a.low_units_alert_threshold THEN 'low'
        WHEN a.end_date <= ${today}::date + 30 THEN 'expiring_soon'
        ELSE 'ok'
      END AS health_status
    FROM authorizations a
    WHERE a.company_id = ${companyId} AND a.client_id = ${clientId} AND a.status = 'active'
      AND a.start_date <= ${today}::date AND a.end_date >= ${today}::date
    ORDER BY a.end_date ASC
    LIMIT 1`)) ?? null
}

// ══ Open shifts (routes/openShifts.ts) ════════════════════════════════════════════════════════════════════════════

/** An open shift as the screens read it (shift_date, claimed_by, approved_by: the CVHC spellings kept beside the others). */
const OS_COLS = sql.raw(`
  os.id, os.client_id, os.schedule_id, to_char(os.date, 'YYYY-MM-DD') AS shift_date, to_char(os.date, 'YYYY-MM-DD') AS date,
  to_char(os.start_time, 'HH24:MI:SS') AS start_time, to_char(os.end_time, 'HH24:MI:SS') AS end_time,
  os.status, os.notes, os.urgency, os.care_type_id, os.hourly_rate, COALESCE(os.bonus_amount, 0) AS bonus_amount,
  os.source_absence_id, os.notified_caregiver_count, os.auto_created, os.broadcast_sent,
  os.visible_to, os.auto_assign,
  os.claimed_by_id, os.claimed_by_id AS claimed_by, os.claimed_at,
  os.approved_by_id, os.approved_by_id AS approved_by, os.approved_at,
  os.created_by_id, os.created_by_id AS created_by, os.created_at, os.updated_at`)

/** One of the company's open shifts (only an OPEN one when `openOnly`), or null. */
export async function openShiftById(q: Q, companyId: string, id: string, openOnly = false): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${OS_COLS} FROM open_shifts os WHERE os.id = ${id} AND os.company_id = ${companyId}
    ${openOnly ? sql`AND os.status = 'open'` : sql``}`)) ?? null
}

/** An open shift with its client's name (notify), or null. */
export async function openShiftWithClient(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${OS_COLS}, cl.first_name AS client_first, cl.last_name AS client_last
    FROM open_shifts os LEFT JOIN clients cl ON os.client_id = cl.id AND cl.company_id = ${companyId}
    WHERE os.id = ${id} AND os.company_id = ${companyId}`)) ?? null
}

/** Who could take a slot: each active caregiver, busy (an overlapping visit, `excludeScheduleId` aside) and on time off. */
export async function caregiversForSlot(q: Q, companyId: string, date: string, start: string, end: string, excludeScheduleId: string | null): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, date, date)}
    SELECT u.id, u.first_name, u.last_name, u.phone, u.email,
      EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = u.id
               AND (occ.start_time, occ.end_time) OVERLAPS (${start}::time, ${end}::time)
               AND occ.schedule_id IS DISTINCT FROM ${excludeScheduleId}) AS has_conflict,
      EXISTS (SELECT 1 FROM caregiver_time_off t WHERE t.company_id = ${companyId} AND t.caregiver_id = u.id
               AND (t.status = 'approved' OR t.type = 'blackout')
               AND ${date}::date BETWEEN t.start_date AND t.end_date) AS time_off
    FROM "user" u
    WHERE u.company_id = ${companyId} AND ${IS_CAREGIVER()} AND u.is_active = true
    ORDER BY u.first_name, u.last_name`))
}

/** Open shifts from today on that this person may see: offered to everyone or to them (the office: all). */
export async function availableOpenShifts(q: Q, companyId: string, today: string, userId: string, office: boolean): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ${OS_COLS}, cl.first_name AS client_first_name, cl.last_name AS client_last_name
      FROM open_shifts os LEFT JOIN clients cl ON os.client_id = cl.id AND cl.company_id = ${companyId}
     WHERE os.company_id = ${companyId} AND os.status = 'open' AND os.date >= ${today}::date
       AND (os.visible_to IS NULL OR ${userId} = ANY(os.visible_to) OR ${office})
     ORDER BY os.date, os.start_time`))
}

/** The office's board. status: undefined → open; 'active' → open + claimed; 'all'; or one status. At most 500. */
export async function openShiftBoard(q: Q, companyId: string, f: { status?: string; startDate?: string; endDate?: string; urgency?: string }): Promise<any[]> {
  const conds = [sql`os.company_id = ${companyId}`]
  if (f.status === 'active') conds.push(sql`os.status IN ('open', 'claimed')`)
  else if (f.status === 'all') { /* no filter */ }
  else if (f.status) conds.push(sql`os.status = ${f.status}`)
  else conds.push(sql`os.status = 'open'`)
  if (f.startDate) conds.push(sql`os.date >= ${f.startDate}::date`)
  if (f.endDate) conds.push(sql`os.date <= ${f.endDate}::date`)
  if (f.urgency) conds.push(sql`os.urgency = ${f.urgency}`)
  return camelRows(await q.execute(sql`
    SELECT ${OS_COLS},
      cl.first_name AS client_first_name, cl.last_name AS client_last_name,
      cl.address AS client_address, cl.city AS client_city,
      ct.name AS care_type_name,
      u.first_name AS claimed_by_first, u.last_name AS claimed_by_last,
      (SELECT string_agg(v.first_name || ' ' || v.last_name, ', ' ORDER BY v.first_name)
         FROM "user" v WHERE v.id = ANY(os.visible_to) AND v.company_id = ${companyId}) AS offered_to
    FROM open_shifts os
    LEFT JOIN clients cl ON os.client_id = cl.id AND cl.company_id = ${companyId}
    LEFT JOIN care_types ct ON os.care_type_id = ct.id AND ct.company_id = ${companyId}
    LEFT JOIN "user" u ON os.claimed_by_id = u.id AND u.company_id = ${companyId}
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY CASE os.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, os.date ASC, os.start_time ASC
    LIMIT 500`))
}

/** Post an open shift. Returns its id. */
export async function insertOpenShift(q: Q, companyId: string, v: {
  clientId: string | null; scheduleId: string | null; date: string; start: string; end: string; careTypeId?: string | null
  hourlyRate: number | string | null; bonusAmount: number; notes: string | null; urgency: string; createdById: string
  visibleTo?: string[] | null; autoAssign?: boolean
}): Promise<string> {
  const id = createId()
  await q.execute(sql`
    INSERT INTO open_shifts (id, company_id, client_id, schedule_id, date, start_time, end_time, care_type_id, hourly_rate, bonus_amount,
                             notes, urgency, status, created_by_id, visible_to, auto_assign, created_at, updated_at)
    VALUES (${id}, ${companyId}, ${v.clientId}, ${v.scheduleId}, ${v.date}::date, ${v.start}::time, ${v.end}::time,
            ${v.careTypeId ?? null}, ${v.hourlyRate}, ${v.bonusAmount}, ${v.notes}, ${v.urgency}, 'open', ${v.createdById},
            ${v.visibleTo?.length ? sql`ARRAY[${sql.join(v.visibleTo.map((x) => sql`${x}`), sql`, `)}]::text[]` : sql`NULL`},
            ${!!v.autoAssign}, NOW(), NOW())`)
  return id
}

/** A schedule row about to be posted: its client, its own date, the client's payer. */
export async function scheduleForPosting(q: Q, companyId: string, id: string): Promise<{ id: string; clientId: string; date: string | null; referredById: string | null } | null> {
  return camelFirst(await q.execute(sql`SELECT s.id, s.client_id, to_char(s.date, 'YYYY-MM-DD') AS date, cl.referred_by_id
    FROM schedules s JOIN clients cl ON s.client_id = cl.id AND cl.company_id = ${companyId} WHERE s.id = ${id} AND s.company_id = ${companyId}`)) ?? null
}

/** The engine's times and owner of a schedule's visit on `day`, or null when there is none that day. */
export async function occurrenceOn(q: Q, companyId: string, scheduleId: string, day: string): Promise<{ caregiverId: string; clientId: string; startTime: string; endTime: string } | null> {
  return camelFirst(await q.execute(sql`WITH ${occurrencesCte(companyId, day, day)}
    SELECT occ.caregiver_id, occ.client_id, to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time
      FROM occ WHERE occ.schedule_id = ${scheduleId}`)) ?? null
}

/** The schedule's next visit date within [from, to], or null. */
export async function nextOccurrenceDate(q: Q, companyId: string, scheduleId: string, from: string, to: string): Promise<string | null> {
  return rowsOf(await q.execute(sql`WITH ${occurrencesCte(companyId, from, to)}
    SELECT to_char(occ.occ_date, 'YYYY-MM-DD') AS d FROM occ WHERE occ.schedule_id = ${scheduleId}
    ORDER BY occ.occ_date ASC LIMIT 1`))[0]?.d ?? null
}

/** A live (open or claimed) posting of this schedule's visit on `day`, or null. */
export async function livePostingFor(q: Q, companyId: string, scheduleId: string, day: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${OS_COLS} FROM open_shifts os WHERE os.company_id = ${companyId} AND os.schedule_id = ${scheduleId}
    AND os.date = ${day}::date AND os.status IN ('open', 'claimed')`)) ?? null
}

/** The payer's current rate, or null when none is on file. */
export async function payerCurrentRate(q: Q, companyId: string, referralSourceId: string): Promise<string | null> {
  return rowsOf(await q.execute(sql`SELECT rate_amount FROM referral_source_rates
    WHERE company_id = ${companyId} AND referral_source_id = ${referralSourceId} AND is_active = true
    ORDER BY effective_date DESC NULLS LAST LIMIT 1`))[0]?.rate_amount ?? null
}

/** First tap wins: claim an OPEN shift. true when this caller got it. */
export async function claimOpenShift(q: Q, companyId: string, id: string, caregiverId: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`UPDATE open_shifts SET status = 'claimed', claimed_by_id = ${caregiverId}, claimed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId} AND status = 'open' RETURNING id`)).length > 0
}

/** Record a caregiver's claim (pending). */
export async function insertClaim(q: Q, companyId: string, openShiftId: string, caregiverId: string, notes: string | null): Promise<void> {
  await q.execute(sql`INSERT INTO open_shift_claims (id, company_id, open_shift_id, caregiver_id, notes, status, created_at)
    VALUES (${createId()}, ${companyId}, ${openShiftId}, ${caregiverId}, ${notes}, 'pending', NOW())`)
}

/** Mark a shift filled and approved (the approver may be nobody: a first-to-accept fill with no poster). */
export async function markFilled(q: Q, companyId: string, id: string, approverId: string | null, claimedBy?: string): Promise<void> {
  await q.execute(sql`UPDATE open_shifts SET status = 'filled',
      ${claimedBy ? sql`claimed_by_id = ${claimedBy}, claimed_at = NOW(),` : sql``}
      approved_by_id = ${approverId}, approved_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId}`)
}

/** Approve this caregiver's claims on a shift. */
export async function approveClaims(q: Q, companyId: string, openShiftId: string, caregiverId: string): Promise<void> {
  await q.execute(sql`UPDATE open_shift_claims SET status = 'approved' WHERE company_id = ${companyId} AND open_shift_id = ${openShiftId} AND caregiver_id = ${caregiverId}`)
}

/** Turn the claim down: the shift reopens and its pending claims are rejected with the reason. */
export async function reopenShift(q: Q, companyId: string, id: string, reason: string | null): Promise<void> {
  await q.execute(sql`UPDATE open_shifts SET status = 'open', claimed_by_id = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
  await q.execute(sql`UPDATE open_shift_claims SET status = 'rejected', notes = ${reason} WHERE company_id = ${companyId} AND open_shift_id = ${id} AND status = 'pending'`)
}

/** Take a posting down (only an open or claimed one). true when it was. */
export async function cancelPosting(q: Q, companyId: string, id: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`UPDATE open_shifts SET status = 'cancelled', updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId} AND status IN ('open', 'claimed') RETURNING id`)).length > 0
}

/** Every active caregiver for a posting: busy at its time (its own schedule aside), already told about it. */
export async function eligibleForShift(q: Q, companyId: string, s: { id: string; shiftDate: string; startTime: string; endTime: string; scheduleId: string | null }): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, s.shiftDate, s.shiftDate)}
    SELECT u.id, u.first_name, u.last_name, u.phone, u.email,
      EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = u.id
               AND (occ.start_time, occ.end_time) OVERLAPS (${s.startTime}::time, ${s.endTime}::time)
               AND occ.schedule_id IS DISTINCT FROM ${s.scheduleId}) AS has_conflict,
      EXISTS (SELECT 1 FROM open_shift_notifications n WHERE n.company_id = ${companyId} AND n.open_shift_id = ${s.id} AND n.caregiver_id = u.id) AS already_notified
    FROM "user" u WHERE u.company_id = ${companyId} AND ${IS_CAREGIVER()} AND u.is_active = true
    ORDER BY u.first_name, u.last_name`))
}

/** Note that a caregiver was told about a posting (once per caregiver). */
export async function recordShiftNotice(q: Q, companyId: string, openShiftId: string, caregiverId: string): Promise<void> {
  await q.execute(sql`INSERT INTO open_shift_notifications (id, company_id, open_shift_id, caregiver_id, notification_type, notified_at)
    VALUES (${createId()}, ${companyId}, ${openShiftId}, ${caregiverId}, 'in_app', NOW()) ON CONFLICT (open_shift_id, caregiver_id) DO NOTHING`)
}

/** Mark a posting broadcast and count who has been told. */
export async function markNotified(q: Q, companyId: string, id: string): Promise<void> {
  await q.execute(sql`UPDATE open_shifts SET broadcast_sent = true,
    notified_caregiver_count = (SELECT COUNT(*) FROM open_shift_notifications WHERE company_id = ${companyId} AND open_shift_id = ${id}), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId}`)
}

/** Who accepted a posting. */
export async function claimsForShift(q: Q, companyId: string, openShiftId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT osc.id, osc.open_shift_id, osc.caregiver_id, osc.notes, osc.status, osc.created_at,
           u.first_name, u.last_name, u.phone
      FROM open_shift_claims osc JOIN "user" u ON osc.caregiver_id = u.id AND u.company_id = ${companyId}
     WHERE osc.company_id = ${companyId} AND osc.open_shift_id = ${openShiftId}
     ORDER BY osc.created_at`))
}

// ── Filling a visit (assignShift) ───────────────────────────────────────────────────────────

/** A schedule's weekday (null: one-time), or undefined when there is no such schedule. */
export async function scheduleDayOfWeek(q: Q, companyId: string, id: string): Promise<{ dayOfWeek: number | null } | null> {
  return camelFirst(await q.execute(sql`SELECT day_of_week FROM schedules WHERE id = ${id} AND company_id = ${companyId}`)) ?? null
}

/** The exception on one date of a schedule, or null. */
export async function exceptionOn(q: Q, companyId: string, scheduleId: string, day: string): Promise<{ id: string; exceptionType: string; cancelReason: string | null } | null> {
  return camelFirst(await q.execute(sql`SELECT id, exception_type, cancel_reason FROM schedule_exceptions
    WHERE company_id = ${companyId} AND schedule_id = ${scheduleId} AND exception_date = ${day}::date`)) ?? null
}

/** A call-out's cancelled day comes back as a 'modified' day on the new caregiver. */
export async function calloutToCover(q: Q, companyId: string, exceptionId: string, caregiverId: string): Promise<void> {
  await q.execute(sql`UPDATE schedule_exceptions SET exception_type = 'modified', override_caregiver_id = ${caregiverId}, cancel_reason = NULL
    WHERE id = ${exceptionId} AND company_id = ${companyId}`)
}

/**
 * Put one date of a pattern on another caregiver ('modified'). `keepCancelled`: a cancelled date stays cancelled (the
 * open-shift fill); otherwise the date becomes 'modified' whatever it was (an approved swap).
 */
export async function coverDate(q: Q, companyId: string, scheduleId: string, day: string, caregiverId: string, actor: string, keepCancelled: boolean): Promise<void> {
  await q.execute(sql`
    INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, override_caregiver_id, created_by, created_at)
    VALUES (${createId()}, ${companyId}, ${scheduleId}, ${day}::date, 'modified', ${caregiverId}, ${actor}, NOW())
    ON CONFLICT (schedule_id, exception_date)
    ${keepCancelled
      ? sql`DO UPDATE SET override_caregiver_id = EXCLUDED.override_caregiver_id WHERE schedule_exceptions.exception_type <> 'cancelled'`
      : sql`DO UPDATE SET exception_type = 'modified', override_caregiver_id = EXCLUDED.override_caregiver_id`}`)
}

/** A one-time row goes to the new caregiver and back to active. */
export async function reassignOneTime(q: Q, companyId: string, scheduleId: string, caregiverId: string): Promise<void> {
  await q.execute(sql`UPDATE schedules SET caregiver_id = ${caregiverId}, status = 'active', updated_at = NOW() WHERE id = ${scheduleId} AND company_id = ${companyId}`)
}

// ══ Shift swaps (routes/shiftSwaps.ts) ═══════════════════════════════════════════════════════════════════════════

const SWAP_COLS = sql.raw(`
  ss.id, ss.schedule_id, ss.requester_id, ss.requester_id AS requesting_caregiver_id, ss.target_id, ss.target_id AS target_caregiver_id,
  COALESCE(ss.client_id, s.client_id) AS client_id, to_char(ss.shift_date, 'YYYY-MM-DD') AS shift_date,
  to_char(COALESCE(ss.start_time, s.start_time::time), 'HH24:MI:SS') AS start_time,
  to_char(COALESCE(ss.end_time, s.end_time::time), 'HH24:MI:SS') AS end_time,
  ss.reason, ss.status, ss.notes, ss.responded_at, ss.reviewed_by_id, ss.reviewed_by_id AS admin_approved_by,
  ss.reviewed_at, ss.reviewed_at AS admin_approved_at, ss.created_at, ss.created_at AS requested_at`)

/** One of the company's swaps, or null. */
export async function swapById(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${SWAP_COLS} FROM shift_swaps ss LEFT JOIN schedules s ON s.id = ss.schedule_id AND s.company_id = ${companyId}
    WHERE ss.id = ${id} AND ss.company_id = ${companyId}`)) ?? null
}

/** The company's swaps, newest first; `status` and `who` (requester or target) narrow them. */
export async function listSwaps(q: Q, companyId: string, f: { status?: string; who?: string | null }): Promise<any[]> {
  const conds = [sql`ss.company_id = ${companyId}`]
  if (f.status) conds.push(sql`ss.status = ${f.status}`)
  if (f.who) conds.push(sql`(ss.requester_id = ${f.who} OR ss.target_id = ${f.who})`)
  return camelRows(await q.execute(sql`
    SELECT ${SWAP_COLS},
      cl.first_name AS client_first, cl.last_name AS client_last,
      cl.first_name AS client_first_name, cl.last_name AS client_last_name,
      u1.first_name AS requester_first, u1.last_name AS requester_last,
      u1.first_name AS requester_first_name, u1.last_name AS requester_last_name,
      u2.first_name AS target_first, u2.last_name AS target_last,
      u2.first_name AS target_first_name, u2.last_name AS target_last_name
    FROM shift_swaps ss
    LEFT JOIN schedules s ON ss.schedule_id = s.id AND s.company_id = ${companyId}
    LEFT JOIN clients cl ON cl.id = COALESCE(ss.client_id, s.client_id) AND cl.company_id = ${companyId}
    JOIN "user" u1 ON ss.requester_id = u1.id
    LEFT JOIN "user" u2 ON ss.target_id = u2.id
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY ss.created_at DESC`))
}

/** An active schedule's date, weekday and times (a swap request), or null. */
export async function activeScheduleBasics(q: Q, companyId: string, id: string): Promise<{ id: string; clientId: string; date: string | null; dayOfWeek: number | null } | null> {
  return camelFirst(await q.execute(sql`SELECT id, client_id, to_char(date, 'YYYY-MM-DD') AS date, day_of_week
    FROM schedules WHERE id = ${id} AND company_id = ${companyId} AND is_active = true`)) ?? null
}

/** A swap waiting for an answer (pending, or accepted and waiting on the office) for this visit day, or null. */
export async function openSwapFor(q: Q, companyId: string, scheduleId: string, day: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${SWAP_COLS} FROM shift_swaps ss LEFT JOIN schedules s ON s.id = ss.schedule_id AND s.company_id = ${companyId}
    WHERE ss.company_id = ${companyId} AND ss.schedule_id = ${scheduleId} AND ss.shift_date = ${day}::date AND ss.status IN ('pending', 'accepted') LIMIT 1`)) ?? null
}

/** Ask for a swap. Returns its id. */
export async function insertSwap(q: Q, companyId: string, v: {
  scheduleId: string; requesterId: string; targetId: string | null; clientId: string; date: string; start: string; end: string; reason: string | null
}): Promise<string> {
  const id = createId()
  await q.execute(sql`INSERT INTO shift_swaps (id, company_id, schedule_id, requester_id, target_id, client_id, shift_date, start_time, end_time, reason, status, created_at)
    VALUES (${id}, ${companyId}, ${v.scheduleId}, ${v.requesterId}, ${v.targetId}, ${v.clientId}, ${v.date}::date, ${v.start}::time, ${v.end}::time,
            ${v.reason}, 'pending', NOW())`)
  return id
}

/** The target caregiver's answer. */
export async function answerSwap(q: Q, companyId: string, id: string, accepted: boolean, notes: string | null): Promise<void> {
  await q.execute(sql`UPDATE shift_swaps SET status = ${accepted ? 'accepted' : 'rejected'}, responded_at = NOW(), notes = ${notes} WHERE id = ${id} AND company_id = ${companyId}`)
}

/** A schedule's owner, whether it is active, and its weekday (approving a swap). */
export async function scheduleOwner(q: Q, companyId: string, id: string): Promise<{ id: string; caregiverId: string | null; isActive: boolean; dayOfWeek: number | null } | null> {
  return camelFirst(await q.execute(sql`SELECT id, caregiver_id, is_active, day_of_week FROM schedules WHERE id = ${id} AND company_id = ${companyId}`)) ?? null
}

/** The office's decision on a swap (approved / rejected). */
export async function reviewSwap(q: Q, companyId: string, id: string, status: 'approved' | 'rejected', reviewer: string, notes?: string | null): Promise<void> {
  await q.execute(sql`UPDATE shift_swaps SET status = ${status}, ${notes !== undefined ? sql`notes = ${notes},` : sql``}
    reviewed_by_id = ${reviewer}, reviewed_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
}

/** The requester withdraws a swap. */
export async function withdrawSwap(q: Q, companyId: string, id: string): Promise<void> {
  await q.execute(sql`UPDATE shift_swaps SET status = 'cancelled' WHERE id = ${id} AND company_id = ${companyId}`)
}

// ══ No-show monitoring (routes/noShow.ts) ═══════════════════════════════════════════════════════════════════════

/** The no-show counts the No-Show screen and the dashboard banner read; "today" is the agency's day. */
export async function noShowStats(q: Q, companyId: string, today: string): Promise<any> {
  const r = rowsOf(await q.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
      COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved_count,
      COUNT(*) FILTER (WHERE status = 'false_alarm')::int AS false_alarm_count,
      COUNT(*) FILTER (WHERE shift_date = (${today})::date)::int AS today_count,
      COUNT(*) FILTER (WHERE shift_date >= (${today})::date - 7)::int AS week_count
    FROM noshow_alerts WHERE company_id = ${companyId}`))[0] || {}
  return {
    total: r.total ?? 0, openCount: r.open_count ?? 0, resolvedCount: r.resolved_count ?? 0, falseAlarmCount: r.false_alarm_count ?? 0,
    todayCount: r.today_count ?? 0, weekCount: r.week_count ?? 0,
  }
}

// ══ Revenue forecast (routes/forecast.ts) ════════════════════════════════════════════════════════════════════════

/** CVHC's stated hourly figure, used only where no rate is on file (the screen says so). */
export const FALLBACK_HOURLY = 18.5

const payerRateLateral = (companyId: string, dateExpr: SQL) => sql`LEFT JOIN LATERAL (
    SELECT CASE WHEN r.rate_type = '15min' THEN r.rate_amount * 4 ELSE r.rate_amount END AS hourly
    FROM referral_source_rates r
    WHERE r.company_id = ${companyId} AND r.referral_source_id = c.referred_by_id AND r.care_type_id = c.care_type_id
      AND r.is_active = true
      AND (r.effective_date IS NULL OR r.effective_date <= ${dateExpr})
      AND (r.end_date IS NULL OR r.end_date >= ${dateExpr})
    ORDER BY r.effective_date DESC NULLS LAST LIMIT 1
  ) prate ON true`

/**
 * Actual billed revenue by month since `since`: claims dated by service date, and released invoices dated by their
 * first day of service and counted whole — the same rule as Reports. Voided and rejected claims are out, and a claim
 * made from an invoice is left out because the invoice already counts that money.
 */
export async function forecastActual(q: Q, companyId: string, since: string, today: string): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT period, SUM(billed) AS billed, SUM(collected) AS collected,
      SUM(claim_count)::int AS claim_count, SUM(invoice_count)::int AS invoice_count FROM (
      SELECT to_char(DATE_TRUNC('month', cl.service_date), 'YYYY-MM-DD') AS period,
        cl.billed_amount AS billed, COALESCE(cl.paid_amount, 0) AS collected, 1 AS claim_count, 0 AS invoice_count
      FROM claims cl
      WHERE cl.company_id = ${companyId} AND cl.service_date >= (${since})::date AND COALESCE(cl.status, '') NOT IN ('voided', 'rejected')
        AND cl.invoice_id IS NULL
      UNION ALL
      SELECT to_char(DATE_TRUNC('month', ${invoiceServiceDateSql()}), 'YYYY-MM-DD'),
        i.total, COALESCE(i.amount_paid, 0), 0, 1
      FROM invoices i WHERE i.company_id = ${companyId} AND ${billedInRangeSql(since, today)}
    ) u GROUP BY 1 ORDER BY 1`))
}

/** Weekly authorization vs schedule, per client (authorized units as weekly hours), valued at the client's real rate. */
export async function forecastAuthorizations(q: Q, companyId: string, today: string, weekEnd: string): Promise<any[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, today, weekEnd)},
    sched AS (SELECT client_id, SUM(hours) AS hrs FROM occ GROUP BY client_id),
    auths AS (
      SELECT client_id,
        SUM(${authUnitsToHoursSql('au', 'unit_type')}) AS weekly_hours,
        MAX(end_date) AS end_date
      FROM (SELECT client_id, COALESCE(authorized_units, 0) AS au, unit_type, end_date
              FROM authorizations WHERE company_id = ${companyId} AND status = 'active') a0
      GROUP BY client_id
    )
    SELECT c.id AS client_id, c.first_name || ' ' || c.last_name AS client_name,
      c.service_type,
      a.weekly_hours AS authorized_hours,
      COALESCE(s.hrs, 0) AS used_hours,
      GREATEST(a.weekly_hours - COALESCE(s.hrs, 0), 0) AS remaining_hours,
      CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END AS hourly_rate,
      GREATEST(a.weekly_hours - COALESCE(s.hrs, 0), 0)
        * COALESCE(CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END, 0) AS projected_remaining_revenue,
      to_char(a.end_date, 'YYYY-MM-DD') AS end_date
    FROM auths a
    JOIN clients c ON c.id = a.client_id AND c.company_id = ${companyId} AND c.is_active = true
    LEFT JOIN sched s ON s.client_id = c.id
    ${payerRateLateral(companyId, sql`(${today})::date`)}
    ORDER BY projected_remaining_revenue DESC, authorized_hours DESC`))
}

/** Scheduled hours and estimated revenue per week over [today, today+27]. */
export async function forecastWeekly(q: Q, companyId: string, today: string, end: string): Promise<any[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, today, end)}
    SELECT to_char(DATE_TRUNC('week', occ.occ_date), 'YYYY-MM-DD') AS week_start,
      COUNT(DISTINCT occ.caregiver_id)::int AS caregiver_count,
      COUNT(*)::int AS shift_count,
      SUM(occ.hours) AS scheduled_hours,
      SUM(occ.hours * COALESCE(CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END, ${FALLBACK_HOURLY})) AS estimated_revenue
    FROM occ
    JOIN clients c ON c.id = occ.client_id AND c.company_id = ${companyId}
    ${payerRateLateral(companyId, sql`occ.occ_date`)}
    GROUP BY 1 ORDER BY 1`))
}

/** Top ten clients by billed claims and released invoices since `since` (the same rule as forecastActual). */
export async function forecastTopClients(q: Q, companyId: string, since: string, today: string): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT u.client_id, c.first_name || ' ' || c.last_name AS client_name,
      SUM(u.billed) AS total_billed, SUM(u.collected) AS total_collected,
      SUM(u.is_claim)::int AS claim_count, SUM(1 - u.is_claim)::int AS invoice_count, AVG(u.billed) AS avg_claim
    FROM (
      SELECT cl.client_id, cl.billed_amount AS billed, COALESCE(cl.paid_amount, 0) AS collected, 1 AS is_claim FROM claims cl
      WHERE cl.company_id = ${companyId} AND cl.service_date >= (${since})::date AND COALESCE(cl.status, '') NOT IN ('voided', 'rejected')
        AND cl.invoice_id IS NULL
      UNION ALL
      SELECT i.client_id, i.total, COALESCE(i.amount_paid, 0), 0 FROM invoices i
      WHERE i.company_id = ${companyId} AND ${billedInRangeSql(since, today)}
    ) u JOIN clients c ON u.client_id = c.id AND c.company_id = ${companyId}
    GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`))
}

/** Each active caregiver's scheduled hours and estimated revenue over [today, today+6]. */
export async function caregiverUtilization(q: Q, companyId: string, today: string, end: string): Promise<any[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, today, end)}
    SELECT u.id, u.first_name || ' ' || u.last_name AS caregiver_name,
      COUNT(DISTINCT occ.client_id)::int AS client_count,
      COALESCE(SUM(occ.hours), 0) AS weekly_hours,
      COALESCE(SUM(occ.hours * COALESCE(CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END, ${FALLBACK_HOURLY})), 0) AS weekly_revenue
    FROM "user" u
    LEFT JOIN occ ON occ.caregiver_id = u.id
    LEFT JOIN clients c ON c.id = occ.client_id AND c.company_id = ${companyId}
    ${payerRateLateral(companyId, sql`occ.occ_date`)}
    WHERE u.company_id = ${companyId} AND ${IS_CAREGIVER()} AND u.is_active = true
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY weekly_hours DESC NULLS LAST`))
}
