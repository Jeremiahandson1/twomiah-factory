// Parity tier 3 (11/10, field service): technician and office (CSR) scorecards — ServiceTitan's — as two tabs of the team revenue
// report. Through the real server as field service:
//   · tech: jobs completed (the crew counts too), on-time starts against the booked time on the business's clock, call-backs
//     (another job for the same customer within 30 days of completion);
//   · office: jobs each person booked in the period, and how many were completed or cancelled.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { bookedStart } from '../server/data/scorecards.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', ownerId = '', tia = '', hank = ''
const call = (p: string) => t.call(p, { headers: { Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const at = (s: string) => new Date(s)
const table = async (tab: string) => (await json(await call(`/api/team-revenue/table?tab=${tab}&startDate=2026-11-01&endDate=2026-11-30`))).body

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  ownerId = s.owner.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: ['jobs', 'contacts', 'team', 'invoices', 'quotes', 'team_revenue_reports'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  tia = (await ins(t.schema.user, { companyId, email: 'tia@heat.example', firstName: 'Tia', lastName: 'Tech', role: 'field', passwordHash: 'x', isActive: true })).id
  hank = (await ins(t.schema.contact, { companyId, name: 'Hank', type: 'client' })).id
  const j = (n: number, extra: any) => ins(t.schema.job, { companyId, number: `JOB-${n}`, title: `Job ${n}`, contactId: hank, assignedToId: tia, createdById: ownerId, status: 'completed', createdAt: at('2026-11-01T14:00:00Z'), ...extra })
  // Booked 9:00 Chicago (15:00Z): started 9:10 (on time) and 9:40 (late); one with no booked time.
  await j(1, { scheduledDate: at('2026-11-03T00:00:00Z'), scheduledTime: '09:00', startedAt: at('2026-11-03T15:10:00Z'), completedAt: at('2026-11-03T17:00:00Z') })
  await j(2, { scheduledDate: at('2026-11-10T00:00:00Z'), scheduledTime: '09:00', startedAt: at('2026-11-10T15:40:00Z'), completedAt: at('2026-11-10T17:00:00Z') })
  await j(3, { scheduledDate: at('2026-11-20T00:00:00Z'), scheduledTime: null, startedAt: at('2026-11-20T15:00:00Z'), completedAt: at('2026-11-20T17:00:00Z') })
  // Made a week after job 2 was completed: a call-back for jobs 1 and 2 (within 30 days of each), not for job 3.
  await ins(t.schema.job, { companyId, number: 'JOB-4', title: 'Back again', contactId: hank, createdById: ownerId, status: 'cancelled', createdAt: at('2026-11-17T15:00:00Z') })
}, 120_000)

test('the booked start is on the business clock', () => {
  expect(bookedStart(at('2026-11-03T00:00:00Z'), '09:00', 'America/Chicago')?.toISOString()).toBe('2026-11-03T15:00:00.000Z')
  expect(bookedStart(at('2026-11-03T00:00:00Z'), null, 'America/Chicago')).toBeNull()
})

test('the tech scorecard: jobs, on time of those timed, call-backs', async () => {
  const r = await table('tech_scorecard')
  const row = r.rows.find((x: any) => x.person === 'Tia Tech')
  expect(row).toMatchObject({ jobs: 3, onTime: 50, callbacks: 2, callbackRate: 67 })
})

test('the office scorecard: booked in the period, completed and cancelled', async () => {
  const r = await table('csr_scorecard')
  expect(r.rows[0]).toMatchObject({ booked: 4, completed: 3, cancelled: 1, completedRate: 75 })
  expect(r.totals).toMatchObject({ booked: 4 })
})
