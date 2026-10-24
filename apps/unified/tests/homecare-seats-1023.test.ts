// Home care's seats after the live five-role check of 2026-10-23, on a test agency set up as the live one is (owner,
// admin, office manager, caregiver, viewer — each signed in through the real login):
//   · the caregiver's positive case: given ONE shift, they see that client and that visit — and nothing else;
//   · the viewer is a read-only office seat (care-office:read): the client directory, the week's schedule, the roster,
//     each visit's EVV status and the dashboard's counts — no clinical record, billing, pay, HR file, prospects or the
//     Lead Inbox, and no write anywhere in home care.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const PASSWORD = 'Seat-check-pass-1'
const SHIFT_DAY = '2026-12-02'
let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
  const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
  const text = await r.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, body }
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const s = await seedOwner(t)
  const companyId = s.company.id
  // Every feature on, as the live test agency runs: a switched-off module answers 403 FEATURE_NOT_ENABLED, which would
  // read as a gate.
  await t.db.update(t.schema.company).set({ enabledFeatures: [...new Set(FEATURE_REGISTRY.map((f) => f.id))] }).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tokens.owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  for (const [key, role] of [['admin', 'admin'], ['manager', 'manager'], ['cg', 'field'], ['cg2', 'field'], ['viewer', 'viewer']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@agency.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Seat', role, companyId, defaultPayRate: '19.50' } as any).returning()
    ids[key] = u.id
    tokens[key] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@agency.example`, password: PASSWORD } })).json()).accessToken
  }
  const client = async (firstName: string) => (await t.db.insert(t.schema.clients).values({
    companyId, firstName, lastName: 'Client', isActive: true, phone: '555-0101', address: '1 Main St', city: 'Eau Claire', state: 'WI',
    dateOfBirth: '1940-02-01', insuranceProvider: 'Acme Health', insuranceId: 'INS-1', medicaidId: 'MA-1', primaryDiagnosisCode: 'F03.90',
    medicalNotes: 'Insulin twice daily', allergies: ['penicillin'], isPrivatePay: true, privatePayRate: '32.00', billingNotes: 'Bill the son',
  } as any).returning())[0]
  const ada = await client('Ada')
  const eve = await client('Eve')
  ids.ada = ada.id
  ids.eve = eve.id
  // ONE shift: cg with Ada. cg2 has Eve's, so a caregiver who sees "everything" would see Eve.
  const shift = async (caregiverId: string, clientId: string, from: string, to: string) => (await t.db.insert(t.schema.schedules).values({
    companyId, clientId, caregiverId, dayOfWeek: null, date: SHIFT_DAY, scheduleType: 'one-time',
    startTime: new Date(`${SHIFT_DAY}T${from}:00Z`), endTime: new Date(`${SHIFT_DAY}T${to}:00Z`),
  } as any).returning())[0].id
  ids.adaShift = await shift(ids.cg, ada.id, '15:00', '17:00')
  ids.eveShift = await shift(ids.cg2, eve.id, '18:00', '20:00')
  await t.db.insert(t.schema.clientAssignments).values({ companyId, clientId: eve.id, caregiverId: ids.cg2, assignmentDate: '2026-11-01', status: 'active', payRate: '21.00' } as any)
  // A finished visit of cg2's, with the GPS points and the care note an office reader must not be handed.
  const [entry] = await t.db.insert(t.schema.timeEntries).values({
    companyId, caregiverId: ids.cg2, clientId: eve.id, startTime: new Date('2026-11-20T15:00:00Z'), endTime: new Date('2026-11-20T17:00:00Z'),
    durationMinutes: 120, billableMinutes: 120, isComplete: true, notes: 'Gave insulin at 4pm', clockInLocation: { lat: 44.8, lng: -91.5 },
  } as any).returning()
  ids.entry = entry.id
}, 120_000)

describe("the caregiver's positive case: one shift, one client, one visit", () => {
  test('their client list is exactly the client they serve', async () => {
    const r = await as('cg', '/api/clients')
    expect(r.status).toBe(200)
    expect(r.body.data.map((c: any) => c.firstName)).toEqual(['Ada'])
    expect((await as('cg', `/api/clients/${ids.ada}`)).status).toBe(200)
    expect((await as('cg', `/api/clients/${ids.eve}`)).status).not.toBe(200)
  })

  test("their client's care card opens; anyone else's is refused", async () => {
    const card = await as('cg', `/api/clients/${ids.ada}/caregiver-view`)
    expect(card.status).toBe(200)
    expect(card.body.firstName).toBe('Ada')
    expect((await as('cg', `/api/clients/${ids.eve}/caregiver-view`)).status).toBe(403)
  })

  test('their week holds their one visit, and only theirs', async () => {
    const w = await as('cg', `/api/scheduling/week-view?weekOf=${SHIFT_DAY}`)
    expect(w.status).toBe(200)
    expect(w.body.caregivers.map((r: any) => r.caregiver.id)).toEqual([ids.cg])
    const visits = Object.values(w.body.caregivers[0].days).flat() as any[]
    expect(visits.map((v: any) => v.clientFirstName)).toEqual(['Ada'])
    const mine = await as('cg', `/api/schedules/caregiver/${ids.cg}`)
    expect(mine.status).toBe(200)
    expect(JSON.stringify(mine.body)).toContain(ids.adaShift)
    expect(JSON.stringify(mine.body)).not.toContain(ids.eveShift)
    expect((await as('cg', `/api/schedules/caregiver/${ids.cg2}`)).status).toBe(403)
  })

  test("another caregiver's visits are not theirs to read", async () => {
    const r = await as('cg', '/api/time-tracking')
    expect(r.status).toBe(200)
    expect(r.body.data.some((e: any) => e.id === ids.entry)).toBe(false)
  })
})

describe('the viewer is a read-only office seat', () => {
  test('it holds care-office:read and not the contacts, the books or the Lead Inbox', async () => {
    const me = await as('viewer', '/api/auth/me')
    expect(me.body.permissions).toContain('care-office:read')
    for (const p of ['contacts:read', 'invoices:read', 'quotes:read', 'revenue:read', 'leads:read', 'care-clients:read', 'care-billing:read', 'care-hr:read']) {
      expect(me.body.permissions).not.toContain(p)
    }
  })

  test('the client directory: every client, who is assigned — no clinical record, insurance, ids, rates or billing notes', async () => {
    const r = await as('viewer', '/api/clients')
    expect(r.status).toBe(200)
    expect(r.body.data.map((c: any) => c.firstName).sort()).toEqual(['Ada', 'Eve'])
    const text = JSON.stringify(r.body)
    for (const leak of ['1940-02-01', 'Acme Health', 'INS-1', 'MA-1', 'F03.90', 'Insulin', 'penicillin', '32.00', 'Bill the son', '21.00']) expect(text).not.toContain(leak)
    const eve = r.body.data.find((c: any) => c.firstName === 'Eve')
    expect(eve.phone).toBe('555-0101')
    expect(eve.assignments.length).toBe(1)
    const one = await as('viewer', `/api/clients/${ids.ada}`)
    expect(one.status).toBe(200)
    expect(one.body.firstName).toBe('Ada')
    expect('authorizations' in one.body).toBe(false)
    expect(JSON.stringify(one.body)).not.toContain('F03.90')
  })

  test('the week: every caregiver\'s visits', async () => {
    const w = await as('viewer', `/api/scheduling/week-view?weekOf=${SHIFT_DAY}`)
    expect(w.status).toBe(200)
    const clientsSeen = w.body.caregivers.flatMap((r: any) => (Object.values(r.days).flat() as any[]).map((v) => v.clientFirstName)).sort()
    expect(clientsSeen).toEqual(['Ada', 'Eve'])
  })

  test('the roster, without pay', async () => {
    const r = await as('viewer', '/api/users/caregivers?isActive=all')
    expect(r.status).toBe(200)
    expect(r.body.data.map((p: any) => p.id).sort()).toEqual([ids.cg, ids.cg2].sort())
    expect(JSON.stringify(r.body)).not.toContain('19.50')
  })

  test("each visit's times and EVV status — no GPS, notes or billable minutes", async () => {
    const r = await as('viewer', '/api/time-tracking')
    expect(r.status).toBe(200)
    const v = r.body.data.find((e: any) => e.id === ids.entry)
    expect(v.durationMinutes).toBe(120)
    expect(v.client.firstName).toBe('Eve')
    for (const k of ['notes', 'clockInLocation', 'clockOutLocation', 'billableMinutes']) expect(k in v).toBe(false)
    expect(JSON.stringify(r.body)).not.toContain('insulin')
  })

  test("the dashboard's counts, never the money; an admin still gets both", async () => {
    const v = await as('viewer', '/api/dashboard/summary')
    expect(v.status).toBe(200)
    expect(v.body.totalClients).toBe(2)
    expect(v.body.activeCaregivers).toBe(2)
    expect('pendingInvoices' in v.body).toBe(false)
    expect('thisMonthRevenue' in v.body).toBe(false)
    const a = await as('admin', '/api/dashboard/summary')
    expect(typeof a.body.pendingInvoices.amount).toBe('number')
    expect(typeof a.body.thisMonthRevenue).toBe('number')
  })

  test('no clinical record, billing, payroll, rates, incidents, HR files, prospects, contacts or leads', async () => {
    const refused = [
      `/api/clients/${ids.ada}/caregiver-view`, `/api/clients/${ids.ada}/visit-notes`, `/api/medications/client/${ids.ada}`,
      `/api/care-plans`, `/api/adl/client/${ids.ada}/requirements`, `/api/forms/submissions`, `/api/care-types`, `/api/service-codes`,
      '/api/incidents', '/api/billing/invoices', '/api/payroll', `/api/caregiver-rates/${ids.cg}`, '/api/caregivers',
      `/api/caregivers/${ids.cg}`, '/api/applications', '/api/background-checks', '/api/prospects', '/api/contacts', '/api/leads',
      '/api/leads/sources', '/api/compliance/login-activity', '/api/audit-logs', '/api/evv', '/api/dashboard/referrals',
      '/api/scheduling/open-shifts', '/api/scheduling/absences', `/api/time-tracking/caregiver-gps/${ids.cg2}`,
    ]
    const open: string[] = []
    for (const p of refused) { const r = await as('viewer', p); if (r.status !== 403) open.push(`${p} → ${r.status}`) }
    expect(open).toEqual([])
  }, 60_000)

  test('it writes nothing: every home-care write route refuses it', async () => {
    const mounts = t.services.mounts.filter((m: any) => m.addon === 'homecare' && m.access === 'user')
    const ours = (p: string) => mounts.some((m: any) => p === m.path || p.startsWith(m.path + '/'))
    const writes = new Set<string>()
    for (const r of t.app.routes as { method: string; path: string }[]) {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) || !r.path.startsWith('/api/') || r.path.includes('*') || !ours(r.path)) continue
      writes.add(`${r.method} ${r.path}`)
    }
    expect(writes.size).toBeGreaterThan(350)
    // This phone's push token is every signed-in person's own device (core/phonePush.ts, every vertical) — not a record.
    const OWN = new Set(['POST /api/push/expo-token', 'DELETE /api/push/expo-token'])
    const holes: string[] = []
    for (const k of writes) {
      if (OWN.has(k)) continue
      const [method, path] = k.split(' ')
      const r = await t.call(path.replace(/:(\w+)(\{[^}]*\})?/g, 'zzzzzzzzzzzzzzzzzzzzzzzz'), { method, headers: { Authorization: `Bearer ${tokens.viewer}` }, json: {} })
      if (r.status !== 403) holes.push(`${k} → ${r.status} ${(await r.text()).slice(0, 80)}`)
    }
    expect(holes).toEqual([])
  }, 180_000)
})
