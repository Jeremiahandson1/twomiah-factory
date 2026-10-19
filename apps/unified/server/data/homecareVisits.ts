// Home care's visits SQL: the punch's office queue and schedule match, the EVV list, visit documentation, visit change
// requests and the Sandata screens. Moved from templates/crm-homecare/backend/src/routes/{timeTracking, evv,
// visitDocumentation, visitChangeRequests, sandata}.ts, which ran these as raw SQL; the routes around them are in
// server/crm/homecare/visits/. One named function per query, each scoped to the company and returning camelCase
// (RULEBOOK §2); `users` is `"user"`, `agencies` is `company`.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, camelFirst, rowsOf } from '@twomiah/tenant-backend'
import { occurrencesCte, privatePaySql, localDate, type Q } from './homecareCore.ts'

// ── The punch (routes/timeTracking.ts) ───────────────────────────────────────────────────────

/** The office's queue: every flagged, finished punch of the company, newest first, with its hours and payer. */
export async function pendingApprovalEntries(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT te.id, te.caregiver_id, te.client_id, te.start_time, te.end_time,
      te.duration_minutes, te.allotted_minutes, te.billable_minutes, te.discrepancy_minutes,
      te.needs_approval, te.approval_reason, te.notes,
      CASE WHEN te.end_time IS NOT NULL
        THEN ROUND((EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0)::numeric, 2) ELSE NULL END AS hours,
      ROUND((te.billable_minutes / 60.0)::numeric, 2) AS billable_hours,
      ROUND((te.allotted_minutes / 60.0)::numeric, 2) AS allotted_hours,
      u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name, u.default_pay_rate,
      c.first_name AS client_first_name, c.last_name AS client_last_name, c.is_private_pay,
      c.latitude AS client_lat, c.longitude AS client_lng,
      rs.payer_type AS referral_payer_type, rs.name AS referral_source_name
    FROM time_entries te
    JOIN "user" u ON te.caregiver_id = u.id
    LEFT JOIN clients c ON te.client_id = c.id
    LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
    WHERE te.company_id = ${companyId} AND te.needs_approval = true AND te.is_complete = true
    ORDER BY te.start_time DESC`))
}

/**
 * The scheduled visit a clock-in is for: this caregiver's occurrence at this client on the agency's `date`, the one
 * whose start is NEAREST the punch's agency wall-clock `time`, through the one schedule engine. `activeNow` = the punch
 * falls inside it (from 15 minutes before its start to its end, overnight-aware). null when there is none.
 */
export async function occurrenceForPunch(q: Q, companyId: string, caregiverId: string, clientId: string, date: string, time: string): Promise<{ id: string; minutes: number | null; activeNow: boolean } | null> {
  return camelFirst(await q.execute(sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT occ.schedule_id AS id, occ.minutes,
           CASE WHEN occ.end_time < occ.start_time
                THEN (${time}::time >= (occ.start_time - INTERVAL '15 minutes')::time OR ${time}::time <= occ.end_time)
                ELSE (${time}::time >= (occ.start_time - INTERVAL '15 minutes')::time AND ${time}::time <= occ.end_time)
           END AS active_now
      FROM occ WHERE occ.caregiver_id = ${caregiverId} AND occ.client_id = ${clientId}
     ORDER BY ABS(EXTRACT(EPOCH FROM (${time}::time - occ.start_time))) ASC, occ.start_time ASC
     LIMIT 1`)) ?? null
}

/** The caregiver's open punch whose clock-in is on the agency's `today` (`tz`), for the phone line. */
export async function openEntryToday(q: Q, companyId: string, caregiverId: string, today: string, tz: string): Promise<{ id: string } | null> {
  return camelFirst(await q.execute(sql`SELECT te.id FROM time_entries te
    WHERE te.company_id = ${companyId} AND te.caregiver_id = ${caregiverId} AND te.end_time IS NULL
      AND ${localDate(sql`te.start_time`, tz)} = ${today}::date
    LIMIT 1`)) ?? null
}

// ── The EVV list (routes/evv.ts) ─────────────────────────────────────────────────────────────

/**
 * One page of the company's EVV records, newest service date first, with the punch and the client. EVV applies only to
 * payer-funded services, so a private-pay client's records are never listed. `total` counts the same filter.
 */
export async function evvVisitPage(q: Q, companyId: string, f: { status?: string; startDate?: string; endDate?: string }, skip: number, limit: number): Promise<{ rows: any[]; total: number }> {
  const where = sql`ev.company_id = ${companyId}
    AND NOT EXISTS (SELECT 1 FROM clients pc WHERE pc.id = ev.client_id AND ${privatePaySql('pc')})
    ${f.status ? sql`AND ev.sandata_status = ${f.status}` : sql``}
    ${f.startDate ? sql`AND ev.service_date >= ${f.startDate}::date` : sql``}
    ${f.endDate ? sql`AND ev.service_date <= ${f.endDate}::date` : sql``}`
  const rows = camelRows(await q.execute(sql`
    SELECT ev.id, ev.time_entry_id, ev.client_id, ev.caregiver_id, ev.authorization_id, ev.service_code, ev.modifier,
           to_char(ev.service_date, 'YYYY-MM-DD') AS service_date, ev.actual_start, ev.actual_end, ev.units_of_service,
           ev.gps_in_lat, ev.gps_in_lng, ev.gps_out_lat, ev.gps_out_lng,
           ev.sandata_status, ev.sandata_visit_id, ev.sandata_submitted_at, ev.sandata_response,
           ev.sandata_exception_code, ev.sandata_exception_desc, ev.evv_method, ev.is_verified, ev.verification_issues,
           ev.created_at, ev.updated_at,
           te.start_time AS te_start_time, te.end_time AS te_end_time, te.duration_minutes AS te_duration_minutes,
           c.first_name AS client_first_name, c.last_name AS client_last_name, c.mco_member_id AS client_mco_member_id
      FROM evv_visits ev
      LEFT JOIN time_entries te ON te.id = ev.time_entry_id
      LEFT JOIN clients c ON c.id = ev.client_id
     WHERE ${where}
     ORDER BY ev.service_date DESC
     OFFSET ${skip} LIMIT ${limit}`))
  const n = rowsOf(await q.execute(sql`SELECT COUNT(*)::int AS n FROM evv_visits ev WHERE ${where}`))[0]
  return { rows, total: Number(n?.n || 0) }
}

// ── Visit documentation (routes/visitDocumentation.ts) ───────────────────────────────────────

const DOC_COLS = sql.raw(`vd.id, vd.client_id, vd.caregiver_id, to_char(vd.visit_date, 'YYYY-MM-DD') AS visit_date,
  to_char(vd.start_time, 'HH24:MI:SS') AS start_time, to_char(vd.end_time, 'HH24:MI:SS') AS end_time,
  vd.schedule_id, vd.tasks, vd.note, vd.entered_by_id, vd.created_at, vd.updated_at`)

/** The client the notes screen names: id, name, private pay, its payer's name. */
export async function visitDocClient(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT c.id, c.first_name, c.last_name, c.is_private_pay, rs.name AS referral_source_name
    FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}

/** The client as the care-notes PDF heads it. */
export async function notesPdfClient(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT c.first_name, c.last_name, to_char(c.date_of_birth, 'YYYY-MM-DD') AS dob,
      c.address, c.city, c.state, c.zip, rs.name AS payer_name
    FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}

/** The client's saved visit notes in a range, with who entered each (`withEnteredBy`). */
export async function visitDocsInRange(q: Q, companyId: string, clientId: string, from: string, to: string, withEnteredBy = true): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT ${DOC_COLS}${withEnteredBy ? sql`, u.first_name || ' ' || u.last_name AS entered_by_name` : sql``}
    FROM visit_documentation vd LEFT JOIN "user" u ON u.id = vd.entered_by_id
    WHERE vd.company_id = ${companyId} AND vd.client_id = ${clientId} AND vd.visit_date BETWEEN ${from}::date AND ${to}::date`))
}

/** One saved visit note, with who entered it. */
export async function visitDocById(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${DOC_COLS}, u.first_name || ' ' || u.last_name AS entered_by_name
    FROM visit_documentation vd LEFT JOIN "user" u ON u.id = vd.entered_by_id WHERE vd.id = ${id} AND vd.company_id = ${companyId}`)) ?? null
}

/** Invoice lines that name a day and caregiver of this client's in the range. */
export async function invoiceLinesInRange(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT to_char(ili.service_date, 'YYYY-MM-DD') AS visit_date, ili.caregiver_id, i.invoice_number, i.id AS invoice_id
    FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id
    WHERE i.company_id = ${companyId} AND i.client_id = ${clientId} AND ili.service_date BETWEEN ${from}::date AND ${to}::date`))
}

/** The client's invoices whose period overlaps the range (a period covers a date even without a matching line). */
export async function invoicesCoveringRange(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT id, invoice_number, to_char(billing_period_start, 'YYYY-MM-DD') AS start,
      to_char(billing_period_end, 'YYYY-MM-DD') AS "end", total, payment_status
    FROM invoices WHERE company_id = ${companyId} AND client_id = ${clientId}
      AND billing_period_start <= ${to}::date AND billing_period_end >= ${from}::date
    ORDER BY billing_period_start`))
}

export type VisitDocRow = {
  clientId: string; caregiverId: string; visitDate: string; startTime: string; endTime: string | null
  scheduleId: string | null; tasks: string; note: string | null; enteredById: string
}

/** Save one visit's note (insert, or replace the note of the same client + day + start + caregiver). Returns its id. */
export async function upsertVisitDoc(q: Q, companyId: string, r: VisitDocRow): Promise<string> {
  const row = camelFirst(await q.execute(sql`
    INSERT INTO visit_documentation (id, company_id, client_id, caregiver_id, visit_date, start_time, end_time, schedule_id, tasks, note, entered_by_id, created_at, updated_at)
    VALUES (${createId()}, ${companyId}, ${r.clientId}, ${r.caregiverId}, ${r.visitDate}::date, ${r.startTime}::time, ${r.endTime}::time,
            ${r.scheduleId}, ${r.tasks}::json, ${r.note}, ${r.enteredById}, NOW(), NOW())
    ON CONFLICT (client_id, visit_date, start_time, caregiver_id) DO UPDATE
      SET end_time = EXCLUDED.end_time, schedule_id = EXCLUDED.schedule_id, tasks = EXCLUDED.tasks,
          note = EXCLUDED.note, entered_by_id = EXCLUDED.entered_by_id, updated_at = NOW()
    RETURNING id`))
  return row.id
}

/** Save many visits' notes in one transaction (the bulk fill). */
export async function upsertVisitDocs(db: any, companyId: string, list: VisitDocRow[]): Promise<void> {
  await db.transaction(async (tx: Q) => {
    for (const r of list) await upsertVisitDoc(tx, companyId, r)
  })
}

// ── Visit change requests (routes/visitChangeRequests.ts) ────────────────────────────────────

const VCR_COLS = sql.raw(`
  vcr.id, vcr.client_id, vcr.caregiver_id, vcr.request_type, vcr.visit_id, vcr.schedule_id,
  to_char(vcr.visit_date, 'YYYY-MM-DD') AS visit_date,
  to_char(vcr.original_start_time, 'HH24:MI:SS') AS original_start_time,
  to_char(vcr.original_end_time, 'HH24:MI:SS') AS original_end_time,
  vcr.cancel_reason,
  to_char(vcr.proposed_date, 'YYYY-MM-DD') AS proposed_date,
  to_char(vcr.proposed_start_time, 'HH24:MI:SS') AS proposed_start_time,
  to_char(vcr.proposed_end_time, 'HH24:MI:SS') AS proposed_end_time,
  to_char(vcr.counter_date, 'YYYY-MM-DD') AS counter_date,
  to_char(vcr.counter_start_time, 'HH24:MI:SS') AS counter_start_time,
  to_char(vcr.counter_end_time, 'HH24:MI:SS') AS counter_end_time,
  vcr.counter_message, vcr.status, vcr.requested_by, vcr.request_reason, vcr.applied_schedule_id,
  vcr.resolved_at, vcr.resolved_by_id, vcr.admin_notes, vcr.created_at, vcr.updated_at`)

/** One of the company's visit change requests. */
export async function changeRequestById(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${VCR_COLS} FROM visit_change_requests vcr WHERE vcr.id = ${id} AND vcr.company_id = ${companyId}`)) ?? null
}

/** The company's change requests with client and caregiver names: open ones (pending / counter-offered) unless `status` names one. */
export async function changeRequestList(q: Q, companyId: string, f: { caregiverId?: string | null; status?: string | null }): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ${VCR_COLS},
      c.first_name AS client_first_name, c.last_name AS client_last_name,
      u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name
    FROM visit_change_requests vcr
    JOIN clients c ON vcr.client_id = c.id
    JOIN "user" u ON vcr.caregiver_id = u.id
    WHERE vcr.company_id = ${companyId}
      ${f.caregiverId ? sql`AND vcr.caregiver_id = ${f.caregiverId}` : sql``}
      ${f.status ? sql`AND vcr.status = ${f.status}` : sql`AND vcr.status IN ('pending', 'counter_offered')`}
    ORDER BY vcr.created_at DESC`))
}

/** Is there a punch by this caregiver at this client clocked in on `visitDate` on the agency's clock (`tz`)? */
export async function workedOnDay(q: Q, companyId: string, caregiverId: string, clientId: string, visitDate: string, tz: string): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`SELECT id FROM time_entries
    WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND client_id = ${clientId}
      AND ${localDate(sql`start_time`, tz)} = ${visitDate}::date LIMIT 1`))[0]
  return !!r
}

/** A schedule row's occurrence on `visitDate`, resolved through that day's exception (caregiver, client, type). */
export async function occurrenceOfSchedule(q: Q, companyId: string, scheduleId: string, visitDate: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT s.id, COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id,
      COALESCE(se.override_client_id, s.client_id) AS client_id, se.exception_type
    FROM schedules s LEFT JOIN schedule_exceptions se ON se.schedule_id = s.id AND se.exception_date = ${visitDate}::date
    WHERE s.id = ${scheduleId} AND s.company_id = ${companyId} AND s.is_active = true`)) ?? null
}

/** Is that schedule's occurrence on `visitDate` one of this client's visits (through the engine)? */
export async function clientHasOccurrence(q: Q, companyId: string, clientId: string, scheduleId: string, visitDate: string): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`WITH ${occurrencesCte(companyId, visitDate, visitDate)}
    SELECT 1 AS ok FROM occ WHERE occ.schedule_id = ${scheduleId} AND occ.client_id = ${clientId}`))[0]
  return !!r
}

/** The open (pending / counter-offered) reschedule request for that occurrence, if any. */
export async function openRescheduleFor(q: Q, companyId: string, scheduleId: string, visitDate: string): Promise<{ id: string } | null> {
  return camelFirst(await q.execute(sql`SELECT id FROM visit_change_requests
    WHERE company_id = ${companyId} AND schedule_id = ${scheduleId} AND visit_date = ${visitDate}::date
      AND request_type = 'reschedule' AND status IN ('pending', 'counter_offered') LIMIT 1`)) ?? null
}

/** File a reschedule request (staff side). Returns its id. */
export async function insertRescheduleRequest(q: Q, companyId: string, r: {
  clientId: string; caregiverId: string; scheduleId: string; visitDate: string; startTime: string; endTime: string
  proposedDate: string; proposedStartTime: string; proposedEndTime: string; requestedBy: string; reason: string | null
}): Promise<string> {
  const id = createId()
  await q.execute(sql`INSERT INTO visit_change_requests (id, company_id, client_id, caregiver_id, request_type, schedule_id, visit_date, original_start_time, original_end_time,
      proposed_date, proposed_start_time, proposed_end_time, requested_by, request_reason, status, created_at, updated_at)
    VALUES (${id}, ${companyId}, ${r.clientId}, ${r.caregiverId}, 'reschedule', ${r.scheduleId}, ${r.visitDate}::date, ${r.startTime}::time, ${r.endTime}::time,
            ${r.proposedDate}::date, ${r.proposedStartTime}::time, ${r.proposedEndTime}::time, ${r.requestedBy}, ${r.reason}, 'pending', NOW(), NOW())`)
  return id
}

/** Cancel a scheduled_visits row (a family's materialised visit). */
export async function cancelScheduledVisit(q: Q, companyId: string, visitId: string, reason: string, actorId: string): Promise<void> {
  await q.execute(sql`UPDATE scheduled_visits SET status = 'cancelled', cancelled_reason = ${reason},
    cancelled_by = ${actorId}, cancelled_at = NOW(), updated_at = NOW() WHERE id = ${visitId} AND company_id = ${companyId}`)
}

/** Move a scheduled_visits row to its new date and times. */
export async function rescheduleScheduledVisit(q: Q, companyId: string, visitId: string, date: string, start: string, end: string): Promise<void> {
  await q.execute(sql`UPDATE scheduled_visits SET scheduled_date = ${date}::date, visit_date = ${date}::date,
    start_time = ${start}::time, end_time = ${end}::time, status = 'scheduled', updated_at = NOW() WHERE id = ${visitId} AND company_id = ${companyId}`)
}

/** Cancel one occurrence because the client asked (an existing exception for that day is left as it is). */
export async function insertClientCancelException(q: Q, companyId: string, scheduleId: string, visitDate: string, actorId: string): Promise<void> {
  await q.execute(sql`INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, created_by, cancel_reason, created_at)
    VALUES (${createId()}, ${companyId}, ${scheduleId}, ${visitDate}::date, 'cancelled', ${actorId}, 'client_cancelled', NOW())
    ON CONFLICT (schedule_id, exception_date) DO NOTHING`)
}

/** The schedule row an approved reschedule lands on: its weekday (null = one-time) and training flag. */
export async function scheduleForMove(q: Q, companyId: string, scheduleId: string): Promise<{ id: string; dayOfWeek: number | null; isTraining: boolean } | null> {
  return camelFirst(await q.execute(sql`SELECT id, day_of_week, COALESCE(is_training, false) AS is_training FROM schedules
    WHERE id = ${scheduleId} AND company_id = ${companyId} AND is_active = true`)) ?? null
}

/** Move a one-time schedule row in place. `startTs` / `endTs` are 'YYYY-MM-DD HH:MM:SS' wall-clock values. */
export async function moveOneTimeSchedule(q: Q, companyId: string, scheduleId: string, newDate: string, startTs: string, endTs: string): Promise<void> {
  await q.execute(sql`UPDATE schedules SET date = ${newDate}::date, start_time = ${startTs}::timestamp,
    end_time = ${endTs}::timestamp, updated_at = NOW() WHERE id = ${scheduleId} AND company_id = ${companyId}`)
}

/** That day of a recurring pattern runs at other times: a 'modified' exception carrying them. */
export async function upsertModifiedTimes(q: Q, companyId: string, scheduleId: string, visitDate: string, start: string, end: string, actorId: string): Promise<void> {
  await q.execute(sql`INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, override_start_time, override_end_time, created_by, created_at)
    VALUES (${createId()}, ${companyId}, ${scheduleId}, ${visitDate}::date, 'modified', ${start}::time, ${end}::time, ${actorId}, NOW())
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type = 'modified',
      override_start_time = EXCLUDED.override_start_time, override_end_time = EXCLUDED.override_end_time`)
}

/** That day of a recurring pattern does not happen (its overrides cleared). */
export async function upsertCancelledDay(q: Q, companyId: string, scheduleId: string, visitDate: string, actorId: string): Promise<void> {
  await q.execute(sql`INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, created_by, created_at)
    VALUES (${createId()}, ${companyId}, ${scheduleId}, ${visitDate}::date, 'cancelled', ${actorId}, NOW())
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type = 'cancelled', override_start_time = NULL, override_end_time = NULL`)
}

/** An active one-time shift for this caregiver and client on that day at exactly these times (the duplicate guard). */
export async function sameOneTimeShift(q: Q, companyId: string, caregiverId: string, clientId: string, date: string, start: string, end: string): Promise<{ id: string } | null> {
  return camelFirst(await q.execute(sql`SELECT id FROM schedules WHERE company_id = ${companyId} AND is_active = true AND day_of_week IS NULL
    AND caregiver_id = ${caregiverId} AND client_id = ${clientId} AND date = ${date}::date
    AND start_time::time = ${start}::time AND end_time::time = ${end}::time LIMIT 1`)) ?? null
}

/** A one-time shift on `date` (the moved visit). `startTs` / `endTs` are wall-clock timestamps. Returns its id. */
export async function insertOneTimeShift(q: Q, companyId: string, s: {
  caregiverId: string; clientId: string; date: string; startTs: string; endTs: string; notes: string; isTraining: boolean
}): Promise<string> {
  const id = createId()
  await q.execute(sql`INSERT INTO schedules (id, company_id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, is_training,
                                        is_active, status, frequency, created_at, updated_at)
    VALUES (${id}, ${companyId}, ${s.caregiverId}, ${s.clientId}, 'one-time', NULL, ${s.date}::date, ${s.startTs}::timestamp,
            ${s.endTs}::timestamp, ${s.notes}, ${s.isTraining}, true, 'active', 'weekly', NOW(), NOW())`)
  return id
}

/** The scheduled_visits row a schedule's occurrence became, if it was materialised already. */
export async function materializedVisitOf(q: Q, companyId: string, scheduleId: string, visitDate: string, clientId: string): Promise<{ id: string } | null> {
  return camelFirst(await q.execute(sql`SELECT id FROM scheduled_visits WHERE company_id = ${companyId} AND source_schedule_id = ${scheduleId}
    AND scheduled_date = ${visitDate}::date AND client_id = ${clientId}`)) ?? null
}

/** Make a schedule's occurrence a real scheduled_visits row. Returns its id. */
export async function insertMaterializedVisit(q: Q, companyId: string, v: {
  scheduleId: string; visitDate: string; clientId: string; caregiverId: string; startTime: string | null; endTime: string | null
}): Promise<string> {
  const id = createId()
  await q.execute(sql`INSERT INTO scheduled_visits (id, company_id, client_id, caregiver_id, visit_date, scheduled_date, start_time, end_time, status, source_schedule_id, created_at, updated_at)
    VALUES (${id}, ${companyId}, ${v.clientId}, ${v.caregiverId}, ${v.visitDate}::date, ${v.visitDate}::date, ${v.startTime}::time, ${v.endTime}::time, 'scheduled', ${v.scheduleId}, NOW(), NOW())`)
  return id
}

/** Record which schedule an approved reschedule landed on. */
export async function setAppliedSchedule(q: Q, companyId: string, id: string, scheduleId: string): Promise<void> {
  await q.execute(sql`UPDATE visit_change_requests SET applied_schedule_id = ${scheduleId} WHERE id = ${id} AND company_id = ${companyId}`)
}

/** Close a request as approved or denied, by whom, with the office's note. */
export async function resolveChangeRequest(q: Q, companyId: string, id: string, status: 'approved' | 'denied', actorId: string, adminNotes: string | null): Promise<void> {
  await q.execute(sql`UPDATE visit_change_requests SET status = ${status}, resolved_at = NOW(), resolved_by_id = ${actorId},
    admin_notes = ${adminNotes}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
}

/** Answer a request with another day and time. */
export async function counterChangeRequest(q: Q, companyId: string, id: string, c: { date: string; start: string; end: string; message: string | null; adminNotes: string | null }): Promise<void> {
  await q.execute(sql`UPDATE visit_change_requests SET status = 'counter_offered', counter_date = ${c.date}::date,
    counter_start_time = ${c.start}::time, counter_end_time = ${c.end}::time,
    counter_message = ${c.message}, admin_notes = ${c.adminNotes}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
}

// ── Sandata (routes/sandata.ts) ──────────────────────────────────────────────────────────────

/** The caregiver's active clients (an active assignment or schedule), with what decides whether they are in Sandata. */
export async function caregiverSandataClients(q: Q, companyId: string, caregiverId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.is_private_pay, c.medicaid_id, rs.sandata_evv_required
      FROM clients c
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
     WHERE c.company_id = ${companyId} AND c.is_active = true
       AND (EXISTS (SELECT 1 FROM client_assignments ca
                     WHERE ca.client_id = c.id AND ca.caregiver_id = ${caregiverId} AND ca.status = 'active')
            OR EXISTS (SELECT 1 FROM schedules s
                        WHERE s.client_id = c.id AND s.caregiver_id = ${caregiverId} AND s.is_active = true))
     ORDER BY c.first_name, c.last_name`))
}

/** The company's EVV records with a service date in the range, with client, caregiver and worker ids. */
export async function evvVisitsInRange(q: Q, companyId: string, start: string, end: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ev.*, to_char(ev.service_date, 'YYYY-MM-DD') AS service_date,
           c.first_name AS client_first, c.last_name AS client_last, c.medicaid_id,
           u.first_name AS cg_first, u.last_name AS cg_last,
           cp.evv_worker_id, cp.npi_number
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN "user" u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
     WHERE ev.company_id = ${companyId} AND ev.service_date BETWEEN ${start}::date AND ${end}::date
     ORDER BY ev.service_date DESC, ev.actual_start DESC`))
}

/** One EVV record with its client, caregiver, worker ids and authorization. */
export async function evvVisitDetail(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT ev.*, to_char(ev.service_date, 'YYYY-MM-DD') AS service_date,
           c.first_name AS client_first, c.last_name AS client_last, c.medicaid_id, c.evv_client_id,
           u.first_name AS cg_first, u.last_name AS cg_last,
           cp.evv_worker_id, cp.npi_number,
           a.auth_number, a.authorized_units, a.used_units, to_char(a.end_date, 'YYYY-MM-DD') AS auth_expires
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN "user" u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON ev.authorization_id = a.id
     WHERE ev.id = ${id} AND ev.company_id = ${companyId}`)) ?? null
}

/** A punch's time changes, oldest first, with who made each (by name). */
export async function visitTimeChangesNamed(q: Q, companyId: string, timeEntryId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT vtc.*, u.first_name AS changed_by_first, u.last_name AS changed_by_last
      FROM visit_time_changes vtc LEFT JOIN "user" u ON u.id = vtc.changed_by_id
     WHERE vtc.company_id = ${companyId} AND vtc.time_entry_id = ${timeEntryId}
     ORDER BY vtc.changed_at ASC`))
}

/** Active, non-private-pay clients whose payer is a Sandata payer (or who have none), with payer and care-type codes. */
export async function sandataScopeClients(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.medicaid_id,
           rs.name AS payer_name, rs.sandata_payer_id, rs.sandata_payer_program,
           ct.name AS care_type, ct.default_service_code
      FROM clients c
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
     WHERE c.company_id = ${companyId} AND c.is_active = true
       AND COALESCE(c.is_private_pay, false) = false
       AND (rs.id IS NULL OR rs.sandata_evv_required = true OR NULLIF(TRIM(rs.sandata_payer_id), '') IS NOT NULL)
     ORDER BY c.last_name, c.first_name`))
}

/** The company's active people with their EVV worker id (the caller keeps the caregivers: their role is normalised in code). */
export async function activeUsersWithWorkerId(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT u.id, u.first_name, u.last_name, u.role, cp.evv_worker_id
      FROM "user" u LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
     WHERE u.company_id = ${companyId} AND u.is_active = true
     ORDER BY u.last_name, u.first_name`))
}

/** Every care type with its service code and how many active clients it has. */
export async function careTypeClientCounts(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ct.name, ct.default_service_code, COUNT(c.id)::int AS active_clients
      FROM care_types ct
      LEFT JOIN clients c ON c.care_type_id = ct.id AND c.is_active = true
     WHERE ct.company_id = ${companyId}
     GROUP BY ct.id, ct.name, ct.default_service_code
     ORDER BY active_clients DESC`))
}

/** EVV records since a date, counted by Sandata status. */
export async function evvStatusCountsSince(q: Q, companyId: string, since: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT sandata_status, COUNT(*)::int AS n
      FROM evv_visits WHERE company_id = ${companyId} AND service_date >= ${since}::date
     GROUP BY sandata_status`))
}

/** A client as a Sandata client record needs it: the client row, its payer's codes and its care type's service code. */
export async function clientForSandataSync(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT c.*, rs.sandata_payer_id, rs.sandata_payer_program, ct.default_service_code
      FROM clients c
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
     WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}

/** The last 30 days' failed submissions (50), with the visit's client and caregiver. */
export async function recentQueueFailures(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT sq.*, to_char(ev.service_date, 'YYYY-MM-DD') AS service_date,
           c.first_name AS client_first, c.last_name AS client_last,
           u.first_name AS cg_first, u.last_name AS cg_last
      FROM sandata_submission_queue sq
      JOIN evv_visits ev ON sq.evv_visit_id = ev.id
      JOIN clients c ON ev.client_id = c.id
      JOIN "user" u ON ev.caregiver_id = u.id
     WHERE sq.company_id = ${companyId} AND sq.status = 'failed'
       AND sq.completed_at > (now() AT TIME ZONE 'UTC') - INTERVAL '30 days'
     ORDER BY sq.completed_at DESC
     LIMIT 50`))
}

/** EVV records in the range with their queue item's status, retries, last error and path. */
export async function submissionStatusVisits(q: Q, companyId: string, start: string, end: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ev.id, to_char(ev.service_date, 'YYYY-MM-DD') AS service_date, ev.sandata_status, ev.sandata_visit_id,
           ev.sandata_submitted_at, ev.auto_submit_enabled,
           c.first_name AS client_first, c.last_name AS client_last,
           u.first_name AS cg_first, u.last_name AS cg_last,
           sq.status AS queue_status, sq.retry_count, sq.last_error, sq.submission_path
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN "user" u ON ev.caregiver_id = u.id
      LEFT JOIN sandata_submission_queue sq ON sq.evv_visit_id = ev.id
     WHERE ev.company_id = ${companyId} AND ev.service_date BETWEEN ${start}::date AND ${end}::date
     ORDER BY ev.service_date DESC, ev.actual_start DESC`))
}
