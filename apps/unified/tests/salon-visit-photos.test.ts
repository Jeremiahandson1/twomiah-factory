// A salon visit's before and after photos (server/crm/salon/visitPhotos.ts), through the real server. Salon live test,
// 2026-10-25: service_record.photo_before / photo_after were accepted on every write as any string at all, and nothing
// anywhere uploaded one. Now a photo reaches a visit only by being uploaded to it; a write may clear one or send back
// the one it holds; the chart hands each back at its served address, and gathers them as the client's photo history.
import { describe, test, expect, beforeAll } from 'bun:test'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
let companyId = ''
let otherCompanyId = ''
const PASSWORD = 'Pass-word-1'
let ip = 0
const signIn = async (email: string, password = PASSWORD) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password }, headers: { 'X-Forwarded-For': `198.51.100.${++ip}` } })).json()).accessToken as string
const as = (who: string, method: string, path: string, json?: unknown, init: any = {}) =>
  t.call(path, { method, json, ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s) } catch { return s } }
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a3a' } }).png().toBuffer()
const photoForm = () => { const fd = new FormData(); fd.append('photo', new File([new Uint8Array(PNG)], 'colour.png', { type: 'image/png' })); return fd }
const SALON = ['contacts', 'invoices', 'team', 'dashboard', 'client_profiles', 'service_menu', 'salon_booking', 'rebooking_reminders']

let client = ''
const newVisit = async (notes = 'Balayage') => {
  const r = await as('owner', 'POST', '/api/service-records', { contactId: client, priceCharged: 120, notes })
  expect(r.status).toBe(201)
  return body(r)
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'salon' })
  // The file store: R2 in production, the harness's in-memory one here, on the object every photo route holds.
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, b: Buffer, type: string) => { await t.store.put(key, b, type) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: (key: string) => { void t.store.remove(key); return true },
  })
  const seeded = await seedOwner(t, PASSWORD)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: SALON } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await signIn('owner@test.example')
  const hash = await Bun.password.hash(PASSWORD, 'bcrypt')
  await t.db.insert(t.schema.user).values({ email: 'desk@test.example', passwordHash: hash, firstName: 'Fran', lastName: 'Desk', role: 'viewer', companyId })
  tokens.desk = await signIn('desk@test.example')
  await t.db.insert(t.schema.user).values({ email: 'stylist@test.example', passwordHash: hash, firstName: 'Sam', lastName: 'Stylist', role: 'field', companyId })
  tokens.stylist = await signIn('stylist@test.example')
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Salon', slug: 'other-salon', enabledFeatures: SALON } as any).returning()
  otherCompanyId = other.id
  await t.db.insert(t.schema.user).values({ email: 'other@test.example', passwordHash: hash, firstName: 'O', lastName: 'Ther', role: 'owner', companyId: other.id })
  tokens.other = await signIn('other@test.example')
  client = (await body(await as('owner', 'POST', '/api/contacts', { name: 'Photo Client', type: 'client' }))).id
}, 120_000)

describe('a visit photo is uploaded to the visit, never named in a write', () => {
  test('an address in a create, a merge or an edit is refused; clearing and sending back the same are not', async () => {
    const created = await as('owner', 'POST', '/api/service-records', { contactId: client, notes: 'Cut', photoBefore: 'https://tracker.example/x.jpg' })
    expect(created.status).toBe(400)
    expect((await body(created)).code).toBe('PHOTO_NOT_UPLOADED')

    const visit = await newVisit()
    expect(visit.photoBeforeUrl).toBeNull()
    expect(visit.photoAfterUrl).toBeNull()
    for (const value of ['javascript:alert(1)', `/api/documents/file/${companyId}/x.jpg`, `${companyId}/service-records/${visit.id}/not-a-key.png`]) {
      const r = await as('owner', 'PUT', `/api/service-records/${visit.id}`, { photoAfter: value })
      expect(r.status).toBe(400)
      expect((await body(r)).code).toBe('PHOTO_NOT_UPLOADED')
    }
    // nothing was stored by the refusals
    const [row] = await t.db.select().from(t.schema.serviceRecord).where(eq(t.schema.serviceRecord.id, visit.id))
    expect(row.photoAfter).toBeNull()
    // an empty value is "no photo", which is allowed
    expect((await as('owner', 'PUT', `/api/service-records/${visit.id}`, { photoAfter: '', notes: 'Balayage, toned' })).status).toBe(200)
  })

  test('upload, serve, read back on the record and the chart, send back unchanged, replace, clear', async () => {
    const visit = await newVisit('Colour')
    const up = await as('owner', 'POST', `/api/service-records/${visit.id}/photos/before`, undefined, { body: photoForm() })
    expect(up.status).toBe(201)
    const withBefore = await body(up)
    expect(withBefore.photoBeforeUrl).toBe(`/api/service-records/${visit.id}/photos/before/file`)
    expect(withBefore.photoAfterUrl).toBeNull()
    // stored privately, under the company and the visit
    const key = withBefore.photoBefore as string
    expect(key.startsWith(`${companyId}/service-records/${visit.id}/`)).toBe(true)
    expect(t.store.objects.has(key)).toBe(true)

    const file = await as('owner', 'GET', withBefore.photoBeforeUrl)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/jpeg')
    expect(file.headers.get('cache-control')).toContain('no-store')

    // the record and the list carry the address
    expect((await body(await as('owner', 'GET', `/api/service-records/${visit.id}`))).photoBeforeUrl).toBe(withBefore.photoBeforeUrl)
    const listed = (await body(await as('owner', 'GET', `/api/service-records?contactId=${client}`))).data.find((r: any) => r.id === visit.id)
    expect(listed.photoBeforeUrl).toBe(withBefore.photoBeforeUrl)

    // an edit that sends back what it read keeps the photo
    const echoed = await as('owner', 'PUT', `/api/service-records/${visit.id}`, { photoBefore: key, notes: 'Colour, glossed' })
    expect(echoed.status).toBe(200)
    expect((await body(echoed)).photoBeforeUrl).toBe(withBefore.photoBeforeUrl)

    // a second upload replaces the first, and the first file goes
    const again = await body(await as('owner', 'POST', `/api/service-records/${visit.id}/photos/before`, undefined, { body: photoForm() }))
    expect(again.photoBefore).not.toBe(key)
    expect(t.store.objects.has(key)).toBe(false)
    expect(t.store.objects.has(again.photoBefore)).toBe(true)

    // the after photo, then the client's photo history on the chart: both, newest visit first, with the visit named
    const after = await body(await as('owner', 'POST', `/api/service-records/${visit.id}/photos/after`, undefined, { body: photoForm() }))
    expect(after.photoAfterUrl).toBe(`/api/service-records/${visit.id}/photos/after/file`)
    const chart = await body(await as('owner', 'GET', `/api/clients/${client}`))
    const onChart = chart.serviceRecords.find((r: any) => r.id === visit.id)
    expect(onChart.photoBeforeUrl).toBe(withBefore.photoBeforeUrl)
    expect(onChart.photoAfterUrl).toBe(after.photoAfterUrl)
    const history = chart.photos.filter((p: any) => p.recordId === visit.id)
    expect(history.map((p: any) => p.slot)).toEqual(['before', 'after'])
    expect(history[0]).toMatchObject({ url: withBefore.photoBeforeUrl, recordId: visit.id })
    expect(history[0].performedAt).toBeTruthy()

    // clearing in an edit removes the photo and its file
    const cleared = await body(await as('owner', 'PUT', `/api/service-records/${visit.id}`, { photoAfter: null }))
    expect(cleared.photoAfterUrl).toBeNull()
    expect(t.store.objects.has(after.photoAfter)).toBe(false)
    expect((await as('owner', 'GET', `/api/service-records/${visit.id}/photos/after/file`)).status).toBe(404)

    // removing one with its own button does the same
    const del = await as('owner', 'DELETE', `/api/service-records/${visit.id}/photos/before`)
    expect(del.status).toBe(200)
    expect((await body(del)).photoBeforeUrl).toBeNull()
    expect(t.store.objects.has(again.photoBefore)).toBe(false)
    expect((await as('owner', 'DELETE', `/api/service-records/${visit.id}/photos/before`)).status).toBe(404)
    const chartAfter = await body(await as('owner', 'GET', `/api/clients/${client}`))
    expect(chartAfter.photos.some((p: any) => p.recordId === visit.id)).toBe(false)
  })

  test('a value nobody uploaded is never offered as a picture, nor served', async () => {
    const visit = await newVisit('Old import')
    // what the template's routes let a write store
    await t.db.update(t.schema.serviceRecord).set({ photoBefore: 'https://tracker.example/pixel.gif', photoAfter: `${otherCompanyId}/service-records/x/00000000-0000-0000-0000-000000000000.jpg` } as any)
      .where(eq(t.schema.serviceRecord.id, visit.id))
    const read = await body(await as('owner', 'GET', `/api/service-records/${visit.id}`))
    expect(read.photoBeforeUrl).toBeNull()
    expect(read.photoAfterUrl).toBeNull()
    expect((await as('owner', 'GET', `/api/service-records/${visit.id}/photos/before/file`)).status).toBe(404)
    expect((await as('owner', 'GET', `/api/service-records/${visit.id}/photos/after/file`)).status).toBe(404)
    const chart = await body(await as('owner', 'GET', `/api/clients/${client}`))
    expect(chart.photos.some((p: any) => p.recordId === visit.id)).toBe(false)
    // and it can still be cleared
    expect((await as('owner', 'PUT', `/api/service-records/${visit.id}`, { photoBefore: null, photoAfter: null })).status).toBe(200)
  })

  test('not a photo, not a slot, not this company, not this seat', async () => {
    const visit = await newVisit('Trim')
    const notPhoto = new FormData()
    notPhoto.append('photo', new File([new TextEncoder().encode('<html>hi</html>')], 'x.png', { type: 'image/png' }))
    expect((await as('owner', 'POST', `/api/service-records/${visit.id}/photos/before`, undefined, { body: notPhoto })).status).toBe(400)
    expect((await as('owner', 'POST', `/api/service-records/${visit.id}/photos/before`, undefined, { body: new FormData() })).status).toBe(400)
    expect((await as('owner', 'POST', `/api/service-records/${visit.id}/photos/during`, undefined, { body: photoForm() })).status).toBe(404)
    expect((await as('other', 'POST', `/api/service-records/${visit.id}/photos/before`, undefined, { body: photoForm() })).status).toBe(404)

    // a stylist edits the visit (schedule:update) and adds its photos; the front desk reads them and changes nothing
    const up = await as('stylist', 'POST', `/api/service-records/${visit.id}/photos/after`, undefined, { body: photoForm() })
    expect(up.status).toBe(201)
    const url = (await body(up)).photoAfterUrl
    expect((await as('desk', 'GET', url)).status).toBe(200)
    expect((await as('desk', 'POST', `/api/service-records/${visit.id}/photos/before`, undefined, { body: photoForm() })).status).toBe(403)
    expect((await as('desk', 'DELETE', `/api/service-records/${visit.id}/photos/after`)).status).toBe(403)
    expect((await as('other', 'GET', url)).status).toBe(404)
  })

  test('deleting the visit removes its photo files', async () => {
    // (every deletion path is below; this one is the visit's own Delete)
    const visit = await newVisit('Gloss')
    const key = (await body(await as('owner', 'POST', `/api/service-records/${visit.id}/photos/before`, undefined, { body: photoForm() }))).photoBefore
    expect(t.store.objects.has(key)).toBe(true)
    expect((await as('owner', 'DELETE', `/api/service-records/${visit.id}`)).status).toBe(200)
    expect(t.store.objects.has(key)).toBe(false)
  })
})

// A visit row going away takes its photo files with it on EVERY path (visitPhotos.ts visitPhotoFilesOf /
// removeVisitPhotoFiles): the visit's Delete (above), a completed appointment reopened, the legacy repair, and its
// client deleted — in bulk, or alone — where the database's cascade takes the rows and no visit route runs.
describe('every way a visit goes away takes its photo files', () => {
  const yesterday = () => new Date(Date.now() - 86400000).toISOString()
  /** A completed appointment's visit (the record Complete writes), with a before photo on it. */
  const completedVisitWithPhoto = async (contactId: string) => {
    const appt = await body(await as('owner', 'POST', '/api/appointments', { contactId, startTime: yesterday() }))
    expect(appt.id).toBeTruthy()
    expect((await as('owner', 'PUT', `/api/appointments/${appt.id}`, { status: 'completed' })).status).toBe(200)
    const [rec] = await t.db.select().from(t.schema.serviceRecord).where(eq(t.schema.serviceRecord.appointmentId, appt.id))
    const up = await body(await as('owner', 'POST', `/api/service-records/${rec.id}/photos/before`, undefined, { body: photoForm() }))
    expect(t.store.objects.has(up.photoBefore)).toBe(true)
    return { apptId: appt.id as string, visitId: rec.id as string, key: up.photoBefore as string }
  }
  const visitGone = async (id: string) => (await t.db.select().from(t.schema.serviceRecord).where(eq(t.schema.serviceRecord.id, id))).length === 0

  test('a completed appointment reopened (cancelled): its visit and the photo file go', async () => {
    const v = await completedVisitWithPhoto(client)
    expect((await as('owner', 'PUT', `/api/appointments/${v.apptId}`, { status: 'cancelled' })).status).toBe(200)
    expect(await visitGone(v.visitId)).toBe(true)
    expect(t.store.objects.has(v.key)).toBe(false)
  })

  test('the legacy repair removing a cancelled appointment\'s visit removes its photo file', async () => {
    const v = await completedVisitWithPhoto(client)
    // what the old write paths left behind: an appointment cancelled under a visit that stayed
    await t.db.update(t.schema.appointment).set({ status: 'cancelled' } as any).where(eq(t.schema.appointment.id, v.apptId))
    const r = await body(await as('owner', 'POST', '/api/service-records/repair-legacy'))
    expect(r.removed.map((x: any) => x.id)).toContain(v.visitId)
    expect(await visitGone(v.visitId)).toBe(true)
    expect(t.store.objects.has(v.key)).toBe(false)
  })

  test('a client deleted in bulk: the cascade takes the visits, and the photo files go too', async () => {
    const doomed = (await body(await as('owner', 'POST', '/api/contacts', { name: 'Bulk Gone', type: 'client' }))).id
    const kept = (await body(await as('owner', 'POST', '/api/contacts', { name: 'Bulk Kept', type: 'client' }))).id
    const make = async (contactId: string) => {
      const v = await body(await as('owner', 'POST', '/api/service-records', { contactId, notes: 'Fringe trim' }))
      const up = await body(await as('owner', 'POST', `/api/service-records/${v.id}/photos/after`, undefined, { body: photoForm() }))
      return { id: v.id as string, key: up.photoAfter as string }
    }
    const gone = await make(doomed)
    const stays = await make(kept)
    const r = await as('owner', 'POST', '/api/bulk/contacts/delete', { ids: [doomed] })
    expect(r.status).toBe(200)
    expect(await visitGone(gone.id)).toBe(true)
    expect(t.store.objects.has(gone.key)).toBe(false)
    // another client's photo is untouched
    expect(t.store.objects.has(stays.key)).toBe(true)
  })

  test("a salon client with visits is not deleted alone (the salon's guard), so its photo files stay", async () => {
    const someone = (await body(await as('owner', 'POST', '/api/contacts', { name: 'Guarded', type: 'client' }))).id
    const v = await body(await as('owner', 'POST', '/api/service-records', { contactId: someone, notes: 'Blow-dry' }))
    const key = (await body(await as('owner', 'POST', `/api/service-records/${v.id}/photos/before`, undefined, { body: photoForm() }))).photoBefore
    expect((await as('owner', 'DELETE', `/api/contacts/${someone}`)).status).toBe(409)
    expect(t.store.objects.has(key)).toBe(true)
  })

  test('a client deleted alone where no guard keeps them (any vertical with client charts on): the photo files go', async () => {
    // A contractor's business with Client Profiles switched on: service records are served wherever the feature is
    // (crm/salon/index.ts), and this vertical's contact guards do not count them — the cascade takes them.
    const c = await bootTenant({ vertical: 'contractor' })
    Object.assign((c.services as any).crm.storage, {
      storageConfigured: () => true,
      put: async (key: string, b: Buffer, type: string) => { await c.store.put(key, b, type) },
      getObject: async (key: string) => c.store.getObject(key),
      deleteFile: (key: string) => { void c.store.remove(key); return true },
    })
    const seeded = await seedOwner(c, PASSWORD)
    await c.db.update(c.schema.company).set({ enabledFeatures: ['contacts', 'client_profiles'] } as any).where(eq(c.schema.company.id, seeded.company.id))
    const tok = (await (await c.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: PASSWORD }, headers: { 'X-Forwarded-For': '198.51.100.250' } })).json()).accessToken
    const call = (method: string, path: string, json?: unknown, init: any = {}) => c.call(path, { method, json, ...init, headers: { Authorization: `Bearer ${tok}` } })
    const who = await (await call('POST', '/api/contacts', { name: 'Alone', type: 'client' })).json()
    const v = await (await call('POST', '/api/service-records', { contactId: who.id, notes: 'Consult' })).json()
    expect(v.id).toBeTruthy()
    const key = (await (await call('POST', `/api/service-records/${v.id}/photos/before`, undefined, { body: photoForm() })).json()).photoBefore
    expect(c.store.objects.has(key)).toBe(true)
    const del = await call('DELETE', `/api/contacts/${who.id}`)
    expect(del.status).toBe(204)
    expect((await c.db.select().from(c.schema.serviceRecord).where(eq(c.schema.serviceRecord.id, v.id))).length).toBe(0)
    expect(c.store.objects.has(key)).toBe(false)
  }, 120_000)
})
