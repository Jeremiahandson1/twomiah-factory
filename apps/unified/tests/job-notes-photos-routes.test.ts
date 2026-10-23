// The server half of the job page's notes and photos (live test 2026-10-22): the routes JobDetailPage calls, through the
// real server — the notes log (/api/comments/job/:id) and the photos where each vertical keeps them. Its own file: the
// screen tests install a DOM (happy-dom) as globals, and under the servers' Bun (1.3.14) the in-memory database then
// takes itself to be in a browser and fails to boot (window.encodeURIComponent). job-notes-photos.test.ts is the screens.
import { describe, test, expect, beforeAll } from 'bun:test'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'

const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3a3' } }).png().toBuffer()


async function tenantWithJob(vertical: string) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  // The photo store: R2 in production, never reached from a test; the harness's in-memory store stands in (as
  // mobile-trades.test.ts does), on the same object every photo route holds.
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: async (key: string) => { await t.store.remove(key) },
  })
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
  const owner = await login('owner@test.example', s.password)
  const as = (tok: string) => (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
  expect((await as(owner)('/api/company/features', { method: 'PUT', json: { features: ['contacts', 'jobs', 'photo_capture'] } })).status).toBe(200)
  await t.db.insert(t.schema.user).values({ email: 'viewer@test.example', passwordHash: await Bun.password.hash('Pass-word-1', 'bcrypt'), firstName: 'Vi', lastName: 'Ewer', role: 'viewer', companyId: s.company.id })
  const viewer = await login('viewer@test.example', 'Pass-word-1')
  const job = await (await as(owner)('/api/jobs', { method: 'POST', json: { title: 'Deck repair' } })).json()
  return { t, owner: as(owner), viewer: as(viewer), jobId: (job.data ?? job).id as string }
}
const form = (field: string, extra: Record<string, string> = {}) => {
  const fd = new FormData()
  fd.append(field, new File([new Uint8Array(PNG)], 'p.png', { type: 'image/png' }))
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return fd
}

describe('the routes the page calls', () => {
  let c: Awaited<ReturnType<typeof tenantWithJob>>
  beforeAll(async () => { c = await tenantWithJob('contractor') }, 60_000)

  test('notes: added, listed newest first with the author; a viewer reads and cannot add', async () => {
    expect((await c.owner(`/api/comments/job/${c.jobId}`, { method: 'POST', json: { content: 'First' } })).status).toBe(201)
    await new Promise((r) => setTimeout(r, 5))
    expect((await c.owner(`/api/comments/job/${c.jobId}`, { method: 'POST', json: { content: 'Second' } })).status).toBe(201)
    const list = await (await c.viewer(`/api/comments/job/${c.jobId}`)).json()
    expect(list.data.map((n: any) => n.content)).toEqual(['Second', 'First'])
    expect(list.data[0].user).toMatchObject({ firstName: 'Olive', lastName: 'Owner' })
    expect(typeof list.data[0].createdAt).toBe('string')
    expect((await c.viewer(`/api/comments/job/${c.jobId}`, { method: 'POST', json: { content: 'x' } })).status).toBe(403)
  })

  test('contractor photos: the library by job — add, list, delete', async () => {
    const up = await c.owner('/api/photos', { method: 'POST', body: form('photo', { jobId: c.jobId, caption: 'Before' }) })
    expect(up.status).toBe(201)
    const listed = await (await c.owner(`/api/photos?jobId=${c.jobId}`)).json()
    expect(listed.data).toHaveLength(1)
    expect(listed.data[0].description).toBe('Before')
    expect((await c.owner(`/api/photos/${listed.data[0].id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await (await c.owner(`/api/photos?jobId=${c.jobId}`)).json()).data).toEqual([])
  })

  test('landscaping photos: on the job — add, list, delete', async () => {
    const l = await tenantWithJob('landscaping')
    const up = await l.owner(`/api/jobs/${l.jobId}/photos`, { method: 'POST', body: form('photo', { caption: 'After' }) })
    expect(up.status).toBe(201)
    const listed = await (await l.owner(`/api/jobs/${l.jobId}/photos`)).json()
    expect(listed.map((p: any) => p.caption)).toEqual(['After'])
    expect((await l.owner(`/api/jobs/${l.jobId}/photos/${listed[0].id}`, { method: 'DELETE' })).status).toBeLessThan(300)
    expect(await (await l.owner(`/api/jobs/${l.jobId}/photos`)).json()).toEqual([])
  }, 60_000)
})
