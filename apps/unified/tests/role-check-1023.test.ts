// The live five-role check of 2026-10-23, through the real server, every seat signed in through the real login:
//   1. inventory purchase orders: what the business pays a supplier is not every seat's — the read is inventory:read,
//      and costed for a seat without margin:read (and the cost sweep's other reads: the fleet's fuel and maintenance
//      spend, a service record's cost, the crew's hourly rates on a job, the exports, the per-report price);
//   3. a DELETE of an id that is not there (or not this company's) is a 404, not a success that deleted nothing;
//   4. every signed-in person changes their own name, phone and password, and nobody else's;
//   5. home care's Login Activity — sign-ins and IP addresses — is the owner's and the admins' (audit:read);
//   7. a staff/field seat: no takings figure in Booking insights (revenue:read), and the Lead Inbox, Lead Sources and the
//      New Leads list and tile are leads:read's — managers and up — not every seat that reads contacts.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

type Tenant = Awaited<ReturnType<typeof bootTenant>>
const PASSWORD = 'Role-check-pass-1'
const ZERO = '00000000-0000-0000-0000-000000000000'

async function seatsFor(t: Tenant, companyId: string, roles: Record<string, string>) {
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}
  for (const [key, role] of Object.entries(roles)) {
    const email = `${key}@test.example`
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId } as any).returning()
    ids[key] = u.id
    const r = await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })
    tokens[key] = ((await r.json()) as any).accessToken
  }
  return { tokens, ids }
}
const caller = (t: Tenant, tokens: Record<string, string>) => async (who: string, path: string, method = 'GET', json?: unknown) => {
  const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
  const text = await r.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, body }
}

// ── a field-service business: inventory, fleet, equipment, agreements, the receptionist, texting, the routes ──────────
let fs: Tenant
let fsCo = ''
let fsAs: ReturnType<typeof caller>
let fsIds: Record<string, string> = {}
let fsTokens: Record<string, string> = {}

beforeAll(async () => {
  fs = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(fs)
  fsCo = s.company.id
  await fs.db.update(fs.schema.company).set({
    enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'time_tracking', 'expenses', 'inventory', 'fleet', 'equipment_tracking', 'service_agreements', 'gps_tracking', 'ai_receptionist', 'two_way_texting', 'recurring_routes', 'snow_billing', 'projects', 'online_booking', 'lead_inbox', 'dashboard'],
  } as any).where(eq(fs.schema.company.id, fsCo))
  const login = await fs.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })
  const seats = await seatsFor(fs, fsCo, { admin: 'admin', manager: 'manager', staff: 'field', viewer: 'viewer' })
  seats.tokens.owner = ((await login.json()) as any).accessToken
  seats.ids.owner = s.owner.id
  fsTokens = seats.tokens
  fsAs = caller(fs, seats.tokens)
  fsIds = seats.ids
}, 120_000)

describe('1. inventory purchase orders are the buying, not the parts bin', () => {
  let poTotal = 0
  beforeAll(async () => {
    const [loc] = await fs.db.insert(fs.schema.inventoryLocation).values({ companyId: fsCo, name: 'Main warehouse', type: 'warehouse' } as any).returning()
    const [item] = await fs.db.insert(fs.schema.inventoryItem).values({ companyId: fsCo, name: 'Capacitor', sku: 'CAP-1', unitCost: '12.50', unitPrice: '40.00' } as any).returning()
    const made = await fsAs('owner', '/api/inventory/purchase-orders', 'POST', { vendor: 'Parts Co', locationId: loc.id, items: [{ itemId: item.id, quantity: 4, unitCost: 12.5 }] })
    expect(made.status).toBe(201)
    poTotal = Number(made.body.total)
    expect(poTotal).toBe(50)
  })

  test('a technician and a viewer are refused the list — the permission the cost report asks (inventory:read)', async () => {
    for (const who of ['staff', 'viewer']) {
      const r = await fsAs(who, '/api/inventory/purchase-orders')
      expect(r.status).toBe(403)
      expect(r.body.required).toBe('inventory:read')
    }
  })

  test('a manager, an admin and the owner read it, with what each order costs', async () => {
    for (const who of ['manager', 'admin', 'owner']) {
      const r = await fsAs(who, '/api/inventory/purchase-orders')
      expect(r.status).toBe(200)
      expect(Number(r.body.data[0].total)).toBe(poTotal)
      expect(r.body.pagination.total).toBe(1)
    }
  })

  test('a seat granted inventory:read without margin:read sees the orders and not their total; the count stays', async () => {
    // A fresh login (grants are cached per person for 15 s): a read-only bookkeeper the owner granted inventory:read.
    await fs.db.insert(fs.schema.user).values({ email: 'books@test.example', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: 'Bo', lastName: 'Books', role: 'viewer', companyId: fsCo, extraPermissions: ['inventory:read'] } as any)
    const login = await fs.call('/api/auth/login', { method: 'POST', json: { email: 'books@test.example', password: PASSWORD } })
    const token = ((await login.json()) as any).accessToken
    const res = await fs.call('/api/inventory/purchase-orders', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.data[0].vendor).toBe('Parts Co')
    expect('total' in body.data[0]).toBe(false)
    expect(body.pagination.total).toBe(1)
  })
})

describe('1. the cost sweep: what the business paid stays with margin:read (and pay with payroll:read)', () => {
  test("the fleet's fuel and maintenance spend: gone for a technician and a viewer, there for a manager", async () => {
    const [v] = await fs.db.insert(fs.schema.vehicle).values({ companyId: fsCo, name: 'Van 1' } as any).returning()
    await fs.db.insert(fs.schema.vehicleMaintenance).values({ vehicleId: v.id, type: 'oil', cost: '89.00' } as any)
    await fs.db.insert(fs.schema.fuelLog).values({ vehicleId: v.id, gallons: '10', pricePerGallon: '3.500', totalCost: '35.00' } as any)
    for (const who of ['staff', 'viewer']) {
      const one = await fsAs(who, `/api/fleet/vehicles/${v.id}`)
      expect(one.status).toBe(200)
      expect(JSON.stringify(one.body)).not.toMatch(/"(cost|totalCost|pricePerGallon)"/)
      const stats = await fsAs(who, '/api/fleet/stats')
      expect(stats.status).toBe(200)
      expect('fuelCostThisMonth' in stats.body).toBe(false)
      const fuel = await fsAs(who, `/api/fleet/vehicles/${v.id}/fuel-stats`)
      expect(JSON.stringify(fuel.body)).not.toMatch(/"(totalCost|pricePerGallon)"/)
    }
    const mgr = await fsAs('manager', `/api/fleet/vehicles/${v.id}`)
    expect(JSON.stringify(mgr.body)).toMatch(/"totalCost"/)
    expect('fuelCostThisMonth' in (await fsAs('manager', '/api/fleet/stats')).body).toBe(true)
  })

  test("a service record's cost on a customer's equipment: the history stays, the money goes", async () => {
    const [eq1] = await fs.db.insert(fs.schema.equipment).values({ companyId: fsCo, name: 'Furnace' } as any).returning()
    expect((await fsAs('owner', `/api/equipment/${eq1.id}/history`, 'POST', { type: 'Tune-up', cost: 120 })).status).toBe(201)
    const staff = await fsAs('staff', `/api/equipment/${eq1.id}/history`)
    expect(staff.status).toBe(200)
    expect(staff.body[0].type).toBe('Tune-up')
    expect('cost' in staff.body[0]).toBe(false)
    expect(JSON.stringify((await fsAs('viewer', `/api/equipment/${eq1.id}`)).body)).not.toMatch(/"cost"/)
    expect(Number((await fsAs('manager', `/api/equipment/${eq1.id}/history`)).body[0].cost)).toBe(120)
  })

  test("the crew's hourly rates on a job: a technician and a viewer read the time lines without them", async () => {
    const [job] = await fs.db.insert(fs.schema.job).values({ companyId: fsCo, title: 'Install', number: 'JOB-1' } as any).returning()
    await fs.db.insert(fs.schema.timeEntry).values({ companyId: fsCo, userId: fsIds.manager, jobId: job.id, date: new Date(), hours: '2', hourlyRate: '45.00' } as any)
    for (const who of ['staff', 'viewer']) {
      const r = await fsAs(who, `/api/jobs/${job.id}`)
      expect(r.status).toBe(200)
      expect(r.body.timeEntries.length).toBe(1)
      expect('hourlyRate' in r.body.timeEntries[0]).toBe(false)
    }
    expect(Number((await fsAs('owner', `/api/jobs/${job.id}`)).body.timeEntries[0].hourlyRate)).toBe(45)
  })

  test("everyone's time and expenses exports ask the office's verb; the project export asks invoices:read", async () => {
    for (const who of ['staff', 'viewer']) {
      expect((await fsAs(who, '/api/export/time/csv')).status).toBe(403)
      expect((await fsAs(who, '/api/export/expenses/csv')).status).toBe(403)
    }
    expect((await fsAs('staff', '/api/export/projects/csv')).status).toBe(403)
    expect((await fsAs('manager', '/api/export/time/csv')).status).toBe(200)
    expect((await fsAs('manager', '/api/export/expenses/csv')).status).toBe(200)
    expect((await fsAs('viewer', '/api/export/projects/csv')).status).toBe(200)
  })

  test('what the business pays per measurement report is not on the company row for a seat without margin:read', async () => {
    expect('reportPricePerReport' in (await fsAs('staff', '/api/company')).body).toBe(false)
    expect('reportPricePerReport' in (await fsAs('viewer', '/api/company')).body).toBe(false)
    expect('reportPricePerReport' in (await fsAs('owner', '/api/company')).body).toBe(true)
  })
})

describe('3. deleting an id that is not there answers 404, company-scoped', () => {
  const MISSING: [string, string][] = [
    ['fleet vehicle', `/api/fleet/vehicles/${ZERO}`],
    ['geofence', `/api/geofencing/${ZERO}`],
    ['inventory item', `/api/inventory/items/${ZERO}`],
    ['equipment', `/api/equipment/${ZERO}`],
    ['agreement plan', `/api/agreements/plans/${ZERO}`],
    ['AI receptionist rule', `/api/ai-receptionist/rules/${ZERO}`],
    ['knowledge base article', `/api/support/kb/${ZERO}`],
    ['text template', `/api/sms/templates/${ZERO}`],
    ['recurring route', `/api/recurring-routes/${ZERO}`],
    ['snow contract', `/api/snow/contracts/${ZERO}`],
    ['snow visit', `/api/snow/events/${ZERO}`],
  ]
  for (const [what, path] of MISSING) {
    test(`${what}: 404 for the owner`, async () => {
      const r = await fsAs('owner', path, 'DELETE')
      expect(r.status).toBe(404)
    })
  }

  test("another company's row is a 404 too, and is left standing", async () => {
    const [other] = await fs.db.insert(fs.schema.company).values({ name: 'Other Co', slug: 'other-co' } as any).returning()
    const [v] = await fs.db.insert(fs.schema.vehicle).values({ companyId: other.id, name: 'Their van' } as any).returning()
    const [item] = await fs.db.insert(fs.schema.inventoryItem).values({ companyId: other.id, name: 'Their part', sku: 'X-1' } as any).returning()
    expect((await fsAs('owner', `/api/fleet/vehicles/${v.id}`, 'DELETE')).status).toBe(404)
    expect((await fsAs('owner', `/api/inventory/items/${item.id}`, 'DELETE')).status).toBe(404)
    expect((await fs.db.select().from(fs.schema.vehicle).where(eq(fs.schema.vehicle.id, v.id))).length).toBe(1)
    expect((await fs.db.select().from(fs.schema.inventoryItem).where(eq(fs.schema.inventoryItem.id, item.id))).length).toBe(1)
  })

  test('a real delete still succeeds, and a second delete of the same id is a 404', async () => {
    const [v] = await fs.db.insert(fs.schema.vehicle).values({ companyId: fsCo, name: 'Old van' } as any).returning()
    expect((await fsAs('owner', `/api/fleet/vehicles/${v.id}`, 'DELETE')).status).toBe(200)
    expect((await fsAs('owner', `/api/fleet/vehicles/${v.id}`, 'DELETE')).status).toBe(404)
  })
})

describe('4. every signed-in person keeps their own profile, password and two-factor', () => {
  for (const who of ['manager', 'staff', 'viewer']) {
    test(`${who}: name and phone, for themselves only`, async () => {
      const r = await fsAs(who, '/api/auth/profile', 'PUT', { firstName: `New${who}`, lastName: 'Person', phone: '555-0100', role: 'owner' })
      expect(r.status).toBe(200)
      expect(r.body.user.firstName).toBe(`New${who}`)
      const [row] = await fs.db.select().from(fs.schema.user).where(eq(fs.schema.user.id, fsIds[who]))
      expect((row as any).firstName).toBe(`New${who}`)
      expect((row as any).phone).toBe('555-0100')
      // The role is not the profile's to change.
      expect((row as any).role).not.toBe('owner')
      // The two-factor devices are theirs to list.
      expect((await fsAs(who, '/api/auth/mfa-devices/devices')).status).toBe(200)
    })
  }

  test('a viewer changes their own password with the current one, and signs in with the new one', async () => {
    const wrong = await fsAs('viewer', '/api/auth/password', 'PUT', { currentPassword: 'not-it', newPassword: 'Viewer-new-pass-2' })
    expect(wrong.status).toBe(400)
    const ok = await fsAs('viewer', '/api/auth/password', 'PUT', { currentPassword: PASSWORD, newPassword: 'Viewer-new-pass-2' })
    expect(ok.status).toBe(200)
    const login = await fs.call('/api/auth/login', { method: 'POST', json: { email: 'viewer@test.example', password: 'Viewer-new-pass-2' } })
    expect(login.status).toBe(200)
    // The change signed out every other session, this test's token among them: the tests below use the new sign-in.
    fsTokens.viewer = ((await login.json()) as any).accessToken
  })
})

// ── a home-care agency: Login Activity ─────────────────────────────────────────────────────────────────────────────────
describe('5. home care Login Activity is the owner\'s and the admins\' (audit:read)', () => {
  let hc: Tenant
  let hcAs: ReturnType<typeof caller>
  beforeAll(async () => {
    hc = await bootTenant({ vertical: 'homecare' })
    const s = await seedOwner(hc)
    const login = await hc.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })
    const seats = await seatsFor(hc, s.company.id, { admin: 'admin', manager: 'manager', cg: 'caregiver', viewer: 'viewer' })
    seats.tokens.owner = ((await login.json()) as any).accessToken
    hcAs = caller(hc, seats.tokens)
    await hc.db.insert(hc.schema.auditLogs).values({ companyId: s.company.id, userId: seats.ids.admin, action: 'UPDATE', tableName: 'clients', recordId: 'x', ipAddress: '203.0.113.9' } as any)
  }, 120_000)

  test('owner and admin read it; a manager, a caregiver and a viewer are refused', async () => {
    expect((await hcAs('owner', '/api/compliance/login-activity')).status).toBe(200)
    expect((await hcAs('admin', '/api/compliance/login-activity')).status).toBe(200)
    for (const who of ['manager', 'cg', 'viewer']) {
      const r = await hcAs(who, '/api/compliance/login-activity')
      expect(r.status).toBe(403)
      expect(r.body.required).toBe('audit:read')
    }
  })

  test('the clinical audit trail stays the office\'s, without the IP address for a seat without audit:read', async () => {
    const mgr = await hcAs('manager', '/api/audit-logs')
    expect(mgr.status).toBe(200)
    expect(mgr.body.data.length).toBeGreaterThan(0)
    expect(mgr.body.data.every((r: any) => r.ipAddress === null)).toBe(true)
    const adm = await hcAs('admin', '/api/audit-logs')
    expect(adm.body.data.some((r: any) => r.ipAddress === '203.0.113.9')).toBe(true)
  })
})

describe('1. the cost sweep: the customer and the packer never see what the shop paid', () => {
  test("the customer portal's selections: every option's price, never its cost", async () => {
    const { createSelectionsService } = await import('../server/crm/field/selectionsService.ts')
    const q = await import('../server/data/selections.ts')
    const svc = createSelectionsService({ db: fs.db } as any)
    const [client] = await fs.db.insert(fs.schema.contact).values({ companyId: fsCo, name: 'Pat Client', type: 'client' } as any).returning()
    const [p] = await fs.db.insert(fs.schema.project).values({ companyId: fsCo, number: 'PRJ-9', name: 'Kitchen', contactId: client.id } as any).returning()
    const cat = await q.insertCategory(fs.db, fsCo, { name: 'Counters' })
    const opt = await q.insertOption(fs.db, fsCo, { categoryId: cat.id, name: 'Quartz', price: 2400, cost: 1500 })
    const sel = await q.insertProjectSelection(fs.db, fsCo, { projectId: p.id, categoryId: cat.id, name: 'Kitchen counters', allowance: 2000 })
    await svc.makeSelection(sel.id, fsCo, { optionId: opt.id })
    const seen = await svc.getClientSelections(p.id, client.id)
    const text = JSON.stringify(seen)
    expect(text).toContain('Quartz')
    expect(text).not.toMatch(/"cost"/)
    expect(Number(seen[0].selectedOption.price)).toBe(2400)
  })

  test("the online shop: what the label cost is margin:read's, like the supplier's cost", async () => {
    const { orderForSeat } = await import('../server/crm/store/orders/rules.ts')
    const order = { id: 'o1', totalCents: 5000, supplierCostCents: 2000, labelCostCents: 845, providerSessionId: 's', refunds: [] }
    const packer = orderForSeat({ refund: false, margin: false, revenue: true }, order) as any
    expect('labelCostCents' in packer).toBe(false)
    expect('supplierCostCents' in packer).toBe(false)
    expect(packer.totalCents).toBe(5000)
    const manager = orderForSeat({ refund: true, margin: true, revenue: true }, order) as any
    expect(manager.labelCostCents).toBe(845)
  })
})

describe('3. home care deletes of an id that is not there answer 404', () => {
  let hc: Tenant
  let hcAs: ReturnType<typeof caller>
  beforeAll(async () => {
    hc = await bootTenant({ vertical: 'homecare' })
    const s = await seedOwner(hc)
    const login = await hc.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })
    hcAs = caller(hc, { owner: ((await login.json()) as any).accessToken })
  }, 120_000)
  for (const [what, path] of [
    ['care type', `/api/care-types/${ZERO}`],
    ['client-document template', `/api/client-documents/templates/${ZERO}`],
    ['ADL requirement', `/api/adl/requirements/${ZERO}`],
    ['absence', `/api/absences/${ZERO}`],
    ['schedule', `/api/scheduling/schedules/${ZERO}`],
  ] as const) {
    test(`${what}: 404`, async () => {
      expect((await hcAs('owner', path, 'DELETE')).status).toBe(404)
    })
  }
})

describe('7. staff and field seats: no takings, no leads', () => {
  test("Booking insights' booked value is revenue:read's: absent for a technician, there for a manager and the viewer", async () => {
    // One booking, so the customers list has a row whose booked value could leak.
    await fs.db.insert(fs.schema.booking).values({ companyId: fsCo, startAt: new Date('2026-10-01T15:00:00Z'), endAt: new Date('2026-10-01T16:00:00Z'), customerName: 'Bo Booker', customerEmail: 'bo@example.com', status: 'completed', token: 'tok-role-check-1' } as any)
    for (const who of ['staff']) {
      const a = await fsAs(who, '/api/booking/analytics')
      expect(a.status).toBe(200)
      expect('bookedValue' in a.body).toBe(false)
      expect(typeof a.body.total).toBe('number')
      const c = await fsAs(who, '/api/booking/customers')
      expect(c.status).toBe(200)
      expect(c.body.data.length).toBe(1)
      expect(JSON.stringify(c.body)).not.toMatch(/"bookedValue"/)
    }
    expect('bookedValue' in (await fsAs('manager', '/api/booking/customers')).body.data[0]).toBe(true)
    for (const who of ['manager', 'viewer', 'owner']) { const r = await fsAs(who, '/api/booking/analytics'); expect(`${who} ${r.status} ${'bookedValue' in r.body}`).toBe(`${who} 200 true`) }
  })

  test('the Lead Inbox, Lead Sources and New Leads refuse a technician and a viewer; a manager and an admin read them', async () => {
    for (const who of ['staff', 'viewer']) {
      for (const p of ['/api/leads', '/api/leads/sources', '/api/leads/stats', '/api/dashboard/new-leads']) {
        const r = await fsAs(who, p)
        expect(`${who} ${p} ${r.status}`).toBe(`${who} ${p} 403`)
      }
      const stats = await fsAs(who, '/api/dashboard/stats')
      expect(stats.status).toBe(200)
      expect('newLeads' in stats.body).toBe(false)
    }
    for (const who of ['manager', 'admin']) {
      for (const p of ['/api/leads', '/api/leads/sources', '/api/dashboard/new-leads']) expect((await fsAs(who, p)).status).toBe(200)
      expect('newLeads' in (await fsAs(who, '/api/dashboard/stats')).body).toBe(true)
    }
  })

  test("working a lead asks the inbox's own permission", async () => {
    const [lead] = await fs.db.insert(fs.schema.lead).values({ companyId: fsCo, sourcePlatform: 'website', homeownerName: 'Lee Lead', email: 'lee@example.com', status: 'new' } as any).returning()
    expect((await fsAs('staff', `/api/leads/${lead.id}/status`, 'PUT', { status: 'contacted' })).status).toBe(403)
    expect((await fsAs('staff', `/api/leads/${lead.id}/convert`, 'POST')).status).toBe(403)
    expect((await fsAs('manager', `/api/leads/${lead.id}/status`, 'PUT', { status: 'contacted' })).status).toBe(200)
  })
})
