// "Collected" counts every recorded payment on the business's own day (live test 2026-10-22: "This month revenue
// (collected)" read $0.00 after payments were recorded the same day). Home care's tile counts a client's invoice payments
// AND a payer's checks; the shared Reports read a plain date as the company's day and bucket months on its clock, so an
// evening payment in Chicago (already tomorrow in UTC) is today's and this month's.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { storeDateString, zonedWallTimeToUtc, addDays } from '@twomiah/tenant-backend'

const TZ = 'America/Chicago'

async function boot(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, timezone: TZ } as any).where(eq(t.schema.company.id, s.company.id))
  const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  const as = (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  return { t, as, companyId: s.company.id as string }
}

describe("home care's This Month Revenue (collected)", () => {
  test("a client's cash payment and a payer's check recorded today both count", async () => {
    const { t, as, companyId } = await boot('homecare', ['dashboard'])
    const [ada] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Ada', lastName: 'Client', isActive: true } as any).returning()
    const [inv] = await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-1', clientId: ada.id, billingPeriodStart: '2026-10-01', billingPeriodEnd: '2026-10-14', subtotal: '120', total: '120', amountPaid: '0', paymentStatus: 'pending', sentAt: new Date() } as any).returning()
    expect((await as('/api/billing/invoice-payments', { method: 'POST', json: { invoiceId: inv.id, amount: 50, paymentMethod: 'cash' } })).status).toBe(201)
    expect((await as('/api/payments', { method: 'POST', json: { payerName: 'County Medicaid', checkAmount: '300.00', paymentMethod: 'check' } })).status).toBe(200)
    const s = await (await as('/api/dashboard/summary')).json()
    expect(s.thisMonthRevenue).toBe(350)
  }, 60_000)
})

describe('the shared Reports on the company’s day', () => {
  test("an evening payment (tomorrow in UTC) is today's collected, not tomorrow's; and this month's", async () => {
    const { t, as, companyId } = await boot('contractor', ['contacts', 'invoices', 'reports', 'dashboard'])
    const today = storeDateString(new Date(), TZ)
    const [inv] = await t.db.insert(t.schema.invoice).values({ companyId, number: 'INV-1', status: 'sent', total: '500', subtotal: '500' } as any).returning()
    // 9:30 PM in Chicago today: 02:30 or 03:30 tomorrow in UTC.
    const evening = zonedWallTimeToUtc(today, '21:30', TZ)
    await t.db.insert(t.schema.payment).values({ invoiceId: inv.id, amount: '200', method: 'cash', paidAt: evening } as any)
    const day = async (d: string) => (await (await as(`/api/reports/revenue?startDate=${d}&endDate=${d}`)).json()).collected
    expect(await day(today)).toBe(200)
    expect(await day(addDays(today, 1))).toBe(0)
    const months = await (await as('/api/reports/revenue/monthly?months=2')).json()
    expect(months.at(-1)).toMatchObject({ month: today.slice(0, 7), collected: 200 })
  }, 60_000)

  test('the last evening of last month stays in last month', async () => {
    const { t, as, companyId } = await boot('contractor', ['contacts', 'invoices', 'reports', 'dashboard'])
    const today = storeDateString(new Date(), TZ)
    const lastOfPrev = addDays(`${today.slice(0, 7)}-01`, -1)
    const [inv] = await t.db.insert(t.schema.invoice).values({ companyId, number: 'INV-2', status: 'sent', total: '80', subtotal: '80' } as any).returning()
    await t.db.insert(t.schema.payment).values({ invoiceId: inv.id, amount: '80', method: 'check', paidAt: zonedWallTimeToUtc(lastOfPrev, '22:00', TZ) } as any)
    const months = await (await as('/api/reports/revenue/monthly?months=2')).json()
    expect(months.map((m: any) => [m.month, m.collected])).toEqual([[lastOfPrev.slice(0, 7), 80], [today.slice(0, 7), 0]])
  }, 60_000)
})
