// Landscaping parity row 4 — takeoffs on uploaded plans (Aspire's property takeoffs; data/planTakeoffs.ts,
// crm/landscaping/planTakeoffs.ts; plan_takeoffs, not ready). Fails without the change: none of it existed.
//   · the arithmetic: a scale from a line over a known length; an area (shoelace × scale²), a length, a count;
//   · upload a plan (the bytes decide the type), read it back, save the scale and items, the server measures;
//   · the takeoff becomes quote lines — an area with an Area Pricing rate priced by the rate card, the rest quantity × unit price;
//   · a closed quote refuses; nothing measured refuses; a crew seat is refused; off, every path is shut.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { measure, scaleFrom, readItems } from '../server/data/planTakeoffs.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let owner: string
let crew: string
let siteId: string
let contactId: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const put = (token: string, path: string, json: any = {}) => as(token, path, { method: 'PUT', json })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'area_pricing', ...list] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
const upload = (token: string, bytes: Buffer, name: string, fields: Record<string, string> = {}) => {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }))
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return as(token, '/api/plan-takeoffs', { method: 'POST', body: fd })
}

describe('the arithmetic', () => {
  test('scale, area, length and count', () => {
    // A line a tenth of the page wide is 20 ft: the page is 200 ft across.
    expect(scaleFrom([0.1, 0.1], [0.2, 0.1], 20)).toBe(200)
    // A square 0.1 × 0.1 of the page = 20 ft × 20 ft = 400 sq ft.
    expect(measure({ kind: 'area', points: [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]] }, 200)).toBe(400)
    expect(measure({ kind: 'length', points: [[0, 0], [0.1, 0], [0.1, 0.05]] }, 200)).toBe(30)
    expect(measure({ kind: 'count', points: [[0, 0], [0.1, 0], [0.2, 0]] }, null)).toBe(3)
    expect(measure({ kind: 'area', points: [[0, 0], [0.1, 0], [0.1, 0.1]] }, null)).toBeNull() // no scale yet
    expect('error' in readItems([{ kind: 'area', points: [[0, 0], [1, 1]] }])).toBe(true)
    expect('error' in readItems([{ kind: 'blob', points: [[0, 0]] }])).toBe(true)
  })
})

describe('the plan screen’s routes', () => {
  beforeAll(async () => {
    t = await bootTenant({ vertical: 'landscaping' })
    const s = await seedOwner(t)
    companyId = s.company.id
    await setFeatures(['plan_takeoffs'])
    owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
    const password = 'Correct-horse-1'
    await ins(t.schema.user, { companyId, email: 'crew@test.example', firstName: 'Cam', lastName: 'Crew', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') })
    crew = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'crew@test.example', password } })).json()).accessToken
    Object.assign((t.services as any).crm.storage, { storageConfigured: () => true, put: async (k: string, b: Buffer, ty: string) => { await t.store.put(k, b, ty) }, getObject: async (k: string) => t.store.getObject(k), deleteFile: async (k: string) => { await t.store.remove(k) } })
    const ct = await ins(t.schema.contact, { companyId, name: 'Pat Plan', type: 'client' })
    contactId = ct.id
    siteId = (await ins(t.schema.site, { companyId, contactId, name: 'New build', address: '9 Oak' })).id
    await ins(t.schema.serviceRate, { companyId, serviceType: 'sod_install', areaField: 'lawnSqft', ratePer1000Sqft: '500', minCharge: '100' })
  })

  let id: string
  test('upload a plan: the bytes decide the type; it reads back', async () => {
    const bad = await upload(owner, Buffer.from('not a pdf at all'), 'x.pdf')
    expect(bad.status).toBe(400)
    const res = await upload(owner, PDF, 'Oak backyard.pdf', { siteId })
    expect(res.status).toBe(201)
    const tk = await res.json()
    id = tk.id
    expect(tk).toMatchObject({ name: 'Oak backyard', siteId, contactId, fileType: 'application/pdf', feetPerWidth: null })
    const file = await as(owner, `/api/plan-takeoffs/${id}/file`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')
  })

  test('save the scale and items; the server measures them', async () => {
    const res = await put(owner, `/api/plan-takeoffs/${id}`, {
      feetPerWidth: 200, pageAspect: 1.3,
      items: [
        { id: 'a', kind: 'area', label: 'Back lawn', serviceType: 'sod_install', points: [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]] }, // 400 sq ft
        { id: 'b', kind: 'length', label: 'Steel edging', unitPrice: 4.5, points: [[0, 0], [0.1, 0], [0.1, 0.05]] }, // 30 ft
        { id: 'c', kind: 'count', label: 'Boxwood', unitPrice: 35, points: [[0.2, 0.2], [0.3, 0.2]] }, // 2
      ],
    })
    expect(res.status).toBe(200)
    const tk = await res.json()
    expect(tk.items.map((i: any) => [i.quantity, i.unit])).toEqual([[400, 'sq ft'], [30, 'ft'], [2, 'each']])
    expect((await put(owner, `/api/plan-takeoffs/${id}`, { items: [{ kind: 'area', points: [[0, 0]] }] })).status).toBe(400)
  })

  test('the takeoff becomes quote lines: the rate card prices the area, the rest quantity × price; a closed quote refuses', async () => {
    const lines = await (await as(owner, `/api/plan-takeoffs/${id}/lines`)).json()
    expect(lines.lines.map((l: any) => [l.quantity, l.unitPrice])).toEqual([[1, 200], [30, 4.5], [2, 35]]) // 400/1000 × 500 = 200 ≥ 100
    const q = await ins(t.schema.quote, { companyId, contactId, number: 'Q-PLAN-1', name: 'Oak', status: 'draft', subtotal: '0', total: '0' })
    const res = await post(owner, `/api/plan-takeoffs/${id}/quote`, { quoteId: q.id, itemIds: ['a', 'c'] })
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.lines.length).toBe(2)
    expect(Number(out.quote.total)).toBe(270)
    expect(out.lines[0].description).toMatch(/Back lawn — 400 sq ft @ \$500(\.00)?\/1,000 sq ft \(plan: Oak backyard\)/)
    const won = await ins(t.schema.quote, { companyId, contactId, number: 'Q-PLAN-2', name: 'Done', status: 'approved', subtotal: '0', total: '0' })
    expect((await post(owner, `/api/plan-takeoffs/${id}/quote`, { quoteId: won.id })).status).toBe(409)
  })

  test('nothing measured refuses; a crew seat is refused; off, every path is shut; delete removes it', async () => {
    const other = await (await upload(owner, PDF, 'blank.pdf')).json()
    await put(owner, `/api/plan-takeoffs/${other.id}`, { items: [{ kind: 'area', points: [[0, 0], [0.1, 0], [0.1, 0.1]] }] }) // no scale
    const q = await ins(t.schema.quote, { companyId, contactId, number: 'Q-PLAN-3', name: 'X', status: 'draft', subtotal: '0', total: '0' })
    const r = await post(owner, `/api/plan-takeoffs/${other.id}/quote`, { quoteId: q.id })
    expect(r.status).toBe(409)
    expect((await r.json()).error).toMatch(/scale/)
    expect((await as(crew, '/api/plan-takeoffs')).status).toBe(403)
    await setFeatures([])
    try { expect((await as(owner, '/api/plan-takeoffs')).status).toBe(404) } finally { await setFeatures(['plan_takeoffs']) }
    expect((await as(owner, `/api/plan-takeoffs/${other.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await as(owner, `/api/plan-takeoffs/${other.id}`)).status).toBe(404)
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'plan_takeoffs') as any
    expect(f?.hidden).toBeFalsy()
    expect(f?.templates).toEqual(['crm-landscaping'])
  })
})
