// QuickBooks auto-sync (server/crm/office/quickbooksAutoSync.ts). The card's Auto-sync switch was saved and nothing read
// it; turning it OFF made every Sync button answer "not connected" (the shared service used it as the connection check).
// Against a faithful stand-in for QuickBooks Online (tests/qboMock.ts: the shapes the shared service already sends and
// reads, and Intuit's refusals). The clock is pinned; nothing reaches the internet.
//   · the switch is auto-sync only: a new connection starts it off, and off never blocks a sync pressed by hand;
//   · on, a pass sends new customers, then invoices (never drafts), then payments; nothing twice; an edit is sent again;
//   · a refused record is kept with QuickBooks' own words and retried on a back-off, up to 5 tries, then waits for Retry;
//   · a revoked connection stops the run and says so; every run is logged; the log and the buttons are owner/admin.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createQboMock } from './qboMock.ts'
import { quickBooksReason, MAX_ATTEMPTS } from '../server/crm/office/quickbooksAutoSync.ts'

const json = async (r: Response) => (await r.json()) as any
const qbo = createQboMock()
const realFetch = globalThis.fetch
let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner: (p: string, init?: any) => Promise<Response>
let manager: (p: string, init?: any) => Promise<Response>
const T0 = new Date('2026-10-23T15:00:00Z')
const at = (min: number) => new Date(T0.getTime() + min * 60_000)
let ann: any, inv: any

beforeAll(async () => {
  // Only QuickBooks' addresses answer (the mock); the app's own requests go to t.call, never fetch.
  globalThis.fetch = qbo.fetch as any
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'quickbooks'] } as any).where(eq(t.schema.company.id, companyId))
  const tok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken
  owner = (p, init = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
  await t.db.insert(t.schema.user).values({ email: 'manager@test.example', passwordHash: await Bun.password.hash('Manager-pass-1', 'bcrypt'), firstName: 'Mae', lastName: 'Manager', role: 'manager', companyId } as any)
  const mtok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'manager@test.example', password: 'Manager-pass-1' } }))).accessToken
  manager = (p, init = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${mtok}` } }))
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch })

const sync = () => t.services.crm.quickbooksSync

describe("QuickBooks' error words", () => {
  test('a ValidationFault reads as QuickBooks says it; a 401 is named', () => {
    expect(quickBooksReason(new Error('QBO API error: 400 - {"Fault":{"Error":[{"Message":"Duplicate Name Exists Error","Detail":"The name supplied already exists.","code":"6240"}],"type":"ValidationFault"}}')))
      .toBe('Duplicate Name Exists Error: The name supplied already exists. (QuickBooks error 6240)')
    expect(quickBooksReason(new Error('QBO API error: 401 - {"fault":{"error":[{"message":"message=AuthenticationFailed","detail":"Token revoked","code":"3200"}]}}'))).toContain('Token revoked')
  })
})

describe('the switch', () => {
  test('connecting starts auto-sync off; with it off a sync pressed by hand still works', async () => {
    await t.services.crm.quickbooks.saveConnection(companyId, { accessToken: 'access-1', refreshToken: 'refresh-1', realmId: '9130', expiresIn: 3600 })
    const status = await json(await owner('/api/quickbooks/status'))
    expect(status).toMatchObject({ connected: true, syncEnabled: false })
    ann = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', email: 'ann@example.com', type: 'client' } as any).returning())[0]
    const r = await owner(`/api/quickbooks/sync/customer/${ann.id}`, { method: 'POST' })
    expect(r.status).toBe(200) // was 400 "QuickBooks not connected" while the switch was off
    expect(qbo.customers.size).toBe(1)
  })

  test('off: the automatic pass sends nothing; on (the card\'s toggle): it does', async () => {
    const before = qbo.writes().length
    await t.db.insert(t.schema.contact).values({ companyId, name: 'Bea Bright', type: 'client' } as any)
    expect(await sync().runAuto(at(0))).toEqual([])
    expect(qbo.writes().length).toBe(before)
    expect((await owner('/api/quickbooks/auto-sync', { method: 'POST', json: { enabled: true } })).status).toBe(200)
    const runs = await sync().runAuto(at(1))
    expect(runs.length).toBe(1)
    expect(runs[0]).toMatchObject({ trigger: 'auto', status: 'ok', customers: 2 }) // Ann (never stamped) and Bea
  })
})

describe('what goes across, in order, once', () => {
  test('invoices (never a draft) after their customer; then payments; a lead is not a customer', async () => {
    await t.db.insert(t.schema.contact).values({ companyId, name: 'Leo Lead', type: 'lead' } as any)
    ;[inv] = await t.db.insert(t.schema.invoice).values({ companyId, contactId: ann.id, number: 'INV-00001', status: 'sent', subtotal: '150', total: '150', issueDate: new Date('2026-10-20T00:00:00Z'), dueDate: new Date('2026-11-19T00:00:00Z') } as any).returning()
    await t.db.insert(t.schema.invoiceLineItem).values([
      { invoiceId: inv.id, description: 'Gutter repair', quantity: '1', unitPrice: '100', total: '100', sortOrder: 0 },
      { invoiceId: inv.id, description: 'Haul away', quantity: '2', unitPrice: '25', total: '50', sortOrder: 1 },
    ] as any)
    await t.db.insert(t.schema.invoice).values({ companyId, contactId: ann.id, number: 'INV-00002', status: 'draft', subtotal: '10', total: '10' } as any)
    await t.db.insert(t.schema.payment).values({ invoiceId: inv.id, amount: '50', method: 'check', paidAt: new Date('2026-10-22T12:00:00Z') } as any)
    const run = await sync().syncCompany(companyId, 'auto', at(2))
    expect(run).toMatchObject({ status: 'ok', customers: 0, invoices: 1, payments: 1, failed: 0 })
    const [qInv] = [...qbo.invoices.values()]
    expect(qInv).toMatchObject({ DocNumber: 'INV-00001', TotalAmt: 150, TxnDate: '2026-10-20', DueDate: '2026-11-19' })
    expect(qInv.Line.map((l: any) => [l.Description, l.Amount])).toEqual([['Gutter repair', 100], ['Haul away', 50]])
    const [qPay] = [...qbo.payments.values()]
    expect(qPay).toMatchObject({ TotalAmt: 50, Line: [{ Amount: 50, LinkedTxn: [{ TxnId: qInv.Id, TxnType: 'Invoice' }] }] })
    const [p] = await t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, inv.id))
    expect(p.qbPaymentId).toBe(qPay.Id)
    expect([...qbo.customers.values()].map((c) => c.DisplayName).sort()).toEqual(['Ann Able', 'Bea Bright'])
  })

  test('a second pass with nothing changed writes nothing to QuickBooks', async () => {
    const before = qbo.writes().length
    const run = await sync().syncCompany(companyId, 'auto', at(3))
    expect(run).toMatchObject({ status: 'ok', customers: 0, invoices: 0, payments: 0 })
    expect(qbo.writes().length).toBe(before)
  })

  test('an edited customer and an edited invoice are sent again, as updates', async () => {
    expect((await owner(`/api/contacts/${ann.id}`, { method: 'PUT', json: { name: 'Ann Able-Baker' } })).status).toBe(200)
    expect((await owner(`/api/invoices/${inv.id}`, { method: 'PUT', json: { notes: 'Thank you' } })).status).toBe(200)
    const run = await sync().syncCompany(companyId, 'auto', at(4))
    expect(run).toMatchObject({ status: 'ok', customers: 1, invoices: 1, payments: 0 })
    // Created by hand (0), brought up to date by the first automatic pass (1, never stamped before), edited (2).
    expect([...qbo.customers.values()].find((c) => c.DisplayName === 'Ann Able-Baker')?.SyncToken).toBe('2')
    expect([...qbo.invoices.values()][0].SyncToken).toBe('1')
    expect(qbo.customers.size).toBe(2)
  })
})

describe('refusals, retries and the log', () => {
  let dup: any
  test("a refused record is logged in QuickBooks' words, and waits its back-off", async () => {
    dup = (await t.db.insert(t.schema.contact).values({ companyId, name: 'bea bright', type: 'client' } as any).returning())[0]
    const run = await sync().syncCompany(companyId, 'auto', at(10))
    expect(run).toMatchObject({ status: 'partial', failed: 1 })
    const log = await json(await owner('/api/qb-sync/log'))
    expect(log.failures).toEqual([expect.objectContaining({ entity: 'customer', entityId: dup.id, label: 'bea bright', attempts: 1, gaveUp: false,
      lastError: 'Duplicate Name Exists Error: The name supplied already exists. : Another customer, vendor or employee is already using this name. Please use a different name. (QuickBooks error 6240)' })])
    expect(new Date(log.failures[0].nextAttemptAt).getTime()).toBe(at(25).getTime())
    const writes = qbo.writes().length
    await sync().syncCompany(companyId, 'auto', at(20)) // inside the 15 minutes: not tried
    expect(qbo.writes().length).toBe(writes)
    await sync().syncCompany(companyId, 'auto', at(26)) // after: tried again
    expect((await json(await owner('/api/qb-sync/log'))).failures[0].attempts).toBe(2)
  })

  test(`after ${MAX_ATTEMPTS} tries it waits for a person; Retry tries now; fixed, it goes and the failure clears`, async () => {
    const [f] = await t.db.select().from(t.schema.qbSyncFailure)
    await t.db.update(t.schema.qbSyncFailure).set({ attempts: MAX_ATTEMPTS - 1, nextAttemptAt: at(30) } as any).where(eq(t.schema.qbSyncFailure.id, f.id))
    await sync().syncCompany(companyId, 'auto', at(31))
    let log = await json(await owner('/api/qb-sync/log'))
    expect(log.failures[0]).toMatchObject({ attempts: MAX_ATTEMPTS, gaveUp: true, nextAttemptAt: null })
    const writes = qbo.writes().length
    await sync().syncCompany(companyId, 'auto', at(60 * 48))
    expect(qbo.writes().length).toBe(writes)
    await t.db.update(t.schema.contact).set({ name: 'Bea Bright (2)', updatedAt: new Date() } as any).where(eq(t.schema.contact.id, dup.id))
    const r = await json(await owner(`/api/qb-sync/failures/${f.id}/retry`, { method: 'POST' }))
    expect(r.run).toMatchObject({ trigger: 'manual', status: 'ok', customers: 1 })
    expect(r.log.failures).toEqual([])
  })

  test('a revoked connection stops the run and says so — no record is blamed', async () => {
    await t.db.insert(t.schema.contact).values({ companyId, name: 'Cal Carter', type: 'client' } as any)
    qbo.revoke(true)
    const run = await sync().syncCompany(companyId, 'auto', at(70))
    qbo.revoke(false)
    expect(run).toMatchObject({ status: 'failed', error: 'QuickBooks is not connected any more. Connect it again on this card.' })
    expect(await t.db.select().from(t.schema.qbSyncFailure)).toEqual([])
  })

  test('Sync now is logged as manual; the log lists the runs newest first; a manager is refused both', async () => {
    const r = await json(await owner('/api/qb-sync/run', { method: 'POST' }))
    expect(r.run).toMatchObject({ trigger: 'manual', status: 'ok', customers: 1 })
    const log = await json(await owner('/api/qb-sync/log'))
    expect(log).toMatchObject({ connected: true, autoSync: true, everyMinutes: 15 })
    // (The pinned passes above are dated on the test's clock; this one ran now — so it is found, not taken as first.)
    expect(log.runs.find((x: any) => x.trigger === 'manual' && x.customers === 1)).toMatchObject({ status: 'ok' })
    expect(log.runs.some((x: any) => x.status === 'failed')).toBe(true)
    expect((await manager('/api/qb-sync/log')).status).toBe(403)
    expect((await manager('/api/qb-sync/run', { method: 'POST' })).status).toBe(403)
  })

  test('the QuickBooks feature off: no automatic pass, and the doors refuse', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures(companyId)
    await t.db.insert(t.schema.contact).values({ companyId, name: 'Dee Dunn', type: 'client' } as any)
    expect(await sync().runAuto(at(90))).toEqual([])
    expect((await owner('/api/qb-sync/log')).status).toBe(403)
  })
})
