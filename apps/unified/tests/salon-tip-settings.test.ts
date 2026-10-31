// Tip settings and late tips (salon parity row 11; Fresha, Stripe): the owner's tip percentages (up to three) used at the desk and on the
// reader's own screen; percentage tips worked on the services of a sale (Stripe's tip-eligible amount — retail left out); a receipt emailed when a
// sale is paid, with a link to add a tip afterwards, paid on the SALON'S OWN Stripe and credited to the stylists by the sale's tip shares.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootFood } from './foodKit.ts'
import { eligibleCents, parseTipSettings, readTipSettings, suggestTips } from '../server/crm/salon/tipSettings.ts'
import { invoiceIdFromTipToken, lateTipToken } from '../server/crm/salon/lateTip.ts'

describe('tip settings arithmetic', () => {
  test('one to three whole percents, no repeats; defaults 15/18/20; sorted', () => {
    expect(readTipSettings(undefined)).toEqual({ presets: [15, 18, 20], lateTipLink: true, sendReceipts: true })
    expect((parseTipSettings({ presets: [25, 10, 15] }) as any).values.presets).toEqual([10, 15, 25])
    for (const bad of [[], [10, 15, 20, 25], [10, 10], [0], [101], [12.5], ['x']]) expect('fields' in parseTipSettings({ presets: bad })).toBe(true)
    expect('fields' in parseTipSettings({ presets: [10], lateTipLink: 'yes' })).toBe(true)
  })
  test('the eligible amount leaves retail and gift cards out, in proportion to what is charged', () => {
    const lines = [{ type: 'service', total: '100.00' }, { type: 'retail', total: '40.00' }]
    expect(eligibleCents(lines, 14000)).toBe(10000)
    expect(eligibleCents(lines, 7000)).toBe(5000)
    expect(eligibleCents([{ type: 'retail', total: '10' }], 1000)).toBe(0)
    expect(eligibleCents([{ type: 'gift_card', total: '50' }, { type: null, total: '50' }], 10000)).toBe(5000)
    expect(eligibleCents([], 1234)).toBe(1234)
    expect(suggestTips([10, 15, 25], 10000)).toEqual([{ percent: 10, cents: 1000 }, { percent: 15, cents: 1500 }, { percent: 25, cents: 2500 }])
  })
  test('a tip link is the sale and a signature: a changed or made-up one is refused', () => {
    const t = lateTipToken('abcdefghij1234')
    expect(invoiceIdFromTipToken(t)).toBe('abcdefghij1234')
    expect(invoiceIdFromTipToken(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBeNull()
    expect(invoiceIdFromTipToken('abcdefghij1234.' + 'A'.repeat(24))).toBeNull()
    expect(invoiceIdFromTipToken('')).toBeNull()
  })
})

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'chair_checkout', 'salon_reports', 'online_payments']

describe('salon: tip settings, tip-eligible amount, receipt and late tip', () => {
  let k: Awaited<ReturnType<typeof bootFood>>
  let t: any, S: any, co = '', ana = '', bea = '', cut = '', colour = '', readerId = ''
  let ip = 0, hour = 7
  const sent: Array<{ to: string; name: string; data: any }> = []
  const receipts = () => sent.filter((m) => m.name === 'saleReceipt')
  /** The receipt goes out after the payment's answer (it does not hold the desk up): wait for it, or — to prove none comes — give it time. */
  const waitFor = async (n: number) => { for (let i = 0; i < 100 && receipts().length < n; i++) await Bun.sleep(20) }
  const quiet = () => Bun.sleep(250)
  const as = async (who: 'owner' | 'manager' | 'bartender', path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${k.tokens[who]}`, 'x-forwarded-for': `10.7.0.${++ip}`, host: 'bar.test' } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const pub = async (path: string, method = 'GET', form?: Record<string, string>) => {
    const r = await t.call(path, { method, headers: { 'x-forwarded-for': `10.6.0.${++ip}`, host: 'bar.test', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(form ? { body: new URLSearchParams(form).toString() } : {}), redirect: 'manual' })
    return { status: r.status, text: await r.text(), location: r.headers.get('location') }
  }
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const day = addDays(today(), -3)
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  /** A completed visit: Ana's $120 colour and Bea's $40 cut. `email` null → a client with no email address. */
  async function visitSale(email: string | null = 'auto') {
    const client = await ins(S.contact, { companyId: co, name: `Client ${ip}`, email: email === 'auto' ? `c${ip}-${hour}@example.com` : email, type: 'client' })
    hour += 1
    const slot = hour - 8
    const made = await as('owner', '/api/appointments', 'POST', { contactId: client.id, startTime: wall(addDays(day, -Math.floor(slot / 12)), `${String(8 + (slot % 12)).padStart(2, '0')}:00`), serviceId: cut, stylistId: ana })
    expect(made.status).toBe(201)
    await ins(S.appointmentItem, { companyId: co, appointmentId: made.body.id, position: 0, serviceId: colour, stylistId: ana, startOffsetMin: 0, durationMin: 60, price: '120.00' })
    await ins(S.appointmentItem, { companyId: co, appointmentId: made.body.id, position: 1, serviceId: cut, stylistId: bea, startOffsetMin: 60, durationMin: 30, price: '40.00' })
    expect((await as('owner', `/api/appointments/${made.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(S.invoice).where(eq(S.invoice.appointmentId, made.body.id))
    return inv.id as string
  }
  const invoiceOf = async (id: string) => (await t.db.select().from(S.invoice).where(eq(S.invoice.id, id)))[0]
  const paymentsOf = async (id: string) => (await t.db.select().from(S.payment).where(eq(S.payment.invoiceId, id))) as any[]
  const cashPay = async (sale: string) => {
    const inv = await invoiceOf(sale)
    const r = await as('owner', `/api/invoices/${sale}/payments`, 'POST', { amount: Number(inv.total), method: 'cash' })
    expect(r.status).toBeLessThan(300)
  }
  const tips = async () => {
    const r = (await as('owner', '/api/salon-reports/tips')).body
    const of = (id: string) => (r.stylists as any[]).find((x) => x.id === id)?.tips ?? 0
    return { ana: of(ana), bea: of(bea) }
  }
  const lastPost = (path: string | RegExp) => k.stripe.calls.filter((c) => c.method === 'POST' && (typeof path === 'string' ? c.path === path : path.test(c.path))).pop()!
  const percentagesOf = (call: { params: URLSearchParams }) => [...call.params].filter(([key]) => key.startsWith('tipping[usd][percentages]')).map(([, v]) => Number(v))

  beforeAll(async () => {
    k = await bootFood({ vertical: 'salon', features: FEATURES, sharedStripe: true })
    t = k.t; S = k.S; co = k.companyId
    await t.db.update(S.company).set({ timezone: TZ }).where(eq(S.company.id, co))
    const mk = async (email: string, first: string) => (await ins(S.user, { email, passwordHash: await Bun.password.hash('Pass-1-word', 'bcrypt'), firstName: first, lastName: 'Stylist', role: 'field', companyId: co })).id
    ana = await mk('ana@test.example', 'Ana'); bea = await mk('bea@test.example', 'Bea')
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 100 })).body.id
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 120 })).body.id
    const real = t.services.email.send.bind(t.services.email)
    ;(t.services.email as any).send = async (to: string, name: string, data: any) => { sent.push({ to, name, data }); return real(to, name, data) }
  }, 120_000)
  afterAll(() => k.restore())

  test('the owner sets up to three percentages; the desk reads them; only someone who configures the salon can change them; bad ones are refused with the reason', async () => {
    expect((await as('owner', '/api/chair-checkout/tip-settings')).body).toMatchObject({ presets: [15, 18, 20], lateTipLink: true, sendReceipts: true })
    expect((await as('manager', '/api/chair-checkout/tip-settings', 'PUT', { presets: [10] })).status).toBe(403)
    expect((await as('bartender', '/api/chair-checkout/tip-settings')).status).toBe(403)
    for (const bad of [[], [10, 15, 20, 25], [10, 10], [0], [150]]) {
      const r = await as('owner', '/api/chair-checkout/tip-settings', 'PUT', { presets: bad })
      expect([r.status, r.body.code]).toEqual([400, 'BAD_TIPS'])
      expect(typeof r.body.fields?.presets).toBe('string')
    }
    const ok = await as('owner', '/api/chair-checkout/tip-settings', 'PUT', { presets: [25, 10, 15] })
    expect([ok.status, ok.body.presets]).toEqual([200, [10, 15, 25]])
    expect((await as('manager', '/api/chair-checkout/tip-settings')).body.presets).toEqual([10, 15, 25])
  })

  test('a reader paired after that has the owner\'s percentages on its own screen; changing them again replaces the screen on the existing location, on the salon\'s account', async () => {
    const paired = await as('owner', '/api/chair-checkout/readers', 'POST', { code: 'simulated-wpe', label: 'Front desk' })
    expect(paired.status).toBe(201)
    readerId = paired.body.reader.id
    expect(percentagesOf(lastPost('/v1/terminal/configurations'))).toEqual([10, 15, 25])
    const made = k.stripe.posts('/v1/terminal/configurations').length
    const changed = await as('owner', '/api/chair-checkout/tip-settings', 'PUT', { presets: [12, 20] })
    expect([changed.status, changed.body.readers]).toEqual([200, { updated: 1, failed: [] }])
    expect(k.stripe.posts('/v1/terminal/configurations').length).toBe(made + 1)
    expect(percentagesOf(lastPost('/v1/terminal/configurations'))).toEqual([12, 20])
    const loc = lastPost(/^\/v1\/terminal\/locations\/[^/]+$/)
    expect(loc.params.get('configuration_overrides')).toMatch(/^tmc_/)
    expect(lastPost('/v1/terminal/configurations').account).toBe('acct_biz')
    expect(loc.account).toBe('acct_biz')
  })

  test('percentage tips are worked on the services: retail on the sale is left out — at the desk and on the reader\'s own screen (Stripe tip-eligible amount)', async () => {
    const sale = await visitSale()
    const inv = await invoiceOf(sale)
    // A $40 product on the sale: services $160 + retail $40.
    await ins(S.invoiceLineItem, { invoiceId: sale, description: 'Shampoo', type: 'retail', quantity: '1', unitPrice: '40', total: '40', sortOrder: 9 })
    await t.db.update(S.invoice).set({ total: String(Number(inv.total) + 40) }).where(eq(S.invoice.id, sale))
    const total = Math.round((Number(inv.total) + 40) * 100)
    const info = (await as('owner', `/api/chair-checkout/sales/${sale}/tip-info`)).body
    expect(info).toMatchObject({ amountCents: total, retailLeftOut: true })
    const servicesCents = info.eligibleCents
    expect(servicesCents).toBeLessThan(total)
    expect(info.suggestions).toEqual([{ percent: 12, cents: Math.round(servicesCents * 0.12) }, { percent: 20, cents: Math.round(servicesCents * 0.2) }])
    // Part of the bill on the reader: the same share.
    const half = (await as('owner', `/api/chair-checkout/sales/${sale}/tip-info?amountCents=${Math.floor(total / 2)}`)).body
    expect(Math.abs(half.eligibleCents - Math.round(servicesCents / 2))).toBeLessThanOrEqual(1)
    expect((await as('owner', `/api/chair-checkout/sales/${sale}/tip-info?amountCents=abc`)).status).toBe(400)
    expect((await as('owner', '/api/chair-checkout/sales/nope/tip-info')).status).toBe(404)
    // The reader is told the eligible amount when the client chooses the tip on its screen.
    const started = await as('owner', '/api/chair-checkout/charges', 'POST', { invoiceId: sale, readerId, tipOnReader: true })
    expect(started.status).toBe(201)
    const sentToReader = lastPost(/process_payment_intent$/)
    expect(Number(sentToReader.params.get('process_config[tipping][amount_eligible]'))).toBe(servicesCents)
    expect(sentToReader.params.get('process_config[skip_tipping]')).toBeNull()
    await as('owner', `/api/chair-checkout/charges/${started.body.charge.id}/cancel`, 'POST', {})
    // A sale of services only: nothing to subtract, so Stripe is not told (its default is the whole amount).
    const plain = await visitSale()
    const s2 = await as('owner', '/api/chair-checkout/charges', 'POST', { invoiceId: plain, readerId, tipOnReader: true })
    expect(s2.status).toBe(201)
    expect(lastPost(/process_payment_intent$/).params.get('process_config[tipping][amount_eligible]')).toBeNull()
    await as('owner', `/api/chair-checkout/charges/${s2.body.charge.id}/cancel`, 'POST', {})
    // A sale that is all retail has nothing to tip on: the tip screen is skipped.
    const shelf = await visitSale()
    await t.db.update(S.invoiceLineItem).set({ type: 'retail' }).where(eq(S.invoiceLineItem.invoiceId, shelf))
    const s3 = await as('owner', '/api/chair-checkout/charges', 'POST', { invoiceId: shelf, readerId, tipOnReader: true })
    expect(s3.status).toBe(201)
    expect(lastPost(/process_payment_intent$/).params.get('process_config[skip_tipping]')).toBe('true')
    await as('owner', `/api/chair-checkout/charges/${s3.body.charge.id}/cancel`, 'POST', {})
  })

  test('a paid sale is emailed its receipt once, however it was paid; no email address, or receipts off, sends none; a person can send it again', async () => {
    sent.length = 0
    const sale = await visitSale()
    await cashPay(sale)
    await waitFor(1)
    expect(receipts()).toHaveLength(1)
    expect(receipts()[0].to).toMatch(/@example\.com$/)
    expect(receipts()[0].data).toMatchObject({ invoiceNumber: (await invoiceOf(sale)).number, tip: 0 })
    expect(receipts()[0].data.lines.length).toBeGreaterThan(0)
    expect(receipts()[0].data.tipPath).toMatch(/^\/api\/late-tip\//)
    // A second event on the same paid sale sends nothing more.
    await as('owner', `/api/invoices/${sale}`, 'PUT', { notes: 'edited' })
    await quiet()
    expect(receipts()).toHaveLength(1)
    // Part paid: no receipt yet.
    const part = await visitSale()
    expect((await as('owner', `/api/invoices/${part}/payments`, 'POST', { amount: 20, method: 'cash' })).status).toBeLessThan(300)
    await quiet()
    expect(receipts()).toHaveLength(1)
    // A client with no email: none, and the desk is told when it tries by hand.
    const noMail = await visitSale(null)
    await cashPay(noMail)
    await quiet()
    expect(receipts()).toHaveLength(1)
    const tryNoMail = await as('owner', `/api/chair-checkout/sales/${noMail}/receipt`, 'POST', {})
    expect([tryNoMail.status, tryNoMail.body.code]).toEqual([409, 'NO_EMAIL'])
    // By hand: sent again.
    const again = await as('owner', `/api/chair-checkout/sales/${sale}/receipt`, 'POST', {})
    expect([again.status, again.body.sent]).toEqual([200, true])
    expect(receipts()).toHaveLength(2)
    expect((await as('bartender', `/api/chair-checkout/sales/${sale}/receipt`, 'POST', {})).status).toBe(403)
    expect((await as('owner', `/api/chair-checkout/sales/${part}/receipt`, 'POST', {})).status).toBe(409)
    // Receipts off: the app sends none by itself; the tip link can be left out of them.
    await as('owner', '/api/chair-checkout/tip-settings', 'PUT', { presets: [12, 20], sendReceipts: false })
    const off = await visitSale()
    await cashPay(off)
    await quiet()
    expect(receipts()).toHaveLength(2)
    await as('owner', '/api/chair-checkout/tip-settings', 'PUT', { presets: [12, 20], sendReceipts: true, lateTipLink: false })
    const noLink = await visitSale()
    await cashPay(noLink)
    await waitFor(3)
    expect(receipts()).toHaveLength(3)
    expect(receipts()[2].data.tipPath).toBeNull()
    await as('owner', '/api/chair-checkout/tip-settings', 'PUT', { presets: [12, 20], sendReceipts: true, lateTipLink: true })
  })

  test('the client adds a tip from the receipt\'s link: Stripe\'s own page on the salon\'s account, recorded once, shared between the stylists by the sale\'s shares', async () => {
    sent.length = 0
    const sale = await visitSale()
    await cashPay(sale)
    await waitFor(1)
    const link = receipts()[0].data.tipPath as string
    const before = await tips()
    // The private page offers the owner's percentages, worked on the services.
    const pageGet = await pub(link)
    expect(pageGet.status).toBe(200)
    expect(pageGet.text).toContain('12%')
    expect(pageGet.text).toContain('20%')
    expect(pageGet.text).toContain('Ana Stylist')
    // Tampered or made-up links: nothing.
    expect((await pub(link.slice(0, -1) + (link.endsWith('A') ? 'B' : 'A'))).status).toBe(404)
    expect((await pub('/api/late-tip/not-a-token')).status).toBe(404)
    // Too small / too large are refused before Stripe is asked.
    const stripeCalls = k.stripe.posts('/v1/checkout/sessions').length
    expect((await pub(link, 'POST', { tipCents: '50' })).status).toBe(400)
    expect((await pub(link, 'POST', { custom: '5000' })).status).toBe(400)
    expect((await pub(link, 'POST', { custom: 'abc' })).status).toBe(400)
    expect(k.stripe.posts('/v1/checkout/sessions').length).toBe(stripeCalls)
    // $10 chosen: Stripe's page on the salon's account, tagged with the sale.
    const go = await pub(link, 'POST', { custom: '10' })
    expect(go.status).toBe(303)
    expect(go.location).toContain('checkout.stripe.com')
    const made = lastPost('/v1/checkout/sessions')
    expect(made.account).toBe('acct_biz')
    expect(made.params.get('line_items[0][price_data][unit_amount]')).toBe('1000')
    expect(made.params.get('metadata[twomiah_late_tip]')).toBe(sale)
    expect(await paymentsOf(sale).then((p) => p.filter((x) => Number(x.tipAmount) > 0))).toHaveLength(0)    // nothing is recorded until Stripe says so
    const id = [...k.stripe.sessions.keys()].pop()!
    // Not paid yet: coming back records nothing.
    expect((await pub(`${link}?done=${id}`)).text).toContain('could not confirm')
    expect(await paymentsOf(sale).then((p) => p.filter((x) => Number(x.tipAmount) > 0))).toHaveLength(0)
    // Paid on Stripe's page; the client returns.
    k.stripe.paySession(id)
    const back = await pub(`${link}?done=${id}`)
    expect(back.text).toContain('Thank you')
    const tipRows = (await paymentsOf(sale)).filter((x) => Number(x.tipAmount) > 0)
    expect(tipRows).toHaveLength(1)
    expect([Number(tipRows[0].amount), Number(tipRows[0].tipAmount), tipRows[0].reference]).toEqual([0, 10, `pi_for_${id}`])
    expect((await invoiceOf(sale)).status).toBe('paid')
    const after = await tips()
    expect([after.ana - before.ana, after.bea - before.bea]).toEqual([7.5, 2.5])          // by service value: $120 / $40
    // The page again, and Stripe's event for the same page: still one tip.
    await pub(`${link}?done=${id}`)
    process.env.FACTORY_SYNC_KEY = process.env.FACTORY_SYNC_KEY || 'factory-key'
    const event = (account: string, sid: string) => t.call('/api/stripe/factory-event', {
      method: 'POST', headers: { 'X-Factory-Key': process.env.FACTORY_SYNC_KEY! },
      json: { event: { type: 'checkout.session.completed', account, data: { object: k.stripe.sessions.get(sid) } } },
    })
    expect((await event('acct_biz', id)).status).toBe(200)
    expect((await paymentsOf(sale)).filter((x) => Number(x.tipAmount) > 0)).toHaveLength(1)
    // The event alone (the client never came back) records it too — and an event from another account does not.
    const second = await pub(link, 'POST', { tipCents: '300' })
    expect(second.status).toBe(303)
    const id2 = [...k.stripe.sessions.keys()].pop()!
    k.stripe.paySession(id2)
    expect((await event('acct_other', id2)).status).toBeLessThan(500)
    expect((await paymentsOf(sale)).filter((x) => Number(x.tipAmount) > 0)).toHaveLength(1)
    expect((await event('acct_biz', id2)).status).toBe(200)
    expect((await paymentsOf(sale)).filter((x) => Number(x.tipAmount) > 0)).toHaveLength(2)
    const final = await tips()
    expect([final.ana - before.ana, final.bea - before.bea]).toEqual([9.75, 3.25])
    // A tip refunded in Stripe's own dashboard comes off the stylists' tips again.
    const pi = `pi_for_${id}`
    k.stripe.dashboardRefund(pi, 1000)
    const refunded = await t.call('/api/stripe/factory-event', {
      method: 'POST', headers: { 'X-Factory-Key': process.env.FACTORY_SYNC_KEY! },
      json: { event: { type: 'charge.refunded', account: 'acct_biz', data: { object: { id: `ch_${pi}`, payment_intent: pi, amount: 1000, amount_refunded: 1000, refunded: true, metadata: {} } } } },
    })
    expect(refunded.status).toBe(200)
    const gone = await tips()
    expect([gone.ana - before.ana, gone.bea - before.bea]).toEqual([2.25, 0.75])
    expect(Number((await invoiceOf(sale)).amountRefunded)).toBe(0)          // a tip given back is not money off the sale
    expect((await invoiceOf(sale)).status).toBe('paid')
  })

  test('the link works only for a paid sale of a salon that has it on: an unpaid, refunded or switched-off one says so and starts no payment', async () => {
    const open = await visitSale()                               // raised, not paid
    const link = lateTipToken(open)
    const noPay = await pub(`/api/late-tip/${link}`)
    expect(noPay.status).toBe(409)
    const calls = k.stripe.posts('/v1/checkout/sessions').length
    expect((await pub(`/api/late-tip/${link}`, 'POST', { tipCents: '500' })).status).toBe(409)
    // Switched off by the owner: the receipt carries no link, and a link already sent stops working.
    const paid = await visitSale()
    await cashPay(paid)
    await as('owner', '/api/chair-checkout/tip-settings', 'PUT', { presets: [12, 20], lateTipLink: false })
    expect((await pub(`/api/late-tip/${lateTipToken(paid)}`)).status).toBe(409)
    expect((await pub(`/api/late-tip/${lateTipToken(paid)}`, 'POST', { tipCents: '500' })).status).toBe(409)
    await as('owner', '/api/chair-checkout/tip-settings', 'PUT', { presets: [12, 20], lateTipLink: true })
    expect((await pub(`/api/late-tip/${lateTipToken(paid)}`)).status).toBe(200)
    // The feature off: the page is gone.
    await k.features(FEATURES.filter((f) => f !== 'chair_checkout'))
    expect((await pub(`/api/late-tip/${lateTipToken(paid)}`)).status).toBe(404)
    await k.features(FEATURES)
    expect(k.stripe.posts('/v1/checkout/sessions').length).toBe(calls)
  })
})
