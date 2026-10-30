// Home care depth, item 3 — autopay (docs/parity/homecare-privatepay.md). Through the real server with a FAKE Stripe (nothing
// here reaches Stripe or any live account):
//   · off (refused) without care_autopay; a seat without care-billing is refused;
//   · a card is saved only through Stripe's own page (Checkout, setup mode) on the agency's connected account — refused, with no
//     Stripe call, when that account is not connected; the consent wording is on that page; a made-up event attaches no card;
//   · an invoice is charged when it is sent — never a draft, never more than is owed, once however often it is released,
//     swept or retried by hand — on the agency's account with an idempotency key, and lands on the ledger by its payment intent;
//   · a declined card is retried 2/3/4 days apart (four tries) with a plain notice each time; a card that can never work stops
//     the tries and pauses autopay until a new card is saved; a bank that wants the card's owner ends the tries;
//   · an unanswered Stripe call is asked again later with the same key and is never taken twice;
//   · a charge finished by Stripe's event is recorded once.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { homecareTemplates } from '../server/crm/homecare/core/messages.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'

const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any })
const calls: any[] = []
const piCalls = () => calls.filter((c) => c.what === 'pi')

// A fake that behaves like Stripe where it matters here: the same idempotency key gets the same answer back.
let script: (args: any, n: number) => any = () => ({ status: 'succeeded' })
let chargeNo = 0
const byKey = new Map<string, any>()
let sessionNo = 0
const fakeStripe = {
  customers: { create: async (args: any, opts: any) => { calls.push({ what: 'customer', args, opts }); return { id: 'cus_1' } } },
  checkout: { sessions: { create: async (args: any, opts: any) => { calls.push({ what: 'setup', args, opts }); sessionNo++; return { id: `cs_setup_${sessionNo}`, url: `https://checkout.stripe.test/setup_${sessionNo}` } } } },
  setupIntents: { retrieve: async (id: string, opts: any) => { calls.push({ what: 'si', id, opts }); return { id, payment_method: `pm_${id}` } } },
  paymentMethods: {
    retrieve: async (id: string, opts: any) => { calls.push({ what: 'pm', id, opts }); return { id, card: { brand: 'visa', last4: id.includes('2') ? '1111' : '4242', exp_month: 12, exp_year: 2031 } } },
    detach: async (id: string, opts: any) => { calls.push({ what: 'detach', id, opts }); return {} },
  },
  paymentIntents: {
    create: async (args: any, opts: any) => {
      calls.push({ what: 'pi', args, opts })
      const key = opts?.idempotencyKey as string
      if (key && byKey.has(key)) { const prior = byKey.get(key); if (prior.error) throw prior.error; return prior.intent }
      chargeNo++
      const out = script(args, chargeNo)
      if (out instanceof Error) { if (key && (out as any).stored) byKey.set(key, { intent: { id: `pi_${chargeNo}`, status: 'succeeded' } }); throw out }
      const intent = { id: `pi_${chargeNo}`, ...out }
      if (key) byKey.set(key, { intent })
      return intent
    },
  },
}
const cardError = (decline_code: string, code = 'card_declined') => Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code, decline_code })

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', clientId = ''
let n = 0
const tokens: Record<string, string> = {}
const sent: Array<{ to: string; template: string; data: any }> = []
const env: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string | undefined) => { if (!(k in env)) env[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v }
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const connect = (acct: string | null) => t.db.update(t.schema.company).set({ integrations: acct ? { stripeAccountId: acct } : {} } as any).where(eq(t.schema.company.id, companyId))
const FACTORY = { 'X-Factory-Key': 'factory-test-key' }
const factoryEvent = (event: any) => t.call('/api/stripe/factory-event', { method: 'POST', headers: FACTORY, json: { event } })
let homecareCore: ReturnType<typeof createHomecareCore>
const core = () => homecareCore

const invoice = async (total: number, extra: any = {}) => {
  n++
  return ins(t.schema.invoices, { companyId, invoiceNumber: `HC-AP-${n}`, clientId, billingPeriodStart: '2026-10-01', billingPeriodEnd: '2026-10-14', subtotal: String(total), total: String(total), paymentStatus: 'pending', paymentDueDate: '2026-11-20', ...extra })
}
const release = (id: string) => as('owner')(`/api/billing/invoices/${id}/release`, { method: 'POST' })
const row = async (id: string) => (await t.db.select().from(t.schema.invoices).where(eq(t.schema.invoices.id, id)))[0] as any
const attempts = async (id: string) => (await t.db.select().from(t.schema.autopayAttempt).where(eq(t.schema.autopayAttempt.invoiceId, id)).orderBy(t.schema.autopayAttempt.attemptNo)) as any[]
const payments = async (id: string) => (await t.db.select().from(t.schema.invoicePayments).where(eq(t.schema.invoicePayments.invoiceId, id))) as any[]
const lastMail = (template: string) => sent.filter((m) => m.template === template).at(-1)
const setup = async () => {
  const r = await json(await as('owner')(`/api/care-autopay/clients/${clientId}/setup`, { method: 'POST' }))
  expect(r.status).toBe(200)
  return r.body
}
/** Stripe's page was completed for the most recent link. */
const saveCard = async (sessionId: string) => {
  const ok = await factoryEvent({ id: `evt_${sessionId}`, type: 'checkout.session.completed', account: 'acct_agency', data: { object: { id: sessionId, mode: 'setup', setup_intent: `seti_${sessionId.slice(-1)}`, metadata: { autopay_client_id: clientId, autopay_company_id: companyId } } } })
  expect(ok.status).toBe(200)
}
const pastDue = async (invoiceId: string) => t.db.update(t.schema.autopayAttempt).set({ nextAttemptAt: new Date(Date.now() - 60_000) } as any).where(eq(t.schema.autopayAttempt.invoiceId, invoiceId))

beforeAll(async () => {
  setEnv('SMTP_HOST', 'smtp.invalid') // a provider, so the agency "can send"; the send itself is replaced below
  setEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_x')
  setEnv('FACTORY_SYNC_KEY', 'factory-test-key')
  t = await bootTenant({ vertical: 'homecare', stripe: fakeStripe })
  const s = await seedOwner(t)
  companyId = s.company.id
  homecareCore = createHomecareCore({ services: t.services.crm } as any)
  await t.db.update(t.schema.company).set({ name: 'Test Builders', email: 'office@agency.example' } as any).where(eq(t.schema.company.id, companyId))
  const email: any = t.services.email
  email.send = async (to: string, template: string, data: any) => { sent.push({ to, template, data }); return { success: true, dev: true } }
  tokens.owner = await login('owner@test.example', s.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  clientId = (await ins(t.schema.clients, { companyId, firstName: 'Ada', lastName: 'Client', email: 'ada@family.example', isActive: true, isPrivatePay: true })).id
  await setFeatures(['contacts', 'scheduling', 'team', 'online_payments'])
  await connect('acct_agency')
}, 120_000)
afterAll(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

describe('autopay is off until the feature is on, and is for the billing seats', () => {
  test('without care_autopay the routes are refused, and a release charges nothing', async () => {
    const r = await json(await as('owner')('/api/care-autopay/clients'))
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('FEATURE_NOT_ENABLED')
    expect(piCalls()).toEqual([])
  })

  test('a caregiver seat cannot read or change anyone\'s autopay', async () => {
    await setFeatures(['contacts', 'scheduling', 'team', 'online_payments', 'care_autopay'])
    for (const [method, path] of [['GET', '/api/care-autopay/clients'], ['GET', `/api/care-autopay/clients/${clientId}`], ['POST', `/api/care-autopay/clients/${clientId}/setup`], ['DELETE', `/api/care-autopay/clients/${clientId}`], ['GET', '/api/care-autopay/attention']]) {
      expect((await as('ann')(path, { method })).status).toBe(403)
    }
    expect(calls).toEqual([])
  })
})

describe('saving a card happens on Stripe\'s page, on the agency\'s own account', () => {
  test('with no connected Stripe account the link is refused and Stripe is not called', async () => {
    await connect(null)
    const r = await json(await as('owner')(`/api/care-autopay/clients/${clientId}/setup`, { method: 'POST' }))
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('payments_unavailable')
    expect(calls).toEqual([])
    await connect('acct_agency')
  })

  test('the link is a Stripe-hosted setup page for the agency\'s account, with the consent wording on it and no card fields of ours', async () => {
    const out = await setup()
    expect(out.url).toBe('https://checkout.stripe.test/setup_1')
    const page = calls.find((c) => c.what === 'setup')
    expect(page.opts).toEqual({ stripeAccount: 'acct_agency' })
    expect(calls.find((c) => c.what === 'customer').opts).toEqual({ stripeAccount: 'acct_agency' })
    expect(page.args).toMatchObject({ mode: 'setup', payment_method_types: ['card'], customer: 'cus_1' })
    expect(page.args.custom_text.submit.message).toContain('I authorize Test Builders to charge this card for each invoice')
    expect(JSON.stringify(page.args)).not.toMatch(/card_number|"number"|cvc/i)
    const st = await json(await as('owner')(`/api/care-autopay/clients/${clientId}`))
    expect(st.body.status).toBe('pending')
  })

  test('an event for a page we did not make attaches no card; the real one saves the brand and last four, and a replay changes nothing', async () => {
    await factoryEvent({ id: 'evt_forged', type: 'checkout.session.completed', data: { object: { id: 'cs_forged', mode: 'setup', setup_intent: 'seti_x', metadata: { autopay_client_id: clientId, autopay_company_id: companyId } } } })
    expect((await json(await as('owner')(`/api/care-autopay/clients/${clientId}`))).body.status).toBe('pending')
    await saveCard('cs_setup_1')
    await saveCard('cs_setup_1')
    const st = (await json(await as('owner')(`/api/care-autopay/clients/${clientId}`))).body
    expect(st).toMatchObject({ status: 'active', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2031 })
    expect(st.consentAt).toBeTruthy()
    expect(JSON.stringify(st)).not.toContain('pm_')
    const [stored] = await t.db.select().from(t.schema.clientAutopay).where(eq(t.schema.clientAutopay.clientId, clientId))
    expect(stored.consentText).toContain('I authorize Test Builders')
    expect(calls.filter((c) => c.what === 'pm').every((c) => c.opts.stripeAccount === 'acct_agency')).toBe(true)
  })
})

describe('charging an invoice as it is sent', () => {
  test('a draft is not charged; releasing it charges what is owed once, on the agency\'s account, and records it by the payment intent', async () => {
    const inv = await invoice(120)
    expect((await core().autopay.sweep()) ?? 0).toBe(0)
    expect(piCalls()).toEqual([])
    expect((await release(inv.id)).status).toBe(200)
    expect(piCalls()).toHaveLength(1)
    const pi = piCalls()[0]
    expect(pi.args).toMatchObject({ amount: 12000, currency: 'usd', customer: 'cus_1', payment_method: 'pm_seti_1', off_session: true, confirm: true })
    expect(pi.opts).toEqual({ stripeAccount: 'acct_agency', idempotencyKey: `autopay-${inv.id}-1` })
    expect(pi.args.metadata).toMatchObject({ kind: 'homecare_autopay', invoice_id: inv.id, company_id: companyId })
    const after = await row(inv.id)
    expect([after.paymentStatus, Number(after.amountPaid)]).toEqual(['paid', 120])
    const pays = await payments(inv.id)
    expect(pays).toHaveLength(1)
    expect([pays[0].referenceNumber, Number(pays[0].amount), pays[0].paymentMethod]).toEqual(['pi_1', 120, 'stripe'])
    expect((await attempts(inv.id)).map((a) => a.status)).toEqual(['succeeded'])
  })

  test('released again, swept, tried by hand, or its event replayed: never charged twice', async () => {
    const [inv] = (await t.db.select().from(t.schema.invoices).where(eq(t.schema.invoices.clientId, clientId))) as any[]
    await release(inv.id)
    await core().autopay.sweep()
    const hand = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/try-now`, { method: 'POST' }))
    expect(hand.status).toBe(400)
    await factoryEvent({ id: 'evt_pi1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount: 12000, metadata: { kind: 'homecare_autopay', invoice_id: inv.id, company_id: companyId, attempt: '1' } } } })
    expect(piCalls()).toHaveLength(1)
    expect(await payments(inv.id)).toHaveLength(1)
  })

  test('only what is still owed is charged', async () => {
    const inv = await invoice(120)
    expect((await as('owner')('/api/billing/invoice-payments', { method: 'POST', json: { invoiceId: inv.id, amount: 50, paymentDate: '2026-10-20', paymentMethod: 'check' } })).status).toBeLessThan(300)
    await release(inv.id)
    expect(piCalls().at(-1).args.amount).toBe(7000)
    expect(Number((await row(inv.id)).amountPaid)).toBe(120)
  })

  test('a failed card never blocks the release', async () => {
    script = () => cardError('insufficient_funds')
    const inv = await invoice(40)
    const r = await release(inv.id)
    expect(r.status).toBe(200)
    expect((await row(inv.id)).sentAt).toBeTruthy()
  })
})

describe('a declined card is retried, then the family is asked', () => {
  test('insufficient funds: try 1 fails, the family and office are told in plain words, and no try happens before the wait is over', async () => {
    const inv = await invoice(60)
    script = () => cardError('insufficient_funds')
    const before = piCalls().length
    await release(inv.id)
    expect(piCalls().length - before).toBe(1)
    const [a] = await attempts(inv.id)
    expect([a.status, a.failureCode, a.hardDecline]).toEqual(['failed', 'insufficient_funds', false])
    const days = (new Date(a.nextAttemptAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(1.9)
    expect(days).toBeLessThanOrEqual(2.01)
    const mail = lastMail('homecareAutopayFailed')!
    expect(mail.to).toBe('ada@family.example')
    expect(mail.data).toMatchObject({ reason: 'the card did not have enough available', amountDue: '60.00' })
    expect(mail.data.retryOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(String(mail.data.documentPath)).toMatch(/^\/d\/[0-9a-f]{64}$/)
    const rendered = homecareTemplates.homecareAutopayFailed(mail.data, { companyName: 'Test Builders', colourOnWhite: '#c2410c' } as any, 'https://agency.test.example')
    expect(rendered.html).toContain('did not go through')
    expect(rendered.html).toContain(`href="https://agency.test.example${mail.data.documentPath}"`)
    const notes = await t.db.select().from(t.schema.notifications).where(and(eq(t.schema.notifications.companyId, companyId), eq(t.schema.notifications.type, 'autopay_failed')))
    expect(notes.length).toBeGreaterThan(0)
    await core().autopay.sweep()
    expect(piCalls().length - before).toBe(1) // still waiting
    const attention = (await json(await as('owner')('/api/care-autopay/attention'))).body
    expect(JSON.stringify(attention)).toContain(inv.id)
  })

  test('tries 2 and 3 follow 2 and 3 days later and the third works; the fourth is never made', async () => {
    const [inv] = (await t.db.select().from(t.schema.invoices).where(eq(t.schema.invoices.total, '60'))) as any[]
    script = () => cardError('insufficient_funds')
    await pastDue(inv.id)
    await core().autopay.sweep()
    let list = await attempts(inv.id)
    expect(list.map((a) => [a.attemptNo, a.status])).toEqual([[1, 'failed'], [2, 'failed']])
    expect((new Date(list[1].nextAttemptAt).getTime() - Date.now()) / 86_400_000).toBeGreaterThan(2.9)
    script = () => ({ status: 'succeeded' })
    await t.db.update(t.schema.autopayAttempt).set({ nextAttemptAt: new Date(Date.now() - 1000) } as any).where(eq(t.schema.autopayAttempt.invoiceId, inv.id))
    await core().autopay.sweep()
    list = await attempts(inv.id)
    expect(list.map((a) => a.status)).toEqual(['failed', 'failed', 'succeeded'])
    expect((await row(inv.id)).paymentStatus).toBe('paid')
    expect(piCalls().filter((c) => c.args.metadata.invoice_id === inv.id).map((c) => c.opts.idempotencyKey)).toEqual([`autopay-${inv.id}-1`, `autopay-${inv.id}-2`, `autopay-${inv.id}-3`])
  })

  test('four failures end the tries: the last notice says no more, a fifth is never made, "try now" says why', async () => {
    const inv = await invoice(35)
    script = () => cardError('generic_decline')
    await release(inv.id)
    for (let i = 0; i < 3; i++) { await pastDue(inv.id); await core().autopay.sweep() }
    const list = await attempts(inv.id)
    expect(list.map((a) => [a.attemptNo, a.status])).toEqual([[1, 'failed'], [2, 'failed'], [3, 'failed'], [4, 'failed']])
    expect(list[3].nextAttemptAt).toBeNull()
    expect(lastMail('homecareAutopayFailed')!.data.retryOn).toBeNull()
    expect(homecareTemplates.homecareAutopayFailed(lastMail('homecareAutopayFailed')!.data, {} as any, 'https://x.example').text).toContain('We will not try this card again.')
    const hand = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/try-now`, { method: 'POST' }))
    expect(hand.status).toBe(400)
    expect(hand.body.code).toBe('no_more_tries')
    const piBefore = piCalls().length
    await pastDue(inv.id); await core().autopay.sweep() // even with the wait over, there is no fifth
    expect(piCalls().length).toBe(piBefore)
    expect((await attempts(inv.id))).toHaveLength(4)
    expect((await row(inv.id)).paymentStatus).toBe('pending')
  })

  test('"try now" skips the wait but not the rules', async () => {
    const inv = await invoice(22)
    script = () => cardError('insufficient_funds')
    await release(inv.id)
    script = () => ({ status: 'succeeded' })
    const hand = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/try-now`, { method: 'POST' }))
    expect(hand.status).toBe(200)
    expect(hand.body.status).toBe('charged')
    expect((await attempts(inv.id)).map((a) => a.status)).toEqual(['failed', 'succeeded'])
  })
})

describe('a card that can never work, and a bank that wants the owner', () => {
  test('an expired card stops the tries and pauses autopay; no later invoice is charged until a new card is saved, then the stopped one is tried with it', async () => {
    const stuck = await invoice(80)
    script = () => cardError('expired_card', 'expired_card')
    await release(stuck.id)
    const [a] = await attempts(stuck.id)
    expect([a.status, a.hardDecline, a.nextAttemptAt]).toEqual(['failed', true, null])
    expect(lastMail('homecareAutopayFailed')!.data.reason).toBe('the card has expired')
    const st = (await json(await as('owner')(`/api/care-autopay/clients/${clientId}`))).body
    expect(st.status).toBe('paused')
    expect(st.pausedReason).toBe('the card has expired')

    script = () => ({ status: 'succeeded' })
    const later = await invoice(45)
    const before = piCalls().length
    await release(later.id)
    await core().autopay.sweep()
    expect(piCalls().length).toBe(before) // paused: nothing charged

    const out = await setup()
    await saveCard(`cs_setup_${sessionNo}`)
    expect(out.url).toContain('setup_')
    expect(piCalls().length - before).toBe(2) // the new card pays the stopped invoice and the waiting one
    expect((await row(stuck.id)).paymentStatus).toBe('paid')
    expect((await row(later.id)).paymentStatus).toBe('paid')
    const st2 = (await json(await as('owner')(`/api/care-autopay/clients/${clientId}`))).body
    expect([st2.status, st2.last4]).toEqual(['active', '1111'])
    expect(calls.some((c) => c.what === 'detach' && c.id === 'pm_seti_1')).toBe(true) // the old card is let go
  })

  test('a bank that needs the card\'s owner ends the tries for that invoice and says so; it is not retried', async () => {
    const inv = await invoice(55)
    script = () => cardError('authentication_required', 'authentication_required')
    await release(inv.id)
    const [a] = await attempts(inv.id)
    expect([a.status, a.nextAttemptAt]).toEqual(['needs_action', null])
    expect(lastMail('homecareAutopayFailed')!.data.reason).toBe('the card\'s bank needs the card owner to approve this payment')
    const before = piCalls().length
    await pastDue(inv.id)
    await core().autopay.sweep()
    const hand = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/try-now`, { method: 'POST' }))
    expect(hand.body.code).toBe('needs_family')
    expect(piCalls().length).toBe(before)
    script = () => ({ status: 'succeeded' })
  })
})

describe('never twice, even when Stripe does not answer', () => {
  test('a lost answer leaves the try open; it is asked again later with the same key and recorded once', async () => {
    const inv = await invoice(90)
    script = () => Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError', stored: true }) // Stripe took the money; the reply was lost
    await release(inv.id)
    let list = await attempts(inv.id)
    expect(list.map((a) => a.status)).toEqual(['pending'])
    expect((await row(inv.id)).paymentStatus).toBe('pending')
    const before = piCalls().length
    await core().autopay.sweep()
    expect(piCalls().length).toBe(before) // a fresh try is not asked again at once
    script = () => ({ status: 'succeeded' }) // would be a NEW charge if the key were not reused
    await t.db.update(t.schema.autopayAttempt).set({ updatedAt: new Date(Date.now() - 20 * 60_000) } as any).where(eq(t.schema.autopayAttempt.invoiceId, inv.id))
    await core().autopay.sweep()
    const again = piCalls().at(-1)
    expect(again.opts.idempotencyKey).toBe(`autopay-${inv.id}-1`)
    list = await attempts(inv.id)
    expect(list.map((a) => a.status)).toEqual(['succeeded'])
    expect(await payments(inv.id)).toHaveLength(1)
    expect(chargeNo).toBeGreaterThan(0)
    expect(byKey.get(`autopay-${inv.id}-1`).intent.status).toBe('succeeded')
  })

  test('two sweeps at once charge one invoice once', async () => {
    const inv = await invoice(33, { sentAt: new Date() })
    const before = piCalls().length
    await Promise.all([core().autopay.sweep(), core().autopay.sweep(), core().autopay.chargeInvoice(companyId, inv.id)])
    expect(piCalls().length - before).toBe(1)
    expect(await payments(inv.id)).toHaveLength(1)
  })

  test('a slow bank: the charge is "processing", and Stripe\'s event finishes it once', async () => {
    const inv = await invoice(27)
    script = () => ({ status: 'processing' })
    await release(inv.id)
    const [a] = await attempts(inv.id)
    expect(a.status).toBe('pending')
    expect(a.paymentIntentId).toBeTruthy()
    const ev = { id: 'evt_slow', type: 'payment_intent.succeeded', data: { object: { id: a.paymentIntentId, amount: 2700, metadata: { kind: 'homecare_autopay', invoice_id: inv.id, company_id: companyId, attempt: '1' } } } }
    await factoryEvent(ev)
    await factoryEvent(ev)
    expect((await row(inv.id)).paymentStatus).toBe('paid')
    expect(await payments(inv.id)).toHaveLength(1)
    // An event with the wrong amount or an intent we never made records nothing.
    const other = await invoice(10, { sentAt: new Date() })
    await factoryEvent({ id: 'evt_x', type: 'payment_intent.succeeded', data: { object: { id: 'pi_not_ours', amount: 1000, metadata: { kind: 'homecare_autopay', invoice_id: other.id, company_id: companyId, attempt: '1' } } } })
    expect(await payments(other.id)).toHaveLength(0)
    script = () => ({ status: 'succeeded' })
  })
})

describe('the agency\'s own account, always', () => {
  test('with the account disconnected nothing is asked of Stripe and the invoice stays owed', async () => {
    await connect(null)
    const inv = await invoice(66)
    const before = calls.length
    await release(inv.id)
    await core().autopay.sweep()
    expect(calls.length).toBe(before)
    expect((await attempts(inv.id))).toEqual([])
    expect((await row(inv.id)).paymentStatus).toBe('pending')
    await connect('acct_other') // a different account than the card was saved on
    await core().autopay.sweep()
    expect(calls.length).toBe(before)
    const hand = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/try-now`, { method: 'POST' }))
    expect(hand.body.code).toBe('account_changed')
    await connect('acct_agency')
  })

  test('every Stripe call carries the agency\'s account', () => {
    for (const c of calls.filter((x) => ['customer', 'setup', 'si', 'pm', 'detach', 'pi'].includes(x.what))) expect(c.opts.stripeAccount).toBe('acct_agency')
  })

  test('removing the card stops the charges', async () => {
    expect((await as('owner')(`/api/care-autopay/clients/${clientId}`, { method: 'DELETE' })).status).toBe(200)
    const inv = await invoice(18)
    const before = piCalls().length
    await release(inv.id)
    await core().autopay.sweep()
    expect(piCalls().length).toBe(before)
    expect((await json(await as('owner')(`/api/care-autopay/clients/${clientId}`))).body.status).toBe('none')
    expect((await as('owner')(`/api/care-autopay/clients/${clientId}`, { method: 'DELETE' })).status).toBe(404)
  })
})


// ── Long-term care insurance: the payer type, the policy and the claim packet ─────────────────────────────────────────────
describe('long-term care insurance billing', () => {
  let ltcClient = '', ltcPayer = '', ltcInvoice = '', plainInvoice = ''
  /** The text of an (uncompressed) pdfkit page: each TJ's hex pieces, joined and decoded, one string per line of text. */
  const pdfLines = (pdf: Buffer) => [...pdf.toString('latin1').matchAll(/\[(.*?)\] TJ/g)].map((m) => [...m[1]!.matchAll(/<([0-9a-f]*)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1')).join(''))

  test('off (refused) without care_ltc_billing: the routes, and the payer type itself', async () => {
    expect((await json(await as('owner')('/api/care-ltc/invoices'))).body.code).toBe('FEATURE_NOT_ENABLED')
    const r = await json(await as('owner')('/api/payers', { method: 'POST', json: { name: 'Acme Life', payerType: 'ltc_insurance' } }))
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('FEATURE_NOT_ENABLED')
  })

  test('with the feature on: the payer type is accepted, and a caregiver seat is refused everywhere', async () => {
    await setFeatures(['contacts', 'scheduling', 'team', 'online_payments', 'care_autopay', 'care_ltc_billing'])
    const r = await json(await as('owner')('/api/payers', { method: 'POST', json: { name: 'Acme Life', payerType: 'ltc_insurance', address: '1 Main St', city: 'Madison', state: 'WI', zip: '53703', payerIdNumber: 'ACME-77' } }))
    expect(r.status).toBe(201)
    ltcPayer = r.body.id
    expect([r.body.payerType, r.body.type]).toEqual(['ltc_insurance', 'insurance'])
    for (const [method, path] of [['GET', '/api/care-ltc/invoices'], ['GET', `/api/care-ltc/clients/${clientId}/policy`], ['PUT', `/api/care-ltc/clients/${clientId}/policy`], ['GET', '/api/care-ltc/invoices/x/claim-packet']]) {
      expect((await as('ann')(path, { method })).status).toBe(403)
    }
  })

  test('the policy is saved per client; a bad daily maximum and another agency\'s client are refused', async () => {
    ltcClient = (await ins(t.schema.clients, { companyId, firstName: 'Lena', lastName: 'Long', email: 'lena@family.example', isActive: true, referredById: ltcPayer, dateOfBirth: '1940-02-03', address: '9 Elm St', city: 'Eau Claire', state: 'WI', zip: '54701' })).id
    const bad = await json(await as('owner')(`/api/care-ltc/clients/${ltcClient}/policy`, { method: 'PUT', json: { dailyMax: -5 } }))
    expect(bad.status).toBe(400)
    expect((await json(await as('owner')('/api/care-ltc/clients/not-a-client/policy', { method: 'PUT', json: { policyNumber: 'X' } }))).status).toBe(404)
    const ok = await json(await as('owner')(`/api/care-ltc/clients/${ltcClient}/policy`, { method: 'PUT', json: { policyNumber: 'LTC-123', claimNumber: 'CLM-9', dailyMax: 150, insuredName: 'Lena M. Long' } }))
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ policyNumber: 'LTC-123', claimNumber: 'CLM-9', dailyMax: 150, insuredName: 'Lena M. Long' })
  })

  test('the packet: cover sheet with insurer, policy and claim; every service with caregiver and time; the day over the daily maximum is marked', async () => {
    const cg = (await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'ann@test.example')))[0] as any
    const [inv] = await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-LTC-1', clientId: ltcClient, referralSourceId: ltcPayer, invoiceType: 'insurance', billingPeriodStart: '2026-10-01', billingPeriodEnd: '2026-10-14', subtotal: '380', total: '380', paymentStatus: 'pending', paymentDueDate: '2026-11-20' } as any).returning()
    ltcInvoice = inv.id
    const line = (date: string, start: string, end: string, hours: string, amount: string) => t.db.insert(t.schema.invoiceLineItems).values({ companyId, invoiceId: inv.id, caregiverId: cg.id, description: 'Personal care', serviceDate: date, hours, rate: '40.00', rateType: 'hourly', amount, startTime: start, endTime: end } as any)
    await line('2026-10-05', '09:00', '13:00', '4.00', '160.00')
    await line('2026-10-05', '15:00', '17:00', '2.00', '80.00') // that day: $240, $90 over the $150 maximum
    await line('2026-10-06', '09:00', '12:00', '3.00', '120.00')
    const draft = await json(await as('owner')(`/api/care-ltc/invoices/${inv.id}/claim-packet`))
    expect([draft.status, draft.body.code]).toEqual([400, 'draft'])
    await release(inv.id)
    const res = await as('owner')(`/api/care-ltc/invoices/${inv.id}/claim-packet`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('claim-packet-invoice-')
    const pdf = Buffer.from(await res.arrayBuffer())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    // The text is compressed in the PDF; read it back from the pure pieces instead of the bytes.
    const { dayTotals } = await import('../server/crm/homecare/core/ltc.ts')
    expect(dayTotals([{ serviceDate: '2026-10-05', amount: '160.00' }, { serviceDate: '2026-10-05', amount: '80.00' }, { serviceDate: '2026-10-06', amount: '120.00' }], 150))
      .toEqual([{ date: '2026-10-05', total: 240, over: 90 }, { date: '2026-10-06', total: 120, over: 0 }])
    expect(dayTotals([{ serviceDate: '2026-10-05', amount: '999' }], null)[0]!.over).toBe(0)
    // Nothing on the invoice was changed to make it.
    const after = await row(inv.id)
    expect([after.total, after.paymentStatus]).toEqual(['380.00', 'pending'])
    const lines = pdfLines(pdf)
    const has = (needle: string) => expect(lines.some((l) => l.includes(needle))).toBe(true)
    for (const needle of ['Test Builders', 'Long-term care insurance', 'Acme Life', 'ACME-77', 'Lena M. Long', '02/03/1940', 'LTC-123', 'CLM-9', '$150.00', '10/01/2026', '$380.00', 'Services provided', 'Personal care', 'Ann Carer', '9:00 AM', '$160.00']) has(needle)
    has("is $90.00 over the policy's daily maximum of $150.00")
    expect(lines.filter((l) => l.includes('over the policy')).length).toBe(1) // 10/06 is under the maximum
    has('Charges above the daily maximum')
  })

  test('a packet needs a policy number and an LTC payer', async () => {
    await t.db.update(t.schema.clientLtcPolicy).set({ policyNumber: null } as any).where(eq(t.schema.clientLtcPolicy.clientId, ltcClient))
    const none = await json(await as('owner')(`/api/care-ltc/invoices/${ltcInvoice}/claim-packet`))
    expect([none.status, none.body.code]).toEqual([400, 'no_policy'])
    const plain = await invoice(10, { sentAt: new Date() })
    plainInvoice = plain.id
    const notLtc = await json(await as('owner')(`/api/care-ltc/invoices/${plainInvoice}/claim-packet`))
    expect([notLtc.status, notLtc.body.code]).toEqual([400, 'not_ltc'])
    expect((await json(await as('owner')('/api/care-ltc/invoices/missing/claim-packet'))).status).toBe(404)
  })

  test('the list shows invoices billed to an LTC payer and whether the policy is on file', async () => {
    const list = (await json(await as('owner')('/api/care-ltc/invoices'))).body
    const mine = (Array.isArray(list) ? list : list.data).find((i: any) => i.id === ltcInvoice)
    expect(mine).toMatchObject({ payerName: 'Acme Life', hasPolicy: true })
    expect((Array.isArray(list) ? list : list.data).some((i: any) => i.id === plainInvoice)).toBe(false)
  })
})
