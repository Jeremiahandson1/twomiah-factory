// Landscaping parity, the crew's phone day — the server's half (the phone's half is tests/mobile/landscaping-*.test.ts).
//
// Row 8: Start / Finish sent late from the phone's queue record the moment they were TAPPED (jobs.ts `tappedAt`), on landscaping.
// Row 9: before- and after-photos. A photo's kind is kept from the phone's queue (POST /api/jobs/:id/photos/file then /saved,
//        `kind`) and from a direct upload; the visit-done message carries the first before-photo then the after-photos; a photo the
//        crew drew on (photo_markup, now landscaping's too) goes in place of its original.
// Fails without the change: the photo routes kept no kind, the message took after-photos only, and /api/photo-markup was roofing's.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq, and } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { messagePhotos, visitEmailHtml } from '../server/data/visitReports.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let crew: string
let crewId: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string

const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'photo_capture', 'visit_reports', 'photo_markup', 'recurring_routes']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list }).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const jpeg = (color: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).jpeg().toBuffer()

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  // The photo store: R2 in production; the harness's in-memory store stands in (the visit-report test does the same).
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: async (key: string) => { await t.store.remove(key) },
  })
  await setFeatures(FEATURES)
  const password = 'Correct-horse-1'
  const u = await ins(t.schema.user, { companyId, email: 'crew@test.example', firstName: 'Cam', lastName: 'Crew', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') })
  crewId = u.id
  crew = await login('crew@test.example', password)
})

async function visit(label: string) {
  const ct = await ins(t.schema.contact, { companyId, name: `${label} Customer`, type: 'client', phone: '+17155550101', email: 'cust@example.com' })
  const j = await ins(t.schema.job, { companyId, number: `JOB-${label}`, title: `Mow ${label}`, status: 'scheduled', contactId: ct.id, assignedToId: crewId, scheduledDate: new Date() })
  return { ct, job: j }
}
/** A photo the way the phone's queue sends it: the file under the save's name, then the save that records it with its kind. */
async function queuedPhoto(jobId: string, name: string, kind?: 'before' | 'after', color = '#2f855a') {
  const fd = new FormData()
  fd.set('photo', new File([await jpeg(color)], 'p.jpg', { type: 'image/jpeg' }))
  fd.set('name', name)
  const file = await as(crew, `/api/jobs/${jobId}/photos/file`, { method: 'POST', body: fd })
  expect(file.status).toBe(201)
  const { url } = await file.json()
  return post(crew, `/api/jobs/${jobId}/photos/saved`, { photos: [url], ...(kind ? { kind } : {}) })
}
const photosOf = (jobId: string) => t.db.select().from(t.schema.jobPhoto).where(eq(t.schema.jobPhoto.jobId, jobId))

describe('row 8: a Start and a Finish sent late keep the tap time', () => {
  test('the visit is started and finished at the moments the crew tapped, not when signal came back', async () => {
    const v = await visit('Late')
    const startedAt = new Date(Date.now() - 2 * 3600_000), finishedAt = new Date(Date.now() - 3600_000)
    expect((await post(crew, `/api/jobs/${v.job.id}/start`, { tappedAt: startedAt.toISOString() })).status).toBe(200)
    expect((await post(crew, `/api/jobs/${v.job.id}/complete`, { tappedAt: finishedAt.toISOString() })).status).toBe(200)
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, v.job.id))
    expect(j.status).toBe('completed')
    expect(new Date(j.completedAt!).getTime()).toBe(finishedAt.getTime())
    // The same Finish sent again by the queue (a lost reply) does not move it.
    expect((await post(crew, `/api/jobs/${v.job.id}/complete`, { tappedAt: new Date().toISOString() })).status).toBe(200)
    const [again] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, v.job.id))
    expect(new Date(again.completedAt!).getTime()).toBe(finishedAt.getTime())
  })
})

describe('row 9: before and after photos', () => {
  test('a photo from the phone’s queue keeps its kind; one with no kind is an ordinary photo; a kind not known is ignored', async () => {
    const v = await visit('Kinds')
    expect((await queuedPhoto(v.job.id, 'save1-0abcd', 'before')).status).toBe(201)
    expect((await queuedPhoto(v.job.id, 'save2-0abcd', 'after')).status).toBe(201)
    expect((await queuedPhoto(v.job.id, 'save3-0abcd')).status).toBe(201)
    const fd = new FormData()
    fd.set('photo', new File([await jpeg('#123')], 'p.jpg', { type: 'image/jpeg' }))
    fd.set('kind', 'sideways')
    expect((await as(crew, `/api/jobs/${v.job.id}/photos`, { method: 'POST', body: fd })).status).toBe(201)
    const kinds = (await photosOf(v.job.id)).map((p: any) => p.photoType ?? 'general').sort()
    expect(kinds).toEqual(['after', 'before', 'general', 'general'])
    // The same save sent twice (a lost reply) is one photo.
    const before = (await photosOf(v.job.id)).length
    const url = (await photosOf(v.job.id)).find((p: any) => p.photoType === 'before')!.url
    expect((await post(crew, `/api/jobs/${v.job.id}/photos/saved`, { photos: [url], kind: 'before' })).status).toBe(200)
    expect((await photosOf(v.job.id)).length).toBe(before)
  })

  test('the office’s read says each photo’s kind', async () => {
    const v = await visit('Read')
    await queuedPhoto(v.job.id, 'save4-0abcd', 'before')
    const r = await (await as(crew, `/api/visit-reports/job/${v.job.id}`)).json()
    expect(r.photos.map((p: any) => p.kind)).toEqual(['before'])
  })

  test('the visit-done text carries the first before-photo, then the after-photos', async () => {
    const v = await visit('Text')
    await queuedPhoto(v.job.id, 'save5-0abcd', 'before', '#a52')
    await queuedPhoto(v.job.id, 'save6-0abcd', 'before', '#a53')
    await queuedPhoto(v.job.id, 'save7-0abcd', 'after', '#2a5')
    expect((await post(crew, `/api/jobs/${v.job.id}/complete`)).status).toBe(200)
    const [text] = await t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.contactId, v.ct.id))
    const media = (text.media as string[]) || []
    expect(media.length).toBe(2)
    expect(media[0]).toContain('save5-0abcd')
    expect(media[1]).toContain('save7-0abcd')
    expect(text.body).toContain('2 photos are attached')
  })

  test('a photo the crew drew on goes in place of its original', async () => {
    const v = await visit('Drawn')
    await queuedPhoto(v.job.id, 'save8-0abcd', 'after')
    const [orig] = await photosOf(v.job.id)
    const r = await as(crew, `/api/photo-markup/${orig.id}`, { method: 'PUT', json: { shapes: [{ kind: 'arrow', x1: 0.9, y1: 0.1, x2: 0.55, y2: 0.45, color: 'blue' }] } })
    expect(r.status).toBe(200)
    const marked = (await photosOf(v.job.id)).find((p: any) => p.sourcePhotoId === orig.id)!
    expect(marked.photoType).toBe('after')
    expect((await post(crew, `/api/jobs/${v.job.id}/complete`)).status).toBe(200)
    const [text] = await t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.contactId, v.ct.id))
    const media = (text.media as string[]) || []
    expect(media.length).toBe(1)
    expect(marked.url.endsWith(media[0])).toBe(true)
  })

  test('drawing on photos is offered to landscaping, still not ready; off, its door is shut', async () => {
    const f = FEATURE_REGISTRY.find((x) => x.id === 'photo_markup')!
    expect(f.templates).toContain('crm-landscaping')
    expect(f.hidden).toBe(true)
    await setFeatures(FEATURES.filter((x) => x !== 'photo_markup'))
    try { expect((await as(crew, '/api/photo-markup/x', { method: 'PUT', json: { shapes: [] } })).status).toBe(403) }
    finally { await setFeatures(FEATURES) }
  })

  test('the picking rule and the email’s labels', () => {
    const p = (id: string, kind: 'before' | 'after') => ({ id, kind })
    expect(messagePhotos([p('b1', 'before'), p('b2', 'before'), p('a1', 'after'), p('a2', 'after'), p('a3', 'after')]).map((x) => x.id)).toEqual(['b1', 'a1', 'a2'])
    expect(messagePhotos([p('b1', 'before'), p('b2', 'before')]).map((x) => x.id)).toEqual(['b1', 'b2'])
    expect(messagePhotos([p('a1', 'after')]).map((x) => x.id)).toEqual(['a1'])
    const html = visitEmailHtml({ companyName: 'Green', firstName: 'Pat', title: 'Mow', day: 'Friday', note: null, photos: 2 }, ['https://x/1', 'https://x/2'], ['before', 'after'])
    expect(html.indexOf('>Before<')).toBeGreaterThan(-1)
    expect(html.indexOf('>Before<')).toBeLessThan(html.indexOf('>After<'))
    expect(html).toContain('alt="Before photo"')
  })
})
