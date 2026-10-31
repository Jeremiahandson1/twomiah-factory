// Membership charge recovery (salon parity row 6; Fresha, Boulevard): "Retry now" before the last decline, a staff email on EVERY decline to the
// seats that hold the payments permission, the salon's own number of tries and days between them, and a backup card tried when the main card
// is declined. Real server, fake Stripe that declines by card (payment method) so a backup can pay.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PASSWORD = 'Retry-now-1031'

const calls: Array<{ args: any; opts: any }> = []
let intents = 0
const byKey = new Map<string, any>()
const declinedCards = new Set<string>()
const fakeStripe = {
  customers: { retrieve: async (id: string) => ({ id, deleted: false }), create: async () => ({ id: 'cus_1' }) },
  paymentIntents: {
    create: async (args: any, opts: any) => {
      calls.push({ args, opts })
      if (byKey.has(opts.idempotencyKey)) return byKey.get(opts.idempotencyKey)
      intents++
      if (declinedCards.has(args.payment_method)) throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined', payment_intent: { id: 'pi_declined_' + intents } })
      const intent = { id: 'pi_' + intents, status: 'succeeded' }
      byKey.set(opts.idempotencyKey, intent)
      return intent
    },
  },
}

describe('salon: membership charge recovery', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tokens: Record<string, string> = {}
  const sent: Array<{ to: string; name: string; data: any }> = []
  let plan = ''
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  let cardNo = 0
  /** A client with cards on file: pms are named, the LAST one added is the main card (newest first). */
  const client = async (name: string, pms: string[] = []) => {
    const c = await ins(t.schema.contact, { companyId: co, name, email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`, type: 'client' })
    for (const pm of pms) {
      cardNo++
      await ins(t.schema.clientCard, { companyId: co, contactId: c.id, stripeAccount: 'acct_salon', stripeCustomerId: 'cus_' + c.id, paymentMethodId: pm, brand: 'visa', last4: String(1000 + cardNo), expMonth: 12, expYear: 2031, consentAt: new Date(Date.now() + cardNo * 1000), consentText: 'ok', consentVia: 'staff_at_desk', createdAt: new Date(Date.now() + cardNo * 1000) })
    }
    return c.id as string
  }
  const agreed = { autoCharge: true, clientAgreed: true }
  const enrol = (contactId: string) => as('manager', '/api/memberships/enrollments', 'POST', { planId: plan, contactId, ...agreed })
  const ledger = async (enrollmentId: string) => (await t.db.select().from(t.schema.membershipCharge).where(eq(t.schema.membershipCharge.enrollmentId, enrollmentId))).sort((a: any, b: any) => a.attempt - b.attempt)
  const enrolment = async (id: string) => (await t.db.select().from(t.schema.membershipEnrollment).where(eq(t.schema.membershipEnrollment.id, id)))[0]
  const invoiceOf = async (id: string) => (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, id)))[0]
  const charges = () => calls.filter((c) => c.args.metadata.kind === 'membership')
  const backdate = (enrollmentId: string, days: number) => t.db.update(t.schema.membershipCharge).set({ updatedAt: new Date(Date.now() - days * 86400000) } as any).where(eq(t.schema.membershipCharge.enrollmentId, enrollmentId))

  beforeAll(async () => {
    process.env.FACTORY_SYNC_KEY = 'factory-key'
    t = await bootTenant({ vertical: 'salon', stripe: fakeStripe })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: 'UTC', email: 'salon@example.com', integrations: { stripeAccountId: 'acct_salon' }, enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'salon_memberships', 'card_on_file'] } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of Object.entries({ ana: 'field', manager: 'manager', admin: 'admin', desk: 'viewer' })) {
      const email = `${key}@test.example`
      await ins(t.schema.user, { email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
    }
    plan = (await ins(t.schema.membershipPlan, { companyId: co, name: 'Glow Club', price: '60', billingCycle: 'monthly' })).id
    const real = t.services.email.send.bind(t.services.email)
    ;(t.services.email as any).send = async (to: string, name: string, data: any) => { sent.push({ to, name, data }); return real(to, name, data) }
  }, 120_000)

  test('"Retry now" skips the wait but not the number of tries: it needs a seat that takes payments, works before the last try, and not on a paid or paused membership', async () => {
    const c = await client('Retry Rae', ['pm_rae'])
    declinedCards.add('pm_rae')
    const r = await enrol(c)
    expect((await ledger(r.body.id)).map((x: any) => x.status)).toEqual(['declined'])
    // a stylist cannot press it
    expect((await as('ana', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')).status).toBe(403)
    expect(charges()).toHaveLength(1)
    // the manager does, while the card is still declined: a second try right away (no waiting out the days), counted
    let out = await as('manager', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')
    expect([out.status, out.body.retryResult]).toEqual([200, 'declined'])
    const rows = await ledger(r.body.id)
    expect(rows.map((x: any) => [x.attempt, x.status])).toEqual([[1, 'declined'], [2, 'declined']])
    expect(rows[1].retriedByUserId).toBeTruthy()
    expect(rows[0].retriedByUserId).toBeNull()
    // the card is fine now: the next press pays — the third and last try — and the invoice is settled
    declinedCards.delete('pm_rae')
    out = await as('manager', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')
    expect([out.status, out.body.retryResult]).toEqual([200, 'paid'])
    expect((await invoiceOf(r.body.invoiceId)).status).toBe('paid')
    // nothing declined remains to try
    out = await as('manager', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')
    expect([out.status, out.body.code]).toEqual([409, 'NOTHING_TO_RETRY'])
  })

  test('the last try is a decline that pauses the membership; after that "Retry now" is refused (Resume is the way back)', async () => {
    const c = await client('Spent Sam', ['pm_sam'])
    declinedCards.add('pm_sam')
    const r = await enrol(c)
    await as('manager', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')
    await as('manager', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')
    expect((await enrolment(r.body.id)).status).toBe('paused')
    const again = await as('manager', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')
    expect([again.status, again.body.code]).toEqual([409, 'NOT_ACTIVE'])
    expect((await ledger(r.body.id))).toHaveLength(3)
    declinedCards.delete('pm_sam')
  })

  test('the failed-charges list: who, which try, the next automatic try, and whether Retry now is open', async () => {
    const c = await client('Listed Lee', ['pm_lee'])
    declinedCards.add('pm_lee')
    const r = await enrol(c)
    const list = (await as('manager', '/api/memberships/failed-charges')).body
    const row = (list.data ?? list).find((f: any) => f.enrollmentId === r.body.id)
    expect([row.clientName, row.attempt, row.tries, row.canRetryNow, row.paused, row.triesLeft]).toEqual(['Listed Lee', 1, 3, true, false, 2])
    expect(new Date(row.nextTryAt).getTime()).toBeGreaterThan(Date.now() + 2.5 * 86400000)
    expect(JSON.stringify(row)).not.toContain('pm_lee')
    // a paused one is listed too, with no Retry now
    const spent = (list.data ?? list).find((f: any) => f.clientName === 'Spent Sam')
    expect([spent.paused, spent.canRetryNow, spent.nextTryAt]).toEqual([true, false, null])
    // paid ones leave the list
    declinedCards.delete('pm_lee')
    await as('manager', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')
    const after = (await as('manager', '/api/memberships/failed-charges')).body
    expect((after.data ?? after).some((f: any) => f.enrollmentId === r.body.id)).toBe(false)
  })

  test('every decline emails the staff who hold the payments permission — not the stylist or front desk', async () => {
    const c = await client('Told Tess', ['pm_tess'])
    declinedCards.add('pm_tess')
    sent.length = 0
    const r = await enrol(c)
    let staff = sent.filter((m) => m.name === 'membershipDeclinedStaff')
    expect(staff.map((m) => m.to).sort()).toEqual(['admin@test.example', 'owner@test.example'])
    expect(staff[0].data).toMatchObject({ attempt: '1', tries: '3', clientName: 'Told Tess' })
    expect(staff[0].data.next).toContain('Next automatic try in 3 days')
    // the second decline is told too
    sent.length = 0
    await as('manager', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')
    staff = sent.filter((m) => m.name === 'membershipDeclinedStaff')
    expect(staff).toHaveLength(2)
    expect(staff[0].data.attempt).toBe('2')
    // and the last one says it is the last
    sent.length = 0
    await as('manager', `/api/memberships/enrollments/${r.body.id}/retry`, 'POST')
    staff = sent.filter((m) => m.name === 'membershipDeclinedStaff')
    expect(staff[0].data.next).toContain('last try')
    declinedCards.delete('pm_tess')
  })

  test('the salon sets its own tries and days between: owner/admin only, whole numbers in range; the charge follows them', async () => {
    expect((await as('manager', '/api/memberships/retry-settings')).body.tries).toBe(3)            // defaults
    expect((await as('manager', '/api/memberships/retry-settings', 'PUT', { tries: 2, intervalDays: 1 })).status).toBe(403)
    const bad = await as('owner', '/api/memberships/retry-settings', 'PUT', { tries: 0, intervalDays: 99 })
    expect([bad.status, Object.keys(bad.body.fields ?? {}).sort()]).toEqual([400, ['intervalDays', 'tries']])
    expect((await as('owner', '/api/memberships/retry-settings', 'PUT', { tries: 2.5, intervalDays: 1 })).status).toBe(400)
    const ok = await as('owner', '/api/memberships/retry-settings', 'PUT', { tries: 2, intervalDays: 1 })
    expect([ok.status, ok.body.tries, ok.body.intervalDays]).toEqual([200, 2, 1])
    // two tries in all: the second decline pauses it
    const c = await client('Brisk Bo', ['pm_bo'])
    declinedCards.add('pm_bo')
    const r = await enrol(c)
    // one day on is enough for the timed retry (default would be three)
    await backdate(r.body.id, 1.5)
    await as('owner', '/api/memberships/enrollments')
    expect((await ledger(r.body.id)).map((x: any) => x.status)).toEqual(['declined', 'declined'])
    expect((await enrolment(r.body.id)).status).toBe('paused')
    const staffNote = sent.filter((m) => m.name === 'membershipDeclinedStaff').slice(-1)[0]
    expect(staffNote.data).toMatchObject({ attempt: '2', tries: '2' })
    declinedCards.delete('pm_bo')
  })

  test('a backup card is tried in the same try when the main card is declined; one that needs the client is not', async () => {
    expect((await as('owner', '/api/memberships/retry-settings', 'PUT', { tries: 3, intervalDays: 3 })).status).toBe(200)
    const c = await client('Backed Bea', ['pm_old_bea', 'pm_main_bea'])             // the newest, pm_main_bea, is the main card
    declinedCards.add('pm_main_bea')
    calls.length = 0; sent.length = 0
    const r = await enrol(c)
    expect(r.body.autoChargeResult).toBe('paid')
    expect(charges().map((x) => x.args.payment_method)).toEqual(['pm_main_bea', 'pm_old_bea'])
    expect(charges()[1].opts.idempotencyKey).not.toBe(charges()[0].opts.idempotencyKey)
    const rows = await ledger(r.body.id)
    expect(rows.map((x: any) => [x.attempt, x.status, x.backupTried])).toEqual([[1, 'succeeded', true]])
    expect((await invoiceOf(r.body.invoiceId)).status).toBe('paid')
    const pays = await t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, r.body.invoiceId))
    expect(pays).toHaveLength(1)
    expect(pays[0].notes).toContain('backup card')
    // the member was charged once; no decline email to staff when the backup paid
    expect(sent.filter((m) => m.name === 'membershipDeclinedStaff')).toHaveLength(0)
    expect(sent.filter((m) => m.name === 'membershipCharged')).toHaveLength(1)
    declinedCards.delete('pm_main_bea')
    // both cards declined: one decline, counted once, the staff told it was the main and the backup
    const d2 = await client('Doubly Dot', ['pm_old_dot', 'pm_main_dot'])
    declinedCards.add('pm_main_dot'); declinedCards.add('pm_old_dot')
    sent.length = 0
    const r2 = await enrol(d2)
    expect((await ledger(r2.body.id)).map((x: any) => [x.attempt, x.status, x.backupTried])).toEqual([[1, 'declined', true]])
    expect(sent.filter((m) => m.name === 'membershipDeclinedStaff')[0].data.backup).toContain('backup card were tried')
    declinedCards.clear()
  })
})
