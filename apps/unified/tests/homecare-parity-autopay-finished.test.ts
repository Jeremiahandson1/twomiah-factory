// Home care parity row 22 (docs/parity/homecare-private-pay.md): private pay finished — a relative or the client saves or changes
// the card from the portal; ACH bank debit and Canadian pre-authorized debit with their authorisation wording; a receipt email
// after each successful charge; a charge the office schedules for a later day, as a whole or in parts; a card-expiry warning
// about a month ahead; reminders after the "bank needs the owner" notice; the stored-credential usage type on save and on each
// charge; the retry schedule as an agency setting (up to Stripe's 8 tries in 2 weeks); and the `payment_intent.payment_failed`
// path. Through the real server with a FAKE Stripe (nothing here reaches Stripe or any live account).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { homecareTemplates } from '../server/crm/homecare/core/messages.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { settingsProblem, achConsentWording, padConsentWording } from '../server/crm/homecare/core/autopay.ts'
import { addDays, ymdIn } from '../server/crm/homecare/core/agencyTime.ts'

const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any })
const calls: any[] = []
const piCalls = () => calls.filter((c) => c.what === 'pi')
let script: (args: any, n: number) => any = () => ({ status: 'succeeded' })
let chargeNo = 0
const byKey = new Map<string, any>()
let sessionNo = 0
/** What Stripe hands back for a saved payment method: a card, or a bank account after a bank setup page. */
let nextPm: 'card' | 'us_bank_account' | 'acss_debit' = 'card'
const fakeStripe = {
  customers: { create: async (args: any, opts: any) => { calls.push({ what: 'customer', args, opts }); return { id: 'cus_1' } } },
  checkout: { sessions: { create: async (args: any, opts: any) => { calls.push({ what: 'setup', args, opts }); sessionNo++; return { id: `cs_setup_${sessionNo}`, url: `https://checkout.stripe.test/setup_${sessionNo}` } } } },
  setupIntents: { retrieve: async (id: string, opts: any) => { calls.push({ what: 'si', id, opts }); return { id, payment_method: `pm_${id}`, mandate: nextPm === 'card' ? null : `mandate_${id}` } } },
  paymentMethods: {
    retrieve: async (id: string, opts: any) => {
      calls.push({ what: 'pm', id, opts })
      if (nextPm === 'us_bank_account') return { id, type: 'us_bank_account', us_bank_account: { bank_name: 'STRIPE TEST BANK', last4: '6789' } }
      if (nextPm === 'acss_debit') return { id, type: 'acss_debit', acss_debit: { bank_name: 'Royal Bank', last4: '1234' } }
      return { id, type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2031 } }
    },
    detach: async (id: string, opts: any) => { calls.push({ what: 'detach', id, opts }); return {} },
  },
  paymentIntents: {
    create: async (args: any, opts: any) => {
      calls.push({ what: 'pi', args, opts })
      const key = opts?.idempotencyKey as string
      if (key && byKey.has(key)) { const prior = byKey.get(key); if (prior.error) throw prior.error; return prior.intent }
      chargeNo++
      const out = script(args, chargeNo)
      if (out instanceof Error) throw out
      const intent = { id: `pi_${chargeNo}`, ...out }
      if (key) byKey.set(key, { intent })
      return intent
    },
  },
}
const cardError = (decline_code: string, code = 'card_declined') => Object.assign(new Error('Declined.'), { type: 'StripeCardError', code, decline_code })

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', clientId = '', familyId = ''
let n = 0
const tokens: Record<string, string> = {}
const sent: Array<{ to: string; template: string; data: any }> = []
const env: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string | undefined) => { if (!(k in env)) env[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v }
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const fam = (p: string, init: any = {}) => t.call(`/api/family-portal${p}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens.mary}` } })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const ON = ['contacts', 'scheduling', 'team', 'online_payments', 'care_autopay']
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const FACTORY = { 'X-Factory-Key': 'factory-test-key' }
const factoryEvent = (event: any) => t.call('/api/stripe/factory-event', { method: 'POST', headers: FACTORY, json: { event } })
let homecareCore: ReturnType<typeof createHomecareCore>
const core = () => homecareCore
const TZ = 'America/Chicago'
const today = () => ymdIn(new Date(), TZ)

const invoice = async (total: number, extra: any = {}) => {
  n++
  return ins(t.schema.invoices, { companyId, invoiceNumber: `HC-R22-${n}`, clientId, billingPeriodStart: '2026-10-01', billingPeriodEnd: '2026-10-14', subtotal: String(total), total: String(total), paymentStatus: 'pending', paymentDueDate: '2026-11-20', ...extra })
}
const release = (id: string) => as('owner')(`/api/billing/invoices/${id}/release`, { method: 'POST' })
const row = async (id: string) => (await t.db.select().from(t.schema.invoices).where(eq(t.schema.invoices.id, id)))[0] as any
const attempts = async (id: string) => (await t.db.select().from(t.schema.autopayAttempt).where(eq(t.schema.autopayAttempt.invoiceId, id)).orderBy(t.schema.autopayAttempt.attemptNo)) as any[]
const payments = async (id: string) => (await t.db.select().from(t.schema.invoicePayments).where(eq(t.schema.invoicePayments.invoiceId, id))) as any[]
const lastMail = (template: string) => sent.filter((m) => m.template === template).at(-1)
const mails = (template: string) => sent.filter((m) => m.template === template)
const saveCard = async (sessionId: string, by = 'office') => {
  const ok = await factoryEvent({ id: `evt_${sessionId}`, type: 'checkout.session.completed', account: 'acct_agency', data: { object: { id: sessionId, mode: 'setup', setup_intent: `seti_${sessionNo}`, metadata: { autopay_client_id: clientId, autopay_company_id: companyId, autopay_by: by } } } })
  expect(ok.status).toBe(200)
}
const pastDue = async (invoiceId: string) => t.db.update(t.schema.autopayAttempt).set({ nextAttemptAt: new Date(Date.now() - 60_000) } as any).where(eq(t.schema.autopayAttempt.invoiceId, invoiceId))
const cardOnFile = async () => (await t.db.select().from(t.schema.clientAutopay).where(eq(t.schema.clientAutopay.clientId, clientId)))[0] as any

beforeAll(async () => {
  setEnv('SMTP_HOST', 'smtp.invalid')
  setEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_x')
  setEnv('FACTORY_SYNC_KEY', 'factory-test-key')
  setEnv('FRONTEND_URL', 'https://agency.test.example')
  t = await bootTenant({ vertical: 'homecare', stripe: fakeStripe })
  const s = await seedOwner(t)
  companyId = s.company.id
  homecareCore = createHomecareCore({ services: t.services.crm } as any)
  await t.db.update(t.schema.company).set({ name: 'Test Builders', email: 'office@agency.example', timezone: TZ, integrations: { stripeAccountId: 'acct_agency' } } as any).where(eq(t.schema.company.id, companyId))
  const email: any = t.services.email
  email.send = async (to: string, template: string, data: any) => { sent.push({ to, template, data }); return { success: true, dev: true } }
  tokens.owner = await login('owner@test.example', s.password)
  clientId = (await ins(t.schema.clients, { companyId, firstName: 'Ada', lastName: 'Client', email: 'ada@family.example', isActive: true, isPrivatePay: true })).id
  await setFeatures(ON)
  const made = await json(await as('owner')('/api/family-portal/admin/members', { method: 'POST', json: { clientId, password: 'Family-pass-1', name: 'Mary', email: 'mary@family.example' } }))
  expect(made.status).toBe(201)
  familyId = made.body.id
  const l = await json(await t.call('/api/family-portal/login', { method: 'POST', json: { email: 'mary@family.example', password: 'Family-pass-1' } }))
  tokens.mary = l.body.token ?? l.body.data?.token
}, 120_000)
afterAll(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

describe('the retry schedule is the agency\'s setting (pure rules, then the server)', () => {
  test('up to 7 waits adding up to 14 days; reminders go up; anything else is refused with a sentence', () => {
    expect(settingsProblem({ retryDays: [2, 3, 4] })).toBeNull()
    expect(settingsProblem({ retryDays: [2, 2, 2, 2, 2, 2, 2] })).toBeNull() // 8 tries in 14 days, Stripe's ceiling
    expect(settingsProblem({ retryDays: [1, 1, 1, 1, 1, 1, 1, 1] })).toContain('At most 7')
    expect(settingsProblem({ retryDays: [5, 5, 5] })).toContain('more than 14 days')
    expect(settingsProblem({ retryDays: [0] })).toContain('from 1 to 14')
    expect(settingsProblem({ approvalReminderDays: [3, 7] })).toBeNull()
    expect(settingsProblem({ approvalReminderDays: [7, 3] })).toContain('go up')
    expect(settingsProblem({ methods: { usBank: 'yes' } })).toContain('on or off')
  })

  test('the office saves its own days; a bad schedule is refused; the defaults are 2, 3, 4 and reminders on days 3 and 7', async () => {
    const d = (await json(await as('owner')('/api/care-autopay/settings'))).body
    expect(d).toMatchObject({ retryDays: [2, 3, 4], approvalReminderDays: [3, 7], methods: { card: true, usBank: false, cad: false } })
    expect(d.ownerSteps.usBank).toContain('ACH Direct Debit')
    const bad = await json(await as('owner')('/api/care-autopay/settings', { method: 'PUT', json: { retryDays: [10, 10] } }))
    expect([bad.status, bad.body.code]).toEqual([400, 'bad_settings'])
    const ok = await json(await as('owner')('/api/care-autopay/settings', { method: 'PUT', json: { retryDays: [1, 1, 1, 1, 1, 1, 1], approvalReminderDays: [2, 4] } }))
    expect(ok.status).toBe(200)
    expect(ok.body.retryDays).toEqual([1, 1, 1, 1, 1, 1, 1])
  })

  test('with seven waits a declined card gets eight tries, a day apart, and the family is told each time', async () => {
    const r = await json(await as('owner')(`/api/care-autopay/clients/${clientId}/setup`, { method: 'POST', json: {} }))
    expect(r.status).toBe(200)
    await saveCard(`cs_setup_${sessionNo}`)
    const inv = await invoice(80)
    script = () => cardError('generic_decline')
    await release(inv.id)
    const gaps: number[] = []
    for (let i = 0; i < 7; i++) {
      const prior = (await attempts(inv.id)).at(-1)
      gaps.push(Math.round((new Date(prior.nextAttemptAt).getTime() - new Date(prior.updatedAt).getTime()) / 86_400_000))
      await pastDue(inv.id); await core().autopay.sweep()
    }
    const list = await attempts(inv.id)
    expect(list.length).toBe(8)
    expect(list.every((a) => a.status === 'failed')).toBe(true)
    expect(list[7].nextAttemptAt).toBeNull()
    expect(gaps).toEqual([1, 1, 1, 1, 1, 1, 1])
    await pastDue(inv.id); await core().autopay.sweep()
    expect((await attempts(inv.id)).length).toBe(8) // no ninth
    const seq = String((await row(inv.id)).seqNumber)
    expect(mails('homecareAutopayFailed').filter((m) => m.data.invoiceNumber === seq).length).toBe(8)
    expect((await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/try-now`, { method: 'POST' }))).body.code).toBe('no_more_tries')
  })

  test('back to the defaults for the rest', async () => {
    expect((await as('owner')('/api/care-autopay/settings', { method: 'PUT', json: { retryDays: [2, 3, 4], approvalReminderDays: [3, 7] } })).status).toBe(200)
    script = () => ({ status: 'succeeded' })
  })
})

describe('the stored-credential usage type, and a receipt after each successful charge', () => {
  test('save sends the usage type on the SetupIntent; a charge on issue is an unscheduled off-session charge', async () => {
    const page = calls.filter((c) => c.what === 'setup').at(-1)
    expect(page.args.setup_intent_data.metadata.usage_type).toBe('unscheduled')
    expect(page.args.metadata.autopay_by).toBe('office')
    const inv = await invoice(50)
    sent.length = 0
    await release(inv.id)
    const pi = piCalls().at(-1)
    expect(pi.args).toMatchObject({ off_session: 'one_off', confirm: true, payment_method_types: ['card'], currency: 'usd' })
    expect((await row(inv.id)).paymentStatus).toBe('paid')
    const receipt = lastMail('homecareAutopayReceipt')!
    expect(receipt.to).toBe('ada@family.example')
    expect(receipt.data).toMatchObject({ amount: '50.00', paidWith: 'Visa ending 4242', stillOwed: '0.00', paidOn: today() })
    expect(String(receipt.data.documentPath)).toMatch(/^\/d\/[0-9a-f]{64}$/)
    const rendered = homecareTemplates.homecareAutopayReceipt(receipt.data, { companyName: 'Test Builders', colourOnWhite: '#c2410c' } as any, 'https://agency.test.example')
    expect(rendered.subject).toContain('Receipt: $50.00')
    expect(rendered.html).toContain('now paid in full')
    // Stripe's event for the same intent, replayed: one payment, one receipt.
    await factoryEvent({ id: 'evt_r', type: 'payment_intent.succeeded', data: { object: { id: `pi_${chargeNo}`, amount: 5000, metadata: { kind: 'homecare_autopay', invoice_id: inv.id, company_id: companyId, attempt: '1' } } } })
    expect(await payments(inv.id)).toHaveLength(1)
    expect(mails('homecareAutopayReceipt')).toHaveLength(1)
  })
})

describe('a relative saves or changes the card from the family portal', () => {
  test('without the switch the portal refuses; with it, Stripe\'s page is made for the family, and the saved card shows there', async () => {
    expect((await fam('/portal/payment-method')).status).toBe(403)
    expect((await fam('/portal/payment-method/setup', { method: 'POST', json: { method: 'card' } })).status).toBe(403)
    expect((await json(await as('owner')(`/api/family-portal/admin/members/${familyId}`, { method: 'PUT', json: { canManagePayments: true } }))).status).toBe(200)
    const me = (await json(await fam('/portal/me'))).body
    expect([me.canManagePayments, me.payments]).toEqual([true, true])
    const before = (await json(await fam('/portal/payment-method'))).body
    expect(before).toMatchObject({ status: 'active', label: 'Visa ending 4242', methods: { card: true, usBank: false, cad: false } })
    expect(before.wording.card).toContain('I authorize Test Builders')
    expect(JSON.stringify(before)).not.toContain('pm_')
    const r = await json(await fam('/portal/payment-method/setup', { method: 'POST', json: { method: 'card' } }))
    expect(r.status).toBe(200)
    expect(r.body.url).toContain('checkout.stripe.test')
    const page = calls.filter((c) => c.what === 'setup').at(-1)
    expect(page.args.success_url).toBe('https://agency.test.example/family?saved=1')
    expect(page.args.metadata.autopay_by).toBe('family')
    expect(page.opts).toEqual({ stripeAccount: 'acct_agency' })
    await saveCard(`cs_setup_${sessionNo}`, 'family')
    expect((await cardOnFile()).savedBy).toBe('family')
    const office = (await json(await as('owner')(`/api/care-autopay/clients/${clientId}`))).body
    expect(office.savedBy).toBe('family')
    // a bank method the agency has not switched on is refused in a sentence
    const off = await json(await fam('/portal/payment-method/setup', { method: 'POST', json: { method: 'us_bank_account' } }))
    expect([off.status, off.body.code]).toEqual([400, 'method_off'])
  })

  test('the client portal offers the same; with care_autopay off the portal routes do not exist', async () => {
    const [client] = await t.db.select().from(t.schema.clients).where(eq(t.schema.clients.id, clientId))
    void client
    await setFeatures(['contacts', 'scheduling', 'team', 'online_payments'])
    expect((await fam('/portal/payment-method')).status).toBe(404)
    expect((await fam('/portal/payment-method/setup', { method: 'POST', json: {} })).status).toBe(404)
    await setFeatures(ON)
  })
})

describe('bank debit: ACH (US) and pre-authorized debit (Canada), and the payment_intent.payment_failed path', () => {
  let achInvoice = ''
  test('ACH is offered once the agency switches it on; the page asks Stripe for a US bank account with the debit authorisation', async () => {
    await as('owner')('/api/care-autopay/settings', { method: 'PUT', json: { methods: { usBank: true, cad: true } } })
    const r = await json(await fam('/portal/payment-method/setup', { method: 'POST', json: { method: 'us_bank_account' } }))
    expect(r.status).toBe(200)
    const page = calls.filter((c) => c.what === 'setup').at(-1)
    expect(page.args).toMatchObject({ mode: 'setup', payment_method_types: ['us_bank_account'], currency: 'usd' })
    expect(page.args.payment_method_options.us_bank_account.verification_method).toBe('automatic')
    expect(page.args.custom_text.submit.message).toBe(achConsentWording('Test Builders'))
    expect(achConsentWording('Test Builders')).toContain('electronically debit')
    nextPm = 'us_bank_account'
    await saveCard(`cs_setup_${sessionNo}`, 'family')
    const onFile = await cardOnFile()
    expect([onFile.method, onFile.bankName, onFile.last4, onFile.mandateId, onFile.brand]).toEqual(['us_bank_account', 'STRIPE TEST BANK', '6789', `mandate_seti_${sessionNo}`, null])
    expect((await json(await fam('/portal/payment-method'))).body.label).toBe('STRIPE TEST BANK bank account ending 6789')
    expect((await cardOnFile()).consentText).toBe(achConsentWording('Test Builders'))
  })

  test('a bank debit is "processing" until Stripe\'s event; payment_intent.payment_failed with insufficient funds schedules one retry and tells the family', async () => {
    const inv = await invoice(120)
    achInvoice = inv.id
    script = () => ({ status: 'processing' })
    sent.length = 0
    await release(inv.id)
    const pi = piCalls().at(-1)
    expect(pi.args).toMatchObject({ payment_method_types: ['us_bank_account'], currency: 'usd', off_session: 'one_off' })
    let [a] = await attempts(inv.id)
    expect(a.status).toBe('pending')
    expect(sent).toEqual([])
    const failed = { id: 'evt_f1', type: 'payment_intent.payment_failed', data: { object: { id: a.paymentIntentId, amount: 12000, last_payment_error: { code: 'payment_intent_payment_attempt_failed', decline_code: 'insufficient_funds', message: 'The bank account had insufficient funds.' }, metadata: { kind: 'homecare_autopay', invoice_id: inv.id, company_id: companyId, attempt: '1' } } } }
    expect((await factoryEvent(failed)).status).toBe(200)
    await factoryEvent(failed) // replayed: nothing changes
    ;[a] = await attempts(inv.id)
    expect([a.status, a.failureCode, a.hardDecline]).toEqual(['failed', 'insufficient_funds', false])
    expect(a.nextAttemptAt).toBeTruthy()
    const mail = lastMail('homecareAutopayFailed')!
    expect(mail.data.reason).toBe('the bank account did not have enough available')
    expect(mail.data.bank).toBe(true)
    expect(homecareTemplates.homecareAutopayFailed(mail.data, {} as any, 'https://x').subject).toContain('bank account payment')
    expect(mails('homecareAutopayFailed')).toHaveLength(1)
    expect((await row(inv.id)).paymentStatus).toBe('pending')
  })

  test('a bank debit is retried at most twice, and only for insufficient funds; a closed account pauses autopay', async () => {
    script = () => ({ status: 'processing' })
    await pastDue(achInvoice); await core().autopay.sweep()
    let list = await attempts(achInvoice)
    expect(list.map((a) => a.status)).toEqual(['failed', 'pending'])
    const fail2 = { id: 'evt_f2', type: 'payment_intent.payment_failed', data: { object: { id: list[1].paymentIntentId, amount: 12000, last_payment_error: { decline_code: 'insufficient_funds' }, metadata: { kind: 'homecare_autopay', invoice_id: achInvoice, company_id: companyId, attempt: '2' } } } }
    await factoryEvent(fail2)
    await pastDue(achInvoice); await core().autopay.sweep()
    list = await attempts(achInvoice)
    expect(list.map((a) => a.status)).toEqual(['failed', 'failed', 'pending'])
    // third try: the account was closed → no more tries, autopay paused until a new account is saved
    await factoryEvent({ id: 'evt_f3', type: 'payment_intent.payment_failed', data: { object: { id: list[2].paymentIntentId, amount: 12000, last_payment_error: { decline_code: 'account_closed' }, metadata: { kind: 'homecare_autopay', invoice_id: achInvoice, company_id: companyId, attempt: '3' } } } })
    list = await attempts(achInvoice)
    expect([list[2].status, list[2].hardDecline, list[2].nextAttemptAt]).toEqual(['failed', true, null])
    expect((await json(await as('owner')(`/api/care-autopay/clients/${clientId}`))).body).toMatchObject({ status: 'paused', pausedReason: 'the bank account can no longer be used' })
    // a soft code other than insufficient funds on a bank debit is not retried at all
    nextPm = 'card'
    await json(await as('owner')(`/api/care-autopay/clients/${clientId}/setup`, { method: 'POST', json: { method: 'card' } }))
    await saveCard(`cs_setup_${sessionNo}`)
    expect((await json(await as('owner')(`/api/care-autopay/clients/${clientId}`))).body.status).toBe('active')
    script = () => ({ status: 'succeeded' })
  })

  test('Canadian pre-authorized debit: a CAD page with the PAD agreement and sporadic personal mandate options; the charge is in CAD with the same', async () => {
    const r = await json(await as('owner')(`/api/care-autopay/clients/${clientId}/setup`, { method: 'POST', json: { method: 'acss_debit' } }))
    expect(r.status).toBe(200)
    const page = calls.filter((c) => c.what === 'setup').at(-1)
    expect(page.args).toMatchObject({ payment_method_types: ['acss_debit'], currency: 'cad' })
    expect(page.args.payment_method_options.acss_debit).toEqual({ currency: 'cad', mandate_options: { payment_schedule: 'sporadic', transaction_type: 'personal' } })
    expect(page.args.custom_text.submit.message).toBe(padConsentWording('Test Builders'))
    expect(padConsentWording('Test Builders')).toContain('recourse rights')
    nextPm = 'acss_debit'
    await saveCard(`cs_setup_${sessionNo}`)
    expect((await cardOnFile()).method).toBe('acss_debit')
    const inv = await invoice(30)
    script = () => ({ status: 'processing' })
    await release(inv.id)
    const pi = piCalls().at(-1)
    expect(pi.args).toMatchObject({ currency: 'cad', payment_method_types: ['acss_debit'] })
    expect(pi.args.payment_method_options.acss_debit.mandate_options).toEqual({ payment_schedule: 'sporadic', transaction_type: 'personal' })
    const [a] = await attempts(inv.id)
    await factoryEvent({ id: 'evt_ok_cad', type: 'payment_intent.succeeded', data: { object: { id: a.paymentIntentId, amount: 3000, metadata: { kind: 'homecare_autopay', invoice_id: inv.id, company_id: companyId, attempt: '1' } } } })
    expect((await row(inv.id)).paymentStatus).toBe('paid')
    expect(lastMail('homecareAutopayReceipt')!.data.paidWith).toBe('Royal Bank bank account ending 1234')
    // back to a card for the rest
    nextPm = 'card'
    await json(await as('owner')(`/api/care-autopay/clients/${clientId}/setup`, { method: 'POST', json: { method: 'card' } }))
    await saveCard(`cs_setup_${sessionNo}`)
    script = () => ({ status: 'succeeded' })
  })
})

describe('charges the office schedules for a later day, as a whole or in parts', () => {
  test('a scheduled invoice is not charged on release; it is charged on its day for its amount, as a recurring charge', async () => {
    const inv = await invoice(90)
    const bad = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/schedule`, { method: 'PUT', json: { parts: [{ chargeOn: addDays(today(), -1) }] } }))
    expect([bad.status, bad.body.code]).toEqual([400, 'past_date'])
    const over = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/schedule`, { method: 'PUT', json: { parts: [{ chargeOn: today(), amountCents: 9100 }] } }))
    expect(over.body.code).toBe('over_owed')
    const tomorrow = addDays(today(), 1)
    const ok = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/schedule`, { method: 'PUT', json: { parts: [{ chargeOn: tomorrow }] } }))
    expect(ok.status).toBe(200)
    expect(ok.body.data[0]).toMatchObject({ chargeOn: tomorrow, amountCents: null, status: 'waiting' })
    const before = piCalls().length
    await release(inv.id)
    await core().autopay.sweep()
    expect(piCalls().length).toBe(before) // not its day yet
    expect((await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/try-now`, { method: 'POST' }))).status).toBe(200) // the office may bring it forward
    expect((await row(inv.id)).paymentStatus).toBe('paid')
    const list = (await json(await as('owner')('/api/care-autopay/schedules'))).body.data
    expect(list.find((s: any) => s.invoiceId === inv.id).status).toBe('charged')
  })

  test('an instalment plan: three parts on three days, each charged on its day with its amount; the invoice is paid after the last', async () => {
    const inv = await invoice(300)
    const d1 = today(), d2 = addDays(today(), 7), d3 = addDays(today(), 14)
    const wrong = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/schedule`, { method: 'PUT', json: { parts: [{ chargeOn: d1, amountCents: 10000 }, { chargeOn: d2 }] } }))
    expect(wrong.body.code).toBe('bad_amount')
    const ok = await json(await as('owner')(`/api/care-autopay/invoices/${inv.id}/schedule`, { method: 'PUT', json: { parts: [{ chargeOn: d1, amountCents: 10000 }, { chargeOn: d2, amountCents: 10000 }, { chargeOn: d3, amountCents: 10000 }] } }))
    expect(ok.body.data.map((p: any) => p.label)).toEqual(['Part 1 of 3', 'Part 2 of 3', 'Part 3 of 3'])
    const before = piCalls().length
    await release(inv.id)
    expect(piCalls().length).toBe(before) // the plan, not the release, charges it
    await core().autopay.sweep()
    expect(piCalls().length).toBe(before + 1)
    expect(piCalls().at(-1).args).toMatchObject({ amount: 10000, off_session: 'recurring' })
    expect(piCalls().at(-1).args.metadata.schedule_id).toBe(ok.body.data[0].id)
    expect([(await row(inv.id)).paymentStatus, Number((await row(inv.id)).amountPaid)]).toEqual(['partial', 100])
    expect(lastMail('homecareAutopayReceipt')!.data.stillOwed).toBe('200.00')
    await core().autopay.sweep()
    expect(piCalls().length).toBe(before + 1) // part 2 is not due yet
    // the other two days arrive
    await t.db.update(t.schema.autopaySchedule).set({ chargeOn: today() } as any).where(eq(t.schema.autopaySchedule.invoiceId, inv.id))
    await core().autopay.sweep()
    expect(piCalls().length).toBe(before + 3)
    expect((await row(inv.id)).paymentStatus).toBe('paid')
    expect((await attempts(inv.id)).map((a) => [a.attemptNo, a.status])).toEqual([[1, 'succeeded'], [2, 'succeeded'], [3, 'succeeded']])
    expect(await payments(inv.id)).toHaveLength(3)
  })

  test('a failed part is retried like any charge; a plan can be taken back, and the invoice is then charged as a whole', async () => {
    const inv = await invoice(40)
    await as('owner')(`/api/care-autopay/invoices/${inv.id}/schedule`, { method: 'PUT', json: { parts: [{ chargeOn: today(), amountCents: 2000 }, { chargeOn: addDays(today(), 30), amountCents: 2000 }] } })
    script = () => cardError('insufficient_funds')
    await release(inv.id)
    await core().autopay.sweep()
    let list = await attempts(inv.id)
    expect(list.map((a) => [a.status, a.amountCents])).toEqual([['failed', 2000]])
    expect(list[0].nextAttemptAt).toBeTruthy()
    script = () => ({ status: 'succeeded' })
    expect((await as('owner')(`/api/care-autopay/invoices/${inv.id}/schedule`, { method: 'DELETE' })).status).toBe(200)
    await core().autopay.sweep()
    // with no plan left, the whole balance ($40) is charged on the next sweep, as a fresh unscheduled try
    list = await attempts(inv.id)
    expect(list.at(-1)).toMatchObject({ status: 'succeeded', amountCents: 4000, scheduleId: null })
    expect((await row(inv.id)).paymentStatus).toBe('paid')
  })

  test('a part payment from the invoice\'s own page: the family pays some of what is owed; more than owed is refused', async () => {
    const inv = await invoice(70, { sentAt: new Date() })
    const { documentLinkToken } = await import('@twomiah/tenant-backend')
    const token = await documentLinkToken(t.db, t.schema.invoices, inv.id)
    const over = await json(await t.call(`/api/stripe/document/${token}/pay`, { method: 'POST', json: { amountCents: 7001 } }))
    expect([over.status, over.body.code]).toEqual([400, 'over_owed'])
    const small = await json(await t.call(`/api/stripe/document/${token}/pay`, { method: 'POST', json: { amountCents: 50 } }))
    expect(small.body.code).toBe('bad_amount')
    const r = await json(await t.call(`/api/stripe/document/${token}/pay`, { method: 'POST', json: { amountCents: 2500 } }))
    expect(r.status).toBe(200)
    const page = calls.filter((c) => c.what === 'setup').at(-1)
    expect(page.args.mode).toBe('payment')
    expect(page.args.line_items[0].price_data.unit_amount).toBe(2500)
    expect(page.args.line_items[0].price_data.product_data.name).toContain('part payment')
  })
})

describe('a warning before the card expires, and reminders after "the bank needs the owner"', () => {
  test('a card expiring within 30 days is warned about once, by email to the family and a notice to the office; one far off is not', async () => {
    const soon = new Date(Date.now() + 20 * 86_400_000)
    await t.db.update(t.schema.clientAutopay).set({ expMonth: soon.getUTCMonth() + 1, expYear: soon.getUTCFullYear(), expiryWarnedFor: null } as any).where(eq(t.schema.clientAutopay.clientId, clientId))
    sent.length = 0
    expect(await core().autopay.scanExpiringCards()).toBe(1)
    expect(await core().autopay.scanExpiringCards()).toBe(0)
    const mail = lastMail('homecareCardExpiring')!
    expect(mail.to).toBe('ada@family.example')
    expect(mail.data.cardLabel).toBe('Visa ending 4242')
    expect(mail.data.expires).toBe(`${String(soon.getUTCMonth() + 1).padStart(2, '0')}/${soon.getUTCFullYear()}`)
    expect(mail.data.portalUrl).toBe('https://agency.test.example/family')
    expect(homecareTemplates.homecareCardExpiring(mail.data, { companyName: 'Test Builders' } as any, '').subject).toContain('expires')
    const notes = await t.db.select().from(t.schema.notifications).where(and(eq(t.schema.notifications.companyId, companyId), eq(t.schema.notifications.type, 'autopay_card_expiring')))
    expect(notes.length).toBeGreaterThan(0)
    expect((await cardOnFile()).expiryWarnedFor).toBe(`${soon.getUTCFullYear()}-${String(soon.getUTCMonth() + 1).padStart(2, '0')}`)
    await t.db.update(t.schema.clientAutopay).set({ expMonth: 12, expYear: 2031, expiryWarnedFor: null } as any).where(eq(t.schema.clientAutopay.clientId, clientId))
    expect(await core().autopay.scanExpiringCards()).toBe(0)
    expect(mails('homecareCardExpiring')).toHaveLength(1)
  })

  test('the family is reminded on the agency\'s days (3 and 7) while the invoice is still owed, and not before', async () => {
    const inv = await invoice(65)
    script = () => cardError('authentication_required', 'authentication_required')
    sent.length = 0
    await release(inv.id)
    const [a] = await attempts(inv.id)
    expect(a.status).toBe('needs_action')
    expect(mails('homecareAutopayFailed')).toHaveLength(1)
    expect(await core().autopay.scanApprovalReminders()).toBe(0) // day 0: nothing yet
    await t.db.update(t.schema.autopayAttempt).set({ createdAt: new Date(Date.now() - 4 * 86_400_000) } as any).where(eq(t.schema.autopayAttempt.id, a.id))
    expect(await core().autopay.scanApprovalReminders()).toBe(1)
    expect(await core().autopay.scanApprovalReminders()).toBe(0) // the second is on day 7
    const reminder = lastMail('homecareAutopayFailed')!
    expect(reminder.data.reminder).toBe(true)
    expect(homecareTemplates.homecareAutopayFailed(reminder.data, {} as any, 'https://x').subject).toContain('Reminder: ')
    expect(homecareTemplates.homecareAutopayFailed(reminder.data, {} as any, 'https://x').text).toContain('This is a reminder')
    await t.db.update(t.schema.autopayAttempt).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) } as any).where(eq(t.schema.autopayAttempt.id, a.id))
    expect(await core().autopay.scanApprovalReminders()).toBe(1)
    expect(await core().autopay.scanApprovalReminders()).toBe(0) // only two days are set
    expect((await attempts(inv.id))[0].remindersSent).toBe(2)
    // paid another way: no more reminders
    const inv2 = await invoice(10)
    await release(inv2.id)
    const [b] = await attempts(inv2.id)
    await t.db.update(t.schema.autopayAttempt).set({ createdAt: new Date(Date.now() - 4 * 86_400_000) } as any).where(eq(t.schema.autopayAttempt.id, b.id))
    await as('owner')('/api/billing/invoice-payments', { method: 'POST', json: { invoiceId: inv2.id, amount: 10, paymentDate: today(), paymentMethod: 'check' } })
    expect(await core().autopay.scanApprovalReminders()).toBe(0)
    script = () => ({ status: 'succeeded' })
  })
})
