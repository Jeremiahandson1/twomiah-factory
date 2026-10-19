// Home care's planning group on the unified app (server/crm/homecare/planning): the dashboard, the reports and the three
// optimizers. Through the real server, signed in with real tokens. tests/unified/homecare/reports.test.ts (the adapted
// copy of the template's suite file) holds the figures; this holds what the move itself changed:
//   · /api/dashboard and /api/reports answer home care's own (CrmSettings.dashboard / reports.module 'homecare');
//   · the template's requireAdmin became permissions — money asks care-billing:read, hours and pay care-payroll:read,
//     the planner the schedule area's writes — so a caregiver is refused and a manager reaches what they hold;
//   · one company's rows never reach another's figures, and a write never names another company's person or client;
//   · a caregiver is the role 'caregiver' (moved tenants) or 'field' (new ones), counted alike;
//   · replies are camelCase, a list is { data, pagination }.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', otherCompanyId = ''
const ids: Record<string, string> = {}
const tokens: Record<string, string> = {}
const PASSWORD = 'Pass-word-1'

const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const rows = async (q: any) => ((await t.db.execute(q)) as any).rows as any[]
const wc = (hm: string) => new Date(`2026-09-01T${hm}:00Z`)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  // /api/dashboard is the shared mount, behind the core 'dashboard' feature every synced tenant has on.
  await t.db.update(t.schema.company).set({ enabledFeatures: ['dashboard'] }).where(eq(t.schema.company.id, companyId))
  for (const [role, email] of [['admin', 'admin@hc.example'], ['manager', 'mgr@hc.example'], ['caregiver', 'cg@hc.example'], ['field', 'fld@hc.example']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({
      email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: email.split('@')[0], lastName: 'Tester', role, companyId,
      latitude: '44.80000000', longitude: '-91.50000000', defaultPayRate: '20.00',
    } as any).returning()
    ids[email.split('@')[0]] = u.id
  }
  for (const who of ['admin', 'mgr', 'cg', 'fld']) tokens[who] = await signIn(`${who}@hc.example`, PASSWORD)
  tokens.owner = await signIn('owner@test.example', seeded.password)

  const [ada] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Ada', lastName: 'Client', isActive: true, latitude: '44.80000000', longitude: '-91.40000000', isPrivatePay: true, privatePayRate: '30.00' } as any).returning()
  const [eve] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Eve', lastName: 'Client', isActive: true, latitude: '44.80000000', longitude: '-91.30000000' } as any).returning()
  ids.ada = ada.id
  ids.eve = eve.id
  // The caregiver serves Ada (an active assignment), not Eve.
  await t.db.insert(t.schema.clientAssignments).values({ companyId, clientId: ada.id, caregiverId: ids.cg, assignmentDate: '2026-01-01', status: 'active' } as any)
  // One Monday visit in September for each caregiver seat: cg ('caregiver') and fld ('field').
  for (const cg of [ids.cg, ids.fld]) {
    await t.db.insert(t.schema.schedules).values({ companyId, caregiverId: cg, clientId: ada.id, dayOfWeek: 1, startTime: wc('09:00'), endTime: wc('11:00'), frequency: 'weekly', effectiveDate: '2026-09-07', endDate: '2026-09-07', isActive: true } as any)
  }
  await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-1', clientId: ada.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-14', subtotal: '120', total: '120', amountPaid: '0', paymentStatus: 'pending', sentAt: new Date('2026-09-15T15:00:00Z') } as any)

  // Another company in the same database, with a caregiver, a client, a visit and an invoice of its own.
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Agency', slug: 'other-agency' }).returning()
  otherCompanyId = other.id
  const [ocg] = await t.db.insert(t.schema.user).values({ email: 'ocg@other.example', passwordHash: 'x', firstName: 'Olga', lastName: 'Other', role: 'caregiver', companyId: other.id } as any).returning()
  const [ocl] = await t.db.insert(t.schema.clients).values({ companyId: other.id, firstName: 'Oscar', lastName: 'Other', isActive: true, latitude: '44.9', longitude: '-91.2' } as any).returning()
  ids.otherCaregiver = ocg.id
  ids.otherClient = ocl.id
  await t.db.insert(t.schema.schedules).values({ companyId: other.id, caregiverId: ocg.id, clientId: ocl.id, dayOfWeek: 1, startTime: wc('09:00'), endTime: wc('17:00'), frequency: 'weekly', effectiveDate: '2026-09-07', endDate: '2026-09-07', isActive: true } as any)
  await t.db.insert(t.schema.invoices).values({ companyId: other.id, invoiceNumber: 'OT-1', clientId: ocl.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-14', subtotal: '999', total: '999', amountPaid: '0', paymentStatus: 'pending', sentAt: new Date('2026-09-15T15:00:00Z') } as any)
})

const SEPT = { startDate: '2026-09-01', endDate: '2026-09-30' }

describe("/api/dashboard and /api/reports are home care's own", () => {
  test("the dashboard summary is the agency's tiles, and a caregiver of either seat is counted", async () => {
    const r = await as('admin', '/api/dashboard/summary')
    expect(r.status).toBe(200)
    const s = await r.json()
    expect(typeof s.pendingInvoices.amount).toBe('number')
    // cg ('caregiver') and fld ('field'); not the other company's Olga.
    expect(s.activeCaregivers).toBe(2)
    expect(s.totalClients).toBe(2)
    // The released invoice owed is this company's $120, never the other's $999.
    expect(s.pendingInvoices).toEqual({ count: 1, amount: 120, draftCount: 0, draftAmount: 0 })
  })

  test("the reports overview is home care's, counting only this company's visits and money", async () => {
    const r = await as('admin', '/api/reports/overview', { method: 'POST', json: SEPT })
    expect(r.status).toBe(200)
    const o = await r.json()
    // Two 2-hour Monday visits (cg and fld); the other company's 8-hour visit is not here.
    expect(o.summary.totalHours).toBe(4)
    expect(o.summary.totalShifts).toBe(2)
    expect(o.summary.totalRevenue).toBe(120)
    expect(o.topCaregivers.map((c: any) => c.id).sort()).toEqual([ids.cg, ids.fld].sort())
    // camelCase rows (RULEBOOK §2).
    expect(Object.keys(o.topCaregivers[0])).toEqual(expect.arrayContaining(['firstName', 'lastName', 'totalHours', 'estLaborCost', 'clientsServed']))
  })

  test('a list is a list reply', async () => {
    const r = await (await as('admin', '/api/dashboard/caregiver-hours')).json()
    expect(Array.isArray(r.data)).toBe(true)
    expect(r.pagination.total).toBe(2)
    const p = await (await as('admin', '/api/reports/caregiver-productivity?startDate=2026-09-01&endDate=2026-09-30')).json()
    expect(p.data.map((x: any) => x.id).sort()).toEqual([ids.cg, ids.fld].sort())
  })

  test("Client Hours by Week is camelCase and the company's", async () => {
    const r = await (await as('owner', '/api/reports/client-week?weekStart=2026-09-06')).json()
    expect(r.clients.map((c: any) => c.clientId)).toEqual([ids.ada])
    expect(r.clients[0]).toMatchObject({ name: 'Ada Client', scheduledMinutes: 240, missingClockIns: 2 })
    expect(r.clients[0].rows[0]).toMatchObject({ type: 'visit', day: '2026-09-07', schedStart: '09:00:00' })
  })

  test("another company's client is not found in the client report", async () => {
    expect((await as('admin', `/api/reports/client/${ids.otherClient}`)).status).toBe(404)
    expect((await as('admin', `/api/reports/client/${ids.ada}?sections=visits`)).status).toBe(200)
  })
})

describe('who may', () => {
  const OFFICE: Array<[string, string, unknown?]> = [
    ['POST', '/api/reports/overview', SEPT], ['POST', '/api/reports/hours', SEPT], ['POST', '/api/reports/performance', SEPT],
    ['GET', '/api/reports/pnl'], ['GET', '/api/reports/client-week?weekStart=2026-09-06'],
    ['GET', '/api/reports/client-incidents?startDate=2026-09-01&endDate=2026-09-30'],
    ['POST', '/api/reports/clients/export', SEPT], ['POST', '/api/reports/payroll/export', SEPT],
    ['GET', '/api/dashboard/summary'], ['GET', '/api/dashboard/live-board'], ['GET', '/api/dashboard/action-items'],
    ['GET', `/api/dashboard/caregiver-patterns/${'x'}`],
    ['POST', '/api/route-optimizer/optimize', {}], ['GET', '/api/route-optimizer/saved-routes'],
    ['POST', '/api/route-optimizer/geofence', { clientId: 'x' }], ['GET', '/api/optimizer/stats'],
    ['POST', '/api/optimizer/apply', { proposals: [{}] }], ['GET', '/api/roster-optimizer/roster'],
  ]
  test('a caregiver of either seat is refused every office door', async () => {
    for (const who of ['cg', 'fld']) {
      for (const [method, path, json] of OFFICE) {
        const r = await as(who, path, { method, json })
        expect({ who, path, status: r.status }).toEqual({ who, path, status: 403 })
      }
    }
  })

  test('a manager reaches money and the schedule, not hours and pay', async () => {
    expect((await as('mgr', '/api/dashboard/summary')).status).toBe(200)
    expect((await as('mgr', '/api/reports/revenue', { method: 'POST', json: SEPT })).status).toBe(200)
    expect((await as('mgr', '/api/dashboard/live-board')).status).toBe(200)
    expect((await as('mgr', '/api/roster-optimizer/roster')).status).toBe(200)
    expect((await as('mgr', '/api/reports/hours', { method: 'POST', json: SEPT })).status).toBe(403)
    expect((await as('mgr', '/api/reports/payroll/export', { method: 'POST', json: SEPT })).status).toBe(403)
  })

  test('the clock-in geofence check answers a caregiver for a client they serve, and only that', async () => {
    const ok = await as('cg', '/api/route-optimizer/geofence/check', { method: 'POST', json: { clientId: ids.ada, latitude: 44.8, longitude: -91.4 } })
    expect(ok.status).toBe(200)
    expect((await ok.json()).withinGeofence).toBe(true)
    const no = await as('cg', '/api/route-optimizer/geofence/check', { method: 'POST', json: { clientId: ids.eve, latitude: 44.8, longitude: -91.3 } })
    expect(no.status).toBe(403)
  })

  test('signed out is 401', async () => {
    expect((await t.call('/api/reports/pnl')).status).toBe(401)
    expect((await t.call('/api/route-optimizer/stats')).status).toBe(401)
  })
})

describe("a write never names another company's person or client", () => {
  test("an optimizer proposal for another company's caregiver or client is reported, not written", async () => {
    const r = await (await as('admin', '/api/optimizer/apply', { method: 'POST', json: { proposals: [
      { caregiverId: ids.otherCaregiver, clientId: ids.ada, dayOfWeek: 2, startTime: '13:00', endTime: '14:00' },
      { caregiverId: ids.cg, clientId: ids.otherClient, dayOfWeek: 2, startTime: '13:00', endTime: '14:00' },
      { caregiverId: ids.cg, clientId: ids.ada, dayOfWeek: 2, startTime: '13:00', endTime: '14:00' },
    ] } })).json()
    expect(r).toMatchObject({ success: true, created: 1, errors: 2 })
    expect(r.errorDetails.map((e: any) => e.error)).toEqual(['Caregiver not found', 'Client not found'])
    const written = await rows(sql`SELECT company_id, caregiver_id, client_id FROM schedules WHERE notes = 'Created by Schedule Optimizer'`)
    expect(written).toEqual([{ company_id: companyId, caregiver_id: ids.cg, client_id: ids.ada }])
  })

  test("a route plan with another company's client is refused; a good one is the company's, stops and all", async () => {
    const stop = (clientId: string) => ({ clientId, stopOrder: 1, calculatedArrival: '08:10', calculatedDeparture: '09:10', serviceUnits: 4 })
    expect((await as('admin', '/api/route-optimizer/save-route', { method: 'POST', json: { caregiverId: ids.cg, date: '2026-09-15', stops: [stop(ids.otherClient)] } })).status).toBe(404)
    expect((await as('admin', '/api/route-optimizer/save-route', { method: 'POST', json: { caregiverId: ids.otherCaregiver, date: '2026-09-15', stops: [stop(ids.ada)] } })).status).toBe(404)
    const ok = await as('admin', '/api/route-optimizer/save-route', { method: 'POST', json: { caregiverId: ids.cg, date: '2026-09-15', stops: [stop(ids.ada)] } })
    expect(ok.status).toBe(201)
    const plan = await ok.json()
    expect(plan.companyId).toBe(companyId)
    expect(await rows(sql`SELECT company_id FROM route_plan_stops WHERE route_plan_id = ${plan.id}`)).toEqual([{ company_id: companyId }])
    const list = await (await as('admin', '/api/route-optimizer/saved-routes')).json()
    expect(list.pagination.total).toBe(1)
    expect(list.data[0]).toMatchObject({ id: plan.id, routeDate: '2026-09-15', caregiverName: 'cg Tester' })
  })

  test("another company's client has no geofence to set", async () => {
    expect((await as('admin', '/api/route-optimizer/geofence', { method: 'POST', json: { clientId: ids.otherClient, radiusFeet: 400 } })).status).toBe(404)
    const set = await as('admin', '/api/route-optimizer/geofence', { method: 'POST', json: { clientId: ids.ada, radiusFeet: 400 } })
    expect(set.status).toBe(200)
    expect(await set.json()).toMatchObject({ clientId: ids.ada, companyId, radiusFeet: 400 })
  })

  test('reading a client report writes the clinical audit row in the company', async () => {
    await as('admin', `/api/reports/client/${ids.ada}?sections=visits`)
    const logged = await rows(sql`SELECT company_id, action FROM audit_logs WHERE record_id = ${ids.ada} AND action = 'REPORT_GENERATED_JSON'`)
    expect(logged.length).toBeGreaterThan(0)
    expect(logged.every((l) => l.company_id === companyId)).toBe(true)
    void otherCompanyId
  })
})

// The screen's caregiver and client pickers narrow the report, and its CSV and PDF are that report: the exports
// ignored both, and the payroll export priced hours its own way ($18 an hour when no rate was on file) (fixed 2026-10-19).
describe('an export is the report on screen', () => {
  const csv = async (type: string, body: Record<string, unknown>) => {
    const r = await as('owner', `/api/reports/${type}/export`, { method: 'POST', json: { ...SEPT, format: 'csv', ...body } })
    expect(r.status).toBe(200)
    const [head, ...lines] = (await r.text()).trim().split(/\r?\n/)
    const keys = head.split(',').map((k) => k.replace(/"/g, ''))
    return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [keys[i], v.replace(/"/g, '')])))
  }
  beforeAll(async () => {
    await t.db.insert(t.schema.timeEntries).values([
      { companyId, caregiverId: ids.cg, clientId: ids.ada, startTime: new Date('2026-09-08T15:00:00Z'), endTime: new Date('2026-09-08T16:00:00Z'), durationMinutes: 60, isComplete: true },
      { companyId, caregiverId: ids.fld, clientId: ids.eve, startTime: new Date('2026-09-09T15:00:00Z'), endTime: new Date('2026-09-09T16:30:00Z'), durationMinutes: 90, isComplete: true },
    ] as any)
    await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-2', clientId: ids.eve, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-14', subtotal: '45', total: '45', amountPaid: '0', paymentStatus: 'pending', sentAt: new Date('2026-09-15T15:00:00Z') } as any)
    await t.db.insert(t.schema.payrollShiftReviews).values({ companyId, caregiverId: ids.cg, clientId: ids.ada, shiftDate: '2026-09-08', payPeriodStart: '2026-09-01', payPeriodEnd: '2026-09-14', payableMinutes: 60, status: 'approved' } as any)
  })

  test('a client picked: only that client\'s hours and invoices', async () => {
    const hours = await csv('overview', { clientId: ids.ada })
    expect(Number(hours.find((r) => r.Caregiver === 'cg Tester')?.['Clocked Hours'])).toBe(1)
    expect(Number(hours.find((r) => r.Caregiver === 'fld Tester')?.['Clocked Hours'])).toBe(0)
    expect((await csv('revenue', { clientId: ids.eve })).map((r) => r['Invoice Number'])).toEqual(['HC-2'])
    expect((await csv('revenue', {})).map((r) => r['Invoice Number']).sort()).toEqual(['HC-1', 'HC-2'])
  })

  test('a caregiver picked: that caregiver\'s row only', async () => {
    const rows = await csv('hours', { caregiverId: ids.fld })
    expect(rows.map((r) => r.Caregiver)).toEqual(['fld Tester'])
    expect(Number(rows[0].Hours)).toBe(1.5)
  })

  test('the payroll export is what Payroll → Calculate pays', async () => {
    const rows = await csv('payroll', {})
    expect(rows).toEqual([expect.objectContaining({ Caregiver: 'cg Tester', 'Regular Hours': '1', 'Gross Pay': '20' })])
  })

  test('the overview\'s satisfaction is under the filter too', async () => {
    await t.db.insert(t.schema.performanceRatings).values([
      { companyId, caregiverId: ids.cg, clientId: ids.ada, satisfactionScore: 5, createdAt: new Date('2026-09-10T15:00:00Z') },
      { companyId, caregiverId: ids.fld, clientId: ids.eve, satisfactionScore: 1, createdAt: new Date('2026-09-10T15:00:00Z') },
    ] as any)
    const all = await (await as('owner', '/api/reports/overview', { method: 'POST', json: SEPT })).json()
    const ada = await (await as('owner', '/api/reports/overview', { method: 'POST', json: { ...SEPT, clientId: ids.ada } })).json()
    expect(all.summary.avgSatisfaction).toBe(3)
    expect(ada.summary.avgSatisfaction).toBe(5)
  })
})

// The dashboard's Coverage Gaps tile and its "Find Coverage →" were a fixed 0 (in the template too); they count the
// call-outs Emergency Coverage lists, so the two always agree (2026-10-19).
describe('coverage gaps are the call-outs Emergency Coverage lists', () => {
  test('an open call-out today or later counts; a covered, a past or another company\'s does not', async () => {
    const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10)
    await t.db.insert(t.schema.absences).values([
      { companyId, caregiverId: ids.cg, clientId: ids.ada, date: day(2), type: 'call_out', coverageNeeded: true },
      { companyId, caregiverId: ids.fld, clientId: ids.eve, date: day(3), type: 'call_out', coverageNeeded: true, coverageAssignedTo: ids.cg },
      { companyId, caregiverId: ids.fld, clientId: ids.eve, date: day(-5), type: 'call_out', coverageNeeded: true },
      { companyId, caregiverId: ids.cg, clientId: ids.ada, date: day(4), type: 'sick', coverageNeeded: true },
      { companyId: otherCompanyId, caregiverId: ids.otherCaregiver, clientId: ids.otherClient, date: day(2), type: 'call_out', coverageNeeded: true },
    ] as any)
    const s = await (await as('admin', '/api/dashboard/summary')).json()
    const listed = await (await as('admin', '/api/emergency/miss-reports')).json()
    expect(s.coverageGaps).toBe(1)
    expect((Array.isArray(listed) ? listed : listed.data).length).toBe(s.coverageGaps)
  })
})
