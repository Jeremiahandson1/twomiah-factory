// The material order, finished (docs/parity/roof-material-list.md #8, #14), through the real server as the roofing vertical:
//   · the order carries the roofer's PO number, a delivery date and a point of contact — from the list and from the plain order
//     form — and a blank clears one; a bad contact email is refused;
//   · the Materials dashboard sorts the whole list on status, PO number, job, address, supplier, order date, delivery and amount,
//     either way, with blanks last; an unknown column is refused; and the amount (what the business paid) sorts only for a seat
//     that may see it.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { inflateSync } from 'node:zlib'
import { bootTenant, seedOwner } from './harness.ts'

/** The text a PDF draws: pdfkit writes each page's content stream deflated, its strings as hex runs inside TJ arrays. */
function pdfText(buf: Uint8Array): string {
  const raw = Buffer.from(buf).toString('latin1')
  let out = ''
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string
    try { body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { continue }
    for (const tj of body.matchAll(/\[(.*?)\]\s*TJ/g)) { for (const h of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1'); out += '\n' }
  }
  return out
}

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const FEATURES = ['jobs', 'contacts', 'materials', 'roof_material_list']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })
const call = async (who: string, method: string, p: string, body?: unknown) => json(await as(who)(p, { method, ...(body === undefined ? {} : { json: body }) }))
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['mgr', 'manager'], ['view', 'viewer']] as const) {
    ids[key] = (await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId })).id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  ids.home = (await ins(t.schema.contact, { companyId, name: 'Lee Marsh', mobile: '715-555-0101', type: 'client' })).id
}, 120_000)

async function makeJob(address = '12 Gable Ln') {
  const made = await call('owner', 'POST', '/api/jobs', { contactId: ids.home, jobType: 'retail', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301', totalSquares: 30 })
  expect(made.status).toBe(201)
  return made.body.id as string
}
const order = (jobId: string, extra: Record<string, unknown> = {}) =>
  call('mgr', 'POST', '/api/materials', { jobId, supplier: 'ABC Supply', lineItems: [{ description: 'Shingles', qty: 10, unit: 'bundle', unitPrice: 40 }], ...extra })

describe('PO number, delivery date and point of contact', () => {
  test('the plain order form keeps them, and a blank clears one', async () => {
    const jobId = await makeJob()
    const made = await order(jobId, { poNumber: ' PO-1001 ', deliveryDate: '2026-11-05', contactName: 'Sam Foreman', contactPhone: '715-555-0188', contactEmail: 'sam@crew.example' })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ poNumber: 'PO-1001', contactName: 'Sam Foreman', contactPhone: '715-555-0188', contactEmail: 'sam@crew.example' })
    expect(String(made.body.deliveryDate)).toContain('2026-11-05')
    const edited = await call('mgr', 'PUT', `/api/materials/${made.body.id}`, { poNumber: '', contactName: 'Sam F.' })
    expect(edited.body).toMatchObject({ poNumber: null, contactName: 'Sam F.', contactPhone: '715-555-0188' })
    ids.po = made.body.id
  })

  test('an order from the material list takes them too; a bad contact email is refused on both doors', async () => {
    const jobId = await makeJob('14 Gable Ln')
    const lines = [{ description: 'Shingles', qty: 99, unit: 'bundle' }]
    const made = await call('mgr', 'POST', `/api/material-list/jobs/${jobId}/order`, { supplier: 'ABC Supply', lines, deliveryDate: '2026-11-07', poNumber: 'PO-77', contactName: 'Dana', contactPhone: '715-555-0100', contactEmail: 'dana@crew.example' })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ poNumber: 'PO-77', contactName: 'Dana', contactPhone: '715-555-0100', contactEmail: 'dana@crew.example' })
    expect(String(made.body.deliveryDate)).toContain('2026-11-07')
    expect((await call('mgr', 'POST', `/api/material-list/jobs/${jobId}/order`, { supplier: 'ABC Supply', lines, contactEmail: 'not an email' })).status).toBe(400)
    expect((await order(jobId, { contactEmail: 'nope' })).status).toBe(400)
  })
})

describe('the Materials dashboard sorts', () => {
  beforeAll(async () => {
    const a = await makeJob('1 Alder Way'), b = await makeJob('2 Birch Way'), c = await makeJob('3 Cedar Way')
    // supplier, status, PO, delivery, address, price per bundle: arranged so no two columns sort the same way.
    await order(a, { supplier: 'Beacon Building Products', orderStatus: 'delivered', poNumber: 'PO-B', deliveryDate: '2026-12-01', deliveryAddress: '300 Zed St', orderDate: '2026-11-03', lineItems: [{ description: 'x', qty: 1, unit: 'ea', unitPrice: 300 }] })
    await order(b, { supplier: 'abc supply', orderStatus: 'ordered', poNumber: 'PO-A', deliveryDate: '2026-11-15', deliveryAddress: '100 Yew St', orderDate: '2026-11-01', lineItems: [{ description: 'x', qty: 1, unit: 'ea', unitPrice: 100 }] })
    await order(c, { supplier: 'SRS Distribution', orderStatus: 'cancelled', deliveryAddress: '200 Xan St', lineItems: [{ description: 'x', qty: 1, unit: 'ea', unitPrice: 200 }] }) // no PO, no delivery, no order date
  })
  const ask = async (who: string, qs: string) => (await call(who, 'GET', `/api/materials?${qs}&limit=100`))
  const pick = (r: any, field: string) => r.body.data.filter((o: any) => o.deliveryAddress && /St$/.test(o.deliveryAddress)).map((o: any) => o[field])

  test('each column, both ways, with blanks last', async () => {
    expect(pick(await ask('mgr', 'sort=address&dir=asc'), 'deliveryAddress')).toEqual(['100 Yew St', '200 Xan St', '300 Zed St'])
    expect(pick(await ask('mgr', 'sort=address&dir=desc'), 'deliveryAddress')).toEqual(['300 Zed St', '200 Xan St', '100 Yew St'])
    // Case does not matter: "abc supply" sorts with "Beacon", not after "SRS".
    expect(pick(await ask('mgr', 'sort=supplier&dir=asc'), 'supplier')).toEqual(['abc supply', 'Beacon Building Products', 'SRS Distribution'])
    expect(pick(await ask('mgr', 'sort=status&dir=asc'), 'orderStatus')).toEqual(['cancelled', 'delivered', 'ordered'])
    expect(pick(await ask('mgr', 'sort=amount&dir=desc'), 'totalCost')).toEqual(['300.00', '200.00', '100.00'])
    expect(pick(await ask('mgr', 'sort=amount&dir=asc'), 'totalCost')).toEqual(['100.00', '200.00', '300.00'])
    // The order with no PO / delivery / order date goes last both ways.
    for (const [sort, field] of [['po', 'poNumber'], ['delivery', 'deliveryDate'], ['orderDate', 'orderDate']] as const) {
      const up = pick(await ask('mgr', `sort=${sort}&dir=asc`), field), down = pick(await ask('mgr', `sort=${sort}&dir=desc`), field)
      expect([up[2], down[2]]).toEqual([null, null])
      expect(up.slice(0, 2).reverse()).toEqual(down.slice(0, 2))
    }
    const jobs = (await ask('mgr', 'sort=job&dir=desc')).body.data.map((o: any) => o.jobNumber)
    expect([...jobs]).toEqual([...jobs].sort().reverse())
  })

  test('an unknown column or direction is refused; the amount sorts only for a seat that may see amounts', async () => {
    expect((await ask('mgr', 'sort=password')).status).toBe(400)
    expect((await ask('mgr', 'sort=status&dir=sideways')).status).toBe(400)
    const denied = await ask('view', 'sort=amount')
    expect(denied.status).toBe(403)
    const ok = await ask('view', 'sort=supplier&dir=asc')
    expect(ok.status).toBe(200)
    expect(ok.body.data.every((o: any) => o.totalCost === undefined)).toBe(true)
  })
})

describe('the printable order', () => {
  test('a PDF with the supplier, PO number, delivery, contact and lines — and the prices only for a seat that may see them', async () => {
    const jobId = await makeJob('22 Gable Ln')
    const made = await order(jobId, {
      supplier: 'ABC Supply', poNumber: 'PO-2044', deliveryDate: '2026-11-05', deliveryAddress: '22 Gable Ln, Akron, OH', contactName: 'Sam Foreman', contactPhone: '715-555-0188',
      notes: 'Leave on the driveway, not the lawn.', lineItems: [{ description: 'GAF Timberline HDZ shingles', qty: 99, unit: 'bundle', unitPrice: 41.5 }, { description: 'Starter strip', qty: 3, unit: 'bundle', unitPrice: 30 }],
    })
    expect(made.status).toBe(201)
    const asked = await as('mgr')(`/api/material-list/orders/${made.body.id}/pdf`)
    expect(asked.status).toBe(200)
    expect(asked.headers.get('content-type')).toBe('application/pdf')
    expect(asked.headers.get('content-disposition')).toContain('material-order-PO-2044.pdf')
    const bytes = new Uint8Array(await asked.arrayBuffer())
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF')
    const text = pdfText(bytes)
    for (const want of ['MATERIAL ORDER', 'PO-2044', 'ABC Supply', '22 Gable Ln, Akron, OH', 'Nov 5, 2026', 'Sam Foreman', '715-555-0188', 'GAF Timberline HDZ shingles', 'Starter strip', 'Leave on the driveway']) expect(text).toContain(want)
    // 99 × $41.50 + 3 × $30.00 = $4,198.50 — for the seat that sees what the business paid.
    expect(text).toContain('$4,198.50')
    expect(text).toContain('$41.50')
    const plain = pdfText(new Uint8Array(await (await as('view')(`/api/material-list/orders/${made.body.id}/pdf`)).arrayBuffer()))
    expect(plain).toContain('GAF Timberline HDZ shingles')
    expect(plain).not.toMatch(/\$|4,198|41\.50/)
    ids.pdfOrder = made.body.id
  })

  test('another company\'s order and an unknown one are not there; with the feature off the door is closed', async () => {
    const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing' } as any).returning()
    const oj = await ins(t.schema.job, { companyId: other.id, title: '9 Elm', number: 'ROOF-0001', status: 'lead' })
    const foreign = await ins(t.schema.material, { companyId: other.id, jobId: oj.id, supplier: 'ABC', lineItems: [], orderStatus: 'ordered' })
    expect((await as('owner')(`/api/material-list/orders/${foreign.id}/pdf`)).status).toBe(404)
    expect((await as('owner')('/api/material-list/orders/nope/pdf')).status).toBe(404)
    await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'materials'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect((await as('owner')(`/api/material-list/orders/${ids.pdfOrder}/pdf`)).status).toBeGreaterThanOrEqual(400)
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
  })
})
