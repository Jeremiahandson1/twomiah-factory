// ADAPTED COPY of tests/homecare/incidents.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 7 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — the incident case file (ported from CVHC v64 + v68), through the real routes.
//
// What is asserted, and why each matters:
//   · who may do what: the whole case file is the office's (admin/owner); a caregiver may only file a
//     field report, and only for their own clients
//   · the printed number IR-<year>-<nnn> is never reused — not even after the newest is deleted
//     (CVHC's MAX+1 would reuse it; a number already in a payer's file must keep meaning one incident)
//   · the migration's backfill of old rows: numbers in creation order per year, low/medium/high and
//     old statuses mapped onto the case-file vocabulary
//   · removing a caregiver from a client pending investigation: exactly which schedules pause, which
//     visits are posted for coverage, which covers are converted or released — and that "return"
//     restores precisely what was changed, keeps a replacement's visit, and never double-staffs it
//   · the signed training acknowledgement writes the caregiver's training record once
//   · the payer packet's facts (other members of the same payer, the schedule sentence) and the PDFs
import { Hono } from 'hono'
import { readFileSync, readdirSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db, pglite } from './db/index.ts'
import { agencies, users, clients, schedules, scheduleExceptions, referralSources, timeEntries, authorizations, backgroundChecks } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const q = async (query: any): Promise<any[]> => ((await db.execute(query)) as any).rows
const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v /* unified: templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged */

await setupSchema()

const TZ = 'America/Chicago'
const [ag] = await db.insert(agencies).values({
  name: 'Riverbend Home Care', slug: 'riverbend', state: 'WI', city: 'Springfield', phone: '555-0100',
  timezone: TZ,
} as any).returning()

const mkUser = async (role: string, first: string, last: string) => (await db.insert(users).values({
  email: `${first.toLowerCase()}-${last.toLowerCase()}-inc@test.local`, passwordHash: 'x', firstName: first, lastName: last, role,
} as any).returning())[0]
const owner = await mkUser('owner', 'Olive', 'Owner')
const admin = await mkUser('admin', 'Adam', 'Admin')
const cg1 = await mkUser('caregiver', 'Casey', 'One')
const cg2 = await mkUser('caregiver', 'Dana', 'Two')
const cg3 = await mkUser('caregiver', 'Eli', 'Three')

const [payer] = await db.insert(referralSources).values({ name: 'Lakeside Health Plan', type: 'mco' } as any).returning()
const [payer2] = await db.insert(referralSources).values({ name: 'Other Plan', type: 'mco' } as any).returning()
const mkClient = async (first: string, last: string, extra: any = {}) => (await db.insert(clients).values({ firstName: first, lastName: last, ...extra } as any).returning())[0]
const clientA = await mkClient('Ada', 'Member', { referredById: payer.id, medicaidId: 'MA123' })
const clientB = await mkClient('Ben', 'Member', { referredById: payer.id })
const clientC = await mkClient('Cy', 'Other', { referredById: payer2.id })
const clientD = await mkClient('Dee', 'Authonly')
const clientE = await mkClient('Eve', 'Stranger')

const [{ d: TODAY }] = await q(sql`SELECT to_char((NOW() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS d`)
const addDays = (ymd: string, n: number) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d)); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const dow = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay()
const longDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
// A Monday at least a week out, so every occurrence below is in the future and deterministic.
let FROM = addDays(TODAY, 7); while (dow(FROM) !== 1) FROM = addDays(FROM, 1)
const YEAR = Number(TODAY.slice(0, 4))

const routes = (await import('./src/routes/incidents.ts')).default
const app = new Hono()
app.route('/api/incidents', routes)

const as = (who: any, extraHeaders: Record<string, string> = {}) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-role': who.role, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {} /* unified: each reply read through templateShape */
  return { status: res.status, json: j, headers: res.headers }
}
const raw = async (who: any, path: string) => app.request(path, { headers: { 'x-test-user': who.id, 'x-test-role': who.role } })
const A = as(admin), O = as(owner), CG1 = as(cg1), CG2 = as(cg2)

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const base = (over: any = {}) => ({
  clientId: clientA.id, caregiverId: cg1.id, incidentType: 'missing_medication', severity: 'moderate',
  incidentDate: `${YEAR}-03-02`, incidentTime: '10:15', description: 'Payer reports missing medication.',
  reportedBy: 'Lakeside Health Plan', reportedDate: TODAY, reporterContactName: 'Rita Manager',
  reporterPhone: '555-0199', reporterEmail: 'rita@example.com', ...over,
})

// ── 1. who may do what ─────────────────────────────────────────────────────────────────
{
  const officeOnly: Array<[string, string, unknown?]> = [
    ['GET', '/api/incidents'], ['GET', '/api/incidents/summary'], ['GET', '/api/incidents/responses-due'],
    ['POST', '/api/incidents', base()], ['GET', '/api/incidents/x1'], ['PUT', '/api/incidents/x1', base()],
    ['PATCH', '/api/incidents/x1', {}], ['DELETE', '/api/incidents/x1'],
    ['GET', '/api/incidents/x1/notes'], ['POST', '/api/incidents/x1/notes', {}], ['DELETE', '/api/incidents/x1/notes/n1'],
    ['GET', '/api/incidents/x1/attachments'], ['POST', '/api/incidents/x1/attachments', {}],
    ['GET', '/api/incidents/x1/attachments/a1'], ['DELETE', '/api/incidents/x1/attachments/a1'],
    ['GET', '/api/incidents/x1/caregiver-schedule'], ['POST', '/api/incidents/x1/remove-caregiver', {}],
    ['POST', '/api/incidents/x1/return-caregiver', {}], ['POST', '/api/incidents/x1/training-acknowledgement', {}],
    ['GET', '/api/incidents/x1/pdf'], ['GET', '/api/incidents/x1/response-packet'],
  ]
  for (const [m, p, b] of officeOnly) {
    const r = await CG1(m, p, b)
    check(`a caregiver is refused ${m} ${p}`, r.status === 403 && r.json?.error === 'Permission denied' /* unified: the office's paths are gated by care-compliance permissions (requirePermission), whose refusal is 'Permission denied' */, { status: r.status, body: r.json })
  }
  const o = await O('GET', '/api/incidents/x1')
  check('an owner reaches the case file (404 for an unknown id, not 403)', o.status === 404, o)
  const anon = await app.request('/api/incidents')
  check('nobody signed in gets nothing', anon.status === 401, anon.status)
  const other = await as({ id: admin.id, role: 'family' })('POST', '/api/incidents/caregiver-report', {})
  check('a role outside the field and the office cannot file a field report', other.status === 403, other)
}

// ── 2. create: validation and numbering ────────────────────────────────────────────────
{
  const bad: Array<[any, string]> = [
    [{ clientId: '' }, 'Client is required'],
    [{ incidentType: 'nope' }, 'Incident type is not valid'],
    [{ description: '  ' }, 'Description is required'],
    [{ incidentDate: '2026-13-45' }, 'Incident date is required'],
    [{ severity: 'low' }, 'Severity is not valid'],
    [{ incidentTime: '9am' }, 'Incident time must be HH:MM'],
    [{ responseDueDate: 'soon' }, 'Response due date must be a valid date'],
    [{ status: 'resolved' }, 'Status is not valid'],
    [{ disposition: 'maybe' }, 'Conclusion is not valid'],
    [{ mandatoryReportStatus: 'later' }, 'Mandatory report decision is not valid'],
  ]
  for (const [over, msg] of bad) {
    const r = await A('POST', '/api/incidents', base(over))
    check(`create refuses: ${msg}`, r.status === 400 && r.json?.error === msg, r.json)
  }
}
const created = await A('POST', '/api/incidents', base())
check('an admin creates an incident', created.status === 201, created.json)
const INC = created.json
check('…numbered IR-<year>-001', INC.incident_number === `IR-${YEAR}-001`, INC.incident_number)
check('…open by default, entered by the admin', INC.investigation_status === 'open' && INC.reported_by_id === admin.id, INC)
const second = await A('POST', '/api/incidents', base({ description: 'Second.' }))
check('the next one is 002', second.json?.incident_number === `IR-${YEAR}-002`, second.json)
const prevYear = await O('POST', '/api/incidents', base({ incidentDate: `${YEAR - 1}-12-30`, description: 'Last year.' }))
check('the year is the INCIDENT\'s year, numbered on its own', prevYear.json?.incident_number === `IR-${YEAR - 1}-001`, prevYear.json)
{
  const del = await A('DELETE', `/api/incidents/${second.json.id}`)
  check('an admin deletes the newest', del.status === 200, del.json)
  const third = await A('POST', '/api/incidents', base({ description: 'Third.' }))
  check('a deleted incident\'s number is never handed out again (003, not 002)', third.json?.incident_number === `IR-${YEAR}-003`, third.json)
  await A('DELETE', `/api/incidents/${third.json.id}`)
}

if (false) // ── 3. not run on the unified app: the template's migration 0019 backfill /* unified: section 3 replays the template's migration 0019 data heal (old severities, statuses and numbers) against old-shape rows; the unified schema is migration 0007, and moved tenants' rows arrive through the cutover data move. A new number continuing above the existing ones is nextIncidentNumber's GREATEST(MAX + 1), held by apps/unified/tests/homecare-office.test.ts */ ───────────────────────────
{
  const mig = readFileSync('./db/migrations/0019_incidents.sql', 'utf8').split('--> statement-breakpoint').map((s) => s.trim())
  const stmt = (needle: string) => mig.find((s) => s.includes(needle))!
  await q(sql`INSERT INTO incidents (id, client_id, incident_type, severity, date, description, investigation_status, created_at)
              VALUES ('old1', ${clientA.id}, 'fall', 'low', '2019-05-01', 'old', 'resolved', '2019-05-02'),
                     ('old2', ${clientA.id}, 'fall', 'high', '2019-02-01', 'old', 'in_progress', '2019-05-03'),
                     ('old3', ${clientA.id}, 'fall', 'medium', '2019-07-01', 'old', 'weird', '2019-05-01')`)
  for (const needle of ['UPDATE "incidents" SET "severity"', 'UPDATE "incidents" SET "investigation_status"', 'UPDATE "incidents" i', 'INSERT INTO "incident_number_counters"']) {
    await pglite.exec(stmt(needle))
  }
  const rows = await q(sql`SELECT id, severity, investigation_status, incident_number FROM incidents WHERE id IN ('old1','old2','old3') ORDER BY id`)
  const by = Object.fromEntries(rows.map((r) => [r.id, r]))
  check('backfill maps low → minor, high → severe, medium → moderate', by.old1.severity === 'minor' && by.old2.severity === 'severe' && by.old3.severity === 'moderate', rows)
  check('backfill maps resolved → closed, in_progress → investigating, anything else → open',
    by.old1.investigation_status === 'closed' && by.old2.investigation_status === 'investigating' && by.old3.investigation_status === 'open', rows)
  check('backfill numbers old rows in creation order within the year',
    by.old3.incident_number === 'IR-2019-001' && by.old1.incident_number === 'IR-2019-002' && by.old2.incident_number === 'IR-2019-003', rows)
  const again = await A('POST', '/api/incidents', base({ incidentDate: '2019-09-09', description: 'After backfill.' }))
  check('a new incident in a backfilled year continues above it (IR-2019-004)', again.json?.incident_number === 'IR-2019-004', again.json)
  check('the backfill left numbered rows alone', (await q(sql`SELECT incident_number FROM incidents WHERE id = ${INC.id}`))[0].incident_number === `IR-${YEAR}-001`)
  await q(sql`DELETE FROM incidents WHERE id IN ('old1','old2','old3', ${again.json.id})`)
}

// ── 4. edit the case ───────────────────────────────────────────────────────────────────
{
  const r = await A('PUT', `/api/incidents/${INC.id}`, base({
    status: 'closed', disposition: 'unsubstantiated', findings: 'No staff involvement found.',
    mandatoryReportStatus: 'not_required', payerResponseNotes: 'The caregiver never contacted management about controlled medications.',
    responseDueDate: addDays(TODAY, 2), actionsTaken: 'Called the family.',
  }))
  check('PUT saves the case', r.status === 200, r.json)
  const g = await A('GET', `/api/incidents/${INC.id}`)
  check('closing without a date closes it today', g.json.status === 'closed' && g.json.closed_date_ymd === TODAY, g.json)
  check('…and records who closed it', g.json.resolved_by_id === admin.id, g.json.resolved_by_id)
  check('the payer response note, findings and conclusion are stored',
    g.json.payer_response_notes?.startsWith('The caregiver never') && g.json.findings === 'No staff involvement found.' && g.json.disposition === 'unsubstantiated', g.json)
  check('actions taken lands on the template\'s action_taken column', g.json.action_taken === 'Called the family.', g.json.action_taken)
  check('names come back with the row', g.json.client_name === 'Ada Member' && g.json.caregiver_name === 'Casey One' && g.json.payer_name === 'Lakeside Health Plan', g.json)
  check('DATE fields come back as plain YYYY-MM-DD text', g.json.incident_date_ymd === `${YEAR}-03-02` && g.json.incident_time_hhmm === '10:15', g.json)
  const reopen = await A('PUT', `/api/incidents/${INC.id}`, base({ status: 'investigating', closedDate: TODAY }))
  const g2 = await A('GET', `/api/incidents/${INC.id}`)
  check('re-opening clears the closed date and closer', reopen.status === 200 && g2.json.closed_date_ymd === null && g2.json.resolved_by_id === null, g2.json)
  const p = await A('PATCH', `/api/incidents/${INC.id}`, { severity: 'critical' })
  const g3 = await A('GET', `/api/incidents/${INC.id}`)
  check('the legacy PATCH only fills what it is given', p.status === 200 && g3.json.severity === 'critical' && g3.json.findings === null, g3.json)
  await A('PUT', `/api/incidents/${INC.id}`, base({ status: 'investigating', responseDueDate: addDays(TODAY, 2) }))
}

// ── 5. the dashboard item: responses due within 3 days ────────────────────────────────
{
  const late = await A('POST', '/api/incidents', base({ responseDueDate: addDays(TODAY, 5), description: 'Due later.' }))
  const sent = await A('POST', '/api/incidents', base({ responseDueDate: addDays(TODAY, 1), description: 'Sent.' }))
  await A('PUT', `/api/incidents/${sent.json.id}`, base({ responseDueDate: addDays(TODAY, 1), responseSentDate: TODAY, description: 'Sent.' }))
  const overdue = await A('POST', '/api/incidents', base({ responseDueDate: addDays(TODAY, -2), description: 'Overdue.' }))
  const r = await A('GET', '/api/incidents/responses-due')
  const ids = (r.json.items || []).map((i: any) => i.id)
  check('due in 2 days and overdue are listed', ids.includes(INC.id) && ids.includes(overdue.json.id), r.json)
  check('due in 5 days and already sent are not', !ids.includes(late.json.id) && !ids.includes(sent.json.id), r.json)
  check('the count is the list', r.json.count === ids.length, r.json)
  for (const x of [late, sent, overdue]) await A('DELETE', `/api/incidents/${x.json.id}`)
}

// ── 6. investigation timeline ──────────────────────────────────────────────────────────
{
  const bad1 = await A('POST', `/api/incidents/${INC.id}/notes`, { entryType: 'call', summary: 'x' })
  const bad2 = await A('POST', `/api/incidents/${INC.id}/notes`, { entryDate: TODAY, entryType: 'gossip', summary: 'x' })
  const bad3 = await A('POST', `/api/incidents/${INC.id}/notes`, { entryDate: TODAY, entryType: 'call', summary: 'x'.repeat(5001) })
  check('a note needs a date, a known type and fewer than 5,000 characters',
    bad1.json?.error === 'Date is required' && bad2.json?.error === 'Entry type is not valid' && bad3.json?.error === 'Keep the entry under 5,000 characters', [bad1.json, bad2.json, bad3.json])
  const n2 = await A('POST', `/api/incidents/${INC.id}/notes`, { entryDate: TODAY, entryType: 'interview', summary: 'Spoke with the caregiver.' })
  const n1 = await A('POST', `/api/incidents/${INC.id}/notes`, { entryDate: addDays(TODAY, -3), entryType: 'call', summary: 'Payer called.' })
  check('notes are added', n1.status === 201 && n2.status === 201, [n1.json, n2.json])
  const list = await A('GET', `/api/incidents/${INC.id}/notes`)
  check('the timeline reads in date order with who logged it', list.json[0]?.summary === 'Payer called.' && list.json[1]?.created_by_name === 'Adam Admin', list.json)
  const wrong = await A('DELETE', `/api/incidents/${prevYear.json.id}/notes/${n1.json.id}`)
  check('a note cannot be deleted through another incident', wrong.status === 404, wrong.json)
}

// ── 7. attachments ─────────────────────────────────────────────────────────────────────
{
  const noKind = await A('POST', `/api/incidents/${INC.id}/attachments`, { category: 'x', fileName: 'a.png', dataUri: PNG })
  const notFile = await A('POST', `/api/incidents/${INC.id}/attachments`, { category: 'photo', fileName: 'a.png', dataUri: 'hello' })
  const exe = await A('POST', `/api/incidents/${INC.id}/attachments`, { category: 'other', fileName: 'a.exe', dataUri: 'data:application/x-msdownload;base64,TVqQ' })
  check('attachments: a known kind, a readable file, PDF or image only',
    noKind.json?.error === 'Pick what kind of document this is' && notFile.json?.error === 'The file could not be read' && exe.json?.error === 'Only PDF and image files can be attached',
    [noKind.json, notFile.json, exe.json])
  const ok = await A('POST', `/api/incidents/${INC.id}/attachments`, { category: 'payer_notice', fileName: 'notice<1>.png', dataUri: PNG, description: 'Letter' })
  const b64 = PNG.split(',')[1]
  check('a PNG attaches, its name made safe and its size computed from the base64', ok.status === 201 && ok.json.file_name === 'notice_1_.png' && ok.json.file_size === Math.floor(b64.length * 3 / 4), ok.json)
  const list = await A('GET', `/api/incidents/${INC.id}/attachments`)
  check('the list never carries the file bytes', list.json.length === 1 && !('file_data' in list.json[0]) && list.json[0].uploaded_by_name === 'Adam Admin', list.json)
  const dl = await raw(admin, `/api/incidents/${INC.id}/attachments/${ok.json.id}`)
  const bytes = Buffer.from(await dl.arrayBuffer())
  check('the download is the original file', dl.status === 200 && dl.headers.get('content-type') === 'image/png' && bytes.equals(Buffer.from(b64, 'base64')), dl.status)
  const listed = await A('GET', '/api/incidents')
  const row = listed.json.find((i: any) => i.id === INC.id)
  check('the incident list counts notes and attachments', row?.note_count === 2 && row?.attachment_count === 1, row)
}

// ── 8. caregiver field reports ─────────────────────────────────────────────────────────
// cg1 is scheduled at clientA; cg2 worked at clientC 10 days ago; nobody works for clientE.
await db.insert(schedules).values({ clientId: clientC.id, caregiverId: cg3.id, dayOfWeek: 5, scheduleType: 'recurring', startTime: new Date('2026-01-01T08:00:00Z'), endTime: new Date('2026-01-01T09:00:00Z'), effectiveDate: addDays(TODAY, -90) } as any)
await db.insert(timeEntries).values({ caregiverId: cg2.id, clientId: clientC.id, startTime: new Date(`${addDays(TODAY, -10)}T15:00:00Z`), endTime: new Date(`${addDays(TODAY, -10)}T17:00:00Z`), isComplete: true } as any)
await db.insert(timeEntries).values({ caregiverId: cg2.id, clientId: clientE.id, startTime: new Date(`${addDays(TODAY, -40)}T15:00:00Z`), endTime: new Date(`${addDays(TODAY, -40)}T17:00:00Z`), isComplete: true } as any)
const S1 = (await db.insert(schedules).values({
  clientId: clientA.id, caregiverId: cg1.id, dayOfWeek: 1, scheduleType: 'recurring', frequency: 'weekly',
  startTime: new Date('2026-01-05T09:00:00Z'), endTime: new Date('2026-01-05T13:00:00Z'), effectiveDate: addDays(TODAY, -60),
} as any).returning())[0]
{
  const mine = await CG2('GET', '/api/incidents/my-clients')
  const names = mine.json.map((c: any) => c.first_name)
  check('a caregiver\'s picker lists a client they worked for in the last 30 days', names.includes('Cy'), mine.json)
  check('…and not one they last worked for 40 days ago, nor anyone else\'s', !names.includes('Eve') && !names.includes('Ada'), names)
  const all = await A('GET', '/api/incidents/my-clients')
  check('the office picker lists every active client', all.json.length === 5, all.json.length)

  const notMine = await CG2('POST', '/api/incidents/caregiver-report', { clientId: clientA.id, incidentType: 'fall', incidentDate: TODAY, description: 'x' })
  check('a caregiver cannot report for someone else\'s client', notMine.status === 403 && notMine.json?.error === 'You can only report incidents for your own clients', notMine.json)
  const future = await CG1('POST', '/api/incidents/caregiver-report', { clientId: clientA.id, incidentType: 'fall', incidentDate: addDays(TODAY, 1), description: 'x' })
  check('a field report cannot be dated in the future', future.status === 400 && future.json?.error === "The date can't be in the future", future.json)
  const fourPhotos = await CG1('POST', '/api/incidents/caregiver-report', { clientId: clientA.id, incidentType: 'fall', incidentDate: TODAY, description: 'x', photos: [1, 2, 3, 4].map(() => ({ dataUri: PNG })) })
  const pdfPhoto = await CG1('POST', '/api/incidents/caregiver-report', { clientId: clientA.id, incidentType: 'fall', incidentDate: TODAY, description: 'x', photos: [{ dataUri: 'data:application/pdf;base64,JVBERi0=' }] })
  check('up to 3 photos, images only', fourPhotos.json?.error === 'Up to 3 photos' && pdfPhoto.json?.error === 'Photos must be images', [fourPhotos.json, pdfPhoto.json])
  const noType = await CG1('POST', '/api/incidents/caregiver-report', { clientId: clientA.id, incidentDate: TODAY, description: 'x' })
  check('a field report needs what happened', noType.json?.error === 'Please pick what happened', noType.json)

  const r = await CG1('POST', '/api/incidents/caregiver-report', {
    clientId: clientA.id, incidentType: 'fall', incidentDate: TODAY, incidentTime: '14:05', description: 'Client slipped in the kitchen.',
    caregiverId: cg2.id, photos: [{ dataUri: PNG, fileName: 'kitchen.png' }],
  })
  check('a caregiver files a report for their own client', r.status === 201 && /^IR-\d{4}-\d{3}$/.test(r.json.incidentNumber), r.json)
  const [row] = await q(sql`SELECT * FROM incidents WHERE id = ${r.json.id}`)
  check('…naming themselves as the caregiver, whatever the body says', row.caregiver_id === cg1.id, row.caregiver_id)
  check('…open, moderate, reported by them today', row.investigation_status === 'open' && row.severity === 'moderate' && row.reported_by === 'Casey One' && row.reported_by_id === cg1.id, row)
  const notes = await A('GET', `/api/incidents/${r.json.id}/notes`)
  check('…with the opening timeline entry', notes.json[0]?.summary === 'Reported by Casey One through the caregiver app.', notes.json)
  const att = await A('GET', `/api/incidents/${r.json.id}/attachments`)
  check('…and the photo filed as a photo', att.json.length === 1 && att.json[0].category === 'photo' && att.json[0].description === 'Photo from Casey One', att.json)
  const notes2 = await q(sql`SELECT user_id, type, title, message FROM notifications WHERE type = 'incident_alert' ORDER BY user_id`)
  const told = new Set(notes2.map((n) => n.user_id))
  check('the office (admin AND owner) is notified, the caregiver is not', told.has(admin.id) && told.has(owner.id) && !told.has(cg1.id), notes2)
  check('the alert names the client, type, time and number',
    notes2[0]?.title === '⚠️ Incident reported: Ada Member' && notes2[0]?.message.startsWith(`Casey One reported Fall for Ada Member on ${TODAY} at 14:05: Client slipped`) && notes2[0]?.message.includes(`(${r.json.incidentNumber})`), notes2[0])
  const listed = await A('GET', '/api/incidents')
  check('the office list shows it came from the caregiver app', listed.json.find((i: any) => i.id === r.json.id)?.reported_by_role === 'caregiver', null)
  await A('DELETE', `/api/incidents/${r.json.id}`)
}

// ── 9. remove the caregiver from this client, then return them ─────────────────────
// S1: cg1 every Monday at clientA (from above).
// S2: a one-time visit for cg1 at clientA on FROM+3.
// S3: an old cg1 pattern at clientA that ended before FROM — must not be touched.
// FROM+7: S1's Monday is covered by cg2 (an override) — must become cg2's own visit.
// S4: cg3's Tuesday pattern at clientA; on FROM+1 cg1 covers it — must be released.
const S2 = (await db.insert(schedules).values({
  clientId: clientA.id, caregiverId: cg1.id, scheduleType: 'one-time', date: addDays(FROM, 3),
  startTime: new Date(`${addDays(FROM, 3)}T14:00:00Z`), endTime: new Date(`${addDays(FROM, 3)}T16:00:00Z`),
} as any).returning())[0]
const S3 = (await db.insert(schedules).values({
  clientId: clientA.id, caregiverId: cg1.id, dayOfWeek: 3, scheduleType: 'recurring', startTime: new Date('2026-01-01T09:00:00Z'), endTime: new Date('2026-01-01T10:00:00Z'),
  effectiveDate: addDays(TODAY, -100), endDate: addDays(TODAY, -50),
} as any).returning())[0]
const S4 = (await db.insert(schedules).values({
  clientId: clientA.id, caregiverId: cg3.id, dayOfWeek: 2, scheduleType: 'recurring', startTime: new Date('2026-01-01T07:00:00Z'), endTime: new Date('2026-01-01T08:30:00Z'),
  effectiveDate: addDays(TODAY, -30),
} as any).returning())[0]
const [exCovered] = await db.insert(scheduleExceptions).values({ scheduleId: S1.id, exceptionDate: addDays(FROM, 7), exceptionType: 'modified', overrideCaregiverId: cg2.id } as any).returning()
const [exCovering] = await db.insert(scheduleExceptions).values({ scheduleId: S4.id, exceptionDate: addDays(FROM, 1), exceptionType: 'modified', overrideCaregiverId: cg1.id } as any).returning()
// cg1 also served clientB (same payer) and clientC (other payer) recently; clientD carries the payer only on an authorization.
await db.insert(schedules).values({ clientId: clientB.id, caregiverId: cg1.id, dayOfWeek: dow(addDays(TODAY, -14)), scheduleType: 'recurring', startTime: new Date('2026-01-01T12:00:00Z'), endTime: new Date('2026-01-01T13:00:00Z'), effectiveDate: addDays(TODAY, -20), endDate: addDays(TODAY, -1) } as any)
await db.insert(timeEntries).values({ caregiverId: cg1.id, clientId: clientC.id, startTime: new Date(`${addDays(TODAY, -5)}T15:00:00Z`), endTime: new Date(`${addDays(TODAY, -5)}T16:00:00Z`), isComplete: true } as any)
await db.insert(timeEntries).values({ caregiverId: cg1.id, clientId: clientD.id, startTime: new Date(`${addDays(TODAY, -9)}T15:00:00Z`), endTime: new Date(`${addDays(TODAY, -9)}T16:00:00Z`), isComplete: true } as any)
await db.insert(authorizations).values({ clientId: clientD.id, payerId: payer.id, authorizedUnits: '100', startDate: addDays(TODAY, -60), endDate: addDays(TODAY, 60) } as any)

// Visits of cg1 at clientA in [TODAY, TODAY+27], by the same rule the server uses.
const expectedUpcoming = (removed: boolean) => {
  let n = 0
  for (let k = 0; k <= 27; k++) {
    const d = addDays(TODAY, k)
    if (removed && d >= FROM) continue
    if (dow(d) === 1 && d !== addDays(FROM, 7)) n++          // S1 Mondays, minus the one cg2 covers
    if (d === addDays(FROM, 3)) n++                            // S2
    if (d === addDays(FROM, 1)) n++                            // cg1 covering S4
  }
  return n
}
{
  const s = await A('GET', `/api/incidents/${INC.id}/caregiver-schedule`)
  check('before removal: the caregiver\'s current schedule with this client (not the ended one)',
    s.json.schedules.map((x: any) => x.id).sort().join() === [S1.id, S2.id].sort().join(), s.json.schedules)
  check('…and the visits in the next 4 weeks counted through the schedule engine', s.json.upcomingVisits === expectedUpcoming(false), { got: s.json.upcomingVisits, want: expectedUpcoming(false) })
}
{
  const past = await A('POST', `/api/incidents/${INC.id}/remove-caregiver`, { fromDate: addDays(TODAY, -1) })
  check('removal cannot start in the past', past.status === 400 && past.json?.error === 'Removal can start today or later. Visits already worked stay as they are.', past.json)
  const badDate = await A('POST', `/api/incidents/${INC.id}/remove-caregiver`, { fromDate: 'next week' })
  check('removal needs a real start date', badDate.status === 400 && badDate.json?.error === 'Start date must be a valid date', badDate.json)
}
const TO = addDays(FROM, 13)
const rm = await A('POST', `/api/incidents/${INC.id}/remove-caregiver`, { fromDate: FROM, postOpenShifts: true, coverageWeeks: 2 })
check('removal succeeds', rm.status === 200, rm.json)
check('removal: 2 schedules paused, 3 visits posted, 1 cover kept, 1 cover released',
  rm.json.schedulesPaused === 2 && rm.json.openShiftsPosted === 3 && rm.json.coveredVisitsKept === 1 && rm.json.coversReleased === 1, rm.json)
check('removal summary says exactly what happened', rm.json.summary ===
  `Removed Casey One from Ada Member's schedule effective ${FROM}. 2 schedules paused. 3 upcoming visits through ${TO} posted as open shifts for coverage. 1 visit already covered by other caregivers kept as their own shifts. 1 visit this caregiver was covering for others released.`, rm.json.summary)
{
  const [s1] = await q(sql`SELECT to_char(end_date, 'YYYY-MM-DD') AS e, is_active FROM schedules WHERE id = ${S1.id}`)
  const [s2] = await q(sql`SELECT is_active FROM schedules WHERE id = ${S2.id}`)
  const [s3] = await q(sql`SELECT to_char(end_date, 'YYYY-MM-DD') AS e FROM schedules WHERE id = ${S3.id}`)
  check('the weekly pattern ends the day before removal', s1.e === addDays(FROM, -1) && s1.is_active === true, s1)
  check('the one-time visit after removal is taken off', s2.is_active === false, s2)
  check('a pattern that had already ended is untouched', s3.e === addDays(TODAY, -50), s3)
  const conv = await q(sql`SELECT caregiver_id, to_char(date, 'YYYY-MM-DD') AS d, to_char(start_time, 'HH24:MI') AS st, to_char(end_time, 'HH24:MI') AS et, schedule_type FROM schedules WHERE caregiver_id = ${cg2.id} AND client_id = ${clientA.id}`)
  check('the Monday cg2 was covering is now cg2\'s own one-time visit, same hours', conv.length === 1 && conv[0].d === addDays(FROM, 7) && conv[0].st === '09:00' && conv[0].et === '13:00' && conv[0].schedule_type === 'one-time', conv)
  const exs = await q(sql`SELECT id, exception_type FROM schedule_exceptions WHERE id IN (${exCovered.id}, ${exCovering.id})`)
  check('both overrides are cancelled', exs.every((e) => e.exception_type === 'cancelled') && exs.length === 2, exs)
  const os = await q(sql`SELECT to_char(date, 'YYYY-MM-DD') AS d, to_char(start_time, 'HH24:MI') AS st, status, notes, auto_created, created_by_id FROM open_shifts WHERE client_id = ${clientA.id} ORDER BY date`)
  check('the open shifts are FROM (Mon), FROM+1 (the released cover), FROM+3 (the one-time visit)',
    os.map((o) => `${o.d} ${o.st}`).join() === [`${FROM} 09:00`, `${addDays(FROM, 1)} 07:00`, `${addDays(FROM, 3)} 14:00`].join(), os)
  check('…open, neutral "Coverage needed", auto-created by the admin', os.every((o) => o.status === 'open' && o.notes === 'Coverage needed' && o.auto_created === true && o.created_by_id === admin.id), os)
  const s = await A('GET', `/api/incidents/${INC.id}/caregiver-schedule`)
  check('the schedule card still lists both rows, paused from the removal date',
    s.json.schedules.length === 2 && s.json.schedules.every((x: any) => x.paused_from === FROM), s.json.schedules)
  check('upcoming visits now stop at the removal date', s.json.upcomingVisits === expectedUpcoming(true), { got: s.json.upcomingVisits, want: expectedUpcoming(true) })
  const tl = await A('GET', `/api/incidents/${INC.id}/notes`)
  check('the removal is on the timeline as a schedule change', tl.json.some((n: any) => n.entry_type === 'schedule' && n.summary === rm.json.summary), tl.json)
  const again = await A('POST', `/api/incidents/${INC.id}/remove-caregiver`, { fromDate: FROM })
  check('removing twice is refused', again.status === 409 && again.json?.error === `This caregiver is already removed, effective ${FROM}.`, again.json)
  const swap = await A('PUT', `/api/incidents/${INC.id}`, base({ caregiverId: cg2.id, status: 'investigating' }))
  check('client/caregiver cannot change while removed', swap.status === 409, swap.json)
  const del = await A('DELETE', `/api/incidents/${INC.id}`)
  check('the incident cannot be deleted while the caregiver is removed', del.status === 409 && del.json?.error === 'Return the caregiver to the schedule before deleting this incident.', del.json)
  const audits = await q(sql`SELECT action, record_id, reason_code FROM audit_logs WHERE reason_code = 'incident_removal'`)
  check('the removal is audited: each schedule, the converted cover, and the incident',
    audits.filter((a) => a.action === 'SUSPEND').length === 2 && audits.some((a) => a.action === 'CREATE') && audits.some((a) => a.action === 'CAREGIVER_REMOVED' && a.record_id === INC.id), audits)
}
// The packet's facts while removed.
{
  const { loadIncidentCase, scheduleStatusSentence, reportingLine } = await import('./src/services/incidentPdf.ts')
  const data = (await loadIncidentCase(db as any, INC.id))!
  check('schedule statement: removed, from stored data, in the agency\'s name',
    scheduleStatusSentence(data) === `Effective ${longDate(FROM)}, Riverbend Home Care removed Casey One from Ada Member's schedule pending investigation.`, scheduleStatusSentence(data))
  const others = data.otherMembers.map((m: any) => `${m.firstName} ${m.lastName}`) /* unified: the packet's rows are camelCase (server/data/homecareIncidents.ts) */
  check('other members: same payer by referral source (Ben) and by authorization (Dee)', others.includes('Ben Member') && others.includes('Dee Authonly'), others)
  check('…not a member of another payer (Cy), nor the member themselves', !others.includes('Cy Other') && !others.includes('Ada Member'), others)
  const dee = data.otherMembers.find((m: any) => m.firstName === 'Dee') /* unified: camelCase rows */
  const [y, m, d] = addDays(TODAY, -9).split('-')
  check('…with the dates they were served (a clock-in counts)', dee?.firstS === `${m}/${d}/${y}` && dee?.lastS === `${m}/${d}/${y}` /* unified: camelCase rows */, dee)
  check('the reporting line names the Wisconsin statute only for a WI agency', reportingLine('WI').includes('Wis. Stat. § 46.90') && !reportingLine('MN').includes('Wis.'), null)
  check('the letterhead is the agency record', data.agency.name === 'Riverbend Home Care' && data.agency.phone === '555-0100', data.agency)
}
// A replacement takes the Monday; then the caregiver returns.
await q(sql`UPDATE open_shifts SET status = 'filled' WHERE client_id = ${clientA.id} AND date = ${FROM}::date`)
const back = await A('POST', `/api/incidents/${INC.id}/return-caregiver`, {})
check('return succeeds', back.status === 200, back.json)
check('return: 2 restored, 0 skipped, 2 unclaimed cancelled, 1 replacement kept',
  back.json.restored === 2 && back.json.skipped === 0 && back.json.cancelledOpenShifts === 2 && back.json.keptReplacements === 1, back.json)
check('return summary says exactly what happened', back.json.summary ===
  `Returned Casey One to Ada Member's schedule on ${TODAY}. 2 schedules restored. 2 unclaimed coverage shifts cancelled. 1 visit already covered by a replacement stay with the replacement.`, back.json.summary)
{
  const [s1] = await q(sql`SELECT end_date FROM schedules WHERE id = ${S1.id}`)
  const [s2] = await q(sql`SELECT is_active FROM schedules WHERE id = ${S2.id}`)
  check('the weekly pattern is open-ended again, exactly as before', s1.end_date === null, s1)
  check('the one-time visit is back', s2.is_active === true, s2)
  const own = await q(sql`SELECT exception_type FROM schedule_exceptions WHERE schedule_id = ${S1.id} AND exception_date = ${FROM}::date`)
  check('the Monday a replacement took is cancelled on the returned caregiver\'s pattern (no double staffing)', own.length === 1 && own[0].exception_type === 'cancelled', own)
  const [cov] = await q(sql`SELECT exception_type FROM schedule_exceptions WHERE id = ${exCovering.id}`)
  check('the cover that nobody took is given back to the caregiver', cov.exception_type === 'modified', cov)
  const os = await q(sql`SELECT status FROM open_shifts WHERE client_id = ${clientA.id} ORDER BY date`)
  check('unclaimed coverage is cancelled, the filled one kept', os.map((o) => o.status).join() === 'filled,cancelled,cancelled', os)
  const g = await A('GET', `/api/incidents/${INC.id}`)
  check('the incident records the return date', g.json.caregiver_returned_on_ymd === TODAY && g.json.caregiver_removed_from_ymd === FROM, g.json)
  const s = await A('GET', `/api/incidents/${INC.id}/caregiver-schedule`)
  check('the removal record keeps what the return did', s.json.removal?.returned?.restored?.length === 2, s.json.removal)
  const twice = await A('POST', `/api/incidents/${INC.id}/return-caregiver`, {})
  check('returning twice is refused', twice.status === 409 && twice.json?.error === 'The caregiver is not currently removed from this schedule.', twice.json)
}
// No coverage posted; and a row changed after removal is left as it is on return.
{
  const S5 = (await db.insert(schedules).values({ clientId: clientC.id, caregiverId: cg2.id, dayOfWeek: 4, scheduleType: 'recurring', startTime: new Date('2026-01-01T10:00:00Z'), endTime: new Date('2026-01-01T11:00:00Z'), effectiveDate: addDays(TODAY, -10), endDate: addDays(TODAY, 200) } as any).returning())[0]
  const [exC] = await db.insert(scheduleExceptions).values({ scheduleId: S4.id, exceptionDate: addDays(FROM, 8), exceptionType: 'modified', overrideCaregiverId: cg2.id, overrideClientId: clientC.id } as any).returning()
  const inc2 = await A('POST', '/api/incidents', base({ clientId: clientC.id, caregiverId: cg2.id, description: 'Second case.' }))
  const r = await A('POST', `/api/incidents/${inc2.json.id}/remove-caregiver`, { fromDate: FROM, postOpenShifts: false })
  check('removal without posting coverage', r.status === 200 && r.json.openShiftsPosted === 0 && r.json.summary.includes('No open shifts posted.') && r.json.coversReleased === 1, r.json)
  const [e1] = await q(sql`SELECT exception_type FROM schedule_exceptions WHERE id = ${exC.id}`)
  check('…the cover is still released', e1.exception_type === 'cancelled', e1)
  await q(sql`UPDATE schedules SET end_date = ${addDays(FROM, 30)}::date WHERE id = ${S5.id}`)
  const b2 = await A('POST', `/api/incidents/${inc2.json.id}/return-caregiver`, {})
  check('a pattern edited after the removal is left as the office set it', b2.json.skipped === 1 && b2.json.restored === 0 && b2.json.summary.includes(', 1 left as-is because they were changed after the removal.'), b2.json)
  const [s5] = await q(sql`SELECT to_char(end_date, 'YYYY-MM-DD') AS e FROM schedules WHERE id = ${S5.id}`)
  check('…its end date is the office\'s, not the prior one', s5.e === addDays(FROM, 30), s5)
  const [e2] = await q(sql`SELECT exception_type FROM schedule_exceptions WHERE id = ${exC.id}`)
  check('…and the released cover that was never posted is given back', e2.exception_type === 'modified', e2)
  const noCg = await A('POST', '/api/incidents', base({ caregiverId: '', description: 'No caregiver.' }))
  const r3 = await A('POST', `/api/incidents/${noCg.json.id}/remove-caregiver`, {})
  check('an incident with no caregiver has nobody to remove', r3.status === 400 && r3.json?.error === 'This incident has no caregiver to remove.', r3.json)
}

// ── 10. the signed training acknowledgement ────────────────────────────────────────────
{
  const noSig = await A('POST', `/api/incidents/${INC.id}/training-acknowledgement`, { signerName: 'Casey One', supervisorName: 'Sam Sup', method: 'in_person' })
  const noSup = await A('POST', `/api/incidents/${INC.id}/training-acknowledgement`, { signature: PNG, signerName: 'Casey One', method: 'in_person' })
  const noMethod = await A('POST', `/api/incidents/${INC.id}/training-acknowledgement`, { signature: PNG, signerName: 'Casey One', supervisorName: 'Sam Sup', method: 'email' })
  check('signing needs a drawn signature, a reviewer and a method',
    noSig.json?.error === 'A drawn signature is required' && noSup.json?.error === 'Enter who reviewed it with the caregiver' && noMethod.json?.error === 'Pick how it was reviewed', [noSig.json, noSup.json, noMethod.json])
  const sign = await as(admin, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })('POST', `/api/incidents/${INC.id}/training-acknowledgement`,
    { signature: PNG, signerName: ' Casey One ', supervisorName: 'Sam Sup, RN', method: 'phone' })
  check('the caregiver signs', sign.status === 201 && sign.json.trainingRecords === 2, sign.json)
  const tr = await q(sql`SELECT training_name, provider, status, to_char(completed_date, 'YYYY-MM-DD') AS d FROM training_records WHERE caregiver_id = ${cg1.id} ORDER BY training_name`)
  check('two completed training records on the caregiver\'s file, today, provider names the reviewer',
    tr.length === 2 && tr[0].training_name === 'Client Funds, Property & Misappropriation Policy' && tr[1].training_name === 'Medication Reminders & Handling (PCW)'
    && tr.every((t) => t.status === 'completed' && t.d === TODAY && t.provider === 'Riverbend Home Care: reviewed with Sam Sup, RN'), tr)
  const twice = await A('POST', `/api/incidents/${INC.id}/training-acknowledgement`, { signature: PNG, signerName: 'Casey One', supervisorName: 'Sam', method: 'phone' })
  check('it is signed once per incident', twice.status === 409, twice.json)
  const [a] = await q(sql`SELECT new_data, ip_address FROM audit_logs WHERE action = 'TRAINING_ACK_SIGNED'`)
  const nd = typeof a.new_data === 'string' ? JSON.parse(a.new_data) : a.new_data
  check('the signing is audited with the signer\'s IP and no signature image', nd.signed_from_ip === '203.0.113.9' && a.ip_address === '203.0.113.9' && !JSON.stringify(nd).includes('base64'), nd)
  const list = await A('GET', '/api/incidents')
  const row = list.json.find((i: any) => i.id === INC.id)
  check('the list carries "signed" but never the signature image', row.has_training_ack_signature === true && !('training_ack_signature' in row), Object.keys(row).filter((k) => k.startsWith('training')))
  const g = await A('GET', `/api/incidents/${INC.id}`)
  check('the case view carries the signature to show it', String(g.json.training_ack_signature).startsWith('data:image/png') && g.json.training_ack_signer_name === 'Casey One', null)
  const noCgInc = (await q(sql`SELECT id FROM incidents WHERE caregiver_id IS NULL LIMIT 1`))[0]
  const r = await A('POST', `/api/incidents/${noCgInc.id}/training-acknowledgement`, { signature: PNG, signerName: 'X', supervisorName: 'Y', method: 'video' })
  check('no caregiver, nothing to sign', r.status === 400 && r.json?.error === 'This incident has no caregiver', r.json)
}

// ── 11. the PDFs ───────────────────────────────────────────────────────────────────────
{
  const put = await A('PUT', `/api/incidents/${INC.id}`, base({ status: 'investigating', payerResponseNotes: 'The caregiver never contacted management about controlled medications.' }))
  check('(the payer note is set for the packet)', put.status === 200, put.json)
  await db.insert(backgroundChecks).values({ caregiverId: cg1.id, checkType: 'worcs', provider: 'WI DOJ', status: 'completed', initiatedDate: addDays(TODAY, -400) } as any)
  for (const [path, name] of [[`/api/incidents/${INC.id}/pdf`, 'incident-report'], [`/api/incidents/${INC.id}/response-packet?includeSchedule=1`, 'incident-response-packet'], [`/api/incidents/${INC.id}/response-packet`, 'incident-response-packet']]) {
    const res = await raw(admin, path)
    const buf = Buffer.from(await res.arrayBuffer())
    check(`${path.split('/').pop()} is a PDF download`, res.status === 200 && res.headers.get('content-type') === 'application/pdf' && buf.subarray(0, 4).toString() === '%PDF'
      && res.headers.get('content-disposition') === `attachment; filename="${name}-IR-${YEAR}-001.pdf"`, { status: res.status, cd: res.headers.get('content-disposition') })
  }
  // Read the packet's words back out of the PDF: inflate every content stream, decode pdfkit's hex
  // text runs, and join each page's runs.
  const pdfText = (buf: Buffer) => {
    const zlib = require('node:zlib')
    const out: string[] = []
    const s = buf.toString('latin1')
    const re = /stream\r?\n/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      const start = m.index + m[0].length
      const end = s.indexOf('endstream', start)
      try {
        const content = zlib.inflateSync(Buffer.from(s.slice(start, end), 'latin1')).toString('latin1')
        out.push(content.replace(/\[([^\]]*)\]\s*TJ/g, (_: string, arr: string) => arr.replace(/<([0-9a-fA-F]*)>|[-\d.]+/g, (h: string, hex: string) => hex
          ? Buffer.from(hex, 'hex').toString('latin1') : (Number(h) < -200 ? ' ' : ''))).replace(/\s+/g, ' '))
      } catch { /* not a deflated stream */ }
    }
    return out.join(' ')
  }
  {
    const res = await raw(admin, `/api/incidents/${INC.id}/response-packet`)
    const words = pdfText(Buffer.from(await res.arrayBuffer())).replace(/\s+/g, ' ')
    const has = (t: string) => words.replace(/\s/g, '').includes(t.replace(/\s/g, ''))
    check('packet letter thanks the payer in the agency\'s own name', has('Thank you for notifying Riverbend Home Care of this concern'), words.slice(0, 600))
    check('packet prints the payer\'s extra question as its own numbered item', has('4. Additional information.') && has('The caregiver never contacted management about controlled medications.'), null)
    check('packet lists the other members of the same payer by name', has('5. Other members served by this caregiver.') && has('Ben Member') && has('Dee Authonly') && !has('Cy Other'), null)
    check('packet states the return truthfully', has('removed Casey One from Ada Member') && has('was returned to the member'), null)
    check('packet: a WI agency cites the statute', has('Wis. Stat.'), null)
    check('packet names no other agency', !/Chippewa|CVHC/i.test(words), null)
    check('without the exhibit flag, no visit schedule is enclosed', !has('Exhibit A'), null)
    const withEx = await raw(admin, `/api/incidents/${INC.id}/response-packet?includeSchedule=1`)
    check('with it, Exhibit A is there', pdfText(Buffer.from(await withEx.arrayBuffer())).replace(/\s/g, '').includes('ExhibitA'), null)
  }
  const missing = await raw(admin, '/api/incidents/nope/pdf')
  check('no incident, no PDF', missing.status === 404, missing.status)
  const audits = await q(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'REPORT_GENERATED_PDF'`)
  check('every PDF is audited', audits[0].n === 5, audits)
  const s = await A('GET', '/api/incidents/summary')
  check('the summary counts incidents by severity and type', s.status === 200 && s.json.total >= 1 && Array.isArray(s.json.bySeverity) && Array.isArray(s.json.monthlyTrend), s.json)
}

// ── 12. no agency identity or state hard-coded in the ported code ────────────────────
{
  const root = process.env.FACTORY_ROOT + 'templates/crm-homecare/'
  const files = [
    'backend/src/routes/incidents.ts', 'backend/src/services/incidentPdf.ts', 'backend/src/services/scheduleOccurrences.ts', 'backend/src/config/incidentOptions.ts',
    ...readdirSync(root + 'frontend/src/components/admin').filter((f) => /^Incident/.test(f)).map((f) => `frontend/src/components/admin/${f}`),
    'frontend/src/components/caregiver/IncidentReportForm.tsx', 'frontend/src/utils/incidentOptions.ts',
  ]
  for (const f of files) {
    // Comments may say where a rule came from; code and screen text may not name the source agency.
    // CRLF first: on a Windows checkout `.*$` stops at the \r and a line comment survives the strip.
    const code = readFileSync(root + f, 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
    const hit = /Chippewa|CVHC|Eau Claire|715-\d|54701|chippewavalley/i.exec(code)
    check(`${f} names no source agency`, !hit, hit?.[0])
  }
}

console.log(`\nhomecare-incidents: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
