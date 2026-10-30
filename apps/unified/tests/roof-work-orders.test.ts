// Work orders for crews and subs (docs/parity/roof-work-orders.md; roofing depth, gap 5), through the real server as the
// roofing vertical:
//   · the office makes a work order for a job — scope, address, start date, the material list (without prices) and some of
//     the job's photos — and texts it to the crew or sub as a private link, through the shared sender;
//   · the crew opens the link with no sign-in and accepts, rejects or completes it, with photos, and every step is a note
//     on the job and a photo on the job;
//   · the link is unguessable (64 hex), runs out, answers for its own work order only and for no other record, and shows
//     the crew neither a price nor the homeowner's contact;
//   · a seat without jobs:dispatch cannot make, send, change or cancel one; a Field seat not on the job cannot see it;
//   · the feature is not ready: with it off, neither the office's door nor the link is there.
// Nothing here sends a text or reaches a real tenant.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { getFeaturesForTemplate } from '@twomiah/tenant-backend'
import { linkExpiry } from '../server/crm/roof/workOrders.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const FEATURES = ['jobs', 'contacts', 'photo_capture', 'materials', 'crews', 'roof_material_list', 'roof_work_orders', 'two_way_texting']
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')
const texts: Array<{ to: string; message: string; jobId?: string }> = []
let smsAnswer: any = { success: true }
const saved: Record<string, string | undefined> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })
const call = async (who: string, method: string, p: string, body?: unknown) => json(await as(who)(p, { method, ...(body === undefined ? {} : { json: body }) }))
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
/** The crew's side: no Authorization header at all. */
const link = async (token: string, path = '', method = 'GET', body?: unknown) =>
  json(await t.call(`/api/crew-link/${token}${path}`, { method, ...(body === undefined ? {} : { json: body }) }))
const upload = (token: string, bytes: Buffer, type = 'image/png', photoType?: string) => {
  const form = new FormData()
  form.set('photo', new File([new Uint8Array(bytes)], 'p.png', { type }))
  if (photoType) form.set('photoType', photoType)
  return t.call(`/api/crew-link/${token}/photos`, { method: 'POST', body: form })
}
const row = async (id: string) => (await t.db.select().from(t.schema.workOrder).where(eq(t.schema.workOrder.id, id)))[0]
const notes = async (jobId: string) => (await t.db.select().from(t.schema.jobNote).where(and(eq(t.schema.jobNote.jobId, jobId), eq(t.schema.jobNote.companyId, companyId)))).map((n: any) => n.body as string)

beforeAll(async () => {
  saved.FRONTEND_URL = process.env.FRONTEND_URL
  process.env.FRONTEND_URL = 'https://app.roofer.example'
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES, name: 'Summit Roofing', phone: '715-555-0100' } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  // The photo store is a map: R2 is never reached from a test.
  const storage = (t.services as any).crm.storage
  const objects = new Map<string, { body: Buffer; contentType: string }>()
  storage.storageConfigured = () => true
  storage.put = async (key: string, body: Buffer, contentType: string) => { objects.set(key, { body, contentType }) }
  storage.getObject = async (key: string) => objects.get(key) ?? null
  storage.deleteFile = async (key: string) => { objects.delete(key) }
  ;(t.services as any).crm.sms.sendSMS = async (_co: string, args: any) => { texts.push({ to: args.toPhone, message: args.message, jobId: args.jobId }); return smsAnswer }
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['mgr', 'manager'], ['rep', 'field'], ['view', 'viewer']] as const) {
    const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId })
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  ids.home = (await ins(t.schema.contact, { companyId, name: 'Lee Marsh', mobile: '715-555-0199', email: 'lee@home.example', type: 'client' })).id
  ids.crew = (await ins(t.schema.crew, { companyId, name: 'Roof Crew A', foremanName: 'Dale Foreman', foremanPhone: '715-555-0123', size: 4 })).id
  const mk = await call('owner', 'POST', '/api/jobs', { contactId: ids.home, jobType: 'retail', propertyAddress: '12 Gable Ln', city: 'Akron', state: 'OH', zip: '44301', totalSquares: 30 })
  ids.job = mk.body.id
  ids.otherJob = (await call('owner', 'POST', '/api/jobs', { contactId: ids.home, jobType: 'retail', propertyAddress: '99 Other St', city: 'Akron', state: 'OH', zip: '44301' })).body.id
  // A material order WITH prices, and photos on both jobs.
  ids.order = (await ins(t.schema.material, { companyId, jobId: ids.job, supplier: 'ABC Supply', totalCost: '5000.00',
    lineItems: [{ description: 'Shingles', qty: 99, unit: 'bundle', unitPrice: 40, total: 3960 }, { description: 'Drip edge', qty: 28, unit: 'piece', unitPrice: 8, total: 224 }] })).id
  const photo = async (jobId: string) => {
    const form = new FormData(); form.set('photo', new File([PNG], 'p.png', { type: 'image/png' })); form.set('photoType', 'damage')
    const r = await json(await as('owner')(`/api/jobs/${jobId}/photos`, { method: 'POST', body: form }))
    expect(r.status).toBe(201)
    return r.body.id as string
  }
  ids.photoShared = await photo(ids.job)
  ids.photoPrivate = await photo(ids.job) // on the job, not shared with the crew
  ids.photoOtherJob = await photo(ids.otherJob)
}, 120_000)

afterAll(() => { if (saved.FRONTEND_URL === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = saved.FRONTEND_URL })

/** A work order made and sent, the way the office does it; returns its id and the crew's token. */
async function sentOrder(extra: Record<string, unknown> = {}) {
  const made = await call('mgr', 'POST', '/api/work-orders', { jobId: ids.job, crewId: ids.crew, title: 'Tear off and re-roof', scope: 'Tear off to the deck, replace as per the list.', startDate: '2026-11-09', materialOrderId: ids.order, photoIds: [ids.photoShared], ...extra })
  expect(made.status).toBe(201)
  const sent = await call('mgr', 'POST', `/api/work-orders/${made.body.id}/send`)
  expect(sent.status).toBe(200)
  const token = String(sent.body.linkUrl).split('/w/')[1]
  return { id: made.body.id as string, token }
}

describe('the office makes and sends a work order', () => {
  test('a draft carries the scope, address, start date, the material list without prices and the shared photos', async () => {
    expect(getFeaturesForTemplate('crm-roof').find((f: any) => f.id === 'roof_work_orders')?.hidden).toBe(true)
    const made = await call('mgr', 'POST', '/api/work-orders', { jobId: ids.job, crewId: ids.crew, title: 'Tear off and re-roof', scope: 'Tear off to the deck.', startDate: '2026-11-09', materialOrderId: ids.order, materialLines: [{ description: 'Pipe boots', qty: 4, unit: 'each' }], photoIds: [ids.photoShared] })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ status: 'draft', address: '12 Gable Ln, Akron, OH, 44301', recipientName: expect.stringContaining('Dale Foreman'), recipientPhone: '715-555-0123', photoIds: [ids.photoShared], crewId: ids.crew })
    expect(made.body.materialLines).toEqual([{ description: 'Shingles', qty: 99, unit: 'bundle' }, { description: 'Drip edge', qty: 28, unit: 'piece' }, { description: 'Pipe boots', qty: 4, unit: 'each' }])
    expect(JSON.stringify(made.body.materialLines)).not.toMatch(/price|total|cost/i)
    expect(new Date(made.body.startDate).toISOString()).toContain('2026-11-09')
    expect(made.body.publicToken).toBeUndefined()
    ids.draft = made.body.id
  })

  test('a list made by the material list calculator can be the work order\'s materials', async () => {
    const order = await call('mgr', 'POST', `/api/material-list/jobs/${ids.job}/order`, { supplier: 'ABC Supply', lines: [{ description: 'Shingles', qty: 99, unit: 'bundle' }] })
    expect(order.status).toBe(201)
    const wo = await call('mgr', 'POST', '/api/work-orders', { jobId: ids.job, recipientName: 'Sub Co', recipientPhone: '(715) 555-0111', title: 'Roof', materialOrderId: order.body.id })
    expect([wo.status, wo.body.materialLines]).toEqual([201, [{ description: 'Shingles', qty: 99, unit: 'bundle' }]])
  })

  test('it must say who it is for, and name only this job\'s own records', async () => {
    expect((await call('mgr', 'POST', '/api/work-orders', { jobId: ids.job, title: 'No one' })).status).toBe(400)
    expect((await call('mgr', 'POST', '/api/work-orders', { jobId: ids.job, title: 'Bad phone', recipientName: 'A', recipientPhone: 'abcdefghij' })).status).toBe(400)
    expect((await call('mgr', 'POST', '/api/work-orders', { jobId: 'nope', crewId: ids.crew, title: 'x' })).status).toBe(404)
    expect((await call('mgr', 'POST', '/api/work-orders', { jobId: ids.otherJob, crewId: ids.crew, title: 'x', materialOrderId: ids.order })).status).toBe(404) // another job's material order
    expect((await call('mgr', 'POST', '/api/work-orders', { jobId: ids.job, crewId: ids.crew, title: 'x', photoIds: [ids.photoOtherJob] })).status).toBe(400) // another job's photo
    expect((await call('mgr', 'POST', '/api/work-orders', { jobId: ids.job, crewId: ids.crew, title: 'x', startDate: 'soon' })).status).toBe(400)
  })

  test('sending texts the private link through the shared sender, notes the job, and keeps the link for the office only', async () => {
    texts.length = 0
    const sent = await call('mgr', 'POST', `/api/work-orders/${ids.draft}/send`)
    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ status: 'sent', texted: true })
    expect(sent.body.linkUrl).toMatch(/^https:\/\/app\.roofer\.example\/w\/[0-9a-f]{64}$/)
    expect(texts).toHaveLength(1)
    expect(texts[0].to).toBe('715-555-0123')
    expect(texts[0].message).toContain(sent.body.linkUrl)
    expect(texts[0].message).toContain('Summit Roofing')
    expect(texts[0].message).toContain('12 Gable Ln')
    expect(await notes(ids.job)).toContain('Work order "Tear off and re-roof" texted to Dale Foreman (Roof Crew A).')
    // The link is a credential: the office sees it, the read-only seat does not.
    expect((await call('view', 'GET', `/api/work-orders/${ids.draft}`)).body.linkUrl).toBeUndefined()
    expect((await call('view', 'GET', `/api/work-orders?jobId=${ids.job}`)).body.data.every((w: any) => w.linkUrl === undefined)).toBe(true)
    expect((await call('mgr', 'GET', `/api/work-orders/${ids.draft}`)).body.linkUrl).toBe(sent.body.linkUrl)
    // A resend reminds on the same link.
    const again = await call('mgr', 'POST', `/api/work-orders/${ids.draft}/send`)
    expect([again.body.linkUrl, texts]).toEqual([sent.body.linkUrl, expect.any(Array)])
    expect(texts).toHaveLength(2)
  })

  test('when the text cannot go, or texting is off, the order is still ready and the office is told to send the link', async () => {
    smsAnswer = { refused: true, errorMessage: 'This number has opted out of texts.' }
    const refused = await sentOrder()
    expect(refused.token).toMatch(/^[0-9a-f]{64}$/)
    smsAnswer = { success: true }
    const wo = await call('mgr', 'POST', '/api/work-orders', { jobId: ids.job, crewId: ids.crew, title: 'Refused' })
    smsAnswer = { refused: true, errorMessage: 'This number has opted out of texts.' }
    const r = await call('mgr', 'POST', `/api/work-orders/${wo.body.id}/send`)
    smsAnswer = { success: true }
    expect([r.body.texted, r.body.notice]).toEqual([false, 'This number has opted out of texts.'])
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'two_way_texting') } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    const before = texts.length
    const off = await call('mgr', 'POST', `/api/work-orders/${wo.body.id}/send`)
    expect([off.body.texted, texts.length, off.body.notice]).toEqual([false, before, expect.stringContaining('not switched on')])
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
  })

  test('it can be changed until the crew accepts; then it is cancelled and remade', async () => {
    const { id, token } = await sentOrder()
    expect((await call('mgr', 'PUT', `/api/work-orders/${id}`, { scope: 'Also the garage.' })).body.scope).toBe('Also the garage.')
    expect((await link(token, '/accept', 'POST', { name: 'Dale Foreman' })).status).toBe(200)
    const late = await call('mgr', 'PUT', `/api/work-orders/${id}`, { scope: 'Changed my mind.' })
    expect([late.status, late.body.code]).toEqual([409, 'wrong_status'])
  })
})

describe('the crew\'s link', () => {
  test('opens with no sign-in and shows the work — and no price, no homeowner, no company id', async () => {
    const { id, token } = await sentOrder()
    const r = await link(token)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ title: 'Tear off and re-roof', address: '12 Gable Ln, Akron, OH, 44301', status: 'sent', company: { name: 'Summit Roofing' }, can: { accept: true, reject: true, complete: false } })
    expect(r.body.materials).toEqual([{ description: 'Shingles', qty: 99, unit: 'bundle' }, { description: 'Drip edge', qty: 28, unit: 'piece' }])
    expect(r.body.photos).toHaveLength(1)
    const text = JSON.stringify(r.body)
    for (const secret of ['Lee Marsh', '715-555-0199', 'lee@home.example', 'unitPrice', 'totalCost', 'ABC Supply', companyId, ids.job, ids.home]) expect(text).not.toContain(secret)
    // The shared photo is served by the link; the image itself comes back.
    const img = await t.call(r.body.photos[0].url)
    expect([img.status, img.headers.get('content-type')]).toEqual([200, 'image/png'])
    expect((await row(id)).status).toBe('sent')
  })

  test('a wrong, malformed or unknown token answers the same nothing; an expired one says it has run out', async () => {
    const { id, token } = await sentOrder()
    const unknown = await link('a'.repeat(64))
    const malformed = await link('not-a-token')
    const upper = await link(token.toUpperCase())
    expect([unknown.status, malformed.status, upper.status]).toEqual([404, 404, 404])
    expect(unknown.body).toEqual(malformed.body)
    expect((await link(token, '/accept', 'POST', { name: 'X' })).status).toBe(400)
    await t.db.update(t.schema.workOrder).set({ tokenExpiresAt: new Date(Date.now() - 1000) } as any).where(eq(t.schema.workOrder.id, id))
    const gone = await link(token)
    expect([gone.status, gone.body.code]).toEqual([410, 'link_expired'])
    expect((await link(token, '/accept', 'POST', { name: 'Dale Foreman' })).status).toBe(410)
    expect((await row(id)).status).toBe('sent')
    // The office sends again: a new link, the old one stays dead.
    const resent = await call('mgr', 'POST', `/api/work-orders/${id}/send`)
    const fresh = String(resent.body.linkUrl).split('/w/')[1]
    expect(fresh).not.toBe(token)
    expect([(await link(fresh)).status, (await link(token)).status]).toEqual([200, 404])
  })

  test('the link runs 30 days from the send, and never less than a week past the start', () => {
    const now = new Date('2026-11-01T12:00:00Z')
    expect(linkExpiry(now, null).toISOString()).toBe('2026-12-01T12:00:00.000Z')
    expect(linkExpiry(now, new Date('2026-11-09T00:00:00Z')).toISOString()).toBe('2026-12-01T12:00:00.000Z')
    expect(linkExpiry(now, new Date('2027-02-01T00:00:00Z')).toISOString()).toBe('2027-02-08T00:00:00.000Z')
  })

  test('accept takes a name; then photos, a note and Complete — each a note on the job, the photos on the job', async () => {
    const { id, token } = await sentOrder()
    // Photos wait for the accept.
    expect((await upload(token, PNG)).status).toBe(409)
    expect((await link(token, '/complete', 'POST', {})).status).toBe(409)
    const accepted = await link(token, '/accept', 'POST', { name: 'Dale Foreman' })
    expect([accepted.status, accepted.body.status, accepted.body.respondedByName]).toEqual([200, 'accepted', 'Dale Foreman'])
    expect((await link(token, '/accept', 'POST', { name: 'Dale Foreman' })).status).toBe(409)
    // Photos: an image by its bytes; a page sent as an image is refused; the kind must be one of the list.
    expect((await upload(token, Buffer.from('<html><script>alert(1)</script></html>'))).status).toBe(400)
    expect((await upload(token, PNG, 'image/png', 'banana')).status).toBe(400)
    const one = await json(await upload(token, PNG, 'image/png', 'during'))
    const two = await json(await upload(token, PNG))
    expect([one.status, two.status]).toEqual([201, 201])
    const done = await link(token, '/complete', 'POST', { note: 'All done, cleaned up.' })
    expect([done.status, done.body.status, done.body.completionNote, done.body.completionPhotos.length, done.body.can]).toEqual([200, 'completed', 'All done, cleaned up.', 2, { accept: false, reject: false, photos: false, complete: false }])
    expect((await row(id)).completedAt).not.toBeNull()
    const n = await notes(ids.job)
    expect(n).toContain('Work order "Tear off and re-roof" accepted by Dale Foreman.')
    expect(n.some((b) => b.startsWith('Work order "Tear off and re-roof" completed by Dale Foreman with 2 photos.') && b.includes('All done, cleaned up.'))).toBe(true)
    // The crew's photos are the job's photos.
    const onJob = await call('mgr', 'GET', `/api/jobs/${ids.job}/photos`)
    for (const p of [one.body, two.body]) expect(onJob.body.data.map((x: any) => x.id)).toContain(p.id)
    expect(onJob.body.data.find((x: any) => x.id === one.body.id).photoType).toBe('during')
    // And it is finished: nothing more changes it.
    expect([(await link(token, '/reject', 'POST', { name: 'Dale', reason: 'no' })).status, (await upload(token, PNG)).status, (await link(token, '/accept', 'POST', { name: 'Dale Foreman' })).status]).toEqual([409, 409, 409])
    // The office reads the answer on the work order itself.
    const office = await call('mgr', 'GET', `/api/work-orders?jobId=${ids.job}&status=completed`)
    expect(office.body.data.find((w: any) => w.id === id)).toMatchObject({ status: 'completed', respondedByName: 'Dale Foreman', completionNote: 'All done, cleaned up.' })
  })

  test('reject needs a name and a reason; a rejected order is sent anew and can then be accepted', async () => {
    const { id, token } = await sentOrder()
    expect((await link(token, '/reject', 'POST', { name: 'Dale Foreman' })).status).toBe(400)
    expect((await link(token, '/reject', 'POST', { reason: 'Booked solid' })).status).toBe(400)
    const rej = await link(token, '/reject', 'POST', { name: 'Dale Foreman', reason: 'Booked solid until December.' })
    expect([rej.status, rej.body.status, rej.body.rejectReason]).toEqual([200, 'rejected', 'Booked solid until December.'])
    expect(await notes(ids.job)).toContain('Work order "Tear off and re-roof" rejected by Dale Foreman: Booked solid until December.')
    expect((await link(token, '/accept', 'POST', { name: 'Dale Foreman' })).status).toBe(409) // a rejection is the office's to reopen
    const office = await call('mgr', 'GET', `/api/work-orders/${id}`)
    expect([office.body.status, office.body.rejectReason]).toEqual(['rejected', 'Booked solid until December.'])
    // The office changes the crew and sends it again.
    const other = await ins(t.schema.crew, { companyId, name: 'Sub B', foremanName: 'Sam Sub', foremanPhone: '715-555-0155', size: 3, isSubcontractor: true, subcontractorCompanyName: 'Sub B Roofing' })
    const changed = await call('mgr', 'PUT', `/api/work-orders/${id}`, { crewId: other.id })
    expect([changed.body.status, changed.body.recipientPhone, changed.body.recipientName]).toEqual(['draft', '715-555-0155', 'Sam Sub'])
    const again = await call('mgr', 'POST', `/api/work-orders/${id}/send`)
    expect([again.body.status, again.body.rejectReason]).toEqual(['sent', null])
    expect(texts.at(-1)!.to).toBe('715-555-0155')
    expect((await link(token, '/accept', 'POST', { name: 'Sam Sub' })).status).toBe(200)
  })

  test('a crew that accepted may still turn it down; a cancelled order shows as cancelled and takes no answer', async () => {
    const a = await sentOrder()
    await link(a.token, '/accept', 'POST', { name: 'Dale Foreman' })
    expect((await link(a.token, '/reject', 'POST', { name: 'Dale Foreman', reason: 'Crew down with the flu.' })).body.status).toBe('rejected')
    const b = await sentOrder()
    expect((await call('mgr', 'POST', `/api/work-orders/${b.id}/cancel`)).body.status).toBe('cancelled')
    const seen = await link(b.token)
    expect([seen.status, seen.body.cancelled, seen.body.can]).toEqual([200, true, { accept: false, reject: false, photos: false, complete: false }])
    const r = await link(b.token, '/accept', 'POST', { name: 'Dale Foreman' })
    expect([r.status, r.body.error]).toEqual([409, 'The office cancelled this work order.'])
    expect((await call('mgr', 'POST', `/api/work-orders/${b.id}/send`)).status).toBe(409)
    expect(await notes(ids.job)).toContain('Work order "Tear off and re-roof" cancelled.')
  })
})

describe('a link answers for its own work order only', () => {
  test('one token never reads, changes or fetches photos of another work order or another record', async () => {
    const a = await sentOrder({ title: 'Order A' })
    const b = await sentOrder({ title: 'Order B', photoIds: [ids.photoShared] })
    expect((await link(a.token)).body.title).toBe('Order A')
    expect((await link(b.token)).body.title).toBe('Order B')
    // Accepting through A changes A and nothing else.
    expect((await link(a.token, '/accept', 'POST', { name: 'Dale Foreman' })).status).toBe(200)
    expect([(await row(a.id)).status, (await row(b.id)).status]).toEqual(['accepted', 'sent'])
    // A's photo on B's token: the crew's own photo is on A's list, not B's.
    const mine = await json(await upload(a.token, PNG))
    expect((await t.call(`/api/crew-link/${a.token}/photos/${mine.body.id}`)).status).toBe(200)
    expect((await t.call(`/api/crew-link/${b.token}/photos/${mine.body.id}`)).status).toBe(404)
    // A job photo that was not shared with the crew, one on another job, an invented id: all not there.
    for (const pid of [ids.photoPrivate, ids.photoOtherJob, 'nope', '../../etc/passwd']) expect((await t.call(`/api/crew-link/${a.token}/photos/${encodeURIComponent(pid)}`)).status).toBe(404)
    // B's token cannot complete A: it has no say over A's id, and B is not accepted.
    expect((await link(b.token, '/complete', 'POST', {})).status).toBe(409)
    expect((await row(a.id)).status).toBe('accepted')
    // The link is not a sign-in: it opens none of the company's other doors.
    for (const path of ['/api/work-orders', `/api/work-orders/${a.id}`, `/api/jobs/${ids.job}`, '/api/materials', `/api/jobs/${ids.job}/photos`]) {
      expect([401, 403]).toContain((await t.call(path, { headers: { 'X-Work-Order-Token': a.token } })).status)
    }
    expect([(await t.call(`/api/work-orders/${a.id}`)).status, (await t.call(`/api/work-orders/${a.id}?token=${a.token}`)).status]).toEqual([401, 401])
  })

  test('tokens are random, long and unique', async () => {
    const tokensSeen = new Set<string>()
    for (let i = 0; i < 5; i++) tokensSeen.add((await sentOrder()).token)
    expect(tokensSeen.size).toBe(5)
    for (const x of tokensSeen) expect(x).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('who may, and what is not there', () => {
  test('a seat without jobs:dispatch cannot make, send, change, cancel or remove one — and the server says so', async () => {
    const { id } = await sentOrder()
    const make = { jobId: ids.job, crewId: ids.crew, title: 'Nope' }
    expect((await call('view', 'POST', '/api/work-orders', make)).status).toBe(403)
    expect((await call('rep', 'POST', '/api/work-orders', make)).status).toBe(403) // a Field seat cannot dispatch
    expect((await call('view', 'PUT', `/api/work-orders/${id}`, { title: 'x' })).status).toBe(403)
    expect((await call('view', 'POST', `/api/work-orders/${id}/send`)).status).toBe(403)
    expect((await call('view', 'POST', `/api/work-orders/${id}/cancel`)).status).toBe(403)
    expect((await call('view', 'DELETE', `/api/work-orders/${id}`)).status).toBe(403)
    expect((await call('mgr', 'DELETE', `/api/work-orders/${id}`)).status).toBe(409) // a sent one is cancelled, not removed
    expect((await row(id)).status).toBe('sent')
    // The read-only seat reads them.
    expect((await call('view', 'GET', `/api/work-orders/${id}`)).status).toBe(200)
  })

  test('a Field seat sees only the work orders of jobs it is on; another company\'s are out of reach', async () => {
    const { id } = await sentOrder()
    expect((await call('rep', 'GET', `/api/work-orders/${id}`)).status).toBe(404)
    expect((await call('rep', 'GET', '/api/work-orders')).body.data).toEqual([])
    await t.db.insert(t.schema.crewLogin).values({ companyId, userId: ids.rep, crewId: ids.crew } as any)
    t.services.features.forgetFeatures()
    await t.db.update(t.schema.job).set({ assignedCrewId: ids.crew } as any).where(eq(t.schema.job.id, ids.job))
    expect((await call('rep', 'GET', `/api/work-orders/${id}`)).status).toBe(200)
    const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing' } as any).returning()
    const theirs = await ins(t.schema.job, { companyId: other.id, title: '1 Elm', number: 'ROOF-0001', status: 'lead' })
    const wo = await ins(t.schema.workOrder, { companyId: other.id, jobId: theirs.id, title: 'Theirs', recipientName: 'X', recipientPhone: '715-555-0100' })
    for (const m of [['GET', ''], ['PUT', ''], ['POST', '/send'], ['POST', '/cancel'], ['DELETE', '']] as const) expect((await call('owner', m[0], `/api/work-orders/${wo.id}${m[1]}`, m[0] === 'PUT' ? { title: 'x' } : undefined)).status).toBe(404)
    expect((await call('owner', 'GET', '/api/work-orders')).body.data.some((w: any) => w.id === wo.id)).toBe(false)
  })

  test('not ready: with the feature off, neither the office\'s door nor the crew\'s link is there', async () => {
    const { id, token } = await sentOrder()
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'roof_work_orders') } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect((await call('owner', 'GET', `/api/work-orders/${id}`)).status).toBeGreaterThanOrEqual(400)
    expect((await link(token)).status).toBe(404)
    expect((await link(token, '/accept', 'POST', { name: 'Dale Foreman' })).status).toBe(404)
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect((await link(token)).status).toBe(200)
  })
})
