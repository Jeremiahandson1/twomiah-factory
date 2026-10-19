// Home care's shared SQL (docs/UNIFIED_HOMECARE_PLAN.md, "How the code moves", step 1): the fragments every home-care
// query is built from, and the few reads the foundation (server/crm/homecare/core/) makes. Moved from
// templates/crm-homecare/backend/src/{helpers/scheduleRows.ts, helpers/payerFunding.ts, helpers/caregiverAccess.ts,
// services/scheduleOccurrences.ts, services/agencyTime.ts, services/authUnits.ts}. Raw SQL lives here (RULEBOOK §2).
//
// Two changes from the template, both for one reason — the template's database held ONE agency, the unified one holds
// the business as `company` with `company_id` on every home-care table:
//   · every fragment and read that names a home-care table is scoped to the company (`companyId` comes first);
//   · `users` is `"user"` (quoted: it is a reserved word) and `agencies` is `company`.
// The fragments are SQL, for the route groups' own server/data/homecare*.ts files to compose; the reads return camelCase.
import { sql, type SQL } from 'drizzle-orm'
import { camelRows, camelFirst, rowsOf } from '@twomiah/tenant-backend'

/** Anything that can run a query: `db`, or a transaction handle (inside a transaction, never `db`). */
export type Q = { execute: (q: SQL) => Promise<any> }

// ── IN-lists ─────────────────────────────────────────────────────────────────────────────────

/** An IN-list of bound params. */
export const inList = (vals: string[]): SQL => sql.join(vals.map((v) => sql`${v}`), sql`, `)

// ── The agency's clock (services/agencyTime.ts) ──────────────────────────────────────────────
// time_entries / performance_ratings / audit_logs … are `timestamp` WITHOUT time zone holding UTC wall-clock values;
// their local reading is (col AT TIME ZONE 'UTC') AT TIME ZONE <tz>. schedules.start_time / end_time hold the WALL-CLOCK
// visit time the office typed; only their time of day means anything. No conversion there.

/** A naive-UTC timestamp column read on the agency's clock (a local timestamp). */
export const localTs = (col: SQL, tz: string): SQL => sql`((${col}) AT TIME ZONE 'UTC') AT TIME ZONE ${tz}`

/** The agency-local calendar date of a naive-UTC timestamp column. */
export const localDate = (col: SQL, tz: string): SQL => sql`(((${col}) AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`

/** Local midnight at the start of `ymd`, expressed as a naive-UTC timestamp (comparable to the columns). */
export const dayStartUtc = (ymd: string, tz: string): SQL => sql`(((${ymd})::date)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`

/** Local midnight at the END of `ymd` (start of the next day), as a naive-UTC timestamp. */
export const dayEndUtc = (ymd: string, tz: string): SQL => sql`((((${ymd})::date + 1))::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`

/** "Now" as a naive-UTC timestamp, so it subtracts cleanly from the timestamp columns. */
export const nowUtc = sql`(NOW() AT TIME ZONE 'UTC')`

// ── Who is private pay (helpers/payerFunding.ts) ─────────────────────────────────────────────

export const PRIVATE_PAY_PAYER_TYPE = 'private_pay'

/** TRUE when the client is private pay: flagged, or its payer's payer_type is 'private_pay'. `c` = a clients alias. */
export function privatePaySql(c = 'c'): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(c)) throw new Error(`bad alias: ${c}`)
  return sql.raw(`(COALESCE(${c}.is_private_pay, false) = true OR EXISTS (
      SELECT 1 FROM referral_sources pp_rs WHERE pp_rs.id = ${c}.referred_by_id
         AND LOWER(TRIM(COALESCE(pp_rs.payer_type, ''))) = '${PRIVATE_PAY_PAYER_TYPE}'))`)
}

/** Is this company's client private pay? null when there is no such client. */
export async function clientPrivatePay(q: Q, companyId: string, clientId: string): Promise<boolean | null> {
  const r = rowsOf(await q.execute(sql`SELECT ${privatePaySql('c')} AS private_pay FROM clients c WHERE c.id = ${clientId} AND c.company_id = ${companyId}`))[0]
  return r ? r.private_pay === true : null
}

// ── Which clients a caregiver serves (helpers/caregiverAccess.ts) ────────────────────────────

/**
 * SQL true when `caregiverId` serves the client whose id is `clientCol` (e.g. sql`c.id`): an active pattern for them
 * (recurring, or one-time — a pattern that ended more than 14 days ago no longer counts), a 'modified' cover of one of
 * their days in the last 14 days or later, or an active assignment. Scoped to the company.
 */
export const servedBy = (companyId: string, caregiverId: string, clientCol: SQL = sql.raw('c.id')): SQL => sql`(
  EXISTS (SELECT 1 FROM schedules s WHERE s.company_id = ${companyId} AND s.client_id = ${clientCol} AND s.caregiver_id = ${caregiverId} AND s.is_active = true
          AND (s.day_of_week IS NULL OR s.end_date IS NULL OR s.end_date >= CURRENT_DATE - 14))
  OR EXISTS (SELECT 1 FROM schedule_exceptions se JOIN schedules s2 ON s2.id = se.schedule_id
          WHERE s2.company_id = ${companyId} AND COALESCE(se.override_client_id, s2.client_id) = ${clientCol} AND se.override_caregiver_id = ${caregiverId}
            AND se.exception_type = 'modified' AND se.exception_date >= CURRENT_DATE - 14)
  OR EXISTS (SELECT 1 FROM client_assignments a WHERE a.company_id = ${companyId} AND a.client_id = ${clientCol} AND a.caregiver_id = ${caregiverId} AND a.status = 'active'))`

/** Does this caregiver serve this client (the rule above)? */
export async function caregiverServesClient(q: Q, companyId: string, caregiverId: string, clientId: string): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`SELECT ${servedBy(companyId, caregiverId, sql`${clientId}`)} AS ok`))[0]
  return r?.ok === true
}

// ── Schedule rows (helpers/scheduleRows.ts) ──────────────────────────────────────────────────
// Dates as 'YYYY-MM-DD', times as wall-clock 'HH:MM:SS' (the TIMESTAMP columns' time part). The template answered in
// snake_case; the reads below answer in camelCase (RULEBOOK §2), e.g. caregiverId, startTime, anchorDate.

export const SCHED_COLS = (alias = 's'): SQL => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`bad alias: ${alias}`)
  return sql.raw(`
  ${alias}.id, ${alias}.caregiver_id, ${alias}.client_id, ${alias}.title, ${alias}.schedule_type, ${alias}.frequency,
  ${alias}.day_of_week,
  to_char(${alias}.date, 'YYYY-MM-DD') AS date,
  to_char(${alias}.start_time, 'HH24:MI:SS') AS start_time,
  to_char(${alias}.end_time, 'HH24:MI:SS') AS end_time,
  to_char(${alias}.effective_date, 'YYYY-MM-DD') AS effective_date,
  to_char(${alias}.anchor_date, 'YYYY-MM-DD') AS anchor_date,
  to_char(${alias}.end_date, 'YYYY-MM-DD') AS end_date,
  to_char(${alias}.suspended_from, 'YYYY-MM-DD') AS suspended_from,
  ${alias}.is_active, ${alias}.status, ${alias}.notes, ${alias}.care_type_id,
  COALESCE(${alias}.is_training, false) AS is_training,
  COALESCE(${alias}.is_split_shift, false) AS is_split_shift, ${alias}.split_shift_group_id, ${alias}.split_segment,
  ${alias}.created_at, ${alias}.updated_at`)
}

export const EXC_COLS = sql.raw(`
  se.id, se.schedule_id, to_char(se.exception_date, 'YYYY-MM-DD') AS exception_date, se.exception_type,
  to_char(se.override_start_time, 'HH24:MI:SS') AS override_start_time,
  to_char(se.override_end_time, 'HH24:MI:SS') AS override_end_time,
  se.override_caregiver_id, se.override_client_id, se.override_notes, se.cancel_reason, se.created_by, se.created_at`)

/** One of this company's schedule rows in the API shape (camelCase), or null. */
export async function scheduleById(q: Q, companyId: string, id: string, activeOnly = false): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${SCHED_COLS()} FROM schedules s
    WHERE s.id = ${id} AND s.company_id = ${companyId} ${activeOnly ? sql`AND s.is_active = true` : sql``}`)) ?? null
}

/** The per-date exceptions of these schedules (camelCase), oldest date first. */
export async function exceptionsForSchedules(q: Q, companyId: string, scheduleIds: string[]): Promise<any[]> {
  if (!scheduleIds.length) return []
  return camelRows(await q.execute(sql`SELECT ${EXC_COLS} FROM schedule_exceptions se
    WHERE se.company_id = ${companyId} AND se.schedule_id IN (${inList(scheduleIds)}) ORDER BY se.exception_date`))
}

// ── The schedule engine (services/scheduleOccurrences.ts) ────────────────────────────────────
// A recurring shift is ONE row in `schedules` (day_of_week + effective_date / end_date / frequency / anchor_date) and
// every occurrence is re-derived here. Anything that expands a schedule and does NOT use this CTE will disagree with
// payroll, billing, the calendar and the caregiver's phone.
//
// Columns produced (snake_case inside SQL; a data function that selects them camelises its result):
//   schedule_id; caregiver_id, client_id (RESOLVED through the exception overrides); pattern_caregiver_id,
//   pattern_client_id; occ_date; start_time, end_time (TIME, resolved); hours, minutes (overnight-aware);
//   is_modified; is_training.
//
// Rules the template's old copies got wrong, kept here on purpose:
//  1. Recurring-ness is `day_of_week IS NOT NULL`, never `schedule_type` (it defaults to 'recurring').
//  2. Bi-weekly lives in `frequency` ('biweekly', or 'bi-weekly'), never in `schedule_type`, and runs on its anchor
//     fortnight.
//  3. The effective_date lower bound applies to RECURRING rows only — a one-time row's date IS its occurrence. A
//     one-time row written without `date` falls back to the date part of its start_time.
//  4. A cancelled occurrence does not exist — nothing may pay, bill, remind or alert on it.
//  5. A suspended schedule generates nothing on/after suspended_from; earlier, worked visits stay.
//  6. A row with no start or end time is not a visit.

const START = sql.raw(`COALESCE(se.override_start_time, s.start_time::time)`)
const END = sql.raw(`COALESCE(se.override_end_time, s.end_time::time)`)
// An end time earlier than the start wrapped past midnight.
const WRAP = sql.raw(`(CASE WHEN COALESCE(se.override_end_time, s.end_time::time) < COALESCE(se.override_start_time, s.start_time::time) THEN 1 ELSE 0 END)`)
// Bi-weekly parity: FLOOR (not truncation) so a date 1–6 days before the anchor counts as the previous week; ((x % 2)
// + 2) % 2 normalises negative weeks — the same rule as core/biweekly.ts and the screens' isBiweeklyOn.
const BIWEEKLY_ON_WEEK = sql.raw(
  `(((FLOOR((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::numeric / 7)::int % 2) + 2) % 2) = 0`,
)

/**
 * `name AS (...)` — use inside `WITH ${occurrencesCte(companyId, from, to)} SELECT … FROM occ`. from / to are
 * 'YYYY-MM-DD' (inclusive); `name` is the CTE's name (default `occ`). Only this company's schedules.
 */
export function occurrencesCte(companyId: string, from: string, to: string, name = 'occ'): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`bad CTE name: ${name}`)
  return sql`${sql.raw(name)} AS (
    SELECT
      s.id AS schedule_id,
      COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id,
      COALESCE(se.override_client_id,    s.client_id)    AS client_id,
      s.caregiver_id AS pattern_caregiver_id,
      s.client_id    AS pattern_client_id,
      d.dt::date AS occ_date,
      ${START} AS start_time,
      ${END}   AS end_time,
      (EXTRACT(EPOCH FROM (${END} - ${START})) / 3600.0 + ${WRAP} * 24) AS hours,
      (ROUND(EXTRACT(EPOCH FROM (${END} - ${START})) / 60)::int + ${WRAP} * 1440) AS minutes,
      (se.id IS NOT NULL AND se.exception_type = 'modified') AS is_modified,
      COALESCE(s.is_training, false) AS is_training
    FROM schedules s
    CROSS JOIN generate_series((${from})::date, (${to})::date, '1 day'::interval) AS d(dt)
    LEFT JOIN schedule_exceptions se
      ON se.schedule_id = s.id AND se.exception_date = d.dt::date
    WHERE s.company_id = ${companyId}
      AND s.is_active = true
      AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
      AND (
        (s.day_of_week IS NULL AND COALESCE(s.date, s.start_time::date) = d.dt::date)
        OR (
          s.day_of_week IS NOT NULL
          AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
          AND (COALESCE(s.frequency, 'weekly') NOT IN ('biweekly', 'bi-weekly') OR ${BIWEEKLY_ON_WEEK})
          AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
          AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
        )
      )
      AND (se.id IS NULL OR se.exception_type <> 'cancelled')
      AND (s.suspended_from IS NULL OR d.dt::date < s.suspended_from)
  )`
}

/** Wall-clock HH:MM:SS of a schedules.start_time / end_time column, for responses. `col` is a column reference. */
export const schedTime = (col: string): SQL => {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(col)) throw new Error(`bad column: ${col}`)
  return sql.raw(`to_char(${col}, 'HH24:MI:SS')`)
}

/**
 * A wall-clock time as the value of a schedules.start_time / end_time TIMESTAMP, built in SQL (the optimizers): `date +
 * time`. A bare "08:00" cannot be written to a timestamp column as-is. Throws on anything that is not HH:MM[:SS].
 */
export function wallClock(date: string, hhmm: unknown): SQL {
  const t = typeof hhmm === 'string' ? hhmm.trim() : ''
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`Invalid time "${String(hhmm)}" — expected HH:MM`)
  return sql`((${date})::date + (${`${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`})::time)`
}

/** How many visits this company's client has between two dates (inclusive), counting those they are the pattern of too when `either`. */
export async function clientOccurrenceCount(q: Q, companyId: string, clientId: string, from: string, to: string, either = false): Promise<number> {
  const r = rowsOf(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to)}
    SELECT COUNT(*)::int AS n FROM occ WHERE occ.client_id = ${clientId} ${either ? sql`OR occ.pattern_client_id = ${clientId}` : sql``}`))[0]
  return Number(r?.n || 0)
}

// ── Authorization units in SQL (services/authUnits.ts) ───────────────────────────────────────

/** Authorization units as hours, for queries that sum authorizations: NULL for visits / days. Arguments are column references. */
export function authUnitsToHoursSql(unitsCol: string, unitCol: string): SQL {
  for (const c of [unitsCol, unitCol]) if (!/^[a-z_][a-z0-9_.]*$/i.test(c)) throw new Error(`bad column: ${c}`)
  const t = `LOWER(COALESCE(NULLIF(TRIM(${unitCol}), ''), '15min'))`
  return sql.raw(`(CASE WHEN ${t} IN ('15min', '15-min', '15_min', 'unit', 'units', 'quarter_hour') THEN (${unitsCol}) / 4.0
                WHEN ${t} IN ('hours', 'hour', 'hourly', 'hr', 'hrs') THEN (${unitsCol})
                ELSE NULL END)`)
}
