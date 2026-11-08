// The contractor's Sales rep and Crew (contractor live test 11/07): the rep was refused Quotes and the Lead Inbox outright ("You don't have
// access to Quotes"), and the crew read the price list's prices. Now a builder gives a login Sales rep or Crew (verticals/contractor/
// settings.ts): both the Field rung; the rep also works leads and quotes — its OWN (the leads assigned to it, the quotes it wrote) — and a
// Crew seat goes without prices:read. The office hands a lead to the rep; the rep's dashboard and Contacts count only its own.
// Through the real server as the contractor vertical; nothing reaches a real tenant.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tok: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Long-enough-pass-1'
const call = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'pricebook', 'team', 'lead_inbox', 'projects'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tok.owner = (await login('owner@test.example', s.password)).accessToken
  for (const role of ['crew', 'sales_rep']) {
    const made = await json(await call('owner', '/api/company/users', { method: 'POST', json: { email: `${role}@builder.example`, firstName: role, lastName: 'Person', role, password: PASS } }))
    expect([made.status, made.body.role ?? made.body.user?.role]).toEqual([201, role])
    ids[role] = made.body.id ?? made.body.user?.id
  }
  tok.crew = (await login('crew@builder.example', PASS)).accessToken
  tok.rep = (await login('sales_rep@builder.example', PASS)).accessToken
  expect((await call('owner', '/api/pricebook/items', { method: 'POST', json: { name: 'Drywall patch and paint', price: 250, cost: 90 } })).status).toBe(201)
}, 120_000)

test('a Sales rep holds its leads and quotes but not everyone’s; its word is Sales rep', async () => {
  const me = await login('sales_rep@builder.example', PASS)
  expect(me.user.roleLabel).toBe('Sales rep')
  expect(me.permissions).toContain('quotes:read')
  expect(me.permissions).toContain('leads:read')
  expect(me.permissions).not.toContain('quotes:read-all')
  expect(me.permissions).not.toContain('leads:read-all')
  const perms = await json(await call('rep', '/api/auth/permissions'))
  expect(perms.body.role).toBe('field')
})

test('a Crew login reads the price list without its prices', async () => {
  const me = await login('crew@builder.example', PASS)
  expect(me.user.roleLabel).toBe('Crew')
  expect(me.permissions).not.toContain('prices:read')
  const items = await json(await call('crew', '/api/pricebook/items'))
  const list = items.body.data ?? items.body
  expect(list[0].name).toBe('Drywall patch and paint')
  expect(list[0].price).toBeUndefined()
})

test('the rep reads only the quotes it wrote; the owner reads every one', async () => {
  const contact = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Hank Homeowner', email: 'hank@home.example', type: 'client' } as any).returning()) as any[])[0]
  const owners = await json(await call('owner', '/api/quotes', { method: 'POST', json: { contactId: contact.id, name: 'Office quote', taxRate: 0, lineItems: [{ description: 'Kitchen', quantity: 1, unitPrice: 1000 }] } }))
  expect(owners.status).toBe(201)
  const reps = await json(await call('rep', '/api/quotes', { method: 'POST', json: { contactId: contact.id, name: 'Rep quote', taxRate: 0, lineItems: [{ description: 'Bath', quantity: 1, unitPrice: 500 }] } }))
  expect(reps.status).toBe(201)
  const repList = await json(await call('rep', '/api/quotes'))
  expect(repList.status).toBe(200)
  expect(repList.body.data.map((q: any) => q.name)).toEqual(['Rep quote'])
  expect((await call('rep', `/api/quotes/${owners.body.id}`)).status).toBe(404)
  expect((await call('rep', `/api/quotes/${reps.body.id}`)).status).toBe(200)
  const ownerList = await json(await call('owner', '/api/quotes'))
  expect(ownerList.body.data.map((q: any) => q.name).sort()).toEqual(['Office quote', 'Rep quote'])
  // The rep's Contacts reach the customer of its own quote, and the header counts what the list shows.
  const contacts = await json(await call('rep', '/api/contacts'))
  expect(contacts.body.data.map((c: any) => c.name)).toContain('Hank Homeowner')
  const stats = await json(await call('rep', '/api/contacts/stats'))
  expect(stats.body.total).toBe(contacts.body.data.length)
}, 60_000)

test('a lead the rep adds is theirs; the office hands it out and only it can', async () => {
  const mine = await json(await call('rep', '/api/leads/manual', { method: 'POST', json: { name: 'Rita Rep-lead', phone: '715-555-0101' } }))
  expect(mine.status).toBe(201)
  expect(mine.body.assignedToId).toBe(ids.sales_rep)
  const office = await json(await call('owner', '/api/leads/manual', { method: 'POST', json: { name: 'Otto Office-lead', phone: '715-555-0102' } }))
  expect(office.status).toBe(201)
  expect(office.body.assignedToId ?? null).toBeNull()
  const repSees = await json(await call('rep', '/api/leads'))
  expect(repSees.body.data.map((l: any) => l.homeownerName)).toEqual(['Rita Rep-lead'])
  expect((await call('rep', `/api/leads/${office.body.id}`)).status).toBe(404)
  expect((await call('rep', `/api/leads/${office.body.id}/assign`, { method: 'PUT', json: { assignedToId: ids.sales_rep } })).status).toBe(404)
  // The owner gives it to the rep: the rep now reads it.
  const given = await json(await call('owner', `/api/leads/${office.body.id}/assign`, { method: 'PUT', json: { assignedToId: ids.sales_rep } }))
  expect([given.status, given.body.assignedToId]).toEqual([200, ids.sales_rep])
  expect((await json(await call('rep', '/api/leads'))).body.data.length).toBe(2)
  expect((await call('owner', `/api/leads/${office.body.id}/assign`, { method: 'PUT', json: { assignedToId: 'not-a-person' } })).status).toBe(400)
}, 60_000)

// Contractor re-check 11/08: a contact the rep added never showed in its Contacts; the rep could not make a project to quote and saw
// every project; the Crew login was offered as someone to work a lead.
test('the rep reads the contacts it added and makes its own projects, and reads only those', async () => {
  const cora = await json(await call('rep', '/api/contacts', { method: 'POST', json: { name: 'Cora Commission', email: 'cora@home.example', type: 'lead' } }))
  expect(cora.status).toBe(201)
  expect((await json(await call('rep', '/api/contacts'))).body.data.map((c: any) => c.name)).toContain('Cora Commission')
  const office = await json(await call('owner', '/api/projects', { method: 'POST', json: { name: 'Office project' } }))
  expect(office.status).toBe(201)
  const mine = await json(await call('rep', '/api/projects', { method: 'POST', json: { name: 'Cora bathroom', contactId: cora.body.id } }))
  expect(mine.status).toBe(201)
  const list = await json(await call('rep', '/api/projects'))
  expect(list.body.data.map((p: any) => p.name)).toEqual(['Cora bathroom'])
  expect((await json(await call('rep', '/api/projects/stats'))).body.total).toBe(1)
  expect((await call('rep', `/api/projects/${office.body.id}`)).status).toBe(404)
  expect((await call('rep', `/api/projects/${mine.body.id}`)).status).toBe(200)
  expect((await json(await call('owner', '/api/projects'))).body.data.length).toBe(2)
  // A quote on the rep's own project.
  const q = await json(await call('rep', '/api/quotes', { method: 'POST', json: { contactId: cora.body.id, projectId: mine.body.id, name: 'Cora bath quote', taxRate: 0, lineItems: [{ description: 'Tile', quantity: 1, unitPrice: 4000 }] } }))
  expect(q.status).toBe(201)
  // The crew still reads every project, as a field seat did.
  expect((await json(await call('crew', '/api/projects'))).body.data.length).toBe(2)
}, 60_000)

test('only the people who can work leads are offered to work one', async () => {
  const workers = await json(await call('owner', '/api/leads/workers'))
  expect(workers.status).toBe(200)
  const ids2 = workers.body.data.map((w: any) => w.id)
  expect(ids2).toContain(ids.sales_rep)
  expect(ids2).not.toContain(ids.crew)
  expect((await call('rep', '/api/leads/workers')).status).toBe(403)
  const l = await json(await call('owner', '/api/leads/manual', { method: 'POST', json: { name: 'Carl Crewlead', phone: '715-555-0103' } }))
  expect((await call('owner', `/api/leads/${l.body.id}/assign`, { method: 'PUT', json: { assignedToId: ids.crew } })).status).toBe(400)
}, 60_000)
