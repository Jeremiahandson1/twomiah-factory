// The job page's notes and photos (live test 2026-10-22, contractor and landscaping): the shared JobDetailPage
// (packages/tenant-ui) rendered in a real DOM against a stand-in API that records every call, and the server routes
// it calls, through the real server — the notes log (/api/comments/job/:id, newest first, who and when) and the photos
// where each vertical keeps them (contractor: the photo library by job; landscaping: the job's own photos).
import { describe, test, expect, beforeAll } from 'bun:test'
import { Window } from 'happy-dom'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'

// ── A DOM for React (happy-dom), installed before React loads ──────────────────────────────────────────────────────
const win: any = new Window({ url: 'https://crm.example.com/crm/jobs/job-1' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
URL.createObjectURL ||= (() => 'blob:preview') as any
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
const { JobDetailPage } = await import('../../../packages/tenant-ui/src/jobs/JobDetailPage.tsx')
const h = React.createElement

const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3a3' } }).png().toBuffer()
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

/** A stand-in for the app's API client: answers from `replies`, records each call. */
function fakeApi(replies: Record<string, any>) {
  const calls: Array<{ method: string; path: string; body?: any; params?: any }> = []
  const answer = (path: string) => { for (const [k, v] of Object.entries(replies)) if (path === k) return typeof v === 'function' ? v() : v; return {} }
  return {
    calls,
    get: async (path: string, params?: any) => { calls.push({ method: 'GET', path, params }); return answer(path) },
    post: async (path: string, body?: any) => { calls.push({ method: 'POST', path, body }); return {} },
    put: async (path: string, body?: any) => { calls.push({ method: 'PUT', path, body }); return {} },
    delete: async (path: string, id?: string) => { calls.push({ method: 'DELETE', path: id ? `${path}/${id}` : path }); return {} },
    request: async (path: string, init: any) => { calls.push({ method: init.method, path, body: init.body }); return {} },
  }
}

async function render(config: any, api: ReturnType<typeof fakeApi>) {
  const el = document.createElement('div'); document.body.innerHTML = ''; document.body.appendChild(el)
  const root = createRoot(el)
  const toast = { success: () => {}, error: () => {} }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/crm/jobs/job-1'] }, h(Routes, null, h(Route, { path: '/crm/jobs/:id', element: h(JobDetailPage, { api, toast, config }) })))) })
  await settle()
  return el
}

const JOB = { id: 'job-1', number: 'JOB-00001', title: 'Deck repair', status: 'scheduled', priority: 'normal' }
const NOTES = [
  { id: 'n1', content: 'Older note', createdAt: '2026-10-20T15:00:00.000Z', user: { firstName: 'Olive', lastName: 'Owner' } },
  { id: 'n2', content: 'Gate code changed to 4321', createdAt: '2026-10-22T19:30:00.000Z', user: { firstName: 'Fran', lastName: 'Field' } },
]

describe('the job page (shared screen, real DOM)', () => {
  test('notes: listed newest first with who and when on the business clock; a new one goes to /api/comments/job/:id', async () => {
    const api = fakeApi({ '/api/jobs/job-1': JOB, '/api/comments/job/job-1': { data: NOTES } })
    const el = await render({ notes: true, timeZone: 'America/Chicago' }, api)
    const items = [...el.querySelectorAll('li')].map((li: any) => li.textContent)
    expect(items[0]).toContain('Fran Field')
    expect(items[0]).toContain('Gate code changed to 4321')
    expect(items[0]).toContain('Oct 22, 2026, 2:30 PM')
    expect(items[1]).toContain('Older note')
    const box = el.querySelector('textarea') as any
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(box, 'Customer away until Tuesday')
      box.dispatchEvent(new win.Event('input', { bubbles: true }))
    })
    await act(async () => { (el.querySelector('form') as any).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })) })
    await settle()
    expect(api.calls.find((c) => c.method === 'POST')).toEqual({ method: 'POST', path: '/api/comments/job/job-1', body: { content: 'Customer away until Tuesday' } })
  })

  test("photos kept on the job: listed from /api/jobs/:id/photos, with a way to add one", async () => {
    const api = fakeApi({ '/api/jobs/job-1': JOB, '/api/jobs/job-1/photos': [{ id: 'p1', url: '/media/photos/a.jpg', caption: 'Before' }] })
    const el = await render({ photos: true, photoStore: 'job' }, api)
    expect(el.querySelector('img[alt="Before"]')).not.toBeNull()
    expect(el.textContent).toContain('Take or add a photo')
    expect(el.querySelector('input[type="file"]')).not.toBeNull()
  })

  test('photos kept in the library: listed from /api/photos by job', async () => {
    const api = fakeApi({ '/api/jobs/job-1': JOB, '/api/photos': { data: [{ id: 'd1', url: '/api/photos/d1/file', thumbnailUrl: '/api/photos/d1/thumbnail', description: 'After' }] } })
    const el = await render({ photos: true, photoStore: 'library' }, api)
    expect(api.calls.find((c) => c.path === '/api/photos')?.params).toMatchObject({ jobId: 'job-1' })
    expect(el.querySelector('img[alt="After"]')?.getAttribute('src')).toBe('/api/photos/d1/thumbnail')
    expect(el.textContent).toContain('Take or add a photo')
  })

  test('the unified app mounts them on every job page: notes on, photos where the vertical keeps them', async () => {
    const src = await Bun.file(new URL('../web/src/crm/screens.tsx', import.meta.url)).text()
    const mount = src.slice(src.indexOf('export function JobDetail()'), src.indexOf('export function JobDetail()') + 900)
    expect(mount).toContain("photoStore: v().jobs.photos ? 'job' : 'library'")
    expect(mount).toContain('notes: true')
  })
})

// ── The server half, through the real server ─────────────────────────────────────────────────────────────────────

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
  beforeAll(async () => { c = await tenantWithJob('contractor') })

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
  })
})
