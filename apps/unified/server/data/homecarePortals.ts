// Home care's portals, messages and notifications: the queries the portals route group (server/crm/homecare/portals)
// runs in raw SQL. Moved from templates/crm-homecare/backend/src/routes/{portal,portalVisits,familyPortal,notifications}.ts.
// Raw SQL lives here (RULEBOOK §2); every read is scoped to the company and returns camelCase.
//
// Changes from the template, all for one reason — its database held ONE agency: every query names the company, `users`
// is `"user"` and `agencies` is `company`.
import { sql, type SQL } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, camelFirst, rowsOf } from '@twomiah/tenant-backend'
import { clientPortalAccounts } from '../db/schema/index.ts'
import { occurrencesCte, type Q } from './homecareCore.ts'
import { releasedInvoiceSql } from './homecareBilling.ts'

// ── The client portal's logins ───────────────────────────────────────────────────────────────

/** One login's state, in the words the screen shows (a column for a query-builder select over client_portal_accounts). */
export function portalAccountStatusSql(): SQL<string> {
  return sql<string>`CASE
    WHEN ${clientPortalAccounts.inviteToken} IS NOT NULL AND ${clientPortalAccounts.inviteExpiresAt} > now() THEN 'invite_pending'
    WHEN ${clientPortalAccounts.inviteToken} IS NOT NULL AND (${clientPortalAccounts.inviteExpiresAt} IS NULL OR ${clientPortalAccounts.inviteExpiresAt} <= now()) THEN 'invite_expired'
    WHEN ${clientPortalAccounts.portalEnabled} = true THEN 'active'
    ELSE 'disabled' END`
}

/** A login's invite / reset link that has not run out (a where fragment over client_portal_accounts). */
export function portalInviteLiveSql(): SQL {
  return sql`${clientPortalAccounts.inviteExpiresAt} > now()`
}

/**
 * Every active client of the company with its portal's state: how many logins, the latest sign-in and the summary
 * status (active / invite_pending / invite_expired / disabled / not_invited). The office's all-clients view.
 */
export async function portalClientsOverview(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT
      c.id, c.first_name, c.last_name, c.phone, c.email, c.is_active,
      agg.portal_enabled,
      agg.portal_email,
      agg.last_login,
      agg.invite_expires_at,
      COALESCE(agg.account_count, 0)::int AS account_count,
      COALESCE(agg.portal_status, 'not_invited') AS portal_status
    FROM clients c
    LEFT JOIN LATERAL (
      SELECT
        bool_or(cpa.portal_enabled)                          AS portal_enabled,
        string_agg(cpa.email, ', ' ORDER BY cpa.created_at)  AS portal_email,
        MAX(cpa.last_login)                                  AS last_login,
        MAX(cpa.invite_expires_at)                           AS invite_expires_at,
        COUNT(*)                                             AS account_count,
        CASE
          WHEN bool_or(cpa.portal_enabled) THEN 'active'
          WHEN bool_or(cpa.invite_token IS NOT NULL AND cpa.invite_expires_at > now()) THEN 'invite_pending'
          WHEN bool_or(cpa.invite_token IS NOT NULL) THEN 'invite_expired'
          ELSE 'disabled'
        END AS portal_status
      FROM client_portal_accounts cpa
      WHERE cpa.client_id = c.id AND cpa.company_id = ${companyId}
      HAVING COUNT(*) > 0
    ) agg ON true
    WHERE c.company_id = ${companyId} AND c.is_active = true
    ORDER BY c.last_name, c.first_name`))
}

// ── The client portal's home page ────────────────────────────────────────────────────────────

/** What the client owes: their released invoices still pending or overdue. */
export async function clientOutstandingBalance(q: Q, companyId: string, clientId: string): Promise<number> {
  const r = rowsOf(await q.execute(sql`SELECT COALESCE(SUM(i.total), 0) AS total FROM invoices i
    WHERE i.company_id = ${companyId} AND i.client_id = ${clientId} AND i.payment_status IN ('pending', 'overdue')
      AND ${releasedInvoiceSql('i')}`))[0]
  return Number(r?.total || 0)
}

// ── Who serves this client NOW (portal.ts) ───────────────────────────────────────────────────
// The one definition behind My Caregivers (client and family portal), the background-check summary gate and the
// reschedule picker: an active assignment, or a visit from today through four weeks out expanded through the schedule
// engine (so a covering caregiver counts for their day and an ended pattern for nobody), or an upcoming portal visit
// row (scheduled_visits) that is not cancelled.

export const SERVING_WINDOW_DAYS = 28

const addDaysYmd = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function servingCaregiverIdsSql(companyId: string, clientId: string, today: string): SQL {
  return sql`
    WITH ${occurrencesCte(companyId, today, addDaysYmd(today, SERVING_WINDOW_DAYS))}
    SELECT ca.caregiver_id FROM client_assignments ca
     WHERE ca.company_id = ${companyId} AND ca.client_id = ${clientId} AND ca.status = 'active'
    UNION
    SELECT occ.caregiver_id FROM occ JOIN schedules s ON s.id = occ.schedule_id
     WHERE occ.client_id = ${clientId} AND (s.status IS NULL OR s.status = 'active') AND occ.caregiver_id IS NOT NULL
    UNION
    SELECT sv.caregiver_id FROM scheduled_visits sv
     WHERE sv.company_id = ${companyId} AND sv.client_id = ${clientId} AND sv.scheduled_date >= ${today}::date
       AND sv.status <> 'cancelled' AND sv.caregiver_id IS NOT NULL`
}

/** Does this caregiver serve this client now (the rule above)? `today` is the agency's date. */
export async function servesClient(q: Q, companyId: string, caregiverId: string, clientId: string, today: string): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`SELECT 1 AS ok FROM (${servingCaregiverIdsSql(companyId, clientId, today)}) AS serving
    WHERE serving.caregiver_id = ${caregiverId} LIMIT 1`))
  return r.length > 0
}

/**
 * The caregivers serving this client now, one row each: caregiverId, firstName, lastName, phone (null unless
 * `withPhone` — relatives never get it), certifications, and the active assignment when there is one (assignmentId,
 * assignmentDate, hoursPerWeek, status).
 */
export async function caregiversServingClient(q: Q, companyId: string, clientId: string, today: string, withPhone: boolean): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT DISTINCT ON (u.id)
      COALESCE(ca.id, u.id)          AS assignment_id,
      ca.assignment_date,
      ca.hours_per_week,
      COALESCE(ca.status, 'active')  AS status,
      u.id                           AS caregiver_id,
      u.first_name, u.last_name,
      ${withPhone ? sql`u.phone` : sql`NULL::text`} AS phone,
      u.certifications
    FROM "user" u
    LEFT JOIN client_assignments ca
      ON ca.caregiver_id = u.id AND ca.client_id = ${clientId} AND ca.status = 'active' AND ca.company_id = ${companyId}
    WHERE u.company_id = ${companyId}
      AND u.id IN (SELECT serving.caregiver_id FROM (${servingCaregiverIdsSql(companyId, clientId, today)}) AS serving)
    ORDER BY u.id, ca.assignment_date DESC NULLS LAST`))
}

// ── The family portal ────────────────────────────────────────────────────────────────────────

/**
 * Is this email already a relative's login (whatever its case)? The email is the login key and the family sign-in has
 * no company to go on, so it is checked across the database (one company per tenant database).
 */
export async function familyEmailTaken(q: Q, email: string, exceptId?: string): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`SELECT id FROM family_members WHERE lower(email) = ${email}`))
  return r.some((row: any) => row.id !== exceptId)
}

/** The active relative signing in with this email (whatever its case), with the password hash, or null. */
export async function familyMemberForLogin(q: Q, email: string): Promise<{ id: string; companyId: string; clientId: string; passwordHash: string | null } | null> {
  return camelFirst(await q.execute(sql`SELECT id, company_id, client_id, password_hash FROM family_members
    WHERE lower(email) = ${email} AND is_active = true LIMIT 1`)) ?? null
}

/**
 * The client's visits from `from` through `to` through the one schedule engine: weekly and bi-weekly patterns and
 * one-time visits, cancelled days gone, the covering caregiver's name on the day they cover.
 */
export async function familyScheduleRows(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to)}
    SELECT occ.schedule_id || ':' || to_char(occ.occ_date, 'YYYY-MM-DD') AS id, occ.schedule_id,
           to_char(occ.occ_date, 'YYYY-MM-DD') AS date,
           to_char(occ.start_time, 'HH24:MI') AS start_time, to_char(occ.end_time, 'HH24:MI') AS end_time,
           s.notes, u.first_name AS caregiver_first, u.last_name AS caregiver_last
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id
      LEFT JOIN "user" u ON u.id = occ.caregiver_id
     WHERE occ.client_id = ${clientId}
     ORDER BY occ.occ_date, occ.start_time`))
}

// ── Staff notifications ──────────────────────────────────────────────────────────────────────

/** The office's totals: every notification in the company, how many unread, how many people they went to. */
export async function notificationSummary(q: Q, companyId: string): Promise<{ totalNotifications: number; unreadCount: number; uniqueRecipients: number }> {
  const r = rowsOf(await q.execute(sql`SELECT COUNT(*)::int AS total,
      (COUNT(*) FILTER (WHERE is_read = false))::int AS unread,
      COUNT(DISTINCT user_id)::int AS recipients
    FROM notifications WHERE company_id = ${companyId}`))[0]
  return { totalNotifications: Number(r?.total || 0), unreadCount: Number(r?.unread || 0), uniqueRecipients: Number(r?.recipients || 0) }
}

// ── The family's visits and visit actions (portalVisits.ts) ──────────────────────────────────
// The rules (the worked-visit block, applying a reschedule) and the staff side's SQL are the visits group's
// (server/crm/homecare/visits/visitChanges.ts, server/data/homecareVisits.ts); these are the portal's own reads and writes.

/** The client's own portal visit rows (scheduled_visits, not cancelled) from `today` on, or before it when `past`. */
export async function portalScheduledVisits(q: Q, companyId: string, clientId: string, today: string, past: boolean): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT sv.id, to_char(sv.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
           to_char(sv.start_time, 'HH24:MI:SS') AS start_time, to_char(sv.end_time, 'HH24:MI:SS') AS end_time,
           sv.status, sv.notes, sv.client_notes, sv.cancelled_reason, sv.caregiver_id, sv.source_schedule_id AS schedule_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name, u.phone AS caregiver_phone,
           'scheduled_visit' AS source
      FROM scheduled_visits sv JOIN "user" u ON sv.caregiver_id = u.id
     WHERE sv.company_id = ${companyId} AND sv.client_id = ${clientId} AND sv.scheduled_date IS NOT NULL
       AND ${past ? sql`sv.scheduled_date < ${today}::date` : sql`sv.scheduled_date >= ${today}::date`}
       AND sv.status <> 'cancelled'`))
}

/** The client's visits through the schedule engine, `from`–`to`, those from `today` on (or before it when `past`). */
export async function portalOccurrences(q: Q, companyId: string, clientId: string, from: string, to: string, today: string, past: boolean): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to)}
    SELECT occ.schedule_id, occ.caregiver_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS scheduled_date,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           s.notes, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name, u.phone AS caregiver_phone
      FROM occ JOIN schedules s ON s.id = occ.schedule_id JOIN "user" u ON u.id = occ.caregiver_id
     WHERE occ.client_id = ${clientId} AND (s.status IS NULL OR s.status = 'active')
       AND ${past ? sql`occ.occ_date < ${today}::date` : sql`occ.occ_date >= ${today}::date`}
     ORDER BY occ.occ_date, occ.start_time`))
}

/** "caregiverId|YYYY-MM-DD" for every day a caregiver clocked in at this client, on the agency's clock, since `since`. */
export async function workedVisitKeys(q: Q, companyId: string, clientId: string, since: string, tz: string): Promise<Set<string>> {
  const r = rowsOf(await q.execute(sql`SELECT DISTINCT caregiver_id,
      to_char(((start_time AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS d
    FROM time_entries WHERE company_id = ${companyId} AND client_id = ${clientId}
      AND ((start_time AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date >= ${since}::date`))
  return new Set(r.map((row: any) => `${row.caregiver_id}|${row.d}`))
}

/** The family's own note on one of the client's portal visit rows. */
export async function setVisitClientNote(q: Q, companyId: string, clientId: string, visitId: string, note: string): Promise<void> {
  await q.execute(sql`UPDATE scheduled_visits SET client_notes = ${note}, updated_at = NOW()
    WHERE id = ${visitId} AND client_id = ${clientId} AND company_id = ${companyId}`)
}

/** A request for this visit (the client's, that date and start, that caregiver) still waiting on the office. */
export async function openClientRequestFor(q: Q, companyId: string, clientId: string, visitDate: string, startTime: string, caregiverId: string): Promise<{ id: string } | null> {
  return camelFirst(await q.execute(sql`SELECT id FROM visit_change_requests
    WHERE company_id = ${companyId} AND client_id = ${clientId} AND visit_date = ${visitDate}::date
      AND original_start_time = ${startTime}::time AND caregiver_id = ${caregiverId}
      AND status IN ('pending', 'counter_offered') LIMIT 1`)) ?? null
}

/** File the client's cancel: approved at once (with the office's note saying so) or pending. Returns its id. */
export async function insertClientCancelRequest(q: Q, companyId: string, r: {
  clientId: string; caregiverId: string; visitId: string | null; scheduleId: string | null; visitDate: string
  startTime: string; endTime: string; reason: string; applyNow: boolean; adminNotes: string | null
}): Promise<string> {
  const id = createId()
  await q.execute(sql`INSERT INTO visit_change_requests (id, company_id, client_id, caregiver_id, request_type, visit_id, schedule_id, visit_date,
      original_start_time, original_end_time, cancel_reason, status, resolved_at, admin_notes, requested_by, created_at, updated_at)
    VALUES (${id}, ${companyId}, ${r.clientId}, ${r.caregiverId}, 'cancel', ${r.visitId}, ${r.scheduleId}, ${r.visitDate}::date,
            ${r.startTime}::time, ${r.endTime}::time, ${r.reason}, ${r.applyNow ? 'approved' : 'pending'},
            ${r.applyNow ? sql`NOW()` : sql`NULL`}, ${r.adminNotes}, 'client', NOW(), NOW())`)
  return id
}

/** File the client's request to move a visit (pending, for the office). Returns its id. */
export async function insertClientRescheduleRequest(q: Q, companyId: string, r: {
  clientId: string; caregiverId: string; visitId: string | null; scheduleId: string | null; visitDate: string
  startTime: string; endTime: string; proposedDate: string; proposedStartTime: string; proposedEndTime: string
}): Promise<string> {
  const id = createId()
  await q.execute(sql`INSERT INTO visit_change_requests (id, company_id, client_id, caregiver_id, request_type, visit_id, schedule_id, visit_date,
      original_start_time, original_end_time, proposed_date, proposed_start_time, proposed_end_time, requested_by, status, created_at, updated_at)
    VALUES (${id}, ${companyId}, ${r.clientId}, ${r.caregiverId}, 'reschedule', ${r.visitId}, ${r.scheduleId}, ${r.visitDate}::date,
            ${r.startTime}::time, ${r.endTime}::time, ${r.proposedDate}::date, ${r.proposedStartTime}::time, ${r.proposedEndTime}::time,
            'client', 'pending', NOW(), NOW())`)
  return id
}

/** The client cancelled one of their portal visit rows (no staff member did, so no cancelled_by). */
export async function cancelClientVisit(q: Q, companyId: string, clientId: string, visitId: string, reason: string): Promise<void> {
  await q.execute(sql`UPDATE scheduled_visits SET status = 'cancelled', cancelled_reason = ${reason}, cancelled_at = NOW(), updated_at = NOW()
    WHERE id = ${visitId} AND client_id = ${clientId} AND company_id = ${companyId}`)
}

/** That day of the client's pattern does not happen: the client cancelled it (an existing exception is left alone). */
export async function insertClientCancelledDay(q: Q, companyId: string, scheduleId: string, visitDate: string): Promise<void> {
  await q.execute(sql`INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, cancel_reason, created_at)
    VALUES (${createId()}, ${companyId}, ${scheduleId}, ${visitDate}::date, 'cancelled', 'client_cancelled', NOW())
    ON CONFLICT (schedule_id, exception_date) DO NOTHING`)
}

/** A request's new status once the client answered the office's counter-offer. */
export async function answerCounterOffer(q: Q, companyId: string, id: string, status: 'counter_accepted' | 'counter_declined'): Promise<void> {
  await q.execute(sql`UPDATE visit_change_requests SET status = ${status}, resolved_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId}`)
}

/** The caregiver's working week as the office set it (caregiver_availability; the day columns keep their names). */
export async function caregiverAvailabilityRow(q: Q, companyId: string, caregiverId: string): Promise<Record<string, any> | null> {
  return rowsOf(await q.execute(sql`SELECT * FROM caregiver_availability WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} LIMIT 1`))[0] ?? null
}

/** The caregiver's visits for OTHER clients, `from`–`to` (date, start, end), through the engine. */
export async function caregiverBusyElsewhere(q: Q, companyId: string, caregiverId: string, clientId: string, from: string, to: string): Promise<{ d: string; s: string; e: string }[]> {
  return rowsOf(await q.execute(sql`WITH ${occurrencesCte(companyId, from, to)}
    SELECT to_char(occ.occ_date, 'YYYY-MM-DD') AS d, to_char(occ.start_time, 'HH24:MI:SS') AS s, to_char(occ.end_time, 'HH24:MI:SS') AS e
      FROM occ WHERE occ.caregiver_id = ${caregiverId} AND occ.client_id <> ${clientId}`))
}

/** The caregiver's approved time off and blackout days overlapping `from`–`to` (start, end). */
export async function caregiverDaysOff(q: Q, companyId: string, caregiverId: string, from: string, to: string): Promise<{ s: string; e: string }[]> {
  return rowsOf(await q.execute(sql`SELECT to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e FROM caregiver_time_off
    WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND (status = 'approved' OR type = 'blackout')
      AND end_date >= ${from}::date AND start_date <= ${to}::date`))
}
