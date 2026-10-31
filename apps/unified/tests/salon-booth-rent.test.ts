// Booth rent (salon row 24; server/crm/salon/boothRent.ts, boothRentRoutes.ts; hidden feature `booth_rent`), through the real server and the real
// logins against a fake Stripe. The money rules: rent is invoiced once per renter per due day however many runs there are; a rent change applies
// to periods not yet invoiced; a renter is charged by card only with their agreement and a card on the SALON'S Stripe account, once per invoice
// per try; a decline is chased with the salon's own tries and waits, and after the last the renter is paused (still invoiced) and sent a link; a
// waived period leaves no invoice owed; the ledger and the statement add up to what the invoices and payments say.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PASSWORD = 'Booth-rent-1031'
const calls: Array<{ args: any; opts: any }> = []
let intents = 0
const byKey = new Map<string, any>()
const declining = new Set<string>()
let sessions = 0
const sessionMeta: Record<string, Record<string, string>> = {}
const sessionCalls: Array<{ args: any; opts: any }> = []
const fakeStripe = {
  customers: { retrieve: async (id: string) => ({ id, deleted: false }), create: async () => ({ id: 'cus_1' }) },
  checkout: {
    sessions: {
      create: async (args: any, opts: any) => { sessionCalls.push({ args, opts }); sessions++; const id = 'cs_' + sessions; sessionMeta[id] = args.metadata; return { id, url: 'https://checkout.stripe.com/c/setup/' + id } },
      retrieve: async (id: string) => ({ id, mode: 'setup', customer: 'cus_new', metadata: sessionMeta[id], setup_intent: { payment_method: { id: 'pm_' + id, type: 'card', card: { brand: 'visa', last4: '1111', exp_month: 11, exp_year: 2032 } } } }),
    },
  },
  paymentIntents: {
    create: async (args: any, opts: any) => {
      calls.push({ args, opts })
      if (byKey.has(opts.idempotencyKey)) return byKey.get(opts.idempotencyKey)
      intents++
      if (declining.has(args.metadata.contact_id)) throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined', payment_intent: { id: 'pi_declined_' + intents } })
      const intent = { id: 'pi_' + intents, status: 'succeeded' }
      byKey.set(opts.idempotencyKey, intent)
      return intent
    },
  },
}

const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)
const weekday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay()
const FEATURES = ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'card_on_file', 'chair_checkout', 'booth_rent', 'team', 'dashboard']

describe('salon: booth rent', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tokens: Record<string, string> = {}
  const sent: Array<{ to: string; name: string; data: any }> = []
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const settle = () => as('owner', '/api/booth-rent/run', 'POST')
  const renterRow = async (id: string) => (await t.db.select().from(t.schema.boothRenter).where(eq(t.schema.boothRenter.id, id)))[0]
  const periods = async (id: string) => (await t.db.select().from(t.schema.boothRentPeriod).where(eq(t.schema.boothRentPeriod.renterId, id))).sort((a: any, b: any) => a.period.localeCompare(b.period))
  const invoiceOf = async (id: string | null) => (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, id as string)))[0]
  const paymentsOf = async (invoiceId: string | null) => t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, invoiceId as string))
  const tries = async (id: string) => (await t.db.select().from(t.schema.boothRentCharge).where(eq(t.schema.boothRentCharge.renterId, id))).sort((a: any, b: any) => a.createdAt - b.createdAt || a.attempt - b.attempt)
  const charges = () => calls.filter((c) => c.args.metadata.kind === 'booth_rent')
  const backdateTries = (renterId: string, days: number) => t.db.update(t.schema.boothRentCharge).set({ updatedAt: new Date(Date.now() - days * 86400000) } as any).where(eq(t.schema.boothRentCharge.renterId, renterId))
  const addCard = async (contactId: string) => ins(t.schema.clientCard, { companyId: co, contactId, stripeAccount: 'acct_salon', stripeCustomerId: 'cus_' + contactId, paymentMethodId: 'pm_' + contactId, brand: 'visa', last4: '4242', expMonth: 12, expYear: 2031, consentAt: new Date(), consentText: 'policy', consentVia: 'staff_at_desk' })
  /** A weekly renter whose rent has been due for `weeks` weeks (so `weeks + 1` invoices once billed), on the weekday of the start. */
  const weekly = async (name: string, weeks: number, extra: Record<string, unknown> = {}) => {
    const start = ymd(weeks * 7)
    const r = await as('manager', '/api/booth-rent/renters', 'POST', { name, email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`, rent: 250, frequency: 'weekly', dueWeekday: weekday(start), startDate: start, ...extra })
    return r
  }
  const agree = (id: string) => as('manager', `/api/booth-rent/renters/${id}/auto-pay`, 'PUT', { on: true, renterAgreed: true })

  beforeAll(async () => {
    process.env.FACTORY_SYNC_KEY = 'factory-key'
    t = await bootTenant({ vertical: 'salon', stripe: fakeStripe })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: 'UTC', email: 'salon@example.com', integrations: { stripeAccountId: 'acct_salon' } } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES.filter((f) => f !== 'booth_rent'))
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of Object.entries({ ana: 'field', manager: 'manager' })) {
      const email = `${key}@test.example`
      await ins(t.schema.user, { email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
    }
    const real = t.services.email.send.bind(t.services.email)
    ;(t.services.email as any).send = async (to: string, name: string, data: any) => { sent.push({ to, name, data }); return real(to, name, data) }
  }, 120_000)

  test('off by default; on, only a money seat may use it', async () => {
    const off = await as('owner', '/api/booth-rent/renters')
    expect([off.status, off.body.code]).toEqual([403, 'FEATURE_NOT_ENABLED'])
    expect((await t.call('/api/renter-card/not-a-real-token-at-all-1234')).status).toBe(404)
    await features(FEATURES)
    expect((await as('owner', '/api/booth-rent/renters')).status).toBe(200)
    expect((await as('manager', '/api/booth-rent/renters')).status).toBe(200)
    expect((await as('ana', '/api/booth-rent/renters')).status).toBe(403)
    expect((await as('ana', '/api/booth-rent/renters', 'POST', { name: 'X', rent: 100, frequency: 'weekly', dueWeekday: 1 })).status).toBe(403)
  })

  test('a renter is a Team member with a rent and a schedule; each wrong box is named; the same person cannot rent twice', async () => {
    const bad = await as('manager', '/api/booth-rent/renters', 'POST', { name: '', rent: 'lots', frequency: 'daily' })
    expect([bad.status, bad.body.code]).toEqual([400, 'VALIDATION'])
    expect(Object.keys(bad.body.fields).sort()).toEqual(['frequency', 'name', 'rent'])
    const made = await as('manager', '/api/booth-rent/renters', 'POST', { name: 'Rae Renter', email: 'rae@example.com', phone: '608-555-0100', rent: 250, frequency: 'weekly', dueWeekday: 5, startDate: ymd(-30) })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ name: 'Rae Renter', status: 'active', rentCents: 25000, rentWords: '$250 a week, due Fridays', owedCents: 0, autoCharge: false, card: null })
    const [member] = await t.db.select().from(t.schema.teamMember).where(eq(t.schema.teamMember.id, made.body.teamMemberId))
    expect(member).toMatchObject({ name: 'Rae Renter', role: 'Chair renter' })
    // billed through a contact that is not a client
    const [ct] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, made.body.contactId))
    expect(ct.type).toBe('other')
    const clients = await as('owner', '/api/contacts?type=client')
    expect(JSON.stringify(clients.body)).not.toContain('Rae Renter')
    // an existing Team member can rent too — but only once
    const m2 = await ins(t.schema.teamMember, { companyId: co, name: 'Team Tess', email: 'tess@example.com', active: true })
    const r2 = await as('manager', '/api/booth-rent/renters', 'POST', { teamMemberId: m2.id, rent: 900, frequency: 'monthly', dueDay: 1, startDate: ymd(-30) })
    expect(r2.status).toBe(201)
    const again = await as('manager', '/api/booth-rent/renters', 'POST', { teamMemberId: m2.id, rent: 900, frequency: 'monthly', dueDay: 1 })
    expect([again.status, again.body.code]).toEqual([409, 'ALREADY_RENTER'])
    expect((await as('manager', '/api/booth-rent/renters', 'POST', { teamMemberId: 'nope', rent: 900, frequency: 'monthly', dueDay: 1 })).status).toBe(404)
    // nothing is due yet, so nothing is invoiced
    expect(await periods(made.body.id)).toHaveLength(0)
  })

  test('rent is invoiced on each due day, once however many runs there are, with the rent as a line the salon can read', async () => {
    const r = await weekly('Wendy Weekly', 3)
    expect(r.status).toBe(201)
    await Promise.all([settle(), settle(), settle()])
    await settle()
    const p = await periods(r.body.id)
    expect(p.map((x: any) => x.period)).toEqual([ymd(21), ymd(14), ymd(7), ymd(0)])
    expect(p.every((x: any) => x.status === 'invoiced' && x.amountCents === 25000)).toBe(true)
    const invs = await Promise.all(p.map((x: any) => invoiceOf(x.invoiceId)))
    expect(new Set(invs.map((i: any) => i.number)).size).toBe(4)
    expect(invs.every((i: any) => i.contactId === r.body.contactId && i.status === 'open' && Number(i.total) === 250 && Number(i.taxAmount) === 0)).toBe(true)
    const lines = await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, invs[0].id))
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('booth_rent')
    const row = await renterRow(r.body.id)
    expect(row.nextDue).toBe(ymd(-7))
    // a renter who pays by hand is told each rent is due
    expect(sent.filter((m) => m.name === 'boothRentInvoice' && m.to === 'wendyweekly@example.com')).toHaveLength(4)
    expect(charges()).toEqual([])
    const view = (await as('manager', `/api/booth-rent/renters/${r.body.id}`)).body
    expect(view.owedCents).toBe(100000)
    expect(view.overdueCents).toBe(75000)
    // paying one by hand brings the owing down
    const pay = await as('manager', `/api/invoices/${invs[0].id}/payments`, 'POST', { amount: 250, method: 'cash' })
    expect(pay.status).toBeLessThan(300)
    expect((await as('manager', `/api/booth-rent/renters/${r.body.id}`)).body.owedCents).toBe(75000)
    // rent is not a sale to a client: no sale receipt with a tip link goes out when it is paid (chair checkout is on here)
    await new Promise((res) => setTimeout(res, 300))
    expect(sent.filter((m) => m.name === 'saleReceipt' && m.to === 'wendyweekly@example.com')).toEqual([])
    expect(await t.db.select().from(t.schema.saleReceipt).where(eq(t.schema.saleReceipt.invoiceId, invs[0].id))).toHaveLength(0)
  })

  test('a monthly renter on the 31st is billed on each month\'s last day when it is shorter', async () => {
    const start = ymd(75)
    const r = await as('manager', '/api/booth-rent/renters', 'POST', { name: 'Molly Monthly', email: 'molly@example.com', rent: 900, frequency: 'monthly', dueDay: 31, startDate: start })
    expect(r.status).toBe(201)
    await settle()
    const p = (await periods(r.body.id)).map((x: any) => x.period)
    expect(p.length).toBeGreaterThanOrEqual(2)
    for (const d of p) {
      const [y, m] = d.split('-').map(Number)
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      expect(Number(d.slice(8, 10))).toBe(last)       // 31 → the 31st, or the month's last day
      expect(d >= start).toBe(true)
    }
    expect(new Set(p.map((d: string) => d.slice(0, 7))).size).toBe(p.length)    // one a month, none skipped into the next
  })

  test('a new rent applies to periods not yet invoiced; a moved day is never billed twice', async () => {
    const r = await weekly('Rosa Raise', 1)
    await settle()
    const before = await periods(r.body.id)
    expect(before).toHaveLength(2)
    const up = await as('manager', `/api/booth-rent/renters/${r.body.id}`, 'PATCH', { rent: 300 })
    expect(up.status).toBe(200)
    expect(up.body.rentCents).toBe(30000)
    // the old invoices are as they were
    expect((await Promise.all((await periods(r.body.id)).map((x: any) => invoiceOf(x.invoiceId)))).map((i: any) => Number(i.total))).toEqual([250, 250])
    // the next period is at the new rent
    await t.db.update(t.schema.boothRenter).set({ nextDue: ymd(0) } as any).where(eq(t.schema.boothRenter.id, r.body.id))
    await t.db.delete(t.schema.boothRentPeriod).where(and(eq(t.schema.boothRentPeriod.renterId, r.body.id), eq(t.schema.boothRentPeriod.period, ymd(0))))
    // moving the weekday: the schedule starts after the last period billed
    const moved = await as('manager', `/api/booth-rent/renters/${r.body.id}`, 'PATCH', { dueWeekday: (weekday(ymd(0)) + 2) % 7 })
    expect(moved.status).toBe(200)
    const nd = (await renterRow(r.body.id)).nextDue as string
    expect(weekday(nd)).toBe((weekday(ymd(0)) + 2) % 7)
    expect(nd > ymd(7)).toBe(true)
    // bad edits are words
    const bad = await as('manager', `/api/booth-rent/renters/${r.body.id}`, 'PATCH', { rent: -5 })
    expect([bad.status, bad.body.code]).toEqual([400, 'VALIDATION'])
    expect((await as('ana', `/api/booth-rent/renters/${r.body.id}`, 'PATCH', { rent: 100 })).status).toBe(403)
  })

  test('autopay needs a money seat, the renter\'s agreement, Card on file and a card — and charges each rent when it is invoiced', async () => {
    const r = await weekly('Cara Card', -3 + 3)    // starts today: due today
    expect(r.status).toBe(201)
    const id = r.body.id
    expect((await as('ana', `/api/booth-rent/renters/${id}/auto-pay`, 'PUT', { on: true, renterAgreed: true })).status).toBe(403)
    let x = await as('manager', `/api/booth-rent/renters/${id}/auto-pay`, 'PUT', { on: true })
    expect([x.status, x.body.code]).toEqual([400, 'CONSENT_REQUIRED'])
    x = await as('manager', `/api/booth-rent/renters/${id}/auto-pay`, 'PUT', { on: true, renterAgreed: true })
    expect([x.status, x.body.code]).toEqual([409, 'NO_CARD'])
    await features(FEATURES.filter((f) => f !== 'card_on_file'))
    x = await as('manager', `/api/booth-rent/renters/${id}/auto-pay`, 'PUT', { on: true, renterAgreed: true })
    expect([x.status, x.body.code]).toEqual([409, 'FEATURE_OFF'])
    await features(FEATURES)
    await addCard(r.body.contactId)
    calls.length = 0; sent.length = 0
    x = await agree(id)
    expect(x.status).toBe(200)
    expect(x.body).toMatchObject({ autoCharge: true, autoChargeConsentVia: 'staff', card: { last4: '4242' } })
    expect((await renterRow(id)).autoChargeConsentAt).toBeTruthy()
    // the rent due today was invoiced when the renter was added (before autopay): nothing was charged then
    expect(charges()).toEqual([])
    // the next rent: invoiced and charged on the salon's own account
    await t.db.update(t.schema.boothRenter).set({ nextDue: ymd(1) } as any).where(eq(t.schema.boothRenter.id, id))
    await settle(); await settle()
    expect(charges()).toHaveLength(1)
    expect(charges()[0].opts.stripeAccount).toBe('acct_salon')
    expect(charges()[0].args.amount).toBe(25000)
    const p = (await periods(id)).find((q: any) => q.period === ymd(1))!
    expect((await invoiceOf(p.invoiceId)).status).toBe('paid')
    expect(await paymentsOf(p.invoiceId)).toHaveLength(1)
    expect(sent.filter((m) => m.name === 'boothRentCharged').map((m) => m.to)).toEqual(['caracard@example.com'])
    expect(sent.filter((m) => m.name === 'boothRentInvoice')).toEqual([])          // autopay renters get the receipt, not an invoice notice
    // not a sale to a client: no sale receipt, no tip link
    expect(sent.filter((m) => m.name === 'saleReceipt')).toEqual([])
    // turning it off needs no agreement
    expect((await as('manager', `/api/booth-rent/renters/${id}/auto-pay`, 'PUT', { on: false })).body.autoCharge).toBe(false)
  })

  test('a declined card is tried again on the salon\'s wait, the staff are told each time, and after the last try the renter is paused — still invoiced, never charged, emailed a link', async () => {
    const r = await weekly('Dee Decline', 0)
    const id = r.body.id
    await addCard(r.body.contactId)
    await agree(id)
    declining.add(r.body.contactId)
    calls.length = 0; sent.length = 0
    await t.db.update(t.schema.boothRenter).set({ nextDue: ymd(1) } as any).where(eq(t.schema.boothRenter.id, id))
    await settle()
    expect((await tries(id)).map((x: any) => x.status)).toEqual(['declined'])
    expect((await renterRow(id)).status).toBe('active')
    // too soon: nothing
    await settle()
    expect(charges()).toHaveLength(1)
    for (let i = 0; i < 2; i++) { await backdateTries(id, 4 * (i + 1)); await settle() }
    expect((await tries(id)).map((x: any) => x.status)).toEqual(['declined', 'declined', 'declined'])
    const row = await renterRow(id)
    expect(row.status).toBe('paused')
    expect(row.autoCharge).toBe(true)
    expect(row.cardToken).toBeTruthy()
    expect(sent.filter((m) => m.name === 'boothRentDeclinedStaff')).toHaveLength(3)
    expect(sent.filter((m) => m.name === 'boothRentPaymentFailed')).toHaveLength(2)
    const paused = sent.filter((m) => m.name === 'boothRentPaused')
    expect(paused).toHaveLength(1)
    expect(paused[0].data.link).toEndWith(`/api/renter-card/${row.cardToken}`)
    expect(sent.filter((m) => m.name === 'boothRentPausedSalon')).toHaveLength(1)
    // nothing more is tried, however long we wait; the rent is still owed and the next one is still invoiced
    const n = charges().length
    await backdateTries(id, 40)
    await t.db.update(t.schema.boothRenter).set({ nextDue: ymd(0) } as any).where(eq(t.schema.boothRenter.id, id))
    await settle(); await settle()
    expect(charges()).toHaveLength(n)
    expect((await periods(id)).length).toBeGreaterThanOrEqual(2)
    const view = (await as('manager', `/api/booth-rent/renters/${id}`)).body
    expect(view).toMatchObject({ status: 'paused', owedCents: 50000 })
    expect(view.lastCharge).toMatchObject({ status: 'declined', attempt: 3, tries: 3 })
    // Retry now is for a renter still in their tries; a paused one uses Resume
    expect((await as('manager', `/api/booth-rent/renters/${id}/retry`, 'POST')).body.code).toBe('NOT_ACTIVE')
    declining.delete(r.body.contactId)
  })

  test('the renter\'s private card page: the agreement is needed for autopay, Stripe opens on the salon\'s account, and the new card restarts autopay and pays what is owed', async () => {
    const r = await weekly('Uma Update', 0)
    const id = r.body.id
    await addCard(r.body.contactId)
    await agree(id)
    declining.add(r.body.contactId)
    await t.db.update(t.schema.boothRenter).set({ nextDue: ymd(1) } as any).where(eq(t.schema.boothRenter.id, id))
    await settle()
    for (let i = 0; i < 2; i++) { await backdateTries(id, 4 * (i + 1)); await settle() }
    const token = (await renterRow(id)).cardToken as string
    const page = await t.call(`/api/renter-card/${token}`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Update my card')
    expect(html).not.toContain('name="agree"')        // already agreed
    sessionCalls.length = 0
    const go = await t.call(`/api/renter-card/${token}`, { method: 'POST', redirect: 'manual' } as any)
    expect(go.status).toBe(303)
    expect(sessionCalls[0].opts.stripeAccount).toBe('acct_salon')
    const sid = go.headers.get('location')!.split('/').pop()!
    expect(sessionMeta[sid].booth_renter_id).toBe(id)
    declining.delete(r.body.contactId)
    calls.length = 0
    const event = () => t.call('/api/stripe/factory-event', { method: 'POST', headers: { 'X-Factory-Key': 'factory-key' }, json: { event: { type: 'checkout.session.completed', account: 'acct_salon', data: { object: { id: sid, mode: 'setup', metadata: sessionMeta[sid] } } } } })
    expect((await event()).status).toBe(200)
    const row = await renterRow(id)
    expect(row.status).toBe('active')
    expect(row.cardToken).toBeNull()
    expect(row.pausedForPaymentAt).toBeNull()
    // both unpaid rents (the one invoiced on the start day and the one the declines were about) are charged to the NEW card, oldest first
    expect(charges()).toHaveLength(2)
    expect(charges().every((c) => c.args.payment_method === `pm_${sid}`)).toBe(true)
    expect((await as('manager', `/api/booth-rent/renters/${id}`)).body.owedCents).toBe(0)
    expect((await t.call(`/api/renter-card/${token}`)).status).toBe(404)
    await event()
    expect(charges()).toHaveLength(2)
  })

  test('a renter who has no card gives one and agrees on their own page; a card without the agreement ticked is refused', async () => {
    const r = await weekly('Nina New', 0)
    const id = r.body.id
    expect((await as('manager', `/api/booth-rent/renters/${id}/card-link`, 'POST')).status).toBe(200)
    const link = sent.filter((m) => m.name === 'boothRentCardLink').pop()!
    expect(link.to).toBe('ninanew@example.com')
    const token = (await renterRow(id)).cardToken as string
    expect(link.data.link).toEndWith(`/api/renter-card/${token}`)
    const html = await (await t.call(`/api/renter-card/${token}`)).text()
    expect(html).toContain('name="agree"')
    expect(html).toContain('$250 a week')
    const refused = await t.call(`/api/renter-card/${token}`, { method: 'POST', redirect: 'manual' } as any)
    expect(refused.status).toBe(400)
    const form = new URLSearchParams({ agree: '1' })
    const go = await t.call(`/api/renter-card/${token}`, { method: 'POST', redirect: 'manual', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } as any)
    expect(go.status).toBe(303)
    const sid = go.headers.get('location')!.split('/').pop()!
    expect(sessionMeta[sid]).toMatchObject({ booth_renter_id: id, booth_autopay: '1' })
    await t.call('/api/stripe/factory-event', { method: 'POST', headers: { 'X-Factory-Key': 'factory-key' }, json: { event: { type: 'checkout.session.completed', account: 'acct_salon', data: { object: { id: sid, mode: 'setup', metadata: sessionMeta[sid] } } } } })
    const row = await renterRow(id)
    expect(row).toMatchObject({ autoCharge: true, autoChargeConsentVia: 'renter_online', cardToken: null })
    expect(row.autoChargeConsentAt).toBeTruthy()
    // no email, no link
    const noMail = await as('manager', '/api/booth-rent/renters', 'POST', { name: 'Nomi NoMail', rent: 100, frequency: 'weekly', dueWeekday: 2, startDate: ymd(-9) })
    const x = await as('manager', `/api/booth-rent/renters/${noMail.body.id}/card-link`, 'POST')
    expect([x.status, x.body.code]).toEqual([409, 'NO_EMAIL'])
    // the desk page on Stripe
    sessionCalls.length = 0
    const desk = await as('manager', `/api/booth-rent/renters/${id}/card-setup`, 'POST')
    expect(desk.status).toBe(200)
    expect(desk.body.url).toStartWith('https://checkout.stripe.com/c/setup/')
    expect(sessionCalls[0].opts.stripeAccount).toBe('acct_salon')
  })

  test('a repeated or simultaneous run charges an invoice once; Retry now skips the wait but not the tries; Resume by hand needs a money seat and a card that works', async () => {
    const r = await weekly('Ron Retry', 0)
    const id = r.body.id
    await addCard(r.body.contactId)
    await agree(id)
    // paid on the start day by hand? no — autopay was off then; clear that invoice so the one below is the only one open
    await t.db.update(t.schema.invoice).set({ status: 'void' } as any).where(eq(t.schema.invoice.contactId, r.body.contactId))
    calls.length = 0
    await t.db.update(t.schema.boothRenter).set({ nextDue: ymd(1) } as any).where(eq(t.schema.boothRenter.id, id))
    await Promise.all([settle(), settle(), settle()])
    await settle()
    expect(charges()).toHaveLength(1)
    expect(await tries(id)).toHaveLength(1)
    // decline the next one: try 1, then Retry now (try 2, no wait), then the timed one is out of the way until the wait passes
    declining.add(r.body.contactId)
    await t.db.update(t.schema.boothRenter).set({ nextDue: ymd(2) } as any).where(eq(t.schema.boothRenter.id, id))
    await settle()
    expect((await tries(id)).map((x: any) => x.status)).toEqual(['succeeded', 'declined'])
    expect((await as('ana', `/api/booth-rent/renters/${id}/retry`, 'POST')).status).toBe(403)
    let x = await as('manager', `/api/booth-rent/renters/${id}/retry`, 'POST')
    expect(x.status).toBe(200)
    expect(x.body.retryResult).toBe('declined')
    expect((await tries(id)).map((y: any) => y.attempt)).toEqual([1, 1, 2])
    x = await as('manager', `/api/booth-rent/renters/${id}/retry`, 'POST')       // try 3 — the last: now paused
    expect(x.status).toBe(200)
    expect((await renterRow(id)).status).toBe('paused')
    // Resume while the card still declines: paused again; with a card that works: paid and active
    expect((await as('ana', `/api/booth-rent/renters/${id}/resume`, 'POST')).status).toBe(403)
    x = await as('manager', `/api/booth-rent/renters/${id}/resume`, 'POST')
    expect(x.status).toBe(200)
    expect(x.body.status).toBe('paused')                                  // a card that still declines pauses it again
    expect(x.body.resumeResult).toBe('declined')
    declining.delete(r.body.contactId)
    x = await as('manager', `/api/booth-rent/renters/${id}/resume`, 'POST')
    expect(x.body).toMatchObject({ status: 'active', resumeResult: 'paid', owedCents: 0 })
    expect((await as('manager', `/api/booth-rent/renters/${id}/resume`, 'POST')).body.code).toBe('NOT_PAUSED')
  })

  test('waiving a rent day: before it is invoiced, or while unpaid; never once paid; a reason is needed', async () => {
    const r = await weekly('Wally Waive', 1)
    const id = r.body.id
    await settle()
    const [first, second] = await periods(id)
    // a reason is needed, a day that is not a rent day is refused
    expect((await as('manager', `/api/booth-rent/renters/${id}/waive`, 'POST', { period: first.period, reason: '' })).status).toBe(400)
    expect((await as('manager', `/api/booth-rent/renters/${id}/waive`, 'POST', { period: ymd(-3), reason: 'holiday' })).body.code).toBe('NOT_A_RENT_DAY')
    expect((await as('ana', `/api/booth-rent/renters/${id}/waive`, 'POST', { period: first.period, reason: 'holiday' })).status).toBe(403)
    // an invoiced, unpaid period is voided and left out of what is owed
    let w = await as('manager', `/api/booth-rent/renters/${id}/waive`, 'POST', { period: first.period, reason: 'Salon closed for a week' })
    expect(w.status).toBe(200)
    expect((await invoiceOf(first.invoiceId)).status).toBe('void')
    expect(w.body.owedCents).toBe(25000)
    expect((await as('manager', `/api/booth-rent/renters/${id}/waive`, 'POST', { period: first.period, reason: 'again' })).body.code).toBe('ALREADY_WAIVED')
    // a paid one cannot be waived
    await as('manager', `/api/invoices/${second.invoiceId}/payments`, 'POST', { amount: 250, method: 'cash' })
    expect((await as('manager', `/api/booth-rent/renters/${id}/waive`, 'POST', { period: second.period, reason: 'oops' })).body.code).toBe('ALREADY_PAID')
    // a future day: waived with no invoice ever raised
    const future = (await renterRow(id)).nextDue as string
    w = await as('manager', `/api/booth-rent/renters/${id}/waive`, 'POST', { period: future, reason: 'Holiday week' })
    expect(w.status).toBe(200)
    expect((await renterRow(id)).nextDue).not.toBe(future)
    await t.db.update(t.schema.boothRenter).set({ nextDue: future } as any).where(eq(t.schema.boothRenter.id, id))
    await t.db.update(t.schema.company).set({ timezone: 'Pacific/Kiritimati' } as any).where(eq(t.schema.company.id, co))   // a clock far ahead of UTC: still not invoiced
    await settle()
    await t.db.update(t.schema.company).set({ timezone: 'UTC' } as any).where(eq(t.schema.company.id, co))
    expect((await periods(id)).filter((q: any) => q.period === future).map((q: any) => [q.status, q.invoiceId])).toEqual([['waived', null]])
    // the ledger shows it
    const ledger = (await as('manager', `/api/booth-rent/renters/${id}/ledger`)).body
    expect(ledger.lines.filter((l: any) => l.kind === 'waived').map((l: any) => l.description)).toEqual(['Rent waived — Salon closed for a week', 'Rent waived — Holiday week'])
  })

  test('the ledger and the statement add up to the invoices and payments; the file and the email say the same', async () => {
    const r = await weekly('Lena Ledger', 3)
    const id = r.body.id
    await settle()
    const ps = await periods(id)
    await as('manager', `/api/invoices/${ps[0].invoiceId}/payments`, 'POST', { amount: 250, method: 'cash' })
    await as('manager', `/api/invoices/${ps[1].invoiceId}/payments`, 'POST', { amount: 100, method: 'check' })
    const ledger = (await as('manager', `/api/booth-rent/renters/${id}/ledger`)).body
    expect(ledger.balanceCents).toBe(4 * 25000 - 25000 - 10000)
    expect(ledger.lines.map((l: any) => l.kind)).toEqual(['rent', 'rent', 'rent', 'rent', 'payment', 'payment'])
    expect(ledger.lines[ledger.lines.length - 1].balanceCents).toBe(ledger.balanceCents)
    // it matches the owing on the renter's row
    expect((await as('manager', `/api/booth-rent/renters/${id}`)).body.owedCents).toBe(ledger.balanceCents)
    // a statement for the middle of it
    const st = (await as('manager', `/api/booth-rent/renters/${id}/statement?from=${ymd(14)}&to=${ymd(0)}`)).body
    expect([st.openingCents, st.chargesCents, st.paymentsCents, st.closingCents]).toEqual([25000, 75000, 35000, 65000])
    expect(st.closingCents).toBe(ledger.balanceCents)
    expect(st.lines.map((l: any) => l.date)).toEqual([ymd(14), ymd(7), ymd(0), ymd(0), ymd(0)])
    // the whole of it from the start has nothing owed at the start
    const all = (await as('manager', `/api/booth-rent/renters/${id}/statement`)).body
    expect([all.openingCents, all.closingCents]).toEqual([0, 65000])
    // bad days are words
    expect((await as('manager', `/api/booth-rent/renters/${id}/statement?from=2026-13-01&to=${ymd(0)}`)).status).toBe(400)
    expect((await as('manager', `/api/booth-rent/renters/${id}/statement?from=${ymd(0)}&to=${ymd(14)}`)).status).toBe(400)
    // the spreadsheet file: the same lines and totals
    const csvRes = await t.call(`/api/booth-rent/renters/${id}/statement?from=${ymd(14)}&to=${ymd(0)}&format=csv`, { headers: { Authorization: `Bearer ${tokens.manager}` } })
    expect(csvRes.status).toBe(200)
    expect(csvRes.headers.get('content-type')).toContain('text/csv')
    expect(csvRes.headers.get('content-disposition')).toContain('rent-statement-lena-ledger')
    const csv = await csvRes.text()
    expect(csv).toContain('Opening balance,250.00')
    expect(csv).toContain('Closing balance,650.00')
    expect(csv.split('\r\n').filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l))).toHaveLength(5)
    // emailed to the renter
    sent.length = 0
    expect((await as('manager', `/api/booth-rent/renters/${id}/statement/email`, 'POST', { from: ymd(14), to: ymd(0) })).status).toBe(200)
    const mail = sent.filter((m) => m.name === 'boothRentStatement')
    expect(mail.map((m) => m.to)).toEqual(['lenaledger@example.com'])
    expect(mail[0].data).toMatchObject({ opening: '250.00', charged: '750.00', paid: '350.00', closing: '650.00' })
    // a stylist's seat sees none of it
    for (const path of [`/ledger`, `/statement`]) expect((await as('ana', `/api/booth-rent/renters/${id}${path}`)).status).toBe(403)
  })

  test('a renter who leaves is invoiced for what is due, then no more; adding them again starts a new rent and keeps their history', async () => {
    const r = await weekly('Eli Exit', 1)
    const id = r.body.id
    const end = await as('manager', `/api/booth-rent/renters/${id}/end`, 'POST')
    expect(end.status).toBe(200)
    expect(end.body).toMatchObject({ status: 'ended', endedOn: ymd(0), nextDue: null, autoCharge: false })
    expect((await periods(id)).map((p: any) => p.period)).toEqual([ymd(7), ymd(0)])     // the rent due up to today was invoiced first
    await t.db.update(t.schema.boothRenter).set({ nextDue: ymd(0) } as any).where(eq(t.schema.boothRenter.id, id))
    await settle(); await settle()
    expect(await periods(id)).toHaveLength(2)                                             // an ended renter is not invoiced again
    expect((await as('manager', `/api/booth-rent/renters/${id}/end`, 'POST')).body.code).toBe('ENDED')
    expect((await as('manager', `/api/booth-rent/renters/${id}`, 'PATCH', { rent: 100 })).body.code).toBe('ENDED')
    const back = await as('manager', '/api/booth-rent/renters', 'POST', { teamMemberId: r.body.teamMemberId, rent: 275, frequency: 'weekly', dueWeekday: 1, startDate: ymd(-8) })
    expect(back.status).toBe(201)
    expect(back.body).toMatchObject({ id, status: 'active', rentCents: 27500 })
    expect(back.body.contactId).toBe(r.body.contactId)
    expect(await periods(id)).toHaveLength(2)                                             // the history stays
    // the list puts the ones who left last
    const list = (await as('manager', '/api/booth-rent/renters?settle=0')).body.data
    expect(list.length).toBeGreaterThan(5)
  })
})
