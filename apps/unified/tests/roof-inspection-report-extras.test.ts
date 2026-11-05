// Row 9 of the roofing parity brief (docs/parity/roof-inspection-report.md #6, #11, #12, #14), through the real server as the
// roofing vertical:
//   · SEND TO HOMEOWNER by text or email through the CRM's own senders, the link switched on (or renewed) first, recorded on the
//     job's timeline and on the report; nothing is recorded when the sender refuses (opted out, texting off, no address);
//   · SAVE A COPY TO DOCUMENTS: a frozen PDF filed under the job (type Inspection) that later edits to the report do not change;
//   · SAVED TEMPLATES (sections, the kind of photo that fills each, introduction, layout) and LAYOUT CHOICES (photos per row, which
//     details print, job facts, timeline) that the page and the PDF both follow;
//   · the JOB'S TIMELINE in the report: opened, the stages it moved through, photos taken - not the office's notes or the texts.
// Nothing reaches R2 (an in-memory store stands in), a carrier or an email provider.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { inflateSync } from 'node:zlib'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { layoutOf, STANDARD_LAYOUT } from '../server/crm/roof/inspection/layout.ts'
import { jobEvent, reportSavedBody, reportSentBody } from '../server/crm/roof/jobRecord.ts'

/** The text a PDF draws (pdfkit deflates each page's content, its strings as hex runs inside TJ arrays). */
function pdfText(buf: Uint8Array): string {
  const raw = Buffer.from(buf).toString('latin1')
  let out = ''
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string
    try { body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { continue }
    for (const tj of body.matchAll(/\[(.*?)\]\s*TJ/g)) { for (const h of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1'); out += '\n' }
    for (const t of body.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) out += Buffer.from(t[1], 'hex').toString('latin1') + '\n'
  }
  return out
}

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const PNG = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3a8' } }).png().toBuffer()
const ON = ['jobs', 'contacts', 'photo_capture', 'inspection_reports', 'documents', 'two_way_texting']
const texts: Array<{ to: string; message: string; jobId?: string }> = []
const mails: Array<{ to: string; template: string; data: any }> = []
let smsAnswer: any = { id: 'sms1', status: 'sent' }
const objects = new Map<string, { body: Buffer; contentType: string }>()

const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const setFeatures = async (features: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
async function addPhoto(jobId: string, extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('photo', new File([new Uint8Array(PNG)], 'p.png', { type: 'image/png' }))
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return json(await as('owner')(`/api/jobs/${jobId}/photos`, { method: 'POST', body: fd }))
}
async function makeJob(address: string) {
  const made = await json(await as('owner')('/api/jobs', { method: 'POST', json: { contactId: ids.home, jobType: 'insurance', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301' } }))
  expect([address, made.status]).toEqual([address, 201])
  return made.body.id as string
}
const timelineOf = async (jobId: string) => ((await json(await as('owner')(`/api/jobs/${jobId}/timeline`))).body.data as any[])
const putReport = (id: string, body: any, who = 'owner') => as(who)(`/api/inspection-reports/${id}`, { method: 'PUT', json: body })
const page = async (id: string) => {
  const link = (await json(await as('owner')(`/api/inspection-reports/${id}/link`, { method: 'POST', json: {} }))).body.link
  const html = await (await t.call(link.path)).text()
  return { html, link }
}

let jobA = '', jobB = ''
const photos: Record<string, any> = {}
let reportA = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ name: 'Ridgeline Roofing', phone: '715-555-0100', enabledFeatures: ON } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  const storage = (t.services as any).crm.storage
  storage.storageConfigured = () => true
  storage.put = async (key: string, body: Buffer, contentType: string) => { objects.set(key, { body, contentType }) }
  storage.getObject = async (key: string) => objects.get(key) ?? null
  storage.deleteFile = async (key: string) => { objects.delete(key) }
  storage.saveFile = async (file: File, co: string, subdir: string) => {
    const key = `${co}/${subdir}/${crypto.randomUUID()}.pdf`
    objects.set(key, { body: Buffer.from(await file.arrayBuffer()), contentType: 'application/pdf' })
    return { path: key, originalname: file.name, mimetype: 'application/pdf', size: file.size }
  }
  ;(t.services as any).crm.sms.sendSMS = async (_co: string, args: any) => { texts.push({ to: args.toPhone, message: args.message, jobId: args.jobId }); return smsAnswer }
  const email: any = t.services.email
  email.send = async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { success: true } }
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of Object.entries({ manager: 'manager', field: 'field', viewer: 'viewer' })) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', mobile: '715-555-0101', type: 'client' } as any).returning()
  ids.home = home.id
  jobA = await makeJob('1 Shingle Way')
  jobB = await makeJob('2 Ridge Road')
  await t.db.update(t.schema.job).set({ assignedSalesRepId: ids.field } as any).where(eq(t.schema.job.id, jobA))
  photos.damage = (await addPhoto(jobA, { photoType: 'damage', caption: 'Hail hits on the north slope', takenAt: '2026-03-04T20:15:00Z' })).body
  photos.damage2 = (await addPhoto(jobA, { photoType: 'damage', caption: 'Cracked ridge cap' })).body
  photos.before = (await addPhoto(jobA, { photoType: 'before', caption: 'Ridge before work' })).body
  photos.general = (await addPhoto(jobA, { caption: 'Truck in the driveway' })).body
  // The job's story: a stage move through the real door, and a private note from the office.
  expect((await as('owner')(`/api/jobs/${jobA}/advance`, { method: 'POST' })).status).toBe(200)
  expect((await as('owner')(`/api/jobs/${jobA}/notes`, { method: 'POST', json: { body: 'Homeowner is behind on the mortgage — be gentle', isInternal: true } })).status).toBe(201)
  const made = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobA } }))
  reportA = made.body.id
}, 120_000)

describe('layout choices', () => {
  test('a report with none saved is laid out as every report was before: two to a row, every detail, no timeline', async () => {
    expect(layoutOf(null)).toEqual(STANDARD_LAYOUT)
    expect(layoutOf({ perRow: 9, captions: 'no' })).toEqual(STANDARD_LAYOUT)
    const { html } = await page(reportA)
    expect(html).toContain('class="grid per-2"')
    expect(html).toContain('Hail hits on the north slope')
    expect(html).toContain('Photographed by')
    expect(html).toContain('Property')
    expect(html).not.toContain('Job timeline')
    const pdf = pdfText(new Uint8Array(await (await as('owner')(`/api/inspection-reports/${reportA}/pdf`)).arrayBuffer()))
    expect(pdf).toContain('Hail hits on the north slope')
    expect(pdf).toContain('Homeowner')
  })

  test('photos per row, captions, date and time, location, photographer and job details can each be turned off, on the page and in the PDF', async () => {
    const put = await json(await putReport(reportA, { layout: { perRow: 3, captions: false, timestamps: false, gps: false, photographer: false, details: false } }))
    expect(put.status).toBe(200)
    expect(put.body.layout).toEqual({ perRow: 3, captions: false, timestamps: false, gps: false, photographer: false, details: false, timeline: false })
    const { html } = await page(reportA)
    expect(html).toContain('class="grid per-3"')
    expect(html).not.toContain('<figcaption>') // the caption stays as the picture's alt text for a screen reader, but is not printed
    expect(html).not.toContain('<strong>Hail hits on the north slope</strong>')
    expect(html).not.toContain('Photographed by')
    expect(html).not.toContain('Mar 4, 2026')
    expect(html).not.toContain('<dt>Property</dt>')
    const pdf = pdfText(new Uint8Array(await (await as('owner')(`/api/inspection-reports/${reportA}/pdf`)).arrayBuffer()))
    expect(pdf).not.toContain('Hail hits on the north slope')
    expect(pdf).not.toContain('Homeowner:')
    expect(pdf).toContain('Damage found')
    const one = await json(await putReport(reportA, { layout: { perRow: 1 } }))
    expect(one.body.layout.perRow).toBe(1)
    expect((await page(reportA)).html).toContain('class="grid per-1"')
    expect((await json(await putReport(reportA, { layout: { perRow: 5 } }))).status).toBe(400)
    await putReport(reportA, { layout: STANDARD_LAYOUT })
  })
})

describe('the job’s timeline in the report', () => {
  test('is the job’s story - opened, the stages it moved through, photos taken - and not the office’s notes or texts', async () => {
    await t.db.insert(t.schema.smsConversation).values({ companyId, contactId: ids.home } as any).onConflictDoNothing().catch(() => {})
    const put = await json(await putReport(reportA, { layout: { timeline: true } }))
    expect(put.body.layout.timeline).toBe(true)
    expect(put.body.timeline.map((e: any) => e.text)).toEqual(expect.arrayContaining(['Job opened', expect.stringMatching(/^Stage moved from .+ to .+$/), expect.stringMatching(/^\d+ photos? taken$/)]))
    const times = put.body.timeline.map((e: any) => new Date(e.at).getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    const { html } = await page(reportA)
    expect(html).toContain('Job timeline')
    expect(html).toContain('Job opened')
    expect(html).toContain('Stage moved from')
    expect(html).not.toContain('mortgage')
    const pdf = pdfText(new Uint8Array(await (await as('owner')(`/api/inspection-reports/${reportA}/pdf`)).arrayBuffer()))
    expect(pdf).toContain('Job timeline')
    expect(pdf).toContain('Job opened')
    expect(pdf).not.toContain('mortgage')
  })
  test('is off unless asked for', async () => {
    await putReport(reportA, { layout: { timeline: false } })
    const got = await json(await as('owner')(`/api/inspection-reports/${reportA}`))
    expect(got.body.timeline).toEqual([])
    expect((await page(reportA)).html).not.toContain('Job timeline')
  })
})

describe('saved templates', () => {
  let tplId = ''
  test('a template holds sections (each with the kind of photo that fills it), an introduction and a layout', async () => {
    const made = await json(await as('owner')('/api/inspection-reports/templates', { method: 'POST', json: {
      name: 'Hail inspection', intro: 'Seen from the ground and the ladder.',
      sections: [{ title: 'Hail damage', notes: 'Hits in a line.', photoType: 'damage' }, { title: 'Roof before work', notes: '', photoType: 'before' }, { title: 'Gutters and flashing', notes: 'Note anything loose.' }],
      layout: { perRow: 3, gps: false },
    } }))
    expect(made.status).toBe(201)
    tplId = made.body.id
    expect(made.body).toMatchObject({ name: 'Hail inspection', layout: { perRow: 3, gps: false, captions: true } })
    expect(made.body.sections.map((s: any) => [s.title, s.photoType])).toEqual([['Hail damage', 'damage'], ['Roof before work', 'before'], ['Gutters and flashing', null]])
    const list = await json(await as('owner')('/api/inspection-reports/templates'))
    expect(list.body.data.map((x: any) => x.name)).toEqual(['Hail inspection'])
  })
  test('the rules: a name is needed and unique, a photo kind must be a real one', async () => {
    const post = (body: any) => as('owner')('/api/inspection-reports/templates', { method: 'POST', json: body })
    expect((await post({ name: 'Hail inspection', sections: [] })).status).toBe(409)
    expect((await post({ name: '  ', sections: [] })).status).toBe(400)
    expect((await post({ name: 'Odd', sections: [{ title: 'x', photoType: 'banana' }] })).status).toBe(400)
  })
  test('a report built from one takes its introduction and layout and fills each section from the job’s photos of that kind', async () => {
    const made = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobA, templateId: tplId } }))
    expect(made.status).toBe(201)
    expect(made.body.intro).toBe('Seen from the ground and the ladder.')
    expect(made.body.layout).toMatchObject({ perRow: 3, gps: false })
    expect(made.body.sections.map((s: any) => [s.title, s.notes, s.photos.map((p: any) => p.id)])).toEqual([
      ['Hail damage', 'Hits in a line.', [photos.damage.id, photos.damage2.id]], ['Roof before work', '', [photos.before.id]], ['Gutters and flashing', 'Note anything loose.', []],
    ])
    expect((await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobA, templateId: 'nope' } }))).status).toBe(404)
  })
  test('a report can be saved as a template: its titles, notes and layout, each section taking the one kind of photo it holds', async () => {
    const saved = await json(await as('owner')('/api/inspection-reports/templates', { method: 'POST', json: { name: 'From the Shingle Way report', fromReportId: reportA } }))
    expect(saved.status).toBe(201)
    expect(saved.body.sections.map((s: any) => [s.title, s.photoType])).toEqual([['Damage found', 'damage'], ['Before', 'before']])
    expect((await json(await as('field')('/api/inspection-reports/templates', { method: 'POST', json: { name: 'Elsewhere', fromReportId: (await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobB } }))).body.id } }))).status).toBe(404)
  })
  test('it can be changed; deleting is the job-delete permission; a viewer reads and cannot change', async () => {
    const put = await json(await as('owner')(`/api/inspection-reports/templates/${tplId}`, { method: 'PUT', json: { name: 'Hail inspection v2', layout: { perRow: 1 } } }))
    expect([put.status, put.body.name, put.body.layout.perRow, put.body.sections.length]).toEqual([200, 'Hail inspection v2', 1, 3])
    expect((await as('viewer')('/api/inspection-reports/templates')).status).toBe(200)
    expect((await as('viewer')('/api/inspection-reports/templates', { method: 'POST', json: { name: 'V', sections: [] } })).status).toBe(403)
    expect((await as('field')(`/api/inspection-reports/templates/${tplId}`, { method: 'DELETE' })).status).toBe(403)
    expect((await as('owner')(`/api/inspection-reports/templates/${tplId}`, { method: 'DELETE' })).status).toBe(204)
    expect((await as('owner')(`/api/inspection-reports/templates/${tplId}`, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('send to the homeowner', () => {
  const send = (id: string, body: any, who = 'owner') => as(who)(`/api/inspection-reports/${id}/send`, { method: 'POST', json: body })
  test('by text: the link is switched on, the shared sender gets the homeowner’s number and the link, and the job’s timeline says so', async () => {
    const fresh = (await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobA } }))).body
    expect(fresh.link).toBeNull()
    expect(fresh.send).toMatchObject({ homeowner: 'Lee Marsh', textBlocked: null, emailBlocked: null, sentAt: null })
    const r = await json(await send(fresh.id, { via: 'sms' }))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ sent: true, via: 'sms', to: '715-555-0101' })
    const token = r.body.link.token
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(texts.at(-1)).toMatchObject({ to: '715-555-0101', jobId: jobA })
    expect(texts.at(-1)!.message).toContain(`/api/inspection-report-view/${token}`)
    expect(texts.at(-1)!.message).toContain('Hi Lee')
    expect(texts.at(-1)!.message).toContain('Ridgeline Roofing')
    expect((await t.call(r.body.link.path)).status).toBe(200)
    const events = (await timelineOf(jobA)).filter((e) => e.type === 'report_sent')
    expect(events).toHaveLength(1)
    expect(events[0].body).toContain('sent to Lee Marsh (715-555-0101) by text')
    const got = await json(await as('owner')(`/api/inspection-reports/${fresh.id}`))
    expect([got.body.send.sentVia, !!got.body.send.sentAt]).toEqual(['sms', true])
    // The record is not a note a person wrote: the Notes card does not list it.
    const job = await json(await as('owner')(`/api/jobs/${jobA}`))
    expect(job.body.notes.some((n: any) => String(n.body).startsWith('Inspection report sent'))).toBe(false)
    ids.sent = fresh.id
  })
  test('a personal note leads the text; an existing link is kept, not renewed', async () => {
    const before = (await json(await as('owner')(`/api/inspection-reports/${ids.sent}`))).body.link.token
    const r = await json(await send(ids.sent, { via: 'sms', message: 'Here is the report we talked about.' }))
    expect(r.body.link.token).toBe(before)
    expect(texts.at(-1)!.message.startsWith('Here is the report we talked about. ')).toBe(true)
  })
  test('a link that ran out is renewed so the homeowner is not sent one that does not open', async () => {
    await t.db.update(t.schema.inspectionReport).set({ linkExpiresAt: new Date(Date.now() - 86_400_000) } as any).where(eq(t.schema.inspectionReport.id, ids.sent))
    const old = (await json(await as('owner')(`/api/inspection-reports/${ids.sent}`))).body.link
    expect((await t.call(old.path)).status).toBe(404)
    const r = await json(await send(ids.sent, { via: 'sms' }))
    expect(r.body.link.token).not.toBe(old.token)
    expect((await t.call(r.body.link.path)).status).toBe(200)
  })
  test('by email: the report’s own message to the homeowner’s address, with the link, recorded on the job', async () => {
    const r = await json(await send(ids.sent, { via: 'email', message: 'Your inspection photos are attached below.' }))
    expect([r.status, r.body.via, r.body.to]).toEqual([200, 'email', 'lee@home.example'])
    expect(mails.at(-1)).toMatchObject({ to: 'lee@home.example', template: 'inspectionReportSent' })
    expect(mails.at(-1)!.data).toMatchObject({ firstName: 'Lee', companyName: 'Ridgeline Roofing', message: 'Your inspection photos are attached below.' })
    expect(mails.at(-1)!.data.reportUrl).toContain(r.body.link.token)
    expect((await timelineOf(jobA)).filter((e) => e.type === 'report_sent').some((e) => e.body.includes('by email'))).toBe(true)
  })
  test('nothing is sent or recorded when the homeowner cannot be reached that way, or the sender refuses', async () => {
    const sentBefore = texts.length, eventsBefore = (await timelineOf(jobA)).filter((e) => e.type === 'report_sent').length
    await t.db.update(t.schema.contact).set({ optedOutSms: true } as any).where(eq(t.schema.contact.id, ids.home))
    const out = await json(await send(ids.sent, { via: 'sms' }))
    expect([out.status, out.body.error]).toEqual([409, 'Lee has opted out of texts.'])
    await t.db.update(t.schema.contact).set({ optedOutSms: false, email: null } as any).where(eq(t.schema.contact.id, ids.home))
    const noMail = await json(await send(ids.sent, { via: 'email' }))
    expect([noMail.status, noMail.body.error]).toEqual([409, 'Lee has no email address on file.'])
    await setFeatures(ON.filter((f) => f !== 'two_way_texting'))
    const off = await json(await send(ids.sent, { via: 'sms' }))
    expect([off.status, off.body.error]).toEqual([409, 'Texting is not switched on for this account.'])
    await setFeatures(ON)
    smsAnswer = { refused: true, errorMessage: 'Your texting balance is empty.' }
    const refused = await json(await send(ids.sent, { via: 'sms' }))
    smsAnswer = { id: 'sms2', status: 'sent' }
    expect([refused.status, refused.body.error]).toEqual([502, 'Your texting balance is empty.'])
    expect(texts.length).toBe(sentBefore + 1) // the refused one reached the sender and nothing else did
    expect((await timelineOf(jobA)).filter((e) => e.type === 'report_sent').length).toBe(eventsBefore)
    await t.db.update(t.schema.contact).set({ email: 'lee@home.example' } as any).where(eq(t.schema.contact.id, ids.home))
    expect((await json(await send(ids.sent, { via: 'carrier-pigeon' }))).status).toBe(400)
  })
  test('sharing is the share permission: a field seat builds reports but cannot send one; a job with no homeowner cannot', async () => {
    expect((await send(ids.sent, { via: 'sms' }, 'field')).status).toBe(403)
    expect((await send(ids.sent, { via: 'sms' }, 'viewer')).status).toBe(403)
    const noOne = await makeJob('9 No Contact Lane')
    await t.db.update(t.schema.job).set({ contactId: null } as any).where(eq(t.schema.job.id, noOne))
    const rep = (await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: noOne, title: 'Empty', sections: [] } }))).body
    expect(rep.send.homeowner).toBeNull()
    expect((await send(rep.id, { via: 'sms' })).status).toBe(409)
  })
  test('the words on the job are in one place: the writer and the reader agree, and a note someone types is still theirs', () => {
    expect(jobEvent(reportSentBody('text', 'Lee Marsh (715-555-0101)', 'Roof inspection'))?.kind).toBe('report_sent')
    expect(jobEvent(reportSavedBody('Roof inspection'))?.text).toBe('Inspection report “Roof inspection” saved to documents')
    expect(jobEvent('Called Lee about the inspection report')).toBeNull()
  })
})

describe('save a copy to documents', () => {
  const copy = (id: string, who = 'owner') => as(who)(`/api/inspection-reports/${id}/copy`, { method: 'POST' })
  test('files a PDF under the job, type Inspection, that later edits to the report do not change', async () => {
    const r = await json(await copy(reportA))
    expect(r.status).toBe(201)
    const docId = r.body.document.id
    const [row] = await t.db.select().from(t.schema.document).where(eq(t.schema.document.id, docId))
    expect(row).toMatchObject({ jobId: jobA, contactId: ids.home, type: 'inspection', mimeType: 'application/pdf', companyId })
    const frozen = Buffer.from(objects.get(row.path)!.body)
    expect(frozen.subarray(0, 5).toString()).toBe('%PDF-')
    const before = pdfText(frozen)
    expect(before).toContain('Roof inspection')
    // Change the report; the filed copy stays as it was, the live PDF follows the change.
    await putReport(reportA, { title: 'Revised: hail and ridge findings' })
    expect(pdfText(new Uint8Array(await (await as('owner')(`/api/inspection-reports/${reportA}/pdf`)).arrayBuffer()))).toContain('Revised: hail and ridge findings')
    expect(Buffer.from(objects.get(row.path)!.body).equals(frozen)).toBe(true)
    expect(pdfText(frozen)).not.toContain('Revised')
    // It is in the job's documents, and downloads as the same bytes.
    const list = await json(await as('owner')(`/api/documents?jobId=${jobA}`))
    expect(JSON.stringify(list.body)).toContain(docId)
    const dl = await as('owner')(`/api/documents/${docId}/download`)
    expect(dl.status).toBe(200)
    expect(Buffer.from(await dl.arrayBuffer()).equals(frozen)).toBe(true)
    ids.doc = docId
  })
  test('the report lists its saved copies, the job’s timeline records the save, and a copy deleted from Documents drops off the list', async () => {
    const got = await json(await as('owner')(`/api/inspection-reports/${reportA}`))
    expect(got.body.copies).toHaveLength(1)
    expect(got.body.copies[0]).toMatchObject({ documentId: ids.doc })
    expect((await timelineOf(jobA)).some((e) => e.type === 'report_saved' && e.body.includes('saved to documents'))).toBe(true)
    await copy(reportA)
    expect((await json(await as('owner')(`/api/inspection-reports/${reportA}`))).body.copies).toHaveLength(2)
    expect((await as('owner')(`/api/documents/${ids.doc}`, { method: 'DELETE' })).status).toBeLessThan(300)
    expect((await json(await as('owner')(`/api/inspection-reports/${reportA}`))).body.copies).toHaveLength(1)
  })
  test('needs Documents switched on and the right to add documents; a seat reaches only its own jobs’ reports', async () => {
    await setFeatures(ON.filter((f) => f !== 'documents'))
    const off = await json(await copy(reportA))
    await setFeatures(ON)
    expect([off.status, off.body.code]).toEqual([409, 'feature_off'])
    expect((await copy(reportA, 'viewer')).status).toBe(403)
    const other = (await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobB } }))).body
    expect((await copy(other.id, 'field')).status).toBe(404)
  })
})

describe('a saved copy is dated by the company’s day', () => {
  test('the document’s name carries the company’s calendar day, not UTC’s', async () => {
    // A zone whose calendar day differs from UTC's right now, whatever the hour: UTC+14 from noon UTC on, UTC-11 before it.
    const zone = new Date().getUTCHours() >= 12 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago'
    const [before] = await t.db.select({ timezone: (t.schema.company as any).timezone }).from(t.schema.company).where(eq(t.schema.company.id, companyId))
    await t.db.update(t.schema.company).set({ timezone: zone } as any).where(eq(t.schema.company.id, companyId))
    try {
      const r = await json(await as('owner')(`/api/inspection-reports/${reportA}/copy`, { method: 'POST' }))
      expect(r.status).toBe(201)
      const companyDay = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      const utcDay = new Date().toISOString().slice(0, 10)
      expect(companyDay).not.toBe(utcDay)
      const [row] = await t.db.select().from(t.schema.document).where(eq(t.schema.document.id, r.body.document.id))
      expect(row.name).toContain(`(${companyDay})`)
      expect(row.name).not.toContain(`(${utcDay})`)
      expect(row.originalName).toContain(companyDay)
    } finally {
      await t.db.update(t.schema.company).set({ timezone: (before as any)?.timezone ?? null } as any).where(eq(t.schema.company.id, companyId))
    }
  })
})
