// Card on file and no-show / late-cancel fees (salon gap #1; server/crm/salon/cardOnFile.ts), through the real server and the
// real logins against a fake Stripe. The money rule is the point: a card is saved on Stripe's own page, on the SALON'S connected
// account, and a fee is charged there, once, by a person who saw the amount and gave a reason — nothing on its own, nothing on
// Twomiah's account, and no card number ever reaches us.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PASSWORD = 'Card-on-file-1030'

/** A fake Stripe: what the card code asked of it, and on which account — with Stripe's idempotency and a card that declines. */
const calls: Array<{ what: string; args: any; opts: any }> = []
let customers = 0, sessions = 0, intents = 0
const sessionMeta: Record<string, Record<string, string>> = {}
const byKey = new Map<string, any>()
const declining = new Set<string>()
const fakeStripe = {
  customers: {
    retrieve: async (id: string) => ({ id, deleted: false }),
    create: async (args: any, opts: any) => { calls.push({ what: 'customer', args, opts }); customers++; return { id: 'cus_' + customers } },
  },
  checkout: {
    sessions: {
      create: async (args: any, opts: any) => {
        calls.push({ what: 'setup-session', args, opts }); sessions++
        const id = 'cs_' + sessions
        sessionMeta[id] = args.metadata
        return { id, url: 'https://checkout.stripe.com/c/setup/' + id }
      },
      retrieve: async (id: string, args: any, opts: any) => {
        calls.push({ what: 'setup-read', args: { id, ...args }, opts })
        // Stripe's own record of what the client typed on its page: we only ever read the brand and last four back.
        return { id, mode: 'setup', customer: 'cus_1', metadata: sessionMeta[id], setup_intent: { payment_method: { id: 'pm_' + id, type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2031 } } } }
      },
    },
  },
  paymentIntents: {
    create: async (args: any, opts: any) => {
      calls.push({ what: 'charge', args, opts })
      if (byKey.has(opts.idempotencyKey)) return byKey.get(opts.idempotencyKey)
      intents++
      if (declining.has(args.metadata.appointment_id)) {
        throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined', payment_intent: { id: 'pi_declined_' + intents } })
      }
      const intent = { id: 'pi_' + intents, status: 'succeeded' }
      byKey.set(opts.idempotencyKey, intent)
      return intent
    },
  },
}

describe('salon: card on file and no-show / late-cancel fees', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}
  let client = '', cut = '', noShow: any, late: any, early: any, declined: any
  const sent: Array<{ to: string; name: string; data: any }> = []

  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000)
  const appt = async (startsInHours: number, status = 'scheduled') =>
    (await t.db.insert(t.schema.appointment).values({ companyId: co, contactId: client, serviceId: cut, status, startTime: inHours(startsInHours), endTime: inHours(startsInHours + 1) } as any).returning())[0]
  const policy = { cardRequirement: 'all', noShowFeeAmount: 20, lateCancelWindowMinutes: 1440, lateCancelFeePercent: 50 }
  /** Stripe's own event, forwarded by the Factory, that a client finished the card page. */
  const cardSaved = (sessionId: string, account = 'acct_salon') => t.call('/api/stripe/factory-event', {
    method: 'POST', headers: { 'X-Factory-Key': 'factory-key' },
    json: { event: { type: 'checkout.session.completed', account, data: { object: { id: sessionId, mode: 'setup', metadata: sessionMeta[sessionId] } } } },
  })
  const cardsOf = async () => (await t.db.select().from(t.schema.clientCard).where(eq(t.schema.clientCard.contactId, client)))
  const chargesOf = async () => (await t.db.select().from(t.schema.cardFeeCharge).where(eq(t.schema.cardFeeCharge.contactId, client)))
  const feeBody = (kind: string, amount: number, reason = 'Did not arrive and did not call') => ({ kind, amount, reason })

  beforeAll(async () => {
    process.env.FACTORY_SYNC_KEY = 'factory-key'
    t = await bootTenant({ vertical: 'salon', stripe: fakeStripe })
    const s = await seedOwner(t)
    co = s.company.id
    ids.owner = s.owner.id
    await t.db.update(t.schema.company).set({ timezone: 'UTC', enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'card_on_file', 'team', 'dashboard'] } as any).where(eq(t.schema.company.id, co))
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of Object.entries({ ana: 'field', desk: 'viewer', manager: 'manager', admin: 'admin' })) {
      const email = `${key}@test.example`
      const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co } as any).returning()
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
    }
    client = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Casey Client', email: 'casey@example.com', type: 'client' } as any).returning())[0].id
    cut = (await t.db.insert(t.schema.serviceMenu).values({ companyId: co, name: 'Cut', price: '50', durationMin: 60 } as any).returning())[0].id
    noShow = await appt(72, 'no_show')
    declined = await appt(80, 'no_show')
    late = await appt(5)
    early = await appt(120)
    // the receipt goes out through the app's one email service
    const real = t.services.email.send.bind(t.services.email)
    ;(t.services.email as any).send = async (to: string, name: string, data: any) => { sent.push({ to, name, data }); return real(to, name, data) }
  }, 120_000)

  describe('the policy', () => {
    test('the owner and an admin set it; a stylist, the front desk and a manager cannot — on the server', async () => {
      for (const who of ['ana', 'desk', 'manager']) expect((await as(who, '/api/card-on-file/policy', 'PUT', policy)).status).toBe(403)
      expect((await as('admin', '/api/card-on-file/policy', 'PUT', policy)).status).toBe(200)
      const r = await as('desk', '/api/card-on-file/policy')
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ cardRequirement: 'all', noShowFeeAmount: 20, lateCancelWindowMinutes: 1440, lateCancelFeePercent: 50, connected: false })
      // the standard sentence names both fees and the window, in a client's words
      expect(r.body.words).toContain('$20')
      expect(r.body.words).toContain('50% of the service price')
      expect(r.body.words).toContain('24 hours')
    })

    test('a fee is an amount or a percent, never both; a late fee needs its window; a card needs something to agree to', async () => {
      const bad = async (body: any) => (await as('owner', '/api/card-on-file/policy', 'PUT', body))
      let r = await bad({ ...policy, noShowFeePercent: 10 })
      expect([r.status, r.body.code]).toEqual([400, 'VALIDATION'])
      expect(Object.keys(r.body.fields)).toContain('noShowFeeAmount')
      r = await bad({ cardRequirement: 'all', lateCancelFeeAmount: 15 })
      expect(Object.keys(r.body.fields)).toContain('lateCancelWindowMinutes')
      r = await bad({ cardRequirement: 'all' })
      expect(Object.keys(r.body.fields)).toContain('cardRequirement')
      r = await bad({ noShowFeePercent: 150 })
      expect(Object.keys(r.body.fields)).toContain('noShowFeePercent')
      // nothing bad was saved
      expect((await as('owner', '/api/card-on-file/policy')).body.noShowFeeAmount).toBe(20)
    })
  })

  describe('saving a card', () => {
    test('without a connected Stripe account nothing is asked of Stripe', async () => {
      const r = await as('manager', `/api/card-on-file/clients/${client}/cards/setup`, 'POST', { clientAgreed: true })
      expect([r.status, r.body.code]).toEqual([409, 'STRIPE_NOT_CONNECTED'])
      expect(calls).toEqual([])
    })

    test('the desk records that the client agreed; Stripe\'s own page is made on the SALON\'S account, in setup mode', async () => {
      await t.db.update(t.schema.company).set({ integrations: { stripeAccountId: 'acct_salon' } }).where(eq(t.schema.company.id, co))
      expect((await as('manager', `/api/card-on-file/clients/${client}/cards/setup`, 'POST', {})).body.code).toBe('CONSENT_REQUIRED')
      // signed out: refused, and nothing was asked of Stripe
      expect((await t.call(`/api/card-on-file/clients/${client}/cards/setup`, { method: 'POST', json: { clientAgreed: true } })).status).toBe(401)
      expect(calls).toEqual([])
      calls.length = 0
      const r = await as('manager', `/api/card-on-file/clients/${client}/cards/setup`, 'POST', { clientAgreed: true })
      expect(r.status).toBe(200)
      expect(r.body.url).toBe('https://checkout.stripe.com/c/setup/cs_1')
      const made = calls.find((c) => c.what === 'setup-session')!
      expect(made.opts).toEqual({ stripeAccount: 'acct_salon' })
      expect(made.args).toMatchObject({ mode: 'setup', payment_method_types: ['card'] })
      expect(made.args.metadata).toMatchObject({ kind: 'card_on_file', company_id: co, contact_id: client, consent_via: 'staff_at_desk', consent_user_id: ids.manager })
      // the customer was made on the salon's account too
      expect(calls.find((c) => c.what === 'customer')!.opts).toEqual({ stripeAccount: 'acct_salon' })
      // asking for a page saves no card
      expect(await cardsOf()).toEqual([])
    })

    test('Stripe\'s event saves the card with its brand, last four and the consent; told twice, once; another account\'s event is not ours', async () => {
      expect((await cardSaved('cs_1', 'acct_someone_else')).status).toBe(200)
      expect(await cardsOf()).toEqual([])
      expect((await cardSaved('cs_1')).status).toBe(200)
      expect((await cardSaved('cs_1')).status).toBe(200)
      const rows = await cardsOf()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2031, stripeAccount: 'acct_salon', consentVia: 'staff_at_desk', consentUserId: ids.manager })
      // the words the client agreed to, kept as they stood
      expect(rows[0].consentText).toContain('$20')
      expect(rows[0].consentAt).toBeInstanceOf(Date)
      // a card number is never in anything we keep
      expect(JSON.stringify(rows[0])).not.toMatch(/\b\d{12,19}\b/)
      // the Factory's key is required
      expect((await t.call('/api/stripe/factory-event', { method: 'POST', json: { event: { type: 'checkout.session.completed', account: 'acct_salon', data: { object: { id: 'cs_1', mode: 'setup', metadata: sessionMeta.cs_1 } } } } })).status).toBe(401)
    })

    test('the client chart lists the card as brand and last four — never an id Stripe would accept', async () => {
      const r = await as('desk', `/api/card-on-file/clients/${client}/cards`)
      expect(r.status).toBe(200)
      expect(r.body.data).toHaveLength(1)
      expect(r.body.data[0]).toMatchObject({ brand: 'visa', last4: '4242', consentVia: 'staff_at_desk' })
      expect(JSON.stringify(r.body)).not.toContain('pm_')
      expect(JSON.stringify(r.body)).not.toContain('cus_')
    })
  })

  describe('charging a fee from The Book', () => {
    test('what can be charged, and why not: a scheduled appointment has no fee; a no-show and a late cancel do', async () => {
      const scheduled = await appt(48)
      const r = await as('desk', `/api/card-on-file/appointments/${scheduled.id}`)
      expect(r.status).toBe(200)
      expect(r.body.options.find((o: any) => o.kind === 'no_show')).toMatchObject({ amount: 20, available: false, why: 'Mark the appointment a no-show first.' })
      expect(r.body.card).toMatchObject({ brand: 'visa', last4: '4242' })
      const ns = await as('desk', `/api/card-on-file/appointments/${noShow.id}`)
      expect(ns.body.options.find((o: any) => o.kind === 'no_show')).toMatchObject({ amount: 20, available: true, why: null })
      // a stylist (no invoices access) is refused
      expect((await as('ana', `/api/card-on-file/appointments/${noShow.id}`)).status).toBe(403)
    })

    test('cancelling is stamped; a cancel inside the window is late (50% of $50), one well ahead is not', async () => {
      expect((await as('manager', `/api/appointments/${late.id}`, 'DELETE')).status).toBe(200)
      expect((await as('manager', `/api/appointments/${early.id}`, 'DELETE')).status).toBe(200)
      const [l] = await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, late.id))
      expect(l.cancelledAt).toBeInstanceOf(Date)
      const a = await as('desk', `/api/card-on-file/appointments/${late.id}`)
      expect(a.body.options.find((o: any) => o.kind === 'late_cancel')).toMatchObject({ amount: 25, available: true })
      const b = await as('desk', `/api/card-on-file/appointments/${early.id}`)
      const opt = b.body.options.find((o: any) => o.kind === 'late_cancel')
      expect(opt.available).toBe(false)
      expect(opt.why).toContain('not late')
    })

    test('a seat without invoices:update is refused by the server; the reason is required; the amount confirmed must be the fee', async () => {
      calls.length = 0
      for (const who of ['ana', 'desk']) expect((await as(who, `/api/card-on-file/appointments/${noShow.id}/charge`, 'POST', feeBody('no_show', 20))).status).toBe(403)
      let r = await as('manager', `/api/card-on-file/appointments/${noShow.id}/charge`, 'POST', feeBody('no_show', 20, ' '))
      expect([r.status, r.body.code]).toEqual([400, 'REASON_REQUIRED'])
      expect(r.body.fields.reason).toBeTruthy()
      r = await as('manager', `/api/card-on-file/appointments/${noShow.id}/charge`, 'POST', feeBody('no_show', 35))
      expect([r.status, r.body.code]).toEqual([409, 'FEE_CHANGED'])
      r = await as('manager', `/api/card-on-file/appointments/${late.id}/charge`, 'POST', feeBody('no_show', 20))
      expect([r.status, r.body.code]).toEqual([409, 'FEE_NOT_AVAILABLE'])
      expect(calls.filter((c) => c.what === 'charge')).toEqual([])
      expect(await chargesOf()).toEqual([])
    })

    test('one confirmed action charges the card on the salon\'s account, records the reason and emails the receipt', async () => {
      calls.length = 0
      sent.length = 0
      const r = await as('manager', `/api/card-on-file/appointments/${noShow.id}/charge`, 'POST', feeBody('no_show', 20))
      expect(r.status).toBe(201)
      expect(r.body).toMatchObject({ kind: 'no_show', amount: 20, status: 'succeeded', reason: 'Did not arrive and did not call', receipt: 'sent' })
      const charged = calls.filter((c) => c.what === 'charge')
      expect(charged).toHaveLength(1)
      expect(charged[0].opts.stripeAccount).toBe('acct_salon')
      expect(charged[0].args).toMatchObject({ amount: 2000, currency: 'usd', customer: 'cus_1', payment_method: 'pm_cs_1', off_session: true, confirm: true })
      expect(charged[0].args.metadata).toMatchObject({ kind: 'booking_fee', fee_kind: 'no_show', appointment_id: noShow.id })
      const rows = await chargesOf()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ status: 'succeeded', chargedByUserId: ids.manager, appointmentId: noShow.id })
      expect(rows[0].receiptSentAt).toBeInstanceOf(Date)
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({ to: 'casey@example.com', name: 'cardFeeReceipt' })
      expect(sent[0].data).toMatchObject({ amount: '20.00', reason: 'Did not arrive and did not call' })
      expect(sent[0].data.card).toBe('visa ending 4242')
    })

    test('a second click (or a retry) does not charge again', async () => {
      calls.length = 0
      const r = await as('manager', `/api/card-on-file/appointments/${noShow.id}/charge`, 'POST', feeBody('no_show', 20))
      expect([r.status, r.body.code]).toEqual([409, 'FEE_NOT_AVAILABLE'])
      expect(r.body.error).toBe('This fee has already been charged.')
      expect(calls.filter((c) => c.what === 'charge')).toEqual([])
      expect(await chargesOf()).toHaveLength(1)
    })

    test('a late-cancel fee that is a percent of the service price', async () => {
      calls.length = 0
      const r = await as('admin', `/api/card-on-file/appointments/${late.id}/charge`, 'POST', feeBody('late_cancel', 25, 'Cancelled the same morning'))
      expect(r.status).toBe(201)
      expect(calls.filter((c) => c.what === 'charge')[0].args.amount).toBe(2500)
    })

    test('a declined card is recorded and shown, not charged, no receipt; a retry after it is a new attempt', async () => {
      declining.add(declined.id)
      sent.length = 0
      const r = await as('manager', `/api/card-on-file/appointments/${declined.id}/charge`, 'POST', feeBody('no_show', 20))
      expect(r.status).toBe(201)
      expect(r.body).toMatchObject({ status: 'declined', failureMessage: 'Your card was declined.', receipt: 'not_charged' })
      expect(sent).toEqual([])
      // it can be tried again (a declined attempt is not "already charged"), and a card that now works is charged once
      declining.delete(declined.id)
      const again = await as('manager', `/api/card-on-file/appointments/${declined.id}/charge`, 'POST', feeBody('no_show', 20))
      expect(again.body.status).toBe('succeeded')
      const keys = calls.filter((c) => c.what === 'charge' && c.args.metadata.appointment_id === declined.id).map((c) => c.opts.idempotencyKey)
      expect(new Set(keys).size).toBe(2)
    })

    test('the client chart lists every charge with its reason', async () => {
      const r = await as('desk', `/api/card-on-file/clients/${client}/charges`)
      expect(r.status).toBe(200)
      expect(r.body.data.map((x: any) => x.status).sort()).toEqual(['declined', 'succeeded', 'succeeded', 'succeeded'])
      expect(r.body.data.every((x: any) => typeof x.reason === 'string' && x.reason.length > 0)).toBe(true)
    })
  })

  describe('whose account, and when the card is gone', () => {
    test('a card saved on a Stripe account the salon has since replaced is not charged', async () => {
      const spare = await appt(90, 'no_show')
      await t.db.update(t.schema.company).set({ integrations: { stripeAccountId: 'acct_new' } }).where(eq(t.schema.company.id, co))
      calls.length = 0
      const shown = await as('desk', `/api/card-on-file/appointments/${spare.id}`)
      expect(shown.body.card).toBeNull()
      const r = await as('manager', `/api/card-on-file/appointments/${spare.id}/charge`, 'POST', feeBody('no_show', 20))
      expect(r.status).toBe(409)
      expect(calls.filter((c) => c.what === 'charge')).toEqual([])
      expect((await as('desk', `/api/card-on-file/clients/${client}/cards`)).body.data).toEqual([])
      await t.db.update(t.schema.company).set({ integrations: { stripeAccountId: 'acct_salon' } }).where(eq(t.schema.company.id, co))
    })

    test('taking a card off the client stops it being charged; only the seat that charges may', async () => {
      const spare = await appt(100, 'no_show')
      const [card] = await cardsOf()
      for (const who of ['ana', 'desk']) expect((await as(who, `/api/card-on-file/cards/${card.id}`, 'DELETE')).status).toBe(403)
      expect((await as('manager', `/api/card-on-file/cards/${card.id}`, 'DELETE')).status).toBe(200)
      calls.length = 0
      const r = await as('manager', `/api/card-on-file/appointments/${spare.id}/charge`, 'POST', feeBody('no_show', 20))
      expect([r.status, r.body.code]).toEqual([409, 'FEE_NOT_AVAILABLE'])
      expect(calls.filter((c) => c.what === 'charge')).toEqual([])
    })

    test('the page Stripe sends a client back to opens without signing in, and keeps out of search engines', async () => {
      const r = await t.call('/card-saved')
      expect(r.status).toBe(200)
      expect(r.headers.get('x-robots-tag') || '').toContain('noindex')
      expect(await r.text()).toContain('Thank you')
      const c = await t.call('/card-saved?cancelled=1')
      expect(await c.text()).toContain('No card was saved')
    })

    test('with the feature off, none of it is reachable', async () => {
      await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'team', 'dashboard'] } as any).where(eq(t.schema.company.id, co))
      t.services.features.forgetFeatures()
      expect((await as('owner', '/api/card-on-file/policy')).status).not.toBe(200)
      expect((await as('owner', `/api/card-on-file/appointments/${noShow.id}`)).status).not.toBe(200)
    })
  })
})
