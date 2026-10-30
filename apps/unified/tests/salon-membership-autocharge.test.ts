// Memberships that charge the client's card on file (salon gap #2; server/crm/salon/membershipBilling.ts), through the real
// server and the real logins against a fake Stripe. The money rule: a member is charged only when the salon turned it on
// WITH the client's agreement, only on the SALON'S connected Stripe account, once per period (a double run, a retry after a
// crash, a repeated click cannot charge twice), and a decline never silently loses the invoice — it stays open and the
// member is told. Without the switch, a membership raises an open invoice exactly as before.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PASSWORD = 'Auto-charge-1030'

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

describe('salon: memberships charged to the card on file', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}
  let plan = ''
  const sent: Array<{ to: string; name: string; data: any }> = []
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  const client = async (name: string, withCard = true) => {
    const c = await ins(t.schema.contact, { companyId: co, name, email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`, type: 'client' })
    if (withCard) await ins(t.schema.clientCard, { companyId: co, contactId: c.id, stripeAccount: 'acct_salon', stripeCustomerId: 'cus_' + c.id, paymentMethodId: 'pm_' + c.id, brand: 'visa', last4: '4242', expMonth: 12, expYear: 2031, consentAt: new Date(), consentText: 'policy', consentVia: 'staff_at_desk' })
    return c.id as string
  }
  const enrol = (who: string, contactId: string, extra: Record<string, unknown> = {}) => as(who, '/api/memberships/enrollments', 'POST', { planId: plan, contactId, ...extra })
  const agreed = { autoCharge: true, clientAgreed: true }
  const enrolment = async (id: string) => (await t.db.select().from(t.schema.membershipEnrollment).where(eq(t.schema.membershipEnrollment.id, id)))[0]
  const ledger = async (enrollmentId: string) => (await t.db.select().from(t.schema.membershipCharge).where(eq(t.schema.membershipCharge.enrollmentId, enrollmentId))).sort((a: any, b: any) => a.attempt - b.attempt)
  const invoiceOf = async (id: string) => (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, id)))[0]
  const paymentsOf = async (invoiceId: string) => t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, invoiceId))
  const charges = () => calls.filter((c) => c.args.metadata.kind === 'membership')
  const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)
  /** Make the member's next period due now. */
  const dueNow = async (enrollmentId: string) => t.db.update(t.schema.membershipEnrollment).set({ renewsAt: ymd(1), lastBilledFor: ymd(32) } as any).where(eq(t.schema.membershipEnrollment.id, enrollmentId))
  const backdateTries = async (enrollmentId: string, days: number) =>
    t.db.update(t.schema.membershipCharge).set({ updatedAt: new Date(Date.now() - days * 86400000) } as any).where(eq(t.schema.membershipCharge.enrollmentId, enrollmentId))
  const settle = () => as('owner', '/api/memberships/enrollments')

  beforeAll(async () => {
    process.env.FACTORY_SYNC_KEY = 'factory-key'
    t = await bootTenant({ vertical: 'salon', stripe: fakeStripe })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: 'UTC', integrations: { stripeAccountId: 'acct_salon' }, enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'salon_memberships', 'card_on_file', 'team', 'dashboard'] } as any).where(eq(t.schema.company.id, co))
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of Object.entries({ ana: 'field', manager: 'manager' })) {
      const email = `${key}@test.example`
      const u = await ins(t.schema.user, { email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
    }
    await t.db.update(t.schema.company).set({ email: 'salon@example.com' } as any).where(eq(t.schema.company.id, co))
    plan = (await ins(t.schema.membershipPlan, { companyId: co, name: 'Glow Club', price: '60', billingCycle: 'monthly' })).id
    const real = t.services.email.send.bind(t.services.email)
    ;(t.services.email as any).send = async (to: string, name: string, data: any) => { sent.push({ to, name, data }); return real(to, name, data) }
  }, 120_000)

  test('without the switch, a membership raises an open invoice and charges nothing — as before', async () => {
    const c = await client('Plain Pat')
    const r = await enrol('manager', c)
    expect(r.status).toBe(201)
    expect(r.body.autoCharge).toBe(false)
    expect((await invoiceOf(r.body.invoiceId)).status).toBe('open')
    expect(charges()).toEqual([])
    await dueNow(r.body.id)
    await settle()
    expect(charges()).toEqual([])
  })

  test('turning it on needs a seat that takes payments, the client\'s agreement, Card on File, and a card', async () => {
    const withCard = await client('Careful Cam')
    const noCard = await client('Cardless Cleo', false)
    // a stylist can enrol a member, but not set up charging
    let r = await enrol('ana', withCard, agreed)
    expect([r.status]).toEqual([403])
    // the agreement must be ticked
    r = await enrol('manager', withCard, { autoCharge: true })
    expect([r.status, r.body.code]).toEqual([400, 'CONSENT_REQUIRED'])
    // a client with no card has nothing to charge
    r = await enrol('manager', noCard, agreed)
    expect([r.status, r.body.code]).toEqual([409, 'NO_CARD'])
    // Card on File switched off
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'salon_memberships', 'team', 'dashboard'] } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    r = await enrol('manager', withCard, agreed)
    expect([r.status, r.body.code]).toEqual([409, 'FEATURE_OFF'])
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'salon_memberships', 'card_on_file', 'team', 'dashboard'] } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    expect(charges()).toEqual([])
    expect((await t.db.select().from(t.schema.membershipEnrollment).where(eq(t.schema.membershipEnrollment.contactId, withCard)))).toEqual([])
  })

  test('enrolled with auto-charge: the first period is charged to the card on the salon\'s own account, the invoice is paid, a receipt goes out', async () => {
    const c = await client('Happy Hana')
    calls.length = 0; sent.length = 0
    const r = await enrol('manager', c, agreed)
    expect(r.status).toBe(201)
    expect(r.body.autoCharge).toBe(true)
    expect(r.body.autoChargeResult).toBe('paid')
    expect(r.body.autoChargeConsentUserId).toBe(ids.manager)
    expect(charges()).toHaveLength(1)
    const call = charges()[0]
    // the salon's account, never ours; the card Stripe saved, off-session, the invoice's total
    expect(call.opts.stripeAccount).toBe('acct_salon')
    expect(call.args).toMatchObject({ amount: 6000, off_session: true, confirm: true, customer: 'cus_' + c, payment_method: 'pm_' + c })
    expect(call.opts.idempotencyKey).toBe(`membership:${r.body.invoiceId}:1`)
    const inv = await invoiceOf(r.body.invoiceId)
    expect(inv.status).toBe('paid')
    const pays = await paymentsOf(inv.id)
    expect(pays).toHaveLength(1)
    expect([pays[0].method, pays[0].reference, Number(pays[0].amount)]).toEqual(['card', 'pi_' + intents, 60])
    expect((await ledger(r.body.id)).map((x: any) => x.status)).toEqual(['succeeded'])
    expect(sent.filter((m) => m.name === 'membershipCharged').map((m) => m.to)).toEqual(['happyhana@example.com'])
    // Stripe's own "payment succeeded" arriving later adds nothing
    expect((await paymentsOf(inv.id))).toHaveLength(1)
  })

  test('a renewal is charged once however many times billing runs', async () => {
    const c = await client('Regular Reese')
    const r = await enrol('manager', c, agreed)
    calls.length = 0
    await dueNow(r.body.id)
    await Promise.all([settle(), settle(), as('owner', '/api/memberships/billing/run', 'POST')])
    await settle()
    expect(charges()).toHaveLength(1)
    const rows = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.contactId, c))
    expect(rows).toHaveLength(2)
    expect(rows.map((x: any) => x.status).sort()).toEqual(['paid', 'paid'])
  })

  test('a decline leaves the invoice open, tells the member, waits, then tries again with a new key and succeeds', async () => {
    const c = await client('Declined Dee')
    declining.add(c)
    calls.length = 0; sent.length = 0
    const r = await enrol('manager', c, agreed)
    expect(r.body.autoChargeResult).toBe('declined')
    expect((await invoiceOf(r.body.invoiceId)).status).toBe('open')
    expect((await ledger(r.body.id)).map((x: any) => [x.attempt, x.status])).toEqual([[1, 'declined']])
    expect(sent.filter((m) => m.name === 'membershipPaymentFailed')).toHaveLength(1)
    expect(sent.find((m) => m.name === 'membershipPaymentFailed')!.data.next).toContain('try again')
    // too soon: not tried again
    await settle()
    expect(charges()).toHaveLength(1)
    // the card is fine now; three days on, it is tried again — under a new key, so Stripe does not replay the decline
    declining.delete(c)
    await backdateTries(r.body.id, 4)
    await settle()
    await settle()
    expect(charges()).toHaveLength(2)
    expect(charges().map((x) => x.opts.idempotencyKey)).toEqual([`membership:${r.body.invoiceId}:1`, `membership:${r.body.invoiceId}:2`])
    expect((await invoiceOf(r.body.invoiceId)).status).toBe('paid')
    expect((await paymentsOf(r.body.invoiceId))).toHaveLength(1)
    expect((await ledger(r.body.id)).map((x: any) => x.status)).toEqual(['declined', 'succeeded'])
  })

  test('three declines PAUSE the membership: no credits, no new invoices, the invoice stays open, the member gets a card link, the salon is told', async () => {
    const c = await client('Hopeless Hal')
    declining.add(c)
    calls.length = 0; sent.length = 0
    const r = await enrol('manager', c, agreed)
    for (let i = 0; i < 2; i++) { await backdateTries(r.body.id, 4 * (i + 1)); await settle() }
    expect((await ledger(r.body.id)).map((x: any) => x.status)).toEqual(['declined', 'declined', 'declined'])
    const row = await enrolment(r.body.id)
    expect(row.status).toBe('paused')
    expect(row.pausedForPaymentAt).toBeTruthy()
    expect(row.autoCharge).toBe(true)                          // the agreement stands: a new card is charged on resume
    // the member: told, with a private link; the salon: told too
    const toMember = sent.filter((m) => m.name === 'membershipPaused')
    expect(toMember).toHaveLength(1)
    expect(toMember[0].data.link).toBe(`${process.env.PUBLIC_URL || toMember[0].data.link.split('/api/')[0]}/api/member-card/${row.cardUpdateToken}`)
    expect(sent.filter((m) => m.name === 'membershipPausedSalon')).toHaveLength(1)
    // nothing more is tried, however long we wait
    const before = charges().length
    await backdateTries(r.body.id, 30)
    await settle(); await settle()
    expect(charges()).toHaveLength(before)
    expect((await invoiceOf(r.body.invoiceId)).status).toBe('open')
    // no credits while unpaid, and no renewal invoice raised for a paused member
    await t.db.update(t.schema.membershipEnrollment).set({ creditsRemaining: 3 } as any).where(eq(t.schema.membershipEnrollment.id, r.body.id))
    const spend = await as('manager', `/api/memberships/enrollments/${r.body.id}/redeem`, 'POST')
    expect(spend.status).toBe(400)
    expect((await enrolment(r.body.id)).creditsRemaining).toBe(3)
    await dueNow(r.body.id)
    await settle()
    expect(await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.contactId, c))).toHaveLength(1)
    declining.delete(c)
  })

  test('the member\'s private card link: bad link 404; the page opens Stripe on the salon\'s account; the new card restarts the membership and pays the open invoice', async () => {
    const c = await client('Updating Uma')
    declining.add(c)
    const r = await enrol('manager', c, agreed)
    for (let i = 0; i < 2; i++) { await backdateTries(r.body.id, 4 * (i + 1)); await settle() }
    const token = (await enrolment(r.body.id)).cardUpdateToken as string
    expect(token).toBeTruthy()
    expect((await t.call('/api/member-card/not-a-real-token-at-all-1234')).status).toBe(404)
    const pageRes = await t.call(`/api/member-card/${token}`)
    expect(pageRes.status).toBe(200)
    expect(await pageRes.text()).toContain('Update my card')
    sessionCalls.length = 0
    const go = await t.call(`/api/member-card/${token}`, { method: 'POST', redirect: 'manual' } as any)
    expect(go.status).toBe(303)
    expect(go.headers.get('location')).toStartWith('https://checkout.stripe.com/c/setup/')
    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0].opts.stripeAccount).toBe('acct_salon')   // the salon's own account, never Twomiah's
    const sid = go.headers.get('location')!.split('/').pop()!
    expect(sessionMeta[sid].membership_enrollment_id).toBe(r.body.id)
    // the card is good now; Stripe tells us the page was finished
    declining.delete(c)
    calls.length = 0
    const done = await t.call('/api/stripe/factory-event', {
      method: 'POST', headers: { 'X-Factory-Key': 'factory-key' },
      json: { event: { type: 'checkout.session.completed', account: 'acct_salon', data: { object: { id: sid, mode: 'setup', metadata: sessionMeta[sid] } } } },
    })
    expect(done.status).toBe(200)
    const row = await enrolment(r.body.id)
    expect(row.status).toBe('active')
    expect(row.cardUpdateToken).toBeNull()
    expect(row.pausedForPaymentAt).toBeNull()
    expect((await invoiceOf(r.body.invoiceId)).status).toBe('paid')
    expect(charges()).toHaveLength(1)
    expect(charges()[0].args.payment_method).toBe(`pm_${sid}`)       // the NEW card
    // the link is spent
    expect((await t.call(`/api/member-card/${token}`)).status).toBe(404)
    // Stripe repeating the event charges nothing more
    await t.call('/api/stripe/factory-event', {
      method: 'POST', headers: { 'X-Factory-Key': 'factory-key' },
      json: { event: { type: 'checkout.session.completed', account: 'acct_salon', data: { object: { id: sid, mode: 'setup', metadata: sessionMeta[sid] } } } },
    })
    expect(charges()).toHaveLength(1)
  })

  test('resume by hand: a seat without payment rights is refused; one with them restarts it; a card that still declines pauses it again', async () => {
    const c = await client('Resuming Rex')
    declining.add(c)
    const r = await enrol('manager', c, agreed)
    for (let i = 0; i < 2; i++) { await backdateTries(r.body.id, 4 * (i + 1)); await settle() }
    expect((await enrolment(r.body.id)).status).toBe('paused')
    const refused = await as('ana', `/api/memberships/enrollments/${r.body.id}/resume`, 'POST')
    expect(refused.status).toBe(403)
    expect((await enrolment(r.body.id)).status).toBe('paused')
    // still declining: one fresh try, then paused again with a new link
    const oldToken = (await enrolment(r.body.id)).cardUpdateToken
    const again = await as('manager', `/api/memberships/enrollments/${r.body.id}/resume`, 'POST')
    expect(again.status).toBe(200)
    const row = await enrolment(r.body.id)
    expect(row.status).toBe('paused')
    expect(row.cardUpdateToken).not.toBe(oldToken)
    expect((await ledger(r.body.id)).map((x: any) => x.status)).toEqual(['declined', 'declined', 'declined', 'declined'])
    // the card works now
    declining.delete(c)
    const ok = await as('manager', `/api/memberships/enrollments/${r.body.id}/resume`, 'POST')
    expect(ok.status).toBe(200)
    expect((await enrolment(r.body.id)).status).toBe('active')
    expect((await invoiceOf(r.body.invoiceId)).status).toBe('paid')
    // not paused any more: nothing to resume
    expect((await as('manager', `/api/memberships/enrollments/${r.body.id}/resume`, 'POST')).status).toBe(409)
  })

  test('a try that died half-way is resumed under the same key — Stripe cannot charge it twice', async () => {
    const c = await client('Crashed Cory')
    const r = await enrol('manager', c)            // an open invoice, no auto-charge yet
    const inv = await invoiceOf(r.body.invoiceId)
    await t.db.update(t.schema.membershipEnrollment).set({ autoCharge: true } as any).where(eq(t.schema.membershipEnrollment.id, r.body.id))
    // The earlier run asked Stripe (which took the money) and died before writing anything but its claim.
    const key = `membership:${inv.id}:1`
    byKey.set(key, { id: 'pi_earlier', status: 'succeeded' })
    const card = (await t.db.select().from(t.schema.clientCard).where(eq(t.schema.clientCard.contactId, c)))[0]
    await ins(t.schema.membershipCharge, { companyId: co, enrollmentId: r.body.id, invoiceId: inv.id, contactId: c, cardId: card.id, period: ymd(0), attempt: 1, amount: '60', status: 'pending', updatedAt: new Date(Date.now() - 600_000) })
    const intentsBefore = intents
    await settle()
    expect(intents).toBe(intentsBefore)                       // Stripe made no new charge
    expect(calls.filter((x) => x.opts.idempotencyKey === key).length).toBeGreaterThan(0)
    expect((await invoiceOf(inv.id)).status).toBe('paid')
    expect((await paymentsOf(inv.id)).map((p: any) => p.reference)).toEqual(['pi_earlier'])
    expect((await ledger(r.body.id)).map((x: any) => x.status)).toEqual(['succeeded'])
  })

  test('a try still in flight is left alone', async () => {
    const c = await client('Busy Bea')
    const r = await enrol('manager', c)
    const inv = await invoiceOf(r.body.invoiceId)
    await t.db.update(t.schema.membershipEnrollment).set({ autoCharge: true } as any).where(eq(t.schema.membershipEnrollment.id, r.body.id))
    const card = (await t.db.select().from(t.schema.clientCard).where(eq(t.schema.clientCard.contactId, c)))[0]
    await ins(t.schema.membershipCharge, { companyId: co, enrollmentId: r.body.id, invoiceId: inv.id, contactId: c, cardId: card.id, period: ymd(0), attempt: 1, amount: '60', status: 'pending' })
    calls.length = 0
    await settle()
    expect(charges()).toEqual([])
  })

  test('a card taken off ends auto-charge for the member at the next renewal, and says so', async () => {
    const c = await client('Removed Rae')
    const r = await enrol('manager', c, agreed)
    await t.db.update(t.schema.clientCard).set({ removedAt: new Date() } as any).where(eq(t.schema.clientCard.contactId, c))
    calls.length = 0; sent.length = 0
    await dueNow(r.body.id)
    await settle()
    expect(charges()).toEqual([])
    expect((await enrolment(r.body.id)).autoCharge).toBe(false)
    expect(sent.filter((m) => m.name === 'membershipPaymentFailed')).toHaveLength(1)
    const open = await t.db.select().from(t.schema.invoice).where(and(eq(t.schema.invoice.contactId, c), eq(t.schema.invoice.status, 'open')))
    expect(open).toHaveLength(1)
  })

  test('stopping auto-charge is open to whoever updates members; starting it again needs the same checks', async () => {
    const c = await client('Switch Sam')
    const r = await enrol('manager', c, agreed)
    expect((await as('ana', `/api/memberships/enrollments/${r.body.id}/auto-charge`, 'PUT', { on: false })).status).toBe(200)
    expect((await enrolment(r.body.id)).autoCharge).toBe(false)
    calls.length = 0
    await dueNow(r.body.id)
    await settle()
    expect(charges()).toEqual([])
    expect((await as('ana', `/api/memberships/enrollments/${r.body.id}/auto-charge`, 'PUT', { on: true, clientAgreed: true })).status).toBe(403)
    expect((await as('manager', `/api/memberships/enrollments/${r.body.id}/auto-charge`, 'PUT', { on: true })).body.code).toBe('CONSENT_REQUIRED')
    const back = await as('manager', `/api/memberships/enrollments/${r.body.id}/auto-charge`, 'PUT', { on: true, clientAgreed: true })
    expect(back.status).toBe(200)
    expect(back.body.autoChargeConsentUserId).toBe(ids.manager)
  })

  test('moving the membership to another client ends the first client\'s agreement', async () => {
    const a = await client('Original Orla'), b = await client('Other Otto')
    const r = await enrol('manager', a, agreed)
    expect((await as('manager', `/api/memberships/enrollments/${r.body.id}`, 'PUT', { contactId: b })).status).toBe(200)
    expect((await enrolment(r.body.id)).autoCharge).toBe(false)
  })

  test('the list says what happened to a member\'s last charge, with no amounts or card ids', async () => {
    const c = await client('Listed Lou')
    declining.add(c)
    const r = await enrol('manager', c, agreed)
    declining.delete(c)
    const row = (await as('manager', `/api/memberships/enrollments?contactId=${c}`)).body.data.find((x: any) => x.id === r.body.id)
    expect(row.autoCharge).toBe(true)
    expect(row.lastCharge).toMatchObject({ status: 'declined', attempt: 1 })
    expect(JSON.stringify(row.lastCharge)).not.toMatch(/pm_|cus_|pi_/)
  })

  test('every charge went to the salon\'s own account', async () => {
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.opts.stripeAccount).toBe('acct_salon')
  })
})
