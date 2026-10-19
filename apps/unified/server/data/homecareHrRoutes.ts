// Home care — caregivers and hiring: the raw SQL the hr route group's routers use (server/crm/homecare/hr/). Moved from
// templates/crm-homecare/backend/src/routes/{applications,backgroundChecks,jobPostings,careersPublic,caregivers}.ts,
// which wrote these inline. Raw SQL lives here (RULEBOOK §2).
//
// Two kinds of export: fragments (an SQL expression the router puts into a Drizzle query, so the row keeps Drizzle's
// camelCase keys and types) and whole reads (returning camelCase). Every whole read is scoped to the company; a fragment
// is used inside a query the router has already scoped.
//
// Changes from the template: `users` is `"user"`; a caregiver is either stored role (`caregiver` on a moved tenant,
// `field` on a new one); every whole read takes the company.
import { sql, type SQL } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/** The two stored spellings of the caregiver seat (moved tenants keep `caregiver`; new ones are `field`). */
export const CAREGIVER_ROLES = ['caregiver', 'field']

// ── Fragments ────────────────────────────────────────────────────────────────────────────────

/** `col DESC NULLS LAST` (Postgres sorts NULLs first on DESC). */
export const descNullsLast = (col: unknown): SQL => sql`${col} DESC NULLS LAST`

/** A case-blind email match. */
export const emailIs = (col: unknown, email: string): SQL => sql`LOWER(${col}) = ${email}`

/** The office's interview note appended to what is there, dated (applications POST /:id/notes). Never overwrites. */
export const appendedNote = (col: unknown, note: string): SQL =>
  sql`COALESCE(${col}, '') || E'\n\n' || ${note} || ' - ' || CURRENT_DATE::text`

/** The status counts of the application queue (applications GET /stats/summary), one column each. */
export const applicationCounts = (status: unknown, createdAt: unknown) => ({
  total: sql<number>`COUNT(*)::int`,
  newCount: sql<number>`(COUNT(*) FILTER (WHERE ${status} = 'new'))::int`,
  reviewingCount: sql<number>`(COUNT(*) FILTER (WHERE ${status} = 'reviewing'))::int`,
  interviewedCount: sql<number>`(COUNT(*) FILTER (WHERE ${status} = 'interviewed'))::int`,
  offeredCount: sql<number>`(COUNT(*) FILTER (WHERE ${status} = 'offered'))::int`,
  hiredCount: sql<number>`(COUNT(*) FILTER (WHERE ${status} = 'hired'))::int`,
  rejectedCount: sql<number>`(COUNT(*) FILTER (WHERE ${status} = 'rejected'))::int`,
  last7Days: sql<number>`(COUNT(*) FILTER (WHERE ${createdAt} >= CURRENT_DATE - INTERVAL '7 days'))::int`,
  last30Days: sql<number>`(COUNT(*) FILTER (WHERE ${createdAt} >= CURRENT_DATE - INTERVAL '30 days'))::int`,
})

/**
 * How many result letters a background check has. Qualified by hand: Drizzle drops the table name from a column in a
 * single-table select. The letters are the check's (a child row reaches its company through the check).
 */
export const checkDocumentCount = sql<number>`(SELECT COUNT(*)::int FROM background_check_documents d WHERE d.background_check_id = "background_checks"."id")`

/** An expiration date set and within `days` days of today (the database's day, as the template). */
export const expiresWithin = (col: unknown, days: number): SQL =>
  sql`${col} IS NOT NULL AND ${col} <= CURRENT_DATE + ${days}::integer`

/** The template's older "expiring" list: within 30 days (an unset date never matches). */
export const expiresWithin30 = (col: unknown): SQL => sql`${col} <= CURRENT_DATE + 30`

/**
 * A posting's applications, counted live. Written out in full: in a single-table select Drizzle renders the posting's id
 * as a bare "id", which inside this subquery would be the application's.
 */
export const postingApplicationsLive = sql<number>`(SELECT COUNT(*)::int FROM applications a WHERE a.posting_id = "job_postings"."id")`

// ── Whole reads ──────────────────────────────────────────────────────────────────────────────

/**
 * Background-check compliance per active caregiver of the company: the check types passed (cleared, not expired),
 * failed (disqualifying) and pending. camelCase: passedChecks, failedChecks, pendingChecks.
 */
export async function backgroundCheckCompliance(q: Q, companyId: string): Promise<any[]> {
  const rows = await q.execute(sql`
    SELECT u.id, u.first_name, u.last_name,
      COALESCE(ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.status = 'completed' AND bc.result = 'clear' AND (bc.expiration_date IS NULL OR bc.expiration_date > CURRENT_DATE)), '{}') AS passed_checks,
      COALESCE(ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.result = 'disqualifying'), '{}') AS failed_checks,
      COALESCE(ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.status = 'pending' OR bc.status = 'in_progress'), '{}') AS pending_checks
    FROM "user" u
    LEFT JOIN background_checks bc ON bc.caregiver_id = u.id AND bc.company_id = ${companyId}
    WHERE u.company_id = ${companyId} AND u.role IN ('caregiver', 'field') AND u.is_active = true
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY u.last_name
  `)
  return camelRows(rows)
}

// ── A caregiver's overview (GET /api/caregivers/:id/summary) ────────────────────────────────────────────────

/**
 * A caregiver's finished visits (time entries clocked out): minutes this month and this week (from the agency's
 * midnight on `monthFrom` / `weekFrom`, instants), minutes ever, and how many visits that was.
 */
export async function caregiverVisitTotals(q: Q, companyId: string, caregiverId: string, monthFrom: Date, weekFrom: Date): Promise<{
  monthMinutes: number; weekMinutes: number; totalMinutes: number; visits: number
}> {
  const [r] = camelRows(await q.execute(sql`
    SELECT COALESCE(SUM(te.duration_minutes) FILTER (WHERE te.start_time >= ${monthFrom}), 0)::int AS month_minutes,
           COALESCE(SUM(te.duration_minutes) FILTER (WHERE te.start_time >= ${weekFrom}), 0)::int AS week_minutes,
           COALESCE(SUM(te.duration_minutes), 0)::int AS total_minutes,
           COUNT(*)::int AS visits
      FROM time_entries te
     WHERE te.company_id = ${companyId} AND te.caregiver_id = ${caregiverId} AND te.is_complete = true`))
  return { monthMinutes: Number(r?.monthMinutes) || 0, weekMinutes: Number(r?.weekMinutes) || 0, totalMinutes: Number(r?.totalMinutes) || 0, visits: Number(r?.visits) || 0 }
}

/** The clients a caregiver has finished visits with: visits, minutes, and the last visit's day on the agency's clock. */
export async function caregiverClientsServed(q: Q, companyId: string, caregiverId: string, tz: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.address, c.city,
           COUNT(*)::int AS shift_count,
           COALESCE(SUM(te.duration_minutes), 0)::int AS total_minutes,
           to_char(MAX(((te.start_time AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date), 'YYYY-MM-DD') AS last_visit
      FROM time_entries te
      JOIN clients c ON c.id = te.client_id AND c.company_id = ${companyId}
     WHERE te.company_id = ${companyId} AND te.caregiver_id = ${caregiverId} AND te.is_complete = true
     GROUP BY c.id, c.first_name, c.last_name, c.address, c.city
     ORDER BY MAX(te.start_time) DESC`))
}
