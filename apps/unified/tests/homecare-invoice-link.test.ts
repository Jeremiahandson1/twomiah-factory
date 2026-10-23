// Home care's Billing invoice email carries the invoice's own private link, as every other invoice email does (live test,
// 2026-10-23: "Invoice email has no payment link"). Through the real server:
//   · the email and its reminder link /d/<token> (packages/tenant-backend portal/documentLinks.ts, minted on the first
//     send, never changed) with the app's address in front — not /pay/<invoice id>, and not only when FRONTEND_URL is set;
//   · the page behind it answers by the token alone, never by the invoice's id; a draft's link stops working;
//   · with no card payments (crm/cardPayments.ts: Stripe here, the agency's account connected, Online Payments on) the
//     page says how to pay, with the agency's phone and email, and a card charge is refused — no Stripe call is made;
//   · with card payments the checkout is for what is still owed and is made on the agency's own account; the Factory's
//     forwarded Connect event records the payment on the visit-invoice ledger;
//   · the client portal's Pay opens the same page.
// Email is not delivered from a test: the email service's send is replaced to record what each message was handed.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { homecareTemplates } from '../server/crm/homecare/core/messages.ts'

const APP = 'https://agency.test.example'
const BRAND = { companyName: 'Test Builders', colourOnWhite: '#c2410c' } as any
const json = async (r: Response) => (await r.json()) as any

const stripeCalls: any[] = []
const fakeStripe = {
  checkout: {
    sessions: {
      create: async (args: any, opts: any) => { stripeCalls.push({ what: 'checkout', args, opts }); return { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' } },
      retrieve: async (id: string, opts: any) => { stripeCalls.push({ what: 'retrieve', id, opts }); return { payment_status: 'paid', amount_total: 4000, metadata: {}, customer_email: null } },
    },
  },
  prices: { create: async (args: any, opts: any) => { stripeCalls.push({ what: 'price', args, opts }); return { id: 'price_1' } } },
  paymentLinks: { create: async (args: any, opts: any) => { stripeCalls.push({ what: 'link', args, opts }); return { id: 'plink_1', url: 'https://buy.stripe.test/1' } } },
  paymentIntents: { create: async (args: any, opts: any) => { stripeCalls.push({ what: 'pi', args, opts }); return { id: 'pi_1', client_secret: 'pi_1_secret' } } },
}

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', clientId = '', invoiceId = ''
const sent: Array<{ to: string; template: string; data: any }> = []
const env: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string | undefined) => { if (!(k in env)) env[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v }
let owner: (p: string, init?: any) => Response | Promise<Response>

beforeAll(async () => {
  // A provider, so the agency's "send" is allowed (core/messages.ts isConfigured); the send itself is replaced below.
  setEnv('SMTP_HOST', 'smtp.invalid')
  setEnv('STRIPE_PUBLISHABLE_KEY', undefined)
  setEnv('FACTORY_SYNC_KEY', 'factory-test-key')
  t = await bootTenant({ vertical: 'homecare', stripe: fakeStripe })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ email: 'office@agency.example', phone: '715-555-0100', enabledFeatures: ['online_payments'] } as any).where(eq(t.schema.company.id, companyId))
  const email: any = t.services.email
  email.send = async (to: string, template: string, data: any) => { sent.push({ to, template, data }); return { success: true, dev: true } }
  const login = await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))
  owner = (p, init = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${login.accessToken}` } })
  const [cl] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Ada', lastName: 'Client', email: 'ada@family.example', isActive: true, portalEnabled: true, portalToken: 'portal-token-ada' } as any).returning()
  clientId = cl.id
  const [inv] = await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-1', clientId, billingPeriodStart: '2026-10-01', billingPeriodEnd: '2026-10-14', subtotal: '120', total: '120', paymentStatus: 'pending', paymentDueDate: '2026-11-05' } as any).returning()
  invoiceId = inv.id
}, 120_000)
afterAll(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

describe("the agency's invoice email links the invoice's own page", () => {
  test('the email carries /d/<token> with the app\'s address — never /pay/<id> — and the reminder carries the same', async () => {
    setEnv('FRONTEND_URL', undefined) // the old link needed it; the link no longer does
    const r = await owner(`/api/billing/invoices/${invoiceId}/send-email`, { method: 'POST', json: {} })
    expect(r.status).toBe(200)
    const mail = sent.filter((m) => m.template === 'homecareInvoiceEmail').at(-1)!
    expect(mail.to).toBe('ada@family.example')
    expect(String(mail.data.documentPath)).toMatch(/^\/d\/[0-9a-f]{64}$/)
    token = String(mail.data.documentPath).slice(3)
    const [row] = await t.db.select().from(t.schema.invoices).where(eq(t.schema.invoices.id, invoiceId))
    expect(row.publicToken).toBe(token)
    const rendered = homecareTemplates.homecareInvoiceEmail(mail.data, BRAND, APP)
    expect(rendered.html).toContain(`href="${APP}/d/${token}"`)
    expect(rendered.html).toContain('View and pay invoice')
    expect(rendered.text).toContain(`${APP}/d/${token}`)
    expect(rendered.html + rendered.text).not.toContain(`/pay/${invoiceId}`)

    expect((await owner(`/api/billing/invoices/${invoiceId}/send-reminder`, { method: 'POST', json: {} })).status).toBe(200)
    const reminder = sent.filter((m) => m.template === 'homecareInvoiceReminder').at(-1)!
    expect(reminder.data.documentPath).toBe(`/d/${token}`) // minted once, never changed
    const r2 = homecareTemplates.homecareInvoiceReminder(reminder.data, BRAND, APP)
    expect(r2.html).toContain(`href="${APP}/d/${token}"`)
    expect(r2.text).toContain(`${APP}/d/${token}`)
  })

  test('no card payments: the page shows what is owed and how to pay the agency; a card charge is refused, Stripe untouched', async () => {
    const page = await json(await t.call(`/api/stripe/document/${token}`))
    expect(page).toMatchObject({ invoiceNumber: expect.any(String), clientName: 'Ada Client', total: '120.00', amountDue: '120.00', payOnline: false })
    expect(page.business).toEqual({ name: 'Test Builders', phone: '715-555-0100', email: 'office@agency.example' })
    const pay = await t.call(`/api/stripe/document/${token}/pay`, { method: 'POST' })
    expect(pay.status).toBe(400)
    expect((await json(pay)).error).toBe('This business does not take card payments online. Please contact them to pay another way.')
    expect(stripeCalls).toEqual([])
  })

  test('the page answers by the token alone: not the invoice id, not a made-up token; a rescinded draft\'s link stops working', async () => {
    expect((await t.call(`/api/stripe/invoice/${invoiceId}/pay`)).status).toBe(404)
    expect((await t.call(`/api/stripe/document/${invoiceId}`)).status).toBe(404)
    const gone = await t.call(`/api/stripe/document/${'0'.repeat(64)}`)
    expect(gone.status).toBe(404)
    expect((await json(gone)).error).toBe('This link is not valid. Please contact the business that sent it.')
    expect((await owner(`/api/billing/invoices/${invoiceId}/rescind`, { method: 'POST' })).status).toBe(200)
    expect((await t.call(`/api/stripe/document/${token}`)).status).toBe(404)
    expect((await owner(`/api/billing/invoices/${invoiceId}/release`, { method: 'POST' })).status).toBe(200)
    expect((await t.call(`/api/stripe/document/${token}`)).status).toBe(200)
  })

  test("the client portal's Pay opens the same page", async () => {
    const r = await t.call('/api/portal/invoices', { headers: { 'x-portal-token': 'portal-token-ada' } })
    expect(r.status).toBe(200)
    const rows = (await json(r)).data
    const mine = rows.find((x: any) => x.id === invoiceId)
    expect(mine.documentPath).toBe(`/d/${token}`)
    expect(JSON.stringify(rows)).not.toContain('publicToken')
  })

  test("card payments connected: the checkout is for what is owed, on the agency's own account; the forwarded event records it", async () => {
    // $80 already paid by check: $40 is owed.
    expect((await owner('/api/billing/invoice-payments', { method: 'POST', json: { invoiceId, amount: 80, paymentDate: '2026-10-20', paymentMethod: 'check' } })).status).toBeLessThan(300)
    setEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_x')
    await t.db.update(t.schema.company).set({ integrations: { stripeAccountId: 'acct_agency' } } as any).where(eq(t.schema.company.id, companyId))
    const page = await json(await t.call(`/api/stripe/document/${token}`))
    expect([page.amountDue, page.amountPaid, page.payOnline]).toEqual(['40.00', '80.00', true])
    const pay = await t.call(`/api/stripe/document/${token}/pay`, { method: 'POST', headers: { host: 'agency.test.example' } })
    expect(pay.status).toBe(200)
    expect((await json(pay)).url).toBe('https://checkout.stripe.test/cs_1')
    const co = stripeCalls.find((s) => s.what === 'checkout')
    expect(co.opts).toEqual({ stripeAccount: 'acct_agency' })
    expect(co.args.line_items[0].price_data.unit_amount).toBe(4000)
    expect(co.args.metadata.invoice_id).toBe(invoiceId)
    expect(co.args.success_url).toContain(`doc=${token}`)
    expect(co.args.cancel_url).toMatch(new RegExp(`/d/${token}\\?cancelled=true$`))

    const verified = await json(await t.call(`/api/stripe/verify-payment/cs_1?doc=${token}`))
    expect(verified.success).toBe(true)
    expect(stripeCalls.find((s) => s.what === 'retrieve').opts).toEqual({ stripeAccount: 'acct_agency' })

    const event = { id: 'evt_1', type: 'checkout.session.completed', account: 'acct_agency', data: { object: { id: 'cs_1', amount_total: 4000, payment_intent: 'pi_live_1', metadata: { invoice_id: invoiceId } } } }
    expect((await t.call('/api/stripe/factory-event', { method: 'POST', json: { event } })).status).toBe(401)
    const ok = await t.call('/api/stripe/factory-event', { method: 'POST', headers: { 'X-Factory-Key': 'factory-test-key' }, json: { event } })
    expect(ok.status).toBe(200)
    const again = await t.call('/api/stripe/factory-event', { method: 'POST', headers: { 'X-Factory-Key': 'factory-test-key' }, json: { event } })
    expect(again.status).toBe(200)
    const [row] = await t.db.select().from(t.schema.invoices).where(eq(t.schema.invoices.id, invoiceId))
    expect([row.paymentStatus, Number(row.amountPaid)]).toEqual(['paid', 120])
    const after = await json(await t.call(`/api/stripe/document/${token}`))
    expect([after.amountDue, after.payOnline]).toEqual(['0.00', false])
  })

  test("the office's checkout and pay link are made on the agency's account too", async () => {
    const [inv] = await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-2', clientId, billingPeriodStart: '2026-10-15', billingPeriodEnd: '2026-10-28', subtotal: '60', total: '60', paymentStatus: 'pending' } as any).returning()
    expect((await owner('/api/stripe/create-checkout-session', { method: 'POST', json: { invoiceId: inv.id } })).status).toBe(200)
    expect(stripeCalls.filter((s) => s.what === 'checkout').at(-1).opts).toEqual({ stripeAccount: 'acct_agency' })
    expect((await owner('/api/stripe/create-payment-link', { method: 'POST', json: { invoiceId: inv.id } })).status).toBe(200)
    expect(stripeCalls.filter((s) => s.what === 'price' || s.what === 'link').map((s) => s.opts)).toEqual([{ stripeAccount: 'acct_agency' }, { stripeAccount: 'acct_agency' }])
    // Disconnected: refused, not charged to the platform's account.
    await t.db.update(t.schema.company).set({ integrations: {} } as any).where(eq(t.schema.company.id, companyId))
    const before = stripeCalls.length
    expect((await owner('/api/stripe/create-checkout-session', { method: 'POST', json: { invoiceId: inv.id } })).status).toBe(400)
    expect(stripeCalls.length).toBe(before)
  })
})
