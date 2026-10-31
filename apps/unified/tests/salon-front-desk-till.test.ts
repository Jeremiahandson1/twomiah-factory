// The front desk's till (follow-up 10/30 to PR #167; owner's decision). The Front Desk seat (role `viewer`) may SELL GIFT CARDS (and take them as
// payment), TAKE A CARD ON THE READER and SELL RETAIL — three narrow rights (`giftcards:sell`, `cardreader:use`, `retail:sell`, granted in
// verticals/salon/settings.ts) and nothing more: no general invoice editing, no cash payments recorded by hand, no refunds or voids, no gift-card
// corrections, no reader pairing, no catalogue or stock. A stylist seat (`field`) still cannot do any of the three. Manager/owner behave as before.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'

const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'chair_checkout', 'salon_gift_cards', 'salon_retail']

describe('salon: the front desk works the till — and only the till', () => {
  let k: Awaited<ReturnType<typeof bootFood>>
  let t: any, S: any, co = ''
  const tokens: Record<string, string> = {}
  let ip = 0, n = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: 'owner' | 'manager' | 'desk' | 'bartender', path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.6.0.${++ip}`, host: 'bar.test' } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  /** An open sale for `total` dollars. */
  const sale = async (total = 100) => {
    const inv = await ins(S.invoice, { companyId: co, number: `INV-D${++n}`, status: 'open', subtotal: String(total), total: String(total), amountPaid: '0', dueDate: new Date() })
    await ins(S.invoiceLineItem, { invoiceId: inv.id, description: 'Colour', type: 'service', quantity: '1', unitPrice: String(total), total: String(total) })
    return inv.id as string
  }
  let readerId = '', shampoo = ''

  beforeAll(async () => {
    k = await bootFood({ vertical: 'salon', features: FEATURES })
    t = k.t; S = k.S; co = k.companyId
    Object.assign(tokens, k.tokens)
    // The Front Desk seat: the viewer rung.
    await ins(S.user, { email: 'desk@test.example', passwordHash: await Bun.password.hash('Desk-pass-1', 'bcrypt'), firstName: 'Dee', lastName: 'Desk', role: 'viewer', companyId: co })
    tokens.desk = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'desk@test.example', password: 'Desk-pass-1' } })).json()) as any).accessToken
    readerId = (await as('owner', '/api/chair-checkout/readers', 'POST', { code: 'simulated-wpe', label: 'Front desk' })).body.reader.id
    shampoo = (await as('owner', '/api/salon-retail/products', 'POST', { name: 'Shampoo', priceCents: 1800, openingStock: 20 })).body.product.id
  }, 120_000)
  afterAll(() => k.restore())

  test('the front desk sells a gift card, looks it up and takes it as payment on a sale', async () => {
    const sold = await as('desk', '/api/salon-gift-cards/sell', 'POST', { amountCents: 5000, method: 'cash' })
    expect(sold.status).toBe(201)
    const code = sold.body.card.code
    expect((await as('desk', `/api/salon-gift-cards/lookup?code=${code}`)).status).toBe(200)
    expect((await as('desk', '/api/salon-gift-cards')).status).toBe(200)
    const inv = await sale(50)
    expect((await as('desk', '/api/salon-gift-cards/redeem', 'POST', { code, invoiceId: inv })).status).toBe(200)
    expect((await t.db.select().from(S.invoice).where(eq(S.invoice.id, inv)))[0].status).toBe('paid')
  })

  test('the front desk takes a card on the reader (and can cancel it)', async () => {
    const inv = await sale(100)
    expect((await as('desk', '/api/chair-checkout/readers')).status).toBe(200)
    const started = await as('desk', '/api/chair-checkout/charges', 'POST', { invoiceId: inv, readerId })
    expect(started.status).toBe(201)
    const id = started.body.charge.id
    expect((await as('desk', `/api/chair-checkout/charges/${id}`)).status).toBe(200)
    expect((await as('desk', `/api/chair-checkout/sales/${inv}/charge`)).status).toBe(200)
    expect((await as('desk', `/api/chair-checkout/sales/${inv}/payments`)).status).toBe(200)
    expect((await as('desk', `/api/chair-checkout/charges/${id}/cancel`, 'POST')).status).toBe(200)
  })

  test('the front desk sells retail onto a sale and on a walk-in sale, and takes a line off', async () => {
    expect((await as('desk', '/api/salon-retail')).status).toBe(200)
    const inv = await sale(100)
    const sold = await as('desk', '/api/salon-retail/sell', 'POST', { invoiceId: inv, items: [{ productId: shampoo, quantity: 2 }] })
    expect(sold.status).toBe(200)
    const lines = await t.db.select().from(S.invoiceLineItem).where(eq(S.invoiceLineItem.invoiceId, inv))
    const retail = lines.find((l: any) => l.type === 'retail')
    expect(retail).toBeTruthy()
    expect((await as('desk', `/api/salon-retail/lines/${retail.id}`, 'DELETE')).status).toBe(200)
    const walkIn = await as('desk', '/api/salon-retail/sell/new', 'POST', { items: [{ productId: shampoo, quantity: 1 }] })
    expect(walkIn.status).toBeLessThan(300)
  })

  test('and nothing more: no invoice editing, no hand-entered payments, no refunds, voids or corrections, no pairing, no catalogue', async () => {
    const inv = await sale(100)
    const card = (await as('owner', '/api/salon-gift-cards/sell', 'POST', { amountCents: 2500, method: 'cash' })).body.card
    const refused: Array<[string, string, string, unknown?]> = [
      ['edit a sale', 'PUT', `/api/invoices/${inv}`, { notes: 'x' }],
      ['record a cash payment by hand', 'POST', `/api/invoices/${inv}/payments`, { amount: 10, method: 'cash' }],
      ['refund a sale', 'POST', `/api/invoices/${inv}/refund`, { amount: 5, reason: 'x' }],
      ['create an invoice', 'POST', '/api/invoices', { lineItems: [] }],
      ['correct a gift card', 'POST', `/api/salon-gift-cards/${card.id}/adjust`, { deltaCents: 100, reason: 'x' }],
      ['void a gift card', 'POST', `/api/salon-gift-cards/${card.id}/void`, { reason: 'x' }],
      ['pair a reader', 'POST', '/api/chair-checkout/readers', { code: 'simulated-wpe' }],
      ['remove a reader', 'DELETE', `/api/chair-checkout/readers/${readerId}`],
      ['tap a test card', 'POST', '/api/chair-checkout/charges/abc/simulate', { outcome: 'approve' }],
      ['refund to the card', 'POST', '/api/chair-checkout/payments/abc/refund', { reason: 'x' }],
      ['read the retail catalogue with cost', 'GET', '/api/salon-retail/manage'],
      ['add a product', 'POST', '/api/salon-retail/products', { name: 'x', priceCents: 100 }],
      ['change a product', 'PATCH', `/api/salon-retail/products/${shampoo}`, { name: 'y' }],
      ['correct stock', 'POST', `/api/salon-retail/products/${shampoo}/stock`, { quantity: 1, reason: 'x' }],
    ]
    for (const [what, method, path, body] of refused) {
      const r = await as('desk', path, method, body)
      expect([what, r.status]).toEqual([what, 403])
    }
  })

  test('a stylist still cannot sell cards, take a card or sell retail; a manager and the owner still can', async () => {
    const inv = await sale(100)
    const card = (await as('owner', '/api/salon-gift-cards/sell', 'POST', { amountCents: 5000, method: 'cash' })).body.card
    const stylistRefused: Array<[string, string, string, unknown?]> = [
      ['sell a gift card', 'POST', '/api/salon-gift-cards/sell', { amountCents: 5000, method: 'cash' }],
      ['spend a gift card', 'POST', '/api/salon-gift-cards/redeem', { code: card.code, invoiceId: inv }],
      ['look a card up', 'GET', `/api/salon-gift-cards/lookup?code=${card.code}`],
      ['list readers', 'GET', '/api/chair-checkout/readers'],
      ['take a card', 'POST', '/api/chair-checkout/charges', { invoiceId: inv, readerId }],
      ['sell retail', 'POST', '/api/salon-retail/sell', { invoiceId: inv, items: [{ productId: shampoo, quantity: 1 }] }],
      ['sell a walk-in', 'POST', '/api/salon-retail/sell/new', { items: [{ productId: shampoo, quantity: 1 }] }],
    ]
    for (const [what, method, path, body] of stylistRefused) {
      const r = await as('bartender', path, method, body)
      expect([what, r.status]).toEqual([what, 403])
    }
    // The seats that could before still can.
    expect((await as('manager', '/api/salon-gift-cards/sell', 'POST', { amountCents: 5000, method: 'cash' })).status).toBe(201)
    expect((await as('manager', '/api/salon-gift-cards/redeem', 'POST', { code: card.code, invoiceId: inv })).status).toBe(200)
    expect((await as('manager', '/api/chair-checkout/readers')).status).toBe(200)
    const inv2 = await sale(100)
    expect((await as('manager', '/api/salon-retail/sell', 'POST', { invoiceId: inv2, items: [{ productId: shampoo, quantity: 1 }] })).status).toBe(200)
    expect((await as('owner', '/api/salon-retail/sell/new', 'POST', { items: [{ productId: shampoo, quantity: 1 }] })).status).toBeLessThan(300)
  })
})
