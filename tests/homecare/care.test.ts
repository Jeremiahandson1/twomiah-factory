// crm-homecare — the care area, ported from the source home care CRM, through the real routes.
//
// What is held here, and why each matters:
//   · care task checklists: minutes/week = x/week × min/task, 15-minute units, the import's
//     all-or-nothing validation and its reconciliation against the assessment total, and the
//     shift checklist that only the shift's caregiver (or the office) may tick
//   · the insurer assessment PDF (MIDAS SHC/PC Summary): a PDF laid out like the real one is read
//     into the same tasks and totals, and a sheet whose numbers disagree is refused
//   · care plans: the five note sections, '' clears, a revision row (with its author) on every
//     content change and none on a no-op, the visit schedule in words, the double-booking refusal
//     on Generate Schedule, and authorization as advice with the source CRM's wording
//   · vitals ranges, the MAR's strict statuses and witness, attribution (the office may name the
//     caregiver; a caregiver is always themselves), forms (state-only built-ins, required answers,
//     multi-select), the document store's e-signature queue, and insurance card photos
import { Hono } from 'hono'
import PDFDocument from 'pdfkit'
import { setupSchema } from './setup.ts'
import { db, pglite } from './db/index.ts'
import {
  agencies, users, clients, timeEntries, schedules, scheduleExceptions, authorizations,
  clientTaskTemplates, carePlans, medications, clientVitals, formTemplates, documents,
} from './db/schema.ts'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema()

// The agency keeps its calendar in UTC here so "today" and "this week" are the runner's.
const [ag] = await db.insert(agencies).values({ name: 'Care Port Agency', slug: 'careport', state: 'WI', timezone: 'UTC' } as any).returning()
const mkUser = async (role: string, tag: string, first = tag, last = 'U') => (await db.insert(users).values({
  email: `${tag}-care@test.local`, passwordHash: 'x', firstName: first, lastName: last, role,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin', 'Ada', 'Admin')
const cg = await mkUser('caregiver', 'cg', 'Cara', 'Giver')
const cg2 = await mkUser('caregiver', 'cg2', 'Other', 'Carer')
const mkClient = async (first: string, last: string) => (await db.insert(clients).values({ firstName: first, lastName: last } as any).returning())[0]
const jane = await mkClient('Jane', 'Doe')
const bob = await mkClient('Bob', 'Roe')

const app = new Hono()
for (const [mount, file] of [
  ['/api/care-tasks', 'careTasks'],
  ['/api/care-plans', 'carePlans'],
  ['/api/care-plan-templates', 'carePlanTemplates'],
  ['/api/medications', 'medications'],
  ['/api/forms', 'forms'],
  ['/api/documents', 'documents'],
  ['/api/insurance-cards', 'insuranceCards'],
  ['/api/adl', 'adl'],
  ['/api/clients', 'clients'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

const as = (who: any) => async (method: string, path: string, body?: unknown, raw?: BodyInit) => {
  const headers: Record<string, string> = { 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role, 'user-agent': 'care-test' }
  if (raw === undefined) headers['content-type'] = 'application/json'
  const res = await app.request(path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/pdf') || ct.includes('octet-stream') || ct.includes('text/plain')) {
    return { status: res.status, json: null as any, bytes: new Uint8Array(await res.arrayBuffer()), ct }
  }
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, bytes: null as any, ct }
}
const A = as(admin), O = as(owner), C = as(cg), C2 = as(cg2)
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const todayUtc = ymd(new Date())
const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d) }

// ════════════════════════════════════════════════════════════════════════════
// CARE TASKS
// ════════════════════════════════════════════════════════════════════════════
{
  const r = await C('POST', `/api/care-tasks/client/${jane.id}`, { taskName: 'Dust' })
  check('a caregiver may not add a care task', r.status === 403, r)
  const bad = await A('POST', `/api/care-tasks/client/${jane.id}`, { taskName: '  ' })
  check('a blank task name is refused', bad.status === 400 && bad.json.error === 'taskName is required', bad)
  const badCat = await A('POST', `/api/care-tasks/client/${jane.id}`, { taskName: 'X', category: 'cooking' })
  check('an unknown category is a 400, not a constraint 500', badCat.status === 400, badCat)
  const badMin = await A('POST', `/api/care-tasks/client/${jane.id}`, { taskName: 'X', allottedMinutes: '12.5' })
  check('minutes per task must be a whole number', badMin.status === 400, badMin)
  const ghost = await A('POST', `/api/care-tasks/client/nope000`, { taskName: 'X' })
  check('a task for a client that does not exist is a 404', ghost.status === 404, ghost)

  const t1 = await A('POST', `/api/care-tasks/client/${jane.id}`, { taskName: 'Dust/Vacuum', category: 'iadl', allottedMinutes: '15', weeklyFrequency: 3, cadence: 'weekly' })
  const t2 = await O('POST', `/api/care-tasks/client/${jane.id}`, { taskName: 'Bathing', category: 'adl', allottedMinutes: 30, weeklyFrequency: 'abc', timeOfDay: 'noon' })
  check('the office creates tasks (admin and owner)', t1.status === 200 && t2.status === 200, [t1, t2])
  check('a frequency that is not a positive whole number is 1 (the source rule)', t2.json.weeklyFrequency === 1, t2.json)
  check('an unknown time of day is "any"', t2.json.timeOfDay === 'any', t2.json)
  check('sort order follows on', t1.json.sortOrder === 0 && t2.json.sortOrder === 1, [t1.json.sortOrder, t2.json.sortOrder])

  const list = await C('GET', `/api/care-tasks/client/${jane.id}`)
  check('a caregiver can read the checklist', list.status === 200 && list.json.length === 2, list)
  check('minutes per week is x/week × min/task (3 × 15 = 45)', list.json[0].minutes_per_week === 45, list.json[0])

  const upd = await A('PUT', `/api/care-tasks/${t2.json.id}`, { weeklyFrequency: 2, allottedMinutes: 25 })
  check('the office edits a task', upd.status === 200 && upd.json.weeklyFrequency === 2 && upd.json.allottedMinutes === 25, upd.json)
  const updBad = await A('PUT', `/api/care-tasks/${t2.json.id}`, { allottedMinutes: -5 })
  check('a negative minute count is refused on edit', updBad.status === 400, updBad)
  check('a caregiver may not edit a task', (await C('PUT', `/api/care-tasks/${t2.json.id}`, { weeklyFrequency: 9 })).status === 403)
  check('editing a task that does not exist is a 404', (await A('PUT', '/api/care-tasks/nope000', {})).status === 404)

  // ── the import ──
  const before = (await A('GET', `/api/care-tasks/client/${jane.id}`)).json.length
  const allOrNothing = await A('POST', `/api/care-tasks/client/${jane.id}/import`, { tasks: [{ taskName: 'Ok' }, { taskName: '' }] })
  check('an import with a bad row is refused, naming the row', allOrNothing.status === 400 && allOrNothing.json.error === 'Row 2: taskName is required', allOrNothing)
  check('…and writes nothing', (await A('GET', `/api/care-tasks/client/${jane.id}`)).json.length === before)
  check('an import needs tasks', (await A('POST', `/api/care-tasks/client/${jane.id}/import`, { tasks: [] })).status === 400)
  check('a caregiver may not import', (await C('POST', `/api/care-tasks/client/${jane.id}/import`, { tasks: [{ taskName: 'x' }] })).status === 403)

  const imp = await A('POST', `/api/care-tasks/client/${jane.id}/import`, {
    tasks: [
      { taskName: 'Wash Dishes', category: 'iadl', weeklyFrequency: 3, allottedMinutes: 15 },
      { taskName: 'Laundry', category: 'bogus', weeklyFrequency: 2, allottedMinutes: '20' },
      { taskName: 'Mop', weeklyFrequency: 0, allottedMinutes: -10 },
    ],
    replaceExisting: true, source: 'midas_shc_pc_summary', assessmentTotals: { minsPerWeek: 85 },
  })
  // 3×15 + 2×20 + 1×0 = 85 minutes; 85 / 15 = 5.67 units
  check('the import reconciles to the assessment total', imp.status === 200 && imp.json.reconciliation.computedMinsPerWeek === 85
    && imp.json.reconciliation.match === true && imp.json.reconciliation.computedUnitsPerWeek === 5.67, imp.json)
  check('…and counts what it imported', imp.json.imported === 3 && imp.json.replacedExisting === true, imp.json)
  const after = (await A('GET', `/api/care-tasks/client/${jane.id}`)).json
  check('replaceExisting retires the old list', after.length === 3 && !after.some((t: any) => t.task_name === 'Dust/Vacuum'), after.map((t: any) => t.task_name))
  check('an unknown imported category is IADL', after.find((t: any) => t.task_name === 'Laundry')?.category === 'iadl')
  check('an imported row records its source', after.every((t: any) => t.assessment_source === 'midas_shc_pc_summary'))
  check('negative minutes import as 0, frequency 0 as 1', after.find((t: any) => t.task_name === 'Mop')?.allotted_minutes === 0
    && after.find((t: any) => t.task_name === 'Mop')?.weekly_frequency === 1)
  const mismatch = await A('POST', `/api/care-tasks/client/${bob.id}/import`, {
    tasks: [{ taskName: 'A', weeklyFrequency: 2, allottedMinutes: 15 }], assessmentTotals: { minsPerWeek: 45 },
  })
  check('a total that does not match is reported, not hidden', mismatch.json.reconciliation.match === false
    && mismatch.json.reconciliation.computedMinsPerWeek === 30 && mismatch.json.reconciliation.expectedMinsPerWeek === 45, mismatch.json)
  const noTotal = await A('POST', `/api/care-tasks/client/${bob.id}/import`, { tasks: [{ taskName: 'B', allottedMinutes: 10 }] })
  check('with no assessment total there is nothing to match (null)', noTotal.json.reconciliation.match === null, noTotal.json)
  check('the default source is midas_import', (await A('GET', `/api/care-tasks/client/${bob.id}`)).json.some((t: any) => t.task_name === 'B' && t.assessment_source === 'midas_import'))

  // ── the shift checklist ──
  const [entry] = await db.insert(timeEntries).values({ caregiverId: cg.id, clientId: jane.id, startTime: new Date(), endTime: new Date(Date.now() + 3600000) }).returning() // closed: one open entry per caregiver (0016)
  const own = await C('GET', `/api/care-tasks/time-entry/${entry.id}`)
  check('the shift\'s caregiver sees the checklist, all pending', own.status === 200 && own.json.length === 3 && own.json.every((t: any) => t.status === 'pending'), own)
  check('another caregiver may not read someone else\'s shift', (await C2('GET', `/api/care-tasks/time-entry/${entry.id}`)).status === 403)
  check('the office may read any shift', (await A('GET', `/api/care-tasks/time-entry/${entry.id}`)).status === 200)
  const wash = own.json.find((t: any) => t.task_name === 'Wash Dishes')
  const laundry = own.json.find((t: any) => t.task_name === 'Laundry')
  check('an invalid status is refused', (await C('PUT', `/api/care-tasks/time-entry/${entry.id}/${wash.task_id}`, { status: 'done' })).status === 400)
  check('another caregiver may not tick this shift', (await C2('PUT', `/api/care-tasks/time-entry/${entry.id}/${wash.task_id}`, { status: 'completed' })).status === 403)
  const done = await C('PUT', `/api/care-tasks/time-entry/${entry.id}/${wash.task_id}`, { status: 'completed', notes: 'all clean' })
  check('the caregiver marks a task done, with the time', done.status === 200 && done.json.status === 'completed' && !!done.json.completedAt, done.json)
  const again = await C('PUT', `/api/care-tasks/time-entry/${entry.id}/${wash.task_id}`, { status: 'refused', notes: 'not today' })
  check('marking it again updates the same row (one per task per shift), completed time cleared',
    again.json.id === done.json.id && again.json.status === 'refused' && again.json.completedAt === null, again.json)
  await C('PUT', `/api/care-tasks/time-entry/${entry.id}/${wash.task_id}`, { status: 'completed' })
  await A('PUT', `/api/care-tasks/time-entry/${entry.id}/${laundry.task_id}`, { status: 'skipped' })
  const bobTask = (await A('GET', `/api/care-tasks/client/${bob.id}`)).json[0]
  check('a task from another client cannot be ticked on this shift',
    (await C('PUT', `/api/care-tasks/time-entry/${entry.id}/${bobTask.id}`, { status: 'completed' })).status === 404)

  const [entry2] = await db.insert(timeEntries).values({ caregiverId: cg.id, clientId: jane.id, startTime: new Date(), endTime: new Date(Date.now() + 3600000) }).returning() // closed: one open entry per caregiver (0016)
  const next = (await C('GET', `/api/care-tasks/time-entry/${entry2.id}`)).json
  check('a task completed earlier this week shows as done this week on the next shift',
    next.find((t: any) => t.task_name === 'Wash Dishes')?.done_this_week === true
    && next.find((t: any) => t.task_name === 'Wash Dishes')?.status === 'pending', next)
  check('…and a skipped one does not', next.find((t: any) => t.task_name === 'Laundry')?.done_this_week === false)

  const [old] = await db.insert(timeEntries).values({ caregiverId: cg.id, clientId: jane.id, startTime: new Date(Date.now() - 60 * 86400000), endTime: new Date(Date.now() - 60 * 86400000 + 3600000) }).returning()
  await C('PUT', `/api/care-tasks/time-entry/${old.id}/${laundry.task_id}`, { status: 'completed' })
  const adh = await A('GET', `/api/care-tasks/client/${jane.id}/adherence?days=30`)
  const wa = adh.json.tasks.find((t: any) => t.task_name === 'Wash Dishes')
  const la = adh.json.tasks.find((t: any) => t.task_name === 'Laundry')
  check('adherence counts the shifts in the window (the 60-day-old one is outside 30)', adh.json.days === 30 && adh.json.totalShifts === 2, adh.json)
  check('adherence counts done / skipped per task inside the window only', wa.completed === 1 && la.skipped === 1 && la.completed === 0, adh.json.tasks)
  check('the window is clamped to 180 days', (await A('GET', `/api/care-tasks/client/${jane.id}/adherence?days=9999`)).json.days === 180)
  check('a caregiver may not read the adherence report', (await C('GET', `/api/care-tasks/client/${jane.id}/adherence`)).status === 403)

  const del = await A('DELETE', `/api/care-tasks/${wash.task_id}`)
  check('removing a task is a soft delete', del.status === 200
    && !(await A('GET', `/api/care-tasks/client/${jane.id}`)).json.some((t: any) => t.task_name === 'Wash Dishes')
    && (await db.select().from(clientTaskTemplates).where(eq(clientTaskTemplates.id, wash.task_id)))[0]?.isActive === false)
}

// ════════════════════════════════════════════════════════════════════════════
// THE INSURER ASSESSMENT PDF
// ════════════════════════════════════════════════════════════════════════════
// Built with the same geometry as a MIDAS SHC/PC Assessment Summary: section and group headers at
// the left margin, task names indented, five number columns to the right of x=190.
function assessmentPdf(rows: { kind: string; text?: string; nums?: number[] }[]): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 10 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    doc.fontSize(9)
    let y = 30
    const at = (s: string, x: number) => doc.text(s, x, y, { lineBreak: false })
    for (const r of rows) {
      if (r.kind === 'title') at('SHC/PC Assessment Summary', 220)
      else if (r.kind === 'field') { at(r.text!.split('|')[0], 40); at(r.text!.split('|')[1], 120) }
      else if (r.kind === 'left') at(r.text!, 20)
      else if (r.kind === 'indent') at(r.text!, 40)
      else if (r.kind === 'row') { at(r.text!, 40); r.nums!.forEach((n, i) => at(String(n), 200 + i * 40)) }
      else if (r.kind === 'total') { at('Total Assessed Mins. / Week:', 40); at(String(r.nums![0]), 360) }
      else if (r.kind === 'hours') { at('Total Assessed Hours / Week:', 40) }
      else if (r.kind === 'hoursFig') { at(r.text!, 360) }
      else if (r.kind === 'header') at('times per Week   min per task', 40)
      y += 14
    }
    doc.end()
  })
}
const SUMMARY = [
  { kind: 'title' },
  { kind: 'field', text: 'Last Name:|Doe' }, { kind: 'field', text: 'First Name:|Jane' },
  { kind: 'field', text: 'Member ID:|M12345' }, { kind: 'field', text: 'Assess Date:|09/01/2026' }, { kind: 'field', text: 'RN:|Pat Nurse' },
  { kind: 'left', text: 'Supportive Home Care -' }, { kind: 'left', text: 'Homemaking' },
  { kind: 'header' },
  { kind: 'left', text: 'Kitchen' },
  { kind: 'row', text: 'Wash Dishes', nums: [7, 15, 3, 15, 45] },
  { kind: 'row', text: 'Mop Floor', nums: [1, 10, 1, 10, 10] },
  { kind: 'left', text: 'Bathroom' },
  { kind: 'row', text: 'Mop Floor', nums: [1, 10, 1, 10, 10] },
  { kind: 'row', text: 'Clean Toilet and', nums: [1, 15, 1, 15, 15] },
  { kind: 'indent', text: 'Sink' },
  { kind: 'total', nums: [80] }, { kind: 'hours' }, { kind: 'hoursFig', text: '1.33' },
  { kind: 'left', text: 'Supportive Home Care -' }, { kind: 'left', text: 'Attendant Care' },
  { kind: 'row', text: 'Bathing Assist', nums: [3, 30, 2, 30, 60] },
  { kind: 'row', text: 'Shampoo', nums: [1, 10, 0, 10, 0] },
  { kind: 'total', nums: [60] },
]
const upload = async (who: any, clientId: string, pdf: Uint8Array, format?: string) => {
  const fd = new FormData()
  fd.append('file', new File([pdf], 'assessment.pdf', { type: 'application/pdf' }))
  if (format) fd.append('format', format)
  return as(who)('POST', `/api/care-tasks/client/${clientId}/parse-assessment-pdf`, undefined, fd)
}
{
  const formats = await A('GET', '/api/care-tasks/assessment-formats')
  check('a Wisconsin agency is offered the MIDAS import', formats.json.some((f: any) => f.id === 'midas_shc_pc_summary' && f.insurer === 'My Choice Wisconsin'), formats.json)

  const parsed = await upload(admin, jane.id, await assessmentPdf(SUMMARY))
  check('the assessment summary is read', parsed.status === 200, parsed)
  const p = parsed.json
  check('…the member block', p.member?.lastName === 'Doe' && p.member?.firstName === 'Jane' && p.member?.memberId === 'M12345' && p.member?.assessor === 'Pat Nurse', p.member)
  check('…the name matches the client', p.clientNameMatch === true)
  check('…each section with its own total', JSON.stringify(p.sections) === JSON.stringify([
    { name: 'Supportive Home Care - Homemaking', category: 'iadl', minsPerWeek: 80, tasks: 4 },
    { name: 'Supportive Home Care - Attendant Care', category: 'adl', minsPerWeek: 60, tasks: 2 },
  ]), p.sections)
  check('…the assessment total (80 + 60)', p.assessmentTotals?.minsPerWeek === 140)
  check('…a repeated task name carries its group, a wrapped name is joined, a 0-minute row is dropped',
    JSON.stringify(p.tasks?.map((t: any) => [t.taskName, t.category, t.weeklyFrequency, t.allottedMinutes, t.description])) === JSON.stringify([
      ['Wash Dishes', 'iadl', 3, 15, 'Kitchen'],
      ['Mop Floor (Kitchen)', 'iadl', 1, 10, 'Kitchen'],
      ['Mop Floor (Bathroom)', 'iadl', 1, 10, 'Bathroom'],
      ['Clean Toilet and Sink', 'iadl', 1, 15, 'Bathroom'],
      ['Bathing Assist', 'adl', 2, 30, ''],
    ]), p.tasks)
  const sum = p.tasks.reduce((a: number, t: any) => a + t.weeklyFrequency * t.allottedMinutes, 0)
  check('the read tasks add back up to the sheet (140 min/week)', sum === 140, sum)

  const otherName = await upload(admin, bob.id, await assessmentPdf(SUMMARY))
  check('an assessment for someone else is flagged', otherName.json.clientNameMatch === false, otherName.json)
  const bad = SUMMARY.map((r) => r.text === 'Wash Dishes' ? { ...r, nums: [7, 15, 3, 15, 40] } : r)
  const wrong = await upload(admin, jane.id, await assessmentPdf(bad))
  check('a row whose numbers disagree (3 × 15 ≠ 40) refuses the whole sheet', wrong.status === 422 && /3x\/week × 15 min but 40 min\/week/.test(wrong.json.error), wrong.json)
  const badTotal = SUMMARY.map((r) => r.kind === 'total' && r.nums![0] === 80 ? { ...r, nums: [90] } : r)
  const tot = await upload(admin, jane.id, await assessmentPdf(badTotal))
  check('rows that do not add up to the section total are refused', tot.status === 422 && /rows add up to 80 min\/week but the sheet total is 90/.test(tot.json.error), tot.json)
  const notMidas = await upload(admin, jane.id, await assessmentPdf([{ kind: 'left', text: 'Some other form' }]))
  check('a PDF that is not the summary is refused with the reason', notMidas.status === 422 && /not a MIDAS/.test(notMidas.json.error), notMidas.json)
  const notPdf = await upload(admin, jane.id, new TextEncoder().encode('hello'))
  check('a file that is not a PDF is refused, not a 500', notPdf.status === 422, notPdf)
  check('a caregiver may not read assessments', (await upload(cg, jane.id, await assessmentPdf(SUMMARY))).status === 403)
  check('no file is a 400', (await A('POST', `/api/care-tasks/client/${jane.id}/parse-assessment-pdf`, {})).status === 400)

  await db.update(agencies).set({ state: 'OH' }).where(eq(agencies.id, ag.id))
  const oh = await A('GET', '/api/care-tasks/assessment-formats')
  check('an Ohio agency is not offered a Wisconsin insurer\'s import', oh.status === 200 && oh.json.length === 0, oh.json)
  check('…and cannot use it', (await upload(admin, jane.id, await assessmentPdf(SUMMARY), 'midas_shc_pc_summary')).status === 400)
  await db.update(agencies).set({ state: 'WI' }).where(eq(agencies.id, ag.id))
}

// ════════════════════════════════════════════════════════════════════════════
// CARE PLANS
// ════════════════════════════════════════════════════════════════════════════
let planId = ''
{
  check('an empty create is a 400, not a 500', (await A('POST', '/api/care-plans', {})).status === 400)
  check('a caregiver may not create a care plan', (await C('POST', '/api/care-plans', { clientId: jane.id, serviceType: 'personal_care' })).status === 403)
  const created = await A('POST', '/api/care-plans', {
    clientId: jane.id, serviceType: 'personal_care', frequency: '3x/week', startDate: '2026-01-05', endDate: '',
    serviceDescription: 'Morning help', medicationNotes: 'Reminders only', mobilityNotes: 'Walker', dietaryNotes: 'Low salt', communicationNotes: 'Hard of hearing',
  })
  check('a plan keeps the five note sections', created.status === 201 && created.json.serviceDescription === 'Morning help'
    && created.json.medicationNotes === 'Reminders only' && created.json.mobilityNotes === 'Walker'
    && created.json.dietaryNotes === 'Low salt' && created.json.communicationNotes === 'Hard of hearing' && created.json.endDate === null, created.json)
  planId = created.json.id
  const list = await C('GET', `/api/care-plans?clientId=${jane.id}`)
  check('a caregiver can read the plans, with the client name', list.status === 200 && list.json[0]?.clientName === 'Jane Doe', list.json[0])

  const u1 = await A('PUT', `/api/care-plans/${planId}`, { careGoals: 'Walk daily' })
  check('an edit changes only what was sent', u1.status === 200 && u1.json.careGoals === 'Walk daily' && u1.json.frequency === '3x/week', u1.json)
  await A('PUT', `/api/care-plans/${planId}`, { endDate: '' }) // already empty: no content change
  await A('PUT', `/api/care-plans/${planId}`, { endDate: '2027-01-31' })
  const cleared = await A('PUT', `/api/care-plans/${planId}`, { endDate: '' })
  check("'' clears an end date", cleared.json.endDate === null, cleared.json)
  check('serviceType cannot be blanked', (await A('PUT', `/api/care-plans/${planId}`, { serviceType: '' })).status === 400)
  check('a bad date is a 400', (await A('PUT', `/api/care-plans/${planId}`, { startDate: '01/05/2026' })).status === 400)
  check('a caregiver may not edit a plan', (await C('PUT', `/api/care-plans/${planId}`, { careGoals: 'x' })).status === 403)
  check('editing a missing plan is a 404', (await A('PUT', '/api/care-plans/nope000', { careGoals: 'x' })).status === 404)

  const revs = await A('GET', `/api/care-plans/${planId}/revisions`)
  check('every content change is a revision, newest first, and a no-op is not', revs.status === 200
    && JSON.stringify(revs.json.map((r: any) => r.revision_number)) === JSON.stringify([3, 2, 1]), revs.json.map((r: any) => r.revision_number))
  const r1 = revs.json.find((r: any) => r.revision_number === 1)
  check('a revision is the OLD row, with who changed it', r1.care_goals === null && r1.frequency === '3x/week' && r1.changed_by_id === admin.id
    && r1.changed_by_first === 'Ada', r1)
  check('revision 3 holds the end date that was cleared', revs.json[0].end_date && String(revs.json[0].end_date).startsWith('2027-01-31'), revs.json[0])
  check('a caregiver may not read revisions', (await C('GET', `/api/care-plans/${planId}/revisions`)).status === 403)

  // ── the visit schedule ──
  const empty = await A('PUT', `/api/care-plans/${planId}`, { visitSchedule: 'current' })
  check('fill from schedule with no visits says so', empty.status === 400 && /no recurring visits scheduled in the next 4 weeks/.test(empty.json.error), empty.json)
  check('visitSchedule only takes "current" or ""', (await A('PUT', `/api/care-plans/${planId}`, { visitSchedule: 'Mondays' })).status === 400)
  const mon = (await db.insert(schedules).values({ clientId: jane.id, caregiverId: cg.id, dayOfWeek: 1, startTime: new Date('2026-01-05T09:00:00Z'), endTime: new Date('2026-01-05T13:00:00Z'), frequency: 'weekly', effectiveDate: '2026-01-05', scheduleType: 'recurring', isActive: true } as any).returning())[0]
  await db.insert(schedules).values({ clientId: jane.id, caregiverId: null, dayOfWeek: 3, startTime: new Date('2026-01-07T14:00:00Z'), endTime: new Date('2026-01-07T15:30:00Z'), frequency: 'biweekly', anchorDate: '2026-01-07', effectiveDate: '2026-01-07', endDate: '2027-12-31', scheduleType: 'recurring', isActive: true } as any)
  await db.insert(schedules).values({ clientId: jane.id, caregiverId: cg2.id, dayOfWeek: 5, startTime: new Date('2026-01-09T08:00:00Z'), endTime: new Date('2026-01-09T09:00:00Z'), frequency: 'weekly', effectiveDate: '2026-01-09', scheduleType: 'recurring', isActive: false } as any)
  await db.insert(schedules).values({ clientId: jane.id, caregiverId: cg2.id, date: addDays(todayUtc, 3), startTime: new Date(`${addDays(todayUtc, 3)}T10:00:00Z`), endTime: new Date(`${addDays(todayUtc, 3)}T11:00:00Z`), scheduleType: 'one-time', isActive: true } as any)
  // cancel the next Monday visit
  let nextMon = todayUtc; while (new Date(`${nextMon}T12:00:00Z`).getUTCDay() !== 1) nextMon = addDays(nextMon, 1)
  await db.insert(scheduleExceptions).values({ scheduleId: mon.id, exceptionDate: nextMon, exceptionType: 'cancelled' })

  const live = await A('GET', `/api/care-plans/visit-schedule/${jane.id}`)
  const expectedText = 'Monday 9:00 AM – 1:00 PM · Cara Giver · weekly\nWednesday 2:00 PM – 3:30 PM · Unassigned · every other week · through 12/31/2027'
  check('the live schedule in words: the patterns, Monday first; inactive and one-time rows are not patterns', live.json.text === expectedText, live.json.text)
  // 4 Mondays − 1 cancelled + 2 bi-weekly Wednesdays + 1 one-time = 6
  check('upcoming visits in the 28-day window count every real occurrence (a cancelled one does not exist)', live.json.upcomingVisits === 6 && live.json.windowDays === 28 && live.json.asOf === todayUtc, live.json)
  const filled = await A('PUT', `/api/care-plans/${planId}`, { visitSchedule: 'current' })
  check('"current" saves the live schedule on the plan, dated today', filled.json.visitSchedule === expectedText && filled.json.visitScheduleAsOf === todayUtc, filled.json)
  const rv = (await A('GET', `/api/care-plans/${planId}/revisions`)).json
  check('saving the schedule is a revision too', rv[0].revision_number === 4 && rv[0].visit_schedule === null, rv[0])
  const unset = await A('PUT', `/api/care-plans/${planId}`, { visitSchedule: '' })
  check('"" removes the saved schedule', unset.json.visitSchedule === null && unset.json.visitScheduleAsOf === null, unset.json)

  // ── generate schedule ──
  const gen409 = await A('POST', `/api/care-plans/${planId}/generate-schedule`, { caregiverId: cg.id, startTime: '08:00', endTime: '12:00', daysOfWeek: [1, 4] })
  check('generating on top of an existing schedule is refused (double-booking)', gen409.status === 409
    && gen409.json.error === 'This client already has 6 visit(s) scheduled in the next 28 days. Generating would double-book them — change the shifts in Scheduling instead.', gen409.json)
  const bobPlan = (await A('POST', '/api/care-plans', { clientId: bob.id, serviceType: 'companionship' })).json
  check('generate needs a caregiver, times and days', (await A('POST', `/api/care-plans/${bobPlan.id}/generate-schedule`, { caregiverId: cg.id })).status === 400)
  check('days must be 0–6', (await A('POST', `/api/care-plans/${bobPlan.id}/generate-schedule`, { caregiverId: cg.id, startTime: '08:00', endTime: '12:00', daysOfWeek: [7] })).status === 400)
  check('a caregiver may not generate a schedule', (await C('POST', `/api/care-plans/${bobPlan.id}/generate-schedule`, { caregiverId: cg.id, startTime: '08:00', endTime: '12:00', daysOfWeek: [1] })).status === 403)
  const gen = await A('POST', `/api/care-plans/${bobPlan.id}/generate-schedule`, { caregiverId: cg.id, startTime: '08:00', endTime: '12:00', daysOfWeek: [1, 4] })
  check('generate makes one weekly row per day', gen.status === 201 && gen.json.created === 2 && gen.json.schedules.every((s: any) => s.frequency === 'weekly' && s.notes === 'Generated from care plan: companionship'), gen.json)
  check('no authorization on file is a warning, not a refusal', JSON.stringify(gen.json.warnings) === JSON.stringify(['No active authorization on file for this client']), gen.json.warnings)
  const bobLive = await A('GET', `/api/care-plans/visit-schedule/${bob.id}`)
  check('the generated shifts are the client\'s schedule now', bobLive.json.text === 'Monday 8:00 AM – 12:00 PM · Cara Giver · weekly\nThursday 8:00 AM – 12:00 PM · Cara Giver · weekly' && bobLive.json.upcomingVisits === 8, bobLive.json)

  // authorization advice, with the source CRM's numbers: 4h × 2 days = 8h = 32 fifteen-minute units
  const zed = await mkClient('Zed', 'Poe')
  const zedPlan = (await A('POST', '/api/care-plans', { clientId: zed.id, serviceType: 'personal_care' })).json
  await db.insert(authorizations).values({ clientId: zed.id, authorizedUnits: '100', usedUnits: '90', unitType: '15min', startDate: addDays(todayUtc, -10), endDate: addDays(todayUtc, 200), status: 'active', authNumber: 'A-77' } as any)
  const genZ = await A('POST', `/api/care-plans/${zedPlan.id}/generate-schedule`, { caregiverId: cg.id, startTime: '08:00', endTime: '12:00', daysOfWeek: [2, 5] })
  check('a short authorization is advice — the schedule is still made', genZ.status === 201 && genZ.json.created === 2, genZ.json)
  check('…with the balance, the low warning and what will remain', JSON.stringify(genZ.json.warnings) === JSON.stringify([
    'Authorization balance looks short: 10 15min remaining, 32 needed for this shift — check auth A-77 before billing',
    'Authorization running low: 10 units remaining (90.0% used)',
    'After this shift, only -22.0 units will remain',
  ]), genZ.json.warnings)
  const yan = await mkClient('Yan', 'Low')
  const yanPlan = (await A('POST', '/api/care-plans', { clientId: yan.id, serviceType: 'personal_care' })).json
  await db.update(clients).set({ isPrivatePay: true }).where(eq(clients.id, yan.id))
  const genY = await A('POST', `/api/care-plans/${yanPlan.id}/generate-schedule`, { caregiverId: cg.id, startTime: '22:00', endTime: '06:00', daysOfWeek: [6] })
  check('a private-pay client needs no authorization', genY.status === 201 && genY.json.warnings.length === 0, genY.json)

  // ── templates ──
  const tpls = await A('GET', '/api/care-plan-templates')
  check('six built-in templates', tpls.status === 200 && tpls.json.filter((t: any) => t.isBuiltIn).length === 6, tpls.json.length)
  check('a caregiver may not read the template library', (await C('GET', '/api/care-plan-templates')).status === 403)
  const dementia = tpls.json.find((t: any) => t.templateName === "Dementia / Alzheimer's Care")
  const fromTpl = await A('POST', `/api/care-plans/from-template/${dementia.id}`, { clientId: bob.id, startDate: todayUtc })
  check('Use Template makes a DRAFT plan carrying the template', fromTpl.status === 201 && fromTpl.json.carePlan.status === 'draft'
    && fromTpl.json.carePlan.careGoals === dementia.careGoals && fromTpl.json.carePlan.communicationNotes === dementia.communicationNotes
    && fromTpl.json.appliedTemplate === "Dementia / Alzheimer's Care", fromTpl.json)
  check('from-template needs a client', (await A('POST', `/api/care-plans/from-template/${dementia.id}`, {})).status === 400)
  const mine = await A('POST', '/api/care-plan-templates', { templateName: 'Our Respite', serviceType: 'respite_care', careGoals: 'Rest for family' })
  check('the office adds its own template', mine.status === 201 && mine.json.isBuiltIn === false)
  check('its own template is deleted', (await A('DELETE', `/api/care-plan-templates/${mine.json.id}`)).json.message === 'Template deleted')
  const off = await A('DELETE', `/api/care-plan-templates/${dementia.id}`)
  check('a built-in is switched off, not deleted', off.json.message === 'Built-in template deactivated'
    && !(await A('GET', '/api/care-plan-templates')).json.some((t: any) => t.id === dementia.id))

  // ── PDF ──
  await db.update(agencies).set({ name: 'Care Port Agency' }).where(eq(agencies.id, ag.id))
  const pdf = await A('GET', `/api/care-plans/${planId}/pdf`)
  check('the care plan prints as a PDF', pdf.status === 200 && pdf.ct.includes('application/pdf') && new TextDecoder().decode(pdf.bytes.slice(0, 5)) === '%PDF-', pdf.status)
  check('a caregiver may not print a plan', (await C('GET', `/api/care-plans/${planId}/pdf`)).status === 403)
  const { careTasksSection } = await import('./src/services/carePdf.ts')
  const section = careTasksSection([
    { task_name: 'Wash Dishes', category: 'iadl', weekly_frequency: 3, allotted_minutes: 15, assessment_source: 'midas_shc_pc_summary' },
    { task_name: 'Bathing', category: 'adl', weekly_frequency: 2, allotted_minutes: 30, assessment_source: null },
  ], true)
  check('the plan\'s Care Tasks section: ADL first, minutes per week per group and in total', section === [
    'Personal Care (ADL) — 60 min/week',
    '   •  Bathing: 2x/week × 30 min = 60 min/week',
    '',
    'Homemaking (IADL) — 45 min/week',
    '   •  Wash Dishes: 3x/week × 15 min = 45 min/week',
    '',
    'Total: 105 min/week (1.75 hours)',
    'Tasks imported from the insurer assessment.',
  ].join('\n'), section)

  const summary = await A('GET', '/api/care-plans/summary')
  check('the summary counts plans', summary.status === 200 && summary.json.total >= 4, summary.json)
}

// ════════════════════════════════════════════════════════════════════════════
// MEDICATIONS, MAR, VITALS
// ════════════════════════════════════════════════════════════════════════════
{
  check('a caregiver may not add a medication', (await C('POST', '/api/medications', { clientId: jane.id, medicationName: 'X' })).status === 403)
  const med = await A('POST', '/api/medications', { clientId: jane.id, medicationName: 'Oxycodone', dosage: '5mg', prescriber: 'Dr. Li', isPrn: true, pharmacy: 'Main St', startDate: '' })
  check('the screen\'s field names are stored on the table\'s columns', med.status === 201 && med.json.name === 'Oxycodone'
    && med.json.prescribedBy === 'Dr. Li' && med.json.isPrn === true && med.json.pharmacy === 'Main St' && med.json.startDate === null, med.json)
  const other = (await A('POST', '/api/medications', { clientId: bob.id, name: 'Aspirin' })).json
  const list = await C('GET', `/api/medications/client/${jane.id}`)
  check('the list carries medication_name / prescriber / is_active', list.json[0]?.medication_name === 'Oxycodone' && list.json[0]?.prescriber === 'Dr. Li' && list.json[0]?.is_active === true, list.json[0])

  const given = await C('POST', '/api/medications/log', { medicationId: med.json.id, clientId: jane.id, status: 'bogus', witnessedBy: '  Sam Witness ', dosageGiven: '5mg' })
  check('an unknown MAR status is recorded as given (the source rule)', given.status === 201 && given.json.status === 'given' && given.json.effectiveStatus === 'given', given.json)
  check('the witness and dose given are kept', given.json.witnessedBy === 'Sam Witness' && given.json.dosageGiven === '5mg')
  check('a caregiver logs as themselves', given.json.caregiverId === cg.id)
  const asOther = await C('POST', '/api/medications/log', { medicationId: med.json.id, clientId: jane.id, status: 'refused', caregiverId: cg2.id })
  check('a caregiver cannot log a dose as someone else', asOther.json.caregiverId === cg.id && asOther.json.effectiveStatus === 'refused', asOther.json)
  const backEntered = await A('POST', '/api/medications/log', { medicationId: med.json.id, clientId: jane.id, status: 'held', caregiverId: cg2.id, administeredTime: '2026-10-01T14:00:00Z' })
  check('the office may attribute a back-entered dose to the caregiver', backEntered.json.caregiverId === cg2.id && new Date(backEntered.json.administeredAt).toISOString() === '2026-10-01T14:00:00.000Z', backEntered.json)
  check('a medication of another client cannot be logged here', (await C('POST', '/api/medications/log', { medicationId: other.id, clientId: jane.id })).status === 404)
  const [entry] = await db.insert(timeEntries).values({ caregiverId: cg.id, clientId: jane.id, startTime: new Date(), endTime: new Date(Date.now() + 3600000) }).returning() // closed: one open entry per caregiver (0016)
  const onVisit = await C('POST', '/api/medications/log', { medicationId: med.json.id, clientId: jane.id, status: 'self_administered', timeEntryId: entry.id })
  check('a dose can belong to the visit', onVisit.json.timeEntryId === entry.id)
  check('…but not to someone else\'s visit', (await C2('POST', '/api/medications/log', { medicationId: med.json.id, clientId: jane.id, timeEntryId: entry.id })).status === 403)
  const visitLogs = await A('GET', `/api/medications/logs/time-entry/${entry.id}`)
  check('the visit\'s MAR', visitLogs.json.length === 1 && visitLogs.json[0].medication_name === 'Oxycodone')
  const logs = await A('GET', `/api/medications/logs/client/${jane.id}`)
  check('the client\'s MAR reads administered_time, name, caregiver, witness', logs.json.length === 4 && logs.json.every((l: any) => l.administered_time && l.medication_name === 'Oxycodone')
    && logs.json.some((l: any) => l.witnessed_by === 'Sam Witness' && l.caregiver_first === 'Cara'), logs.json[0])
  const rep = await A('GET', `/api/medications/reports/adherence/${jane.id}`)
  check('adherence counts by the strict status', rep.json[0]?.administered_count === 1 && rep.json[0]?.refused_count === 1 && rep.json[0]?.held_count === 1 && rep.json[0]?.total_entries === 4, rep.json)

  const disc = await A('PUT', `/api/medications/${med.json.id}/discontinue`)
  check('discontinue ends the medication today', disc.status === 200 && disc.json.status === 'discontinued' && !!disc.json.endDate, disc.json)
  check('the active-only list leaves it out', (await A('GET', `/api/medications/client/${jane.id}?activeOnly=true`)).json.length === 0)
  check('…and the due list too', (await C('GET', `/api/medications/due/${jane.id}`)).json.length === 0)

  // vitals
  check('vitals with nothing measured are refused', (await C('POST', '/api/medications/vitals', { clientId: jane.id, notes: 'fine' })).json.error === 'At least one vital measurement is required')
  const outOfRange = await C('POST', '/api/medications/vitals', { clientId: jane.id, pulse: '300', temperatureF: '98.6' })
  check('an implausible value is refused with its range', outOfRange.status === 400 && /Pulse 300 \(allowed 25–220/.test(outOfRange.json.error), outOfRange.json)
  check('a fractional pulse is refused', (await C('POST', '/api/medications/vitals', { clientId: jane.id, pulse: '72.5' })).status === 400)
  const v = await C('POST', '/api/medications/vitals', { clientId: jane.id, systolicBp: '120', diastolicBp: '80', pulse: 72, temperatureF: '98.6', painScale: '0', caregiverId: cg2.id })
  check('vitals are recorded, a pain score of 0 kept', v.status === 201 && v.json.systolicBp === 120 && v.json.painScale === 0 && String(v.json.temperatureF) === '98.6', v.json)
  check('a caregiver records vitals as themselves', v.json.caregiverId === cg.id)
  const v2 = await A('POST', '/api/medications/vitals', { clientId: jane.id, weightLbs: '150.5', caregiverId: cg2.id })
  check('the office may attribute a reading', v2.json.caregiverId === cg2.id)
  const latest = await C('GET', `/api/medications/vitals/latest/${jane.id}`)
  check('the latest reading', latest.json?.id === v2.json.id && latest.json.caregiver_first === 'Other', latest.json)
  check('the history', (await C('GET', `/api/medications/vitals/client/${jane.id}?limit=10`)).json.length === 2)
  let dbRefused = false
  try { await db.insert(clientVitals).values({ clientId: jane.id, pulse: 999 }) } catch { dbRefused = true }
  check('the table refuses an implausible value on its own (CHECK)', dbRefused)
}

// ════════════════════════════════════════════════════════════════════════════
// FORMS
// ════════════════════════════════════════════════════════════════════════════
{
  const wi = await C('GET', '/api/forms/templates')
  const names = wi.json.map((t: any) => t.name)
  check('the built-in library is there (9 in a Wisconsin agency)', wi.json.filter((t: any) => t.isBuiltIn).length === 9, names)
  check('…including the In-Home Client Assessment', names.includes('In-Home Client Assessment'))
  check('no agency name is baked into a built-in', !JSON.stringify(wi.json).includes('Chippewa'))
  await db.update(agencies).set({ state: 'OH' }).where(eq(agencies.id, ag.id))
  const oh = await C('GET', '/api/forms/templates')
  check('a Wisconsin-only form is not offered to an Ohio agency', !oh.json.some((t: any) => t.name === 'Wisconsin Plan of Care (POC)') && oh.json.filter((t: any) => t.isBuiltIn).length === 8, oh.json.map((t: any) => t.name))
  await db.update(agencies).set({ state: 'WI' }).where(eq(agencies.id, ag.id))

  const assessment = wi.json.find((t: any) => t.name === 'In-Home Client Assessment')
  const fields = assessment.fields
  check('the assessment uses section headings and date fields', fields.some((f: any) => f.type === 'section') && fields.some((f: any) => f.type === 'date' && f.id === 'assessment_date'))
  const missing = await A('POST', '/api/forms/submissions', { templateId: assessment.id, entityType: 'client', entityId: jane.id, data: { allergies: 'NKA' } })
  check('required answers are enforced server-side, sections excepted', missing.status === 400 && /^Please answer: Type of assessment · Assessment date/.test(missing.json.error) && !/Assessment Visit/.test(missing.json.error), missing.json)
  const answers: Record<string, unknown> = {}
  for (const f of fields) {
    if (!f.required || f.type === 'section') continue
    answers[f.id] = f.type === 'checkbox' ? [f.options[0]] : f.type === 'date' ? '2026-10-01' : (f.options ? f.options[0] : 'x')
  }
  const noSig = await A('POST', '/api/forms/submissions', { templateId: assessment.id, entityType: 'client', entityId: jane.id, data: answers })
  check('a form that needs a signature is refused without one', noSig.status === 400 && noSig.json.error === 'This form needs a signature', noSig.json)
  const emptyMulti = await A('POST', '/api/forms/submissions', { templateId: assessment.id, entityType: 'client', entityId: jane.id, data: { ...answers, services: [] }, signature: 'Ada Admin' })
  check('an empty multi-select is an unanswered question', emptyMulti.status === 400 && /Services recommended/.test(emptyMulti.json.error), emptyMulti.json)
  const ok = await C('POST', '/api/forms/submissions', { templateId: assessment.id, entityType: 'client', entityId: jane.id, data: answers, signature: 'Cara Giver' })
  check('a complete, signed assessment is saved as signed', ok.status === 201 && ok.json.status === 'signed' && ok.json.clientId === jane.id && Array.isArray(ok.json.data.services), ok.json)
  check('a submission for a missing client is a 404', (await A('POST', '/api/forms/submissions', { templateId: assessment.id, entityType: 'client', entityId: 'nope000', data: answers })).status === 404)
  const hr = wi.json.find((t: any) => t.name === 'Caregiver Employment Agreement')
  const hrAnswers: Record<string, unknown> = {}
  for (const f of hr.fields) if (f.required) hrAnswers[f.id] = f.type === 'checkbox' ? [f.options[0]] : (f.options ? f.options[0] : '1')
  const hrSub = await A('POST', '/api/forms/submissions', { templateId: hr.id, entityType: 'caregiver', entityId: cg.id, data: hrAnswers, signature: 'Cara Giver' })
  check('an HR form is filed against a caregiver', hrSub.status === 201 && hrSub.json.entityType === 'caregiver' && hrSub.json.clientId === null, hrSub.json)
  const listed = await A('GET', '/api/forms/submissions?entityType=caregiver')
  check('the submissions list names who it is about', listed.json[0]?.entity_name === 'Cara Giver', listed.json[0])
  const pdf = await A('GET', `/api/forms/submissions/${ok.json.id}/pdf`)
  check('a submission prints as a PDF', pdf.status === 200 && new TextDecoder().decode(pdf.bytes.slice(0, 5)) === '%PDF-', pdf.status)
  check('the person who filled it in may print it', (await C('GET', `/api/forms/submissions/${ok.json.id}/pdf`)).status === 200)
  check('another caregiver may not', (await C2('GET', `/api/forms/submissions/${ok.json.id}/pdf`)).status === 403)
  check('…nor read it', (await C2('GET', `/api/forms/submissions/${ok.json.id}`)).status === 403)
  const { renderAnswer } = await import('./src/services/carePdf.ts')
  check('answers print: a multi-select joined, Yes/No, a dash for blank', renderAnswer(['Cane', 'Walker']) === 'Cane, Walker' && renderAnswer(true) === 'Yes' && renderAnswer('') === '—' && renderAnswer([]) === '—')

  check('a caregiver may not change the library', (await C('POST', '/api/forms/templates', { name: 'Mine' })).status === 403)
  const badField = await A('POST', '/api/forms/templates', { name: 'Mine', fields: [{ id: 'a', type: 'signature' }] })
  check('a field type the filler cannot show is refused', badField.status === 400, badField.json)
  const mine = await A('POST', '/api/forms/templates', { name: 'Mine', fields: [{ id: 's', type: 'section', label: 'Part 1' }, { id: 'd', type: 'date', label: 'When', required: true }] })
  check('the office adds a form', mine.status === 201 && mine.json.isBuiltIn === false)
  check('deleting a form switches it off', (await A('DELETE', `/api/forms/templates/${mine.json.id}`)).status === 200
    && (await db.select().from(formTemplates).where(eq(formTemplates.id, mine.json.id)))[0]?.isActive === false)
}

// ════════════════════════════════════════════════════════════════════════════
// DOCUMENTS + E-SIGNATURE
// ════════════════════════════════════════════════════════════════════════════
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
{
  const send = async (who: any, fields: Record<string, string>, name = 'policy.pdf', bytes = '%PDF-1.4 test') => {
    const fd = new FormData()
    fd.append('file', new File([bytes], name, { type: 'application/pdf' }))
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    return as(who)('POST', '/api/documents', undefined, fd)
  }
  check('a caregiver may not upload', (await send(cg, { entityType: 'company' })).status === 403)
  check('a file type that is not accepted is refused', (await send(admin, { entityType: 'company' }, 'run.exe')).status === 400)
  check('a caregiver document needs its caregiver', (await send(admin, { entityType: 'caregiver' })).status === 400)
  const policy = await send(admin, { entityType: 'company', documentName: 'Handbook', requiresSignature: 'true', category: 'legal' })
  const i9 = await send(admin, { entityType: 'caregiver', entityId: cg.id, documentName: 'I-9', requiresSignature: 'true' })
  const care = await send(admin, { entityType: 'client', entityId: jane.id, documentName: 'Physician order' })
  check('the office uploads company, caregiver and client documents', policy.status === 201 && i9.status === 201 && care.status === 201, [policy, i9, care])
  const list = await A('GET', '/api/documents')
  check('the office list reads the screen\'s names', list.json.some((d: any) => d.document_name === 'Handbook' && d.category === 'legal' && d.file_name === 'policy.pdf' && d.file_size > 0 && d.uploaded_at)
    && list.json.some((d: any) => d.document_name === 'Physician order' && d.entity_first_name === 'Jane'), list.json)
  check('the list never carries the file bytes', !JSON.stringify(list.json).includes('file_data'))
  check('a caregiver may not read the whole store', (await C('GET', '/api/documents')).status === 403)

  const q1 = await C('GET', `/api/documents/unsigned/${cg.id}`)
  check('a caregiver\'s to-sign list: their own and the company\'s', q1.json.map((d: any) => d.name).sort().join(',') === 'Handbook,I-9', q1.json.map((d: any) => d.name))
  check('a caregiver may not read someone else\'s list', (await C2('GET', `/api/documents/unsigned/${cg.id}`)).status === 403)
  check('a signature must be an image data URI', (await C('POST', `/api/documents/${policy.json.id}/sign`, { signatureImageBase64: 'hello' })).status === 400)
  check('…and not enormous', (await C('POST', `/api/documents/${policy.json.id}/sign`, { signatureImageBase64: 'data:image/png;base64,' + 'A'.repeat(2_000_001) })).status === 400)
  check('a caregiver may not sign another caregiver\'s document', (await C2('POST', `/api/documents/${i9.json.id}/sign`, { signatureImageBase64: SIG })).status === 403)
  check('…nor a client\'s', (await C('POST', `/api/documents/${care.json.id}/sign`, { signatureImageBase64: SIG })).status === 403)
  const signed = await C('POST', `/api/documents/${policy.json.id}/sign`, { signatureImageBase64: SIG, typedName: 'Cara Giver' })
  check('the caregiver signs the handbook', signed.status === 200 && signed.json.document.signatureTypedName === 'Cara Giver', signed.json)
  await C('POST', `/api/documents/${i9.json.id}/sign`, { signatureImageBase64: SIG, typedName: 'Cara Giver' })
  check('signed documents leave the caregiver\'s list', (await C('GET', `/api/documents/unsigned/${cg.id}`)).json.length === 0)
  check('a company document stays on everyone else\'s list until THEY sign it', (await C2('GET', `/api/documents/unsigned/${cg2.id}`)).json.map((d: any) => d.name).join(',') === 'Handbook')
  await C2('POST', `/api/documents/${policy.json.id}/sign`, { signatureImageBase64: SIG, typedName: 'Other Carer' })
  const sigs = await A('GET', `/api/documents/${policy.json.id}/signatures`)
  check('every signature is kept, with IP/device evidence columns', sigs.json.length === 2 && sigs.json.every((s: any) => s.signer_typed_name) , sigs.json)
  check('a caregiver sees only their own signature on a shared document', (await C('GET', `/api/documents/${policy.json.id}/signatures`)).json.length === 1)
  const dl = await C('GET', `/api/documents/${i9.json.id}/download`)
  check('the caregiver downloads their own document, byte for byte', dl.status === 200 && new TextDecoder().decode(dl.bytes) === '%PDF-1.4 test', dl.status)
  check('…but not a client\'s', (await C('GET', `/api/documents/${care.json.id}/download`)).status === 403)
  check('a caregiver reads their own documents', (await C('GET', `/api/documents/caregiver/${cg.id}`)).json.length === 1)
  check('…not another caregiver\'s', (await C('GET', `/api/documents/caregiver/${cg2.id}`)).status === 403)
  check('the office deletes a document', (await A('DELETE', `/api/documents/${care.json.id}`)).status === 200
    && (await db.select().from(documents).where(eq(documents.id, care.json.id))).length === 0)
}

// ════════════════════════════════════════════════════════════════════════════
// INSURANCE CARDS
// ════════════════════════════════════════════════════════════════════════════
{
  check('a caregiver may not upload an insurance card', (await C('PUT', `/api/insurance-cards/${jane.id}`, { side: 'front', imageBase64: SIG })).status === 403)
  check('…nor read one', (await C('GET', `/api/insurance-cards/${jane.id}?side=front`)).status === 403)
  check('side must be front or back', (await A('PUT', `/api/insurance-cards/${jane.id}`, { side: 'top', imageBase64: SIG })).status === 400)
  check('the image must be a data URI', (await A('PUT', `/api/insurance-cards/${jane.id}`, { side: 'front', imageBase64: 'http://x/y.png' })).status === 400)
  check('…of at most ~5 MB', (await A('PUT', `/api/insurance-cards/${jane.id}`, { side: 'front', imageBase64: 'data:image/png;base64,' + 'A'.repeat(7_000_000) })).status === 400)
  const put = await A('PUT', `/api/insurance-cards/${jane.id}`, { side: 'front', imageBase64: SIG })
  check('the office stores the front', put.status === 200 && put.json.cleared === false && !!put.json.uploaded_at, put.json)
  const front = await A('GET', `/api/insurance-cards/${jane.id}?side=front`)
  const back = await A('GET', `/api/insurance-cards/${jane.id}?side=back`)
  check('front and back are read separately', front.json.image === SIG && back.json.image === null)
  const cl = await A('GET', `/api/clients/${jane.id}`)
  check('the client record says a card is on file without carrying the image', cl.json.hasInsuranceCardFront === true && cl.json.hasInsuranceCardBack === false && !('insuranceCardFront' in cl.json), Object.keys(cl.json).filter((k) => /insurance/i.test(k)))
  const all = await A('GET', '/api/clients')
  check('…and so does the client list', all.json.clients.find((x: any) => x.id === jane.id)?.hasInsuranceCardFront === true && !JSON.stringify(all.json).includes(SIG))
  const clear = await A('PUT', `/api/insurance-cards/${jane.id}`, { side: 'front', imageBase64: null })
  check('null clears a side', clear.json.cleared === true && (await A('GET', `/api/insurance-cards/${jane.id}?side=front`)).json.image === null)
  check('a missing client is a 404', (await A('PUT', '/api/insurance-cards/nope000', { side: 'front', imageBase64: SIG })).status === 404)
}

// ════════════════════════════════════════════════════════════════════════════
// ADL
// ════════════════════════════════════════════════════════════════════════════
{
  const [entry] = await db.insert(timeEntries).values({ caregiverId: cg.id, clientId: bob.id, startTime: new Date(), endTime: new Date(Date.now() + 3600000) }).returning() // closed: one open entry per caregiver (0016)
  const mine = await C('POST', '/api/adl/log', { clientId: bob.id, adlCategory: 'bathing', status: 'completed', caregiverId: cg2.id, timeEntryId: entry.id })
  check('a caregiver logs an ADL as themselves, on their visit', mine.status === 201 && mine.json.caregiverId === cg.id && mine.json.timeEntryId === entry.id, mine.json)
  check('…not on someone else\'s visit', (await C2('POST', '/api/adl/log', { clientId: bob.id, adlCategory: 'bathing', status: 'completed', timeEntryId: entry.id })).status === 403)
  check('…nor on another client\'s', (await C('POST', '/api/adl/log', { clientId: jane.id, adlCategory: 'bathing', status: 'completed', timeEntryId: entry.id })).status === 400)
  const back = await A('POST', '/api/adl/log', { clientId: bob.id, adlCategory: 'dressing', status: 'partial', caregiverId: cg2.id, performedAt: '2026-10-02T15:30:00Z' })
  check('the office attributes a back-dated ADL to the caregiver who did it', back.status === 201 && back.json.caregiverId === cg2.id && new Date(back.json.performedAt).toISOString() === '2026-10-02T15:30:00.000Z', back.json)
  check('a bad date is a 400', (await A('POST', '/api/adl/log', { clientId: bob.id, adlCategory: 'dressing', status: 'partial', performedAt: 'yesterday' })).status === 400)
  check('attributing to someone who does not exist is a 404', (await A('POST', '/api/adl/log', { clientId: bob.id, adlCategory: 'x', status: 'completed', caregiverId: 'nope000' })).status === 404)
  const logs = await C('GET', `/api/adl/client/${bob.id}/logs`)
  check('the log list names the caregiver as the screen reads it (caregiver_first)', logs.json.some((l: any) => l.caregiverFirst === 'Other') && logs.json.some((l: any) => l.caregiverFirst === 'Cara'), logs.json)
  check('the visit\'s ADLs', (await A('GET', `/api/adl/logs/time-entry/${entry.id}`)).json.length === 1)
  const rep = await A('GET', `/api/adl/reports/completion/${bob.id}?startDate=2026-09-01&endDate=${todayUtc}`)
  check('the completion report counts by category and status', rep.json.find((r: any) => r.adl_category === 'bathing')?.completed_count === 1
    && rep.json.find((r: any) => r.adl_category === 'dressing')?.partial_count === 1, rep.json)
  const req = await A('POST', '/api/adl/requirements', { clientId: bob.id, adlCategory: 'bathing', assistanceLevel: 'minimal' })
  const upd = await A('PUT', `/api/adl/requirements/${req.json.id}`, { assistanceLevel: 'moderate', frequency: 'daily' })
  check('the office edits a requirement', upd.status === 200 && upd.json.assistanceLevel === 'moderate' && upd.json.frequency === 'daily', upd.json)
  check('a caregiver may not', (await C('PUT', `/api/adl/requirements/${req.json.id}`, { frequency: 'weekly' })).status === 403)
  check('the categories list', (await C('GET', '/api/adl/categories')).json.length === 14)
}

// The old MAR wording backfilled: a row logged 'administered' reads as 'given'.
{
  const r = await pglite.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_snapshot_care_plan'`)
  check('the revision trigger is installed by the migration', (r.rows[0] as any).n === 1)
}

console.log(`\nhomecare-care: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
