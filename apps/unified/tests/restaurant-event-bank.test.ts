// Restaurant & bar parity #3 (docs/parity/restaurant-2-payments.md): an event's instalments paid from a US bank account (ACH). A bank debit
// is accepted, then PROCESSING for days, then it settles or comes back: the money is recorded on the invoice only when it settles. On the
// real server with the fake Stripe in foodKit.ts, which answers us_bank_account PaymentIntents, SetupIntents, mandates and the
// processing -> succeeded / requires_payment_method lifecycle as Stripe documents it; nothing leaves the machine. Each test fails without
// the change (there is no bank door, no event_bank_payment table and no claim of the bank events).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore } from '../server/crm/restaurant/eventGuarantee.ts'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'online_payments']
const NO_BANK = [...BASE, 'event_proposals', 'event_payment_automation', 'event_contracts']
const ALL = [...NO_BANK, 'event_bank_payments']
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let k: Awaited<ReturnType<typeof bootFood>>
let today = '', clientId = ''
const later = (n: number) => dayBefore(today, -n)
const jobs = () => (k.t.services.crm as any).eventJobs
const subjects = () => k.mails.map((m) => m.subject)
const pay = (tok: string, p: string) => `/api/event-pay/${tok}${p}`

/** An event with a $1,000 dinner: a $300 deposit and a $700 balance, tentative unless said, tax 0. */
async function newEvent(name: string, days = 100, depositDue = later(days - 60), status = 'tentative') {
  const ev = (await k.O('POST', '/api/events', { name, eventDate: later(days), status, guestCount: 10, contactId: clientId })).json
  await k.O('POST', `/api/events/${ev.id}/menu`, { name: 'Dinner', unitPrice: 1000, quantity: 1 })
  const deposit = (await k.O('POST', `/api/events/${ev.id}/payments`, { label: 'Deposit', amount: 300, dueDate: depositDue })).json
  const balance = (await k.O('POST', `/api/events/${ev.id}/payments`, { label: 'Balance', amount: 700, dueDate: later(days - 5) })).json
  const toks = (await k.O('GET', `/api/event-payments/${ev.id}`)).json.instalments.map((i: any) => i.payPath.split('/').pop()) as string[]
  return { ev, deposit, balance, depTok: toks[0], balTok: toks[1] }
}
const evOf = async (id: string) => (await k.O('GET', `/api/events/${id}`)).json
const paid = async (id: string) => (await evOf(id)).totals.paid
const payments = async (eventId: string) => {
  const inv = (await (k.t.db as any).select().from(k.S.invoice).where(eq(k.S.invoice.eventId, eventId)))[0]
  return (await (k.t.db as any).select().from(k.S.payment).where(eq(k.S.payment.invoiceId, inv.id))) as any[]
}
/** Stripe's Connect forwarder delivering an event about a PaymentIntent (the object as it is NOW unless one is given). */
const deliver = (type: string, object: any, account = 'acct_biz') => k.t.call('/api/stripe/factory-event', { method: 'POST', headers: { 'X-Factory-Key': 'factory-key' }, json: { event: k.stripe.eventFor(type, object, account) } })
const deliverPi = (type: string, id: string, account?: string) => deliver(type, k.stripe.intents.get(id), account)
/** The client starts a bank payment on the pay link and submits their account in the browser: the debit is processing. */
async function startDebit(tok: string, extra: Record<string, unknown> = {}, pm = 'pm_bank_ok', opts: { microdeposits?: boolean } = {}) {
  const intent = await k.pub('POST', pay(tok, '/bank/intent'), { consent: true, ...extra })
  expect(intent.status).toBe(200)
  k.stripe.confirmBankIntent(intent.json.paymentIntentId, pm, opts)
  const confirmed = await k.pub('POST', pay(tok, '/bank/confirm'), { paymentIntentId: intent.json.paymentIntentId })
  return { id: intent.json.paymentIntentId as string, intent, confirmed }
}

beforeAll(async () => {
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_food'
  process.env.FACTORY_SYNC_KEY = 'factory-key'
  k = await bootFood({ vertical: 'restaurant', features: ALL })
  today = await venueToday(k.t.db, k.companyId)
  const svc = k.t.services.crm.emailService as any
  svc.send = async (to: string, template: string, data: any) => { k.mails.push({ to, subject: String(data.subject ?? data.headline ?? template), html: JSON.stringify(data) }); return { success: true } }
  clientId = (await k.O('POST', '/api/contacts', { name: 'Harper Diaz', email: 'harper@client.test', phone: '7155550111', type: 'client' })).json.id
  await (k.t.db as any).update(k.S.company).set({ settings: { defaultTaxRate: 0 }, email: 'events@venue.test' }).where(eq(k.S.company.id, k.companyId))
}, 60_000)
afterAll(() => k.restore())

describe('bank payments are gated, on the API and in the offer', () => {
  test('with the feature off the bank doors are not there and nothing is offered; with Stripe saying the account cannot debit, the offer and the door say so', async () => {
    const a = await newEvent('Gated', 90)
    await k.features(NO_BANK)
    const offer = await k.pub('GET', `/api/event-pay/${a.depTok}`)
    expect(offer.json.canPayByBank).toBe(false); expect(offer.json.canPayByCard).toBe(true)
    const posts0 = k.stripe.posts('/v1/payment_intents').length
    for (const p of ['/bank/intent', '/bank/confirm', '/bank/autopay', '/bank/autopay/confirm']) expect((await k.pub('POST', pay(a.depTok, p), { consent: true })).status).toBe(404)
    expect([403, 404]).toContain((await k.O('GET', `/api/event-bank-payments/${a.ev.id}`)).status)
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(posts0)

    await k.features(ALL)
    expect((await k.pub('GET', `/api/event-pay/${a.depTok}`)).json).toMatchObject({ canPayByBank: true, bankPending: null })
    k.stripe.state.bankCapability = false
    expect((await k.pub('GET', `/api/event-pay/${a.depTok}`)).json.canPayByBank).toBe(false)
    const refused = await k.pub('POST', pay(a.depTok, '/bank/intent'), { consent: true })
    expect(refused.status).toBe(409); expect(refused.json.code).toBe('bank_off')
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(posts0)
    k.stripe.state.bankCapability = true
  })

  test('the staff list needs the invoices permission, and checking a debit needs the right to change invoices', async () => {
    const a = await newEvent('Seats', 91)
    expect((await k.B('GET', `/api/event-bank-payments/${a.ev.id}`)).status).toBe(403)
    expect((await k.O('GET', `/api/event-bank-payments/${a.ev.id}`)).status).toBe(200)
    expect((await k.B('POST', `/api/event-bank-payments/${a.ev.id}/nope/refresh`)).status).toBe(403)
  })
})

describe('a bank payment on the pay link', () => {
  test('the client agrees, Stripe takes the debit on the venue’s account and it is PROCESSING: nothing is recorded, nothing else can be paid; it is recorded once, as a bank payment, only when it settles', async () => {
    const a = await newEvent('Pay by bank', 92, undefined, 'enquiry') // an enquiry: the first money books the date — but only settled money
    expect((await k.pub('POST', pay(a.depTok, '/bank/intent'), {})).status).toBe(400) // consent first
    expect((await k.pub('POST', pay(a.depTok, '/bank/intent'), { consent: true, saveBank: true })).status).toBe(400) // keeping the account is its own agreement
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(0)
    const intent = await k.pub('POST', pay(a.depTok, '/bank/intent'), { consent: true })
    expect(intent.status).toBe(200); expect(intent.json.amount).toBe(30000); expect(intent.json.stripeAccount).toBe('acct_biz')
    const made = k.stripe.posts('/v1/payment_intents').at(-1)!
    expect(made.account).toBe('acct_biz'); expect(made.params.get('amount')).toBe('30000')
    expect([...made.params.entries()].filter(([key]) => key.startsWith('payment_method_types')).map(([, v]) => v)).toEqual(['us_bank_account'])
    expect(made.params.get('metadata[kind]')).toBe('event_bank'); expect(made.params.get('metadata[event_payment_id]')).toBe(a.deposit.id)

    // The browser has not submitted the account yet: nothing to follow.
    const early = await k.pub('POST', pay(a.depTok, '/bank/confirm'), { paymentIntentId: intent.json.paymentIntentId })
    expect(early.status).toBe(409); expect(early.json.code).toBe('bank_not_submitted')

    k.stripe.confirmBankIntent(intent.json.paymentIntentId)
    const confirmed = await k.pub('POST', pay(a.depTok, '/bank/confirm'), { paymentIntentId: intent.json.paymentIntentId })
    expect(confirmed.status).toBe(200); expect(confirmed.json.status).toBe('processing'); expect(confirmed.json.message).toMatch(/four business days/)
    // Processing is not paid: not on the invoice, the date not booked, the instalment still owed.
    expect(await paid(a.ev.id)).toBe(0); expect((await payments(a.ev.id)).length).toBe(0)
    expect((await evOf(a.ev.id)).event.status).toBe('enquiry')
    const page = (await k.pub('GET', `/api/event-pay/${a.depTok}`)).json
    expect(page.owed).toBe(300); expect(page.bankPending).toMatchObject({ amount: 300, waitingToVerify: false, bank: 'STRIPE TEST BANK', last4: '6789' })
    // While it is on its way it cannot be paid again — not from the bank, not by card.
    const again = await k.pub('POST', pay(a.depTok, '/bank/intent'), { consent: true })
    expect(again.status).toBe(409); expect(again.json.code).toBe('bank_in_flight')
    const card = await k.pub('POST', pay(a.depTok, '/intent'), {})
    expect(card.status).toBe(409); expect(card.json.code).toBe('bank_in_flight')
    // Stripe's own "processing" event changes nothing on the invoice.
    expect((await deliverPi('payment_intent.processing', intent.json.paymentIntentId)).status).toBe(200)
    expect(await paid(a.ev.id)).toBe(0)
    // The staff list shows it as processing, never as paid.
    const staff = (await k.O('GET', `/api/event-bank-payments/${a.ev.id}`)).json.payments
    expect(staff).toHaveLength(1); expect(staff[0]).toMatchObject({ label: 'Deposit', amount: 300, status: 'processing', bank: 'STRIPE TEST BANK', last4: '6789' })
    expect(JSON.stringify(staff)).not.toMatch(/pi_|paymentIntent|companyId|secret/)

    // The bank settles it: Stripe's succeeded event records the money once, as a bank payment, and books the date.
    k.stripe.settleBank(intent.json.paymentIntentId)
    const ok = await deliverPi('payment_intent.succeeded', intent.json.paymentIntentId)
    expect(ok.status).toBe(200)
    expect(await paid(a.ev.id)).toBe(300)
    const rows = await payments(a.ev.id)
    expect(rows).toHaveLength(1); expect(rows[0].method).toBe('bank_transfer'); expect(rows[0].reference).toBe(intent.json.paymentIntentId); expect(Number(rows[0].amount)).toBe(300)
    expect((await evOf(a.ev.id)).event.status).toBe('confirmed')
    // Told twice (Stripe retries), once: no second payment, no second email.
    const n = k.mails.length
    await deliverPi('payment_intent.succeeded', intent.json.paymentIntentId)
    expect(await paid(a.ev.id)).toBe(300); expect((await payments(a.ev.id)).length).toBe(1); expect(k.mails.length).toBe(n)
    expect(subjects().filter((s) => /has cleared/.test(s)).length).toBeGreaterThanOrEqual(1)
    expect((await k.O('GET', `/api/event-bank-payments/${a.ev.id}`)).json.payments[0].status).toBe('succeeded')
    expect((await k.pub('GET', `/api/event-pay/${a.depTok}`)).json).toMatchObject({ owed: 0, bankPending: null })
  })

  test('a debit the bank sends back is not recorded, the client is told why in plain words with the pay link (once), and the instalment can be paid again', async () => {
    const a = await newEvent('Bounced', 93)
    const { id } = await startDebit(a.depTok)
    expect(await paid(a.ev.id)).toBe(0)
    k.stripe.failBank(id, 'insufficient_funds')
    const n0 = k.mails.length
    expect((await deliverPi('payment_intent.payment_failed', id)).status).toBe(200)
    expect(await paid(a.ev.id)).toBe(0); expect((await payments(a.ev.id)).length).toBe(0)
    const sent = k.mails.slice(n0).filter((m) => m.to === 'harper@client.test')
    expect(sent).toHaveLength(1); expect(sent[0].subject).toMatch(/did not go through/)
    expect(sent[0].html).toMatch(/did not have enough money/); expect(sent[0].html).toContain(`/event-pay/${a.depTok}`)
    expect(sent[0].html).not.toMatch(/insufficient_funds/) // words, never the code
    await deliverPi('payment_intent.payment_failed', id) // Stripe retries: not told twice
    expect(k.mails.length).toBe(n0 + 1)
    const staff = (await k.O('GET', `/api/event-bank-payments/${a.ev.id}`)).json.payments[0]
    expect(staff.status).toBe('failed'); expect(staff.note).toMatch(/not have enough money/); expect(staff.note).not.toMatch(/insufficient_funds/)
    // The page says so and offers the payment again; both ways are open.
    const page = (await k.pub('GET', `/api/event-pay/${a.depTok}`)).json
    expect(page.bankPending).toBeNull(); expect(page.bankFailed.message).toMatch(/not have enough money/); expect(page.owed).toBe(300)
    expect((await k.pub('POST', pay(a.depTok, '/bank/intent'), { consent: true })).status).toBe(200)
    expect((await k.pub('POST', pay(a.depTok, '/intent'), {})).status).toBe(200)
  })

  test('Stripe’s events can come late, twice or out of order, or from another account: the debit is read from Stripe, and an event for another account changes nothing', async () => {
    const a = await newEvent('Out of order', 94)
    const { id } = await startDebit(a.depTok)
    const stale = JSON.parse(JSON.stringify(k.stripe.intents.get(id))) // the "processing" copy
    // Another Stripe account cannot settle this venue's debit, even for the same PaymentIntent id.
    k.stripe.settleBank(id)
    const foreign = await deliver('payment_intent.succeeded', k.stripe.intents.get(id), 'acct_somebody_else')
    expect((await foreign.json()).handled).toBe(false); expect(await paid(a.ev.id)).toBe(0)
    // Succeeded first, then the stale "processing" event: still recorded once, still paid.
    await deliverPi('payment_intent.succeeded', id)
    expect(await paid(a.ev.id)).toBe(300)
    await deliver('payment_intent.processing', stale)
    expect(await paid(a.ev.id)).toBe(300); expect((await payments(a.ev.id)).length).toBe(1)
    expect((await k.O('GET', `/api/event-bank-payments/${a.ev.id}`)).json.payments[0].status).toBe('succeeded')
    // A card PaymentIntent is not the bank module's: the shared handler records it as before, once.
    const cardIntent = await k.pub('POST', pay(a.balTok, '/intent'), {})
    k.stripe.succeedIntent(cardIntent.json.paymentIntentId)
    const before = await paid(a.ev.id)
    await deliverPi('payment_intent.succeeded', cardIntent.json.paymentIntentId)
    expect(await paid(a.ev.id)).toBe(before + 700)
    expect((await payments(a.ev.id)).map((p) => p.method).sort()).toEqual(['bank_transfer', 'card'])
  })

  test('a debit whose event never came is found by the hourly pass, which asks Stripe; a lost "failed" is found the same way', async () => {
    const a = await newEvent('Lost webhook', 95)
    const b = await newEvent('Lost bounce', 96)
    const one = await startDebit(a.depTok), two = await startDebit(b.depTok)
    expect(await jobs().runBankSettlement()).toBe(0) // both still processing at Stripe
    expect(await paid(a.ev.id)).toBe(0)
    k.stripe.settleBank(one.id); k.stripe.failBank(two.id, 'account_closed')
    expect(await jobs().runBankSettlement()).toBe(2)
    expect(await paid(a.ev.id)).toBe(300); expect(await paid(b.ev.id)).toBe(0)
    expect(subjects().some((s) => /Lost bounce/.test(s) && /did not go through/.test(s))).toBe(true)
    expect(await jobs().runBankSettlement()).toBe(0)
  })

  test('a bank verified with micro-deposits waits, unrecorded, until Stripe says the debit is processing and then settled', async () => {
    const a = await newEvent('Micro', 97)
    const { id, confirmed } = await startDebit(a.depTok, {}, 'pm_bank_ok', { microdeposits: true })
    expect(confirmed.json.status).toBe('requires_action'); expect(confirmed.json.verifyUrl).toMatch(/^https:\/\/payments\.stripe\.com\//)
    expect((await k.pub('GET', `/api/event-pay/${a.depTok}`)).json.bankPending).toMatchObject({ waitingToVerify: true })
    expect((await k.pub('POST', pay(a.depTok, '/bank/intent'), { consent: true })).json.code).toBe('bank_in_flight')
    expect(await paid(a.ev.id)).toBe(0)
    k.stripe.verifyBankIntent(id)
    await deliverPi('payment_intent.processing', id)
    expect((await k.O('GET', `/api/event-bank-payments/${a.ev.id}`)).json.payments[0].status).toBe('processing')
    k.stripe.settleBank(id); await deliverPi('payment_intent.succeeded', id)
    expect(await paid(a.ev.id)).toBe(300)
  })

  test('a bank left for later that is verified days afterwards is found by the hourly pass when no event comes', async () => {
    const a = await newEvent('Verified later', 101)
    const si = await k.pub('POST', pay(a.balTok, '/bank/autopay'), { consent: true })
    k.stripe.confirmBankSetup(si.json.setupIntentId, 'pm_bank_ok', { microdeposits: true })
    await k.pub('POST', pay(a.balTok, '/bank/autopay/confirm'), { setupIntentId: si.json.setupIntentId })
    expect(await jobs().runBankSettlement()).toBe(0)
    expect((await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.autopay.status).toBe('pending')
    k.stripe.verifyBankSetup(si.json.setupIntentId)
    expect(await jobs().runBankSettlement()).toBe(1)
    expect((await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.autopay).toMatchObject({ status: 'active', bank: true, last4: '6789' })
  })

  test('a reminder is not sent for an instalment whose bank debit is already on its way', async () => {
    const a = await newEvent('No nag', 40, today)
    await startDebit(a.depTok)
    const n = k.mails.length
    expect((await k.O('POST', `/api/event-payments/${a.ev.id}/remind/${a.deposit.id}`)).status).toBe(409)
    await jobs().runPaymentReminders(new Date())
    expect(k.mails.slice(n).filter((m) => /No nag/.test(m.html) && /Deposit/.test(m.subject))).toHaveLength(0)
  })
})

describe('a bank account left for the rest of the event', () => {
  test('left without paying: agreed to first, verified, kept with its bank and last four and the agreement; each due instalment is DEBITED off session, recorded only when it settles, never debited twice while on its way', async () => {
    const a = await newEvent('Bank autopay', 98, today)
    expect((await k.pub('POST', pay(a.balTok, '/bank/autopay'), {})).status).toBe(400)
    const si = await k.pub('POST', pay(a.balTok, '/bank/autopay'), { consent: true })
    expect(si.status).toBe(200)
    const setup = k.stripe.posts('/v1/setup_intents').at(-1)!
    expect(setup.account).toBe('acct_biz'); expect(setup.params.get('payment_method_types[0]')).toBe('us_bank_account'); expect(setup.params.get('usage')).toBe('off_session')
    // Not saved until Stripe says the account is in.
    expect((await k.pub('POST', pay(a.balTok, '/bank/autopay/confirm'), { setupIntentId: si.json.setupIntentId })).json.saved).toBe(false)
    expect((await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.autopay.status).toBe('pending')
    k.stripe.confirmBankSetup(si.json.setupIntentId, 'pm_bank_ok')
    expect((await k.pub('POST', pay(a.balTok, '/bank/autopay/confirm'), { setupIntentId: si.json.setupIntentId })).json.saved).toBe(true)
    const auto = (await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.autopay
    expect(auto).toMatchObject({ status: 'active', bank: true, brand: 'STRIPE TEST BANK', last4: '6789' }); expect(auto.consentAt).toBeTruthy()
    const row = (await (k.t.db as any).select().from(k.S.eventAutopay).where(eq(k.S.eventAutopay.eventId, a.ev.id)))[0]
    expect(row.method).toBe('us_bank_account'); expect(row.consentText).toMatch(/debit this bank account/)
    expect((await k.pub('GET', pay(a.balTok, ''))).json.autopay).toMatchObject({ bank: true, last4: '6789' })

    // The deposit is due: the debit is made off session on the bank, and it is PROCESSING — not recorded, not counted as charged.
    const d0 = k.stripe.posts('/v1/payment_intents').length
    expect(await jobs().runAutopay()).toBe(0)
    const debit = k.stripe.posts('/v1/payment_intents').at(-1)!
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(d0 + 1)
    expect(debit.account).toBe('acct_biz'); expect(debit.params.get('off_session')).toBe('true'); expect(debit.params.get('payment_method')).toBe('pm_bank_ok'); expect(debit.params.get('payment_method_types[0]')).toBe('us_bank_account'); expect(debit.params.get('amount')).toBe('30000')
    expect(await paid(a.ev.id)).toBe(0)
    const inst = (await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.instalments.find((i: any) => i.id === a.deposit.id)
    expect(inst.autopayStatus).toBe('processing')
    // The next day's pass finds it on its way and debits nothing more.
    expect(await jobs().runAutopay(new Date(Date.now() + 86_400_000))).toBe(0)
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(d0 + 1)
    // It settles: recorded once, as a bank payment.
    const piId = [...k.stripe.intents.values()].filter((p) => p.metadata?.kind === 'event_autopay').at(-1)!.id
    k.stripe.settleBank(piId); await deliverPi('payment_intent.succeeded', piId)
    expect(await paid(a.ev.id)).toBe(300)
    expect((await payments(a.ev.id))[0].method).toBe('bank_transfer')
    expect((await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.instalments.find((i: any) => i.id === a.deposit.id).autopayStatus).toBe('succeeded')
    expect((await k.O('GET', `/api/event-bank-payments/${a.ev.id}`)).json.payments[0]).toMatchObject({ status: 'succeeded', source: 'autopay' })
  })

  test('a saved bank that needs micro-deposits is kept only when Stripe says it is verified; an autopay debit the bank returns is told, not retried, and a closed account is taken off the event', async () => {
    const a = await newEvent('Bank returned', 99, today)
    const si = await k.pub('POST', pay(a.depTok, '/bank/autopay'), { consent: true })
    k.stripe.confirmBankSetup(si.json.setupIntentId, 'pm_bank_ok', { microdeposits: true })
    const waiting = await k.pub('POST', pay(a.depTok, '/bank/autopay/confirm'), { setupIntentId: si.json.setupIntentId })
    expect(waiting.json.saved).toBe(false); expect(waiting.json.verifyUrl).toMatch(/^https:\/\/payments\.stripe\.com\//)
    const offSession = () => k.stripe.posts('/v1/payment_intents').filter((p) => p.params.get('off_session') === 'true').length
    const o0 = offSession()
    expect(await jobs().runAutopay()).toBe(0)
    expect(offSession()).toBe(o0) // nothing to debit yet: the bank is not verified
    // Verified days later: Stripe's setup_intent.succeeded event keeps the account (the agreement was given when it began).
    k.stripe.verifyBankSetup(si.json.setupIntentId)
    expect((await deliver('setup_intent.succeeded', k.stripe.setups.get(si.json.setupIntentId))).status).toBe(200)
    expect((await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.autopay).toMatchObject({ status: 'active', bank: true })
    // The due instalment is debited, the bank returns it (account closed).
    await jobs().runAutopay()
    const piId = [...k.stripe.intents.values()].filter((p) => p.metadata?.kind === 'event_autopay').at(-1)!.id
    k.stripe.failBank(piId, 'account_closed')
    const n0 = k.mails.length
    await deliverPi('payment_intent.payment_failed', piId)
    expect(await paid(a.ev.id)).toBe(0)
    const told = k.mails.slice(n0)
    expect(told).toHaveLength(1); expect(told[0].html).toMatch(/account is closed/); expect(told[0].html).toMatch(/removed that bank account/); expect(told[0].html).not.toMatch(/account_closed/)
    const inst = (await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.instalments.find((i: any) => i.id === a.deposit.id)
    expect(inst.autopayStatus).toBe('failed'); expect(inst.autopayError).toMatch(/account is closed/)
    expect((await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.autopay.status).toBe('stopped')
    expect(k.stripe.detached).toContain('pm_bank_ok')
    // Not retried.
    const calls = k.stripe.posts('/v1/payment_intents').length
    await jobs().runAutopay(new Date(Date.now() + 86_400_000))
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(calls)
  })
})

describe('sign and pay by bank', () => {
  test('after the signature the proposal page takes the deposit from a bank account: the date is booked by the signature, the deposit is recorded only when the bank settles, and the account is kept when asked', async () => {
    const ev = (await k.O('POST', '/api/events', { name: 'Sign and bank', eventDate: later(110), status: 'tentative', guestCount: 10, contactId: clientId })).json
    await k.O('POST', `/api/events/${ev.id}/menu`, { name: 'Dinner', unitPrice: 1000, quantity: 1 })
    const deposit = (await k.O('POST', `/api/events/${ev.id}/payments`, { label: 'Deposit', amount: 300, dueDate: later(50) })).json
    await k.O('POST', `/api/events/${ev.id}/payments`, { label: 'Balance', amount: 700, dueDate: later(105) })
    const p = (await k.O('POST', '/api/event-proposals', { eventId: ev.id })).json
    const tok = (await k.O('POST', `/api/event-proposals/${p.id}/send`)).json.signers[0].path.split('/').pop()
    const link = (x = '') => `/api/proposal-links/${tok}${x}`
    // Before signing there is nothing to pay by bank.
    expect((await k.pub('POST', link('/pay/bank/intent'), { consent: true })).status).toBe(409)
    const signed = await k.pub('POST', link('/accept'), { signature: SIG, signedBy: 'Harper Diaz', consent: true })
    expect(signed.json.pay).toMatchObject({ label: 'Deposit', owed: 300, canPayByBank: true, bankPending: null })
    expect(signed.json.pay.bankAutopayConsent).toMatch(/debit this bank account/)
    expect((await evOf(ev.id)).event.status).toBe('confirmed')
    // Keeping the account is its own agreement.
    expect((await k.pub('POST', link('/pay/bank/intent'), { consent: true, saveBank: true })).status).toBe(400)
    const intent = await k.pub('POST', link('/pay/bank/intent'), { consent: true, saveBank: true, autopayConsent: true })
    expect(intent.status).toBe(200)
    const made = k.stripe.posts('/v1/payment_intents').at(-1)!
    expect(made.params.get('setup_future_usage')).toBe('off_session'); expect(made.params.get('customer')).toMatch(/^cus_/); expect(made.params.get('payment_method_types[0]')).toBe('us_bank_account')
    k.stripe.confirmBankIntent(intent.json.paymentIntentId)
    const c = await k.pub('POST', link('/pay/bank/confirm'), { paymentIntentId: intent.json.paymentIntentId })
    expect(c.json.status).toBe('processing'); expect(await paid(ev.id)).toBe(0)
    // The page now shows the payment on its way, with nothing more to pay and no account on file yet.
    const view = (await k.pub('GET', link())).json
    expect(view.pay.bankPending).toMatchObject({ amount: 300 }); expect((await k.O('GET', `/api/event-payments/${ev.id}`)).json.autopay?.status ?? 'pending').not.toBe('active')
    k.stripe.settleBank(intent.json.paymentIntentId)
    await deliverPi('payment_intent.succeeded', intent.json.paymentIntentId)
    expect(await paid(ev.id)).toBe(300)
    expect((await payments(ev.id))[0].method).toBe('bank_transfer')
    const auto = (await k.O('GET', `/api/event-payments/${ev.id}`)).json.autopay
    expect(auto).toMatchObject({ status: 'active', bank: true, last4: '6789' }); expect(auto.consentAt).toBeTruthy()
    void deposit
  })
})
