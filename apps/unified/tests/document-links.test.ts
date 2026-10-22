// A quote's and an invoice's own link (/d/<token>), end to end through the real server (live testers, 2026-10-22):
//   · the quote email carried an Approve button only when the customer's client portal was on — everyone else got a quote
//     with no way to accept it; the invoice email carried no way to pay unless a caller made a payment link (home care).
// packages/tenant-backend portal/documentLinks.ts mints the token when the document is first sent; portal.ts answers
// /api/portal/d/:token/… through the SAME handlers as the portal, so approving, declining and paying are one rule.
//   · every trade: a sent quote's email links to its own page, for a customer with no portal; the page shows the business,
//     lines and totals (never the line cost or the token); Sign & Approve is recorded as the portal records it;
//   · decline with a reason; a declined, approved or expired quote shows its state and refuses an answer;
//   · a link opens its own document and nothing else — not another quote of the same customer, not the portal's lists;
//   · an invoice's email links to its page; Pay is offered only when the business takes cards (Stripe on this server, its
//     account connected, Online Payments on), and the payment route refuses otherwise; the recurring sender links too.
// Email is not delivered from a test: the email service's send is wrapped to record what each message was handed.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { crmTemplates } from '../server/crm/messages.ts'

type Call = (p: string, init?: any) => Promise<Response>
const json = async (r: Response) => (await r.json()) as any
const BRAND = { companyName: 'Test Builders', colourOnWhite: '#c2410c' }
const APP = 'https://app.test.example'
const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Ann Able', consent: true }
const BASE = ['contacts', 'quotes', 'invoices', 'jobs']

async function tenant(vertical: string, features: string[] = BASE, stripe?: any) {
  const t = await bootTenant({ vertical, ...(stripe ? { stripe } : {}) })
  const seeded = await seedOwner(t)
  const companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: features, email: 'office@test.example', phone: '555-0100' } as any).where(eq(t.schema.company.id, companyId))
  const login = await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } }))
  const owner: Call = async (p, init = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${login.accessToken}` } })
  // What each email was handed (crmEmail's named senders call email.send by name, so this sees all of them).
  const sent: Array<{ to: string; template: string; data: any }> = []
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ to, template, data }); return real(to, template, data, options) }
  const [ann] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', email: 'ann@test.example', type: 'client' } as any).returning()
  return { t, owner, companyId, sent, ann }
}
const pub = (t: any): Call => (p, init = {}) => t.call(p, init)

async function sentQuote(x: Awaited<ReturnType<typeof tenant>>, name = 'Kitchen refit') {
  const made = await x.owner('/api/quotes', { method: 'POST', json: { name, contactId: x.ann.id, lineItems: [{ description: 'Cabinets', quantity: 2, unitPrice: 150, unitCost: 90 }, { description: 'Fitting', quantity: 1, unitPrice: 200 }] } })
  expect([name, made.status]).toEqual([name, 201])
  const q = await json(made)
  const r = await x.owner(`/api/quotes/${q.id}/send`, { method: 'POST' })
  expect([name, r.status]).toEqual([name, 200])
  const mail = x.sent.filter((m) => m.template === 'quoteSent').at(-1)!
  const token = String(mail.data.documentPath || '').replace('/d/', '')
  return { q, mail, token }
}

describe('a quote’s own link — every trade', () => {
  for (const vertical of ['contractor', 'fieldservice', 'landscaping', 'roofing', 'basic', 'bar', 'restaurant', 'rv', 'salon', 'vet', 'homecare', 'store']) {
    test(`${vertical}: the email links to the quote, and Sign & Approve is recorded`, async () => {
      const x = await tenant(vertical)
      const { q, mail, token } = await sentQuote(x)
      // The customer has no portal; the email still carries the link.
      expect(token).toMatch(/^[0-9a-f]{64}$/)
      const rendered = crmTemplates.quoteSent(mail.data, BRAND, APP)
      expect(rendered.html).toContain(`${APP}/d/${token}`)
      expect(rendered.html).toContain('Review and approve')
      expect(rendered.text).toContain(`${APP}/d/${token}`)

      const anyone = pub(x.t)
      const home = await json(await anyone(`/api/portal/d/${token}`))
      expect(home.document).toEqual({ kind: 'quote', id: q.id })
      expect(home.company.name).toBe('Test Builders')
      const page = await anyone(`/api/portal/d/${token}/quotes/${q.id}`)
      expect(page.status).toBe(200)
      const shown = await json(page)
      expect([shown.number, shown.status, Number(shown.total)]).toEqual([q.number, 'viewed', 500])
      expect(shown.lineItems.map((l: any) => l.description)).toEqual(['Cabinets', 'Fitting'])
      expect(JSON.stringify(shown)).not.toMatch(/unitCost|publicToken|signedIp/)

      const ok = await anyone(`/api/portal/d/${token}/quotes/${q.id}/approve`, { method: 'POST', json: SIGN })
      expect(ok.status).toBe(200)
      const office = await json(await x.owner(`/api/quotes/${q.id}`))
      expect([office.status, office.signedBy, !!office.signatureHash]).toEqual(['approved', 'Ann Able', true])
      // Recorded as the portal records a signature: the signing audit row.
      const audit = await x.t.db.select().from(x.t.schema.auditLog).where(eq(x.t.schema.auditLog.entityId, q.id))
      expect(audit.some((a: any) => a.action === 'quote.signed' && a.userName === 'Ann Able')).toBe(true)
      // Answered once: a second approval is refused and the page shows the state.
      expect((await anyone(`/api/portal/d/${token}/quotes/${q.id}/approve`, { method: 'POST', json: SIGN })).status).toBe(400)
      expect((await json(await anyone(`/api/portal/d/${token}/quotes/${q.id}`))).status).toBe('approved')
    }, 120_000)
  }
})

describe('a quote’s own link — answers and states', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  beforeAll(async () => { x = await tenant('contractor') }, 120_000)

  test('decline with a reason: recorded, the business told, and no approving it afterwards', async () => {
    const { q, token } = await sentQuote(x, 'Deck')
    const no = await pub(x.t)(`/api/portal/d/${token}/quotes/${q.id}/reject`, { method: 'POST', json: { reason: 'Too dear' } })
    expect(no.status).toBe(200)
    expect((await json(await x.owner(`/api/quotes/${q.id}`))).status).toBe('rejected')
    const told = await x.t.db.select().from(x.t.schema.activity).where(eq(x.t.schema.activity.entityId, q.id))
    expect(told.some((a: any) => a.action === 'rejected' && a.metadata?.reason === 'Too dear')).toBe(true)
    expect((await pub(x.t)(`/api/portal/d/${token}/quotes/${q.id}/approve`, { method: 'POST', json: SIGN })).status).toBe(400)
    expect((await json(await pub(x.t)(`/api/portal/d/${token}/quotes/${q.id}`))).status).toBe('rejected')
  })

  test('past its valid-until day: shown expired, and neither approved nor declined', async () => {
    const { q, token } = await sentQuote(x, 'Fence')
    const yesterday = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 1))
    await x.t.db.update(x.t.schema.quote).set({ expiryDate: yesterday } as any).where(eq(x.t.schema.quote.id, q.id))
    expect((await json(await pub(x.t)(`/api/portal/d/${token}/quotes/${q.id}`))).status).toBe('expired')
    const yes = await pub(x.t)(`/api/portal/d/${token}/quotes/${q.id}/approve`, { method: 'POST', json: SIGN })
    expect(yes.status).toBe(400)
    expect((await json(yes)).error).toContain('expired')
    expect((await pub(x.t)(`/api/portal/d/${token}/quotes/${q.id}/reject`, { method: 'POST', json: {} })).status).toBe(400)
    // Opened (viewed), never answered.
    expect((await json(await x.owner(`/api/quotes/${q.id}`))).status).toBe('viewed')
  })

  test('a link opens its own quote and nothing else', async () => {
    const a = await sentQuote(x, 'Roof A')
    const b = await sentQuote(x, 'Roof B')
    expect(a.token).not.toBe(b.token)
    const anyone = pub(x.t)
    // The same customer's other quote, by A's link: not found, never shown or answered.
    expect((await anyone(`/api/portal/d/${a.token}/quotes/${b.q.id}`)).status).toBe(404)
    expect((await anyone(`/api/portal/d/${a.token}/quotes/${b.q.id}/approve`, { method: 'POST', json: SIGN })).status).toBe(404)
    expect((await json(await x.owner(`/api/quotes/${b.q.id}`))).status).toBe('sent')
    // The portal's lists and other sections are not under /d/; a made-up token opens nothing; nor does it open the portal.
    for (const p of [`/api/portal/d/${a.token}/quotes`, `/api/portal/d/${a.token}/invoices`, `/api/portal/d/${'0'.repeat(64)}`, `/api/portal/d/nope`, `/api/portal/p/${a.token}`]) {
      expect([p, (await anyone(p)).status >= 400]).toEqual([p, true])
    }
    // A seat that may only read quotes is not handed the link (it opens Approve).
    const hash = await Bun.password.hash('Seat-pass-1-long', 'bcrypt')
    await x.t.db.insert(x.t.schema.user).values({ email: 'viewer@test.example', passwordHash: hash, firstName: 'V', lastName: 'Seat', role: 'viewer', companyId: x.companyId } as any)
    const vt = (await json(await x.t.call('/api/auth/login', { method: 'POST', json: { email: 'viewer@test.example', password: 'Seat-pass-1-long' } }))).accessToken
    const seen = await json(await x.t.call(`/api/quotes/${a.q.id}`, { headers: { Authorization: `Bearer ${vt}` } }))
    expect(seen.id).toBe(a.q.id)
    expect(seen.publicToken).toBeUndefined()
  })

  test('Quotes switched off: the link closes', async () => {
    const { q, token } = await sentQuote(x, 'Shed')
    await x.t.db.update(x.t.schema.company).set({ enabledFeatures: ['contacts', 'invoices'] } as any).where(eq(x.t.schema.company.id, x.companyId))
    await new Promise((r) => setTimeout(r, 15_100)) // the feature list is cached 15 s
    expect((await pub(x.t)(`/api/portal/d/${token}/quotes/${q.id}`)).status).toBe(404)
    await x.t.db.update(x.t.schema.company).set({ enabledFeatures: BASE } as any).where(eq(x.t.schema.company.id, x.companyId))
  }, 30_000)
})

describe('an invoice’s own link', () => {
  const stripeCalls: any[] = []
  const fakeStripe = {
    customers: {
      create: async (args: any, opts: any) => { stripeCalls.push({ what: 'customer', args, opts }); return { id: 'cus_1' } },
      retrieve: async () => ({ id: 'cus_1' }),
    },
    paymentIntents: { create: async (args: any, opts: any) => { stripeCalls.push({ what: 'pi', args, opts }); return { id: 'pi_1', client_secret: 'pi_1_secret', amount: args.amount } } },
  }
  let x: Awaited<ReturnType<typeof tenant>>
  const was = process.env.STRIPE_PUBLISHABLE_KEY
  beforeAll(async () => { x = await tenant('fieldservice', BASE, fakeStripe) }, 120_000)
  afterAll(() => { if (was === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY; else process.env.STRIPE_PUBLISHABLE_KEY = was })

  async function sentInvoice() {
    const inv = await json(await x.owner('/api/invoices', { method: 'POST', json: { contactId: x.ann.id, lineItems: [{ description: 'Service call', quantity: 1, unitPrice: 120 }] } }))
    expect((await x.owner(`/api/invoices/${inv.id}/send`, { method: 'POST' })).status).toBe(200)
    const mail = x.sent.filter((m) => m.template === 'invoiceSent').at(-1)!
    return { inv, mail, token: String(mail.data.documentPath || '').replace('/d/', '') }
  }

  test('the email links to the invoice; with no card payments the page says how to pay and the payment is refused', async () => {
    const { inv, mail, token } = await sentInvoice()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const rendered = crmTemplates.invoiceSent(mail.data, BRAND, APP)
    expect(rendered.html).toContain(`${APP}/d/${token}`)
    expect(rendered.text).toContain(`${APP}/d/${token}`)
    const home = await json(await pub(x.t)(`/api/portal/d/${token}`))
    expect(home.document).toEqual({ kind: 'invoice', id: inv.id })
    const page = await json(await pub(x.t)(`/api/portal/d/${token}/invoices/${inv.id}`))
    expect([page.number, Number(page.balance), page.payOnline]).toEqual([inv.number, 120, false])
    expect(page.company).toMatchObject({ name: 'Test Builders', phone: '555-0100', email: 'office@test.example' })
    expect(page.publicToken).toBeUndefined()
    const pay = await pub(x.t)('/api/stripe/portal/payment-intent', { method: 'POST', json: { invoiceId: inv.id, linkToken: token } })
    expect(pay.status).toBe(400)
    expect(stripeCalls.length).toBe(0)
  })

  test('card payments connected: Pay is offered and the charge lands on the business’s own account', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x'
    await x.t.db.update(x.t.schema.company).set({ enabledFeatures: [...BASE, 'online_payments'], integrations: { stripeAccountId: 'acct_biz' } } as any).where(eq(x.t.schema.company.id, x.companyId))
    await new Promise((r) => setTimeout(r, 15_100)) // the feature list is cached 15 s
    const { inv, token } = await sentInvoice()
    expect((await json(await pub(x.t)(`/api/portal/d/${token}/invoices/${inv.id}`))).payOnline).toBe(true)
    const pay = await pub(x.t)('/api/stripe/portal/payment-intent', { method: 'POST', json: { invoiceId: inv.id, linkToken: token } })
    expect(pay.status).toBe(200)
    const body = await json(pay)
    expect([body.clientSecret, body.stripeAccount, body.publishableKey]).toEqual(['pi_1_secret', 'acct_biz', 'pk_test_x'])
    const pi = stripeCalls.find((s) => s.what === 'pi')
    expect([pi.args.amount, pi.args.metadata.invoice_id, pi.opts?.stripeAccount]).toEqual([12000, inv.id, 'acct_biz'])
    // The link pays its own invoice only.
    const other = await sentInvoice()
    expect((await pub(x.t)('/api/stripe/portal/payment-intent', { method: 'POST', json: { invoiceId: other.inv.id, linkToken: token } })).status).toBe(404)
    expect((await pub(x.t)(`/api/portal/d/${token}/invoices/${other.inv.id}`)).status).toBe(404)
  }, 30_000)

  test('a recurring invoice sent on its schedule carries the same link', async () => {
    const r = x.t.services.crm.recurring as any
    const rec = await r.createRecurringInvoice({ companyId: x.companyId, contactId: x.ann.id, frequency: 'monthly', startDate: new Date().toISOString(), autoSend: true, lineItems: [{ description: 'Monthly service', quantity: 1, unitPrice: 80 }] })
    const inv = await r.generateInvoiceFromRecurring(rec.id)
    const mail = x.sent.filter((m) => m.template === 'invoiceSent').at(-1)!
    expect(mail.data.invoiceNumber).toBe(inv.number)
    const token = String(mail.data.documentPath || '').replace('/d/', '')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect((await json(await pub(x.t)(`/api/portal/d/${token}`))).document).toEqual({ kind: 'invoice', id: inv.id })
  })
})
