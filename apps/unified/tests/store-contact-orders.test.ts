// A shopper's contact page lists their store orders (docs/UNIFIED_STORE_PLAN.md decision 2: a shopper is a contact):
// the `orders` relation on GET /api/contacts/:id (server/modules/crm.ts), for the store only, newest first, only the
// columns the page reads, only that contact's, and only to a seat that may open the orders (orders:read).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const S = () => t.schema as any

const as = (who: string) => async (path: string) => {
  const res = await t.call(path, { method: 'GET', headers: { Authorization: `Bearer ${tokens[who]}` } })
  return { status: res.status, json: await res.json() as any }
}

let pat: any, sam: any
const ids: Record<string, string> = {}
let n = 0
const mkOrder = async (contactId: string | null, status: string, createdAt: Date) => {
  n++
  const [o] = await (t.db as any).insert(S().storeOrder).values({
    companyId, contactId, orderNumber: status === 'pending' ? null : `ORD-C${n}`, provider: 'stripe', providerSessionId: `cs_${n}`,
    status, customerEmail: 'pat@example.com', subtotalCents: 1000 * n, totalCents: 1000 * n, currency: 'usd', createdAt,
  }).returning()
  return o
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const s = await seedOwner(t)
  companyId = s.company.id
  // The contacts screen is the CRM's `contacts` feature.
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tokens.owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json()).accessToken
  for (const [key, role] of [['staff', 'staff'], ['viewer', 'viewer']]) {
    await (t.db as any).insert(S().user).values({ email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key, lastName: 'Seat', role, companyId })
    tokens[key] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: 'Seat-pass-1' } })).json()).accessToken
  }
  ;[pat] = await (t.db as any).insert(S().contact).values({ companyId, name: 'Pat Shopper', email: 'pat@example.com', type: 'customer' }).returning()
  ;[sam] = await (t.db as any).insert(S().contact).values({ companyId, name: 'Sam Other', email: 'sam@example.com', type: 'customer' }).returning()
  ids.old = (await mkOrder(pat.id, 'shipped', new Date('2026-09-01T10:00:00Z'))).id
  ids.mid = (await mkOrder(pat.id, 'refunded', new Date('2026-09-15T10:00:00Z'))).id
  ids.new = (await mkOrder(pat.id, 'paid', new Date('2026-10-01T10:00:00Z'))).id
  ids.sams = (await mkOrder(sam.id, 'paid', new Date('2026-10-02T10:00:00Z'))).id
  ids.guest = (await mkOrder(null, 'pending', new Date('2026-10-03T10:00:00Z'))).id
}, 120_000)

describe("a shopper's orders on their contact page", () => {
  test('the owner reads them, newest first, with the columns the page reads', async () => {
    const r = await as('owner')(`/api/contacts/${pat.id}`)
    expect(r.status).toBe(200)
    expect(r.json.orders.map((o: any) => o.id)).toEqual([ids.new, ids.mid, ids.old])
    expect(Object.keys(r.json.orders[0]).sort()).toEqual(['createdAt', 'id', 'orderNumber', 'status', 'totalCents'])
    expect(r.json.orders[0]).toMatchObject({ orderNumber: 'ORD-C3', status: 'paid', totalCents: 3000 })
  })

  test("only that contact's: another shopper's order and a guest order are not on the page", async () => {
    const r = await as('owner')(`/api/contacts/${sam.id}`)
    expect(r.json.orders.map((o: any) => o.id)).toEqual([ids.sams])
  })

  test('staff (orders:read) read them; a seat without orders:read is not sent the list at all', async () => {
    const staff = await as('staff')(`/api/contacts/${pat.id}`)
    expect(staff.status).toBe(200)
    expect(staff.json.orders.length).toBe(3)
    const viewer = await as('viewer')(`/api/contacts/${pat.id}`)
    expect(viewer.status).toBe(200)
    expect('orders' in viewer.json).toBe(false)
  })
})

describe('another vertical', () => {
  test('a contractor contact has no orders list', async () => {
    const other = await bootTenant({ vertical: 'contractor' })
    const s = await seedOwner(other)
    await other.db.update(other.schema.company).set({ enabledFeatures: ['contacts'] } as any).where(eq(other.schema.company.id, s.company.id))
    other.services.features.forgetFeatures()
    const token = (await (await other.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json()).accessToken
    const [c] = await (other.db as any).insert((other.schema as any).contact).values({ companyId: s.company.id, name: 'Casey Client', type: 'client' }).returning()
    const r = await other.call(`/api/contacts/${c.id}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } })
    expect(r.status).toBe(200)
    expect('orders' in (await r.json() as any)).toBe(false)
  }, 120_000)
})
