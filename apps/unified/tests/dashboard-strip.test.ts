// The money-and-waiting strip on every trade's home screen (brief item 2): cash in this week and month, what is owed and
// what is past due, and leads nobody has answered for a day. GET /api/dashboard-strip. It did not exist: the jobs
// dashboard read the overdue figures the server already sent and never showed them, there was no cash-in figure
// anywhere on a home screen, and the only lead figure counted a lead the moment it arrived.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { periodStarts } from '../server/crm/dashboard/moneyStrip.ts'
import { getFeaturesForTemplate } from '../../../packages/tenant-backend/src/featureRegistry.ts'
import fs from 'node:fs'
import path from 'node:path'

const TZ = 'America/Chicago'
const DAY = 86400000

async function boot(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, timezone: TZ } as any).where(eq(t.schema.company.id, s.company.id))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const seat = async (role: string) => {
    await ins(t.schema.user, { companyId: s.company.id, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    return as(await login(`${role}@test.example`, 'Correct-horse-1'))
  }
  return { t, ins, owner, seat, companyId: s.company.id as string }
}

describe('the week and the month, on the business’s calendar', () => {
  test('Wednesday 28 Oct 2026 in Chicago: the week began Monday 26th at midnight, the month on the 1st', () => {
    const { week, month } = periodStarts(TZ, new Date('2026-10-28T20:00:00Z'))
    expect(week.toISOString()).toBe('2026-10-26T05:00:00.000Z') // CDT, UTC-5
    expect(month.toISOString()).toBe('2026-10-01T05:00:00.000Z')
  })
  test('a Sunday still belongs to the week that began the Monday before; the first of a month starts it', () => {
    expect(periodStarts(TZ, new Date('2026-11-01T18:00:00Z')).week.toISOString()).toBe('2026-10-26T05:00:00.000Z')
    expect(periodStarts(TZ, new Date('2026-11-01T18:00:00Z')).month.toISOString()).toBe('2026-11-01T05:00:00.000Z') // CST from 1 Nov 2am
    expect(periodStarts(TZ, new Date('2026-11-02T18:00:00Z')).week.toISOString()).toBe('2026-11-02T06:00:00.000Z')
  })
})

describe('the strip', () => {
  test('cash in, owed and past due, and leads that waited more than a day — and the rest are left out', async () => {
    const { t, ins, owner, companyId } = await boot('contractor', ['contacts', 'invoices', 'lead_inbox', 'dashboard'])
    const now = Date.now()
    const { week, month } = periodStarts(TZ)
    const bob = await ins(t.schema.contact, { companyId, name: 'Bob Buyer', type: 'customer' })
    // $1,000 sent, due two weeks ago, $250 paid so far: $750 owed and all of it past due.
    const late = await ins(t.schema.invoice, { companyId, contactId: bob.id, number: 'INV-1', status: 'partial', total: '1000', subtotal: '1000', amountPaid: '250', dueDate: new Date(Math.floor((now - 14 * DAY) / DAY) * DAY) })
    // $400 sent, due in a fortnight: owed, not late.
    await ins(t.schema.invoice, { companyId, contactId: bob.id, number: 'INV-2', status: 'sent', total: '400', subtotal: '400', amountPaid: '0', dueDate: new Date(Math.floor((now + 14 * DAY) / DAY) * DAY) })
    // A draft and a void one are not money owed.
    await ins(t.schema.invoice, { companyId, contactId: bob.id, number: 'INV-3', status: 'draft', total: '999', subtotal: '999', amountPaid: '0' })
    await ins(t.schema.invoice, { companyId, contactId: bob.id, number: 'INV-4', status: 'void', total: '888', subtotal: '888', amountPaid: '0' })
    // Payments: one just now (week and month), one a minute before the week began, one a minute before the month began, one long ago.
    await ins(t.schema.payment, { invoiceId: late.id, amount: '100', method: 'cash', paidAt: new Date(now) })
    await ins(t.schema.payment, { invoiceId: late.id, amount: '30', method: 'cash', paidAt: new Date(week.getTime() - 60_000) })
    await ins(t.schema.payment, { invoiceId: late.id, amount: '7', method: 'cash', paidAt: new Date(month.getTime() - 60_000) })
    await ins(t.schema.payment, { invoiceId: late.id, amount: '3', method: 'cash', paidAt: new Date(now - 90 * DAY) })
    // Leads: two days old and new (counts), an hour old and new (too soon), two days old and answered (no), spam-named but contacted (no).
    await ins(t.schema.lead, { companyId, homeownerName: 'Waiting Wanda', sourcePlatform: 'website', status: 'new', receivedAt: new Date(now - 2 * DAY) })
    await ins(t.schema.lead, { companyId, homeownerName: 'Fresh Fred', sourcePlatform: 'website', status: 'new', receivedAt: new Date(now - 3_600_000) })
    await ins(t.schema.lead, { companyId, homeownerName: 'Answered Ann', sourcePlatform: 'website', status: 'contacted', receivedAt: new Date(now - 2 * DAY) })

    const r = await owner('/api/dashboard-strip')
    expect(r.status).toBe(200)
    const body = await r.json()
    // The month holds the payment just now and, when this week began before the month did, the 30 as well.
    const weekBeforeMonth = week.getTime() < month.getTime()
    expect(body.money.cashInWeek).toBe(100)
    expect(body.money.cashInMonth).toBe(100 + (week.getTime() - 60_000 >= month.getTime() ? 30 : 0))
    expect(weekBeforeMonth || body.money.cashInMonth >= 100).toBe(true)
    expect(body.money).toMatchObject({ owed: 1150, owedCount: 2, overdue: 750, overdueCount: 1 })
    expect(body.leads).toEqual({ unanswered: 1 })
  }, 60_000)

  test('a lead contact nobody has quoted, booked or billed counts once it has waited a day', async () => {
    const { t, ins, owner, companyId } = await boot('contractor', ['contacts', 'invoices', 'lead_inbox', 'dashboard'])
    await ins(t.schema.contact, { companyId, name: 'Old Lead', type: 'lead', createdAt: new Date(Date.now() - 3 * DAY) })
    await ins(t.schema.contact, { companyId, name: 'New Lead', type: 'lead' })
    const body = await (await owner('/api/dashboard-strip')).json()
    expect(body.leads).toEqual({ unanswered: 1 })
  }, 60_000)

  test('a seat that may not read invoices gets no money, one that may not read leads gets no leads — the keys are absent, not zero', async () => {
    const { owner, seat } = await boot('contractor', ['contacts', 'invoices', 'lead_inbox', 'dashboard'])
    expect(Object.keys(await (await owner('/api/dashboard-strip')).json()).sort()).toEqual(['leads', 'money'])
    const field = await seat('field')
    const r = await field('/api/dashboard-strip')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({})
  }, 60_000)

  test('a business without invoices switched on gets no money', async () => {
    const { owner } = await boot('contractor', ['contacts', 'lead_inbox', 'dashboard'])
    expect(Object.keys(await (await owner('/api/dashboard-strip')).json())).toEqual(['leads'])
  }, 60_000)

  test('with the dashboard switched off the route is not there', async () => {
    const { owner } = await boot('contractor', ['contacts', 'invoices'])
    expect((await owner('/api/dashboard-strip')).status).toBe(403)
  }, 60_000)
})

const verticals = fs.readdirSync(path.join(import.meta.dir, '../verticals')).filter((v) => fs.existsSync(path.join(import.meta.dir, '../verticals', v, 'settings.ts')))
describe('every trade has the strip, with what that trade has', () => {
  for (const v of verticals) {
    test(v, async () => {
      const s: any = (await import(`../verticals/${v}/settings.ts`)).default
      const offered = new Set(getFeaturesForTemplate(s.featureSet).map((d) => d.id))
      // A business is switched on for what its trade offers; home care and the store are offered no invoices.
      const { owner } = await boot(s.id, ['dashboard', 'lead_inbox', ...(offered.has('invoices') ? ['invoices'] : [])])
      const r = await owner('/api/dashboard-strip')
      expect(r.status).toBe(200)
      const body = await r.json()
      // Leads: every trade has the Lead Inbox. Money: every trade that has invoices.
      expect(body.leads).toEqual({ unanswered: 0 })
      if (offered.has('invoices')) expect(body.money).toMatchObject({ cashInWeek: 0, cashInMonth: 0, owed: 0, overdue: 0 })
      else expect(body.money).toBeUndefined()
    }, 60_000)
  }
})
