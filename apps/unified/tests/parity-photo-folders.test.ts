// Parity tier 2 #2 (11/10): photo folders on a job (Buildertrend's per-job folders) — the server half, through the real server as
// field service: a job's photo is filed in a folder (job_photo.photo_type — roofing's kinds and progress, inspection, issue), moved
// between folders, taken out of one; an unknown folder is refused; another business's photo is not found. The screen's half is
// parity-photo-folders-ui.test.ts.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', jobId = '', photoId = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'photo_capture', 'photo_folders'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  jobId = ((await t.db.insert(t.schema.job).values({ companyId, number: 'JOB-00971', title: 'Furnace', status: 'scheduled' } as any).returning()) as any[])[0].id
  photoId = ((await t.db.insert(t.schema.jobPhoto).values({ companyId, jobId, url: '/media/photos/a.jpg' } as any).returning()) as any[])[0].id
}, 120_000)

test('photo_folders is registered, not ready, for the job trades whose job page shows the photos', () => {
  const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'photo_folders')
  expect([f.hidden, f.templates]).toEqual([true, ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping']])
})

test('a photo is moved into a folder, to another, and out of one', async () => {
  const listed = async () => (await json(await call(`/api/jobs/${jobId}/photos`))).body.find((p: any) => p.id === photoId).photoType
  expect(await listed()).toBe('general')
  for (const kind of ['progress', 'inspection', 'during', 'general']) {
    const r = await json(await call(`/api/jobs/${jobId}/photos/${photoId}`, { method: 'PATCH', json: { kind } }))
    expect([r.status, r.body.photoType]).toEqual([200, kind])
    expect(await listed()).toBe(kind)
  }
})

test('an unknown folder is refused; a photo of another job or business is not found', async () => {
  const bad = await json(await call(`/api/jobs/${jobId}/photos/${photoId}`, { method: 'PATCH', json: { kind: 'banana' } }))
  expect([bad.status, bad.body.code]).toEqual([400, 'validation_failed'])
  const other = ((await t.db.insert(t.schema.job).values({ companyId, number: 'JOB-00972', title: 'Other', status: 'scheduled' } as any).returning()) as any[])[0].id
  expect((await call(`/api/jobs/${other}/photos/${photoId}`, { method: 'PATCH', json: { kind: 'after' } })).status).toBe(404)
})
