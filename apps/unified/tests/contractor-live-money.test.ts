// What a builder's money did in the contractor live test (11/07), each now as it should:
//   · a customer signing the quote makes the lead a client, sets the project's contract (the signed quote plus the change orders agreed
//     since — the list read "-" beside a $12,810 payment schedule), and the owner is emailed as before;
//   · a plan paying the sales rep on the signed quote earns, by itself, when an invoice for the project is paid in full ("Paying INV-00002
//     in full earned nothing automatically"), and the statement's days are the company's own;
//   · costs filed on the project with no job count in its budget ("silently left out of Job Costing");
//   · a change order sent to the client, and a purchase order sent to a vendor, email them.
// Through the real server as the contractor vertical; nothing reaches a real tenant.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', ownerId = '', contactId = '', projectId = '', quoteId = ''
const sent: Array<{ to: string; template: string; data: any }> = []
const mails: any[] = []
const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Hank Homeowner', consent: true }
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  process.env.FRONTEND_URL ||= 'https://app.builder.example'
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  ownerId = s.owner.id
  await t.db.update(t.schema.company).set({
    email: 'office@builder.example', timezone: 'America/Chicago',
    enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'projects', 'change_orders', 'commission_tracking', 'job_costing', 'job_budgets', 'cost_by_code', 'expense_tracking', 'vendor_portal', 'purchase_orders'],
  } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, o?: any) => { sent.push({ to, template, data }); return real(to, template, data, o) }
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  contactId = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Hank Homeowner', email: 'hank@home.example', type: 'lead', portalEnabled: true, portalToken: 'hank-portal-token' } as any).returning()) as any[])[0].id
  projectId = ((await t.db.insert(t.schema.project).values({ companyId, number: 'PRJ-0001', name: 'Hank Kitchen Remodel', contactId, status: 'active' } as any).returning()) as any[])[0].id
}, 120_000)

test('the customer signs: a client now, the project carries the contract, and the business is told', async () => {
  const q = await json(await as('/api/quotes', { method: 'POST', json: { contactId, projectId, name: 'Kitchen remodel', taxRate: 0, lineItems: [{ description: 'Cabinets and counters', quantity: 1, unitPrice: 10310 }] } }))
  expect(q.status).toBe(201)
  quoteId = q.body.id
  expect((await as(`/api/quotes/${quoteId}/send`, { method: 'POST' })).status).toBe(200)
  const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
  expect((await t.call(`/api/portal/d/${link}/quotes/${quoteId}/approve`, { method: 'POST', json: SIGN })).status).toBe(200)
  const [c] = await t.db.select({ type: t.schema.contact.type }).from(t.schema.contact).where(eq(t.schema.contact.id, contactId)) as any[]
  expect(c.type).toBe('client')
  const [p] = await t.db.select({ v: t.schema.project.estimatedValue }).from(t.schema.project).where(eq(t.schema.project.id, projectId)) as any[]
  expect(Number(p.v)).toBe(10310)
  // The business is told by email (the live test saw none: it goes to the owner's own address, as "signed and approved quote …").
  expect(sent.some((m) => m.template === 'collaboratorAction' && m.to === 'owner@test.example')).toBe(true)
  // A change order agreed since adds to it, and the page's original contract is the signed quote.
  const co = await json(await as('/api/change-orders', { method: 'POST', json: { projectId, title: 'Add pantry shelving', amount: 1500 } }))
  expect(co.status).toBe(201)
  const submitted = await json(await as(`/api/change-orders/${co.body.id}/submit`, { method: 'POST' }))
  expect([submitted.status, submitted.body.told]).toEqual([200, 'email'])
  const coMail = mails.find((m) => /Change order .* to approve/.test(m.subject))
  expect(coMail?.to).toBe('hank@home.example')
  expect(coMail?.html).toContain('/portal/hank-portal-token/change-orders')
  expect((await as(`/api/change-orders/${co.body.id}/approve`, { method: 'POST', json: {} })).status).toBe(200)
  const page = await json(await as(`/api/projects/${projectId}`))
  expect(page.body.financials.revisedContractValue).toBe(11810)
  expect(page.body.financials.originalValue).toBe(10310)
}, 60_000)

test('the rep on the signed quote earns 5% when a project invoice is paid in full, and it is on the statement for today', async () => {
  const plan = await json(await as('/api/commissions/plans', { method: 'POST', json: { name: 'Sales rep 5% of contract', planType: 'percent_of_invoice', percentRate: 5, autoEarn: 'quote_salesperson' } }))
  expect(plan.status).toBe(201)
  // A draw released from the payment schedule: on the project, not the quote, paid in full now.
  const [inv] = await t.db.insert(t.schema.invoice).values({ companyId, contactId, projectId, number: 'INV-00002', status: 'paid', paidAt: new Date(), subtotal: '3202.50', total: '3202.50', amountPaid: '3202.50', issueDate: new Date() } as any).returning() as any[]
  await (t.services as any).crm.earnCommission(inv.id)
  const rows = await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, inv.id)) as any[]
  expect(rows.length).toBe(1)
  expect([rows[0].userId, Number(rows[0].commissionAmount), rows[0].source]).toEqual([ownerId, 160.13, 'auto'])
  // Earned again (the sweep, a second payment door): still once.
  await (t.services as any).crm.earnCommission(inv.id)
  expect((await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, inv.id)) as any[]).length).toBe(1)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  const stmt = await json(await as(`/api/commissions/statement?from=${today.slice(0, 8)}01&to=${today}`))
  expect(stmt.status).toBe(200)
  expect(stmt.body.lines.length).toBe(1)
}, 60_000)

test('a cost filed on the project with no job counts in the project budget', async () => {
  await t.db.insert(t.schema.expense).values({ companyId, projectId, amount: '300', description: 'Lumber run', date: new Date(), costCode: '06-Framing', category: 'materials' } as any)
  const b = await json(await as(`/api/job-costing/budget/${projectId}`))
  expect(b.status).toBe(200)
  expect(b.body.actualCost).toBe(300)
}, 60_000)

test('a purchase order sent to a vendor emails them their portal link', async () => {
  const vendor = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Vic Vendor', email: 'vic@lumber.example', type: 'vendor' } as any).returning()) as any[])[0]
  const po = await json(await as('/api/purchase-orders', { method: 'POST', json: { vendorId: vendor.id, projectId, lines: [{ description: '2x4 studs', quantity: 100, unitCost: 5 }] } }))
  expect(po.status).toBe(201)
  const sentPo = await json(await as(`/api/purchase-orders/${po.body.id}/send`, { method: 'POST' }))
  expect([sentPo.status, sentPo.body.emailed]).toEqual([200, true])
  const mail = mails.find((m) => /Purchase order/.test(m.subject))
  expect(mail?.to).toBe('vic@lumber.example')
  expect(mail?.html).toMatch(/\/vendor\/[0-9a-f]{64}/)
  // The vendor's portal shows it, to acknowledge.
  const token = /\/vendor\/([0-9a-f]{64})/.exec(mail.html)![1]
  const portal = await json(await t.call(`/api/vendor-portal/v/${token}`))
  expect(portal.body.purchaseOrders.map((p: any) => p.id)).toContain(po.body.id)
}, 60_000)
