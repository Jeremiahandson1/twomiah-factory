// Row 8 of the roofing parity brief (docs/parity/roof-gbb-proposals.md #4, roof-inspection-report.md #13): drawing on a job photo,
// through the real server as the roofing vertical (the phone and the web editor send the same call, tested beside it):
//   · arrows, circles and text (shapes in fractions of the picture) are laid over the photo and kept as a MARKED COPY beside the
//     original - a photo of its own on the job; the original's file and row are not changed;
//   · saving again redraws the same copy, saving nothing removes it, naming the copy draws on its original;
//   · the rules (a mark off the picture, a stray touch, too many marks, markup in the text) and the seats;
//   · deleting a photo takes its copy with it, deleting the copy leaves the photo;
//   · the copy is pickable like any job photo: a proposal option shows it and an inspection report built from the job takes it
//     in place of the plain photo (the plain photo stays on the job);
//   · the three drawers (the server, the web editor, the phone) turn a shape into the same lines and letters.
// Nothing here reaches R2 (an in-memory store stands in) or any outside service.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getAdvertisableFeaturesForTemplate } from '@twomiah/tenant-backend'
import { primitive, markupSvg, MARKUP_COLORS, type MarkupShape } from '../server/crm/roof/photoMarkup/shapes.ts'
import { primitive as webPrimitive } from '../web/src/crm/photoMarkup.ts'
import { primitive as phonePrimitive } from '../../mobile/src/photos/markup.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const W = 400, H = 300
const GREY = await sharp({ create: { width: W, height: H, channels: 3, background: '#808080' } }).jpeg().toBuffer()
const ON = ['jobs', 'contacts', 'photo_capture', 'inspection_reports', 'quotes', 'quote_proposals', 'photo_markup']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const setFeatures = async (features: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
async function addPhoto(who: string, jobId: string, extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('photo', new File([new Uint8Array(GREY)], 'p.jpg', { type: 'image/jpeg' }))
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return json(await as(who)(`/api/jobs/${jobId}/photos`, { method: 'POST', body: fd }))
}
async function makeJob(address: string) {
  const made = await json(await as('owner')('/api/jobs', { method: 'POST', json: { contactId: ids.home, jobType: 'insurance', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301' } }))
  expect([address, made.status]).toEqual([address, 201])
  return made.body.id as string
}
const mark = (who: string, photoId: string, shapes: unknown) => as(who)(`/api/photo-markup/${photoId}`, { method: 'PUT', json: { shapes } })
const markJson = async (who: string, photoId: string, shapes: unknown) => json(await mark(who, photoId, shapes))
const listOf = async (jobId: string): Promise<any[]> => { const b = (await json(await as('owner')(`/api/jobs/${jobId}/photos`))).body; return Array.isArray(b) ? b : b.data }
const bytesOf = async (url: string) => Buffer.from(((await t.store.getObject(url.replace('/media/', ''))) as any).body)
/** How many pixels of a picture are near a colour. */
async function near(buf: Buffer, hex: string, within = 40) {
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let i = 0; i < data.length; i += info.channels) if (Math.abs(data[i] - want[0]) < within && Math.abs(data[i + 1] - want[1]) < within && Math.abs(data[i + 2] - want[2]) < within) n++
  return n
}

const CIRCLE: MarkupShape = { kind: 'circle', cx: 0.3, cy: 0.5, rx: 0.15, ry: 0.2, color: 'red' }
const ARROW: MarkupShape = { kind: 'arrow', x1: 0.9, y1: 0.1, x2: 0.55, y2: 0.45, color: 'blue' }
const TEXT: MarkupShape = { kind: 'text', x: 0.55, y: 0.75, text: 'Hail hits', color: 'yellow', size: 'large' }

let jobA = '', jobB = ''
const photos: Record<string, any> = {}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ name: 'Ridgeline Roofing', enabledFeatures: ON } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: async (key: string) => { await t.store.remove(key) },
  })
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of Object.entries({ field: 'field', viewer: 'viewer' })) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', type: 'client' } as any).returning()
  ids.home = home.id
  jobA = await makeJob('1 Shingle Way')
  jobB = await makeJob('2 Ridge Road')
  await t.db.update(t.schema.job).set({ assignedSalesRepId: ids.field } as any).where(eq(t.schema.job.id, jobA))
  photos.damage = (await addPhoto('owner', jobA, { photoType: 'damage', caption: 'North slope' })).body
  photos.before = (await addPhoto('owner', jobA, { photoType: 'before', caption: 'Ridge before' })).body
  photos.other = (await addPhoto('owner', jobB, { photoType: 'damage', caption: 'Other roof' })).body
}, 120_000)

describe('drawing on a photo', () => {
  test('is a roofing feature that is not ready: registered for crm-roof, hidden; switched off, the door is shut', async () => {
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'photo_markup')!
    expect([f.templates, f.hidden]).toEqual([['crm-roof'], true])
    expect(getAdvertisableFeaturesForTemplate('crm-roof').map((x: any) => x.id)).not.toContain('photo_markup')
    await setFeatures(ON.filter((x) => x !== 'photo_markup'))
    const off = await markJson('owner', photos.damage.id, [CIRCLE])
    await setFeatures(ON)
    expect([off.status, off.body.code]).toEqual([403, expect.any(String)])
    expect((await markJson('owner', photos.damage.id, [CIRCLE])).status).toBe(200)
    await markJson('owner', photos.damage.id, [])
  })

  test('arrows, circles and text are laid on the picture and kept as a copy beside the original, which is not touched', async () => {
    const before = await bytesOf(photos.damage.url)
    expect(await near(before, MARKUP_COLORS.red)).toBe(0)
    const r = await markJson('owner', photos.damage.id, [CIRCLE, ARROW, TEXT])
    expect(r.status).toBe(200)
    const copy = r.body.marked
    expect(r.body.original).toBe(photos.damage.id)
    expect(copy).toMatchObject({ jobId: jobA, sourcePhotoId: photos.damage.id, photoType: 'damage', caption: 'North slope' })
    expect(copy.url).not.toBe(photos.damage.url)
    expect(copy.markup).toHaveLength(3)
    const picture = await bytesOf(copy.url)
    expect(await sharp(picture).metadata()).toMatchObject({ width: W, height: H, format: 'jpeg' })
    // The circle's ring is red, the arrow blue, the lettering yellow; the grey ground is still there.
    expect(await near(picture, MARKUP_COLORS.red)).toBeGreaterThan(100)
    expect(await near(picture, MARKUP_COLORS.blue)).toBeGreaterThan(50)
    expect(await near(picture, MARKUP_COLORS.yellow, 60)).toBeGreaterThan(50)
    // The ring is where the shape said: the circle's left edge (x = 0.15 * 400 = 60, y = 150) is red, its middle is not.
    const strip = async (x: number, y: number, width: number) => { const d = await sharp(picture).extract({ left: x, top: y, width, height: 1 }).removeAlpha().raw().toBuffer(); return Array.from({ length: width }, (_, i) => [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]]) }
    expect((await strip(54, 150, 12)).some(([r, g]) => r > 150 && g < 100)).toBe(true)
    expect((await strip(114, 150, 12)).every(([r]) => Math.abs(r - 128) < 30)).toBe(true)
    // The original: same file, same row.
    expect((await bytesOf(photos.damage.url)).equals(before)).toBe(true)
    const [row] = await t.db.select().from(t.schema.jobPhoto).where(eq(t.schema.jobPhoto.id, photos.damage.id))
    expect([row.url, row.sourcePhotoId, row.markup]).toEqual([photos.damage.url, null, null])
    const list = await listOf(jobA)
    expect(list.map((p: any) => p.id)).toEqual(expect.arrayContaining([photos.damage.id, copy.id]))
    photos.copy = copy
  })

  test('saving again redraws the same copy under a new file and drops the old one; naming the copy draws on its original', async () => {
    const oldKey = photos.copy.url.replace('/media/', '')
    expect(await t.store.getObject(oldKey)).toBeTruthy()
    const again = await markJson('owner', photos.copy.id, [ARROW])
    expect(again.status).toBe(200)
    expect(again.body.original).toBe(photos.damage.id)
    expect(again.body.marked.id).toBe(photos.copy.id)
    expect(again.body.marked.url).not.toBe(photos.copy.url)
    expect(await t.store.getObject(oldKey).catch(() => null)).toBeFalsy()
    expect(await near(await bytesOf(again.body.marked.url), MARKUP_COLORS.red)).toBe(0)
    const copies = (await listOf(jobA)).filter((p: any) => p.sourcePhotoId === photos.damage.id)
    expect(copies).toHaveLength(1)
    photos.copy = again.body.marked
  })

  test('the same drawing sent twice (the phone may) leaves one copy', async () => {
    const [a, b] = await Promise.all([markJson('owner', photos.before.id, [CIRCLE]), markJson('owner', photos.before.id, [CIRCLE])])
    expect([a.status, b.status]).toEqual([200, 200])
    const copies = (await listOf(jobA)).filter((p: any) => p.sourcePhotoId === photos.before.id)
    expect(copies).toHaveLength(1)
    photos.beforeCopy = copies[0]
  })

  test('saving no marks removes the copy and leaves the photo', async () => {
    const gone = await markJson('owner', photos.beforeCopy.id, [])
    expect([gone.status, gone.body.marked]).toEqual([200, null])
    const list = (await listOf(jobA))
    expect(list.some((p: any) => p.sourcePhotoId === photos.before.id)).toBe(false)
    expect(list.some((p: any) => p.id === photos.before.id)).toBe(true)
    expect(await t.store.getObject(photos.beforeCopy.url.replace('/media/', '')).catch(() => null)).toBeFalsy()
  })
})

describe('the rules', () => {
  test('a mark off the picture, a stray touch, too many marks, an unknown colour or kind, and no shapes at all are refused', async () => {
    const bad = async (shapes: unknown) => (await markJson('owner', photos.damage.id, shapes)).status
    expect(await bad([{ ...CIRCLE, cx: 1.4 }])).toBe(400)
    expect(await bad([{ ...ARROW, x2: ARROW.x1 + 0.001, y2: (ARROW as any).y1 }])).toBe(400)
    expect(await bad([{ ...CIRCLE, rx: 0 }])).toBe(400)
    expect(await bad(Array.from({ length: 41 }, () => CIRCLE))).toBe(400)
    expect(await bad([{ ...CIRCLE, color: 'pink' }])).toBe(400)
    expect(await bad([{ kind: 'star', x: 0.1, y: 0.1, color: 'red' }])).toBe(400)
    expect(await bad([{ ...TEXT, text: 'x'.repeat(61) }])).toBe(400)
    expect(await bad([{ ...TEXT, text: '   ' }])).toBe(400)
    expect(await bad(undefined)).toBe(400)
    expect(await bad(Array.from({ length: 40 }, () => CIRCLE))).toBe(200)
    await markJson('owner', photos.damage.id, [ARROW])
  })
  test('markup in the text is stripped, not drawn or run', async () => {
    const r = await markJson('owner', photos.damage.id, [{ ...TEXT, text: '<b>Soft</b> spot <script>x</script>' }])
    expect(r.status).toBe(200)
    expect(r.body.marked.markup[0].text).toBe('Soft spot')
    await markJson('owner', photos.damage.id, [ARROW])
  })
  test('a photo that is not there, or is another company’s address, is not found', async () => {
    expect((await markJson('owner', 'no-such-photo', [CIRCLE])).status).toBe(404)
    await t.db.update(t.schema.jobPhoto).set({ url: 'https://elsewhere.example/p.jpg' } as any).where(eq(t.schema.jobPhoto.id, photos.other.id))
    expect((await markJson('owner', photos.other.id, [CIRCLE])).status).toBe(400)
    await t.db.update(t.schema.jobPhoto).set({ url: photos.other.url } as any).where(eq(t.schema.jobPhoto.id, photos.other.id))
  })
  test('the seats: a field seat marks its own job’s photo and not another job’s; a viewer reads and cannot draw', async () => {
    expect((await markJson('field', photos.damage.id, [CIRCLE])).status).toBe(200)
    expect((await markJson('field', photos.other.id, [CIRCLE])).status).toBe(404)
    expect((await markJson('viewer', photos.damage.id, [CIRCLE])).status).toBe(403)
    await markJson('owner', photos.damage.id, [ARROW])
  })
})

describe('deleting', () => {
  test('a photo takes its marked copy with it; the copy alone can be deleted and the photo stays', async () => {
    const extra = (await addPhoto('owner', jobA, { photoType: 'damage' })).body
    const made = (await markJson('owner', extra.id, [CIRCLE])).body.marked
    expect((await as('owner')(`/api/jobs/${jobA}/photos/${made.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await listOf(jobA)).some((p: any) => p.id === extra.id)).toBe(true)
    const made2 = (await markJson('owner', extra.id, [CIRCLE])).body.marked
    expect((await as('owner')(`/api/jobs/${jobA}/photos/${extra.id}`, { method: 'DELETE' })).status).toBe(204)
    const rows = await t.db.select().from(t.schema.jobPhoto).where(eq(t.schema.jobPhoto.jobId, jobA))
    expect(rows.some((p: any) => p.id === extra.id || p.id === made2.id)).toBe(false)
    expect(await t.store.getObject(made2.url.replace('/media/', '')).catch(() => null)).toBeFalsy()
  })
})

describe('using the marked copy', () => {
  test('a proposal option can show it, as it shows any of the job’s photos', async () => {
    const q = await json(await as('owner')('/api/quotes', { method: 'POST', json: { contactId: ids.home, name: 'Roof', taxRate: 0, lineItems: [{ description: 'Tear-off', quantity: 1, unitPrice: 1000 }] } }))
    const options = [
      { name: 'Good', tier: 'good', photos: [photos.copy.url], lines: [{ description: 'Shingles', quantity: 1, unitPrice: 5000 }] },
      { name: 'Better', tier: 'better', lines: [{ description: 'Better shingles', quantity: 1, unitPrice: 6500 }] },
    ]
    const saved = await json(await as('owner')(`/api/quotes/${q.body.id}/proposal`, { method: 'PUT', json: { options } }))
    expect(saved.status).toBe(200)
    expect(saved.body.proposal.options[0].photos).toEqual([photos.copy.url])
  })

  test('a report built from the job takes the marked copy in place of the photo it was drawn on, which stays on the job', async () => {
    const r = await json(await as('owner')('/api/inspection-reports', { method: 'POST', json: { jobId: jobA } }))
    expect(r.status).toBe(201)
    const damage = r.body.sections.find((s: any) => s.title === 'Damage found')
    expect(damage.photos.map((p: any) => p.id)).toEqual([photos.copy.id])
    expect(r.body.sections.find((s: any) => s.title === 'Before').photos.map((p: any) => p.id)).toEqual([photos.before.id])
    // Its private link shows the picture with the marks on it.
    const link = await json(await as('owner')(`/api/inspection-reports/${r.body.id}/link`, { method: 'POST', json: {} }))
    const img = await t.call(`${link.body.link.path}/photos/${photos.copy.id}`)
    expect(img.status).toBe(200)
    expect(await near(Buffer.from(await img.arrayBuffer()), MARKUP_COLORS.blue)).toBeGreaterThan(50)
    // The report can still be changed to the plain photo.
    const edit = await json(await as('owner')(`/api/inspection-reports/${r.body.id}`, { method: 'PUT', json: { sections: [{ title: 'Damage found', notes: '', photoIds: [photos.damage.id] }] } }))
    expect(edit.body.sections[0].photos.map((p: any) => p.id)).toEqual([photos.damage.id])
  })
})

describe('one set of rules for the lines and letters', () => {
  const sizes: Array<[number, number]> = [[400, 300], [1200, 900], [320, 568]]
  test('the web editor and the phone draw every shape exactly as the server does, at any size', () => {
    for (const [w, h] of sizes) for (const s of [CIRCLE, ARROW, TEXT, { ...TEXT, size: 'small', color: 'black' } as MarkupShape, { ...ARROW, x2: 0.905, y2: 0.1 } as MarkupShape]) {
      const server = primitive(s, w, h)
      expect(webPrimitive(s, w, h)).toEqual(server)
      expect(phonePrimitive(s, w, h)).toEqual(server)
    }
  })
  test('lettering is dark-edged when light and light-edged when dark, so it reads on any roof', () => {
    expect((primitive(TEXT, 400, 300) as any).halo).toBe('#000000')
    expect((primitive({ ...TEXT, color: 'red' }, 400, 300) as any).halo).toBe('#ffffff')
    expect(markupSvg([TEXT], 400, 300)).toContain('Hail hits')
    expect(markupSvg([{ ...TEXT, text: 'a<b' }], 400, 300)).toContain('a&lt;b')
  })
})
