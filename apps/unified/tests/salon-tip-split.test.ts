// Tips split by service value (salon parity row 10; Fresha, Square). A sale's tip is shared between the stylists on the visit by the value of their
// services; the salon can set its own percentages on the sale, at checkout or afterwards; the Tips by stylist report follows the shares; a tip
// given back (app refund, or a refund made in Stripe's own dashboard) comes off each person's tips by the same shares.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootFood } from './foodKit.ts'
import { splitCents, defaultWeights, weightsFromPercents } from '../server/crm/salon/tipSplit.ts'

describe('tip split arithmetic', () => {
  test('whole cents that add up to the tip exactly, a refund mirrors the same split, ties go to the earlier person', () => {
    const w = [{ key: 'u:a', weight: 1 }, { key: 'u:b', weight: 1 }, { key: 'u:c', weight: 1 }]
    expect(splitCents(100, w).map((x) => x.cents)).toEqual([34, 33, 33])
    expect(splitCents(-100, w).map((x) => x.cents)).toEqual([-34, -33, -33])
    expect(splitCents(700, [{ key: 'u:a', weight: 12000 }, { key: 'u:b', weight: 4000 }]).map((x) => x.cents)).toEqual([525, 175])
    expect(splitCents(1, [{ key: 'u:a', weight: 3 }, { key: 'u:b', weight: 1 }]).map((x) => x.cents)).toEqual([1, 0])
    expect(splitCents(0, w).every((x) => x.cents === 0)).toBe(true)
  })
  test('default weights are the value of each person\'s services; nothing priced → the visit\'s stylist', () => {
    expect(defaultWeights([{ key: 'u:a', priceCents: 12000 }, { key: 'u:b', priceCents: 4000 }, { key: 'u:a', priceCents: 0 }], 'u:z')).toEqual([{ key: 'u:a', weight: 12000 }, { key: 'u:b', weight: 4000 }])
    expect(defaultWeights([{ key: 'u:a', priceCents: 0 }], 'u:z')).toEqual([{ key: 'u:z', weight: 1 }])
  })
  test('typed percentages must make 100%, once per person, each 0–100', () => {
    expect('weights' in weightsFromPercents([{ key: 'u:a', percent: '33.33' }, { key: 'u:b', percent: 66.67 }])).toBe(true)
    expect((weightsFromPercents([{ key: 'u:a', percent: 60 }, { key: 'u:b', percent: 30 }]) as any).problem).toContain('90%')
    expect('problem' in weightsFromPercents([{ key: 'u:a', percent: 50 }, { key: 'u:a', percent: 50 }])).toBe(true)
    expect('problem' in weightsFromPercents([{ key: 'u:a', percent: -5 }, { key: 'u:b', percent: 105 }])).toBe(true)
    expect('problem' in weightsFromPercents([])).toBe(true)
  })
})

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'chair_checkout', 'salon_reports', 'online_payments']

describe('salon: a sale\'s tip is split between the stylists on it', () => {
  let k: Awaited<ReturnType<typeof bootFood>>
  let t: any, S: any, co = '', ana = '', bea = '', cut = '', colour = ''
  let ip = 0, hour = 7
  const as = async (who: 'owner' | 'manager' | 'bartender', path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${k.tokens[who]}`, 'x-forwarded-for': `10.8.0.${++ip}`, host: 'bar.test' } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const day = addDays(today(), -3)
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  /** A completed visit: Ana's $100 cut (the appointment's own service), and — when `twoStylists` — her $120 and Bea's $40 as the visit's services. */
  async function visitSale(twoStylists = true) {
    const client = await ins(S.contact, { companyId: co, name: `Client ${ip}`, email: `c${ip}-${hour}@example.com`, type: 'client' })
    hour += 1
    const slot = hour - 8
    const made = await as('owner', '/api/appointments', 'POST', { contactId: client.id, startTime: wall(addDays(day, -Math.floor(slot / 12)), `${String(8 + (slot % 12)).padStart(2, '0')}:00`), serviceId: cut, stylistId: ana })
    expect(made.status).toBe(201)
    if (twoStylists) {
      await ins(S.appointmentItem, { companyId: co, appointmentId: made.body.id, position: 0, serviceId: colour, stylistId: ana, startOffsetMin: 0, durationMin: 60, price: '120.00' })
      await ins(S.appointmentItem, { companyId: co, appointmentId: made.body.id, position: 1, serviceId: cut, stylistId: bea, startOffsetMin: 60, durationMin: 30, price: '40.00' })
    }
    expect((await as('owner', `/api/appointments/${made.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(S.invoice).where(eq(S.invoice.appointmentId, made.body.id))
    return inv.id as string
  }
  const paymentsOf = async (id: string) => (await t.db.select().from(S.payment).where(eq(S.payment.invoiceId, id))) as any[]
  let readerId = ''
  const tips = async () => {
    const r = (await as('owner', '/api/salon-reports/tips')).body
    const of = (id: string) => (r.stylists as any[]).find((x) => x.id === id)?.tips ?? 0
    return { ana: of(ana), bea: of(bea), total: r.total as number }
  }
  /** Take the sale (whatever it comes to) on cash with a tip typed at the desk. */
  async function paidCash(sale: string, tip: number) {
    const inv = (await t.db.select().from(S.invoice).where(eq(S.invoice.id, sale)))[0]
    const r = await as('owner', `/api/invoices/${sale}/payments`, 'POST', { amount: Number(inv.total), method: 'cash', tipAmount: tip })
    expect(r.status).toBeLessThan(300)
  }

  beforeAll(async () => {
    k = await bootFood({ vertical: 'salon', features: FEATURES, sharedStripe: true })
    t = k.t; S = k.S; co = k.companyId
    await t.db.update(S.company).set({ timezone: TZ }).where(eq(S.company.id, co))
    const mk = async (email: string, first: string) => (await ins(S.user, { email, passwordHash: await Bun.password.hash('Pass-1-word', 'bcrypt'), firstName: first, lastName: 'Stylist', role: 'field', companyId: co })).id
    ana = await mk('ana@test.example', 'Ana'); bea = await mk('bea@test.example', 'Bea')
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 100 })).body.id
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 120 })).body.id
    readerId = (await as('owner', '/api/chair-checkout/readers', 'POST', { code: 'simulated-wpe', label: 'Front desk' })).body.reader.id
  }, 120_000)
  afterAll(() => k.restore())

  test('by default the tip follows the value of each stylist\'s services: $120 and $40 share a $8 tip 6 and 2 — on the sale screen and on the report', async () => {
    const before = await tips()
    const sale = await visitSale()
    await paidCash(sale, 8)
    const view = (await as('owner', `/api/chair-checkout/sales/${sale}/tip-split`)).body
    expect(view).toMatchObject({ tipCents: 800, manual: false })
    expect(view.people.map((p: any) => [p.name, p.percent, p.cents])).toEqual([['Ana Stylist', 75, 600], ['Bea Stylist', 25, 200]])
    const after = await tips()
    expect([after.ana - before.ana, after.bea - before.bea, after.total - before.total]).toEqual([6, 2, 8])
  })

  test('a sale with one stylist gives the whole tip to that stylist', async () => {
    const before = await tips()
    const sale = await visitSale(false)
    await paidCash(sale, 5)
    const after = await tips()
    expect([after.ana - before.ana, after.bea - before.bea]).toEqual([5, 0])
  })

  test('the salon sets its own percentages — at checkout (before the tip) and afterwards; the report follows; 100% is required; only people of this salon; reset goes back to the default', async () => {
    const sale = await visitSale()
    const url = `/api/chair-checkout/sales/${sale}/tip-split`
    // Set before any tip is taken (at checkout).
    const set = await as('owner', url, 'PUT', { shares: [{ key: `u:${ana}`, percent: 50 }, { key: `u:${bea}`, percent: 50 }] })
    expect(set.status).toBe(200)
    expect(set.body.manual).toBe(true)
    const before = await tips()
    await paidCash(sale, 10)
    let after = await tips()
    expect([after.ana - before.ana, after.bea - before.bea]).toEqual([5, 5])
    // Edited afterwards: the tip already taken is re-credited.
    expect((await as('owner', url, 'PUT', { shares: [{ key: `u:${ana}`, percent: 20 }, { key: `u:${bea}`, percent: 80 }] })).status).toBe(200)
    after = await tips()
    expect([after.ana - before.ana, after.bea - before.bea]).toEqual([2, 8])
    // Refused: not 100%, an unknown person, nobody.
    const short = await as('owner', url, 'PUT', { shares: [{ key: `u:${ana}`, percent: 20 }, { key: `u:${bea}`, percent: 70 }] })
    expect([short.status, short.body.code]).toEqual([400, 'BAD_SPLIT'])
    expect(short.body.fields?.shares ?? short.body.error).toContain('90%')
    const stranger = await as('owner', url, 'PUT', { shares: [{ key: 'u:nobody-here', percent: 100 }] })
    expect([stranger.status, stranger.body.code]).toEqual([400, 'UNKNOWN_PERSON'])
    expect((await as('owner', url, 'PUT', { shares: [] })).status).toBe(400)
    expect((await tips()).bea - before.bea).toBe(8)            // refused changes changed nothing
    // Reset: back to service value.
    const reset = await as('owner', url, 'PUT', { reset: true })
    expect([reset.status, reset.body.manual]).toEqual([200, false])
    after = await tips()
    expect([after.ana - before.ana, after.bea - before.bea]).toEqual([7.5, 2.5])
  })

  test('who may see and change a split is decided by the server: invoice rights to read, payment rights to change; the sale of another salon is not found', async () => {
    const sale = await visitSale()
    const url = `/api/chair-checkout/sales/${sale}/tip-split`
    expect((await as('bartender', url)).status).toBe(403)
    expect((await as('bartender', url, 'PUT', { reset: true })).status).toBe(403)
    expect((await as('manager', url)).status).toBe(200)
    expect((await as('owner', '/api/chair-checkout/sales/not-a-sale/tip-split')).status).toBe(404)
    expect((await as('owner', '/api/chair-checkout/sales/not-a-sale/tip-split', 'PUT', { reset: true })).status).toBe(404)
  })

  test('a tip given back comes off each person\'s tips by the same shares — the app\'s refund and a refund made in Stripe\'s own dashboard', async () => {
    process.env.FACTORY_SYNC_KEY = process.env.FACTORY_SYNC_KEY || 'factory-key'
    const before = await tips()
    // App refund: $160 sale on the reader, $12 tip → Ana 9, Bea 3.
    const a = await visitSale()
    const startA = await as('owner', '/api/chair-checkout/charges', 'POST', { invoiceId: a, readerId, tipCents: 1200 })
    expect(startA.status).toBe(201)
    expect((await as('owner', `/api/chair-checkout/charges/${startA.body.charge.id}/simulate`, 'POST', { outcome: 'approve' })).body.charge.status).toBe('succeeded')
    let now = await tips()
    expect([now.ana - before.ana, now.bea - before.bea]).toEqual([9, 3])
    const pay = (await paymentsOf(a)).find((p: any) => Number(p.amount) > 0)
    const full = await as('owner', `/api/chair-checkout/payments/${pay.id}/refund`, 'POST', { reason: 'unhappy' })
    expect([full.status, full.body.tipRefundedCents]).toEqual([200, 1200])
    now = await tips()
    expect([now.ana - before.ana, now.bea - before.bea]).toEqual([0, 0])
    // Dashboard refund of the whole charge, with the salon's own 50/50 on the sale.
    const b = await visitSale()
    await as('owner', `/api/chair-checkout/sales/${b}/tip-split`, 'PUT', { shares: [{ key: `u:${ana}`, percent: 50 }, { key: `u:${bea}`, percent: 50 }] })
    const startB = await as('owner', '/api/chair-checkout/charges', 'POST', { invoiceId: b, readerId, tipCents: 1000 })
    await as('owner', `/api/chair-checkout/charges/${startB.body.charge.id}/simulate`, 'POST', { outcome: 'approve' })
    now = await tips()
    expect([now.ana - before.ana, now.bea - before.bea]).toEqual([5, 5])
    const ref = (await paymentsOf(b)).find((p: any) => Number(p.amount) > 0).reference
    k.stripe.dashboardRefund(ref, 17000)
    const ev = await t.call('/api/stripe/factory-event', {
      method: 'POST', headers: { 'X-Factory-Key': process.env.FACTORY_SYNC_KEY! },
      json: { event: { type: 'charge.refunded', account: 'acct_biz', data: { object: { id: `ch_${ref}`, payment_intent: ref, amount: 17000, amount_refunded: 17000, refunded: true, metadata: {} } } } },
    })
    expect(ev.status).toBe(200)
    now = await tips()
    expect([now.ana - before.ana, now.bea - before.bea]).toEqual([0, 0])
  })
  test('a card refunded through the shared Online Payments refund also takes the tip back — a full one, not a part one — off each stylist by their shares', async () => {
    const before = await tips()
    const sale = await visitSale()
    const start = await as('owner', '/api/chair-checkout/charges', 'POST', { invoiceId: sale, readerId, tipCents: 1600 })
    await as('owner', `/api/chair-checkout/charges/${start.body.charge.id}/simulate`, 'POST', { outcome: 'approve' })
    let now = await tips()
    expect([now.ana - before.ana, now.bea - before.bea]).toEqual([12, 4])
    const pay = (await paymentsOf(sale)).find((p: any) => Number(p.amount) > 0)
    // Part of the sale: the tip stays.
    const part = await as('owner', '/api/stripe/refund', 'POST', { paymentId: pay.id, amount: 30 })
    expect(part.status).toBe(200)
    expect(Number(k.stripe.posts('/v1/refunds').pop()!.params.get('amount'))).toBe(3000)
    now = await tips()
    expect([now.ana - before.ana, now.bea - before.bea]).toEqual([12, 4])
    // The rest of the sale: the tip goes with it, in the same Stripe refund.
    const rest = await as('owner', '/api/stripe/refund', 'POST', { paymentId: pay.id, amount: 130 })
    expect(rest.status).toBeLessThan(300)
    expect(Number(k.stripe.posts('/v1/refunds').pop()!.params.get('amount'))).toBe(13000 + 1600)
    now = await tips()
    expect([now.ana - before.ana, now.bea - before.bea]).toEqual([0, 0])
  })
})
