// The roofer's shareable inspection report (docs/parity/roof-inspection-report.md; roofing depth gap 6), through the real
// server as the roofing vertical:
//   · a photo carries where and when the phone took it, when the phone said (both coordinates or neither; a time in the
//     future is the upload time instead);
//   · a report is built from the job's damage and before photos (or the sections the roofer names), and only that job's own
//     photos can be in it;
//   · its private link opens THAT report and nothing else — not another report, not a photo that is not in it — as a page
//     with the company's name and colour, each photo's caption, time and GPS, and as a PDF; a switched-off, renewed or
//     run-out link, and a switched-off feature, answer not found;
//   · the seats: a viewer reads and cannot change, a field seat builds but cannot share, a manager shares, and a seat that
//     reads only its own jobs cannot reach another job's report.
// Nothing here reaches R2 (an in-memory store stands in), a real tenant or any outside service.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getAdvertisableFeaturesForTemplate } from '@twomiah/tenant-backend'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const PNG = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3a8' } }).png().toBuffer()
const ON = ['jobs', 'contacts', 'photo_capture', 'inspection_reports']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const setFeatures = async (features: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

/** A photo onto a job, the way the screen and the phone send one. */
async function addPhoto(who: string, jobId: string, extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('photo', new File([new Uint8Array(PNG)], 'p.png', { type: 'image/png' }))
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return json(await as(who)(`/api/jobs/${jobId}/photos`, { method: 'POST', body: fd }))
}
async function makeJob(address: string, extra: Record<string, unknown> = {}) {
  const made = await json(await as('owner')('/api/jobs', { method: 'POST', json: { contactId: ids.home, jobType: 'insurance', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301', ...extra } }))
  expect([address, made.status]).toEqual([address, 201])
  return made.body.id as string
}

let jobA = '', jobB = '', jobC = ''
const photos: Record<string, any> = {}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ name: 'Ridgeline Roofing', primaryColor: '#c2410c', phone: '715-555-0100', email: 'office@ridgeline.example', enabledFeatures: ON } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  // The photo store: R2 in production; the harness's in-memory store stands in, on the object every photo route holds.
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
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', type: 'client' } as any).returning()
  ids.home = home.id
  jobA = await makeJob('1 Shingle Way', { claimNumber: 'CLM-77', insuranceCompany: 'Acme Mutual' })
  jobB = await makeJob('2 Ridge Road')
  jobC = await makeJob('3 Eave Street')
  // The field seat works job A and nothing else (it reads only its own jobs).
  await t.db.update(t.schema.job).set({ assignedSalesRepId: ids.field } as any).where(eq(t.schema.job.id, jobA))

  photos.damage = (await addPhoto('owner', jobA, { photoType: 'damage', caption: 'Hail hits on the north slope', latitude: '43.8014', longitude: '-91.4396', takenAt: '2026-03-04T20:15:00Z' })).body
  photos.before = (await addPhoto('owner', jobA, { photoType: 'before', caption: 'Ridge before <b>work</b>' })).body
  photos.general = (await addPhoto('owner', jobA, { caption: 'Truck in the driveway' })).body
  photos.other = (await addPhoto('owner', jobB, { photoType: 'damage', caption: 'Other house, other roof' })).body
}, 120_000)

describe('a photo remembers where and when the phone took it', () => {
  test('the coordinates and the time the phone sent are kept; without them the upload time stands and there is no place', async () => {
    expect(photos.damage).toMatchObject({ photoType: 'damage', latitude: '43.8014000', longitude: '-91.4396000' })
    expect(new Date(photos.damage.takenAt).toISOString()).toBe('2026-03-04T20:15:00.000Z')
    expect([photos.before.latitude, photos.before.longitude]).toEqual([null, null])
    expect(Math.abs(Date.now() - new Date(photos.before.takenAt).getTime())).toBeLessThan(60_000)
  })
  test('one coordinate alone, one out of range, or an unreadable time is refused, naming the box; a time in the future is the upload time', async () => {
    const lonly = await addPhoto('owner', jobA, { latitude: '43.8' })
    expect([lonly.status, Object.keys(lonly.body.fields)]).toEqual([400, ['longitude']])
    const far = await addPhoto('owner', jobA, { latitude: '95', longitude: '10' })
    expect([far.status, Object.keys(far.body.fields)]).toEqual([400, ['latitude']])
    const bad = await addPhoto('owner', jobA, { takenAt: 'yesterday-ish' })
    expect([bad.status, Object.keys(bad.body.fields)]).toEqual([400, ['takenAt']])
    const future = await addPhoto('owner', jobA, { takenAt: '2999-01-01T00:00:00Z', caption: 'fast clock' })
    expect(future.status).toBe(201)
    expect(new Date(future.body.takenAt).getFullYear()).toBeLessThan(2100)
    await as('owner')(`/api/jobs/${jobA}/photos/${future.body.id}`, { method: 'DELETE' })
  })
})

describe('building a report', () => {
  test('is a roofing feature that is not ready: registered for crm-roof, hidden, so no plan or owner switches it on yet', () => {
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'inspection_reports')!
    expect([f.templates, f.hidden]).toEqual([['crm-roof'], true])
    expect(getAdvertisableFeaturesForTemplate('crm-roof').map((x: any) => x.id)).not.toContain('inspection_reports')
  })
  test('with no sections named it takes the job’s damage photos and before photos, each in a section, and not the general ones', async () => {
    const r = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobA } }))
    expect(r.status).toBe(201)
    expect(r.body.title).toContain('1 Shingle Way')
    expect(r.body.sections.map((s: any) => [s.title, s.photos.map((p: any) => p.id)])).toEqual([['Damage found', [photos.damage.id]], ['Before', [photos.before.id]]])
    expect(r.body.sections[0].photos[0]).toMatchObject({ caption: 'Hail hits on the north slope', latitude: 43.8014, longitude: -91.4396 })
    expect(r.body.brand).toMatchObject({ name: 'Ridgeline Roofing', color: '#c2410c' })
    expect(r.body.link).toBeNull()
    ids.reportA = r.body.id
  })
  test('the roofer can name the sections, and only this job’s own photos can be in them', async () => {
    const mixed = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobA, title: 'Hail check', sections: [{ title: 'North slope', photoIds: [photos.damage.id, photos.other.id] }] } }))
    expect([mixed.status, mixed.body.fields?.sections]).toEqual([400, expect.any(String)])
    const own = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobA, title: 'Hail check', intro: 'Seen from the ground.', sections: [{ title: 'North slope', notes: 'Hits in a line.', photoIds: [photos.damage.id, photos.general.id, photos.damage.id] }] } }))
    expect(own.status).toBe(201)
    expect(own.body.sections[0].photos.map((p: any) => p.id)).toEqual([photos.damage.id, photos.general.id])
    expect((await as('owner')(`/api/inspection-reports/${own.body.id}`, { method: 'DELETE' })).status).toBe(204)
    const edited = await json(await as('owner')(`/api/inspection-reports/${ids.reportA}`, { method: 'PUT', json: { intro: 'Inspected after the 4 March storm.' } }))
    expect([edited.status, edited.body.intro]).toEqual([200, 'Inspected after the 4 March storm.'])
    const steal = await json(await as('owner')(`/api/inspection-reports/${ids.reportA}`, { method: 'PUT', json: { sections: [{ title: 'x', photoIds: [photos.other.id] }] } }))
    expect(steal.status).toBe(400)
  })
  test('a job that is not in this company is not found', async () => {
    expect((await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: 'nope' } })).status).toBe(404)
  })
})

describe('the private link', () => {
  let token = ''
  let tokenB = ''
  test('off by default: a guessed address finds nothing', async () => {
    expect((await t.call(`/api/inspection-report-view/${'a'.repeat(64)}`)).status).toBe(404)
    expect((await t.call('/api/inspection-report-view/not-a-token')).status).toBe(404)
  })
  test('switching it on mints a private address; the page carries the company, caption, time and GPS and none of the storage', async () => {
    const link = await json(await as('owner')(`/api/inspection-reports/${ids.reportA}/link`, { method: 'POST', json: {} }))
    expect(link.status).toBe(200)
    token = link.body.link.token
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    // Asking again keeps the same address (an earlier text keeps working).
    expect((await json(await as('owner')(`/api/inspection-reports/${ids.reportA}/link`, { method: 'POST', json: {} }))).body.link.token).toBe(token)
    const page = await t.call(link.body.link.path)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('x-robots-tag')).toContain('noindex')
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    const html = await page.text()
    expect(html).toContain('Ridgeline Roofing')
    expect(html).toContain('--brand:#c2410c')
    expect(html).toContain('1 Shingle Way')
    expect(html).toContain('Lee Marsh')
    expect(html).toContain('CLM-77')
    expect(html).toContain('Hail hits on the north slope')
    expect(html).toContain('GPS 43.80140, -91.43960')
    expect(html).toContain('Mar 4, 2026')
    // The caption was typed with markup: it is shown as text, never run.
    expect(html).toContain('Ridge before &lt;b&gt;work&lt;/b&gt;')
    expect(html).not.toContain('<b>work</b>')
    // Photos come by the link's own door, never by a stored address.
    expect(html).toContain(`${link.body.link.path}/photos/${photos.damage.id}`)
    expect(html).not.toContain('/media/photos/')
    expect(html).not.toContain('Truck in the driveway')
  })
  test('the photo door and the PDF answer for this report', async () => {
    const img = await t.call(`/api/inspection-report-view/${token}/photos/${photos.damage.id}`)
    expect([img.status, img.headers.get('content-type')]).toEqual([200, 'image/png'])
    const pdf = await t.call(`/api/inspection-report-view/${token}/pdf`)
    expect([pdf.status, pdf.headers.get('content-type')]).toEqual([200, 'application/pdf'])
    expect(pdf.headers.get('content-disposition')).toContain('inspection-report-')
    const bytes = new Uint8Array(await pdf.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(2000)
    // The office's own download is the same PDF, behind sign-in.
    expect((await t.call(`/api/inspection-reports/${ids.reportA}/pdf`)).status).toBe(401)
    const mine = await as('viewer')(`/api/inspection-reports/${ids.reportA}/pdf`)
    expect([mine.status, mine.headers.get('content-type')]).toEqual([200, 'application/pdf'])
  })
  test('it opens THIS job’s report only: another report’s link shows its own photos, and a photo not in the report is not found', async () => {
    const b = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobB } }))
    expect(b.status).toBe(201)
    const lb = await json(await as('owner')(`/api/inspection-reports/${b.body.id}/link`, { method: 'POST', json: {} }))
    tokenB = lb.body.link.token
    expect(tokenB).not.toBe(token)
    const pageB = await (await t.call(lb.body.link.path)).text()
    expect(pageB).toContain('Other house, other roof')
    expect(pageB).not.toContain('Hail hits on the north slope')
    expect(pageB).not.toContain('CLM-77')
    // Job B's photo asked for under job A's link, and job A's general photo (in no section), are not found.
    expect((await t.call(`/api/inspection-report-view/${token}/photos/${photos.other.id}`)).status).toBe(404)
    expect((await t.call(`/api/inspection-report-view/${token}/photos/${photos.general.id}`)).status).toBe(404)
    expect((await t.call(`/api/inspection-report-view/${tokenB}/photos/${photos.damage.id}`)).status).toBe(404)
    // …even when a report names a photo that was later deleted: it drops out, nothing breaks.
    const gone = await addPhoto('owner', jobB, { photoType: 'before', caption: 'soon gone' })
    const c2 = await json(await as('owner')(`/api/inspection-reports/${b.body.id}`, { method: 'PUT', json: { sections: [{ title: 'Before', photoIds: [gone.body.id] }] } }))
    expect(c2.body.sections[0].photos).toHaveLength(1)
    await as('owner')(`/api/jobs/${jobB}/photos/${gone.body.id}`, { method: 'DELETE' })
    expect((await json(await as('owner')(`/api/inspection-reports/${b.body.id}`))).body.sections[0].photos).toHaveLength(0)
    expect((await t.call(`/api/inspection-report-view/${tokenB}`)).status).toBe(200)
  })
  test('switched off, the link stops; renewed, the old address stops and a new one works; a last day that has passed stops it', async () => {
    expect((await as('owner')(`/api/inspection-reports/${ids.reportA}/link`, { method: 'DELETE' })).status).toBe(200)
    for (const p of ['', '/pdf', `/photos/${photos.damage.id}`]) expect([p, (await t.call(`/api/inspection-report-view/${token}${p}`)).status]).toEqual([p, 404])
    const again = await json(await as('owner')(`/api/inspection-reports/${ids.reportA}/link`, { method: 'POST', json: {} }))
    const fresh = again.body.link.token
    expect(fresh).not.toBe(token)
    expect((await t.call(`/api/inspection-report-view/${token}`)).status).toBe(404)
    expect((await t.call(`/api/inspection-report-view/${fresh}`)).status).toBe(200)
    const renewed = await json(await as('owner')(`/api/inspection-reports/${ids.reportA}/link`, { method: 'POST', json: { renew: true } }))
    expect(renewed.body.link.token).not.toBe(fresh)
    expect((await t.call(`/api/inspection-report-view/${fresh}`)).status).toBe(404)
    const past = await json(await as('owner')(`/api/inspection-reports/${ids.reportA}/link`, { method: 'POST', json: { expiresAt: '2020-01-01T00:00:00Z' } }))
    expect(past.status).toBe(400)
    const soon = await json(await as('owner')(`/api/inspection-reports/${ids.reportA}/link`, { method: 'POST', json: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() } }))
    expect(soon.body.link.expiresAt).toBeTruthy()
    const live = soon.body.link.token
    expect((await t.call(`/api/inspection-report-view/${live}`)).status).toBe(200)
    await t.db.update(t.schema.inspectionReport).set({ linkExpiresAt: new Date(Date.now() - 1000) } as any).where(eq(t.schema.inspectionReport.id, ids.reportA))
    expect((await t.call(`/api/inspection-report-view/${live}`)).status).toBe(404)
    await t.db.update(t.schema.inspectionReport).set({ linkExpiresAt: null } as any).where(eq(t.schema.inspectionReport.id, ids.reportA))
    ids.liveToken = live
  })
  test('with the feature switched off the office routes and the link are not there', async () => {
    expect((await t.call(`/api/inspection-report-view/${ids.liveToken}`)).status).toBe(200)
    await setFeatures(['jobs', 'contacts', 'photo_capture'])
    expect((await t.call(`/api/inspection-report-view/${ids.liveToken}`)).status).toBe(404)
    expect((await t.call(`/api/inspection-report-view/${ids.liveToken}/pdf`)).status).toBe(404)
    expect((await as('owner')(`/api/inspection-reports?jobId=${jobA}`)).status).not.toBe(200)
    await setFeatures(ON)
    expect((await t.call(`/api/inspection-report-view/${ids.liveToken}`)).status).toBe(200)
  })
})

describe('who may do what', () => {
  const doors = async (who: string) => {
    const g = (p: string, init: any = {}) => as(who)(p, init).then((r) => r.status)
    return {
      list: await g(`/api/inspection-reports?jobId=${jobA}`),
      read: await g(`/api/inspection-reports/${ids.reportA}`),
      pdf: await g(`/api/inspection-reports/${ids.reportA}/pdf`),
      build: await g('/api/inspection-reports', { method: 'POST', json: { jobId: jobA, title: `by ${who}` } }),
      edit: await g(`/api/inspection-reports/${ids.reportA}`, { method: 'PUT', json: { intro: `by ${who}` } }),
      link: await g(`/api/inspection-reports/${ids.reportA}/link`, { method: 'POST', json: {} }),
      unlink: await g(`/api/inspection-reports/${ids.reportA}/link`, { method: 'DELETE' }) === 200 ? 200 : 0,
    }
  }
  test('owner, admin and manager read, build, edit and share', async () => {
    for (const who of ['owner', 'admin', 'manager']) expect([who, await doors(who)]).toEqual([who, { list: 200, read: 200, pdf: 200, build: 201, edit: 200, link: 200, unlink: 200 }])
  })
  test('a field seat builds and edits on its own job but cannot share the link', async () => {
    expect(await doors('field')).toEqual({ list: 200, read: 200, pdf: 200, build: 201, edit: 200, link: 403, unlink: 0 })
  })
  test('a viewer reads and downloads, and changes nothing', async () => {
    expect(await doors('viewer')).toEqual({ list: 200, read: 200, pdf: 200, build: 403, edit: 403, link: 403, unlink: 0 })
    expect((await as('viewer')(`/api/inspection-reports/${ids.reportA}`, { method: 'DELETE' })).status).toBe(403)
  })
  test('a seat that reads only its own jobs cannot reach the report of a job that is not its own', async () => {
    const c = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobC, title: 'Eave Street' } }))
    expect(c.status).toBe(201)
    expect((await as('field')(`/api/inspection-reports/${c.body.id}`)).status).toBe(404)
    expect((await as('field')(`/api/inspection-reports/${c.body.id}/pdf`)).status).toBe(404)
    expect((await as('field')(`/api/inspection-reports?jobId=${jobC}`)).status).toBe(404)
    expect((await as('field')('/api/inspection-reports', { method: 'POST', json: { jobId: jobC } })).status).toBe(404)
    expect((await as('field')(`/api/inspection-reports/${c.body.id}`, { method: 'PUT', json: { intro: 'mine now' } })).status).toBe(404)
  })
  test('nobody signed out reaches the office routes', async () => {
    for (const p of [`/api/inspection-reports?jobId=${jobA}`, `/api/inspection-reports/${ids.reportA}`, `/api/inspection-reports/${ids.reportA}/pdf`]) expect([p, (await t.call(p)).status]).toEqual([p, 401])
  })
  test('a photo’s caption is the job’s permission (jobs:update): a field seat edits it, a viewer cannot', async () => {
    const edit = await json(await as('field')(`/api/jobs/${jobA}/photos/${photos.general.id}`, { method: 'PUT', json: { caption: 'Truck, front', photoType: 'during' } }))
    expect([edit.status, edit.body.caption, edit.body.photoType]).toEqual([200, 'Truck, front', 'during'])
    expect((await as('viewer')(`/api/jobs/${jobA}/photos/${photos.general.id}`, { method: 'PUT', json: { caption: 'no' } })).status).toBe(403)
  })
})
