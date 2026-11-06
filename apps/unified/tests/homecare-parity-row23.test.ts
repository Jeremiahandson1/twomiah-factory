// Home care parity row 23 (docs/parity/homecare-private-pay.md) — billing contacts and QuickBooks, through the real server.
//
// Billing contacts (care_billing_contacts, not ready; data/homecareBillingContacts.ts, billing/billingContactRoutes.ts):
//   · off: the routes are refused, and an invoice goes to the client's own email as always — a contact stored on the client
//     is not read;
//   · the billing seats only; refused in words: an address that is not one, more than five in all, a family member of
//     another client, "someone else" with no name;
//   · a family member who pays plus more addresses: the invoice email, the reminder sent by hand and the automatic reminder
//     each go to every address, the note names them all, and the email greets the person who pays;
//   · the same contact set on many clients at once — all or none; a family member is one client's, so not in bulk.
// QuickBooks (care_quickbooks, not ready; crm/homecare/billing/books.ts, a pass in the shared QuickBooks sync), against the
// stand-in for QuickBooks Online (tests/qboMock.ts) — nothing reaches the internet:
//   · off: nothing of home care's goes across; switched on, only invoices sent from the first sync on (older ones are
//     usually in QuickBooks already);
//   · a SENT invoice becomes one QuickBooks invoice for the client as a customer: a line per visit (hours × rate on the item
//     "Home care services"); a draft does not go;
//   · sent once: a sync with nothing changed (or only a note added) writes nothing;
//   · a payment is applied to it; a write-off is a negative line, so the balance there is the balance here; a deleted payment
//     is deleted there and the balance comes back; a deleted invoice is deleted there;
//   · a payer's share of split visits is the payer's (a customer of its own);
//   · two clients with the same name are told apart; lines that do not add up to the total are refused in words, kept in
//     the sync's failure list and not sent wrong.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createQboMock } from './qboMock.ts'
import { checkBillingContact, recipientsFromRow } from '../server/data/homecareBillingContacts.ts'

const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any })
let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', caregiverId = '', ada = '', bo = '', cy = '', rae = '', other = ''
const tokens: Record<string, string> = {}
const sent: Array<{ to: string; template: string; data: any }> = []
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const as = (who: string) => async (p: string, init: any = {}): Promise<Response> => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const BASE = ['contacts', 'scheduling', 'team', 'quickbooks']
let features = [...BASE]
const setFeatures = async (list: string[]) => { features = list; await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const on = (f: string) => setFeatures([...new Set([...features, f])])
const off = (f: string) => setFeatures(features.filter((x) => x !== f))
const owner = as('owner')
const put = (clientId: string, b: any, who = 'owner') => as(who)(`/api/care-billing-contacts/clients/${clientId}`, { method: 'PUT', json: b }).then(json)
/** A manual invoice: a 4-hour and a 2-hour visit at the client's $25 an hour ($100 + $50). */
const bill = async (clientId: string, start: string, end: string) => {
  const r = await owner('/api/billing/invoices/manual', { method: 'POST', json: {
    clientId, billingPeriodStart: start, billingPeriodEnd: end,
    lineItems: [{ caregiverId, hours: 4, serviceDate: start, description: 'Personal care' }, { caregiverId, hours: 2, serviceDate: end, description: 'Companionship' }],
  } }).then(json)
  expect(r.status).toBe(201)
  return (r.body.invoice ?? r.body).id as string
}
const invoiceRow = async (id: string) => ((await t.db.select().from(t.schema.invoices).where(eq(t.schema.invoices.id, id))) as any[])[0]

const qbo = createQboMock()
const sweep = () => (t.services.crm as any).quickbooksSync
const sync = () => sweep().syncCompany(companyId, 'manual') as Promise<any>
const failures = async () => (await t.db.select().from(t.schema.qbSyncFailure).where(eq(t.schema.qbSyncFailure.companyId, companyId))) as any[]
const invoiceWrites = () => qbo.calls.filter((c) => c.method === 'POST' && /\/invoice$/.test(c.path)).length
const realFetch = globalThis.fetch

beforeAll(async () => {
  process.env.SMTP_HOST ||= 'smtp.invalid' // a provider, so the agency "can send"; the send itself is replaced below
  t = await bootTenant({ vertical: 'homecare' })
  const s = await seedOwner(t)
  companyId = s.company.id
  tokens.owner = await login('owner@test.example', s.password)
  const email: any = t.services.email
  email.send = async (to: string, template: string, data: any) => { sent.push({ to, template, data }); return { success: true, dev: true } }
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  caregiverId = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  const client = (first: string, last: string, email: string | null) => ins(t.schema.clients, { companyId, firstName: first, lastName: last, email, isActive: true, isPrivatePay: true, privatePayRate: '25', privatePayRateType: 'hourly', address: '1 Main St', city: 'Eau Claire', state: 'WI', zip: '54701' })
  ada = (await client('Ada', 'Client', 'ada@family.example')).id
  bo = (await client('Bo', 'Client', null)).id
  cy = (await client('Cy', 'Client', 'cy@family.example')).id
  rae = (await ins(t.schema.familyMembers, { companyId, clientId: ada, name: 'Rae Daughter', relationship: 'daughter', email: 'rae@family.example' })).id
  other = (await ins(t.schema.familyMembers, { companyId, clientId: bo, name: 'Bo’s son', email: 'son@family.example' })).id
  await setFeatures(BASE)
  // QuickBooks' addresses answer from the stand-in; nothing else is reached.
  globalThis.fetch = (async (input: any, init?: any) => {
    const host = new URL(String(input?.url ?? input)).hostname
    return host.endsWith('intuit.com') ? qbo.fetch(input, init) : realFetch(input, init)
  }) as any
  await (t.services.crm as any).quickbooks.saveConnection(companyId, { accessToken: 'access-1', refreshToken: 'refresh-1', realmId: '9130', expiresIn: 3600 })
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch })

describe('billing contacts: the rule', () => {
  const row = (o: any) => ({ id: 'c', firstName: 'Ada', lastName: 'Client', email: 'ada@x.example', portalEmail: null, billingContactKind: null, billingFamilyMemberId: null, billingContactName: null, billingEmails: [], memberName: null, memberEmail: null, ...o })
  test('not set → null (the old rule); the client, a family member or someone else first, then the extras, five at most', () => {
    expect(recipientsFromRow(row({}))).toBeNull()
    expect(recipientsFromRow(row({ billingContactKind: 'client', billingEmails: ['b@x.example', 'ADA@x.example'] }))).toEqual({ kind: 'client', name: 'Ada Client', emails: ['ada@x.example', 'b@x.example'] })
    expect(recipientsFromRow(row({ billingContactKind: 'family', memberName: 'Rae', memberEmail: 'rae@x.example', billingEmails: ['b@x.example'] }))).toEqual({ kind: 'family', name: 'Rae', emails: ['rae@x.example', 'b@x.example'] })
    // The family member left (or has no email): the extras still get it; with none, the old rule.
    expect(recipientsFromRow(row({ billingContactKind: 'family', billingEmails: ['b@x.example'] }))?.emails).toEqual(['b@x.example'])
    expect(recipientsFromRow(row({ billingContactKind: 'family' }))).toBeNull()
    expect(recipientsFromRow(row({ billingContactKind: 'other', billingContactName: 'Trust officer', billingEmails: ['1@x.example', '2@x.example', '3@x.example', '4@x.example', '5@x.example', '6@x.example'] }))?.emails.length).toBe(5)
  })
  test('refused in words', () => {
    expect(checkBillingContact({ kind: 'nobody' })).toMatchObject({ field: 'kind' })
    expect(checkBillingContact({ kind: 'client', emails: ['not-an-email'] })).toMatchObject({ field: 'emails', problem: expect.stringContaining('not an email') })
    expect(checkBillingContact({ kind: 'client', emails: ['1@x.example', '2@x.example', '3@x.example', '4@x.example', '5@x.example'] }, { clientEmail: 'c@x.example' })).toMatchObject({ problem: expect.stringContaining('At most 5') })
    expect(checkBillingContact({ kind: 'other', emails: ['1@x.example'] })).toMatchObject({ field: 'name' })
    expect(checkBillingContact({ kind: 'other', name: 'Trust officer' })).toMatchObject({ field: 'emails' })
    expect(checkBillingContact({ kind: 'client', emails: 'a@x.example; b@x.example' }, { clientEmail: 'a@x.example' })).toEqual({ value: { kind: 'client', familyMemberId: null, name: null, emails: ['b@x.example'] } })
  })
})

describe('billing contacts: switched off', () => {
  test('the routes are refused, and a contact stored on the client is not read', async () => {
    expect((await owner('/api/care-billing-contacts/clients')).status).toBe(403)
    await t.db.update(t.schema.clients).set({ billingContactKind: 'other', billingContactName: 'Ghost', billingEmails: ['ghost@x.example'] } as any).where(eq(t.schema.clients.id, cy))
    const id = await bill(cy, '2026-08-03', '2026-08-09')
    sent.length = 0
    const r = await json(await owner(`/api/billing/invoices/${id}/send-email`, { method: 'POST', json: {} }))
    expect([r.status, r.body.sentTo]).toEqual([200, 'cy@family.example'])
    expect(sent.map((m) => m.to)).toEqual(['cy@family.example'])
    await t.db.update(t.schema.clients).set({ billingContactKind: null, billingContactName: null, billingEmails: [] } as any).where(eq(t.schema.clients.id, cy))
  })
})

describe('billing contacts: switched on', () => {
  test('the billing seats only', async () => {
    await on('care_billing_contacts')
    expect((await as('ann')('/api/care-billing-contacts/clients')).status).toBe(403)
    expect((await put(ada, { kind: 'client' }, 'ann')).status).toBe(403)
  })

  test('refused in words: a family member of another client; a client with no email paying for themselves', async () => {
    const r1 = await put(ada, { kind: 'family', familyMemberId: other })
    expect([r1.status, r1.body.error]).toEqual([400, expect.stringContaining('family members')])
    const r2 = await put(bo, { kind: 'client' })
    expect([r2.status, r2.body.error]).toEqual([400, expect.stringContaining('no email address')])
    const r3 = await put(ada, { kind: 'client', emails: ['x@x.example', 'y@x.example', 'z@x.example', 'w@x.example', 'v@x.example'] })
    expect([r3.status, r3.body.error]).toEqual([400, expect.stringContaining('At most 5')])
  })

  test('a family member pays, with a second address: every invoice email and reminder goes to both, greeting her', async () => {
    const saved = await put(ada, { kind: 'family', familyMemberId: rae, emails: ['accounts@raes-firm.example'] })
    expect(saved.status).toBe(200)
    expect(saved.body.sendsTo).toEqual(['rae@family.example', 'accounts@raes-firm.example'])
    expect(saved.body.familyMembers.map((m: any) => m.name)).toEqual(['Rae Daughter'])
    const list = await json(await owner('/api/care-billing-contacts/clients'))
    expect(list.body.data.find((r: any) => r.clientId === ada)).toMatchObject({ kind: 'family', sendsTo: ['rae@family.example', 'accounts@raes-firm.example'], problem: null })

    const id = await bill(ada, '2026-08-03', '2026-08-09')
    sent.length = 0
    const r = await json(await owner(`/api/billing/invoices/${id}/send-email`, { method: 'POST', json: {} }))
    expect(r.status).toBe(200)
    expect(sent.map((m) => [m.to, m.data.contactName])).toEqual([['rae@family.example', 'Rae Daughter'], ['accounts@raes-firm.example', 'Rae Daughter']])
    expect((await invoiceRow(id)).notes).toContain('Emailed to rae@family.example, accounts@raes-firm.example on')

    sent.length = 0
    expect((await owner(`/api/billing/invoices/${id}/send-reminder`, { method: 'POST', json: {} })).status).toBe(200)
    expect(sent.map((m) => m.to)).toEqual(['rae@family.example', 'accounts@raes-firm.example'])
    // An address typed by the office still goes only there.
    sent.length = 0
    expect((await json(await owner(`/api/billing/invoices/${id}/send-reminder`, { method: 'POST', json: { email: 'once@x.example' } }))).body.sentTo).toBe('once@x.example')
    expect(sent.map((m) => m.to)).toEqual(['once@x.example'])
  })

  test('the automatic reminder goes to every address too', async () => {
    await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', settings: { invoiceReminders: { enabled: true, dueSoonDays: 0, overdueDays: [1] } } } as any).where(eq(t.schema.company.id, companyId))
    const [inv] = await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-R23', clientId: ada, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-07', subtotal: '60', total: '60', paymentStatus: 'pending', paymentDueDate: '2026-09-20', sentAt: new Date('2026-09-08T15:00:00Z') } as any).returning() as any[]
    await t.db.insert(t.schema.invoiceLineItems).values({ companyId, invoiceId: inv.id, caregiverId, description: 'Visit', serviceDate: '2026-09-01', hours: '2.4', rate: '25', rateType: 'hourly', amount: '60' } as any)
    sent.length = 0
    await t.services.crm.invoiceReminders.runOnce(new Date('2026-09-25T15:00:00Z')) // 10am in Chicago, 5 days late
    const mine = sent.filter((m) => m.template === 'homecareInvoiceReminder' && m.data.invoiceNumber !== undefined && m.data.amountDue === '60.00')
    expect(mine.map((m) => [m.to, m.data.contactName])).toEqual([['rae@family.example', 'Rae Daughter'], ['accounts@raes-firm.example', 'Rae Daughter']])
    const [log] = await t.db.select().from(t.schema.reminderLog).where(eq(t.schema.reminderLog.subjectId, inv.id)) as any[]
    expect([log.status, log.sentTo]).toEqual(['sent', 'rae@family.example, accounts@raes-firm.example'])
    await t.db.update(t.schema.company).set({ settings: {} } as any).where(eq(t.schema.company.id, companyId))
  })

  test('many clients at once: all or none; never a family member', async () => {
    const fam = await json(await owner('/api/care-billing-contacts/bulk', { method: 'POST', json: { clientIds: [bo, cy], kind: 'family' } }))
    expect([fam.status, fam.body.error]).toEqual([400, expect.stringContaining('one client')])
    const missing = await json(await owner('/api/care-billing-contacts/bulk', { method: 'POST', json: { clientIds: [bo, 'nope'], kind: 'other', name: 'Trust officer', emails: ['trust@bank.example'] } }))
    expect(missing.status).toBe(404)
    const ok = await json(await owner('/api/care-billing-contacts/bulk', { method: 'POST', json: { clientIds: [bo, cy], kind: 'other', name: 'Trust officer', emails: ['trust@bank.example'] } }))
    expect([ok.status, ok.body.updated]).toEqual([200, 2])
    const list = (await json(await owner('/api/care-billing-contacts/clients'))).body.data
    expect(list.filter((r: any) => [bo, cy].includes(r.clientId)).map((r: any) => [r.kind, r.contactName, r.sendsTo])).toEqual([
      ['other', 'Trust officer', ['trust@bank.example']], ['other', 'Trust officer', ['trust@bank.example']],
    ])
    // Cleared again: "not set" sends as before.
    expect((await json(await owner('/api/care-billing-contacts/bulk', { method: 'POST', json: { clientIds: [bo, cy], kind: null } }))).body.updated).toBe(2)
    expect((await json(await owner('/api/care-billing-contacts/clients'))).body.data.find((r: any) => r.clientId === cy)).toMatchObject({ kind: null, sendsTo: ['cy@family.example'] })
  })
})

describe('QuickBooks: home care invoices', () => {
  let first = ''
  test('switched off: nothing of home care’s goes across', async () => {
    first = await bill(cy, '2026-07-06', '2026-07-12')
    await owner(`/api/billing/invoices/${first}/send-email`, { method: 'POST', json: {} })
    const run = await sync()
    expect(run.status).toBe('ok')
    expect(qbo.invoices.size).toBe(0)
  })

  test('switched on: an invoice sent before the first sync stays out', async () => {
    await on('care_quickbooks')
    expect((await sync()).status).toBe('ok')
    expect((await invoiceRow(first)).qbInvoiceId).toBeNull()
    expect(qbo.invoices.size).toBe(0)
  })

  test('a sent invoice goes across once, for the client as a customer, a line per visit; a draft does not', async () => {
    first = await bill(cy, '2026-07-20', '2026-07-26')
    await owner(`/api/billing/invoices/${first}/send-email`, { method: 'POST', json: {} })
    const draft = await bill(cy, '2026-07-13', '2026-07-19')
    const run = await sync()
    expect(run.status).toBe('ok')
    const sentRow = await invoiceRow(first)
    expect(sentRow.qbInvoiceId).toBeTruthy()
    expect((await invoiceRow(draft)).qbInvoiceId).toBeNull()
    const inv = qbo.invoices.get(sentRow.qbInvoiceId)!
    expect(inv.TotalAmt).toBe(150)
    expect(inv.Line.map((l: any) => [l.Amount, l.SalesItemLineDetail.Qty, l.SalesItemLineDetail.UnitPrice, l.SalesItemLineDetail.ServiceDate])).toEqual([[100, 4, 25, '2026-07-20'], [50, 2, 25, '2026-07-26']])
    expect([...qbo.items.values()].find((i) => i.Id === inv.Line[0].SalesItemLineDetail.ItemRef.value)?.Name).toBe('Home care services')
    const customer = qbo.customers.get(String(inv.CustomerRef.value))!
    expect([customer.DisplayName, customer.PrimaryEmailAddr?.Address, customer.BillAddr?.City]).toEqual(['Cy Client', 'cy@family.example', 'Eau Claire'])
    expect(run.invoices).toBeGreaterThanOrEqual(1)
  })

  test('nothing changed, or only a note added: nothing is written', async () => {
    const before = invoiceWrites()
    await sync()
    await owner(`/api/billing/invoices/${first}/send-reminder`, { method: 'POST', json: {} }) // appends a note, touches updated_at
    await sync()
    expect(invoiceWrites()).toBe(before)
  })

  test('a payment is applied; a write-off is a negative line; a deleted payment is deleted there and the balance comes back', async () => {
    const qbId = (await invoiceRow(first)).qbInvoiceId
    const pay = await json(await owner('/api/billing/invoice-payments', { method: 'POST', json: { invoiceId: first, amount: 60, paymentDate: '2026-07-20', paymentMethod: 'check', referenceNumber: 'CHK-101' } }))
    expect(pay.status).toBe(201)
    await sync()
    expect(qbo.payments.size).toBe(1)
    const [qp] = [...qbo.payments.values()]
    expect([qp.TotalAmt, qp.PaymentRefNum, qp.TxnDate, qp.Line[0].LinkedTxn[0].TxnId]).toEqual([60, 'CHK-101', '2026-07-20', qbId])
    expect(qbo.invoices.get(qbId)!.Balance).toBe(90)

    expect((await owner(`/api/billing/invoices/${first}/adjustments`, { method: 'POST', json: { amount: 10, type: 'write_off', reason: 'Late visit' } })).status).toBe(201)
    await sync()
    const after = qbo.invoices.get(qbId)!
    expect(after.Line.at(-1)).toMatchObject({ Amount: -10, Description: 'Write-off — Late visit' })
    expect([after.TotalAmt, after.Balance]).toEqual([140, 80])

    const payId = (pay.body.payment ?? pay.body).id
    expect((await owner(`/api/billing/invoice-payments/${payId}`, { method: 'DELETE' })).status).toBe(200)
    await sync()
    expect(qbo.payments.size).toBe(0)
    expect(qbo.invoices.get(qbId)!.Balance).toBe(140)
    expect(await t.db.select().from(t.schema.careQbRemoval)).toEqual([])
  })

  test('a deleted invoice is deleted there', async () => {
    const id = await bill(cy, '2026-06-01', '2026-06-07')
    await owner(`/api/billing/invoices/${id}/send-email`, { method: 'POST', json: {} })
    await sync()
    const qbId = (await invoiceRow(id)).qbInvoiceId
    expect(qbo.invoices.has(qbId)).toBe(true)
    expect((await owner(`/api/billing/invoices/${id}`, { method: 'DELETE' })).status).toBe(200)
    await sync()
    expect(qbo.invoices.has(qbId)).toBe(false)
  })

  test("a payer's share is the payer's: a customer of its own", async () => {
    const payer = await ins(t.schema.referralSources, { companyId, name: 'Genworth LTC', payerType: 'ltc_insurance', isActivePayer: true, billingContactEmail: 'claims@genworth.example' })
    const [inv] = await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-P1', clientId: cy, billingPeriodStart: '2026-05-01', billingPeriodEnd: '2026-05-07', subtotal: '40', total: '40', paymentStatus: 'pending', billTo: 'payer', referralSourceId: payer.id, splitGroupId: 'sg-1', sentAt: new Date() } as any).returning() as any[]
    await t.db.insert(t.schema.invoiceLineItems).values({ companyId, invoiceId: inv.id, caregiverId, description: 'Personal care (payer share)', serviceDate: '2026-05-01', hours: '2', rate: '20', rateType: 'hourly', amount: '40' } as any)
    await sync()
    const qb = qbo.invoices.get((await invoiceRow(inv.id)).qbInvoiceId)!
    const customer = qbo.customers.get(String(qb.CustomerRef.value))!
    expect([customer.DisplayName, customer.PrimaryEmailAddr?.Address]).toEqual(['Genworth LTC', 'claims@genworth.example'])
    expect(qb.CustomerMemo.value).toContain('Care for Cy Client')
  })

  test('two clients with the same name are told apart; lines that do not add up are refused in words', async () => {
    const twin = await ins(t.schema.clients, { companyId, firstName: 'Cy', lastName: 'Client', email: 'cy2@family.example', isActive: true, isPrivatePay: true, privatePayRate: '25', privatePayRateType: 'hourly' })
    const id = await bill(twin.id, '2026-04-06', '2026-04-12')
    await owner(`/api/billing/invoices/${id}/send-email`, { method: 'POST', json: {} })
    // A total that its lines do not make (as an old import could leave it).
    const [bad] = await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-BAD', clientId: twin.id, billingPeriodStart: '2026-03-01', billingPeriodEnd: '2026-03-07', subtotal: '99', total: '99', paymentStatus: 'pending', sentAt: new Date() } as any).returning() as any[]
    await t.db.insert(t.schema.invoiceLineItems).values({ companyId, invoiceId: bad.id, caregiverId, description: 'Visit', serviceDate: '2026-03-01', hours: '2', rate: '25', rateType: 'hourly', amount: '50' } as any)
    const run = await sync()
    expect(run.status).toBe('partial')
    const names = [...qbo.customers.values()].map((c) => c.DisplayName).filter((n) => n.startsWith('Cy Client'))
    expect(names).toEqual(['Cy Client', `Cy Client (${twin.id.slice(-6)})`])
    expect((await invoiceRow(id)).qbInvoiceId).toBeTruthy()
    expect((await invoiceRow(bad.id)).qbInvoiceId).toBeNull()
    const f = (await failures()).find((x) => x.entityId === bad.id)
    expect(f).toMatchObject({ entity: 'invoice', attempts: 1, lastError: expect.stringContaining('add up to 50.00, not its total of 99.00') })
  })

  test('switched off again: the pass stops', async () => {
    await off('care_quickbooks')
    const before = qbo.writes().length
    const id = await bill(ada, '2026-02-02', '2026-02-08')
    await owner(`/api/billing/invoices/${id}/send-email`, { method: 'POST', json: {} })
    await sync()
    expect(qbo.writes().length).toBe(before)
    expect((await t.db.select().from(t.schema.invoices).where(and(eq(t.schema.invoices.id, id))) as any[])[0].qbInvoiceId).toBeNull()
  })
})
