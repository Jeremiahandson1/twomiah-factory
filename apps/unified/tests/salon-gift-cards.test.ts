// Gift cards for salons (salon gap #10; server/crm/salon/giftCards.ts, feature `salon_gift_cards`). Sold at the desk (paid, card issued in the
// payment's own transaction), spent as a payment on a sale (debited inside that payment, so two tills cannot spend the same dollar), a refund
// by gift card goes back onto the card, balance looked up, corrected and voided by a manager. The code is never written on an invoice.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices']
const PASSWORD = 'Gift-1030-card'

describe('salon: gift cards', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tokens: Record<string, string> = {}
  const emails: Array<{ to: string; subject: string; html: string }> = []
  let ip = 0, n = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.8.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  /** An open sale for `total` dollars (a visit's bill). */
  const sale = async (total: number) => {
    const inv = await ins(t.schema.invoice, { companyId: co, number: `INV-T${++n}`, status: 'open', subtotal: String(total), total: String(total), amountPaid: '0', dueDate: new Date() })
    await ins(t.schema.invoiceLineItem, { invoiceId: inv.id, description: 'Colour', type: 'service', quantity: '1', unitPrice: String(total), total: String(total) })
    return inv.id as string
  }
  const invoiceOf = async (id: string) => (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, id)))[0]
  const paymentsOf = async (id: string) => t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, id))
  const cardRow = async (id: string) => (await t.db.select().from(t.schema.salonGiftCard).where(eq(t.schema.salonGiftCard.id, id)))[0]
  const ledgerOf = async (id: string) => t.db.select().from(t.schema.salonGiftCardLedger).where(eq(t.schema.salonGiftCardLedger.cardId, id))
  const sellCard = (cents: number, extra: Record<string, unknown> = {}) => as('owner', '/api/salon-gift-cards/sell', 'POST', { amountCents: cents, method: 'cash', ...extra })

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ name: 'Glow Studio' } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    await ins(t.schema.user, { email: 'stylist@test.example', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: 'Sam', lastName: 'Stylist', role: 'field', companyId: co })
    tokens.stylist = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'stylist@test.example', password: PASSWORD } })).json()) as any).accessToken
    ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { emails.push(m) }
  }, 120_000)

  test('closed until the salon is given the feature; then a seat without the rights is refused by the server', async () => {
    expect((await as('owner', '/api/salon-gift-cards')).status).not.toBe(200)
    expect((await sellCard(5000)).status).not.toBe(201)
    await features([...FEATURES, 'salon_gift_cards'])
    expect((await as('owner', '/api/salon-gift-cards')).status).toBe(200)
    // A stylist does not sell, spend, correct or void cards; the server says so whatever the screen shows.
    const inv = await sale(50)
    for (const [path, body] of [['/api/salon-gift-cards/sell', { amountCents: 5000, method: 'cash' }], ['/api/salon-gift-cards/redeem', { code: 'X', invoiceId: inv }], ['/api/salon-gift-cards/abc/adjust', { deltaCents: 100, reason: 'x' }], ['/api/salon-gift-cards/abc/void', { reason: 'x' }]] as const) {
      expect([path, (await as('stylist', path, 'POST', body)).status]).toEqual([path, 403])
    }
    expect((await as('stylist', '/api/salon-gift-cards/lookup?code=ABCD')).status).toBe(403)
  })

  test('selling: a paid sale with one untaxed "Gift card" line, the card issued with it, the code emailed to the recipient and never written on the sale', async () => {
    for (const bad of [{ amountCents: 499 }, { amountCents: 100_001 }, { amountCents: 50.5 }, { amountCents: 'lots' }, { amountCents: 5000, method: 'bitcoin' }, { amountCents: 5000, recipientEmail: 'not-an-email' }]) {
      const r = await as('owner', '/api/salon-gift-cards/sell', 'POST', { method: 'cash', ...bad })
      expect([JSON.stringify(bad), r.status]).toEqual([JSON.stringify(bad), 400])
    }
    expect((await t.db.select().from(t.schema.salonGiftCard)).length).toBe(0)         // none of those left a card or an unpaid sale behind
    const r = await sellCard(10000, { method: 'card', purchaserName: 'Pat Buyer', recipientName: 'Robin', recipientEmail: 'robin@example.com', message: 'Happy birthday' })
    expect(r.status).toBe(201)
    const card = r.body.card
    expect(card.code).toMatch(/^GWST-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
    expect([card.initialCents, card.balanceCents, card.status, r.body.emailed]).toEqual([10000, 10000, 'active', true])
    const inv = await invoiceOf(r.body.invoiceId)
    expect([inv.status, Number(inv.total), Number(inv.amountPaid), Number(inv.taxAmount)]).toEqual(['paid', 100, 100, 0])
    const lines = await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, inv.id))
    expect(lines.map((l: any) => [l.description, l.type])).toEqual([['Gift card', 'gift_card']])
    const pays = await paymentsOf(inv.id)
    expect(pays.map((p: any) => [p.method, Number(p.amount)])).toEqual([['card', 100]])
    expect(JSON.stringify([inv, lines, pays])).not.toContain(card.code)              // the code is on the card and in the email only
    expect(emails).toHaveLength(1)
    expect([emails[0].to, emails[0].html.includes(card.code), emails[0].html.includes('$100'), emails[0].html.includes('Happy birthday')]).toEqual(['robin@example.com', true, true, true])
    expect((await ledgerOf(card.id)).map((l: any) => [l.kind, l.amountCents])).toEqual([['issue', 10000]])
    const lookup = await as('owner', `/api/salon-gift-cards/lookup?code=${card.code.toLowerCase().replace(/-/g, ' ')}`)   // typed any way
    expect([lookup.status, lookup.body.balanceCents]).toEqual([200, 10000])
    expect((await as('owner', '/api/salon-gift-cards/lookup?code=GWST-ZZZZ-ZZZZ')).status).toBe(404)
    const all = (await as('owner', '/api/salon-gift-cards')).body
    expect([all.cards.length, all.outstandingCents]).toEqual([1, 10000])
  })

  test('spending: part of a sale, then the rest; the card is debited inside the payment; the payment shows only the last four; over-balance and empty cards are refused', async () => {
    const card = (await as('owner', '/api/salon-gift-cards')).body.cards[0]
    const inv = await sale(80)
    const part = await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: card.code, invoiceId: inv, amountCents: 3000 })
    expect([part.status, part.body.balanceCents, part.body.appliedCents, part.body.invoiceBalanceCents]).toEqual([200, 7000, 3000, 5000])
    const rest = await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: card.code, invoiceId: inv })              // default: all that is owing
    expect([rest.status, rest.body.balanceCents, rest.body.appliedCents, rest.body.invoiceStatus]).toEqual([200, 2000, 5000, 'paid'])
    const pays = await paymentsOf(inv)
    expect(pays.map((p: any) => [p.method, Number(p.amount)]).sort()).toEqual([['gift_card', 30], ['gift_card', 50]])
    expect(pays.every((p: any) => p.reference === `Gift card ending ${card.code.replace(/-/g, '').slice(-4)}` && !JSON.stringify(p).includes(card.code))).toBe(true)
    expect((await invoiceOf(inv)).status).toBe('paid')
    expect((await ledgerOf(card.id)).filter((l: any) => l.kind === 'redeem').map((l: any) => l.amountCents).sort()).toEqual([-3000, -5000])
    // refusals
    const other = await sale(60)
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: card.code, invoiceId: other, amountCents: 2500 })).status).toBe(409)      // card has $20
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: card.code, invoiceId: other, amountCents: 0 })).status).toBe(400)
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: card.code, invoiceId: inv })).status).toBe(400)                        // nothing owing
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: 'GWST-0000-0000', invoiceId: other })).status).toBe(404)
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: card.code, invoiceId: 'nope' })).status).toBe(404)
    expect((await cardRow(card.id)).balanceCents).toBe(2000)
    expect((await paymentsOf(other)).length).toBe(0)
  })

  test('two tills spending the same card at the same instant: one lands, the other is refused, the balance never goes below zero', async () => {
    const sold = await sellCard(2000)
    const code = sold.body.card.code, id = sold.body.card.id
    const [a, b] = [await sale(20), await sale(20)]
    const results = await Promise.all([a, b].map((invoiceId) => as('owner', '/api/salon-gift-cards/redeem', 'POST', { code, invoiceId })))
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await cardRow(id)).balanceCents).toBe(0)
    const paid = (await Promise.all([a, b].map(async (x) => (await paymentsOf(x)).length))).sort()
    expect(paid).toEqual([0, 1])
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code, invoiceId: await sale(10) })).status).toBe(409)     // nothing left on it
  })

  test('a refund by gift card goes back onto the card, no more than was paid that way; a refund another way touches no card', async () => {
    const sold = await sellCard(8000)
    const id = sold.body.card.id, code = sold.body.card.code
    const inv = await sale(100)
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code, invoiceId: inv, amountCents: 8000 })).status).toBe(200)
    const cash = await as('owner', `/api/invoices/${inv}/payments`, 'POST', { amount: 20, method: 'cash' })
    expect(cash.status).toBe(201)
    // The most recent payment was cash, so a plain refund is cash: the card is untouched.
    expect((await as('owner', `/api/invoices/${inv}/refund`, 'POST', { amount: 10, reason: 'a goodwill refund' })).status).toBe(200)
    expect((await cardRow(id)).balanceCents).toBe(0)
    // Asked for by gift card: it goes back onto the card — and not more than was taken off it.
    expect((await as('owner', `/api/invoices/${inv}/refund`, 'POST', { amount: 90, method: 'gift_card', reason: 'too much' })).status).toBe(400)
    expect((await cardRow(id)).balanceCents).toBe(0)
    const back = await as('owner', `/api/invoices/${inv}/refund`, 'POST', { amount: 30, method: 'gift_card', reason: 'client returned the colour' })
    expect(back.status).toBe(200)
    expect((await cardRow(id)).balanceCents).toBe(3000)
    expect((await ledgerOf(id)).filter((l: any) => l.kind === 'refund').map((l: any) => [l.amountCents, l.invoiceId])).toEqual([[3000, inv]])
    // 80 off the card − 30 back = 50 still refundable that way, and no more.
    expect((await as('owner', `/api/invoices/${inv}/refund`, 'POST', { amount: 60, method: 'gift_card', reason: 'again' })).status).toBe(400)
    expect((await as('owner', `/api/invoices/${inv}/refund`, 'POST', { amount: 50, method: 'gift_card', reason: 'the rest' })).status).toBe(200)
    expect((await cardRow(id)).balanceCents).toBe(8000)
    // A voided card cannot take money back: the refund is refused and nothing moves.
    const sold2 = await sellCard(5000)
    const inv2 = await sale(50)
    await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: sold2.body.card.code, invoiceId: inv2 })
    expect((await as('owner', `/api/salon-gift-cards/${sold2.body.card.id}/void`, 'POST', { reason: 'lost' })).status).toBe(200)
    const refused = await as('owner', `/api/invoices/${inv2}/refund`, 'POST', { amount: 50, method: 'gift_card', reason: 'x' })
    expect([refused.status, (await invoiceOf(inv2)).amountRefunded]).toEqual([400, '0.00'])
  })

  test('a manager corrects or voids a card with a reason; the ledger keeps every step; a stylist cannot', async () => {
    const sold = await sellCard(3000)
    const id = sold.body.card.id, code = sold.body.card.code
    expect((await as('owner', `/api/salon-gift-cards/${id}/adjust`, 'POST', { deltaCents: 500 })).status).toBe(400)                                  // no reason
    expect((await as('owner', `/api/salon-gift-cards/${id}/adjust`, 'POST', { deltaCents: -4000, reason: 'oops' })).status).toBe(409)                // below zero
    expect((await as('owner', `/api/salon-gift-cards/${id}/adjust`, 'POST', { deltaCents: 0, reason: 'oops' })).status).toBe(400)
    const up = await as('owner', `/api/salon-gift-cards/${id}/adjust`, 'POST', { deltaCents: 500, reason: 'goodwill' })
    expect([up.status, up.body.card.balanceCents]).toEqual([200, 3500])
    expect((await as('owner', `/api/salon-gift-cards/${id}/void`, 'POST', {})).status).toBe(400)                                                      // no reason
    expect((await as('owner', `/api/salon-gift-cards/${id}/void`, 'POST', { reason: 'lost card' })).status).toBe(200)
    expect((await as('owner', `/api/salon-gift-cards/${id}/void`, 'POST', { reason: 'again' })).status).toBe(409)
    const gone = await cardRow(id)
    expect([gone.status, gone.balanceCents]).toEqual(['void', 0])
    const redeem = await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code, invoiceId: await sale(20) })
    expect([redeem.status, redeem.body.error]).toEqual([409, 'That gift card was voided.'])
    const detail = (await as('owner', `/api/salon-gift-cards/${id}`)).body
    expect(detail.history.map((h: any) => [h.kind, h.amountCents]).reverse()).toEqual([['issue', 3000], ['adjust', 500], ['void', -3500]])
    const log = await t.db.select().from(t.schema.auditLog)
    expect(JSON.stringify(log)).not.toContain(code)                                                                                              // the audit log never holds a code
  })

  test('a card whose own sale was refunded cannot be spent', async () => {
    const sold = await sellCard(4000)
    expect((await as('owner', `/api/invoices/${sold.body.invoiceId}/refund`, 'POST', { amount: 40, reason: 'buyer changed their mind' })).status).toBe(200)
    const r = await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: sold.body.card.code, invoiceId: await sale(40) })
    expect(r.status).toBe(409)
    expect(r.body.error).toContain('refunded')
    expect((await cardRow(sold.body.card.id)).balanceCents).toBe(4000)           // an owner can void it; spending is what is stopped
  })
})
