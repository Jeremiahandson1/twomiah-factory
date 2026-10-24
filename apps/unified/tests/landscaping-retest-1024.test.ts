// The landscaping full live retest of 2026-10-24, through the real server and the real login:
//   1. the audit log's "Create (971) / Ticket (883)" was POST /api/live/ticket — a live-updates ticket every open screen
//      asks for on each (re)connect — filed by the write floor as a change; it is not a change and is no longer logged;
//   3. a crew (field) seat sees the jobs assigned to it and the customers on those jobs — not the whole business — and
//      not Reviews' settings (Jobber's rule; permissions jobs:read-all / contacts:read-all, withheld by landscaping);
//   4. a job note is stamped readable on the business's clock, and an old ISO stamp is shown that way too;
//   7. a new map's centre is the business's own (GET /api/map-center): nothing on record answers null, never Dallas;
//   9. a Good/Better/Best option put on a quote keeps the item's cost;
//  10. Add Part takes a starting quantity, stocked at a default location made when there is none.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { stampsOnClock, setCompanyTimeZone } from '../../../packages/tenant-ui/src/time/companyClock.ts'
import { noteStamp } from '../../../packages/tenant-backend/src/time/zoneDay.ts'

type Tenant = Awaited<ReturnType<typeof bootTenant>>
const PASSWORD = 'Retest-1024-pass'

let t: Tenant
let co = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
  const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
  const text = await r.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, body }
}

let mineJob = '', otherJob = '', mineContact = '', otherContact = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  co = s.company.id
  await t.db.update(t.schema.company).set({
    timezone: 'America/Chicago',
    enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'inventory', 'parts_tracking', 'google_reviews', 'tech_mobile_view', 'fleet', 'dashboard'],
  } as any).where(eq(t.schema.company.id, co))
  const login = await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })
  tokens.owner = ((await login.json()) as any).accessToken
  ids.owner = s.owner.id
  for (const [key, role] of Object.entries({ crew: 'field', other: 'field', manager: 'manager', viewer: 'viewer' })) {
    const email = `${key}@test.example`
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co } as any).returning()
    ids[key] = u.id
    const r = await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })
    tokens[key] = ((await r.json()) as any).accessToken
  }
  const [c1] = await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Carla Crewcustomer', type: 'client' } as any).returning()
  const [c2] = await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Oscar Othercustomer', type: 'client' } as any).returning()
  mineContact = c1.id; otherContact = c2.id
  const [j1] = await t.db.insert(t.schema.job).values({ companyId: co, number: 'JOB-00001', title: 'Mow Carla', status: 'scheduled', contactId: c1.id, assignedToId: ids.crew } as any).returning()
  const [j2] = await t.db.insert(t.schema.job).values({ companyId: co, number: 'JOB-00002', title: 'Mow Oscar', status: 'scheduled', contactId: c2.id, assignedToId: ids.other } as any).returning()
  mineJob = j1.id; otherJob = j2.id
}, 120_000)

describe('1. a live-updates ticket is not a change, so it is not in the audit log', () => {
  test('POST /api/live/ticket files no audit row; a real write still does', async () => {
    const before = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.companyId, co))
    for (let i = 0; i < 3; i++) expect((await as('owner', '/api/live/ticket', 'POST')).status).toBe(200)
    const after = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.companyId, co))
    expect(after.filter((r: any) => r.entity === 'ticket').length).toBe(0)
    expect(after.length).toBe(before.length)
    expect((await as('owner', '/api/contacts', 'POST', { name: 'Audit Probe', type: 'lead' })).status).toBe(201)
    const later = await t.db.select().from(t.schema.auditLog).where(and(eq(t.schema.auditLog.companyId, co), eq(t.schema.auditLog.entity, 'contact')))
    expect(later.length).toBeGreaterThan(0)
  })
})

describe('3. a crew seat sees its own work, not the whole business', () => {
  test('the jobs list, today and a job page: only the jobs assigned to the crew login', async () => {
    const list = await as('crew', '/api/jobs')
    expect(list.status).toBe(200)
    expect(list.body.data.map((j: any) => j.id)).toEqual([mineJob])
    expect((await as('crew', `/api/jobs/${mineJob}`)).status).toBe(200)
    expect((await as('crew', `/api/jobs/${otherJob}`)).status).toBe(404)
    expect((await as('crew', `/api/jobs/${otherJob}`, 'PUT', { title: 'Taken over' })).status).toBe(404)
  })
  test('customers: only the ones on the crew\'s jobs, in the list and by id', async () => {
    const list = await as('crew', '/api/contacts')
    expect(list.status).toBe(200)
    expect(list.body.data.map((c: any) => c.id)).toEqual([mineContact])
    expect((await as('crew', `/api/contacts/${mineContact}`)).status).toBe(200)
    expect((await as('crew', `/api/contacts/${otherContact}`)).status).toBe(404)
  })
  test('global search does not search every customer and job for the crew seat', async () => {
    const r = await as('crew', '/api/search?q=Oscar')
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body.results)).not.toContain('Oscar')
  })
  test('the owner, a manager and the viewer still read the whole business', async () => {
    for (const who of ['owner', 'manager', 'viewer']) {
      const jobs = await as(who, '/api/jobs')
      expect(jobs.body.data.length).toBe(2)
      const contacts = await as(who, '/api/contacts')
      expect(contacts.body.data.length).toBeGreaterThanOrEqual(2)
    }
  })
  test('Reviews settings: read by the marketing desk, refused to the crew; saved by settings:update only', async () => {
    expect((await as('crew', '/api/reviews/settings')).status).toBe(403)
    expect((await as('manager', '/api/reviews/settings')).status).toBe(200)
    expect((await as('manager', '/api/reviews/settings', 'PUT', { reviewRequestEnabled: true })).status).toBe(403)
    expect((await as('owner', '/api/reviews/settings', 'PUT', { reviewRequestEnabled: false })).status).toBe(200)
  })
  test('the whole-business job map and team routes ask jobs:read-all', async () => {
    const r = await as('crew', '/api/maps/jobs')
    expect([403, 404]).toContain(r.status)
  })
})

describe('4. job notes are stamped on the business\'s clock, readable', () => {
  test('On my way writes a readable Central-time stamp, not an ISO instant', async () => {
    const r = await as('crew', `/api/tech/${mineJob}/on-my-way`, 'POST', {})
    expect(r.status).toBe(200)
    const [row] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, mineJob))
    expect(row.internalNotes).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(row.internalNotes).toMatch(/^\[[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M C[DS]T\] /)
  })
  test('noteStamp names the zone; an old ISO stamp is shown on the company clock', () => {
    expect(noteStamp(new Date('2026-10-24T16:54:29.885Z'), 'America/Chicago')).toBe('Oct 24, 2026, 11:54 AM CDT')
    setCompanyTimeZone('America/Chicago')
    const shown = stampsOnClock('[2026-10-24T16:54:29.885Z] Tech arrived on site')
    expect(shown).not.toContain('2026-10-24T')
    expect(shown).toContain('11:54')
    expect(shown).toContain('Tech arrived on site')
  })
})

describe('7. a new map opens on the business, never on Dallas', () => {
  test('nothing on record places the business: the answer is null (the screen shows the whole country)', async () => {
    const r = await as('crew', '/api/map-center')
    expect(r.status).toBe(200)
    expect(r.body.lat).toBeNull()
    expect(r.body.lng).toBeNull()
  })
})

describe('10. Add Part takes a starting quantity', () => {
  test('stocked at a default location made when there is none, then at that location', async () => {
    const a = await as('owner', '/api/inventory/items', 'POST', { name: 'Mower blade', startingQuantity: 5 })
    expect(a.status).toBe(201)
    const locs = await t.db.select().from(t.schema.inventoryLocation).where(eq(t.schema.inventoryLocation.companyId, co))
    expect(locs.map((l: any) => l.name)).toEqual(['Main stock'])
    const levels = await t.db.select().from(t.schema.stockLevel).where(eq(t.schema.stockLevel.itemId, a.body.id))
    expect(levels.map((l: any) => Number(l.quantity))).toEqual([5])
    const b = await as('owner', '/api/inventory/items', 'POST', { name: 'Trimmer line', startingQuantity: '3' })
    expect(b.status).toBe(201)
    expect((await t.db.select().from(t.schema.inventoryLocation).where(eq(t.schema.inventoryLocation.companyId, co))).length).toBe(1)
    const none = await as('owner', '/api/inventory/items', 'POST', { name: 'Spark plug' })
    expect(none.status).toBe(201)
    expect((await t.db.select().from(t.schema.stockLevel).where(eq(t.schema.stockLevel.itemId, none.body.id))).length).toBe(0)
  })
  test('a bad starting quantity is refused and makes no part', async () => {
    const r = await as('owner', '/api/inventory/items', 'POST', { name: 'Half a blade', startingQuantity: 1.5 })
    expect(r.status).toBe(400)
    const made = await t.db.select().from(t.schema.inventoryItem).where(and(eq(t.schema.inventoryItem.companyId, co), eq(t.schema.inventoryItem.name, 'Half a blade')))
    expect(made.length).toBe(0)
  })
})

describe('9. a pricebook option on a quote keeps the item\'s cost', () => {
  test('pricebookLine(item, option) carries unitCost', async () => {
    const { pricebookLine } = await import('../../../packages/tenant-ui/src/invoicing/ui.tsx')
    const line = pricebookLine({ id: 'p1', name: 'Mulch', price: 120, cost: 45, type: 'service' } as any, { name: 'Better', price: 150 })
    expect(line.unitPrice).toBe(150)
    expect(line.unitCost).toBe(45)
  })
})
