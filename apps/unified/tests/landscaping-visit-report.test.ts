// Landscaping gap 6: the visit-done message (data/visitReports.ts, crm/landscaping/visitReports.ts, the portal's Visits section).
// Fails without it: /api/visit-reports does not exist, finishing a job tells nobody, and the portal has no /visits.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq, and } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { sendVisitReport, visitMessage } from '../server/data/visitReports.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let owner: string
let crew: string
let crewId: string
let other: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const put = (token: string, path: string, json: any = {}) => as(token, path, { method: 'PUT', json })

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
async function seat(email: string) {
  const password = 'Correct-horse-1'
  const u = await ins(t.schema.user, { companyId, email, firstName: email.split('@')[0], lastName: 'Seat', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') })
  return { token: await login(email, password), id: u.id as string }
}

const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'photo_capture', 'client_portal', 'visit_reports']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list }).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  // The photo store: R2 in production, never reached from a test; the harness's in-memory store stands in.
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: async (key: string) => { await t.store.remove(key) },
  })
  await setFeatures(FEATURES)
  owner = await login('owner@test.example', s.password)
  const a = await seat('crew@test.example'); crew = a.token; crewId = a.id
  other = (await seat('crew2@test.example')).token
})

const photoBytes = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#2f855a' } }).jpeg().toBuffer()

/** A customer, and a job for them led by the crew seat. */
async function visit(label: string, contact: Record<string, any> = { phone: '+17155550101', email: 'cust@example.com' }) {
  const ct = await ins(t.schema.contact, { companyId, name: `${label} Customer`, type: 'client', ...contact })
  const j = await ins(t.schema.job, { companyId, number: `JOB-${label}`, title: `Mow — ${label}`, status: 'scheduled', contactId: ct.id, assignedToId: crewId, scheduledDate: new Date() })
  return { ct, job: j }
}
async function afterPhoto(token: string, jobId: string) {
  const fd = new FormData()
  fd.set('photo', new File([await photoBytes()], 'after.jpg', { type: 'image/jpeg' }))
  return as(token, `/api/visit-reports/job/${jobId}/photos`, { method: 'POST', body: fd })
}
const complete = (token: string, jobId: string) => post(token, `/api/jobs/${jobId}/complete`)
const textsFor = (contactId: string) => t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.contactId, contactId))
const reportOf = async (jobId: string) => (await t.db.select().from(t.schema.visitReport).where(eq(t.schema.visitReport.jobId, jobId)))[0]

describe('finishing a visit tells the customer', () => {
  test('a text is queued with the crew note and the after-photo, from the business number; one report per job even if finished twice', async () => {
    const v = await visit('A')
    expect((await put(crew, `/api/visit-reports/job/${v.job.id}`, { note: 'Edged the beds and bagged the clippings.' })).status).toBe(200)
    const up = await afterPhoto(crew, v.job.id)
    expect(up.status).toBe(201)
    const photo = await up.json()
    expect(photo.after).toBe(true)

    expect((await complete(crew, v.job.id)).status).toBe(200)
    const texts = await textsFor(v.ct.id)
    expect(texts.length).toBe(1)
    expect(texts[0].toPhone).toBe('+17155550101')
    expect(texts[0].body).toContain('finished Mow — A')
    expect(texts[0].body).toContain('Edged the beds and bagged the clippings.')
    expect((texts[0].media as string[]).length).toBe(1)
    expect((texts[0].media as string[])[0]).toContain(`photos/${companyId}/${v.job.id}/`)
    expect(new Date(texts[0].sendAt).getTime()).toBeGreaterThan(Date.now() - 1000)
    const r = await reportOf(v.job.id)
    expect(r.status).toBe('queued')
    expect(r.channel).toBe('text')
    expect(r.photoCount).toBe(1)

    // Reopened and finished again: still one message.
    await post(owner, `/api/jobs/${v.job.id}/start`)
    await complete(owner, v.job.id)
    expect((await textsFor(v.ct.id)).length).toBe(1)
    const direct = await sendVisitReport(t.db, { pictureUrl: () => null, sendEmail: async () => {} }, companyId, v.job.id)
    expect(direct.status).toBe('already')
  })

  test('a business without the feature is not messaged, and nothing is recorded', async () => {
    const v = await visit('B')
    await setFeatures(FEATURES.filter((f) => f !== 'visit_reports'))
    try {
      expect((await complete(crew, v.job.id)).status).toBe(200)
      expect((await textsFor(v.ct.id)).length).toBe(0)
      expect(await reportOf(v.job.id)).toBeUndefined()
      // And its door is shut.
      expect((await as(owner, '/api/visit-reports')).status).toBe(403)
    } finally { await setFeatures(FEATURES) }
  })

  test('a customer who opted out of texts gets an email instead; with neither they are listed as unreachable; the office can switch a visit off', async () => {
    const v = await visit('C', { phone: '+17155550102', email: 'c@example.com', optedOutSms: true })
    const sent: any[] = []
    await t.db.update(t.schema.job).set({ status: 'completed', completedAt: new Date() }).where(eq(t.schema.job.id, v.job.id))
    await put(crew, `/api/visit-reports/job/${v.job.id}`, { note: 'Gate left <open> & latched.' })
    const r = await sendVisitReport(t.db, { pictureUrl: () => null, sendEmail: async (m) => { sent.push(m) } }, companyId, v.job.id)
    expect(r.status).toBe('sent')
    expect((r as any).channel).toBe('email')
    expect(sent.length).toBe(1)
    expect(sent[0].to).toBe('c@example.com')
    expect(sent[0].html).toContain('Gate left &lt;open&gt; &amp; latched.')
    expect((await textsFor(v.ct.id)).length).toBe(0)

    const n = await visit('D', { phone: null, email: null })
    await t.db.update(t.schema.job).set({ status: 'completed', completedAt: new Date() }).where(eq(t.schema.job.id, n.job.id))
    const none = await sendVisitReport(t.db, { pictureUrl: () => null, sendEmail: async () => {} }, companyId, n.job.id)
    expect(none.status).toBe('nothing')
    expect((await reportOf(n.job.id)).status).toBe('nothing')

    const s = await visit('E')
    expect((await put(crew, `/api/visit-reports/job/${s.job.id}`, { skip: true })).status).toBe(403) // the office's call
    expect((await put(owner, `/api/visit-reports/job/${s.job.id}`, { skip: true })).status).toBe(200)
    await complete(crew, s.job.id)
    expect((await textsFor(s.ct.id)).length).toBe(0)
    expect((await reportOf(s.job.id)).status).toBe('draft')
  })

  test('only after-photos go; an unmarked photo stays out; a crew seat works only its own visits', async () => {
    const v = await visit('F')
    const up = await (await afterPhoto(crew, v.job.id)).json()
    await put(crew, `/api/visit-reports/job/${v.job.id}/photos/${up.id}`, { after: false })
    await complete(crew, v.job.id)
    const texts = await textsFor(v.ct.id)
    expect(texts.length).toBe(1)
    expect(texts[0].media).toBeNull()

    expect((await put(other, `/api/visit-reports/job/${v.job.id}`, { note: 'hi' })).status).toBe(403)
    expect((await afterPhoto(other, v.job.id)).status).toBe(403)
    expect((await as(other, `/api/visit-reports/job/${v.job.id}`)).status).toBe(403)
    expect((await post(crew, `/api/visit-reports/job/${v.job.id}/send`)).status).toBe(403) // sending again is the office's
    expect((await put(crew, `/api/visit-reports/job/${v.job.id}`, { note: 'x'.repeat(1001) })).status).toBe(400)
    // The crew's list holds only its own visits.
    const list = await (await as(other, '/api/visit-reports')).json()
    expect(list.data.some((x: any) => x.jobId === v.job.id)).toBe(false)
    expect((await (await as(crew, '/api/visit-reports')).json()).data.some((x: any) => x.jobId === v.job.id)).toBe(true)
  })

  test('the message reads plainly', () => {
    const m = visitMessage({ companyName: 'Green Co', firstName: 'Sam', title: 'Mow — Elm', day: 'Friday, June 5', note: 'All done.', photos: 2 })
    expect(m.text).toBe('Hi Sam, Green Co finished Mow — Elm on Friday, June 5. All done. 2 photos are attached.')
  })
})

describe('the portal shows it', () => {
  test("a customer sees their own finished visits with note and photos; another customer does not; the photo link opens; off means 404", async () => {
    const v = await visit('G')
    const mine = 'a'.repeat(64), theirs = 'b'.repeat(64)
    const soon = new Date(Date.now() + 86_400_000)
    await t.db.update(t.schema.contact).set({ portalEnabled: true, portalToken: mine, portalTokenExp: soon }).where(eq(t.schema.contact.id, v.ct.id))
    const stranger = await ins(t.schema.contact, { companyId, name: 'Stranger', type: 'client', email: 's@example.com', portalEnabled: true, portalToken: theirs, portalTokenExp: soon })
    await put(crew, `/api/visit-reports/job/${v.job.id}`, { note: 'Trimmed the hedge.' })
    await afterPhoto(crew, v.job.id)
    await complete(crew, v.job.id)

    const home = await (await t.call(`/api/portal/p/${mine}`)).json()
    expect(home.sections.visits).toBe(true)
    const rows = await (await t.call(`/api/portal/p/${mine}/visits`)).json()
    expect(rows.length).toBe(1)
    expect(rows[0].note).toBe('Trimmed the hedge.')
    expect(rows[0].photos.length).toBe(1)
    const pic = await t.call(rows[0].photos[0].url)
    expect(pic.status).toBe(200)
    expect(pic.headers.get('content-type')).toContain('image/')
    expect((await (await t.call(`/api/portal/p/${theirs}/visits`)).json()).length).toBe(0)
    expect(stranger.id).not.toBe(v.ct.id)

    await setFeatures(FEATURES.filter((f) => f !== 'visit_reports'))
    try {
      expect((await t.call(`/api/portal/p/${mine}/visits`)).status).toBe(404)
      expect((await (await t.call(`/api/portal/p/${mine}`)).json()).sections.visits).toBe(false)
    } finally { await setFeatures(FEATURES) }
    // A skipped visit is not shown either.
    await put(owner, `/api/visit-reports/job/${v.job.id}`, { skip: true })
    expect((await (await t.call(`/api/portal/p/${mine}/visits`)).json()).length).toBe(0)
  })
})
