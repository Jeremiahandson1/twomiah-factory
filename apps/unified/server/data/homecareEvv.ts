// Home care's EVV, Sandata and visit-record SQL. Moved from templates/crm-homecare/backend/src/services/{evvWeekly,
// evvVisits, sandataAutoSubmit, portalClaimDays, visitRecord, carePlanSchedule}.ts, which ran these as raw SQL; the
// rules around them are in server/crm/homecare/core/. One named function per query, each scoped to the company and
// returning camelCase (RULEBOOK §2); `users` is `"user"`.
import { sql, type SQL } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, camelFirst, rowsOf } from '@twomiah/tenant-backend'
import { evvVisits } from '../db/schema/index.ts'
import { inList, localDate, localTs, dayStartUtc, dayEndUtc, occurrencesCte, privatePaySql, type Q } from './homecareCore.ts'

// ── The EVV week (services/evvWeekly.ts) ─────────────────────────────────────────────────────

/**
 * Minutes a visit counts toward the week. A finished visit counts its BILLABLE minutes (capped when a clock-out was
 * missed); an open visit counts its elapsed time, capped at its scheduled length (16h when none). `atExpr` is a
 * timestamptz expression; `te` is a time_entries alias.
 */
export function visitMinutesSql(atExpr: SQL): SQL {
  return sql`CASE WHEN te.end_time IS NOT NULL
       THEN COALESCE(te.billable_minutes, te.duration_minutes, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)
       ELSE LEAST(GREATEST(0, EXTRACT(EPOCH FROM (${atExpr} - (te.start_time AT TIME ZONE 'UTC'))) / 60),
                  COALESCE(te.allotted_minutes, 960))
  END`
}

/** Local Sun–Sat week (as dates) containing an instant, in the agency zone: CTEs `d` and `w` (w.ws = the Sunday). */
export function weekCte(atIso: string | null, tz: string): SQL {
  return sql`d AS (SELECT ((COALESCE(${atIso}::timestamptz, now())) AT TIME ZONE ${tz})::date AS day),
          w AS (SELECT day - EXTRACT(DOW FROM day)::int AS ws FROM d)`
}

/** Sandata minutes a client has used in the Sun–Sat week containing `atIso` (null = now). Undecided visits count. */
export async function evvWeekUsageRow(q: Q, companyId: string, clientId: string, atIso: string | null, opts: { excludeEntryId?: string | null; timezone: string }) {
  const at = sql`COALESCE(${atIso}::timestamptz, now())`
  const row = rowsOf(await q.execute(sql`
    WITH ${weekCte(atIso, opts.timezone)}
    SELECT to_char(w.ws, 'YYYY-MM-DD') AS week_start,
           to_char(w.ws + 6, 'YYYY-MM-DD') AS week_end,
           COALESCE(SUM(${visitMinutesSql(at)}), 0)::float AS used_minutes
      FROM w
      LEFT JOIN time_entries te
        ON te.company_id = ${companyId}
       AND te.client_id = ${clientId}
       AND ((te.start_time AT TIME ZONE 'UTC') AT TIME ZONE ${opts.timezone})::date BETWEEN w.ws AND w.ws + 6
       AND COALESCE(te.sandata_required, true) = true
       AND (${opts.excludeEntryId ?? null}::text IS NULL OR te.id <> ${opts.excludeEntryId ?? null}::text)
     GROUP BY w.ws`))[0] || {}
  return { weekStart: row.week_start as string, weekEnd: row.week_end as string, usedMinutes: Math.round(Number(row.used_minutes) || 0) }
}

/** What decides whether a client's visits go to Sandata: private pay, Medicaid id, EVV weekly units, payer flag. */
export async function clientSandataFacts(q: Q, companyId: string, clientId: string): Promise<{ isPrivatePay: boolean | null; medicaidId: string | null; evvWeeklyUnits: number | null; sandataEvvRequired: boolean | null } | null> {
  return camelFirst(await q.execute(sql`
    SELECT c.is_private_pay, c.medicaid_id, c.evv_weekly_units, rs.sandata_evv_required
      FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
     WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}

// ── EVV visit from a closed time entry (services/evvVisits.ts) ──────────────────────────────

/** The closed punch and what an EVV record needs about its client, caregiver and care type. */
export async function timeEntryForEvv(q: Q, companyId: string, timeEntryId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT te.id, te.client_id, te.caregiver_id, te.start_time, te.end_time,
           te.clock_in_location, te.clock_out_location, te.origin_phone,
           c.medicaid_id, cp.evv_worker_id, cp.npi_number,
           ct.default_service_code, ct.default_modifier, ${privatePaySql('c')} AS private_pay
      FROM time_entries te
      JOIN clients c ON c.id = te.client_id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = te.caregiver_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
     WHERE te.id = ${timeEntryId} AND te.company_id = ${companyId}`)) ?? null
}

/** The client's active authorization covering the date, for the service code (or any code), soonest ending first. */
export async function activeAuthorizationOn(q: Q, companyId: string, clientId: string, serviceDate: string, serviceCode: string | null): Promise<{ id: string; unitType: string | null } | null> {
  return camelFirst(await q.execute(sql`
    SELECT id, unit_type FROM authorizations
     WHERE company_id = ${companyId}
       AND client_id = ${clientId}
       AND status = 'active'
       AND start_date <= ${serviceDate}::date
       AND end_date >= ${serviceDate}::date
       AND (procedure_code = ${serviceCode} OR procedure_code IS NULL)
     ORDER BY end_date ASC
     LIMIT 1`)) ?? null
}

/**
 * Write the EVV record for a time entry, or refresh it (upsert on time_entry_id). A not-yet-sent record moves between
 * pending and ready with its issues; a sent one keeps its status. The company is an argument of its own, so no caller
 * can leave it out (apps/unified/tests/homecare-company-id.test.ts).
 */
export async function upsertEvvVisit(q: any, companyId: string, values: Record<string, any>): Promise<any> {
  const [record] = await q.insert(evvVisits).values({ ...values, companyId } as any).onConflictDoUpdate({
    target: evvVisits.timeEntryId,
    set: {
      actualEnd: values.actualEnd,
      unitsOfService: values.unitsOfService,
      gpsOutLat: values.gpsOutLat,
      gpsOutLng: values.gpsOutLng,
      verificationIssues: values.verificationIssues,
      isVerified: values.isVerified,
      sandataStatus: sql`CASE WHEN ${evvVisits.sandataStatus} IN ('pending', 'ready') THEN ${values.sandataStatus} ELSE ${evvVisits.sandataStatus} END`,
      updatedAt: new Date(),
    },
  }).returning()
  return record
}

// ── The Sandata submission queue (services/sandataAutoSubmit.ts) ─────────────────────────────

/** Everything one visit submission needs, read fresh (GPS from the time entry, not the EVV snapshot). */
export async function sandataBundleRow(q: Q, companyId: string, evvVisitId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT ev.id AS evv_id, ev.time_entry_id, ev.service_code, ev.modifier,
           ev.service_date, ev.actual_start, ev.actual_end,
           ev.sandata_status, ev.sandata_sequence, ev.exception_ack,
           ev.sandata_exception_code, ev.exception_ack_reason, ev.exception_ack_memo,
           te.start_time, te.end_time, te.clock_in_location, te.clock_out_location, te.origin_phone,
           c.id AS client_id, c.medicaid_id, c.sandata_synced_at, c.sandata_sequence AS client_sequence,
           c.first_name, c.last_name, c.address, c.city, c.state, c.zip, c.phone,
           c.latitude, c.longitude, c.is_active AS client_is_active, c.created_at AS client_created_at,
           rs.sandata_payer_id, rs.sandata_payer_program,
           cp.evv_worker_id,
           ct.default_service_code
      FROM evv_visits ev
      JOIN time_entries te ON te.id = ev.time_entry_id
      JOIN clients c ON c.id = ev.client_id
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = ev.caregiver_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
     WHERE ev.id = ${evvVisitId} AND ev.company_id = ${companyId}`)) ?? null
}

/** A punch's time changes, oldest first, with who made each (their email). */
export async function visitTimeChangesFor(q: Q, companyId: string, timeEntryId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT vtc.*, u.email AS changed_by_label
      FROM visit_time_changes vtc
      LEFT JOIN "user" u ON u.id = vtc.changed_by_id
     WHERE vtc.time_entry_id = ${timeEntryId} AND vtc.company_id = ${companyId}
     ORDER BY vtc.changed_at ASC`))
}

/** The visit's live queue item (not failed, cancelled or completed), if any. */
export async function liveQueueItem(q: Q, companyId: string, evvVisitId: string): Promise<{ id: string; status: string } | null> {
  return camelFirst(await q.execute(sql`
    SELECT id, status FROM sandata_submission_queue
     WHERE company_id = ${companyId} AND evv_visit_id = ${evvVisitId} AND status NOT IN ('failed', 'cancelled', 'completed')
     LIMIT 1`)) ?? null
}

/** The oldest queued item whose backoff has passed, of any company but those skipped (whose account is not set). */
export async function nextQueuedItem(q: Q, skipCompanyIds: string[] = []): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT sq.id AS queue_id, sq.company_id, sq.evv_visit_id, sq.retry_count,
           c.first_name AS client_first, c.last_name AS client_last, to_char(ev.service_date, 'YYYY-MM-DD') AS service_date
      FROM sandata_submission_queue sq
      JOIN evv_visits ev ON ev.id = sq.evv_visit_id
      JOIN clients c ON c.id = ev.client_id
     WHERE sq.status = 'queued'
       AND (sq.next_retry_at IS NULL OR sq.next_retry_at <= (now() AT TIME ZONE 'UTC'))
       ${skipCompanyIds.length ? sql`AND sq.company_id NOT IN (${inList(skipCompanyIds)})` : sql``}
     ORDER BY sq.created_at ASC
     LIMIT 1`)) ?? null
}

/** Seconds until the soonest queued item's backoff ends, or null when none is waiting. */
export async function secondsToNextRetry(q: Q): Promise<number | null> {
  const r = rowsOf(await q.execute(sql`
    SELECT EXTRACT(EPOCH FROM (MIN(next_retry_at) - (now() AT TIME ZONE 'UTC'))) AS secs
      FROM sandata_submission_queue
     WHERE status = 'queued' AND next_retry_at > (now() AT TIME ZONE 'UTC')`))[0]
  const secs = Number(r?.secs)
  return Number.isFinite(secs) ? secs : null
}

/** Visits POSTed whose accept/reject is not known yet, oldest first (50). */
export async function submittedVisitsAwaitingStatus(q: Q, companyId: string): Promise<{ id: string; sandataUuid: string }[]> {
  return camelRows(await q.execute(sql`
    SELECT id, sandata_uuid FROM evv_visits
     WHERE company_id = ${companyId} AND sandata_status = 'submitted' AND sandata_uuid IS NOT NULL
     ORDER BY sandata_submitted_at ASC
     LIMIT 50`))
}

/** The queue by status over the last 7 days. */
export async function queueStatusCounts(q: Q, companyId: string): Promise<{ status: string; count: number; oldest: Date | null }[]> {
  return camelRows(await q.execute(sql`
    SELECT status, COUNT(*)::int AS count, MIN(created_at) AS oldest
      FROM sandata_submission_queue
     WHERE company_id = ${companyId} AND created_at > (now() AT TIME ZONE 'UTC') - INTERVAL '7 days'
     GROUP BY status ORDER BY status`))
}

// ── Insurer-portal claim days (services/portalClaimDays.ts) ──────────────────────────────────

/** The finished visits of every client of `payerId` in [ws, we] on the agency's clock (`tz`), by client then time. */
export async function portalClaimWeekVisits(q: Q, companyId: string, payerId: string, ws: string, we: string, tz: string): Promise<any[]> {
  const local = (c: string) => sql`((${sql.raw(c)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`
  return camelRows(await q.execute(sql`
    SELECT te.id, te.client_id,
           te.sandata_required AS sent_flag,
           te.needs_approval AS needs_approval,
           te.approval_reason AS approval_reason,
           COALESCE(te.billable_minutes, te.duration_minutes, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60) AS minutes,
           to_char(${local('te.start_time')}, 'YYYY-MM-DD') AS date,
           to_char(${local('te.start_time')}, 'YYYY-MM-DD"T"HH24:MI') AS start,
           to_char(${local('te.start_time')}, 'FMHH12:MI AM') AS clock_in,
           to_char(${local('te.end_time')}, 'FMHH12:MI AM') AS clock_out,
           COALESCE(s.is_training, false) AS is_training,
           u.first_name || ' ' || u.last_name AS caregiver,
           c.first_name, c.last_name, c.medicaid_id, c.mco_member_id, c.is_private_pay,
           c.evv_weekly_units, c.weekly_authorized_units
      FROM time_entries te
      JOIN clients c ON c.id = te.client_id
      JOIN "user" u ON u.id = te.caregiver_id
      LEFT JOIN schedules s ON s.id = te.schedule_id
     WHERE te.company_id = ${companyId}
       AND te.end_time IS NOT NULL
       AND c.referred_by_id = ${payerId}
       AND COALESCE(c.is_private_pay, false) = false
       AND (${local('te.start_time')})::date BETWEEN ${ws}::date AND ${we}::date
     ORDER BY c.last_name, c.first_name, te.start_time`))
}

// ── One record per visit (services/visitRecord.ts) ───────────────────────────────────────────

/** Scheduled (non-cancelled) visits for one client in a range, with the caregiver's name. */
export async function scheduledVisitRows(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, from, to)}
    SELECT to_char(o.occ_date, 'YYYY-MM-DD') AS visit_date, to_char(o.start_time, 'HH24:MI:SS') AS start_time,
           to_char(o.end_time, 'HH24:MI:SS') AS end_time, o.minutes, o.caregiver_id, o.schedule_id,
           u.first_name || ' ' || u.last_name AS caregiver_name
      FROM occ o LEFT JOIN "user" u ON u.id = o.caregiver_id
     WHERE o.client_id = ${clientId}
     ORDER BY o.occ_date, o.start_time`))
}

/** The client's punches whose clock-in falls in the range on the agency's calendar (`tz`). */
export async function clientPunchRows(q: Q, companyId: string, clientId: string, from: string, to: string, tz: string): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT te.id, te.caregiver_id, te.schedule_id, te.notes,
      to_char(${localDate(sql`te.start_time`, tz)}, 'YYYY-MM-DD') AS day,
      to_char(${localTs(sql`te.start_time`, tz)}, 'HH24:MI:SS') AS start_local,
      to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS clock_in,
      to_char(te.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS clock_out
    FROM time_entries te
    WHERE te.company_id = ${companyId} AND te.client_id = ${clientId}
      AND te.start_time >= ${dayStartUtc(from, tz)} AND te.start_time < ${dayEndUtc(to, tz)}
    ORDER BY te.start_time`))
}

/** The caregiver's latest OPEN punch at this client, with its agency day and local start. */
export async function openPunchRow(q: Q, companyId: string, caregiverId: string, clientId: string, tz: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT te.id, te.caregiver_id, te.schedule_id, te.notes,
      to_char(${localDate(sql`te.start_time`, tz)}, 'YYYY-MM-DD') AS day,
      to_char(${localTs(sql`te.start_time`, tz)}, 'HH24:MI:SS') AS start_local
    FROM time_entries te
    WHERE te.company_id = ${companyId} AND te.caregiver_id = ${caregiverId} AND te.client_id = ${clientId} AND te.end_time IS NULL
    ORDER BY te.start_time DESC LIMIT 1`)) ?? null
}

/** Recorded (completed / skipped / refused) task statuses of these punches. */
export async function recordedTaskRows(q: Q, companyId: string, timeEntryIds: string[]): Promise<{ timeEntryId: string; taskTemplateId: string; status: string; notes: string | null }[]> {
  if (!timeEntryIds.length) return []
  return camelRows(await q.execute(sql`SELECT time_entry_id, task_template_id, status, notes FROM shift_task_completions
    WHERE company_id = ${companyId} AND time_entry_id IN (${inList(timeEntryIds)}) AND status IN ('completed', 'skipped', 'refused')`))
}

/**
 * Add a note to a visit's documentation (creating the row in the company), after any note already there. `visit`
 * is { caregiverId, visitDate, startTime ('HH:MM:SS'), endTime, scheduleId }. Runs on `q` (db or a transaction).
 */
export async function appendVisitNoteRow(q: Q, companyId: string, clientId: string,
  visit: { caregiverId: string; visitDate: string; startTime: string | null; endTime: string | null; scheduleId: string | null },
  authorId: string, note: string): Promise<any> {
  return camelFirst(await q.execute(sql`
    INSERT INTO visit_documentation (id, company_id, client_id, caregiver_id, visit_date, start_time, end_time, schedule_id, tasks, note, entered_by_id, created_at, updated_at)
    VALUES (${createId()}, ${companyId}, ${clientId}, ${visit.caregiverId}, ${visit.visitDate}::date, ${visit.startTime}::time, ${visit.endTime}::time,
            ${visit.scheduleId}, '[]'::json, ${note}, ${authorId}, NOW(), NOW())
    ON CONFLICT (client_id, visit_date, start_time, caregiver_id) DO UPDATE
      SET note = CASE WHEN COALESCE(TRIM(visit_documentation.note), '') = '' THEN EXCLUDED.note
                      ELSE visit_documentation.note || E'\n' || EXCLUDED.note END,
          updated_at = NOW()
    RETURNING id, client_id, caregiver_id, note, created_at, updated_at`))
}

// ── A client's visit schedule in words (services/carePlanSchedule.ts) ────────────────────────

/** The client's recurring patterns that produce a visit between the two dates, with the caregiver's name. */
export async function clientSchedulePatterns(q: Q, companyId: string, clientId: string, from: string, until: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, until)}
    SELECT s.id, s.day_of_week,
           to_char(s.start_time::time, 'HH24:MI') AS start_time,
           to_char(s.end_time::time, 'HH24:MI') AS end_time,
           COALESCE(s.frequency, 'weekly') AS frequency,
           s.end_date::text AS end_date,
           s.suspended_from::text AS suspended_from,
           TRIM(REGEXP_REPLACE(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''), '\\s+', ' ', 'g')) AS caregiver
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id
      LEFT JOIN "user" u ON u.id = s.caregiver_id
     WHERE occ.pattern_client_id = ${clientId}
     GROUP BY s.id, u.first_name, u.last_name`))
}
