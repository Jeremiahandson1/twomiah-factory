// Gift-card money is counted ONCE (follow-up 10/30 to PR #167, fix 1; docs/parity/salon-gift-cards.md "Revenue").
//
// Selling a gift card is a liability, not revenue; revenue is counted when the card is SPENT on a service or a product. Before the fix a
// $50 card sold and then spent on a $50 service showed $100 in every invoice-based total (the card's own paid sale, and the service paid
// with it). One definition now — "an invoice that sold a gift card is not revenue" (server/data/salon.ts `notGiftCardSale`) — is used by
// every place that adds up invoices: the shared Reports (overview, dashboard, monthly, by customer), the invoice list's stats, and the
// client's lifetime spend.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'reports', 'salon_gift_cards']

describe('salon: gift-card money is counted once', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  let token = ''
  let ip = 0, n = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const get = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${token}`, 'x-forwarded-for': `10.9.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  /** An open sale for `total` dollars, for a client. */
  const sale = async (total: number, contactId: string) => {
    const inv = await ins(t.schema.invoice, { companyId: co, contactId, number: `INV-R${++n}`, status: 'open', subtotal: String(total), total: String(total), amountPaid: '0', dueDate: new Date() })
    await ins(t.schema.invoiceLineItem, { invoiceId: inv.id, description: 'Colour', type: 'service', quantity: '1', unitPrice: String(total), total: String(total) })
    return inv.id as string
  }
  /** Every figure that adds invoices up, read the way the screens read them. */
  const totals = async (clientId: string) => {
    const rev = (await get('/api/reports/revenue')).body
    const dash = (await get('/api/reports/dashboard')).body
    const monthly = (await get('/api/reports/revenue/monthly?months=2')).body as Array<{ invoiced: number; collected: number }>
    const customers = (await get('/api/reports/revenue/customers')).body as Array<{ contact: { id: string }; invoiced: number; collected: number }>
    const stats = (await get('/api/invoices/stats')).body
    const chart = (await get(`/api/clients/${clientId}`)).body
    const me = customers.find((c) => c.contact.id === clientId)
    return {
      overview: [rev.invoiced, rev.collected], dashboard: [dash.revenue?.invoiced, dash.revenue?.collected],
      monthly: [monthly.reduce((s, m) => s + m.invoiced, 0), monthly.reduce((s, m) => s + m.collected, 0)],
      customer: [me?.invoiced ?? 0, me?.collected ?? 0], invoiceList: [stats.totalAmount, stats.paidAmount],
      lifetime: (chart.data ?? chart).stats?.lifetimeValue,
    }
  }

  let client = ''
  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ name: 'Glow Studio', enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    token = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    client = (await ins(t.schema.contact, { companyId: co, type: 'client', name: 'Pat Buyer', email: 'pat@example.com' })).id
  }, 120_000)

  test('a $50 card sold and then spent on a $50 service shows $50 once in every total', async () => {
    const sold = await get('/api/salon-gift-cards/sell', 'POST', { amountCents: 5000, method: 'cash', contactId: client })
    expect(sold.status).toBe(201)
    // Sold, not yet spent: a liability. Nothing is revenue yet, in any total.
    const before = await totals(client)
    expect(before).toEqual({ overview: [0, 0], dashboard: [0, 0], monthly: [0, 0], customer: [0, 0], invoiceList: [0, 0], lifetime: 0 })
    // The salon's books show it as money owed to the holder instead.
    expect((await get('/api/salon-gift-cards')).body.outstandingCents ?? (await get('/api/salon-gift-cards')).body.data?.outstandingCents).toBe(5000)

    const service = await sale(50, client)
    const spent = await get('/api/salon-gift-cards/redeem', 'POST', { code: sold.body.card.code, invoiceId: service })
    expect(spent.status).toBe(200)
    // Spent: now it is revenue — $50, once.
    const after = await totals(client)
    expect(after).toEqual({ overview: [50, 50], dashboard: [50, 50], monthly: [50, 50], customer: [50, 50], invoiceList: [50, 50], lifetime: 50 })
    expect((await get('/api/salon-gift-cards')).body.outstandingCents ?? (await get('/api/salon-gift-cards')).body.data?.outstandingCents).toBe(0)
  })

  test('an unspent card adds nothing; an ordinary sale beside it adds exactly its own amount; a refund back onto the card takes the revenue back off', async () => {
    const sold = await get('/api/salon-gift-cards/sell', 'POST', { amountCents: 3000, method: 'card', contactId: client })
    expect(sold.status).toBe(201)
    const ordinary = await sale(20, client)
    expect((await get(`/api/invoices/${ordinary}/payments`, 'POST', { amount: 20, method: 'cash' })).status).toBeLessThan(300)
    const mid = await totals(client)
    expect(mid).toEqual({ overview: [70, 70], dashboard: [70, 70], monthly: [70, 70], customer: [70, 70], invoiceList: [70, 70], lifetime: 70 })
    // Spend $30 of the new card on a $30 service, then give that service back onto the card: the revenue goes, the liability returns.
    const service = await sale(30, client)
    expect((await get('/api/salon-gift-cards/redeem', 'POST', { code: sold.body.card.code, invoiceId: service })).status).toBe(200)
    expect((await totals(client)).overview).toEqual([100, 100])
    const back = await get(`/api/invoices/${service}/refund`, 'POST', { amount: 30, method: 'gift_card', reason: 'client returned the colour' })
    expect(back.status).toBe(200)
    const end = await totals(client)
    expect(end.overview[1]).toBe(70)                                      // collected is net of the refund
    expect(end.invoiceList[1]).toBe(70)
    expect(end.lifetime).toBe(70)
    expect((await get('/api/salon-gift-cards')).body.outstandingCents ?? (await get('/api/salon-gift-cards')).body.data?.outstandingCents).toBe(3000)
  })
})
