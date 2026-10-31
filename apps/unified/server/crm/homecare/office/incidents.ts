// /api/incidents — the incident case file. Moved from templates/crm-homecare/backend/src/routes/incidents.ts (ported
// there from CVHC clinicalRoutes.js; migration 0019 in the template).
//
// Case fields (number, status, reporter contact, response due/sent, conclusion, findings, mandatory report, payer
// response notes), investigation timeline, attachments, the reversible "remove the caregiver from this client pending
// investigation", the signed training acknowledgement, the printable incident report + payer response packet, and
// caregiver field reports.
//
// Who may do what:
//   · the case file is the office's: care-compliance (read / create / update / delete). The template's requireAdmin
//     (admin or owner); a caregiver holds no care-compliance permission. A manager now does (their first rung here);
//   · POST /caregiver-report and GET /my-clients: a caregiver files a report from the field (evv:create — their visit
//     work), for their OWN clients only; anyone holding care-compliance is the office and may pick any client.
//
// Changes from the template (RULEBOOK §2, §3): replies are camelCase (incidentNumber, incidentDateYmd …) and every list
// is { data, pagination }; the raw SQL is in server/data/homecareOffice.ts, scoped to the company; the incident number
// is counted per company. The removal record (incidents.caregiver_removal, a json column) keeps the template's keys
// (from_date, schedules[].schedule_id …) so a moved agency's existing records read the same.
import { Hono, type Context } from 'hono'
import { and, eq } from 'drizzle-orm'
import { clients, company, user } from '../../../db/schema/index.ts'
import {
  incidentSummary, incidentResponsesDue, reportableClients, caregiverMayReportFor, listIncidents, incidentCase, incidentRow,
  insertIncident, updateIncidentCase, patchIncident, deleteIncident, insertTimelineEntry, timelineEntries, deleteTimelineEntry,
  attachmentIndex, attachmentFile, insertAttachment, deleteAttachment, incidentRemovalState, caregiverClientSchedules,
  caregiverClientVisitCount, lockIncidentForRemoval, removalTargets, ownVisitsOn, coversByOthers, coversHeldElsewhere,
  insertOneTimeVisit, setExceptionType, endPatterns, deactivateVisits, openShiftAlreadyPosted, postCoverageShift,
  markCaregiverRemoved, restoreOneTimeVisit, restorePatternEnd, openShiftState, cancelUnfilledShift, cancelPatternDay,
  markCaregiverReturned, lockIncidentForAcknowledgement, recordAcknowledgement, insertCompletedTraining, officeUserIds,
  insertNotification,
} from '../../../data/homecareOffice.ts'
import { lastCaregiverClockInDate } from '../../../data/homecareIncidents.ts'
import type { Q } from '../../../data/homecareCore.ts'
import { fail, listAll, one, done } from '../../../http/reply.ts'
import type { AppEnv } from '../../../http/env.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { addDays } from '../core/agencyTime.ts'
import { incidentPdfBuffer } from '../core/incidentPdf.ts'
import {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS, TRAINING_ACK_TRAINING_NAMES,
  ATTACHMENT_MAX_DATA_URI_LENGTH, ATTACHMENT_ALLOWED_MIME,
} from '../core/incidentOptions.ts'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^\d{2}:\d{2}(:\d{2})?$/
const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === ''
const orNull = (v: unknown): any => (isBlank(v) ? null : v)
const validYmd = (v: unknown) => YMD_RE.test(String(v || '')) && !isNaN(new Date(`${v}T12:00:00Z`).getTime())

/** A refusal thrown inside a transaction: it rolls the transaction back and the app answers { error } with its status. */
const refuse = (status: number, message: string) => Object.assign(new Error(message), { status })

const body = async (c: Context): Promise<any> => {
  try { const b = await c.req.json(); return b && typeof b === 'object' ? b : {} } catch { return {} }
}
const clientIp = (c: Context): string | null =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('cf-connecting-ip') || null

// The drawn signature is a large data URI: keep it out of lists and audit rows.
const withoutSignature = (row: any) => {
  if (!row) return row
  const { trainingAckSignature, ...rest } = row
  return { ...rest, hasTrainingAckSignature: !!trainingAckSignature }
}

const parseDataUri = (uri: unknown) => {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(uri || ''))
  return m ? { mime: m[1].toLowerCase(), base64: m[2] } : null
}
const safeFileName = (name: unknown) => String(name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200) || 'file'
const cleanName = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim()
const parseRemoval = (v: unknown): any => {
  if (!v) return null
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return null } }
  return v
}

/** Editable incident fields. Returns an error message or null. */
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

export function createIncidentRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission, requireAnyPermission } = d.permissions
  const read = requirePermission('care-compliance:read')
  const create = requirePermission('care-compliance:create')
  const update = requirePermission('care-compliance:update')
  const remove = requirePermission('care-compliance:delete')
  const canSee = canSeeWith(d.permissions)
  /** The office: whoever holds the case file (care-compliance:read). Anyone else is narrowed to their own clients. */
  const isOffice = (c: Context) => {
    const u = c.get('user' as never) as any
    return canSee(u.role, 'care-compliance:read', u.userId)
  }
  const me = (c: Context) => (c.get('user' as never) as any)
  const audit = (c: Context, action: string, table: string, id: string, oldData: unknown, newData: unknown, reasonCode?: string) =>
    core.careAudit.writeCareAudit(me(c), action, table, id, newData, oldData, { ipAddress: clientIp(c), reasonCode: reasonCode || null })

  async function addTimelineNote(q: Q & { select: (...a: any[]) => any }, companyId: string, incidentId: string, entryType: string, summary: string, byId: string, entryDate?: string) {
    const day = entryDate || await core.time.today(companyId, undefined, q)
    await insertTimelineEntry(q, companyId, incidentId, { entryDate: day, entryType, summary, byId })
  }

  async function notifyOffice(companyId: string, type: string, title: string, message: string) {
    try {
      for (const id of await officeUserIds(d.db, companyId)) await insertNotification(d.db, companyId, { userId: id, type, title, message })
    } catch (e: any) { d.logger.error('[incidents] notifying the office failed', { error: e?.message }) }
  }

  // ─── Summary (office dashboard figures) ──────────────────────────────────────
  app.get('/summary', read, async (c) => one(c, await incidentSummary(d.db, c.get('user').companyId)))

  // Payer responses due within 3 days (or overdue) and not yet sent — the dashboard's action item.
  app.get('/responses-due', read, async (c) => {
    const companyId = c.get('user').companyId
    const today = await core.time.today(companyId)
    const items = await incidentResponsesDue(d.db, companyId, addDays(today, 3))
    return one(c, { today, count: items.length, items })
  })

  // The clients a caregiver may file a field report for (the form's picker). The office sees all active clients.
  app.get('/my-clients', requireAnyPermission(['care-compliance:read', 'evv:create']), async (c) => {
    const u = c.get('user')
    const today = await core.time.today(u.companyId)
    const rows = await reportableClients(d.db, u.companyId, (await isOffice(c)) ? null : u.userId, today)
    return listAll(c, rows)
  })

  // Caregiver field report (caregiver app → "Report Incident"). The office gets an incident_alert notification and
  // the report lands in Daily care → Incidents as an open case.
  app.post('/caregiver-report', requireAnyPermission(['care-compliance:create', 'evv:create']), async (c) => {
    const u = c.get('user')
    const companyId = u.companyId
    const b = await body(c)
    if (isBlank(b.clientId)) return fail(c, 400, 'Please pick the client')
    if (!INCIDENT_TYPES[b.incidentType]) return fail(c, 400, 'Please pick what happened')
    if (!validYmd(b.incidentDate)) return fail(c, 400, 'Please enter the date')
    if (isBlank(b.description)) return fail(c, 400, 'Please describe what happened')
    if (!isBlank(b.incidentTime) && !HHMM_RE.test(String(b.incidentTime))) return fail(c, 400, 'Time must be HH:MM')
    const today = await core.time.today(companyId)
    if (b.incidentDate > today) return fail(c, 400, "The date can't be in the future")

    const photos: any[] = Array.isArray(b.photos) ? b.photos : []
    if (photos.length > 3) return fail(c, 400, 'Up to 3 photos')
    for (const ph of photos) {
      const parsed = parseDataUri(ph?.dataUri)
      if (!parsed || !parsed.mime.startsWith('image/') || !ATTACHMENT_ALLOWED_MIME.includes(parsed.mime)) return fail(c, 400, 'Photos must be images')
      if (String(ph.dataUri).length > ATTACHMENT_MAX_DATA_URI_LENGTH) return fail(c, 400, 'A photo is too large')
    }

    const office = await isOffice(c)
    if (!office) {
      if (!(await caregiverMayReportFor(d.db, companyId, u.userId, b.clientId, today))) return fail(c, 403, 'You can only report incidents for your own clients')
    } else {
      const [exists] = await d.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, b.clientId), eq(clients.companyId, companyId))).limit(1)
      if (!exists) return fail(c, 404, 'Client not found')
    }

    const [who] = await d.db.select({ firstName: user.firstName, lastName: user.lastName }).from(user).where(and(eq(user.id, u.userId), eq(user.companyId, companyId))).limit(1)
    const [client] = await d.db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(and(eq(clients.id, b.clientId), eq(clients.companyId, companyId))).limit(1)
    const reporterName = who ? cleanName(`${who.firstName} ${who.lastName}`) : 'Caregiver'
    const clientName = client ? cleanName(`${client.firstName} ${client.lastName}`) : 'client'

    const incident = await d.db.transaction(async (tx: any) => {
      const row = await insertIncident(tx, companyId, {
        clientId: b.clientId,
        // A caregiver names themselves, whatever the body says; the office may name the caregiver involved.
        caregiverId: office ? orNull(b.caregiverId) : u.userId,
        incidentType: b.incidentType, severity: 'moderate',
        incidentDate: b.incidentDate, incidentTime: orNull(b.incidentTime),
        description: String(b.description).trim(), witnesses: orNull(b.witnesses),
        injuriesOrDamage: orNull(b.injuriesOrDamage), actionsTaken: orNull(b.actionsTaken),
        reportedBy: reporterName, reportedDate: today,
      }, u.userId, 'open')
      await addTimelineNote(tx, companyId, row.id, 'note', `Reported by ${reporterName} through the caregiver app.`, u.userId, today)
      for (const ph of photos) {
        const parsed = parseDataUri(ph.dataUri)!
        await insertAttachment(tx, companyId, row.id, {
          category: 'photo', fileName: safeFileName(ph.fileName || 'photo.jpg'), mimeType: parsed.mime,
          fileSize: Math.floor(parsed.base64.length * 3 / 4), dataUri: ph.dataUri, description: `Photo from ${reporterName}`, byId: u.userId,
        })
      }
      return row
    })
    await audit(c, 'CREATE', 'incidents', incident.id, null, withoutSignature(incident))

    await notifyOffice(companyId, 'incident_alert', `⚠️ Incident reported: ${clientName}`,
      `${reporterName} reported ${INCIDENT_TYPES[b.incidentType]} for ${clientName} on ${b.incidentDate}${b.incidentTime ? ` at ${b.incidentTime}` : ''}: ${String(b.description).trim().slice(0, 300)}\n\nOpen Daily care → Incidents (${incident.incidentNumber}).`)

    return one(c, { success: true, id: incident.id, incidentNumber: incident.incidentNumber }, 201)
  })

  // ─── List / read ─────────────────────────────────────────────────────────────
  // GET /api/incidents?status=&severity=
  app.get('/', read, async (c) => {
    const { status, severity } = c.req.query()
    const rows = (await listIncidents(d.db, c.get('user').companyId, { status, severity })).map(withoutSignature)
    return listAll(c, rows)
  })

  app.get('/:id', read, async (c) => {
    const row = await incidentCase(d.db, c.get('user').companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Incident not found')
    return one(c, row)
  })

  // ─── Create / edit / delete ──────────────────────────────────────────────────
  app.post('/', create, async (c) => {
    const u = c.get('user')
    const b = await body(c)
    const err = validateIncidentBody(b)
    if (err) return fail(c, 400, err)
    const status = INCIDENT_STATUSES[b.status] ? b.status : 'open'
    const incident = await d.db.transaction((tx: any) => insertIncident(tx, u.companyId, b, u.userId, status))
    await audit(c, 'CREATE', 'incidents', incident.id, null, withoutSignature(incident))
    return one(c, withoutSignature(incident), 201)
  })

  // Full edit of the case fields (the older PATCH below stays for compatibility; it COALESCEs, so it can never clear a field).
  app.put('/:id', update, async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const b = await body(c)
    const err = validateIncidentBody(b)
    if (err) return fail(c, 400, err)
    const p = await incidentRow(d.db, u.companyId, id)
    if (!p) return fail(c, 404, 'Incident not found')

    // caregiver_removal points at THIS caregiver's schedules for THIS client.
    const removalActive = p.caregiverRemovedFrom && !p.caregiverReturnedOn
    if (removalActive && (b.clientId !== p.clientId || orNull(b.caregiverId) !== p.caregiverId)) {
      return fail(c, 409, 'Return the caregiver to the schedule before changing the client or caregiver on this incident.')
    }

    const status = b.status || p.investigationStatus || 'open'
    let closedDate: string | null = orNull(b.closedDate)
    if (status === 'closed' && !closedDate) closedDate = await core.time.today(u.companyId)
    if (status !== 'closed') closedDate = null
    const resolvedById = status === 'closed' ? (p.resolvedById || u.userId) : null

    const row = await updateIncidentCase(d.db, u.companyId, id, b, { severity: b.severity || p.severity || 'moderate', status, closedDate, resolvedById })
    await audit(c, 'UPDATE', 'incidents', id, withoutSignature(p), withoutSignature(row))
    return one(c, withoutSignature(row))
  })

  app.patch('/:id', update, async (c) => {
    const id = c.req.param('id')
    const b = await body(c)
    if (!isBlank(b.severity) && !SEVERITIES[b.severity]) return fail(c, 400, 'Severity is not valid')
    const row = await patchIncident(d.db, c.get('user').companyId, id, b)
    if (!row) return fail(c, 404, 'Incident not found')
    await audit(c, 'UPDATE', 'incidents', id, null, withoutSignature(row))
    return one(c, withoutSignature(row))
  })

  app.delete('/:id', remove, async (c) => {
    const companyId = c.get('user').companyId
    const id = c.req.param('id')
    // A caregiver still removed from the schedule by this incident must be returned first — deleting would orphan the
    // paused schedules with no way to restore them.
    const cur = await incidentRow(d.db, companyId, id)
    if (!cur) return fail(c, 404, 'Incident not found')
    if (cur.caregiverRemovedFrom && !cur.caregiverReturnedOn) {
      return fail(c, 409, 'Return the caregiver to the schedule before deleting this incident.')
    }
    const row = await deleteIncident(d.db, companyId, id)
    if (!row) return fail(c, 404, 'Incident not found')
    await audit(c, 'DELETE', 'incidents', id, null, withoutSignature(row))
    return done(c, 'Incident report deleted')
  })

  // ─── Investigation timeline ──────────────────────────────────────────────────
  app.get('/:id/notes', read, async (c) => {
    const rows = await timelineEntries(d.db, c.get('user').companyId, c.req.param('id'))
    return listAll(c, rows)
  })

  app.post('/:id/notes', create, async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const { entryDate, entryType, summary } = await body(c)
    if (!validYmd(entryDate)) return fail(c, 400, 'Date is required')
    if (!ENTRY_TYPES[entryType]) return fail(c, 400, 'Entry type is not valid')
    if (isBlank(summary)) return fail(c, 400, 'Describe what happened')
    if (String(summary).length > 5000) return fail(c, 400, 'Keep the entry under 5,000 characters')
    if (!(await incidentRow(d.db, u.companyId, id))) return fail(c, 404, 'Incident not found')
    const row = await insertTimelineEntry(d.db, u.companyId, id, { entryDate, entryType, summary: String(summary).trim(), byId: u.userId })
    await audit(c, 'CREATE', 'incident_investigation_notes', row.id, null, row)
    return one(c, row, 201)
  })

  app.delete('/:id/notes/:noteId', remove, async (c) => {
    const row = await deleteTimelineEntry(d.db, c.get('user').companyId, c.req.param('id'), c.req.param('noteId'))
    if (!row) return fail(c, 404, 'Entry not found')
    await audit(c, 'DELETE', 'incident_investigation_notes', row.id, row, null)
    return done(c, 'Entry deleted')
  })

  // ─── Attachments (stored in the database) ────────────────────────────────────
  app.get('/:id/attachments', read, async (c) => {
    const rows = await attachmentIndex(d.db, c.get('user').companyId, c.req.param('id'))
    return listAll(c, rows)
  })

  app.get('/:id/attachments/:attachmentId', read, async (c) => {
    const row = await attachmentFile(d.db, c.get('user').companyId, c.req.param('id'), c.req.param('attachmentId'))
    if (!row) return fail(c, 404, 'Attachment not found')
    const parsed = parseDataUri(row.fileData)
    if (!parsed) return fail(c, 500, 'Stored file is unreadable')
    return c.body(new Uint8Array(Buffer.from(parsed.base64, 'base64')), 200, {
      'Content-Type': row.mimeType,
      'Content-Disposition': `inline; filename="${safeFileName(row.fileName)}"`,
    })
  })

  app.post('/:id/attachments', create, async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const { category, fileName, dataUri, description } = await body(c)
    if (!ATTACHMENT_CATEGORIES[category]) return fail(c, 400, 'Pick what kind of document this is')
    if (isBlank(fileName)) return fail(c, 400, 'File name is required')
    const parsed = parseDataUri(dataUri)
    if (!parsed) return fail(c, 400, 'The file could not be read')
    if (!ATTACHMENT_ALLOWED_MIME.includes(parsed.mime)) return fail(c, 400, 'Only PDF and image files can be attached')
    if (String(dataUri).length > ATTACHMENT_MAX_DATA_URI_LENGTH) return fail(c, 400, 'File is too large (7 MB max)')
    if (!(await incidentRow(d.db, u.companyId, id))) return fail(c, 404, 'Incident not found')
    const row = await insertAttachment(d.db, u.companyId, id, {
      category, fileName: safeFileName(fileName), mimeType: parsed.mime, fileSize: Math.floor(parsed.base64.length * 3 / 4),
      dataUri, description: orNull(description), byId: u.userId,
    })
    await audit(c, 'CREATE', 'incident_attachments', row.id, null, row)
    return one(c, row, 201)
  })

  app.delete('/:id/attachments/:attachmentId', remove, async (c) => {
    const row = await deleteAttachment(d.db, c.get('user').companyId, c.req.param('id'), c.req.param('attachmentId'))
    if (!row) return fail(c, 404, 'Attachment not found')
    await audit(c, 'DELETE', 'incident_attachments', row.id, row, null)
    return done(c, 'Attachment deleted')
  })

  // ─── Caregiver schedule for this client (read) ───────────────────────────────
  app.get('/:id/caregiver-schedule', read, async (c) => {
    const companyId = c.get('user').companyId
    const i = await incidentRemovalState(d.db, companyId, c.req.param('id'))
    if (!i) return fail(c, 404, 'Incident not found')
    if (!i.caregiverId || !i.clientId) return one(c, { caregiverId: i.caregiverId || null, schedules: [], upcomingVisits: 0, lastVisit: null })
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const removal = parseRemoval(i.caregiverRemoval)
    const removalActive = !!(i.removedFrom && !i.returnedOn)
    // The rows this removal took off the schedule still belong in the list, shown as paused.
    const pausedIds: string[] = removalActive ? (removal?.schedules || []).map((s: any) => s.schedule_id) : []
    const [sched, upcoming, last] = await Promise.all([
      caregiverClientSchedules(d.db, companyId, { caregiverId: i.caregiverId, clientId: i.clientId, today, pausedIds }),
      caregiverClientVisitCount(d.db, companyId, i.caregiverId, i.clientId, today, addDays(today, 27)),
      lastCaregiverClockInDate(d.db, companyId, i.clientId, i.caregiverId, tz),
    ])
    const pausedSet = new Set(pausedIds)
    return one(c, {
      caregiverId: i.caregiverId,
      removedFrom: i.removedFrom, returnedOn: i.returnedOn,
      removal, today,
      schedules: sched.map((s: any) => ({ ...s, pausedFrom: pausedSet.has(s.id) ? removal.from_date : null })),
      upcomingVisits: upcoming, lastVisit: last,
    })
  })

  // ─── Remove caregiver from this client pending investigation ─────────────────
  // Takes THIS caregiver off THIS client's schedule from fromDate: a recurring pattern is end-dated the day before, a
  // one-time visit on/after fromDate is deactivated. Not schedules.suspended_from: that column is the CLIENT's "suspend
  // service" switch, so pausing one caregiver through it would be undone by resuming the client's service. Before that:
  //   · their upcoming visits are expanded and posted as open shifts for coverage (when asked);
  //   · visits on their patterns already covered by ANOTHER caregiver (a per-day override) become that caregiver's own
  //     one-time visits, or ending the pattern would erase them;
  //   · visits they cover on other caregivers' patterns for this client are released (and posted).
  // Every change is recorded in caregiver_removal so return-caregiver can undo it exactly.
  app.post('/:id/remove-caregiver', update, async (c) => {
    const companyId = c.get('user').companyId
    const id = c.req.param('id')
    const b = await body(c)
    const byId = c.get('user').userId
    const result = await d.db.transaction(async (tx: any) => {
      const inc = await lockIncidentForRemoval(tx, companyId, id)
      if (!inc) throw refuse(404, 'Incident not found')
      const caregiverName = cleanName(inc.caregiverName)
      const clientName = cleanName(inc.clientName)
      if (!inc.caregiverId) throw refuse(400, 'This incident has no caregiver to remove.')
      if (!inc.clientId) throw refuse(400, 'This incident has no client.')
      if (inc.removedFrom && !inc.caregiverReturnedOn) throw refuse(409, `This caregiver is already removed, effective ${inc.removedFrom}.`)

      const today = await core.time.today(companyId, undefined, tx)
      const fromDate = isBlank(b.fromDate) ? today : String(b.fromDate)
      if (!validYmd(fromDate)) throw refuse(400, 'Start date must be a valid date')
      if (fromDate < today) throw refuse(400, 'Removal can start today or later. Visits already worked stay as they are.')
      const postOpenShifts = b.postOpenShifts !== false
      const coverageWeeks = Math.min(12, Math.max(1, parseInt(b.coverageWeeks, 10) || 4))
      const toDate = addDays(fromDate, coverageWeeks * 7 - 1)
      const dayBefore = addDays(fromDate, -1)

      const targets = await removalTargets(tx, companyId, inc.caregiverId, inc.clientId, fromDate)
      const targetIds = targets.map((r: any) => r.id)
      const own = postOpenShifts ? await ownVisitsOn(tx, companyId, targetIds, inc.caregiverId, fromDate, toDate) : []

      const coveredByOthers = await coversByOthers(tx, companyId, targetIds, inc.caregiverId, fromDate)
      const converted: any[] = []
      for (const o of coveredByOthers) {
        const endDay = o.endTime && o.startTime && o.endTime < o.startTime ? addDays(o.d, 1) : o.d
        const newId = await insertOneTimeVisit(tx, companyId, {
          clientId: o.clientId, caregiverId: o.overrideCaregiverId, date: o.d, startTime: o.startTime, endDate: endDay, endTime: o.endTime, notes: o.notes,
        })
        await setExceptionType(tx, companyId, o.exceptionId, 'cancelled')
        converted.push({ exception_id: o.exceptionId, schedule_id: o.scheduleId, date: o.d, new_schedule_id: newId, caregiver_id: o.overrideCaregiverId })
      }

      const movedIn = await coversHeldElsewhere(tx, companyId, inc.caregiverId, inc.clientId, fromDate)
      for (const m of movedIn) await setExceptionType(tx, companyId, m.exceptionId, 'cancelled')

      const recurring = targets.filter((t: any) => t.dayOfWeek !== null && t.dayOfWeek !== undefined)
      const oneTime = targets.filter((t: any) => t.dayOfWeek === null || t.dayOfWeek === undefined)
      await endPatterns(tx, companyId, recurring.map((r: any) => r.id), dayBefore)
      await deactivateVisits(tx, companyId, oneTime.map((r: any) => r.id))

      const openShifts: any[] = []
      if (postOpenShifts) {
        const toCover = [
          ...own.map((o: any) => ({ scheduleId: o.scheduleId, shiftDate: o.shiftDate, startTime: o.startTime, endTime: o.endTime, source: 'own', exceptionId: null })),
          ...movedIn.map((m: any) => ({ scheduleId: m.scheduleId, shiftDate: m.d, startTime: m.startTime, endTime: m.endTime, source: 'covering', exceptionId: m.exceptionId })),
        ]
        for (const o of toCover) {
          if (await openShiftAlreadyPosted(tx, companyId, inc.clientId, o.shiftDate, o.startTime)) continue
          const osId = await postCoverageShift(tx, companyId, { clientId: inc.clientId, date: o.shiftDate, startTime: o.startTime, endTime: o.endTime, byId })
          openShifts.push({ open_shift_id: osId, schedule_id: o.scheduleId, shift_date: o.shiftDate, source: o.source, exception_id: o.exceptionId })
        }
      }

      const removal = {
        from_date: fromDate, coverage_to: postOpenShifts ? toDate : null, removed_by: byId,
        schedules: [
          ...recurring.map((t: any) => ({ schedule_id: t.id, kind: 'recurring', prior_end_date: t.endDate || null })),
          ...oneTime.map((t: any) => ({ schedule_id: t.id, kind: 'one-time' })),
        ],
        converted_overrides: converted,
        released_covers: movedIn.map((m: any) => ({ exception_id: m.exceptionId, schedule_id: m.scheduleId, date: m.d })),
        open_shifts: openShifts,
      }
      await markCaregiverRemoved(tx, companyId, inc.id, fromDate, removal)

      const n = targets.length
      const summary = `Removed ${caregiverName} from ${clientName}'s schedule effective ${fromDate}. `
        + `${n} schedule${n === 1 ? '' : 's'} paused. `
        + (postOpenShifts ? `${openShifts.length} upcoming visit${openShifts.length === 1 ? '' : 's'} through ${toDate} posted as open shifts for coverage.` : 'No open shifts posted.')
        + (converted.length ? ` ${converted.length} visit${converted.length === 1 ? '' : 's'} already covered by other caregivers kept as their own shifts.` : '')
        + (movedIn.length ? ` ${movedIn.length} visit${movedIn.length === 1 ? '' : 's'} this caregiver was covering for others released.` : '')
      await addTimelineNote(tx, companyId, inc.id, 'schedule', summary, byId, today)
      return { inc, fromDate, targets, converted, movedIn, openShifts, removal, summary }
    })

    for (const t of result.targets) {
      await audit(c, 'SUSPEND', 'schedules', t.id, { end_date: t.endDate, day_of_week: t.dayOfWeek },
        { scope: 'incident_caregiver_removal', from_date: result.fromDate, incident_id: result.inc.id }, 'incident_removal')
    }
    for (const cv of result.converted) {
      await audit(c, 'CREATE', 'schedules', cv.new_schedule_id, null,
        { from_override: cv.exception_id, caregiver_id: cv.caregiver_id, date: cv.date, incident_id: result.inc.id }, 'incident_removal')
    }
    await audit(c, 'CAREGIVER_REMOVED', 'incidents', result.inc.id, null, result.removal, 'incident_removal')

    return one(c, {
      success: true, fromDate: result.fromDate, schedulesPaused: result.targets.length, openShiftsPosted: result.openShifts.length,
      coveredVisitsKept: result.converted.length, coversReleased: result.movedIn.length, summary: result.summary,
    })
  })

  // ─── Return caregiver to this client's schedule ──────────────────────────────
  // Restores each changed row to its PRIOR value (only if nobody changed it since). Coverage still unclaimed is
  // cancelled. Coverage a replacement already took is kept, and this caregiver's own copy of that day is cancelled so
  // the visit isn't double-staffed.
  app.post('/:id/return-caregiver', update, async (c) => {
    const companyId = c.get('user').companyId
    const id = c.req.param('id')
    const byId = c.get('user').userId
    const result = await d.db.transaction(async (tx: any) => {
      const inc = await lockIncidentForRemoval(tx, companyId, id)
      if (!inc) throw refuse(404, 'Incident not found')
      if (!inc.removedFrom || inc.caregiverReturnedOn) throw refuse(409, 'The caregiver is not currently removed from this schedule.')
      const removal = parseRemoval(inc.caregiverRemoval) || {}
      const today = await core.time.today(companyId, undefined, tx)
      const dayBefore = addDays(removal.from_date || inc.removedFrom, -1)

      const restored: string[] = [], skipped: string[] = []
      for (const s of removal.schedules || []) {
        const ok = s.kind === 'one-time'
          ? await restoreOneTimeVisit(tx, companyId, s.schedule_id)
          : await restorePatternEnd(tx, companyId, s.schedule_id, s.prior_end_date || null, dayBefore)
        ;(ok ? restored : skipped).push(s.schedule_id)
      }

      let cancelledOpenShifts = 0
      const keptReplacements: any[] = []
      const postedCoverExceptions = new Set<string>()
      for (const o of removal.open_shifts || []) {
        if (o.exception_id) postedCoverExceptions.add(o.exception_id)
        const os = await openShiftState(tx, companyId, o.open_shift_id)
        if (!os) continue
        if (os.d < today) continue
        if (['open', 'claimed'].includes(os.status)) {
          await cancelUnfilledShift(tx, companyId, o.open_shift_id)
          cancelledOpenShifts++
          if (o.source === 'covering' && o.exception_id) await setExceptionType(tx, companyId, o.exception_id, 'modified', 'cancelled')
        } else if (os.status === 'filled') {
          if (o.source === 'own' && o.schedule_id) await cancelPatternDay(tx, companyId, o.schedule_id, os.d, byId)
          keptReplacements.push({ open_shift_id: o.open_shift_id, date: os.d })
        }
      }
      // Covers released without being posted (postOpenShifts was off): give them back.
      let restoredCovers = 0
      for (const cv of removal.released_covers || []) {
        if (postedCoverExceptions.has(cv.exception_id) || cv.date < today) continue
        restoredCovers += await setExceptionType(tx, companyId, cv.exception_id, 'modified', 'cancelled')
      }

      const returned = { returned_on: today, returned_by: byId, restored, skipped, cancelled_open_shifts: cancelledOpenShifts, kept_replacements: keptReplacements, restored_covers: restoredCovers }
      await markCaregiverReturned(tx, companyId, inc.id, today, returned)

      const caregiverName = cleanName(inc.caregiverName)
      const clientName = cleanName(inc.clientName)
      const summary = `Returned ${caregiverName} to ${clientName}'s schedule on ${today}. `
        + `${restored.length} schedule${restored.length === 1 ? '' : 's'} restored`
        + (skipped.length ? `, ${skipped.length} left as-is because they were changed after the removal` : '') + '. '
        + `${cancelledOpenShifts} unclaimed coverage shift${cancelledOpenShifts === 1 ? '' : 's'} cancelled.`
        + (keptReplacements.length ? ` ${keptReplacements.length} visit${keptReplacements.length === 1 ? '' : 's'} already covered by a replacement stay with the replacement.` : '')
      await addTimelineNote(tx, companyId, inc.id, 'schedule', summary, byId, today)
      return { inc, restored, skipped, cancelledOpenShifts, keptReplacements, returned, summary }
    })

    for (const sid of result.restored) {
      await audit(c, 'RESUME', 'schedules', sid, null, { scope: 'incident_caregiver_return', incident_id: result.inc.id }, 'incident_removal')
    }
    await audit(c, 'CAREGIVER_RETURNED', 'incidents', result.inc.id, null, result.returned, 'incident_removal')
    return one(c, {
      success: true, restored: result.restored.length, skipped: result.skipped.length,
      cancelledOpenShifts: result.cancelledOpenShifts, keptReplacements: result.keptReplacements.length, summary: result.summary,
    })
  })

  // ─── Signed training acknowledgement ─────────────────────────────────────────
  // Signing records the acknowledgement on the incident AND adds completed training_records rows (medication handling,
  // misappropriation policy) to the caregiver's file.
  app.post('/:id/training-acknowledgement', update, async (c) => {
    const companyId = c.get('user').companyId
    const id = c.req.param('id')
    const byId = c.get('user').userId
    const { signature, signerName, supervisorName, method } = await body(c)
    const parsed = parseDataUri(signature)
    if (!parsed || !parsed.mime.startsWith('image/')) return fail(c, 400, 'A drawn signature is required')
    if (String(signature).length > 2_000_000) return fail(c, 400, 'Signature image is too large')
    if (isBlank(signerName)) return fail(c, 400, "Type the caregiver's name")
    if (isBlank(supervisorName)) return fail(c, 400, 'Enter who reviewed it with the caregiver')
    if (!TRAINING_ACK_METHODS[method]) return fail(c, 400, 'Pick how it was reviewed')
    const signer = String(signerName).trim()
    const supervisor = String(supervisorName).trim()

    const result = await d.db.transaction(async (tx: any) => {
      const inc = await lockIncidentForAcknowledgement(tx, companyId, id)
      if (!inc) throw refuse(404, 'Incident not found')
      if (!inc.caregiverId) throw refuse(400, 'This incident has no caregiver')
      if (inc.trainingAckSignedAt) throw refuse(409, 'The acknowledgement for this incident is already signed')
      const today = await core.time.today(companyId, undefined, tx)
      const [ag] = await tx.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)

      await recordAcknowledgement(tx, companyId, inc.id, { signer, signature, supervisor, method })
      const provider = `${ag?.name || 'Agency'}: reviewed with ${supervisor}`.slice(0, 255)
      const records: any[] = []
      for (const name of TRAINING_ACK_TRAINING_NAMES) {
        records.push(await insertCompletedTraining(tx, companyId, { caregiverId: inc.caregiverId, name, provider, date: today }))
      }
      await addTimelineNote(tx, companyId, inc.id, 'action',
        `${signer} signed the medication handling and misappropriation training acknowledgement (${TRAINING_ACK_METHODS[method].toLowerCase()}), reviewed with ${supervisor}. Added to the caregiver's training record.`,
        byId, today)
      return { inc, records }
    })

    for (const r of result.records) await audit(c, 'CREATE', 'training_records', r.id, null, r)
    // The signing dialog tells the signer their IP address and the time are recorded.
    await audit(c, 'TRAINING_ACK_SIGNED', 'incidents', result.inc.id, null, {
      training_ack_signer_name: signer, training_ack_supervisor: supervisor, training_ack_method: method,
      signed_from_ip: clientIp(c), signed_at: new Date().toISOString(),
    })
    return one(c, { success: true, trainingRecords: result.records.length }, 201)
  })

  // ─── PDFs ────────────────────────────────────────────────────────────────────
  async function sendIncidentPdf(c: Context, kind: 'report' | 'packet') {
    const companyId = (c.get('user' as never) as any).companyId
    const id = c.req.param('id') as string
    const data = await core.incidentPdf.loadIncidentCase(companyId, id)
    if (!data) return fail(c, 404, 'Incident not found')
    const includeSchedule = c.req.query('includeSchedule') === '1'
    const pdf = await incidentPdfBuffer(data, kind, { includeSchedule })
    const base = kind === 'packet' ? 'incident-response-packet' : 'incident-report'
    const name = `${base}-${data.incident.incidentNumber || id}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_')
    await audit(c, 'REPORT_GENERATED_PDF', 'incidents', id, null, { report: base, includeSchedule: kind === 'packet' ? includeSchedule : undefined })
    return c.body(new Uint8Array(pdf), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
    })
  }
  app.get('/:id/pdf', read, (c) => sendIncidentPdf(c, 'report'))
  app.get('/:id/response-packet', read, (c) => sendIncidentPdf(c, 'packet'))

  return app
}
