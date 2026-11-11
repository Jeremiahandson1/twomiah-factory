// Parity tier 2 (11/10): CREDIT MEMOS — customer credit kept on a customer and spent on their invoices (QuickBooks' and
// Buildertrend's credit memo), on the shared client ledger the salon's account balance is. Through the real server as the contractor:
//   · issued with a reason (owner/admin); the customer's credit and its history;
//   · an invoice is paid from it (method account_balance) under the invoice's lock — never more than the credit, never more than owed;
//   · a refund can be kept as credit;
//   · switched off: nothing offered on the invoice (accountBalance null), paying or refunding to credit refused in words, routes closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', ann = '', bob = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const FEATURES = ['contacts', 'invoices', 'credit_memos']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const invoiceFor = async (contactId: string, price: number) => {
  const inv = await json(await call('/api/invoices', { method: 'POST', json: { contactId, lineItems: [{ description: 'Deck', quantity: 1, unitPrice: price }] } }))
  await t.db.update(t.schema.invoice).set({ status: 'sent' } as any).where(eq(t.schema.invoice.id, inv.body.id))
  return inv.body.id as string
}
const credit = async (contactId: string) => (await json(await call(`/api/customer-credit/${contactId}`))).body.credit

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(FEATURES)
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  ann = ((await (t.db as any).insert(t.schema.contact).values({ companyId, name: 'Ann Owner', type: 'client' }).returning())[0]).id
  bob = ((await (t.db as any).insert(t.schema.contact).values({ companyId, name: 'Bob Other', type: 'client' }).returning())[0]).id
}, 120_000)

test('a credit is issued with a reason, and the history says so', async () => {
  expect((await call(`/api/customer-credit/${ann}`, { method: 'POST', json: { amount: 150 } })).status).toBe(400)
  const r = await json(await call(`/api/customer-credit/${ann}`, { method: 'POST', json: { amount: 150, reason: 'Finished a week late' } }))
  expect(r.status).toBe(201)
  expect(r.body.credit).toBe(150)
  expect(r.body.entries[0]).toMatchObject({ amount: 150, source: 'credit_memo', reason: 'Finished a week late' })
  expect(await credit(bob)).toBe(0)
})

test("an invoice is paid from the credit: no more than the credit, no more than owed; another customer's credit is not theirs", async () => {
  const inv = await invoiceFor(ann, 200)
  const detail = await json(await call(`/api/invoices/${inv}`))
  expect(detail.body.accountBalance).toBe(150)
  const tooMuch = await json(await call(`/api/invoices/${inv}/payments`, { method: 'POST', json: { amount: 175, method: 'account_balance' } }))
  expect(tooMuch.status).toBeGreaterThanOrEqual(400)
  const paid = await json(await call(`/api/invoices/${inv}/payments`, { method: 'POST', json: { amount: 150, method: 'account_balance' } }))
  expect(paid.status).toBeLessThan(300)
  expect(await credit(ann)).toBe(0)
  const after = await json(await call(`/api/invoices/${inv}`))
  expect(Number(after.body.balance)).toBe(50)
  const bobs = await invoiceFor(bob, 80)
  expect((await json(await call(`/api/invoices/${bobs}/payments`, { method: 'POST', json: { amount: 10, method: 'account_balance' } }))).status).toBeGreaterThanOrEqual(400)
})

test('a refund can be kept as credit', async () => {
  const inv = await invoiceFor(ann, 100)
  await call(`/api/invoices/${inv}/payments`, { method: 'POST', json: { amount: 100, method: 'cash' } })
  const r = await call(`/api/invoices/${inv}/refund`, { method: 'POST', json: { amount: 40, method: 'account_balance', reason: 'One rail short' } })
  expect(r.status).toBeLessThan(300)
  expect(await credit(ann)).toBe(40)
})

test('switched off: nothing offered on the invoice, paying from credit refused in words, the routes closed', async () => {
  await setFeatures(['contacts', 'invoices'])
  try {
    const inv = await invoiceFor(ann, 30)
    expect((await json(await call(`/api/invoices/${inv}`))).body.accountBalance).toBeNull()
    const r = await json(await call(`/api/invoices/${inv}/payments`, { method: 'POST', json: { amount: 10, method: 'account_balance' } }))
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(String(r.body.error)).toContain('Customer credit is not switched on')
    expect([403, 404]).toContain((await call(`/api/customer-credit/${ann}`)).status)
  } finally { await setFeatures(FEATURES) }
})
