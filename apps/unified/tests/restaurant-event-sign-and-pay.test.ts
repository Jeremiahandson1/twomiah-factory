// Restaurant & bar parity #2 (docs/parity/restaurant-1-proposal-esign.md, restaurant-2-payments.md): sign and pay in one flow. After
// the signature the SAME proposal page takes the first payment (the deposit) on the venue's own Stripe, with the option to keep the
// card for the later payments (the existing autopay) — not a second link. On the real server with the fake Stripe in foodKit.ts
// (nothing leaves the machine); each test fails without the change (there is no /pay under the proposal link).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore } from '../server/crm/restaurant/eventGuarantee.ts'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'online_payments']
const ALL = [...BASE, 'event_proposals', 'event_payment_automation', 'event_contracts']
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let k: Awaited<ReturnType<typeof bootFood>>
let today = '', clientId = ''
const later = (n: number) => dayBefore(today, -n)
const tokenOf = (path: string) => path.split('/').pop()!
const link = (tok: string, p = '') => `/api/proposal-links/${tok}${p}`
const sign = (tok: string, who: string) => k.pub('POST', link(tok, '/accept'), { signature: SIG, signedBy: who, consent: true })

/** An event with a $1,000 dinner, a $300 deposit and a $800 balance (tax 0), its proposal sent: the signers' links in order. */
async function sentProposal(name: string, days: number, signers?: unknown[]) {
  const ev = (await k.O('POST', '/api/events', { name, eventDate: later(days), status: 'tentative', guestCount: 10, contactId: clientId })).json
  await k.O('POST', `/api/events/${ev.id}/menu`, { name: 'Dinner', unitPrice: 1000, quantity: 1 })
  const deposit = (await k.O('POST', `/api/events/${ev.id}/payments`, { label: 'Deposit', amount: 300, dueDate: later(days - 60) })).json
  const balance = (await k.O('POST', `/api/events/${ev.id}/payments`, { label: 'Balance', amount: 700, dueDate: later(days - 5) })).json
  const p = (await k.O('POST', '/api/event-proposals', { eventId: ev.id, ...(signers ? { signers } : {}) })).json
  const sent = (await k.O('POST', `/api/event-proposals/${p.id}/send`)).json
  return { ev, deposit, balance, p, toks: sent.signers.map((s: any) => tokenOf(s.path)) as string[] }
}
const paid = async (eventId: string) => (await k.O('GET', `/api/events/${eventId}`)).json.totals.paid

beforeAll(async () => {
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_food'
  k = await bootFood({ vertical: 'restaurant', features: ALL })
  today = await venueToday(k.t.db, k.companyId)
  const svc = k.t.services.crm.emailService as any
  svc.send = async (to: string, template: string, data: any) => { k.mails.push({ to, subject: String(data.subject ?? data.headline ?? template), html: JSON.stringify(data) }); return { success: true } }
  clientId = (await k.O('POST', '/api/contacts', { name: 'Harper Diaz', email: 'harper@client.test', phone: '7155550111', type: 'client' })).json.id
  await (k.t.db as any).update(k.S.company).set({ settings: { defaultTaxRate: 0 }, email: 'events@venue.test' }).where(eq(k.S.company.id, k.companyId))
}, 60_000)
afterAll(() => k.restore())

describe('sign and pay on one page', () => {
  test('nothing can be paid on the proposal page before it is signed: no offer, and the pay doors refuse', async () => {
    const a = await sentProposal('Before signing', 100)
    const v = await k.pub('GET', link(a.toks[0]))
    expect(v.status).toBe(200); expect(v.json.pay ?? null).toBeNull()
    const intent = await k.pub('POST', link(a.toks[0], '/pay/intent'), {})
    expect(intent.status).toBe(409); expect(intent.json.code).toBe('nothing_to_pay')
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(0)
    expect((await k.pub('POST', link(a.toks[0], '/pay/autopay'), { consent: true })).status).toBe(409)
  })

  test('the signature books the date and the same response offers the deposit; paying it on the venue’s Stripe records it once, and keeps the card when asked', async () => {
    const a = await sentProposal('Sign and pay', 110)
    const signed = await sign(a.toks[0], 'Harper Diaz')
    expect(signed.status).toBe(200); expect(signed.json.status).toBe('accepted')
    // The offer: the deposit (not the balance, not the whole bill), with the way to pay and the autopay words.
    expect(signed.json.pay).toMatchObject({ label: 'Deposit', owed: 300, canPayByCard: true, autopay: null })
    expect(signed.json.pay.autopayConsent).toMatch(/charge this card/)
    expect(JSON.stringify(signed.json)).not.toMatch(/companyId|invoiceId|payToken|event_payment_id/)
    expect((await k.O('GET', `/api/events/${a.ev.id}`)).json.event.status).toBe('confirmed')

    // Saving the card needs the client's consent.
    expect((await k.pub('POST', link(a.toks[0], '/pay/intent'), { saveCard: true })).status).toBe(400)
    const calls0 = k.stripe.posts('/v1/payment_intents').length
    const intent = await k.pub('POST', link(a.toks[0], '/pay/intent'), { saveCard: true, consent: true })
    expect(intent.status).toBe(200); expect(intent.json.amount).toBe(30000); expect(intent.json.stripeAccount).toBe('acct_biz')
    const made = k.stripe.posts('/v1/payment_intents').at(-1)!
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(calls0 + 1)
    expect(made.account).toBe('acct_biz'); expect(made.params.get('amount')).toBe('30000')
    expect(made.params.get('setup_future_usage')).toBe('off_session'); expect(made.params.get('customer')).toMatch(/^cus_/)
    expect(made.params.get('metadata[event_payment_id]')).toBe(a.deposit.id)

    // Money is recorded only once Stripe says it is in.
    expect((await k.pub('POST', link(a.toks[0], '/pay/confirm'), { paymentIntentId: intent.json.paymentIntentId })).status).toBe(409)
    expect(await paid(a.ev.id)).toBe(0)
    k.stripe.succeedIntent(intent.json.paymentIntentId, 'pm_good')
    const ok = await k.pub('POST', link(a.toks[0], '/pay/confirm'), { paymentIntentId: intent.json.paymentIntentId, saveCard: true, consent: true })
    expect(ok.json).toMatchObject({ success: true, duplicate: false })
    expect(await paid(a.ev.id)).toBe(300)
    expect((await k.pub('POST', link(a.toks[0], '/pay/confirm'), { paymentIntentId: intent.json.paymentIntentId })).json.duplicate).toBe(true)
    expect(await paid(a.ev.id)).toBe(300)
    const pays = await (k.t.db as any).select().from(k.S.payment).where(eq(k.S.payment.reference, intent.json.paymentIntentId))
    expect(pays).toHaveLength(1); expect(pays[0].notes).toMatch(/proposal page/)

    // The card is kept for the rest: the existing autopay, active, and shown on the staff panel.
    const auto = (await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.autopay
    expect(auto).toMatchObject({ status: 'active', brand: 'visa', last4: '4242' }); expect(auto.consentAt).toBeTruthy()

    // Back on the page: the deposit is paid, the balance is NOT offered, and the saved card shows.
    const again = await k.pub('GET', link(a.toks[0]))
    expect(again.json.pay).toMatchObject({ label: 'Deposit', owed: 0, autopay: { brand: 'visa', last4: '4242' } })
    const more = await k.pub('POST', link(a.toks[0], '/pay/intent'), {})
    expect(more.status).toBe(409); expect(more.json.error).toMatch(/has been made/)
    // The balance still has its own pay link, and a payment made for the deposit cannot be passed off on it.
    const balTok = tokenOf((await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.instalments.find((i: any) => i.id === a.balance.id).payPath)
    expect((await k.pub('POST', `/api/event-pay/${balTok}/confirm`, { paymentIntentId: intent.json.paymentIntentId })).status).toBe(400)
  })

  test('paying without keeping the card leaves no card on file; or the card can be left without paying now', async () => {
    const a = await sentProposal('Pay only', 120)
    await sign(a.toks[0], 'Harper Diaz')
    const intent = await k.pub('POST', link(a.toks[0], '/pay/intent'), {})
    expect(k.stripe.posts('/v1/payment_intents').at(-1)!.params.get('setup_future_usage')).toBeNull()
    k.stripe.succeedIntent(intent.json.paymentIntentId)
    expect((await k.pub('POST', link(a.toks[0], '/pay/confirm'), { paymentIntentId: intent.json.paymentIntentId })).json.success).toBe(true)
    expect((await k.O('GET', `/api/event-payments/${a.ev.id}`)).json.autopay).toBeNull()

    const b = await sentProposal('Card only', 130)
    await sign(b.toks[0], 'Harper Diaz')
    expect((await k.pub('POST', link(b.toks[0], '/pay/autopay'), {})).status).toBe(400)
    const si = await k.pub('POST', link(b.toks[0], '/pay/autopay'), { consent: true })
    expect(si.status).toBe(200)
    expect((await k.pub('POST', link(b.toks[0], '/pay/autopay/confirm'), { setupIntentId: si.json.setupIntentId })).status).toBe(409)
    k.stripe.completeSetup(si.json.setupIntentId, 'pm_good')
    expect((await k.pub('POST', link(b.toks[0], '/pay/autopay/confirm'), { setupIntentId: si.json.setupIntentId })).json.success).toBe(true)
    expect(await paid(b.ev.id)).toBe(0)
    expect((await k.O('GET', `/api/event-payments/${b.ev.id}`)).json.autopay.status).toBe('active')
    expect((await k.pub('POST', link(b.toks[0], '/pay/autopay/stop'), {})).json.success).toBe(true)
    expect((await k.O('GET', `/api/event-payments/${b.ev.id}`)).json.autopay.status).toBe('stopped')
  })

  test('with several signers only the client’s page pays, and only once everyone has signed and the date is booked', async () => {
    const a = await sentProposal('Two signers', 140, [{ role: 'client' }, { role: 'venue', name: 'Pat Manager' }])
    const first = await sign(a.toks[0], 'Harper Diaz')
    expect(first.json.status).toBe('partly_signed'); expect(first.json.pay ?? null).toBeNull()
    expect((await k.pub('POST', link(a.toks[0], '/pay/intent'), {})).status).toBe(409)
    const last = await sign(a.toks[1], 'Pat Manager')
    expect(last.json.status).toBe('accepted')
    // The venue's own page takes no money…
    expect(last.json.pay ?? null).toBeNull()
    expect((await k.pub('POST', link(a.toks[1], '/pay/intent'), {})).status).toBe(409)
    // …the client's page, opened again, does.
    const client = await k.pub('GET', link(a.toks[0]))
    expect(client.json.pay).toMatchObject({ label: 'Deposit', owed: 300 })
    const intent = await k.pub('POST', link(a.toks[0], '/pay/intent'), {})
    expect(intent.status).toBe(200)
  })

  test('the venue can turn it off, and it needs payment automation and card payments on', async () => {
    const a = await sentProposal('Switches', 150)
    await k.O('PUT', '/api/event-settings', { payAtSigning: false })
    const signed = await sign(a.toks[0], 'Harper Diaz')
    expect(signed.json.status).toBe('accepted'); expect(signed.json.pay ?? null).toBeNull()
    expect((await k.pub('POST', link(a.toks[0], '/pay/intent'), {})).status).toBe(409)
    await k.O('PUT', '/api/event-settings', { payAtSigning: true })
    expect((await k.pub('GET', link(a.toks[0]))).json.pay).toMatchObject({ owed: 300 })
    // Payment automation off: no offer and no door (the pay link's own switch).
    await k.features(ALL.filter((f) => f !== 'event_payment_automation'))
    expect((await k.pub('GET', link(a.toks[0]))).json.pay ?? null).toBeNull()
    expect((await k.pub('POST', link(a.toks[0], '/pay/intent'), {})).status).toBe(409)
    // Cards off for the venue: the offer says so and takes nothing.
    await k.features(ALL.filter((f) => f !== 'online_payments'))
    expect((await k.pub('GET', link(a.toks[0]))).json.pay).toMatchObject({ canPayByCard: false })
    const off = await k.pub('POST', link(a.toks[0], '/pay/intent'), {})
    expect(off.status).toBe(409); expect(off.json.code).toBe('cards_off')
    await k.features(ALL)
  })

  test('every Stripe call on this page is made on the venue’s own connected account, never the platform’s', () => {
    const mine = k.stripe.calls.filter((c) => ['/v1/customers', '/v1/setup_intents', '/v1/payment_intents'].includes(c.path) && c.method === 'POST')
    expect(mine.length).toBeGreaterThan(4)
    expect(mine.every((c) => c.account === 'acct_biz')).toBe(true)
  })
})
