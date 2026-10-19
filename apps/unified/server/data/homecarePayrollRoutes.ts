// Home care's payroll routes — the queries that need SQL of their own (the agency's calendar day, the schedule engine,
// a case-insensitive match). Moved from templates/crm-homecare/backend/src/routes/{payroll,payrollShiftReviews,gusto}.ts
// (raw SQL lives in server/data/, RULEBOOK §2). Every query is the company's (companyId first); every read returns
// camelCase. The routers are server/crm/homecare/payroll/*.ts.
import { and, asc, desc, eq, gte, isNotNull, lt, or, sql } from 'drizzle-orm'
import { camelRows, rowsOf } from '@twomiah/tenant-backend'
import { clients, timeEntries, user } from '../db/schema/index.ts'
import { dayEndUtc, dayStartUtc, localDate, occurrencesCte, type Q } from './homecareCore.ts'

/** A query builder: `db`, or a transaction handle. */
type B = { select: (...a: any[]) => any }

/**
 * Every scheduled visit of the company between `from` and `to` (inclusive) that has a caregiver, through the ONE schedule
 * engine (one-time and weekly / bi-weekly patterns, effective and end dates, cancelled and modified exceptions, suspended
 * service, overnight shifts). Ordered by date, then start.
 */
export async function caregiverVisitsInRange(q: Q, companyId: string, from: string, to: string): Promise<{
  scheduleId: string; shiftDate: string; caregiverId: string; clientId: string; startHhmm: string | null; endHhmm: string | null; minutes: number | null
}[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to)}
    SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS shift_date, occ.caregiver_id, occ.client_id,
           to_char(occ.start_time, 'HH24:MI') AS start_hhmm, to_char(occ.end_time, 'HH24:MI') AS end_hhmm, occ.minutes
      FROM occ
     WHERE occ.caregiver_id IS NOT NULL
     ORDER BY occ.occ_date, occ.start_time`))
}

/** The company's completed time entries whose start falls on a day between `from` and `to` on the AGENCY's calendar (`tz`). */
export async function completedEntriesOnAgencyDays(db: B, companyId: string, from: string, to: string, tz: string): Promise<{
  id: string; caregiverId: string; clientId: string; startTime: Date; endTime: Date | null
  durationMinutes: number | null; billableMinutes: number | null; localDate: string
}[]> {
  const day = localDate(sql`${timeEntries.startTime}`, tz)
  return db.select({
    id: timeEntries.id, caregiverId: timeEntries.caregiverId, clientId: timeEntries.clientId,
    startTime: timeEntries.startTime, endTime: timeEntries.endTime,
    durationMinutes: timeEntries.durationMinutes, billableMinutes: timeEntries.billableMinutes,
    localDate: sql<string>`to_char(${day}, 'YYYY-MM-DD')`,
  })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.companyId, companyId),
      eq(timeEntries.isComplete, true),
      sql`${day} BETWEEN ${from}::date AND ${to}::date`,
    ))
    .orderBy(asc(timeEntries.startTime))
}

/**
 * The company's completed punches with an allotted (scheduled) length whose start falls on a day between `from` and `to`
 * on the agency's calendar, with the caregiver's default pay rate and both names. Newest first.
 */
export async function allottedPunchesOnAgencyDays(db: B, companyId: string, from: string, to: string, tz: string): Promise<{
  id: string; startTime: Date; durationMinutes: number | null; allottedMinutes: number | null; billableMinutes: number | null
  caregiverFirstName: string | null; caregiverLastName: string | null; defaultPayRate: string | null
  clientFirstName: string | null; clientLastName: string | null
}[]> {
  return db.select({
    id: timeEntries.id,
    startTime: timeEntries.startTime,
    durationMinutes: timeEntries.durationMinutes,
    allottedMinutes: timeEntries.allottedMinutes,
    billableMinutes: timeEntries.billableMinutes,
    caregiverFirstName: user.firstName,
    caregiverLastName: user.lastName,
    defaultPayRate: user.defaultPayRate,
    clientFirstName: clients.firstName,
    clientLastName: clients.lastName,
  })
    .from(timeEntries)
    .leftJoin(user, eq(timeEntries.caregiverId, user.id))
    .leftJoin(clients, eq(timeEntries.clientId, clients.id))
    .where(and(
      eq(timeEntries.companyId, companyId),
      eq(timeEntries.isComplete, true),
      gte(timeEntries.startTime, dayStartUtc(from, tz)),
      lt(timeEntries.startTime, dayEndUtc(to, tz)),
      isNotNull(timeEntries.allottedMinutes),
    ))
    .orderBy(desc(timeEntries.startTime))
}

/**
 * Work in the period that is NOT in a Gusto export yet: the company's reviews still waiting for a decision (pending,
 * flagged, missing punch), and clocked entries on the agency's days (`tz`) that no review answers.
 */
export async function gustoExportWarnings(q: Q, companyId: string, from: string, to: string, tz: string): Promise<{ unresolvedReviews: number; clockEntriesWithoutReview: number }> {
  const [w] = rowsOf(await q.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM payroll_shift_reviews
        WHERE company_id = ${companyId}
          AND shift_date BETWEEN ${from}::date AND ${to}::date
          AND status IN ('pending', 'flagged', 'missing_punch')) AS unresolved_reviews,
      (SELECT COUNT(*)::int FROM time_entries te
        WHERE te.company_id = ${companyId}
          AND te.end_time IS NOT NULL
          AND te.start_time >= ${dayStartUtc(from, tz)}
          AND te.start_time < ${dayEndUtc(to, tz)}
          AND NOT EXISTS (SELECT 1 FROM payroll_shift_reviews p2 WHERE p2.company_id = ${companyId} AND p2.time_entry_id = te.id)) AS clock_entries_without_review`))
  return { unresolvedReviews: Number(w?.unresolved_reviews) || 0, clockEntriesWithoutReview: Number(w?.clock_entries_without_review) || 0 }
}

/** The company's person a Gusto employee is: the same email (any case), else the same first and last name (any case). */
export async function personByEmailOrName(db: B, companyId: string, email: string, firstName: string, lastName: string): Promise<{ id: string } | null> {
  const [u] = await db.select({ id: user.id }).from(user).where(and(
    eq(user.companyId, companyId),
    or(
      sql`LOWER(${user.email}) = LOWER(${email})`,
      and(sql`LOWER(${user.firstName}) = LOWER(${firstName})`, sql`LOWER(${user.lastName}) = LOWER(${lastName})`),
    ),
  )).limit(1)
  return u ?? null
}
