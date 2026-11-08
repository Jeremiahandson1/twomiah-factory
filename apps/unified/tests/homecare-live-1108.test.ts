// The home care live test (11/08), each finding now as it should be, through the real server as the home care vertical:
//   · an invoice goes to the billing contact (Dana), and the screen asks the server who that is first — a client with no email
//     of their own can be sent; a portal login is offered as the family member who pays, and kept as "someone else";
//   · a training with an expiry date (a CPR card) is a credential too: it shows in the credential search and goes when removed;
//   · the Audit Logs page shows every change (the app's trail beside home care's clinical one) to a seat with audit:read;
//   · the caregiver's client card carries the care plan in force and the tasks; their rate answer carries the default pay rate;
//   · a calendar day prints as that day on a clock west of UTC.
// Nothing reaches a real tenant or the internet.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { formatAgencyDate, setAgencyTimezone } from '../web/src/crm/pages/homecare/lib/agencyClock.ts'

const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any })
let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', caregiverId = '', martha = ''
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'scheduling', 'team', 'care_billing_contacts', 'care_cert_reminders'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  caregiverId = (await ins(t.schema.user, { email: 'giver@test.example', passwordHash: 'x', firstName: 'Giver', lastName: 'One', role: 'caregiver', companyId, defaultPayRate: '18.00' })).id
  martha = (await ins(t.schema.clients, { companyId, firstName: 'Martha', lastName: 'Client', email: null, isActive: true, isPrivatePay: true, privatePayRate: '28', privatePayRateType: 'hourly' })).id
}, 120_000)

describe('the billing contact gets the invoice', () => {
  test('a portal login is offered as the family member who pays, and kept as someone else with its email', async () => {
    await ins(t.schema.clientPortalAccounts, { companyId, clientId: martha, email: 'dana@family.example', displayName: 'Dana Daughter' })
    const one = await json(await as(`/api/care-billing-contacts/clients/${martha}`))
    const login = one.body.familyMembers.find((m: any) => m.email === 'dana@family.example')
    expect(login).toMatchObject({ name: 'Dana Daughter', relationship: 'portal login' })
    const saved = await json(await as(`/api/care-billing-contacts/clients/${martha}`, { method: 'PUT', json: { kind: 'family', familyMemberId: login.id, emails: ['dana.work@family.example'] } }))
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ kind: 'other', contactName: 'Dana Daughter' })
  })

  test('the server names who an invoice will go to: the billing contact, though the client has no email of their own', async () => {
    const [inv] = (await t.db.insert(t.schema.invoices).values({ companyId, clientId: martha, invoiceNumber: 'INV-T1', billingPeriodStart: '2026-11-01', billingPeriodEnd: '2026-11-07', subtotal: '98', total: '98' } as any).returning()) as any[]
    const r = await json(await as(`/api/billing/invoices/${inv.id}/recipients`))
    expect(r.status).toBe(200)
    expect(r.body.to).toEqual(['dana@family.example', 'dana.work@family.example'])
  })
})

describe('a training with an expiry date is a credential', () => {
  test('it shows in the credential search, and goes when the training is removed', async () => {
    const made = await json(await as(`/api/caregivers/${caregiverId}/training-records`, { method: 'POST', json: { trainingType: 'CPR', completionDate: '2024-11-28', expirationDate: '2026-11-28' } }))
    expect(made.status).toBe(201)
    const found = await json(await as(`/api/credentials/search?caregiverId=${caregiverId}`))
    expect(found.body.data.map((r: any) => [r.certificationType, r.expiryDate])).toEqual([['CPR', '2026-11-28']])
    expect((await as(`/api/training-records/${made.body.id}`, { method: 'DELETE' })).status).toBeLessThan(300)
    expect((await json(await as(`/api/credentials/search?caregiverId=${caregiverId}`))).body.data).toEqual([])
  })
})

test('the Audit Logs page shows a client created, not only home care\'s clinical rows', async () => {
  const c = await json(await as('/api/clients', { method: 'POST', json: { firstName: 'Olive', lastName: 'Audit' } }))
  expect(c.status).toBe(201)
  const log = await json(await as('/api/audit-logs?limit=200'))
  expect(log.status).toBe(200)
  expect(log.body.data.some((r: any) => r.recordId === c.body.id)).toBe(true)
})

test('the caregiver\'s client card has the care plan and the tasks; their rate answer has the default pay rate', async () => {
  await ins(t.schema.carePlans, { companyId, clientId: martha, careGoals: 'Stay safe at home', status: 'active' })
  await ins(t.schema.clientTaskTemplates, { companyId, clientId: martha, taskName: 'Help with bathing', category: 'adl' })
  const card = await json(await as(`/api/clients/${martha}/caregiver-view`))
  expect(card.status).toBe(200)
  expect(card.body.carePlan.careGoals).toBe('Stay safe at home')
  expect(card.body.tasks.map((x: any) => x.taskName)).toEqual(['Help with bathing'])
  const rate = await json(await as(`/api/caregiver-rates/${caregiverId}`))
  expect(rate.body.defaultPayRate).toBe('18.00')
})

test('a calendar day is that day on a clock west of UTC (Nov 14 never "Nov 13")', () => {
  setAgencyTimezone('America/Chicago')
  expect(formatAgencyDate('2026-11-14')).toBe('Nov 14, 2026')
  expect(formatAgencyDate('2027-01-06')).toBe('Jan 6, 2027')
})

// ── The re-check (11/08) ──
test('a dose recorded as missed tells the office', async () => {
  const med = await ins(t.schema.medications, { companyId, clientId: martha, name: 'Vitamin D (test)', dosage: '1000 IU', status: 'active' })
  const r = await as('/api/medications/log', { method: 'POST', json: { medicationId: med.id, clientId: martha, status: 'missed', notes: 'Asleep' } })
  expect(r.status).toBe(201)
  const notes = (await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.companyId, companyId))) as any[]
  expect(notes.some((n) => n.type === 'medication_missed' && /Vitamin D \(test\).*missed/.test(n.message))).toBe(true)
})

test('an authorization shows what the visits worked used, beside what was billed', async () => {
  const payer = await ins(t.schema.referralSources, { companyId, name: 'Medicaid (test)', type: 'payer' })
  await ins(t.schema.authorizations, { companyId, clientId: martha, payerId: payer.id, authorizedUnits: '40', unitType: 'hours', startDate: '2026-11-01', endDate: '2026-12-31', status: 'active' })
  await ins(t.schema.timeEntries, { companyId, caregiverId, clientId: martha, startTime: new Date('2026-11-08T17:44:00Z'), endTime: new Date('2026-11-08T18:44:00Z'), durationMinutes: 60 })
  const list = await json(await as(`/api/authorizations?clientId=${martha}`))
  expect(list.body.data[0]).toMatchObject({ workedUnits: 1, usedUnits: expect.anything() })
})

// ── Re-check 2 (11/08) ──
test('a training picked from the list is a credential under its name as people read it ("CPR Certification", not "cpr")', async () => {
  const made = await json(await as(`/api/caregivers/${caregiverId}/training-records`, { method: 'POST', json: { trainingType: 'cpr', completionDate: '2025-01-10', expirationDate: '2027-01-10' } }))
  expect(made.status).toBe(201)
  const found = await json(await as(`/api/credentials/search?caregiverId=${caregiverId}`))
  expect(found.body.data.map((r: any) => r.certificationType)).toContain('CPR Certification')
  expect((await as(`/api/training-records/${made.body.id}`, { method: 'DELETE' })).status).toBeLessThan(300)
  expect((await json(await as(`/api/credentials/search?caregiverId=${caregiverId}`))).body.data.map((r: any) => r.certificationType)).not.toContain('CPR Certification')
})
