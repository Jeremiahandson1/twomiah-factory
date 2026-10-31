// The roofer's photos and documents in the homeowner's portal (docs/parity/roof-portal-documents.md; roofing depth gap 10),
// through the real server as the roofing vertical:
//   · nothing is shown by default: a photo, a document and an inspection report are in the portal only after someone with
//     portal:share turns each one on, and turning it off takes it out at once;
//   · the homeowner is shown their OWN jobs' shared files only — another customer's portal (and a subcontractor's) lists
//     nothing of theirs and answers "not found" to its ids, shared or not;
//   · an unshared file is not listed and its file door says "not found" to anyone holding its id;
//   · a homeowner is told a file's name, kind and day — not where a photo was taken, who took it, or the stored path;
//   · the seats: sharing is portal:share (owner, admin, manager) — a field seat and a viewer are refused by the server; a seat
//     that reads only its own jobs cannot list another job's files;
//   · the section is the not-ready feature portal_job_files: off, the portal has no such section, the file doors and the
//     office's routes are not there; and no other vertical's portal gains it.
// Nothing here reaches R2 (an in-memory store stands in), a real tenant or any outside service.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getAdvertisableFeaturesForTemplate } from '@twomiah/tenant-backend'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const portal: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const PNG = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#38a' } }).png().toBuffer()
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
const ON = ['jobs', 'contacts', 'photo_capture', 'documents', 'client_portal', 'quotes', 'invoices', 'inspection_reports', 'portal_job_files']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const setFeatures = async (features: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const portalList = async (who: string) => json(await t.call(`/api/portal/p/${portal[who]}/job-files`))
const portalFile = (who: string, kind: string, id: string) => t.call(`/api/portal/p/${portal[who]}/job-files/${kind}/${id}/file`)
const names = (r: { body: any }) => (r.body.data as any[]).map((i) => `${i.kind}:${i.name}`).sort()

async function addPhoto(jobId: string, extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('photo', new File([new Uint8Array(PNG)], 'p.png', { type: 'image/png' }))
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const r = await json(await as('owner')(`/api/jobs/${jobId}/photos`, { method: 'POST', body: fd }))
  expect(r.status).toBe(201)
  return r.body.id as string
}
async function addDocument(jobId: string | null, name: string, type: string) {
  const key = `${companyId}/documents/${crypto.randomUUID()}.pdf`
  await t.store.put(key, PDF, 'application/pdf')
  const [row] = await t.db.insert(t.schema.document).values({ companyId, name, type, filename: key.split('/').pop(), originalName: `${name}.pdf`, mimeType: 'application/pdf', size: PDF.length, path: key, url: `/api/documents/file/${key}`, jobId } as any).returning()
  return row.id as string
}
async function makeJob(contactId: string, address: string) {
  const made = await json(await as('owner')('/api/jobs', { method: 'POST', json: { contactId, jobType: 'retail', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301' } }))
  expect([address, made.status]).toEqual([address, 201])
  return made.body.id as string
}
const share = (who: string, kind: 'photos' | 'documents' | 'reports', id: string, shared: boolean) =>
  as(who)(`/api/job-files/${kind}/${id}`, { method: 'PUT', json: { shared } })

let jobLee = '', jobLee2 = '', jobAnn = ''
const f: Record<string, string> = {}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ name: 'Ridgeline Roofing', enabledFeatures: ON, email: 'office@ridgeline.example' } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  // Nothing is mailed from a test; the invite goes nowhere.
  ;(t.services.email as any).send = async () => ({ success: true })
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: async (key: string) => { await t.store.remove(key) },
  })
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of Object.entries({ admin: 'admin', manager: 'manager', field: 'field', viewer: 'viewer' })) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const mk = async (name: string, email: string, type = 'client') => (await t.db.insert(t.schema.contact).values({ companyId, name, email, type } as any).returning())[0].id as string
  ids.lee = await mk('Lee Marsh', 'lee@home.example')
  ids.ann = await mk('Ann Other', 'ann@home.example')
  ids.sub = await mk('Sam Subcontractor', 'sam@subs.example', 'subcontractor')
  for (const who of ['lee', 'ann', 'sub']) {
    const r = await json(await as('owner')(`/api/portal/contacts/${ids[who]}/enable`, { method: 'POST' }))
    expect([who, r.status]).toEqual([who, 200])
    portal[who] = String(r.body.portalUrl).split('/').pop()!
  }
  jobLee = await makeJob(ids.lee, '1 Shingle Way')
  jobLee2 = await makeJob(ids.lee, '9 Gable Court')
  jobAnn = await makeJob(ids.ann, '2 Ridge Road')
  await t.db.update(t.schema.job).set({ assignedSalesRepId: ids.field } as any).where(eq(t.schema.job.id, jobLee))
  // A subcontractor is on Lee's second job; collaborators are not offered to a roofer's portal.
  await t.db.update(t.schema.job).set({ subcontractorId: ids.sub } as any).where(eq(t.schema.job.id, jobLee2))

  f.leeDamage = await addPhoto(jobLee, { photoType: 'damage', caption: 'Hail hits, north slope', latitude: '43.8014', longitude: '-91.4396' })
  f.leePrivate = await addPhoto(jobLee, { photoType: 'before', caption: 'Dog in the yard — office only' })
  f.lee2Photo = await addPhoto(jobLee2, { photoType: 'after', caption: 'Gable finished' })
  f.annPhoto = await addPhoto(jobAnn, { photoType: 'damage', caption: 'Ann’s ridge' })
  f.leeContract = await addDocument(jobLee, 'Signed contract', 'contract')
  f.leeWarranty = await addDocument(jobLee, 'Workmanship warranty', 'warranty')
  f.leeCosts = await addDocument(jobLee, 'Supplier costs sheet', 'general')
  f.annContract = await addDocument(jobAnn, 'Ann contract', 'contract')
  f.loose = await addDocument(null, 'Filed under no job', 'general')
  const rep = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobLee, title: 'Roof inspection — 1 Shingle Way', sections: [{ title: 'North slope', photoIds: [f.leeDamage] }] } }))
  expect(rep.status).toBe(201)
  f.leeReport = rep.body.id
  const repAnn = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobAnn, title: 'Ann inspection' } }))
  f.annReport = repAnn.body.id
}, 180_000)

describe('the feature', () => {
  test('is a roofing feature that is not ready: registered for crm-roof, hidden, so no plan or owner switches it on yet', () => {
    const feature = FEATURE_REGISTRY.find((x: any) => x.id === 'portal_job_files')!
    expect([feature.templates, feature.hidden]).toEqual([['crm-roof'], true])
    expect(getAdvertisableFeaturesForTemplate('crm-roof').map((x: any) => x.id)).not.toContain('portal_job_files')
  })
})

describe('nothing is shown until it is chosen', () => {
  test('the portal offers the section, and it is empty: no photo, document or report was shared', async () => {
    const home = await json(await t.call(`/api/portal/p/${portal.lee}`))
    expect(home.body.sections.jobFiles).toBe(true)
    const r = await portalList('lee')
    expect([r.status, r.body.data]).toEqual([200, []])
  })
  test('their ids, asked for directly, are not found while unshared', async () => {
    for (const [kind, id] of [['photo', f.leeDamage], ['document', f.leeContract], ['report', f.leeReport]]) expect([kind, (await portalFile('lee', kind, id)).status]).toEqual([kind, 404])
  })
  test('the office sees every file of the job with its switch off', async () => {
    const r = await json(await as('manager')(`/api/job-files?jobId=${jobLee}`))
    expect(r.status).toBe(200)
    expect([r.body.photos.length, r.body.documents.length, r.body.reports.length]).toEqual([2, 3, 1])
    expect([...r.body.photos, ...r.body.documents, ...r.body.reports].every((x: any) => x.shared === false)).toBe(true)
  })
})

describe('sharing', () => {
  test('a manager turns on one photo, two documents and the report; the homeowner’s portal lists exactly those', async () => {
    for (const [kind, id] of [['photos', f.leeDamage], ['documents', f.leeContract], ['documents', f.leeWarranty], ['reports', f.leeReport]] as const) {
      expect([kind, (await share('manager', kind, id, true)).status]).toEqual([kind, 200])
    }
    const r = await portalList('lee')
    expect(names(r)).toEqual(['document:Signed contract', 'document:Workmanship warranty', 'photo:Hail hits, north slope', 'report:Roof inspection — 1 Shingle Way'])
    // Each one says which of her jobs it is on.
    expect(new Set(r.body.data.map((i: any) => i.jobNumber)).size).toBe(1)
    expect(r.body.data.every((i: any) => i.jobAddress === '1 Shingle Way, Akron')).toBe(true)
  })
  test('what a photo says to the homeowner is its caption, kind and day — never where, who or the stored address', async () => {
    const r = await portalList('lee')
    const photo = r.body.data.find((i: any) => i.kind === 'photo')
    expect(photo).toMatchObject({ name: 'Hail hits, north slope', type: 'damage' })
    const text = JSON.stringify(r.body)
    expect(text).not.toMatch(/43\.80|91\.43|latitude|longitude|uploadedBy|\/media\/|\/documents\/|"path"|publicToken|sharedWithCustomer/)
  })
  test('each shared file opens: the photo as an image, the contract as its PDF, the report as a PDF', async () => {
    const photo = await portalFile('lee', 'photo', f.leeDamage)
    expect([photo.status, photo.headers.get('content-type'), photo.headers.get('x-content-type-options')]).toEqual([200, 'image/png', 'nosniff'])
    expect(Buffer.from(await photo.arrayBuffer()).length).toBe(PNG.length)
    const doc = await portalFile('lee', 'document', f.leeContract)
    expect([doc.status, doc.headers.get('content-type')]).toEqual([200, 'application/pdf'])
    expect(doc.headers.get('content-disposition')).toContain('Signed contract.pdf')
    expect(doc.headers.get('cache-control')).toContain('no-store')
    const rep = await portalFile('lee', 'report', f.leeReport)
    expect([rep.status, rep.headers.get('content-type')]).toEqual([200, 'application/pdf'])
    expect(new TextDecoder().decode(new Uint8Array(await rep.arrayBuffer()).slice(0, 5))).toBe('%PDF-')
  })
  test('the files left unshared stay out: not listed, and not found by id', async () => {
    const r = await portalList('lee')
    expect(r.body.data.map((i: any) => i.id)).not.toContain(f.leePrivate)
    expect(r.body.data.map((i: any) => i.id)).not.toContain(f.leeCosts)
    for (const [kind, id] of [['photo', f.leePrivate], ['document', f.leeCosts]]) expect([kind, (await portalFile('lee', kind, id)).status]).toEqual([kind, 404])
    // A made-up kind is not a way round it.
    expect((await portalFile('lee', 'job', jobLee)).status).toBe(404)
    expect((await portalFile('lee', 'photo', '..')).status).toBe(404)
  })
  test('turning one off takes it out at once; turning it back on returns it', async () => {
    expect((await share('manager', 'documents', f.leeWarranty, false)).status).toBe(200)
    expect(names(await portalList('lee'))).not.toContain('document:Workmanship warranty')
    expect((await portalFile('lee', 'document', f.leeWarranty)).status).toBe(404)
    expect((await share('manager', 'documents', f.leeWarranty, true)).status).toBe(200)
    expect((await portalFile('lee', 'document', f.leeWarranty)).status).toBe(200)
  })
  test('a document filed under no job cannot be shared, and a photo or report id that is not a file is not found', async () => {
    expect((await share('manager', 'documents', f.loose, true)).status).toBe(404)
    expect((await share('manager', 'photos', 'nope', true)).status).toBe(404)
    expect((await share('manager', 'reports', 'nope', true)).status).toBe(404)
    expect((await as('manager')(`/api/job-files/photos/${f.leeDamage}`, { method: 'PUT', json: { shared: 'yes' } })).status).toBe(400)
  })
})

describe('another customer sees nothing of it', () => {
  test('Ann has shared nothing yet: her portal lists nothing, though Lee’s files are shared', async () => {
    expect((await portalList('ann')).body.data).toEqual([])
  })
  test('Lee’s shared files are not found through Ann’s portal link, by any id', async () => {
    for (const [kind, id] of [['photo', f.leeDamage], ['document', f.leeContract], ['report', f.leeReport]]) expect([kind, (await portalFile('ann', kind, id)).status]).toEqual([kind, 404])
  })
  test('Ann shares her own and sees exactly hers; Lee never sees it, shared or not', async () => {
    for (const [kind, id] of [['photos', f.annPhoto], ['documents', f.annContract], ['reports', f.annReport]] as const) expect((await share('owner', kind, id, true)).status).toBe(200)
    expect(names(await portalList('ann'))).toEqual(['document:Ann contract', 'photo:Ann’s ridge', 'report:Ann inspection'])
    expect(names(await portalList('lee')).join('|')).not.toMatch(/Ann/)
    for (const [kind, id] of [['photo', f.annPhoto], ['document', f.annContract], ['report', f.annReport]]) expect([kind, (await portalFile('lee', kind, id)).status]).toEqual([kind, 404])
  })
  test('a file on Lee’s other job reaches Lee once shared, grouped under that job', async () => {
    expect((await share('manager', 'photos', f.lee2Photo, true)).status).toBe(200)
    const r = await portalList('lee')
    const by: Record<string, any[]> = {}
    for (const i of r.body.data as any[]) (by[i.jobAddress] ||= []).push(i)
    expect(Object.keys(by).sort()).toEqual(['1 Shingle Way, Akron', '9 Gable Court, Akron'])
    expect((by['9 Gable Court, Akron'] as any[]).map((i) => i.name)).toEqual(['Gable finished'])
  })
  test('a subcontractor on Lee’s job is not the homeowner: their portal lists nothing and opens nothing', async () => {
    expect((await portalList('sub')).body.data).toEqual([])
    expect((await portalFile('sub', 'photo', f.lee2Photo)).status).toBe(404)
  })
  test('a withdrawn or unknown portal link opens nothing', async () => {
    expect((await t.call(`/api/portal/p/${'0'.repeat(64)}/job-files`)).status).toBe(401)
    expect((await as('owner')(`/api/portal/contacts/${ids.ann}/disable`, { method: 'POST' })).status).toBe(200)
    expect((await portalList('ann')).status).toBe(401)
    expect((await portalFile('ann', 'photo', f.annPhoto)).status).toBe(401)
  })
})

describe('who may share, and who may see', () => {
  test('owner, admin and manager may share; a field seat and a viewer are refused by the server, and nothing changes', async () => {
    for (const who of ['owner', 'admin', 'manager']) expect([who, (await share(who, 'photos', f.leePrivate, false)).status]).toEqual([who, 200])
    for (const who of ['field', 'viewer']) {
      for (const [kind, id] of [['photos', f.leePrivate], ['documents', f.leeCosts], ['reports', f.leeReport]] as const) expect([who, kind, (await share(who, kind, id, true)).status]).toEqual([who, kind, 403])
    }
    const r = await json(await as('owner')(`/api/job-files?jobId=${jobLee}`))
    expect(r.body.photos.find((p: any) => p.id === f.leePrivate).shared).toBe(false)
    expect(r.body.documents.find((p: any) => p.id === f.leeCosts).shared).toBe(false)
    expect(names(await portalList('lee')).join('|')).not.toMatch(/Dog in the yard|Supplier costs/)
  })
  test('signed out, nobody reaches the office routes', async () => {
    expect((await t.call(`/api/job-files?jobId=${jobLee}`)).status).toBe(401)
    expect((await t.call(`/api/job-files/photos/${f.leePrivate}`, { method: 'PUT', json: { shared: true } })).status).toBe(401)
  })
  test('a viewer reads the switches; a field seat reads its own job’s and not another’s', async () => {
    expect((await as('viewer')(`/api/job-files?jobId=${jobLee}`)).status).toBe(200)
    expect((await as('field')(`/api/job-files?jobId=${jobLee}`)).status).toBe(200)
    expect((await as('field')(`/api/job-files?jobId=${jobAnn}`)).status).toBe(404)
    expect((await as('owner')('/api/job-files?jobId=nope')).status).toBe(404)
  })
  test('a seat that reads only its own jobs cannot share a file of a job that is not its own, even holding portal:share', async () => {
    // Give a field seat the sharing permission by name (an owner's per-person grant); the job rule still holds.
    await t.db.insert(t.schema.user).values({ email: 'rep@test.example', passwordHash: await Bun.password.hash(PASS, 'bcrypt'), firstName: 'rep', lastName: 'Seat', role: 'field', companyId, extraPermissions: ['portal:share', 'documents:read'] } as any)
    tokens.rep = await login('rep@test.example', PASS)
    expect((await share('rep', 'photos', f.annPhoto, true)).status).toBe(404)
    expect((await share('rep', 'documents', f.annContract, true)).status).toBe(404)
  })
})

describe('with the feature off', () => {
  test('the portal has no such section, the file doors and the office’s routes are not there; on again, it all returns', async () => {
    await setFeatures(ON.filter((x) => x !== 'portal_job_files'))
    const home = await json(await t.call(`/api/portal/p/${portal.lee}`))
    expect(home.body.sections.jobFiles).toBe(false)
    const list = await portalList('lee')
    expect([list.status, list.body.code]).toEqual([404, 'FEATURE_NOT_ENABLED'])
    expect((await portalFile('lee', 'photo', f.leeDamage)).status).toBe(404)
    expect((await as('owner')(`/api/job-files?jobId=${jobLee}`)).status).not.toBe(200)
    await setFeatures(ON)
    expect((await portalList('lee')).status).toBe(200)
    expect((await portalFile('lee', 'photo', f.leeDamage)).status).toBe(200)
  })
  test('with inspection reports off, a shared report is not listed and not opened, though its switch stays on', async () => {
    await setFeatures(ON.filter((x) => x !== 'inspection_reports'))
    expect(names(await portalList('lee')).join('|')).not.toContain('report:')
    expect((await portalFile('lee', 'report', f.leeReport)).status).toBe(404)
    expect((await share('manager', 'reports', f.leeReport, true)).status).toBe(404)
    await setFeatures(ON)
    expect(names(await portalList('lee')).join('|')).toContain('report:')
  })
})

describe('no other vertical gains it', () => {
  test('a contractor’s portal has no job-files section and no door for it', async () => {
    const c = await bootTenant({ vertical: 'contractor' })
    const s = await seedOwner(c)
    await c.db.update(c.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'client_portal', 'portal_job_files'] } as any).where(eq(c.schema.company.id, s.company.id))
    ;(c.services.email as any).send = async () => ({ success: true })
    const owner = (await (await c.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
    const [contact] = await c.db.insert(c.schema.contact).values({ companyId: s.company.id, name: 'Pat Client', email: 'pat@x.example', type: 'client' } as any).returning()
    const en = await (await c.call(`/api/portal/contacts/${contact.id}/enable`, { method: 'POST', headers: { Authorization: `Bearer ${owner}` } })).json() as any
    const token = String(en.portalUrl).split('/').pop()
    const home = await (await c.call(`/api/portal/p/${token}`)).json() as any
    expect('jobFiles' in home.sections).toBe(false)
    expect((await c.call(`/api/portal/p/${token}/job-files`)).status).toBe(404)
    expect((await c.call('/api/job-files?jobId=x', { headers: { Authorization: `Bearer ${owner}` } })).status).toBe(404)
  }, 120_000)
})
