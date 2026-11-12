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
  expect([!!f.hidden, f.templates]).toEqual([false, ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping']])
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

// Live test 11/11: "I did not find a way to make a custom folder" — Buildertrend and CompanyCam let a job have its own.
test("a job's own named folder: made, listed while empty, a photo filed in it and out, renamed, deleted (its photos stay)", async () => {
  const made = await json(await call(`/api/jobs/${jobId}/photo-folders`, { method: 'POST', json: { name: '  Attic   insulation ' } }))
  expect([made.status, made.body.name]).toEqual([201, 'Attic insulation'])
  const fid = made.body.id
  expect((await json(await call(`/api/jobs/${jobId}/photo-folders`))).body.data).toEqual([{ id: fid, name: 'Attic insulation' }])
  // Not twice (letter case aside), not a standard folder's name, not blank.
  expect((await call(`/api/jobs/${jobId}/photo-folders`, { method: 'POST', json: { name: 'ATTIC INSULATION' } })).status).toBe(409)
  expect((await call(`/api/jobs/${jobId}/photo-folders`, { method: 'POST', json: { name: 'Before' } })).status).toBe(409)
  expect((await call(`/api/jobs/${jobId}/photo-folders`, { method: 'POST', json: { name: ' ' } })).status).toBe(400)
  const row = async () => (await json(await call(`/api/jobs/${jobId}/photos`))).body.find((p: any) => p.id === photoId)
  // Into it (out of a standard one), then into a standard one (out of it).
  await call(`/api/jobs/${jobId}/photos/${photoId}`, { method: 'PATCH', json: { kind: 'after' } })
  expect((await call(`/api/jobs/${jobId}/photos/${photoId}`, { method: 'PATCH', json: { folderId: fid } })).status).toBe(200)
  expect(await row()).toMatchObject({ folderId: fid, photoType: 'general' })
  await call(`/api/jobs/${jobId}/photos/${photoId}`, { method: 'PATCH', json: { kind: 'damage' } })
  expect(await row()).toMatchObject({ folderId: null, photoType: 'damage' })
  await call(`/api/jobs/${jobId}/photos/${photoId}`, { method: 'PATCH', json: { folderId: fid } })
  const renamed = await json(await call(`/api/jobs/${jobId}/photo-folders/${fid}`, { method: 'PATCH', json: { name: 'Attic' } }))
  expect([renamed.status, renamed.body.name]).toEqual([200, 'Attic'])
  expect((await call(`/api/jobs/${jobId}/photo-folders/${fid}`, { method: 'DELETE' })).status).toBe(204)
  expect(await row()).toMatchObject({ folderId: null, photoType: 'general' })
  expect((await json(await call(`/api/jobs/${jobId}/photo-folders`))).body.data).toEqual([])
})

test("another job's folder is refused; another business's job has none to show", async () => {
  const other = ((await t.db.insert(t.schema.job).values({ companyId, number: 'JOB-00973', title: 'Elsewhere', status: 'scheduled' } as any).returning()) as any[])[0].id
  const theirs = (await json(await call(`/api/jobs/${other}/photo-folders`, { method: 'POST', json: { name: 'Basement' } }))).body.id
  const r = await json(await call(`/api/jobs/${jobId}/photos/${photoId}`, { method: 'PATCH', json: { folderId: theirs } }))
  expect([r.status, r.body.code]).toEqual([400, 'validation_failed'])
  expect((await call(`/api/jobs/${jobId}/photo-folders/${theirs}`, { method: 'DELETE' })).status).toBe(404)
  expect((await call('/api/jobs/not-a-job/photo-folders')).status).toBe(404)
})

// The photo library (the contractor's job photos — /api/photos, the document table): the same named folders, at /api/photos/folders.
test("the photo library's photos use the job's named folders too: made, a photo filed in and out, renamed, deleted", async () => {
  const doc = ((await t.db.insert(t.schema.document).values({ companyId, jobId, name: 'Footings', type: 'progress', mimeType: 'image/jpeg', filename: 'f.jpg', originalName: 'f.jpg', size: 10, path: 'x/f.jpg', url: '/api/photos/f/file' } as any).returning()) as any[])[0]
  const made = await json(await call('/api/photos/folders', { method: 'POST', json: { jobId, name: 'Basement' } }))
  expect([made.status, made.body.name]).toEqual([201, 'Basement'])
  expect((await json(await call(`/api/photos/folders?jobId=${jobId}`))).body.data.map((f: any) => f.name)).toContain('Basement')
  // The job's own photo routes list the same folder (one list per job).
  expect((await json(await call(`/api/jobs/${jobId}/photo-folders`))).body.data.map((f: any) => f.name)).toContain('Basement')
  expect((await call('/api/photos/folders', { method: 'POST', json: { jobId, name: 'basement' } })).status).toBe(409)
  expect((await call('/api/photos/folders', { method: 'POST', json: { jobId: 'not-a-job', name: 'X' } })).status).toBe(404)
  const into = await json(await call(`/api/photos/${doc.id}`, { method: 'PUT', json: { folderId: made.body.id } }))
  expect([into.status, into.body.photoFolderId, into.body.type]).toEqual([200, made.body.id, 'photo'])
  const back = await json(await call(`/api/photos/${doc.id}`, { method: 'PUT', json: { category: 'after' } }))
  expect([back.body.photoFolderId, back.body.type]).toEqual([null, 'after'])
  await call(`/api/photos/${doc.id}`, { method: 'PUT', json: { folderId: made.body.id } })
  expect((await json(await call(`/api/photos/folders/${made.body.id}`, { method: 'PATCH', json: { name: 'Crawlspace' } }))).body.name).toBe('Crawlspace')
  expect((await call(`/api/photos/folders/${made.body.id}`, { method: 'DELETE' })).status).toBe(204)
  expect((await json(await call(`/api/photos/${doc.id}`))).body.photoFolderId).toBeNull()
})
