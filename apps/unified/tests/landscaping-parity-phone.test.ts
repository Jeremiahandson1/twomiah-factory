// Landscaping parity, the crew's phone day — the server's half (the phone's half is tests/mobile/landscaping-*.test.ts).
//
// Row 8: Start / Finish sent late from the phone's queue record the moment they were TAPPED (jobs.ts `tappedAt`), on landscaping.
// Row 9: before- and after-photos. A photo's kind is kept from the phone's queue (POST /api/jobs/:id/photos/file then /saved,
//        `kind`) and from a direct upload; the visit-done message carries the first before-photo then the after-photos; a photo the
//        crew drew on (photo_markup, now landscaping's too) goes in place of its original.
// Fails without the change: the photo routes kept no kind, the message took after-photos only, and /api/photo-markup was roofing's.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq, and, ne } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { messagePhotos, visitEmailHtml } from '../server/data/visitReports.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let crew: string
let crewId: string
let owner: string
let other: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string

const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'photo_capture', 'visit_reports', 'photo_markup', 'recurring_routes', 'crew_day_map', 'visit_skip', 'visit_materials', 'crew_timers', 'job_costing', 'reports']
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
  owner = await login('owner@test.example', s.password)
  await ins(t.schema.user, { companyId, email: 'crew2@test.example', firstName: 'Oli', lastName: 'Other', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') })
  other = await login('crew2@test.example', password)
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
    expect(f.hidden).toBeFalsy()
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

// Row 10 (Jobber's 5–60 minute picker): "On my way" says how many minutes away the crew is. Fails without the change: dispatch read
// no etaMinutes and the text always said 15–20 minutes.
describe('row 10: on my way, with the minutes away', () => {
  test('the minutes picked reach the customer’s text; none, or nonsense, keeps the usual words', async () => {
    const { jobUpdateTemplate } = await import('../../../packages/tenant-backend/src/integrations/sms.ts')
    const sent: Array<{ jobId: string; kind: string; eta: number | null | undefined }> = []
    const sms = (t.services as any).crm.sms
    const real = sms.sendJobUpdate
    sms.sendJobUpdate = async (_co: string, jobId: string, kind: string, opts?: { etaMinutes?: number | null }) => { sent.push({ jobId, kind, eta: opts?.etaMinutes }) }
    try {
      const a = await visit('Eta')
      expect((await post(crew, `/api/jobs/${a.job.id}/dispatch`, { etaMinutes: 25, tappedAt: new Date().toISOString() })).status).toBe(200)
      const b = await visit('NoEta')
      expect((await post(crew, `/api/jobs/${b.job.id}/dispatch`, { etaMinutes: 'soon' })).status).toBe(200)
      const c = await visit('Far')
      expect((await post(crew, `/api/jobs/${c.job.id}/dispatch`, { etaMinutes: 900 })).status).toBe(200)
      expect(sent.find((x) => x.jobId === a.job.id)).toEqual({ jobId: a.job.id, kind: 'on_my_way', eta: 25 })
      expect(sent.find((x) => x.jobId === b.job.id)?.eta ?? null).toBeNull()
      expect(sent.find((x) => x.jobId === c.job.id)?.eta ?? null).toBeNull()
      // An "On my way" that waited on the phone more than 30 minutes is recorded but not texted (services.ts stillCurrent).
      const d = await visit('Stale')
      expect((await post(crew, `/api/jobs/${d.job.id}/dispatch`, { etaMinutes: 10, tappedAt: new Date(Date.now() - 45 * 60_000).toISOString() })).status).toBe(200)
      expect(sent.some((x) => x.jobId === d.job.id)).toBe(false)
      const [stale] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, d.job.id))
      expect(stale.status).toBe('dispatched')
    } finally { sms.sendJobUpdate = real }
    expect(jobUpdateTemplate('on_my_way', { etaMinutes: 25 })).toContain('should arrive in about 25 minutes.')
    expect(jobUpdateTemplate('on_my_way', { etaMinutes: 1 })).toContain('about 1 minute.')
    expect(jobUpdateTemplate('on_my_way')).toContain('approximately 15-20 minutes')
    expect(jobUpdateTemplate('nothing')).toBeNull()
  })
})

// Rows 11–15: /api/crew-day (server/crm/landscaping/crewDay.ts, data/crewDay.ts). Each fails without the change: the routes, the
// tables and the switches did not exist.
const today = async () => {
  const { companyTimeZone, storeDayRange } = await import('@twomiah/tenant-backend')
  return storeDayRange(await companyTimeZone(t.db, companyId)).date
}
async function stop(label: string, time: string, extra: Record<string, any> = {}) {
  const ct = await ins(t.schema.contact, { companyId, name: `${label} Home`, type: 'client', phone: '+17155550111' })
  const j = await ins(t.schema.job, { companyId, number: `RT-${label}`, title: `Mow ${label}`, status: 'scheduled', contactId: ct.id, assignedToId: crewId, scheduledDate: new Date(`${await today()}T00:00:00.000Z`), scheduledTime: time, address: `${label} Elm St`, city: 'Eau Claire', state: 'WI', estimatedHours: '1.00', ...extra })
  return { ct, job: j }
}

describe('rows 11 and 14: the day on a map, and Finish Day', () => {
  test('the crew’s stops in route order, numbered, the next marked; another crew’s visit is not theirs', async () => {
    const b = await stop('Second', '10:00'), a = await stop('First', '08:00'), c = await stop('Third', '13:00')
    await stop('Theirs', '09:00', { assignedToId: null })
    expect((await post(crew, `/api/jobs/${a.job.id}/complete`)).status).toBe(200)
    const r = await as(crew, '/api/crew-day/day')
    expect(r.status).toBe(200)
    const day = await r.json()
    const mine = day.stops.filter((s: any) => [a.job.id, b.job.id, c.job.id].includes(s.id))
    expect(mine.map((s: any) => s.id)).toEqual([a.job.id, b.job.id, c.job.id])
    expect(day.stops.some((s: any) => s.name === 'Theirs Home')).toBe(false)
    expect(day.nextId).toBe(day.stops.find((s: any) => s.status !== 'completed').id)
    expect(day.stops.find((s: any) => s.id === a.job.id).place).toContain('Eau Claire')
    expect(day.recap.stops).toBe(day.stops.length)
    expect(day.recap.done).toBeGreaterThanOrEqual(1)
    // Visit-done messages are on: a finished visit with no note for the customer is a note still owed.
    expect(day.recap.notesOutstanding.map((n: any) => n.id)).toContain(a.job.id)
  })

  test('the map is Google’s picture of the stops, numbered and coloured, drawn with the server’s key; with no key it says so', async () => {
    const before = process.env.GOOGLE_MAPS_API_KEY
    delete process.env.GOOGLE_MAPS_API_KEY
    try {
      const none = await as(crew, '/api/crew-day/day/map')
      expect(none.status).toBe(409)
      expect((await none.json()).error).toMatch(/not set up/)
      expect((await (await as(crew, '/api/crew-day/day')).json()).mapReady).toBe(false)
      process.env.GOOGLE_MAPS_API_KEY = 'srv-key'
      const real = globalThis.fetch
      const asked: string[] = []
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer()
      globalThis.fetch = (async (input: any, init?: any) => { const u = String(input?.url ?? input); if (u.includes('maps.googleapis.com/maps/api/staticmap')) { asked.push(u); return new Response(png, { headers: { 'content-type': 'image/png' } }) } return real(input, init) }) as any
      try {
        const r = await as(crew, '/api/crew-day/day/map')
        expect(r.status).toBe(200)
        expect(r.headers.get('content-type')).toBe('image/png')
        const url = decodeURIComponent(asked[0])
        expect(url).toContain('label:1|')
        expect(url).toContain('color:green')
        expect(url).toContain('color:orange')
        expect(url).toContain('Eau Claire')
      } finally { globalThis.fetch = real }
    } finally { if (before === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = before }
  })

  test('switched off, the day is not there; the four switches are landscaping’s and not ready', async () => {
    await setFeatures(FEATURES.filter((f) => f !== 'crew_day_map'))
    try { expect((await as(crew, '/api/crew-day/day')).status).toBe(403) } finally { await setFeatures(FEATURES) }
    for (const id of ['crew_day_map', 'visit_skip', 'visit_materials', 'crew_timers']) {
      const f = FEATURE_REGISTRY.find((x) => x.id === id)!
      expect([!!f.hidden, f.templates]).toEqual([false, ['crm-landscaping']])
    }
    expect(FEATURE_REGISTRY.find((x) => x.id === 'job_checklists')!.templates).toContain('crm-landscaping')
  })
})

describe('row 12: couldn’t do it', () => {
  test('a reason and a rebook flag put the visit on hold, once; the office rebooks it to a day', async () => {
    const v = await stop('Gate', '11:00')
    const at = new Date(Date.now() - 20 * 60_000).toISOString()
    const r = await post(crew, `/api/crew-day/visits/${v.job.id}/skip`, { reason: 'locked_gate', note: 'Code did not work', rebook: true, tappedAt: at })
    expect(r.status).toBe(201)
    const first = await r.json()
    const again = await post(crew, `/api/crew-day/visits/${v.job.id}/skip`, { reason: 'locked_gate', rebook: true, tappedAt: at })
    expect(again.status).toBe(200)
    expect((await again.json()).id).toBe(first.id)
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, v.job.id))
    expect(j.status).toBe('on_hold')
    const [sk] = await t.db.select().from(t.schema.visitSkip).where(eq(t.schema.visitSkip.jobId, v.job.id))
    expect(new Date(sk.skippedAt).toISOString()).toBe(at)
    // The crew seat does not run the office's list; the owner does.
    expect((await as(crew, '/api/crew-day/skips')).status).toBe(403)
    const list = (await (await as(owner, '/api/crew-day/skips')).json()).data
    const row = list.find((x: any) => x.jobId === v.job.id)
    expect(row).toMatchObject({ reasonLabel: 'Locked gate', note: 'Code did not work', rebook: true, by: 'Cam Crew' })
    const d = new Date(Date.parse(`${await today()}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10)
    expect((await post(owner, `/api/crew-day/skips/${row.id}/rebook`, {})).status).toBe(400)
    expect((await post(owner, `/api/crew-day/skips/${row.id}/rebook`, { date: d })).status).toBe(200)
    const [moved] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, v.job.id))
    expect(moved.status).toBe('scheduled')
    expect(new Date(moved.scheduledDate!).toISOString().slice(0, 10)).toBe(d)
    expect((await post(owner, `/api/crew-day/skips/${row.id}/close`)).status).toBe(409)
    expect((await (await as(owner, '/api/crew-day/skips')).json()).data.some((x: any) => x.id === row.id)).toBe(false)
  })

  test('closing a skip cancels the visit; a finished visit cannot be skipped; a reason is required; another crew’s visit is not found', async () => {
    const v = await stop('Rain', '12:00')
    expect((await post(crew, `/api/crew-day/visits/${v.job.id}/skip`, { rebook: false })).status).toBe(400)
    expect((await post(crew, `/api/crew-day/visits/${v.job.id}/skip`, { reason: 'weather', rebook: false })).status).toBe(201)
    const id = (await (await as(owner, '/api/crew-day/skips')).json()).data.find((x: any) => x.jobId === v.job.id).id
    expect((await post(owner, `/api/crew-day/skips/${id}/close`)).status).toBe(200)
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, v.job.id))
    expect(j.status).toBe('cancelled')
    const f = await stop('Fin', '15:00')
    expect((await post(crew, `/api/jobs/${f.job.id}/complete`)).status).toBe(200)
    expect((await post(crew, `/api/crew-day/visits/${f.job.id}/skip`, { reason: 'weather' })).status).toBe(409)
    const theirs = await stop('Theirs2', '16:00', { assignedToId: null })
    expect((await post(other, `/api/crew-day/visits/${theirs.job.id}/skip`, { reason: 'weather' })).status).toBe(404)
  })
})

describe('row 13: materials used, counted in the job’s cost', () => {
  test('from the price book (its cost) and typed in; a save sent twice is one line; job costing counts them', async () => {
    const v = await stop('Mulch', '14:00')
    const item = await ins(t.schema.pricebookItem, { companyId, name: 'Hardwood mulch', type: 'material', price: '45.00', cost: '28.50', unit: 'yard' })
    const a = await post(crew, `/api/crew-day/visits/${v.job.id}/materials`, { pricebookItemId: item.id, quantity: 2, entryKey: 'save1-mat' })
    expect(a.status).toBe(201)
    expect(await a.json()).toMatchObject({ name: 'Hardwood mulch', quantity: 2, unit: 'yard' })
    expect((await post(crew, `/api/crew-day/visits/${v.job.id}/materials`, { pricebookItemId: item.id, quantity: 2, entryKey: 'save1-mat' })).status).toBe(200)
    expect((await post(crew, `/api/crew-day/visits/${v.job.id}/materials`, { name: 'Edging stakes', quantity: 12, unit: 'each' })).status).toBe(201)
    expect((await post(crew, `/api/crew-day/visits/${v.job.id}/materials`, { quantity: 1 })).status).toBe(400)
    expect((await post(crew, `/api/crew-day/visits/${v.job.id}/materials`, { name: 'x', quantity: -1 })).status).toBe(400)
    const list = (await (await as(crew, `/api/crew-day/visits/${v.job.id}/materials`)).json()).data
    expect(list.map((l: any) => l.name)).toEqual(['Hardwood mulch', 'Edging stakes'])
    const cost = await (await as(owner, `/api/job-costing/job/${v.job.id}`)).json()
    expect(cost.actual.materialCost).toBe(57)
    // A line taken off comes off the cost.
    expect((await as(crew, `/api/crew-day/visits/${v.job.id}/materials/${list[0].id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await (await as(owner, `/api/job-costing/job/${v.job.id}`)).json()).actual.materialCost).toBe(0)
  })
})

describe('row 15: each person’s clock, and the Crew Score', () => {
  test('the crew lead clocks each person on the visit, at the tapped time; the Crew Score reads budget against man-hours', async () => {
    const member = await ins(t.schema.teamMember, { companyId, name: 'Ray Roster' })
    const v = await stop('Crew', '07:00', { estimatedHours: '2.00' })
    await ins(t.schema.jobAssignee, { companyId, jobId: v.job.id, memberId: member.id, position: 1 })
    const people = (await (await as(crew, `/api/crew-day/visits/${v.job.id}/crew`)).json()).data
    expect(people.map((p: any) => p.name)).toEqual(['Cam Crew', 'Ray Roster'])
    const t0 = Date.now() - 3 * 3600_000
    const at = (h: number) => new Date(t0 + h * 3600_000).toISOString()
    for (const p of people) {
      expect((await post(crew, `/api/crew-day/visits/${v.job.id}/crew/${encodeURIComponent(p.key)}/start`, { tappedAt: at(0) })).status).toBe(200)
      // Started again (the queue sends twice): no second clock.
      expect((await (await post(crew, `/api/crew-day/visits/${v.job.id}/crew/${encodeURIComponent(p.key)}/start`, { tappedAt: at(0.5) })).json()).changed).toBe(false)
      expect((await post(crew, `/api/crew-day/visits/${v.job.id}/crew/${encodeURIComponent(p.key)}/stop`, { tappedAt: at(1.25) })).status).toBe(200)
    }
    const after = (await (await as(crew, `/api/crew-day/visits/${v.job.id}/crew`)).json()).data
    expect(after.map((p: any) => [p.running, p.hours])).toEqual([[false, 1.25], [false, 1.25]])
    expect((await post(crew, `/api/crew-day/visits/${v.job.id}/crew/nobody/start`, {})).status).toBe(404)
    expect((await post(crew, `/api/jobs/${v.job.id}/complete`)).status).toBe(200)
    const { crewHoursOf, crewScore } = await import('../server/data/crewDay.ts')
    expect(Math.round((await crewHoursOf(t.db, companyId, [v.job.id])).get(v.job.id)! * 100) / 100).toBe(2.5)
    const day = await today()
    expect((await as(crew, `/api/crew-day/score?from=${day}&to=${day}`)).status).toBe(403)
    const score = (await (await as(owner, `/api/crew-day/score?from=${day}&to=${day}`)).json()).data
    const cam = score.find((r: any) => r.lead === 'Cam Crew')
    expect(cam.visits).toBeGreaterThanOrEqual(1)
    expect(cam.score).not.toBeNull()
    // This visit alone: 2 h allowed against 2.5 man-hours is 80.
    const { companyTimeZone } = await import('@twomiah/tenant-backend')
    await t.db.update(t.schema.job).set({ status: 'cancelled' }).where(and(eq(t.schema.job.companyId, companyId), eq(t.schema.job.status, 'completed'), ne(t.schema.job.id, v.job.id)))
    const alone = (await crewScore(t.db, companyId, day, day, await companyTimeZone(t.db, companyId))).find((r: any) => r.lead === 'Cam Crew')!
    expect([alone.visits, alone.budgetHours, alone.actualHours, alone.score]).toEqual([1, 2, 2.5, 80])
    expect((await as(owner, '/api/crew-day/score?from=2026-12-01&to=2026-11-01')).status).toBe(400)
  })
})
