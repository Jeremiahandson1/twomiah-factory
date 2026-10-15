// /api/incidents — the incident case file (migration 0019), ported from CVHC clinicalRoutes.js.
//
// Case fields (number, status, reporter contact, response due/sent, conclusion, findings, mandatory
// report, payer response notes), investigation timeline, attachments, the reversible "remove the
// caregiver from this client pending investigation", the signed training acknowledgement, the
// printable incident report + payer response packet, and caregiver field reports.
//
// Who may do what (homecare has no permission matrix):
//   · everything here is the office's — requireAdmin (admin or owner) — except
//   · POST /caregiver-report and GET /my-clients: a caregiver files a report from the field, for
//     their OWN clients only (the same "whose clients are these" rule as the visit screens).
//
// Template column names win (see the migration header): date = incident date, investigation_status
// = status, action_taken = actions taken, reported_by_id = who entered it, resolved_at = date closed.
// Responses keep the database's snake_case, plus *_ymd text copies of every DATE so no client time
// zone can shift a day.
import { Hono } from 'hono'
import type { Context } from 'hono'
import { sql, type SQL } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import { auditLogs } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS, TRAINING_ACK_TRAINING_NAMES,
  ATTACHMENT_MAX_DATA_URI_LENGTH, ATTACHMENT_ALLOWED_MIME,
} from '../config/incidentOptions.ts'
import { occurrencesCte } from '../services/scheduleOccurrences.ts'
import { agencyTimezone, agencyToday, addDays, localDate, type Q } from '../services/agencyTime.ts'
import { rowsOf } from '../helpers/scheduleRows.ts'
import { loadIncidentCase, incidentPdfBuffer } from '../services/incidentPdf.ts'

const app = new Hono()
app.use('*', authenticate)

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^\d{2}:\d{2}(:\d{2})?$/
const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === ''
const orNull = (v: unknown): any => (isBlank(v) ? null : v)
const validYmd = (v: unknown) => YMD_RE.test(String(v || '')) && !isNaN(new Date(`${v}T12:00:00Z`).getTime())

// Thrown inside transactional handlers to roll back and answer with a status.
class IncidentHttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
const fail = (c: Context, e: any, where: string) => {
  if (e instanceof IncidentHttpError) return c.json({ error: e.message }, e.status as any)
  console.error(`[incidents ${where}]`, e)
  return c.json({ error: e?.message || 'Request failed' }, 500)
}

const body = async (c: Context): Promise<any> => {
  try { const b = await c.req.json(); return b && typeof b === 'object' ? b : {} } catch { return {} }
}
const userId = (c: Context): string => {
  const u = c.get('user') as any
  return u?.userId || u?.id
}
const role = (c: Context): string => String((c.get('user') as any)?.role || '')
const clientIp = (c: Context): string | null =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('cf-connecting-ip') || null

const inList = (ids: string[]): SQL => sql.join(ids.map((id) => sql`${id}`), sql`, `)

// The drawn signature is a large data URI: keep it out of lists and audit rows.
const withoutSignature = (row: any) => {
  if (!row) return row
  const { training_ack_signature, ...rest } = row
  return { ...rest, has_training_ack_signature: !!training_ack_signature }
}

const parseDataUri = (uri: unknown) => {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(uri || ''))
  return m ? { mime: m[1].toLowerCase(), base64: m[2] } : null
}
const safeFileName = (name: unknown) => String(name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200) || 'file'
const cleanName = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim()

async function audit(c: Context, action: string, tableName: string, recordId: string, oldData: unknown, newData: unknown, reasonCode?: string) {
  try {
    await db.insert(auditLogs).values({
      userId: userId(c) || 'unknown', action, tableName, recordId,
      oldData: (oldData ?? null) as any, newData: (newData ?? null) as any,
      ipAddress: clientIp(c), reasonCode: reasonCode || null,
    } as any)
  } catch (err) {
    // A missing audit row must never undo the case-file change it describes.
    console.error('[incidents] audit write failed:', err)
  }
}

async function notifyAdmins(type: string, title: string, message: string) {
  try {
    const admins = await rowsOf(db, sql`SELECT id FROM users WHERE role IN ('admin', 'owner') AND is_active = true`)
    for (const a of admins) {
      await db.execute(sql`INSERT INTO notifications (id, user_id, type, title, message) VALUES (${createId()}, ${a.id}, ${type}, ${title}, ${message})`)
    }
  } catch (e: any) { console.error('[incidents notifyAdmins]', e?.message) }
}

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
  LEFT JOIN clients c ON c.id = i.client_id
  LEFT JOIN users u ON u.id = i.caregiver_id
  LEFT JOIN users ru ON ru.id = i.reported_by_id`

// Editable incident fields. Returns an error message or null.
export function validateIncidentBody(b: any): string | null {
  if (isBlank(b.clientId)) return 'Client is required'
  if (!INCIDENT_TYPES[b.incidentType]) return 'Incident type is not valid'
  if (isBlank(b.description)) return 'Description is required'
  if (!validYmd(b.incidentDate)) return 'Incident date is required'
  if (!isBlank(b.severity) && !SEVERITIES[b.severity]) return 'Severity is not valid'
  if (!isBlank(b.incidentTime) && !HHMM_RE.test(String(b.incidentTime))) return 'Incident time must be HH:MM'
  for (const [k, name] of [['reportedDate', 'Date reported'], ['responseDueDate', 'Response due date'], ['responseSentDate', 'Response sent date'], ['closedDate', 'Date closed']] as const) {
    if (!isBlank(b[k]) && !validYmd(b[k])) return `${name} must be a valid date`
  }
  if (!isBlank(b.status) && !INCIDENT_STATUSES[b.status]) return 'Status is not valid'
  if (!isBlank(b.disposition) && !DISPOSITIONS[b.disposition]) return 'Conclusion is not valid'
  if (!isBlank(b.mandatoryReportStatus) && !MANDATORY_REPORT_STATUSES[b.mandatoryReportStatus]) return 'Mandatory report decision is not valid'
  return null
}

/**
 * Next IR-<year>-<nnn>. A per-year high-water mark (incident_number_counters), bumped in the same
 * transaction as the insert: never MAX+1 over the rows that still exist, which would hand a deleted
 * incident's number — possibly already in a payer's file — to a different incident.
 */
async function nextIncidentNumber(tx: Q, incidentDate: string): Promise<string> {
  const y = Number(String(incidentDate).slice(0, 4))
  const [r] = await rowsOf(tx, sql`
    INSERT INTO incident_number_counters (year, last_number)
    VALUES (${y}, (SELECT COALESCE(MAX(split_part(incident_number, '-', 3)::int), 0) + 1
                     FROM incidents WHERE incident_number ~ ${`^IR-${y}-[0-9]+$`}))
    ON CONFLICT (year) DO UPDATE
      SET last_number = GREATEST(incident_number_counters.last_number + 1, EXCLUDED.last_number)
    RETURNING last_number`)
  return `IR-${y}-${String(r.last_number).padStart(3, '0')}`
}

async function insertIncident(tx: Q, b: any, reportedById: string, status = 'open') {
  const num = await nextIncidentNumber(tx, b.incidentDate)
  const [row] = await rowsOf(tx, sql`
    INSERT INTO incidents (id, incident_number, client_id, caregiver_id, incident_type, severity, date, incident_time,
      description, witnesses, injuries_or_damage, action_taken, follow_up_required, follow_up_notes, reported_by, reported_date,
      reported_by_id, investigation_status, reporter_contact_name, reporter_phone, reporter_email, response_due_date)
    VALUES (${createId()}, ${num}, ${b.clientId}, ${orNull(b.caregiverId)}, ${b.incidentType}, ${b.severity || 'moderate'},
      ${b.incidentDate}::date, ${orNull(b.incidentTime)}::time, ${String(b.description).trim()}, ${orNull(b.witnesses)},
      ${orNull(b.injuriesOrDamage)}, ${orNull(b.actionsTaken)}, ${!!b.followUpRequired}, ${orNull(b.followUpNotes)},
      ${orNull(b.reportedBy)}, ${orNull(b.reportedDate)}::date, ${reportedById}, ${status},
      ${orNull(b.reporterContactName)}, ${orNull(b.reporterPhone)}, ${orNull(b.reporterEmail)}, ${orNull(b.responseDueDate)}::date)
    RETURNING *`)
  return row
}

async function addTimelineNote(q: Q, incidentId: string, entryType: string, summary: string, byId: string, entryDate?: string) {
  const d = entryDate || await agencyToday(undefined, q)
  await q.execute(sql`
    INSERT INTO incident_investigation_notes (id, incident_id, entry_date, entry_type, summary, created_by_id)
    VALUES (${createId()}, ${incidentId}, ${d}::date, ${entryType}, ${summary}, ${byId})`)
}

/** May this caregiver report for this client? Assigned, scheduled, covering, or worked there in the last 30 days. */
const caregiverClientRule = (caregiverId: string, today: string): SQL => sql`(
     EXISTS (SELECT 1 FROM schedules s2 WHERE s2.client_id = c.id AND s2.caregiver_id = ${caregiverId} AND s2.is_active = true)
  OR EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id = c.id AND ca.caregiver_id = ${caregiverId} AND ca.status = 'active')
  OR EXISTS (SELECT 1 FROM schedule_exceptions se JOIN schedules s3 ON s3.id = se.schedule_id AND s3.is_active = true
              WHERE se.override_caregiver_id = ${caregiverId} AND se.exception_type = 'modified'
                AND COALESCE(se.override_client_id, s3.client_id) = c.id
                AND se.exception_date >= ${today}::date)
  OR EXISTS (SELECT 1 FROM time_entries te WHERE te.client_id = c.id AND te.caregiver_id = ${caregiverId}
                AND te.start_time >= NOW() - INTERVAL '30 days'))`

const FIELD_ROLES = new Set(['caregiver', 'admin', 'owner'])

// ─── Summary (office dashboard figures) ──────────────────────────────────────
app.get('/summary', requireAdmin, async (c) => {
  try {
    const [total, bySeverity, byType, followUp, monthly, byClient] = await Promise.all([
      rowsOf(db, sql`SELECT COUNT(*)::int AS total FROM incidents`),
      rowsOf(db, sql`SELECT severity, COUNT(*)::int AS count FROM incidents GROUP BY severity
                     ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'severe' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 END`),
      rowsOf(db, sql`SELECT incident_type, COUNT(*)::int AS count FROM incidents GROUP BY incident_type ORDER BY count DESC`),
      rowsOf(db, sql`SELECT COUNT(*)::int AS pending_followup FROM incidents WHERE follow_up_required = true`),
      rowsOf(db, sql`SELECT to_char(DATE_TRUNC('month', date), 'YYYY-MM-DD') AS month, COUNT(*)::int AS count,
                            COUNT(CASE WHEN severity IN ('critical', 'severe') THEN 1 END)::int AS serious_count
                       FROM incidents GROUP BY 1 ORDER BY 1 DESC LIMIT 12`),
      rowsOf(db, sql`SELECT c.id, c.first_name || ' ' || c.last_name AS client_name, COUNT(i.id)::int AS incident_count
                       FROM clients c JOIN incidents i ON i.client_id = c.id
                      GROUP BY c.id, c.first_name, c.last_name ORDER BY incident_count DESC LIMIT 10`),
    ])
    return c.json({ total: total[0].total, bySeverity, byType, pendingFollowUp: followUp[0].pending_followup, monthlyTrend: monthly, topClients: byClient })
  } catch (e) { return fail(c, e, 'summary') }
})

// Payer responses due within 3 days (or overdue) and not yet sent — the dashboard's action item.
app.get('/responses-due', requireAdmin, async (c) => {
  try {
    const today = await agencyToday()
    const items = await rowsOf(db, sql`
      SELECT i.id, i.incident_number, to_char(i.response_due_date, 'YYYY-MM-DD') AS response_due_date_ymd,
             i.reported_by, NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS client_name
        FROM incidents i LEFT JOIN clients c ON c.id = i.client_id
       WHERE COALESCE(i.investigation_status, 'open') <> 'closed'
         AND i.response_due_date IS NOT NULL AND i.response_sent_date IS NULL
         AND i.response_due_date <= ${addDays(today, 3)}::date
       ORDER BY i.response_due_date`)
    return c.json({ today, count: items.length, items })
  } catch (e) { return fail(c, e, 'responses-due') }
})

// The clients a caregiver may file a field report for (the form's picker). The office sees all
// active clients.
app.get('/my-clients', async (c) => {
  try {
    if (!FIELD_ROLES.has(role(c))) return c.json({ error: 'Not allowed' }, 403)
    const today = await agencyToday()
    const rule = role(c) === 'caregiver' ? sql`AND ${caregiverClientRule(userId(c), today)}` : sql``
    const rows = await rowsOf(db, sql`
      SELECT c.id, c.first_name, c.last_name FROM clients c
       WHERE c.is_active = true ${rule}
       ORDER BY c.last_name, c.first_name`)
    return c.json(rows)
  } catch (e) { return fail(c, e, 'my-clients') }
})

// Caregiver field report (caregiver app → "Report Incident"). The office gets an incident_alert
// notification and the report lands in Clinical → Incidents as an open case.
app.post('/caregiver-report', async (c) => {
  try {
    if (!FIELD_ROLES.has(role(c))) return c.json({ error: 'Not allowed' }, 403)
    const b = await body(c)
    if (isBlank(b.clientId)) return c.json({ error: 'Please pick the client' }, 400)
    if (!INCIDENT_TYPES[b.incidentType]) return c.json({ error: 'Please pick what happened' }, 400)
    if (!validYmd(b.incidentDate)) return c.json({ error: 'Please enter the date' }, 400)
    if (isBlank(b.description)) return c.json({ error: 'Please describe what happened' }, 400)
    if (!isBlank(b.incidentTime) && !HHMM_RE.test(String(b.incidentTime))) return c.json({ error: 'Time must be HH:MM' }, 400)
    const today = await agencyToday()
    if (b.incidentDate > today) return c.json({ error: "The date can't be in the future" }, 400)

    const photos: any[] = Array.isArray(b.photos) ? b.photos : []
    if (photos.length > 3) return c.json({ error: 'Up to 3 photos' }, 400)
    for (const ph of photos) {
      const parsed = parseDataUri(ph?.dataUri)
      if (!parsed || !parsed.mime.startsWith('image/') || !ATTACHMENT_ALLOWED_MIME.includes(parsed.mime)) return c.json({ error: 'Photos must be images' }, 400)
      if (String(ph.dataUri).length > ATTACHMENT_MAX_DATA_URI_LENGTH) return c.json({ error: 'A photo is too large' }, 400)
    }

    const me = userId(c)
    if (role(c) === 'caregiver') {
      const access = await rowsOf(db, sql`
        SELECT 1 FROM clients c WHERE c.id = ${b.clientId} AND c.is_active = true AND ${caregiverClientRule(me, today)}`)
      if (access.length === 0) return c.json({ error: 'You can only report incidents for your own clients' }, 403)
    } else {
      const exists = await rowsOf(db, sql`SELECT 1 FROM clients WHERE id = ${b.clientId}`)
      if (exists.length === 0) return c.json({ error: 'Client not found' }, 404)
    }

    const [who] = await rowsOf(db, sql`SELECT first_name, last_name FROM users WHERE id = ${me}`)
    const [client] = await rowsOf(db, sql`SELECT first_name, last_name FROM clients WHERE id = ${b.clientId}`)
    const reporterName = who ? cleanName(`${who.first_name} ${who.last_name}`) : 'Caregiver'
    const clientName = client ? cleanName(`${client.first_name} ${client.last_name}`) : 'client'

    const incident = await db.transaction(async (tx) => {
      const row = await insertIncident(tx, {
        clientId: b.clientId,
        caregiverId: role(c) === 'caregiver' ? me : orNull(b.caregiverId),
        incidentType: b.incidentType, severity: 'moderate',
        incidentDate: b.incidentDate, incidentTime: orNull(b.incidentTime),
        description: String(b.description).trim(), witnesses: orNull(b.witnesses),
        injuriesOrDamage: orNull(b.injuriesOrDamage), actionsTaken: orNull(b.actionsTaken),
        reportedBy: reporterName, reportedDate: today,
      }, me, 'open')
      await addTimelineNote(tx, row.id, 'note', `Reported by ${reporterName} through the caregiver app.`, me, today)
      for (const ph of photos) {
        const parsed = parseDataUri(ph.dataUri)!
        await tx.execute(sql`
          INSERT INTO incident_attachments (id, incident_id, category, file_name, mime_type, file_size, file_data, description, uploaded_by_id)
          VALUES (${createId()}, ${row.id}, 'photo', ${safeFileName(ph.fileName || 'photo.jpg')}, ${parsed.mime},
                  ${Math.floor(parsed.base64.length * 3 / 4)}, ${ph.dataUri}, ${`Photo from ${reporterName}`}, ${me})`)
      }
      return row
    })
    await audit(c, 'CREATE', 'incidents', incident.id, null, withoutSignature(incident))

    await notifyAdmins('incident_alert', `⚠️ Incident reported: ${clientName}`,
      `${reporterName} reported ${INCIDENT_TYPES[b.incidentType]} for ${clientName} on ${b.incidentDate}${b.incidentTime ? ` at ${b.incidentTime}` : ''}: ${String(b.description).trim().slice(0, 300)}\n\nOpen Clinical → Incidents (${incident.incident_number}).`)

    return c.json({ success: true, id: incident.id, incidentNumber: incident.incident_number }, 201)
  } catch (e) { return fail(c, e, 'caregiver-report') }
})

// ─── List / read ─────────────────────────────────────────────────────────────
// GET /api/incidents?status=&severity=
app.get('/', requireAdmin, async (c) => {
  try {
    const { status, severity } = c.req.query()
    const where: SQL[] = []
    if (status) where.push(sql`i.investigation_status = ${status}`)
    if (severity) where.push(sql`i.severity = ${severity}`)
    const rows = await rowsOf(db, sql`
      SELECT ${INCIDENT_SELECT},
             (SELECT COUNT(*)::int FROM incident_investigation_notes n WHERE n.incident_id = i.id) AS note_count,
             (SELECT COUNT(*)::int FROM incident_attachments a WHERE a.incident_id = i.id) AS attachment_count
      ${INCIDENT_FROM}
      ${where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``}
      ORDER BY i.date DESC, i.incident_time DESC NULLS LAST, i.created_at DESC
      LIMIT 500`)
    return c.json(rows.map(withoutSignature))
  } catch (e) { return fail(c, e, 'list') }
})

app.get('/:id', requireAdmin, async (c) => {
  try {
    const [row] = await rowsOf(db, sql`
      SELECT ${INCIDENT_SELECT}, c.is_private_pay, rs.name AS payer_name
      ${INCIDENT_FROM}
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      WHERE i.id = ${c.req.param('id')}`)
    if (!row) return c.json({ error: 'Incident not found' }, 404)
    return c.json(row)
  } catch (e) { return fail(c, e, 'get') }
})

// ─── Create / edit / delete ──────────────────────────────────────────────────
app.post('/', requireAdmin, async (c) => {
  try {
    const b = await body(c)
    const err = validateIncidentBody(b)
    if (err) return c.json({ error: err }, 400)
    const status = INCIDENT_STATUSES[b.status] ? b.status : 'open'
    const incident = await db.transaction((tx) => insertIncident(tx, b, userId(c), status))
    await audit(c, 'CREATE', 'incidents', incident.id, null, withoutSignature(incident))
    return c.json(withoutSignature(incident), 201)
  } catch (e) { return fail(c, e, 'create') }
})

// Full edit of the case fields (the older PATCH below stays for compatibility; it COALESCEs, so it
// can never clear a field).
app.put('/:id', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    const b = await body(c)
    const err = validateIncidentBody(b)
    if (err) return c.json({ error: err }, 400)
    const [p] = await rowsOf(db, sql`SELECT * FROM incidents WHERE id = ${id}`)
    if (!p) return c.json({ error: 'Incident not found' }, 404)

    // caregiver_removal points at THIS caregiver's schedules for THIS client.
    const removalActive = p.caregiver_removed_from && !p.caregiver_returned_on
    if (removalActive && (b.clientId !== p.client_id || orNull(b.caregiverId) !== p.caregiver_id)) {
      return c.json({ error: 'Return the caregiver to the schedule before changing the client or caregiver on this incident.' }, 409)
    }

    const status = b.status || p.investigation_status || 'open'
    let closedDate: string | null = orNull(b.closedDate)
    if (status === 'closed' && !closedDate) closedDate = await agencyToday()
    if (status !== 'closed') closedDate = null
    const resolvedBy = status === 'closed' ? (p.resolved_by_id || userId(c)) : null

    const [row] = await rowsOf(db, sql`
      UPDATE incidents SET
        client_id = ${b.clientId}, caregiver_id = ${orNull(b.caregiverId)}, incident_type = ${b.incidentType},
        severity = ${b.severity || p.severity || 'moderate'}, date = ${b.incidentDate}::date, incident_time = ${orNull(b.incidentTime)}::time,
        description = ${String(b.description).trim()}, witnesses = ${orNull(b.witnesses)}, injuries_or_damage = ${orNull(b.injuriesOrDamage)},
        action_taken = ${orNull(b.actionsTaken)}, follow_up_required = ${!!b.followUpRequired}, follow_up_notes = ${orNull(b.followUpNotes)},
        reported_by = ${orNull(b.reportedBy)}, reported_date = ${orNull(b.reportedDate)}::date,
        reporter_contact_name = ${orNull(b.reporterContactName)}, reporter_phone = ${orNull(b.reporterPhone)}, reporter_email = ${orNull(b.reporterEmail)},
        response_due_date = ${orNull(b.responseDueDate)}::date, response_sent_date = ${orNull(b.responseSentDate)}::date,
        investigation_status = ${status}, disposition = ${orNull(b.disposition)}, findings = ${orNull(b.findings)},
        mandatory_report_status = ${orNull(b.mandatoryReportStatus)}, mandatory_report_details = ${orNull(b.mandatoryReportDetails)},
        resolved_at = ${closedDate}::date, resolved_by_id = ${resolvedBy},
        payer_response_notes = ${orNull(b.payerResponseNotes)}, updated_at = NOW()
      WHERE id = ${id} RETURNING *`)
    await audit(c, 'UPDATE', 'incidents', id, withoutSignature(p), withoutSignature(row))
    return c.json(withoutSignature(row))
  } catch (e) { return fail(c, e, 'update') }
})

app.patch('/:id', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    const b = await body(c)
    if (!isBlank(b.severity) && !SEVERITIES[b.severity]) return c.json({ error: 'Severity is not valid' }, 400)
    const followUp = typeof b.followUpRequired === 'boolean' ? b.followUpRequired : null
    const [row] = await rowsOf(db, sql`
      UPDATE incidents SET severity = COALESCE(${orNull(b.severity)}, severity),
        injuries_or_damage = COALESCE(${orNull(b.injuriesOrDamage)}, injuries_or_damage),
        action_taken = COALESCE(${orNull(b.actionsTaken)}, action_taken),
        follow_up_required = COALESCE(${followUp}::boolean, follow_up_required),
        follow_up_notes = COALESCE(${orNull(b.followUpNotes)}, follow_up_notes), updated_at = NOW()
      WHERE id = ${id} RETURNING *`)
    if (!row) return c.json({ error: 'Incident not found' }, 404)
    await audit(c, 'UPDATE', 'incidents', id, null, withoutSignature(row))
    return c.json(withoutSignature(row))
  } catch (e) { return fail(c, e, 'patch') }
})

app.delete('/:id', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    // A caregiver still removed from the schedule by this incident must be returned first — deleting
    // would orphan the paused schedules with no way to restore them.
    const [cur] = await rowsOf(db, sql`SELECT caregiver_removed_from, caregiver_returned_on FROM incidents WHERE id = ${id}`)
    if (!cur) return c.json({ error: 'Incident not found' }, 404)
    if (cur.caregiver_removed_from && !cur.caregiver_returned_on) {
      return c.json({ error: 'Return the caregiver to the schedule before deleting this incident.' }, 409)
    }
    const [row] = await rowsOf(db, sql`DELETE FROM incidents WHERE id = ${id} RETURNING *`)
    if (!row) return c.json({ error: 'Incident not found' }, 404)
    await audit(c, 'DELETE', 'incidents', id, null, withoutSignature(row))
    return c.json({ message: 'Incident report deleted' })
  } catch (e) { return fail(c, e, 'delete') }
})

// ─── Investigation timeline ──────────────────────────────────────────────────
app.get('/:id/notes', requireAdmin, async (c) => {
  try {
    const rows = await rowsOf(db, sql`
      SELECT n.id, n.incident_id, n.entry_type, n.summary, n.created_at,
             to_char(n.entry_date, 'YYYY-MM-DD') AS entry_date_ymd,
             NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS created_by_name
        FROM incident_investigation_notes n
        LEFT JOIN users u ON u.id = n.created_by_id
       WHERE n.incident_id = ${c.req.param('id')}
       ORDER BY n.entry_date, n.created_at`)
    return c.json(rows)
  } catch (e) { return fail(c, e, 'notes') }
})

app.post('/:id/notes', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    const { entryDate, entryType, summary } = await body(c)
    if (!validYmd(entryDate)) return c.json({ error: 'Date is required' }, 400)
    if (!ENTRY_TYPES[entryType]) return c.json({ error: 'Entry type is not valid' }, 400)
    if (isBlank(summary)) return c.json({ error: 'Describe what happened' }, 400)
    if (String(summary).length > 5000) return c.json({ error: 'Keep the entry under 5,000 characters' }, 400)
    const [inc] = await rowsOf(db, sql`SELECT id FROM incidents WHERE id = ${id}`)
    if (!inc) return c.json({ error: 'Incident not found' }, 404)
    const [row] = await rowsOf(db, sql`
      INSERT INTO incident_investigation_notes (id, incident_id, entry_date, entry_type, summary, created_by_id)
      VALUES (${createId()}, ${id}, ${entryDate}::date, ${entryType}, ${String(summary).trim()}, ${userId(c)}) RETURNING *`)
    await audit(c, 'CREATE', 'incident_investigation_notes', row.id, null, row)
    return c.json(row, 201)
  } catch (e) { return fail(c, e, 'add note') }
})

app.delete('/:id/notes/:noteId', requireAdmin, async (c) => {
  try {
    const [row] = await rowsOf(db, sql`
      DELETE FROM incident_investigation_notes WHERE id = ${c.req.param('noteId')} AND incident_id = ${c.req.param('id')} RETURNING *`)
    if (!row) return c.json({ error: 'Entry not found' }, 404)
    await audit(c, 'DELETE', 'incident_investigation_notes', row.id, row, null)
    return c.json({ message: 'Entry deleted' })
  } catch (e) { return fail(c, e, 'delete note') }
})

// ─── Attachments (stored in the database) ────────────────────────────────────
app.get('/:id/attachments', requireAdmin, async (c) => {
  try {
    const rows = await rowsOf(db, sql`
      SELECT a.id, a.incident_id, a.category, a.file_name, a.mime_type, a.file_size, a.description, a.created_at,
             NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS uploaded_by_name
        FROM incident_attachments a
        LEFT JOIN users u ON u.id = a.uploaded_by_id
       WHERE a.incident_id = ${c.req.param('id')}
       ORDER BY a.created_at`)
    return c.json(rows)
  } catch (e) { return fail(c, e, 'attachments') }
})

app.get('/:id/attachments/:attachmentId', requireAdmin, async (c) => {
  try {
    const [row] = await rowsOf(db, sql`
      SELECT file_name, mime_type, file_data FROM incident_attachments
       WHERE id = ${c.req.param('attachmentId')} AND incident_id = ${c.req.param('id')}`)
    if (!row) return c.json({ error: 'Attachment not found' }, 404)
    const parsed = parseDataUri(row.file_data)
    if (!parsed) return c.json({ error: 'Stored file is unreadable' }, 500)
    return c.body(new Uint8Array(Buffer.from(parsed.base64, 'base64')), 200, {
      'Content-Type': row.mime_type,
      'Content-Disposition': `inline; filename="${safeFileName(row.file_name)}"`,
    })
  } catch (e) { return fail(c, e, 'attachment') }
})

app.post('/:id/attachments', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    const { category, fileName, dataUri, description } = await body(c)
    if (!ATTACHMENT_CATEGORIES[category]) return c.json({ error: 'Pick what kind of document this is' }, 400)
    if (isBlank(fileName)) return c.json({ error: 'File name is required' }, 400)
    const parsed = parseDataUri(dataUri)
    if (!parsed) return c.json({ error: 'The file could not be read' }, 400)
    if (!ATTACHMENT_ALLOWED_MIME.includes(parsed.mime)) return c.json({ error: 'Only PDF and image files can be attached' }, 400)
    if (String(dataUri).length > ATTACHMENT_MAX_DATA_URI_LENGTH) return c.json({ error: 'File is too large (7 MB max)' }, 400)
    const [inc] = await rowsOf(db, sql`SELECT id FROM incidents WHERE id = ${id}`)
    if (!inc) return c.json({ error: 'Incident not found' }, 404)
    const [row] = await rowsOf(db, sql`
      INSERT INTO incident_attachments (id, incident_id, category, file_name, mime_type, file_size, file_data, description, uploaded_by_id)
      VALUES (${createId()}, ${id}, ${category}, ${safeFileName(fileName)}, ${parsed.mime}, ${Math.floor(parsed.base64.length * 3 / 4)},
              ${dataUri}, ${orNull(description)}, ${userId(c)})
      RETURNING id, incident_id, category, file_name, mime_type, file_size, description, created_at`)
    await audit(c, 'CREATE', 'incident_attachments', row.id, null, row)
    return c.json(row, 201)
  } catch (e) { return fail(c, e, 'attach') }
})

app.delete('/:id/attachments/:attachmentId', requireAdmin, async (c) => {
  try {
    const [row] = await rowsOf(db, sql`
      DELETE FROM incident_attachments WHERE id = ${c.req.param('attachmentId')} AND incident_id = ${c.req.param('id')}
      RETURNING id, incident_id, category, file_name, mime_type, file_size, description`)
    if (!row) return c.json({ error: 'Attachment not found' }, 404)
    await audit(c, 'DELETE', 'incident_attachments', row.id, row, null)
    return c.json({ message: 'Attachment deleted' })
  } catch (e) { return fail(c, e, 'delete attachment') }
})

// ─── Caregiver schedule for this client (read) ───────────────────────────────
const parseRemoval = (v: unknown): any => {
  if (!v) return null
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return null } }
  return v
}

app.get('/:id/caregiver-schedule', requireAdmin, async (c) => {
  try {
    const [i] = await rowsOf(db, sql`
      SELECT i.client_id, i.caregiver_id, i.caregiver_removal,
             to_char(i.caregiver_removed_from, 'YYYY-MM-DD') AS removed_from,
             to_char(i.caregiver_returned_on, 'YYYY-MM-DD') AS returned_on
        FROM incidents i WHERE i.id = ${c.req.param('id')}`)
    if (!i) return c.json({ error: 'Incident not found' }, 404)
    if (!i.caregiver_id || !i.client_id) return c.json({ caregiverId: i.caregiver_id || null, schedules: [], upcomingVisits: 0, lastVisit: null })
    const tz = await agencyTimezone()
    const today = await agencyToday(tz)
    const removal = parseRemoval(i.caregiver_removal)
    const removalActive = !!(i.removed_from && !i.returned_on)
    // The rows this removal took off the schedule still belong in the list, shown as paused.
    const pausedIds: string[] = removalActive ? (removal?.schedules || []).map((s: any) => s.schedule_id) : []
    const paused = pausedIds.length ? sql`OR s.id IN (${inList(pausedIds)})` : sql``
    const [sched, upcoming, last] = await Promise.all([
      rowsOf(db, sql`
        SELECT s.id, s.day_of_week, to_char(s.date, 'YYYY-MM-DD') AS date,
               to_char(s.start_time, 'HH24:MI:SS') AS start_time, to_char(s.end_time, 'HH24:MI:SS') AS end_time,
               s.frequency, to_char(s.end_date, 'YYYY-MM-DD') AS end_date, s.is_active
          FROM schedules s
         WHERE s.caregiver_id = ${i.caregiver_id} AND s.client_id = ${i.client_id}
           AND ((s.is_active = true AND ((s.day_of_week IS NULL AND s.date >= ${today}::date)
                OR (s.day_of_week IS NOT NULL AND (s.end_date IS NULL OR s.end_date >= ${today}::date))))
                ${paused})
         ORDER BY s.day_of_week NULLS LAST, s.date, s.start_time`),
      rowsOf(db, sql`
        WITH ${occurrencesCte(today, addDays(today, 27))}
        SELECT COUNT(*)::int AS n FROM occ WHERE occ.caregiver_id = ${i.caregiver_id} AND occ.client_id = ${i.client_id}`),
      rowsOf(db, sql`
        SELECT to_char(MAX(${localDate(sql`start_time`, tz)}), 'YYYY-MM-DD') AS d
          FROM time_entries WHERE client_id = ${i.client_id} AND caregiver_id = ${i.caregiver_id}`),
    ])
    const pausedSet = new Set(pausedIds)
    return c.json({
      caregiverId: i.caregiver_id,
      removedFrom: i.removed_from, returnedOn: i.returned_on,
      removal, today,
      schedules: sched.map((s: any) => ({ ...s, paused_from: pausedSet.has(s.id) ? removal.from_date : null })),
      upcomingVisits: upcoming[0]?.n || 0, lastVisit: last[0]?.d || null,
    })
  } catch (e) { return fail(c, e, 'caregiver-schedule') }
})

// ─── Remove caregiver from this client pending investigation ─────────────────
// Takes THIS caregiver off THIS client's schedule from fromDate: a recurring pattern is end-dated
// the day before, a one-time visit on/after fromDate is deactivated. Every reader in this template
// (calendar, coverage, payroll review, the caregiver's phone) already honours both. Not
// schedules.suspended_from: that column is the CLIENT's "suspend service" switch (visits'
// Suspend Service panel sets and clears it for all of a client's patterns), so pausing one caregiver
// through it would be undone by resuming the client's service. Before that:
//   · their upcoming visits are expanded and posted as open shifts for coverage (when asked);
//   · visits on their patterns already covered by ANOTHER caregiver (a per-day override) become that
//     caregiver's own one-time visits, or ending the pattern would erase them;
//   · visits they cover on other caregivers' patterns for this client are released (and posted).
// Every change is recorded in caregiver_removal so return-caregiver can undo it exactly.
app.post('/:id/remove-caregiver', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    const b = await body(c)
    const me = userId(c)
    const result = await db.transaction(async (tx) => {
      const [inc] = await rowsOf(tx, sql`
        SELECT i.id, i.incident_number, i.client_id, i.caregiver_id,
               to_char(i.caregiver_removed_from, 'YYYY-MM-DD') AS removed_from, i.caregiver_returned_on,
               c.first_name || ' ' || c.last_name AS client_name,
               u.first_name || ' ' || u.last_name AS caregiver_name
          FROM incidents i
          LEFT JOIN clients c ON c.id = i.client_id
          LEFT JOIN users u ON u.id = i.caregiver_id
         WHERE i.id = ${id}
         FOR UPDATE OF i`)
      if (!inc) throw new IncidentHttpError(404, 'Incident not found')
      const caregiverName = cleanName(inc.caregiver_name)
      const clientName = cleanName(inc.client_name)
      if (!inc.caregiver_id) throw new IncidentHttpError(400, 'This incident has no caregiver to remove.')
      if (!inc.client_id) throw new IncidentHttpError(400, 'This incident has no client.')
      if (inc.removed_from && !inc.caregiver_returned_on) throw new IncidentHttpError(409, `This caregiver is already removed, effective ${inc.removed_from}.`)

      const today = await agencyToday(undefined, tx)
      const fromDate = isBlank(b.fromDate) ? today : String(b.fromDate)
      if (!validYmd(fromDate)) throw new IncidentHttpError(400, 'Start date must be a valid date')
      if (fromDate < today) throw new IncidentHttpError(400, 'Removal can start today or later. Visits already worked stay as they are.')
      const postOpenShifts = b.postOpenShifts !== false
      const coverageWeeks = Math.min(12, Math.max(1, parseInt(b.coverageWeeks, 10) || 4))
      const toDate = addDays(fromDate, coverageWeeks * 7 - 1)
      const dayBefore = addDays(fromDate, -1)

      const targets = await rowsOf(tx, sql`
        SELECT id, day_of_week, to_char(end_date, 'YYYY-MM-DD') AS end_date
          FROM schedules
         WHERE caregiver_id = ${inc.caregiver_id} AND client_id = ${inc.client_id} AND is_active = true
           AND ((day_of_week IS NULL AND date >= ${fromDate}::date)
                OR (day_of_week IS NOT NULL AND (end_date IS NULL OR end_date >= ${fromDate}::date)))
         FOR UPDATE`)
      const targetIds = targets.map((r) => r.id)

      const own = (postOpenShifts && targetIds.length) ? await rowsOf(tx, sql`
        WITH ${occurrencesCte(fromDate, toDate)}
        SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS shift_date,
               to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time
          FROM occ
         WHERE occ.schedule_id IN (${inList(targetIds)}) AND occ.caregiver_id = ${inc.caregiver_id}
         ORDER BY occ.occ_date, occ.start_time`) : []

      const coveredByOthers = targetIds.length ? await rowsOf(tx, sql`
        SELECT se.id AS exception_id, se.schedule_id, to_char(se.exception_date, 'YYYY-MM-DD') AS d,
               to_char(COALESCE(se.override_start_time, s.start_time::time), 'HH24:MI:SS') AS start_time,
               to_char(COALESCE(se.override_end_time, s.end_time::time), 'HH24:MI:SS') AS end_time,
               se.override_caregiver_id, COALESCE(se.override_client_id, s.client_id) AS client_id, s.notes
          FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id
         WHERE se.schedule_id IN (${inList(targetIds)}) AND se.exception_type = 'modified'
           AND se.override_caregiver_id IS NOT NULL AND se.override_caregiver_id <> ${inc.caregiver_id}
           AND se.exception_date >= ${fromDate}::date`) : []
      const converted: any[] = []
      for (const o of coveredByOthers) {
        const newId = createId()
        const endDay = o.end_time && o.start_time && o.end_time < o.start_time ? addDays(o.d, 1) : o.d
        await tx.execute(sql`
          INSERT INTO schedules (id, client_id, caregiver_id, schedule_type, date, start_time, end_time, notes)
          VALUES (${newId}, ${o.client_id}, ${o.override_caregiver_id}, 'one-time', ${o.d}::date,
                  ${`${o.d} ${o.start_time}`}::timestamp, ${`${endDay} ${o.end_time}`}::timestamp, ${o.notes})`)
        await tx.execute(sql`UPDATE schedule_exceptions SET exception_type = 'cancelled' WHERE id = ${o.exception_id}`)
        converted.push({ exception_id: o.exception_id, schedule_id: o.schedule_id, date: o.d, new_schedule_id: newId, caregiver_id: o.override_caregiver_id })
      }

      const movedIn = await rowsOf(tx, sql`
        SELECT se.id AS exception_id, se.schedule_id, to_char(se.exception_date, 'YYYY-MM-DD') AS d,
               to_char(COALESCE(se.override_start_time, s.start_time::time), 'HH24:MI:SS') AS start_time,
               to_char(COALESCE(se.override_end_time, s.end_time::time), 'HH24:MI:SS') AS end_time
          FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id AND s.is_active = true
         WHERE se.exception_type = 'modified' AND se.override_caregiver_id = ${inc.caregiver_id}
           AND COALESCE(se.override_client_id, s.client_id) = ${inc.client_id}
           AND s.caregiver_id <> ${inc.caregiver_id}
           AND se.exception_date >= ${fromDate}::date
           AND (s.end_date IS NULL OR se.exception_date <= s.end_date)`)
      for (const m of movedIn) {
        await tx.execute(sql`UPDATE schedule_exceptions SET exception_type = 'cancelled' WHERE id = ${m.exception_id}`)
      }

      const recurring = targets.filter((t) => t.day_of_week !== null && t.day_of_week !== undefined)
      const oneTime = targets.filter((t) => t.day_of_week === null || t.day_of_week === undefined)
      if (recurring.length) {
        await tx.execute(sql`UPDATE schedules SET end_date = ${dayBefore}::date, updated_at = NOW() WHERE id IN (${inList(recurring.map((r) => r.id))})`)
      }
      if (oneTime.length) {
        await tx.execute(sql`UPDATE schedules SET is_active = false, updated_at = NOW() WHERE id IN (${inList(oneTime.map((r) => r.id))})`)
      }

      const openShifts: any[] = []
      if (postOpenShifts) {
        const toCover = [
          ...own.map((o) => ({ ...o, source: 'own', exception_id: null })),
          ...movedIn.map((m) => ({ schedule_id: m.schedule_id, shift_date: m.d, start_time: m.start_time, end_time: m.end_time, source: 'covering', exception_id: m.exception_id })),
        ]
        for (const o of toCover) {
          const dup = await rowsOf(tx, sql`
            SELECT id FROM open_shifts WHERE client_id = ${inc.client_id} AND date = ${o.shift_date}::date AND start_time = ${o.start_time}::time
               AND status IN ('open', 'claimed', 'filled') LIMIT 1`)
          if (dup.length) continue
          const osId = createId()
          // Notes are shown to caregivers browsing open shifts: keep them neutral.
          await tx.execute(sql`
            INSERT INTO open_shifts (id, client_id, date, start_time, end_time, status, notes, auto_created, created_by_id)
            VALUES (${osId}, ${inc.client_id}, ${o.shift_date}::date, ${o.start_time}::time, ${o.end_time}::time, 'open', 'Coverage needed', true, ${me})`)
          openShifts.push({ open_shift_id: osId, schedule_id: o.schedule_id, shift_date: o.shift_date, source: o.source, exception_id: o.exception_id })
        }
      }

      const removal = {
        from_date: fromDate, coverage_to: postOpenShifts ? toDate : null, removed_by: me,
        schedules: [
          ...recurring.map((t) => ({ schedule_id: t.id, kind: 'recurring', prior_end_date: t.end_date || null })),
          ...oneTime.map((t) => ({ schedule_id: t.id, kind: 'one-time' })),
        ],
        converted_overrides: converted,
        released_covers: movedIn.map((m) => ({ exception_id: m.exception_id, schedule_id: m.schedule_id, date: m.d })),
        open_shifts: openShifts,
      }
      await tx.execute(sql`
        UPDATE incidents SET caregiver_removed_from = ${fromDate}::date, caregiver_returned_on = NULL,
               caregiver_removal = ${JSON.stringify(removal)}::json, updated_at = NOW()
         WHERE id = ${inc.id}`)

      const n = targets.length
      const summary = `Removed ${caregiverName} from ${clientName}'s schedule effective ${fromDate}. `
        + `${n} schedule${n === 1 ? '' : 's'} paused. `
        + (postOpenShifts ? `${openShifts.length} upcoming visit${openShifts.length === 1 ? '' : 's'} through ${toDate} posted as open shifts for coverage.` : 'No open shifts posted.')
        + (converted.length ? ` ${converted.length} visit${converted.length === 1 ? '' : 's'} already covered by other caregivers kept as their own shifts.` : '')
        + (movedIn.length ? ` ${movedIn.length} visit${movedIn.length === 1 ? '' : 's'} this caregiver was covering for others released.` : '')
      await addTimelineNote(tx, inc.id, 'schedule', summary, me, today)
      return { inc, fromDate, targets, converted, movedIn, openShifts, removal, summary }
    })

    for (const t of result.targets) {
      await audit(c, 'SUSPEND', 'schedules', t.id, { end_date: t.end_date, day_of_week: t.day_of_week },
        { scope: 'incident_caregiver_removal', from_date: result.fromDate, incident_id: result.inc.id }, 'incident_removal')
    }
    for (const cv of result.converted) {
      await audit(c, 'CREATE', 'schedules', cv.new_schedule_id, null,
        { from_override: cv.exception_id, caregiver_id: cv.caregiver_id, date: cv.date, incident_id: result.inc.id }, 'incident_removal')
    }
    await audit(c, 'CAREGIVER_REMOVED', 'incidents', result.inc.id, null, result.removal, 'incident_removal')

    return c.json({
      success: true, fromDate: result.fromDate, schedulesPaused: result.targets.length, openShiftsPosted: result.openShifts.length,
      coveredVisitsKept: result.converted.length, coversReleased: result.movedIn.length, summary: result.summary,
    })
  } catch (e) { return fail(c, e, 'remove-caregiver') }
})

// ─── Return caregiver to this client's schedule ──────────────────────────────
// Restores each changed row to its PRIOR value (only if nobody changed it since). Coverage still
// unclaimed is cancelled. Coverage a replacement already took is kept, and this caregiver's own copy
// of that day is cancelled so the visit isn't double-staffed.
app.post('/:id/return-caregiver', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    const me = userId(c)
    const result = await db.transaction(async (tx) => {
      const [inc] = await rowsOf(tx, sql`
        SELECT i.id, i.client_id, i.caregiver_id, i.caregiver_removal,
               to_char(i.caregiver_removed_from, 'YYYY-MM-DD') AS removed_from, i.caregiver_returned_on,
               c.first_name || ' ' || c.last_name AS client_name, u.first_name || ' ' || u.last_name AS caregiver_name
          FROM incidents i
          LEFT JOIN clients c ON c.id = i.client_id
          LEFT JOIN users u ON u.id = i.caregiver_id
         WHERE i.id = ${id}
         FOR UPDATE OF i`)
      if (!inc) throw new IncidentHttpError(404, 'Incident not found')
      if (!inc.removed_from || inc.caregiver_returned_on) throw new IncidentHttpError(409, 'The caregiver is not currently removed from this schedule.')
      const removal = parseRemoval(inc.caregiver_removal) || {}
      const today = await agencyToday(undefined, tx)
      const dayBefore = addDays(removal.from_date || inc.removed_from, -1)

      const restored: string[] = [], skipped: string[] = []
      for (const s of removal.schedules || []) {
        const r = s.kind === 'one-time'
          ? await rowsOf(tx, sql`UPDATE schedules SET is_active = true, updated_at = NOW()
                                   WHERE id = ${s.schedule_id} AND is_active = false RETURNING id`)
          : await rowsOf(tx, sql`UPDATE schedules SET end_date = ${s.prior_end_date || null}::date, updated_at = NOW()
                                   WHERE id = ${s.schedule_id} AND is_active = true AND end_date = ${dayBefore}::date RETURNING id`)
        ;(r.length ? restored : skipped).push(s.schedule_id)
      }

      let cancelledOpenShifts = 0
      const keptReplacements: any[] = []
      const postedCoverExceptions = new Set<string>()
      for (const o of removal.open_shifts || []) {
        if (o.exception_id) postedCoverExceptions.add(o.exception_id)
        const [os] = await rowsOf(tx, sql`SELECT status, to_char(date, 'YYYY-MM-DD') AS d FROM open_shifts WHERE id = ${o.open_shift_id}`)
        if (!os) continue
        if (os.d < today) continue
        if (['open', 'claimed'].includes(os.status)) {
          await tx.execute(sql`UPDATE open_shifts SET status = 'cancelled', updated_at = NOW() WHERE id = ${o.open_shift_id} AND status IN ('open', 'claimed')`)
          cancelledOpenShifts++
          if (o.source === 'covering' && o.exception_id) {
            await tx.execute(sql`UPDATE schedule_exceptions SET exception_type = 'modified' WHERE id = ${o.exception_id} AND exception_type = 'cancelled'`)
          }
        } else if (os.status === 'filled') {
          if (o.source === 'own' && o.schedule_id) {
            await tx.execute(sql`
              INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, created_by)
              VALUES (${createId()}, ${o.schedule_id}, ${os.d}::date, 'cancelled', ${me})
              ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type = 'cancelled'`)
          }
          keptReplacements.push({ open_shift_id: o.open_shift_id, date: os.d })
        }
      }
      // Covers released without being posted (postOpenShifts was off): give them back.
      let restoredCovers = 0
      for (const cv of removal.released_covers || []) {
        if (postedCoverExceptions.has(cv.exception_id) || cv.date < today) continue
        const r = await rowsOf(tx, sql`UPDATE schedule_exceptions SET exception_type = 'modified' WHERE id = ${cv.exception_id} AND exception_type = 'cancelled' RETURNING id`)
        restoredCovers += r.length
      }

      const returned = { returned_on: today, returned_by: me, restored, skipped, cancelled_open_shifts: cancelledOpenShifts, kept_replacements: keptReplacements, restored_covers: restoredCovers }
      await tx.execute(sql`
        UPDATE incidents SET caregiver_returned_on = ${today}::date,
               caregiver_removal = (COALESCE(caregiver_removal::jsonb, '{}'::jsonb) || jsonb_build_object('returned', ${JSON.stringify(returned)}::jsonb))::json,
               updated_at = NOW()
         WHERE id = ${inc.id}`)

      const caregiverName = cleanName(inc.caregiver_name)
      const clientName = cleanName(inc.client_name)
      const summary = `Returned ${caregiverName} to ${clientName}'s schedule on ${today}. `
        + `${restored.length} schedule${restored.length === 1 ? '' : 's'} restored`
        + (skipped.length ? `, ${skipped.length} left as-is because they were changed after the removal` : '') + '. '
        + `${cancelledOpenShifts} unclaimed coverage shift${cancelledOpenShifts === 1 ? '' : 's'} cancelled.`
        + (keptReplacements.length ? ` ${keptReplacements.length} visit${keptReplacements.length === 1 ? '' : 's'} already covered by a replacement stay with the replacement.` : '')
      await addTimelineNote(tx, inc.id, 'schedule', summary, me, today)
      return { inc, restored, skipped, cancelledOpenShifts, keptReplacements, returned, summary }
    })

    for (const sid of result.restored) {
      await audit(c, 'RESUME', 'schedules', sid, null, { scope: 'incident_caregiver_return', incident_id: result.inc.id }, 'incident_removal')
    }
    await audit(c, 'CAREGIVER_RETURNED', 'incidents', result.inc.id, null, result.returned, 'incident_removal')
    return c.json({
      success: true, restored: result.restored.length, skipped: result.skipped.length,
      cancelledOpenShifts: result.cancelledOpenShifts, keptReplacements: result.keptReplacements.length, summary: result.summary,
    })
  } catch (e) { return fail(c, e, 'return-caregiver') }
})

// ─── Signed training acknowledgement ─────────────────────────────────────────
// Signing records the acknowledgement on the incident AND adds completed training_records rows
// (medication handling, misappropriation policy) to the caregiver's file.
app.post('/:id/training-acknowledgement', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    const me = userId(c)
    const { signature, signerName, supervisorName, method } = await body(c)
    const parsed = parseDataUri(signature)
    if (!parsed || !parsed.mime.startsWith('image/')) return c.json({ error: 'A drawn signature is required' }, 400)
    if (String(signature).length > 2_000_000) return c.json({ error: 'Signature image is too large' }, 400)
    if (isBlank(signerName)) return c.json({ error: "Type the caregiver's name" }, 400)
    if (isBlank(supervisorName)) return c.json({ error: 'Enter who reviewed it with the caregiver' }, 400)
    if (!TRAINING_ACK_METHODS[method]) return c.json({ error: 'Pick how it was reviewed' }, 400)
    const signer = String(signerName).trim()
    const supervisor = String(supervisorName).trim()

    const result = await db.transaction(async (tx) => {
      const [inc] = await rowsOf(tx, sql`SELECT id, caregiver_id, training_ack_signed_at FROM incidents WHERE id = ${id} FOR UPDATE`)
      if (!inc) throw new IncidentHttpError(404, 'Incident not found')
      if (!inc.caregiver_id) throw new IncidentHttpError(400, 'This incident has no caregiver')
      if (inc.training_ack_signed_at) throw new IncidentHttpError(409, 'The acknowledgement for this incident is already signed')
      const today = await agencyToday(undefined, tx)
      const [ag] = await rowsOf(tx, sql`SELECT name FROM agencies ORDER BY created_at LIMIT 1`)

      await tx.execute(sql`
        UPDATE incidents SET training_ack_signed_at = NOW(), training_ack_signer_name = ${signer}, training_ack_signature = ${signature},
               training_ack_supervisor = ${supervisor}, training_ack_method = ${method}, updated_at = NOW()
         WHERE id = ${inc.id}`)
      const provider = `${ag?.name || 'Agency'}: reviewed with ${supervisor}`.slice(0, 255)
      const records: any[] = []
      for (const name of TRAINING_ACK_TRAINING_NAMES) {
        const [r] = await rowsOf(tx, sql`
          INSERT INTO training_records (id, caregiver_id, training_name, provider, completed_date, status)
          VALUES (${createId()}, ${inc.caregiver_id}, ${name}, ${provider}, ${today}::date, 'completed') RETURNING *`)
        records.push(r)
      }
      await addTimelineNote(tx, inc.id, 'action',
        `${signer} signed the medication handling and misappropriation training acknowledgement (${TRAINING_ACK_METHODS[method].toLowerCase()}), reviewed with ${supervisor}. Added to the caregiver's training record.`,
        me, today)
      return { inc, records }
    })

    for (const r of result.records) await audit(c, 'CREATE', 'training_records', r.id, null, r)
    // The signing dialog tells the signer their IP address and the time are recorded.
    await audit(c, 'TRAINING_ACK_SIGNED', 'incidents', result.inc.id, null, {
      training_ack_signer_name: signer, training_ack_supervisor: supervisor, training_ack_method: method,
      signed_from_ip: clientIp(c), signed_at: new Date().toISOString(),
    })
    return c.json({ success: true, trainingRecords: result.records.length }, 201)
  } catch (e) { return fail(c, e, 'training-acknowledgement') }
})

// ─── PDFs ────────────────────────────────────────────────────────────────────
async function sendIncidentPdf(c: Context, kind: 'report' | 'packet') {
  try {
    const id = c.req.param('id') as string
    const data = await loadIncidentCase(db, id)
    if (!data) return c.json({ error: 'Incident not found' }, 404)
    const includeSchedule = c.req.query('includeSchedule') === '1'
    const pdf = await incidentPdfBuffer(data, kind, { includeSchedule })
    const base = kind === 'packet' ? 'incident-response-packet' : 'incident-report'
    const name = `${base}-${data.incident.incident_number || id}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_')
    await audit(c, 'REPORT_GENERATED_PDF', 'incidents', id, null, { report: base, includeSchedule: kind === 'packet' ? includeSchedule : undefined })
    return c.body(new Uint8Array(pdf), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
    })
  } catch (e) { return fail(c, e, `${kind} PDF`) }
}
app.get('/:id/pdf', requireAdmin, (c) => sendIncidentPdf(c, 'report'))
app.get('/:id/response-packet', requireAdmin, (c) => sendIncidentPdf(c, 'packet'))

export default app
