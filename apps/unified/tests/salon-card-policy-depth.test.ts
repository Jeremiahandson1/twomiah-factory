// Card policy depth (salon parity row 4; server/crm/salon/cardOnFile.ts, cardFees.ts, serviceMenu.ts): a service's own fee, a different fee for
// a new client, no fee under a minimum booking value, the opt-in automatic no-show charge, and a reverse button — against a fake Stripe.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PASSWORD = 'Policy-depth-1031'
const charges: any[] = [], refunds: Array<{ args: any; opts: any }> = []
let intents = 0
const byKey = new Map<string, any>()
const fakeStripe = {
  customers: { retrieve: async (id: string) => ({ id, deleted: false }), create: async () => ({ id: 'cus_1' }) },
  paymentIntents: {
    create: async (args: any, opts: any) => {
      charges.push({ args, opts })
      if (byKey.has(opts.idempotencyKey)) return byKey.get(opts.idempotencyKey)
      intents++
      const intent = { id: 'pi_' + intents, status: 'succeeded' }
      byKey.set(opts.idempotencyKey, intent)
      return intent
    },
  },
  refunds: { create: async (args: any, opts: any) => { refunds.push({ args, opts }); return { id: 're_' + refunds.length } } },
}

describe('salon: card policy depth', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tokens: Record<string, string> = {}
  let cut = '', colour = '', newbie = '', regular = ''
  const sent: Array<{ to: string; name: string; data: any }> = []
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)
  const appt = async (contactId: string, serviceId: string, status = 'scheduled', startsInHours = 48) =>
    (await t.db.insert(t.schema.appointment).values({ companyId: co, contactId, serviceId, status, startTime: new Date(Date.now() + startsInHours * 3600_000), endTime: new Date(Date.now() + (startsInHours + 1) * 3600_000) } as any).returning())[0]
  const optionsFor = async (id: string, who = 'owner') => (await as(who, `/api/card-on-file/appointments/${id}`)).body
  const noShowOption = async (id: string) => (await optionsFor(id)).options.find((o: any) => o.kind === 'no_show')
  const policy = (extra: Record<string, unknown> = {}) => ({ cardRequirement: 'all', noShowFeeAmount: 20, lateCancelWindowMinutes: 1440, lateCancelFeePercent: 50, ...extra })

  beforeAll(async () => {
    process.env.FACTORY_SYNC_KEY = 'factory-key'
    t = await bootTenant({ vertical: 'salon', stripe: fakeStripe })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: 'UTC', integrations: { stripeAccountId: 'acct_salon' }, enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'card_on_file', 'team', 'dashboard'] } as any).where(eq(t.schema.company.id, co))
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of Object.entries({ ana: 'field', desk: 'viewer', admin: 'admin', manager: 'manager' })) {
      const email = `${key}@test.example`
      await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co } as any)
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
    }
    cut = (await t.db.insert(t.schema.serviceMenu).values({ companyId: co, name: 'Cut', price: '50', durationMin: 60 } as any).returning())[0].id
    colour = (await t.db.insert(t.schema.serviceMenu).values({ companyId: co, name: 'Colour', price: '150', durationMin: 120 } as any).returning())[0].id
    newbie = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Nia Newbie', email: 'nia@example.com', type: 'client' } as any).returning())[0].id
    regular = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Rae Regular', email: 'rae@example.com', type: 'client' } as any).returning())[0].id
    for (const c of [newbie, regular]) {
      await t.db.insert(t.schema.clientCard).values({ companyId: co, contactId: c, stripeAccount: 'acct_salon', stripeCustomerId: 'cus_1', paymentMethodId: 'pm_' + c, brand: 'visa', last4: '4242', expMonth: 12, expYear: 2031, consentAt: new Date(), consentText: 'x', consentVia: 'staff_at_desk' } as any)
    }
    // Rae has been in before: a completed visit last month. Nia never has.
    await t.db.insert(t.schema.appointment).values({ companyId: co, contactId: regular, serviceId: cut, status: 'completed', startTime: hoursAgo(24 * 30), endTime: hoursAgo(24 * 30 - 1) } as any)
    const real = t.services.email.send.bind(t.services.email)
    ;(t.services.email as any).send = async (to: string, name: string, data: any) => { sent.push({ to, name, data }); return real(to, name, data) }
    expect((await as('owner', '/api/card-on-file/policy', 'PUT', policy())).status).toBe(200)
  }, 120_000)

  test('the policy keeps the new fees, the minimum and the automatic switch; wrong boxes are named and nothing bad is saved', async () => {
    const ok = await as('owner', '/api/card-on-file/policy', 'PUT', policy({ noShowFeeNewCents: 4000, lateCancelFeeNewPercent: 100, minBookingValueCents: 3000, autoChargeNoShow: false }))
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ noShowFeeNewCents: 4000, lateCancelFeeNewPercent: 100, minBookingValueCents: 3000, autoChargeNoShow: false })
    expect(ok.body.words).toContain('first visit')
    expect(ok.body.words).toContain('$30 or more')
    const bad = async (extra: any) => (await as('owner', '/api/card-on-file/policy', 'PUT', policy(extra)))
    let r = await bad({ noShowFeeNewCents: 4000, noShowFeeNewPercent: 50 })
    expect(Object.keys(r.body.fields)).toContain('noShowFeeNewCents')
    r = await bad({ noShowFeeNewCents: 10 }); expect(r.status).toBe(400)
    r = await bad({ minBookingValueCents: 50 }); expect(Object.keys(r.body.fields)).toContain('minBookingValueCents')
    r = await bad({ autoChargeNoShow: 'yes' }); expect(Object.keys(r.body.fields)).toContain('autoChargeNoShow')
    r = await as('owner', '/api/card-on-file/policy', 'PUT', { cardRequirement: 'all', lateCancelWindowMinutes: 1440, lateCancelFeePercent: 50, autoChargeNoShow: true })
    expect(r.body.fields.autoChargeNoShow).toBe('Set a no-show fee before charging it automatically.')
    expect((await as('owner', '/api/card-on-file/policy')).body).toMatchObject({ noShowFeeNewCents: 4000, minBookingValueCents: 3000 })
    // only the owner or an admin; a stylist, the front desk and a manager are refused
    for (const who of ['ana', 'desk', 'manager']) expect((await as(who, '/api/card-on-file/policy', 'PUT', policy())).status).toBe(403)
  })

  test('a new client is shown the new-client fee, a returning one the regular fee', async () => {
    const forNew = await noShowOption((await appt(newbie, cut, 'no_show')).id)
    const forRegular = await noShowOption((await appt(regular, cut, 'no_show')).id)
    expect([forNew.amount, forNew.basis, forNew.available]).toEqual([40, 'new_client', true])
    expect([forRegular.amount, forRegular.basis]).toEqual([20, 'salon'])
    expect((await optionsFor((await appt(newbie, cut, 'no_show')).id)).isNewClient).toBe(true)
  })

  test("a service's own fee beats both; only the owner or an admin sets it", async () => {
    const asManager = await as('manager', `/api/service-menu/${colour}`, 'PUT', { noShowFeeCents: 6000 })
    expect([403]).toContain(asManager.status)
    expect((await as('ana', `/api/service-menu/${colour}`, 'PUT', { noShowFeeCents: 6000 })).status).toBe(403)
    const set = await as('admin', `/api/service-menu/${colour}`, 'PUT', { noShowFeeCents: 6000 })
    expect([set.status, set.body.noShowFeeCents]).toEqual([200, 6000])
    const forNew = await noShowOption((await appt(newbie, colour, 'no_show')).id)
    const forRegular = await noShowOption((await appt(regular, colour, 'no_show')).id)
    expect([forNew.amount, forNew.basis, forRegular.amount, forRegular.basis]).toEqual([60, 'service', 60, 'service'])
    // a percent of the service's price; both at once is refused in words
    expect((await as('admin', `/api/service-menu/${colour}`, 'PUT', { noShowFeeCents: null, noShowFeePercent: 20 })).status).toBe(200)
    expect((await noShowOption((await appt(regular, colour, 'no_show')).id)).amount).toBe(30)
    const both = await as('admin', `/api/service-menu/${colour}`, 'PUT', { noShowFeeCents: 6000, noShowFeePercent: 20 })
    expect([both.status, both.body.code, Object.keys(both.body.fields)]).toEqual([400, 'VALIDATION', ['noShowFeeCents']])
    // a service without its own still takes the salon's
    expect((await noShowOption((await appt(regular, cut, 'no_show')).id)).amount).toBe(20)
    // the policy now says some services have their own
    expect((await as('owner', '/api/card-on-file/policy')).body.words).toContain('Some services have a fee of their own')
    // clearing it goes back to the salon's
    expect((await as('admin', `/api/service-menu/${colour}`, 'PUT', { noShowFeeCents: null, noShowFeePercent: null })).status).toBe(200)
    expect((await noShowOption((await appt(regular, colour, 'no_show')).id)).basis).toBe('salon')
  })

  test('under the minimum booking value there is no fee, said in words; the charge is refused too', async () => {
    expect((await as('owner', '/api/card-on-file/policy', 'PUT', policy({ minBookingValueCents: 6000 }))).status).toBe(200)
    const a = await appt(regular, cut, 'no_show')      // a $50 cut
    const opt = await noShowOption(a.id)
    expect([opt.available, opt.amount]).toEqual([false, null])
    expect(opt.why).toBe('This booking is worth $50, under the $60 minimum, so no no-show fee applies.')
    const before = charges.length
    const r = await as('owner', `/api/card-on-file/appointments/${a.id}/charge`, 'POST', { kind: 'no_show', amount: 20, reason: 'Did not arrive' })
    expect([r.status, r.body.code]).toEqual([409, 'FEE_NOT_AVAILABLE'])
    expect(charges.length).toBe(before)
    // a $150 colour is over it
    expect((await noShowOption((await appt(regular, colour, 'no_show')).id)).available).toBe(true)
    expect((await as('owner', '/api/card-on-file/policy', 'PUT', policy({ minBookingValueCents: null }))).status).toBe(200)
  })

  test('automatic no-show charge: off by default (marking a no-show charges nothing); on, it charges once with the receipt and the ledger row', async () => {
    const a = await appt(regular, cut, 'scheduled', -2)
    const marked = await as('owner', `/api/appointments/${a.id}`, 'PUT', { status: 'no_show' })
    expect(marked.status).toBe(200)
    expect(marked.body.autoFee).toBeUndefined()
    expect(charges.filter((c) => c.args.metadata.appointment_id === a.id)).toHaveLength(0)

    expect((await as('owner', '/api/card-on-file/policy', 'PUT', policy({ autoChargeNoShow: true }))).status).toBe(200)
    const b = await appt(regular, cut, 'scheduled', -2)
    const sentBefore = sent.length
    const on = await as('ana', `/api/appointments/${b.id}`, 'PUT', { status: 'no_show' })
    expect(on.status).toBe(200)
    expect(on.body.autoFee).toMatchObject({ charged: true, status: 'succeeded', amount: 20 })
    const mine = charges.filter((c) => c.args.metadata.appointment_id === b.id)
    expect(mine).toHaveLength(1)
    expect(mine[0].args.amount).toBe(2000)
    expect(mine[0].opts.stripeAccount).toBe('acct_salon')
    const rows = await t.db.select().from(t.schema.cardFeeCharge).where(eq(t.schema.cardFeeCharge.appointmentId, b.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'auto', status: 'succeeded', kind: 'no_show' })
    expect(rows[0].reason).toContain('automatically')
    expect(rows[0].receiptSentAt).toBeInstanceOf(Date)
    expect(sent.slice(sentBefore).filter((m) => m.name === 'cardFeeReceipt')).toHaveLength(1)
    // marking it a no-show again changes nothing and charges nothing more
    await as('owner', `/api/appointments/${b.id}`, 'PUT', { status: 'no_show' })
    expect(charges.filter((c) => c.args.metadata.appointment_id === b.id)).toHaveLength(1)
    // the ledger says which were automatic
    const ledger = (await as('owner', `/api/card-on-file/clients/${regular}/charges`)).body.data
    expect(ledger.find((x: any) => x.appointmentId === b.id).source).toBe('auto')
  })

  test('automatic charge says why when it cannot: no card, or under the minimum — the no-show is still marked', async () => {
    const stranger = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'No Card', email: 'nocard@example.com', type: 'client' } as any).returning())[0].id
    const a = await appt(stranger, cut, 'scheduled', -2)
    const r = await as('owner', `/api/appointments/${a.id}`, 'PUT', { status: 'no_show' })
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('no_show')
    expect(r.body.autoFee).toMatchObject({ charged: false, status: 'not_charged', message: 'This client has no card on file.' })
    await as('owner', '/api/card-on-file/policy', 'PUT', policy({ autoChargeNoShow: true, minBookingValueCents: 6000 }))
    const b = await appt(regular, cut, 'scheduled', -2)
    const under = await as('owner', `/api/appointments/${b.id}`, 'PUT', { status: 'no_show' })
    expect(under.body.autoFee.message).toContain('under the $60 minimum')
    await as('owner', '/api/card-on-file/policy', 'PUT', policy({ autoChargeNoShow: false }))
  })

  test('reverse: a fee that went through goes back to the card once, with who and why; the row stays; a person can charge again', async () => {
    const a = await appt(regular, cut, 'no_show')
    const done = await as('owner', `/api/card-on-file/appointments/${a.id}/charge`, 'POST', { kind: 'no_show', amount: 20, reason: 'Did not arrive' })
    expect(done.status).toBe(201)
    const id = done.body.id
    // refused: no reason, not the charging seat
    expect((await as('owner', `/api/card-on-file/charges/${id}/reverse`, 'POST', { reason: 'x' })).body.code).toBe('REASON_REQUIRED')
    expect((await as('desk', `/api/card-on-file/charges/${id}/reverse`, 'POST', { reason: 'Client was in hospital' })).status).toBe(403)
    expect((await as('ana', `/api/card-on-file/charges/${id}/reverse`, 'POST', { reason: 'Client was in hospital' })).status).toBe(403)
    expect(refunds).toHaveLength(0)
    const rev = await as('owner', `/api/card-on-file/charges/${id}/reverse`, 'POST', { reason: 'Client was in hospital' })
    expect([rev.status, rev.body.reversalReason]).toEqual([200, 'Client was in hospital'])
    expect(rev.body.reversedAt).toBeTruthy()
    expect(refunds).toHaveLength(1)
    expect(refunds[0].args).toEqual({ payment_intent: done.body ? (await t.db.select().from(t.schema.cardFeeCharge).where(eq(t.schema.cardFeeCharge.id, id)))[0].paymentIntentId : '' })
    expect(refunds[0].opts.stripeAccount).toBe('acct_salon')
    const row = (await t.db.select().from(t.schema.cardFeeCharge).where(eq(t.schema.cardFeeCharge.id, id)))[0]
    expect(row.refundedAt).toBeInstanceOf(Date)
    expect(row.refundedByUserId).toBeTruthy()
    // once
    const again = await as('owner', `/api/card-on-file/charges/${id}/reverse`, 'POST', { reason: 'Client was in hospital' })
    expect([again.status, again.body.code]).toEqual([409, 'ALREADY_REVERSED'])
    expect(refunds).toHaveLength(1)
    // a declined or unknown charge cannot be reversed
    expect((await as('owner', '/api/card-on-file/charges/nope/reverse', 'POST', { reason: 'Client was in hospital' })).status).toBe(404)
    // the reversed fee is open to charge again (it was reversed, not standing)
    expect((await noShowOption(a.id)).available).toBe(true)
    const second = await as('owner', `/api/card-on-file/appointments/${a.id}/charge`, 'POST', { kind: 'no_show', amount: 20, reason: 'Charged again after a call' })
    expect(second.status).toBe(201)
    expect((await noShowOption(a.id)).why).toBe('This fee has already been charged.')
  })
})
