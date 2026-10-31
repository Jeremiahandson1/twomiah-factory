// Canvassing from a phone with no signal (docs/parity/roof-canvass-offline.md), the server's half, as the roofing vertical:
//   · the phone names the session (`id`): its doors carry that address before the server has heard of it; sending the
//     session again answers the one saved, never a second; another canvasser's id is refused, a malformed one too;
//   · the phone's times are kept — when the session began, each door was knocked, the session ended — and a time that
//     could not be (next week, last year) is today's instead;
//   · a door's photos are files in the photo store: uploaded one at a time (answered with a /media address), the same name
//     twice is the same file, a non-picture is refused; a door keeps only this business's canvass photos, at most six —
//     never the picture itself in its row (the desktop's data URLs);
//   · a door sent twice with the same Idempotency-Key (the queue's retry after a lost reply) is one door.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'

const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).png().toBuffer()
const PASS = 'Seat-pass-1'
let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}

const call = async (who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const init: any = { method, headers: { Authorization: `Bearer ${tokens[who]}`, ...headers } }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) init.json = body
  const res = await t.call(path, init)
  return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() as any : null }
}
const photoForm = (name?: string, bytes: Uint8Array = new Uint8Array(PNG)) => {
  const f = new FormData()
  f.append('photo', new File([bytes as BlobPart], 'p.png', { type: 'image/png' }))
  if (name) f.append('name', name)
  return f
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'canvassing_tool'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: async (key: string) => { await t.store.remove(key) },
  })
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const who of ['rep', 'other']) {
    await t.db.insert(t.schema.user).values({ email: `${who}@test.example`, passwordHash: hash, firstName: who, lastName: 'Seat', role: 'field', companyId } as any)
    tokens[who] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${who}@test.example`, password: PASS } })).json() as any).accessToken
  }
}, 120_000)

describe('the session the phone named', () => {
  const id = 'cv_offline_session_000000001'
  test('is made with that id and the phone\'s start time; sent again it is the same session', async () => {
    const startedAt = hoursAgo(3)
    const first = await call('rep', 'POST', '/api/canvassing/sessions', { id, name: 'Elm St after the hail', startedAt, centerLat: 44.8, centerLng: -91.5 })
    expect(first.status).toBe(201)
    expect(first.body.id).toBe(id)
    expect(new Date(first.body.startedAt).toISOString()).toBe(startedAt)
    const again = await call('rep', 'POST', '/api/canvassing/sessions', { id, name: 'Elm St after the hail', startedAt })
    expect(again.status).toBe(200)
    expect(again.body.id).toBe(id)
    expect((await t.db.select().from(t.schema.canvassingSession).where(eq(t.schema.canvassingSession.id, id))).length).toBe(1)
  })

  test("another canvasser cannot take it; an id that is not one is refused; no id still makes one", async () => {
    expect((await call('other', 'POST', '/api/canvassing/sessions', { id })).status).toBe(409)
    expect((await call('rep', 'POST', '/api/canvassing/sessions', { id: 'short' })).status).toBe(400)
    expect((await call('rep', 'POST', '/api/canvassing/sessions', { id: 'has spaces in it and more' })).status).toBe(400)
    const plain = await call('rep', 'POST', '/api/canvassing/sessions', { name: 'Desk' })
    expect(plain.status).toBe(201)
    expect(plain.body.id).toBeTruthy()
  })

  test('a start time that could not be is today\'s', async () => {
    const future = await call('rep', 'POST', '/api/canvassing/sessions', { id: 'cv_offline_future_00000001', startedAt: new Date(Date.now() + 86_400_000).toISOString() })
    expect(Math.abs(new Date(future.body.startedAt).getTime() - Date.now())).toBeLessThan(60_000)
    const old = await call('rep', 'POST', '/api/canvassing/sessions', { id: 'cv_offline_old_000000000001', startedAt: hoursAgo(24 * 30) })
    expect(Math.abs(new Date(old.body.startedAt).getTime() - Date.now())).toBeLessThan(60_000)
  })

  test('doors are dated when they were knocked, the end when it ended; the counts are right', async () => {
    const knocked = hoursAgo(2)
    const door = await call('rep', 'POST', `/api/canvassing/sessions/${id}/stops`, { outcome: 'interested', address: '12 Elm St', phone: '715-555-0100', visitedAt: knocked })
    expect(door.status).toBe(201)
    expect(new Date(door.body.visitedAt).toISOString()).toBe(knocked)
    expect(door.body.jobId).toBeTruthy()
    const ended = hoursAgo(1)
    const end = await call('rep', 'POST', `/api/canvassing/sessions/${id}/end`, { endedAt: ended })
    expect(end.status).toBe(200)
    expect(new Date(end.body.endedAt).toISOString()).toBe(ended)
    expect([end.body.totalDoors, end.body.leadsCreated]).toEqual([1, 1])
  })
})

describe("a door's photos", () => {
  const id = 'cv_offline_photos_0000000001'
  beforeAll(async () => { await call('rep', 'POST', '/api/canvassing/sessions', { id, name: 'Photos' }) })

  test('upload to the photo store under this business\'s canvass folder; the same name twice is the same file', async () => {
    const a = await call('rep', 'POST', `/api/canvassing/sessions/${id}/photos`, photoForm('saveid-0'))
    expect(a.status).toBe(201)
    expect(a.body.url).toBe(`/media/photos/${companyId}/canvass/${id}/saveid-0.png`)
    expect(await t.store.getObject(a.body.url.slice('/media/'.length))).toBeTruthy()
    const b = await call('rep', 'POST', `/api/canvassing/sessions/${id}/photos`, photoForm('saveid-0'))
    expect(b.body.url).toBe(a.body.url)
    const unnamed = await call('rep', 'POST', `/api/canvassing/sessions/${id}/photos`, photoForm())
    expect(unnamed.body.url).toMatch(new RegExp(`^/media/photos/${companyId}/canvass/${id}/[0-9a-f]{32}\\.png$`))
  })

  test('a file that is not a picture is refused; another canvasser\'s session is not there', async () => {
    expect((await call('rep', 'POST', `/api/canvassing/sessions/${id}/photos`, photoForm('notapic-0', new TextEncoder().encode('<html>hi</html>')))).status).toBe(400)
    expect((await call('other', 'POST', `/api/canvassing/sessions/${id}/photos`, photoForm('theirs-00'))).status).toBe(404)
  })

  test('a door keeps its uploaded photos; a picture inside the door, another business\'s, or seven are refused', async () => {
    const up = await call('rep', 'POST', `/api/canvassing/sessions/${id}/photos`, photoForm('door1-000'))
    const ok = await call('rep', 'POST', `/api/canvassing/sessions/${id}/stops`, { outcome: 'no_answer', address: '1 Oak', photos: [up.body.url] })
    expect(ok.status).toBe(201)
    expect(ok.body.photos).toEqual([up.body.url])
    expect((await call('rep', 'POST', `/api/canvassing/sessions/${id}/stops`, { outcome: 'no_answer', address: '2 Oak', photos: ['data:image/png;base64,iVBORw0KGgo='] })).status).toBe(400)
    expect((await call('rep', 'POST', `/api/canvassing/sessions/${id}/stops`, { outcome: 'no_answer', address: '3 Oak', photos: ['/media/photos/another-co/canvass/x/y.png'] })).status).toBe(400)
    expect((await call('rep', 'POST', `/api/canvassing/sessions/${id}/stops`, { outcome: 'no_answer', address: '4 Oak', photos: Array(7).fill(up.body.url) })).status).toBe(400)
    expect((await call('rep', 'PUT', `/api/canvassing/stops/${ok.body.id}`, { photos: ['data:image/png;base64,iVBORw0KGgo='] })).status).toBe(400)
  })

  test('a door sent twice with the same Idempotency-Key is one door', async () => {
    const key = { 'Idempotency-Key': 'queue-item-door-77' }
    const first = await call('rep', 'POST', `/api/canvassing/sessions/${id}/stops`, { outcome: 'not_interested', address: '77 Oak', visitedAt: hoursAgo(1) }, key)
    const second = await call('rep', 'POST', `/api/canvassing/sessions/${id}/stops`, { outcome: 'not_interested', address: '77 Oak', visitedAt: hoursAgo(1) }, key)
    expect(first.status).toBe(201)
    expect(second.body.id).toBe(first.body.id)
    const rows = await t.db.select().from(t.schema.canvassingStop).where(eq(t.schema.canvassingStop.address, '77 Oak'))
    expect(rows.length).toBe(1)
  })
})
