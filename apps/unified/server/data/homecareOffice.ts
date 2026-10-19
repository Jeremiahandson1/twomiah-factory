// Home care's office group's SQL: the incident case file (templates/crm-homecare/backend/src/routes/incidents.ts, which
// ran every query raw against its one-agency database). Raw SQL lives here (RULEBOOK §2); every read and write is
// scoped to the company and every read answers in camelCase. DATE columns are still selected as text (to_char), so no
// server time zone can shift a day.
//
// Changes from the template, all for the same reason (one database, many companies' rows): `users` is "user", every
// table is filtered on company_id and every insert writes it, and the incident number's per-year counter is per
// company (incident_number_counters is unique on company_id + year).
import { sql, type SQL } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, camelFirst, rowsOf } from '@twomiah/tenant-backend'
import { inList, occurrencesCte, type Q } from './homecareCore.ts'

const orNull = (v: unknown): any => (v === undefined || v === null || String(v).trim() === '' ? null : v)

// ── Reads of the incident ──────────────────────────────────────────────────────────────────────

// Every incident read: the row, DATE columns as text, and the names.
const INCIDENT_SELECT = sql`
  i.*,
  i.investigation_status                          AS status,
  to_char(i.date, 'YYYY-MM-DD')                   AS incident_date_ymd,
  to_char(i.reported_date, 'YYYY-MM-DD')          AS reported_date_ymd,
  to_char(i.response_due_date, 'YYYY-MM-DD')      AS response_due_date_ymd,
  to_char(i.response_sent_date, 'YYYY-MM-DD')     AS response_sent_date_ymd,
  to_char(i.resolved_at, 'YYYY-MM-DD')            AS closed_date_ymd,
  to_char(i.caregiver_removed_from, 'YYYY-MM-DD') AS caregiver_removed_from_ymd,
  to_char(i.caregiver_returned_on, 'YYYY-MM-DD')  AS caregiver_returned_on_ymd,
  to_char(i.incident_time, 'HH24:MI')             AS incident_time_hhmm,
  NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS client_name,
  NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS caregiver_name,
  NULLIF(TRIM(COALESCE(ru.first_name, '') || ' ' || COALESCE(ru.last_name, '')), '') AS entered_by_name,
  ru.role AS reported_by_role`
const INCIDENT_FROM = sql`
  FROM incidents i
  LEFT JOIN clients c ON c.id = i.client_id AND c.company_id = i.company_id
  LEFT JOIN "user" u ON u.id = i.caregiver_id
  LEFT JOIN "user" ru ON ru.id = i.reported_by_id`

/** The office dashboard's figures. */
export async function incidentSummary(q: Q, companyId: string) {
  const [total, bySeverity, byType, followUp, monthly, byClient] = await Promise.all([
    q.execute(sql`SELECT COUNT(*)::int AS total FROM incidents WHERE company_id = ${companyId}`),
    q.execute(sql`SELECT severity, COUNT(*)::int AS count FROM incidents WHERE company_id = ${companyId} GROUP BY severity
                   ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'severe' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 END`),
    q.execute(sql`SELECT incident_type, COUNT(*)::int AS count FROM incidents WHERE company_id = ${companyId} GROUP BY incident_type ORDER BY count DESC`),
    q.execute(sql`SELECT COUNT(*)::int AS pending_followup FROM incidents WHERE company_id = ${companyId} AND follow_up_required = true`),
    q.execute(sql`SELECT to_char(DATE_TRUNC('month', date), 'YYYY-MM-DD') AS month, COUNT(*)::int AS count,
                          COUNT(CASE WHEN severity IN ('critical', 'severe') THEN 1 END)::int AS serious_count
                     FROM incidents WHERE company_id = ${companyId} GROUP BY 1 ORDER BY 1 DESC LIMIT 12`),
    q.execute(sql`SELECT c.id, c.first_name || ' ' || c.last_name AS client_name, COUNT(i.id)::int AS incident_count
                     FROM clients c JOIN incidents i ON i.client_id = c.id AND i.company_id = c.company_id
                    WHERE c.company_id = ${companyId}
                    GROUP BY c.id, c.first_name, c.last_name ORDER BY incident_count DESC LIMIT 10`),
  ])
  return {
    total: rowsOf(total)[0]?.total ?? 0,
    bySeverity: camelRows(bySeverity),
    byType: camelRows(byType),
    pendingFollowUp: rowsOf(followUp)[0]?.pending_followup ?? 0,
    monthlyTrend: camelRows(monthly),
    topClients: camelRows(byClient),
  }
}

/** Payer responses due on or before `through` (or overdue) and not yet sent, on cases still open. */
export async function incidentResponsesDue(q: Q, companyId: string, through: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT i.id, i.incident_number, to_char(i.response_due_date, 'YYYY-MM-DD') AS response_due_date_ymd,
           i.reported_by, NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS client_name
      FROM incidents i LEFT JOIN clients c ON c.id = i.client_id AND c.company_id = i.company_id
     WHERE i.company_id = ${companyId}
       AND COALESCE(i.investigation_status, 'open') <> 'closed'
       AND i.response_due_date IS NOT NULL AND i.response_sent_date IS NULL
       AND i.response_due_date <= ${through}::date
     ORDER BY i.response_due_date`))
}

/**
 * May this caregiver file a field report for the client whose id is `clientCol`? Assigned, scheduled, covering from
 * today on, or worked there in the last 30 days (the incident form's own rule, wider than the care-record rule: a
 * caregiver who visited last week may report what they saw).
 */
const reportableBy = (companyId: string, caregiverId: string, today: string, clientCol: SQL = sql.raw('c.id')): SQL => sql`(
     EXISTS (SELECT 1 FROM schedules s2 WHERE s2.company_id = ${companyId} AND s2.client_id = ${clientCol} AND s2.caregiver_id = ${caregiverId} AND s2.is_active = true)
  OR EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.company_id = ${companyId} AND ca.client_id = ${clientCol} AND ca.caregiver_id = ${caregiverId} AND ca.status = 'active')
  OR EXISTS (SELECT 1 FROM schedule_exceptions se JOIN schedules s3 ON s3.id = se.schedule_id AND s3.is_active = true
              WHERE s3.company_id = ${companyId} AND se.override_caregiver_id = ${caregiverId} AND se.exception_type = 'modified'
                AND COALESCE(se.override_client_id, s3.client_id) = ${clientCol}
                AND se.exception_date >= ${today}::date)
  OR EXISTS (SELECT 1 FROM time_entries te WHERE te.company_id = ${companyId} AND te.client_id = ${clientCol} AND te.caregiver_id = ${caregiverId}
                AND te.start_time >= NOW() - INTERVAL '30 days'))`

/** The active clients a field report may be filed for: every one for the office (`caregiverId` null), else the caregiver's. */
export async function reportableClients(q: Q, companyId: string, caregiverId: string | null, today: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name FROM clients c
     WHERE c.company_id = ${companyId} AND c.is_active = true
       ${caregiverId ? sql`AND ${reportableBy(companyId, caregiverId, today)}` : sql``}
     ORDER BY c.last_name, c.first_name`))
}

/** May this caregiver file a field report for this (active) client? */
export async function caregiverMayReportFor(q: Q, companyId: string, caregiverId: string, clientId: string, today: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`
    SELECT 1 FROM clients c
     WHERE c.id = ${clientId} AND c.company_id = ${companyId} AND c.is_active = true
       AND ${reportableBy(companyId, caregiverId, today)}`)).length > 0
}

/** The company's incidents, newest first, with their note and attachment counts (signature included: the route strips it). */
export async function listIncidents(q: Q, companyId: string, f: { status?: string; severity?: string }): Promise<any[]> {
  const where: SQL[] = [sql`i.company_id = ${companyId}`]
  if (f.status) where.push(sql`i.investigation_status = ${f.status}`)
  if (f.severity) where.push(sql`i.severity = ${f.severity}`)
  return camelRows(await q.execute(sql`
    SELECT ${INCIDENT_SELECT},
           (SELECT COUNT(*)::int FROM incident_investigation_notes n WHERE n.incident_id = i.id AND n.company_id = i.company_id) AS note_count,
           (SELECT COUNT(*)::int FROM incident_attachments a WHERE a.incident_id = i.id AND a.company_id = i.company_id) AS attachment_count
    ${INCIDENT_FROM}
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY i.date DESC, i.incident_time DESC NULLS LAST, i.created_at DESC
    LIMIT 500`))
}

/** One incident as the case view reads it (with the client's payer), or null. */
export async function incidentCase(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT ${INCIDENT_SELECT}, c.is_private_pay, rs.name AS payer_name
    ${INCIDENT_FROM}
    LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id AND rs.company_id = i.company_id
    WHERE i.id = ${id} AND i.company_id = ${companyId}`)) ?? null
}

/** The stored row, as it is (camelCase), or null. `forUpdate` locks it inside a transaction. */
export async function incidentRow(q: Q, companyId: string, id: string, forUpdate = false): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT * FROM incidents WHERE id = ${id} AND company_id = ${companyId} ${forUpdate ? sql`FOR UPDATE` : sql``}`)) ?? null
}

// ── Writing the incident ───────────────────────────────────────────────────────────────────────

/**
 * Next IR-<year>-<nnn> for this company. A per-year high-water mark (incident_number_counters), bumped in the same
 * transaction as the insert: never MAX+1 over the rows that still exist, which would hand a deleted incident's number
 * — possibly already in a payer's file — to a different incident.
 */
export async function nextIncidentNumber(q: Q, companyId: string, incidentDate: string): Promise<string> {
  const y = Number(String(incidentDate).slice(0, 4))
  const [r] = rowsOf(await q.execute(sql`
    INSERT INTO incident_number_counters (id, company_id, year, last_number)
    VALUES (${createId()}, ${companyId}, ${y}, (SELECT COALESCE(MAX(split_part(incident_number, '-', 3)::int), 0) + 1
                     FROM incidents WHERE company_id = ${companyId} AND incident_number ~ ${`^IR-${y}-[0-9]+$`}))
    ON CONFLICT (company_id, year) DO UPDATE
      SET last_number = GREATEST(incident_number_counters.last_number + 1, EXCLUDED.last_number)
    RETURNING last_number`))
  return `IR-${y}-${String(r.last_number).padStart(3, '0')}`
}

/** A new incident (numbered here), as stored. `b` is the validated form (camelCase, as the screen sends it). */
export async function insertIncident(q: Q, companyId: string, b: any, reportedById: string, status = 'open'): Promise<any> {
  const num = await nextIncidentNumber(q, companyId, b.incidentDate)
  return camelFirst(await q.execute(sql`
    INSERT INTO incidents (id, company_id, incident_number, client_id, caregiver_id, incident_type, severity, date, incident_time,
      description, witnesses, injuries_or_damage, action_taken, follow_up_required, follow_up_notes, reported_by, reported_date,
      reported_by_id, investigation_status, reporter_contact_name, reporter_phone, reporter_email, response_due_date)
    VALUES (${createId()}, ${companyId}, ${num}, ${b.clientId}, ${orNull(b.caregiverId)}, ${b.incidentType}, ${b.severity || 'moderate'},
      ${b.incidentDate}::date, ${orNull(b.incidentTime)}::time, ${String(b.description).trim()}, ${orNull(b.witnesses)},
      ${orNull(b.injuriesOrDamage)}, ${orNull(b.actionsTaken)}, ${!!b.followUpRequired}, ${orNull(b.followUpNotes)},
      ${orNull(b.reportedBy)}, ${orNull(b.reportedDate)}::date, ${reportedById}, ${status},
      ${orNull(b.reporterContactName)}, ${orNull(b.reporterPhone)}, ${orNull(b.reporterEmail)}, ${orNull(b.responseDueDate)}::date)
    RETURNING *`))
}

/** The full edit of the case fields (PUT). `closedDate` / `resolvedById` are decided by the route. */
export async function updateIncidentCase(q: Q, companyId: string, id: string, b: any, o: { severity: string; status: string; closedDate: string | null; resolvedById: string | null }): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    UPDATE incidents SET
      client_id = ${b.clientId}, caregiver_id = ${orNull(b.caregiverId)}, incident_type = ${b.incidentType},
      severity = ${o.severity}, date = ${b.incidentDate}::date, incident_time = ${orNull(b.incidentTime)}::time,
      description = ${String(b.description).trim()}, witnesses = ${orNull(b.witnesses)}, injuries_or_damage = ${orNull(b.injuriesOrDamage)},
      action_taken = ${orNull(b.actionsTaken)}, follow_up_required = ${!!b.followUpRequired}, follow_up_notes = ${orNull(b.followUpNotes)},
      reported_by = ${orNull(b.reportedBy)}, reported_date = ${orNull(b.reportedDate)}::date,
      reporter_contact_name = ${orNull(b.reporterContactName)}, reporter_phone = ${orNull(b.reporterPhone)}, reporter_email = ${orNull(b.reporterEmail)},
      response_due_date = ${orNull(b.responseDueDate)}::date, response_sent_date = ${orNull(b.responseSentDate)}::date,
      investigation_status = ${o.status}, disposition = ${orNull(b.disposition)}, findings = ${orNull(b.findings)},
      mandatory_report_status = ${orNull(b.mandatoryReportStatus)}, mandatory_report_details = ${orNull(b.mandatoryReportDetails)},
      resolved_at = ${o.closedDate}::date, resolved_by_id = ${o.resolvedById},
      payer_response_notes = ${orNull(b.payerResponseNotes)}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId} RETURNING *`)) ?? null
}

/** The legacy PATCH: fills only what it is given (COALESCE), so it can never clear a field. */
export async function patchIncident(q: Q, companyId: string, id: string, b: any): Promise<any | null> {
  const followUp = typeof b.followUpRequired === 'boolean' ? b.followUpRequired : null
  return camelFirst(await q.execute(sql`
    UPDATE incidents SET severity = COALESCE(${orNull(b.severity)}, severity),
      injuries_or_damage = COALESCE(${orNull(b.injuriesOrDamage)}, injuries_or_damage),
      action_taken = COALESCE(${orNull(b.actionsTaken)}, action_taken),
      follow_up_required = COALESCE(${followUp}::boolean, follow_up_required),
      follow_up_notes = COALESCE(${orNull(b.followUpNotes)}, follow_up_notes), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId} RETURNING *`)) ?? null
}

export async function deleteIncident(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`DELETE FROM incidents WHERE id = ${id} AND company_id = ${companyId} RETURNING *`)) ?? null
}

// ── The investigation timeline ─────────────────────────────────────────────────────────────────

/** One timeline entry. `entryDate` is the agency's YYYY-MM-DD. */
export async function insertTimelineEntry(q: Q, companyId: string, incidentId: string, e: { entryDate: string; entryType: string; summary: string; byId: string }): Promise<any> {
  return camelFirst(await q.execute(sql`
    INSERT INTO incident_investigation_notes (id, company_id, incident_id, entry_date, entry_type, summary, created_by_id)
    VALUES (${createId()}, ${companyId}, ${incidentId}, ${e.entryDate}::date, ${e.entryType}, ${e.summary}, ${e.byId}) RETURNING *`))
}

export async function timelineEntries(q: Q, companyId: string, incidentId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT n.id, n.incident_id, n.entry_type, n.summary, n.created_at,
           to_char(n.entry_date, 'YYYY-MM-DD') AS entry_date_ymd,
           NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS created_by_name
      FROM incident_investigation_notes n
      LEFT JOIN "user" u ON u.id = n.created_by_id
     WHERE n.incident_id = ${incidentId} AND n.company_id = ${companyId}
     ORDER BY n.entry_date, n.created_at`))
}

export async function deleteTimelineEntry(q: Q, companyId: string, incidentId: string, noteId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    DELETE FROM incident_investigation_notes
     WHERE id = ${noteId} AND incident_id = ${incidentId} AND company_id = ${companyId} RETURNING *`)) ?? null
}

// ── Attachments (stored in the database as data URIs) ──────────────────────────────────────────

export async function attachmentIndex(q: Q, companyId: string, incidentId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT a.id, a.incident_id, a.category, a.file_name, a.mime_type, a.file_size, a.description, a.created_at,
           NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS uploaded_by_name
      FROM incident_attachments a
      LEFT JOIN "user" u ON u.id = a.uploaded_by_id
     WHERE a.incident_id = ${incidentId} AND a.company_id = ${companyId}
     ORDER BY a.created_at`))
}

export async function attachmentFile(q: Q, companyId: string, incidentId: string, attachmentId: string): Promise<{ fileName: string; mimeType: string; fileData: string } | null> {
  return camelFirst(await q.execute(sql`
    SELECT file_name, mime_type, file_data FROM incident_attachments
     WHERE id = ${attachmentId} AND incident_id = ${incidentId} AND company_id = ${companyId}`)) ?? null
}

export async function insertAttachment(q: Q, companyId: string, incidentId: string, a: { category: string; fileName: string; mimeType: string; fileSize: number; dataUri: string; description: string | null; byId: string }): Promise<any> {
  return camelFirst(await q.execute(sql`
    INSERT INTO incident_attachments (id, company_id, incident_id, category, file_name, mime_type, file_size, file_data, description, uploaded_by_id)
    VALUES (${createId()}, ${companyId}, ${incidentId}, ${a.category}, ${a.fileName}, ${a.mimeType}, ${a.fileSize},
            ${a.dataUri}, ${a.description}, ${a.byId})
    RETURNING id, incident_id, category, file_name, mime_type, file_size, description, created_at`))
}

export async function deleteAttachment(q: Q, companyId: string, incidentId: string, attachmentId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    DELETE FROM incident_attachments WHERE id = ${attachmentId} AND incident_id = ${incidentId} AND company_id = ${companyId}
    RETURNING id, incident_id, category, file_name, mime_type, file_size, description`)) ?? null
}

// ── The caregiver's schedule with this client ──────────────────────────────────────────────────

/** The incident's caregiver, client and removal record, dates as text. */
export async function incidentRemovalState(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT i.client_id, i.caregiver_id, i.caregiver_removal,
           to_char(i.caregiver_removed_from, 'YYYY-MM-DD') AS removed_from,
           to_char(i.caregiver_returned_on, 'YYYY-MM-DD') AS returned_on
      FROM incidents i WHERE i.id = ${id} AND i.company_id = ${companyId}`)) ?? null
}

/** The caregiver's current rows for this client (and any the removal paused), wall-clock times as text. */
export async function caregiverClientSchedules(q: Q, companyId: string, o: { caregiverId: string; clientId: string; today: string; pausedIds: string[] }): Promise<any[]> {
  const paused = o.pausedIds.length ? sql`OR s.id IN (${inList(o.pausedIds)})` : sql``
  return camelRows(await q.execute(sql`
    SELECT s.id, s.day_of_week, to_char(s.date, 'YYYY-MM-DD') AS date,
           to_char(s.start_time, 'HH24:MI:SS') AS start_time, to_char(s.end_time, 'HH24:MI:SS') AS end_time,
           s.frequency, to_char(s.end_date, 'YYYY-MM-DD') AS end_date, s.is_active
      FROM schedules s
     WHERE s.company_id = ${companyId} AND s.caregiver_id = ${o.caregiverId} AND s.client_id = ${o.clientId}
       AND ((s.is_active = true AND ((s.day_of_week IS NULL AND s.date >= ${o.today}::date)
            OR (s.day_of_week IS NOT NULL AND (s.end_date IS NULL OR s.end_date >= ${o.today}::date))))
            ${paused})
     ORDER BY s.day_of_week NULLS LAST, s.date, s.start_time`))
}

/** This caregiver's visits at this client between two dates, through the schedule engine. */
export async function caregiverClientVisitCount(q: Q, companyId: string, caregiverId: string, clientId: string, from: string, to: string): Promise<number> {
  const r = rowsOf(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to)}
    SELECT COUNT(*)::int AS n FROM occ WHERE occ.caregiver_id = ${caregiverId} AND occ.client_id = ${clientId}`))[0]
  return Number(r?.n || 0)
}

// ── Remove the caregiver from this client pending investigation ────────────────────────────────

/** The incident locked for a removal or a return, with the two names. */
export async function lockIncidentForRemoval(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT i.id, i.incident_number, i.client_id, i.caregiver_id, i.caregiver_removal,
           to_char(i.caregiver_removed_from, 'YYYY-MM-DD') AS removed_from, i.caregiver_returned_on,
           c.first_name || ' ' || c.last_name AS client_name,
           u.first_name || ' ' || u.last_name AS caregiver_name
      FROM incidents i
      LEFT JOIN clients c ON c.id = i.client_id AND c.company_id = i.company_id
      LEFT JOIN "user" u ON u.id = i.caregiver_id
     WHERE i.id = ${id} AND i.company_id = ${companyId}
     FOR UPDATE OF i`)) ?? null
}

/** The caregiver's rows at this client still running on/after `fromDate`, locked. */
export async function removalTargets(q: Q, companyId: string, caregiverId: string, clientId: string, fromDate: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT id, day_of_week, to_char(end_date, 'YYYY-MM-DD') AS end_date
      FROM schedules
     WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND client_id = ${clientId} AND is_active = true
       AND ((day_of_week IS NULL AND date >= ${fromDate}::date)
            OR (day_of_week IS NOT NULL AND (end_date IS NULL OR end_date >= ${fromDate}::date)))
     FOR UPDATE`))
}

/** The caregiver's own visits on these rows between two dates (shiftDate, startTime, endTime as text). */
export async function ownVisitsOn(q: Q, companyId: string, scheduleIds: string[], caregiverId: string, from: string, to: string): Promise<any[]> {
  if (!scheduleIds.length) return []
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to)}
    SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS shift_date,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time
      FROM occ
     WHERE occ.schedule_id IN (${inList(scheduleIds)}) AND occ.caregiver_id = ${caregiverId}
     ORDER BY occ.occ_date, occ.start_time`))
}

/** Days on these rows from `fromDate` already covered by ANOTHER caregiver (a per-day override). */
export async function coversByOthers(q: Q, companyId: string, scheduleIds: string[], caregiverId: string, fromDate: string): Promise<any[]> {
  if (!scheduleIds.length) return []
  return camelRows(await q.execute(sql`
    SELECT se.id AS exception_id, se.schedule_id, to_char(se.exception_date, 'YYYY-MM-DD') AS d,
           to_char(COALESCE(se.override_start_time, s.start_time::time), 'HH24:MI:SS') AS start_time,
           to_char(COALESCE(se.override_end_time, s.end_time::time), 'HH24:MI:SS') AS end_time,
           se.override_caregiver_id, COALESCE(se.override_client_id, s.client_id) AS client_id, s.notes
      FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id
     WHERE s.company_id = ${companyId} AND se.schedule_id IN (${inList(scheduleIds)}) AND se.exception_type = 'modified'
       AND se.override_caregiver_id IS NOT NULL AND se.override_caregiver_id <> ${caregiverId}
       AND se.exception_date >= ${fromDate}::date`))
}

/** Days from `fromDate` the caregiver covers on OTHER caregivers' rows at this client. */
export async function coversHeldElsewhere(q: Q, companyId: string, caregiverId: string, clientId: string, fromDate: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT se.id AS exception_id, se.schedule_id, to_char(se.exception_date, 'YYYY-MM-DD') AS d,
           to_char(COALESCE(se.override_start_time, s.start_time::time), 'HH24:MI:SS') AS start_time,
           to_char(COALESCE(se.override_end_time, s.end_time::time), 'HH24:MI:SS') AS end_time
      FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id AND s.is_active = true
     WHERE s.company_id = ${companyId} AND se.exception_type = 'modified' AND se.override_caregiver_id = ${caregiverId}
       AND COALESCE(se.override_client_id, s.client_id) = ${clientId}
       AND s.caregiver_id <> ${caregiverId}
       AND se.exception_date >= ${fromDate}::date
       AND (s.end_date IS NULL OR se.exception_date <= s.end_date)`))
}

/** A covered day turned into the covering caregiver's own one-time visit; returns its id. */
export async function insertOneTimeVisit(q: Q, companyId: string, v: { clientId: string; caregiverId: string; date: string; startTime: string; endDate: string; endTime: string; notes: string | null }): Promise<string> {
  const id = createId()
  await q.execute(sql`
    INSERT INTO schedules (id, company_id, client_id, caregiver_id, schedule_type, date, start_time, end_time, notes)
    VALUES (${id}, ${companyId}, ${v.clientId}, ${v.caregiverId}, 'one-time', ${v.date}::date,
            ${`${v.date} ${v.startTime}`}::timestamp, ${`${v.endDate} ${v.endTime}`}::timestamp, ${v.notes})`)
  return id
}

/** Set one exception's type ('cancelled' to release a cover, 'modified' to give it back). Only from `onlyFrom` when given. */
export async function setExceptionType(q: Q, companyId: string, exceptionId: string, type: string, onlyFrom?: string): Promise<number> {
  return rowsOf(await q.execute(sql`
    UPDATE schedule_exceptions SET exception_type = ${type}
     WHERE id = ${exceptionId} AND company_id = ${companyId} ${onlyFrom ? sql`AND exception_type = ${onlyFrom}` : sql``}
    RETURNING id`)).length
}

/** End these recurring rows on `lastDay`. */
export async function endPatterns(q: Q, companyId: string, ids: string[], lastDay: string): Promise<void> {
  if (!ids.length) return
  await q.execute(sql`UPDATE schedules SET end_date = ${lastDay}::date, updated_at = NOW() WHERE company_id = ${companyId} AND id IN (${inList(ids)})`)
}

/** Take these one-time rows off the schedule. */
export async function deactivateVisits(q: Q, companyId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  await q.execute(sql`UPDATE schedules SET is_active = false, updated_at = NOW() WHERE company_id = ${companyId} AND id IN (${inList(ids)})`)
}

/** Is there already a live open shift for this client at this date and start time? */
export async function openShiftAlreadyPosted(q: Q, companyId: string, clientId: string, date: string, startTime: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`
    SELECT id FROM open_shifts WHERE company_id = ${companyId} AND client_id = ${clientId} AND date = ${date}::date AND start_time = ${startTime}::time
       AND status IN ('open', 'claimed', 'filled') LIMIT 1`)).length > 0
}

/** Post one visit for coverage. Notes are shown to caregivers browsing open shifts: kept neutral. Returns its id. */
export async function postCoverageShift(q: Q, companyId: string, o: { clientId: string; date: string; startTime: string; endTime: string; byId: string }): Promise<string> {
  const id = createId()
  await q.execute(sql`
    INSERT INTO open_shifts (id, company_id, client_id, date, start_time, end_time, status, notes, auto_created, created_by_id)
    VALUES (${id}, ${companyId}, ${o.clientId}, ${o.date}::date, ${o.startTime}::time, ${o.endTime}::time, 'open', 'Coverage needed', true, ${o.byId})`)
  return id
}

/** Record the removal on the incident (the JSON keeps the template's keys, so moved tenants' records read the same). */
export async function markCaregiverRemoved(q: Q, companyId: string, id: string, fromDate: string, removal: unknown): Promise<void> {
  await q.execute(sql`
    UPDATE incidents SET caregiver_removed_from = ${fromDate}::date, caregiver_returned_on = NULL,
           caregiver_removal = ${JSON.stringify(removal)}::json, updated_at = NOW()
     WHERE id = ${id} AND company_id = ${companyId}`)
}

// ── Return the caregiver ───────────────────────────────────────────────────────────────────────

/** Put a one-time row back, if nobody changed it since. True when restored. */
export async function restoreOneTimeVisit(q: Q, companyId: string, scheduleId: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`UPDATE schedules SET is_active = true, updated_at = NOW()
    WHERE id = ${scheduleId} AND company_id = ${companyId} AND is_active = false RETURNING id`)).length > 0
}

/** Give a recurring row its prior end date back, if it still ends where the removal ended it. True when restored. */
export async function restorePatternEnd(q: Q, companyId: string, scheduleId: string, priorEndDate: string | null, removalEnd: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`UPDATE schedules SET end_date = ${priorEndDate}::date, updated_at = NOW()
    WHERE id = ${scheduleId} AND company_id = ${companyId} AND is_active = true AND end_date = ${removalEnd}::date RETURNING id`)).length > 0
}

/** An open shift's status and date (text), or null. */
export async function openShiftState(q: Q, companyId: string, id: string): Promise<{ status: string; d: string } | null> {
  return camelFirst(await q.execute(sql`SELECT status, to_char(date, 'YYYY-MM-DD') AS d FROM open_shifts WHERE id = ${id} AND company_id = ${companyId}`)) ?? null
}

/** Cancel an open shift nobody has taken yet. */
export async function cancelUnfilledShift(q: Q, companyId: string, id: string): Promise<void> {
  await q.execute(sql`UPDATE open_shifts SET status = 'cancelled', updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId} AND status IN ('open', 'claimed')`)
}

/** Cancel one day of a pattern (a replacement already took it, so it is not double-staffed). */
export async function cancelPatternDay(q: Q, companyId: string, scheduleId: string, date: string, byId: string): Promise<void> {
  await q.execute(sql`
    INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, created_by)
    VALUES (${createId()}, ${companyId}, ${scheduleId}, ${date}::date, 'cancelled', ${byId})
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type = 'cancelled'`)
}

/** Record the return on the incident, beside the removal it undid. */
export async function markCaregiverReturned(q: Q, companyId: string, id: string, today: string, returned: unknown): Promise<void> {
  await q.execute(sql`
    UPDATE incidents SET caregiver_returned_on = ${today}::date,
           caregiver_removal = (COALESCE(caregiver_removal::jsonb, '{}'::jsonb) || jsonb_build_object('returned', ${JSON.stringify(returned)}::jsonb))::json,
           updated_at = NOW()
     WHERE id = ${id} AND company_id = ${companyId}`)
}

// ── The signed training acknowledgement ────────────────────────────────────────────────────────

export async function lockIncidentForAcknowledgement(q: Q, companyId: string, id: string): Promise<{ id: string; caregiverId: string | null; trainingAckSignedAt: unknown } | null> {
  return camelFirst(await q.execute(sql`
    SELECT id, caregiver_id, training_ack_signed_at FROM incidents WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`)) ?? null
}

export async function recordAcknowledgement(q: Q, companyId: string, id: string, a: { signer: string; signature: string; supervisor: string; method: string }): Promise<void> {
  await q.execute(sql`
    UPDATE incidents SET training_ack_signed_at = NOW(), training_ack_signer_name = ${a.signer}, training_ack_signature = ${a.signature},
           training_ack_supervisor = ${a.supervisor}, training_ack_method = ${a.method}, updated_at = NOW()
     WHERE id = ${id} AND company_id = ${companyId}`)
}

/** A completed training record on the caregiver's file. */
export async function insertCompletedTraining(q: Q, companyId: string, t: { caregiverId: string; name: string; provider: string; date: string }): Promise<any> {
  return camelFirst(await q.execute(sql`
    INSERT INTO training_records (id, company_id, caregiver_id, training_name, provider, completed_date, status)
    VALUES (${createId()}, ${companyId}, ${t.caregiverId}, ${t.name}, ${t.provider}, ${t.date}::date, 'completed') RETURNING *`))
}

// ── Telling the office ─────────────────────────────────────────────────────────────────────────

/** The company's active office people (admin, owner) — who an incident alert goes to. */
export async function officeUserIds(q: Q, companyId: string): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT id FROM "user" WHERE company_id = ${companyId} AND role IN ('admin', 'owner') AND is_active = true`)).map((r: any) => r.id)
}

/** One in-app notification. */
export async function insertNotification(q: Q, companyId: string, n: { userId: string; type: string; title: string; message: string }): Promise<void> {
  await q.execute(sql`INSERT INTO notifications (id, company_id, user_id, type, title, message) VALUES (${createId()}, ${companyId}, ${n.userId}, ${n.type}, ${n.title}, ${n.message})`)
}

