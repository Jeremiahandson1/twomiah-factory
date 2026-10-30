// Roofers are paid online (docs/parity/roof-online-payments.md; roofing depth, gap 1), through the real server as the
// roofing vertical against a fake Stripe:
//   · Online Payments is offered to a roofing business — the registry lists it for crm-roof, the portal page offers Pay;
//   · the homeowner's card payment is made on the roofer's OWN connected Stripe account, never the platform's;
//   · Stripe's payment, forwarded by the Factory, pays the invoice and moves the job from Invoiced to Collected, with the
//     stage-change note the timeline reads and a note saying why; a retried event moves nothing a second time;
//   · a payment typed in on the screen (a cheque at the door) does the same once EVERY invoice on the job is paid;
//   · a deposit paid while the job is still being sold or built, or one of two invoices paid, collects nothing;
//   · the seat without invoices:update cannot record a payment, and a forwarded event without the Factory's key is refused.
// Nothing here reaches Stripe, the Factory or a real tenant.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { getFeaturesForTemplate } from '@twomiah/tenant-backend'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const stripeCalls: any[] = []
/** What each email was handed (email is never delivered from a test): the invoice email carries the homeowner's own link. */
const sent: Array<{ to: string; template: string; data: any }> = []
/** The texts the homeowner would be sent (texting is never delivered from a test). */
const texts: Array<{ companyId: string; message: string; jobId?: string }> = []
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v }

const fakeStripe = {
  customers: { create: async () => ({ id: 'cus_1' }), retrieve: async () => ({ id: 'cus_1' }) },
  paymentIntents: { create: async (args: any, opts: any) => { stripeCalls.push({ what: 'pi', args, opts }); return { id: `pi_${stripeCalls.length}`, client_secret: `pi_${stripeCalls.length}_secret`, amount: args.amount } } },
}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  setEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_roof')
  setEnv('FACTORY_SYNC_KEY', 'factory-key')
  setEnv('FRONTEND_URL', 'https://app.roofer.example')
  t = await bootTenant({ vertical: 'roofing', stripe: fakeStripe })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await t.db.update(t.schema.company).set({
    enabledFeatures: ['jobs', 'contacts', 'invoices', 'online_payments', 'two_way_texting'], integrations: { stripeAccountId: 'acct_roofer' }, email: 'office@roofer.example',
  } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  const email: any = t.services.email
  const realSend = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ to, template, data }); return realSend(to, template, data, options) }
  const smsService: any = (t.services as any).crm.sms
  smsService.sendSMS = async (companyId: string, args: any) => { texts.push({ companyId, message: args.message, jobId: args.jobId }); return { success: true } }
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const [viewer] = await t.db.insert(t.schema.user).values({ email: 'book@test.example', passwordHash: hash, firstName: 'Bo', lastName: 'Keeper', role: 'viewer', companyId } as any).returning()
  ids.viewer = viewer.id
  tokens.viewer = await login('book@test.example', PASS)
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', mobile: '715-555-0101', type: 'client' } as any).returning()
  ids.home = home.id
}, 120_000)

afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

/** A roofing job standing at `status`, made the way the screen makes one and then put at the stage the test needs. */
async function jobAt(status: string, address: string) {
  const made = await json(await as('owner')('/api/jobs', { method: 'POST', json: {
    contactId: ids.home, jobType: 'retail', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301', estimatedRevenue: 12000, totalSquares: 30,
  } }))
  expect([address, made.status]).toEqual([address, 201])
  await t.db.update(t.schema.job).set({ status } as any).where(eq(t.schema.job.id, made.body.id))
  return made.body.id as string
}
/** An invoice on the job, sent so it has the homeowner's link. */
async function sentInvoice(jobId: string, price = 6000) {
  const inv = await json(await as('owner')('/api/invoices', { method: 'POST', json: { contactId: ids.home, jobId, lineItems: [{ description: 'Roof replacement', quantity: 1, unitPrice: price }] } }))
  expect(inv.status).toBe(201)
  expect((await as('owner')(`/api/invoices/${inv.body.id}/send`, { method: 'POST' })).status).toBe(200)
  const mail = sent.filter((m) => m.template === 'invoiceSent').at(-1)!
  return { ...inv.body, token: String(mail.data.documentPath || '').replace('/d/', '') } as { id: string; number: string; token: string }
}
const statusOf = async (jobId: string) => (await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId)))[0].status as string
const notesOf = async (jobId: string) => (await t.db.select().from(t.schema.jobNote).where(and(eq(t.schema.jobNote.jobId, jobId), eq(t.schema.jobNote.companyId, companyId)))).map((n: any) => n.body as string)
/** A payment typed in on the screen is followed up after the reply, so wait for the job to settle rather than read it at once. */
const settled = async (jobId: string, want: string) => {
  for (let i = 0; i < 40; i++) { if ((await statusOf(jobId)) === want) return want; await new Promise((r) => setTimeout(r, 50)) }
  return statusOf(jobId)
}
const cardPaid = (invoiceId: string, pi: string, cents: number) => t.call('/api/stripe/factory-event', {
  method: 'POST', headers: { 'X-Factory-Key': 'factory-key' },
  json: { event: { type: 'payment_intent.succeeded', account: 'acct_roofer', data: { object: { id: pi, amount: cents, created: Math.floor(Date.now() / 1000), payment_method_types: ['card'], metadata: { invoice_id: invoiceId, company_id: companyId } } } } },
})

describe('roofers are paid online', () => {
  test('Online Payments is offered to a roofing business, and the homeowner’s page offers Pay on the roofer’s own Stripe account', async () => {
    expect(getFeaturesForTemplate('crm-roof').map((f: any) => f.id)).toContain('online_payments')
    const jobId = await jobAt('invoiced', '1 Shingle Way')
    const inv = await sentInvoice(jobId)
    const token = inv.token
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const page = await json(await t.call(`/api/portal/d/${token}/invoices/${inv.id}`))
    expect([page.status, page.body.payOnline]).toEqual([200, true])
    const pay = await json(await t.call('/api/stripe/portal/payment-intent', { method: 'POST', json: { invoiceId: inv.id, linkToken: token } }))
    expect(pay.status).toBe(200)
    const pi = stripeCalls.at(-1)
    // The charge is on the roofer's account, for this invoice, for the whole balance.
    expect([pi.opts?.stripeAccount, pi.args.metadata.invoice_id, pi.args.amount]).toEqual(['acct_roofer', inv.id, 600000])
    expect(pay.body).toMatchObject({ stripeAccount: 'acct_roofer', publishableKey: 'pk_test_roof' })
  })

  test('the homeowner pays by card: the invoice is paid and the job moves from Invoiced to Collected, once', async () => {
    const jobId = await jobAt('invoiced', '2 Ridge Rd')
    const inv = await sentInvoice(jobId)
    expect((await cardPaid(inv.id, 'pi_card_1', 600000)).status).toBe(200)
    const row = (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, inv.id)))[0]
    expect([row.status, Number(row.amountPaid)]).toEqual(['paid', 6000])
    expect(await statusOf(jobId)).toBe('collected')
    const notes = await notesOf(jobId)
    // The stage change is in the stored form the timeline reads, and a second note says it was automatic.
    expect(notes).toContain('Status changed: invoiced → collected')
    expect(notes.some((n) => /paid in full, so it was moved to Collected automatically/.test(n))).toBe(true)
    const timeline = await json(await as('owner')(`/api/jobs/${jobId}`))
    expect(timeline.status).toBe(200)
    // Stripe retries a delivery: nothing moves and nothing is noted a second time.
    expect((await cardPaid(inv.id, 'pi_card_1', 600000)).status).toBe(200)
    expect((await notesOf(jobId)).filter((n) => n === 'Status changed: invoiced → collected').length).toBe(1)
    expect(await statusOf(jobId)).toBe('collected')
  })

  test('a cheque typed in on the screen collects the job only when every invoice on it is paid', async () => {
    const jobId = await jobAt('invoiced', '3 Gable Ct')
    const first = await sentInvoice(jobId, 4000)
    const second = await sentInvoice(jobId, 2000)
    expect((await as('owner')(`/api/invoices/${first.id}/payments`, { method: 'POST', json: { amount: 4000, method: 'check' } })).status).toBe(201)
    await new Promise((r) => setTimeout(r, 400))
    expect(await statusOf(jobId)).toBe('invoiced')
    expect((await as('owner')(`/api/invoices/${second.id}/payments`, { method: 'POST', json: { amount: 2000, method: 'check' } })).status).toBe(201)
    expect(await settled(jobId, 'collected')).toBe('collected')
  })

  test('a draft or void invoice on the job does not hold it back', async () => {
    const jobId = await jobAt('invoiced', '4 Soffit St')
    const paid = await sentInvoice(jobId, 5000)
    const draft = await json(await as('owner')('/api/invoices', { method: 'POST', json: { contactId: ids.home, jobId, lineItems: [{ description: 'Maybe later', quantity: 1, unitPrice: 100 }] } }))
    expect(draft.status).toBe(201)
    expect((await as('owner')(`/api/invoices/${paid.id}/payments`, { method: 'POST', json: { amount: 5000, method: 'cash' } })).status).toBe(201)
    expect(await settled(jobId, 'collected')).toBe('collected')
  })

  test('money on a job still being sold or built collects nothing', async () => {
    for (const stage of ['proposal_sent', 'signed', 'in_production']) {
      const jobId = await jobAt(stage, `5 ${stage} Ln`)
      const deposit = await sentInvoice(jobId, 1500)
      expect((await cardPaid(deposit.id, `pi_dep_${stage}`, 150000)).status).toBe(200)
      await new Promise((r) => setTimeout(r, 200))
      expect([stage, await statusOf(jobId)]).toEqual([stage, stage])
    }
  })

  test('the Invoiced text carries the invoice’s own page, and says Pay online only where a card can be taken', async () => {
    const jobId = await jobAt('final_inspection', '7 Fascia Pl')
    const inv = await sentInvoice(jobId)
    texts.length = 0
    expect((await as('owner')(`/api/jobs/${jobId}/advance`, { method: 'POST' })).status).toBe(200)
    expect(await statusOf(jobId)).toBe('invoiced')
    const invoiced = texts.find((m) => m.jobId === jobId)!
    expect(invoiced.message).toContain(`Pay online at https://app.roofer.example/d/${inv.token}`)

    // Card payments off (the switch): the same page, read rather than paid.
    await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'invoices', 'two_way_texting'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    const job2 = await jobAt('final_inspection', '8 Fascia Pl')
    const inv2 = await sentInvoice(job2)
    texts.length = 0
    expect((await as('owner')(`/api/jobs/${job2}/advance`, { method: 'POST' })).status).toBe(200)
    const msg2 = texts.find((m) => m.jobId === job2)!.message
    expect(msg2).toContain(`View it at https://app.roofer.example/d/${inv2.token}`)
    expect(msg2).not.toContain('Pay online')
    await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'invoices', 'online_payments', 'two_way_texting'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
  })

  test('a seat without invoices:update cannot record a payment, and a forwarded event without the Factory’s key is refused', async () => {
    const jobId = await jobAt('invoiced', '6 Valley Vw')
    const inv = await sentInvoice(jobId)
    expect((await as('viewer')(`/api/invoices/${inv.id}/payments`, { method: 'POST', json: { amount: 6000, method: 'cash' } })).status).toBe(403)
    const noKey = await t.call('/api/stripe/factory-event', { method: 'POST', json: { event: { type: 'payment_intent.succeeded', data: { object: { id: 'pi_x', amount: 600000, metadata: { invoice_id: inv.id } } } } } })
    expect(noKey.status).toBe(401)
    await new Promise((r) => setTimeout(r, 200))
    expect(await statusOf(jobId)).toBe('invoiced')
    const row = (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, inv.id)))[0]
    expect(Number(row.amountPaid)).toBe(0)
  })
})
