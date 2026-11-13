// Code review 02 (shared modules), 2026-11-13. Each test is one finding, shown fixed beside the ordinary path.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq, isNull } from 'drizzle-orm'
import { retotalInvoice, scheduleTotals, commissionFor } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
let companyId = ''
let contactId = ''
const call = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'invoices', 'jobs', 'recurring_jobs', 'time_tracking'] } as any).where(eq(t.schema.company.id, companyId))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json() as any).accessToken
  const [pat] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Pat Client', email: 'pat@example.com', type: 'client' } as any).returning()
  contactId = pat.id
}, 120_000)

describe('02-1: a credit on a final invoice keeps what was billed before it', () => {
  test('a $50 credit takes $50 off — the deposit already credited is not put back on', async () => {
    const day = new Date(Date.UTC(2026, 10, 1))
    const [inv] = await t.db.insert(t.schema.invoice).values({
      companyId, contactId, number: 'INV-90001', status: 'sent', issueDate: day, dueDate: day,
      subtotal: '10000.00', taxRate: '0', taxAmount: '0', discount: '0', total: '2500.00', amountPaid: '0', creditApplied: '7500.00',
    } as any).returning()
    await t.db.insert(t.schema.invoiceLineItem).values({ invoiceId: inv.id, description: 'Kitchen', quantity: '1', unitPrice: '10000', total: '10000', sortOrder: 0 } as any)
    const res = await json(await call(`/api/invoices/${inv.id}/credit`, { method: 'POST', json: { amount: 50, reason: 'Late start' } }))
    expect(res.status).toBe(200)
    expect(res.body.invoice.total).toBe('2450.00')
    expect(res.body.balanceAfter).toBe(2450)
    // More than is owed is still refused.
    expect((await call(`/api/invoices/${inv.id}/credit`, { method: 'POST', json: { amount: 3000, reason: 'Too much' } })).status).toBe(400)
  })
})

describe('02-2: an edit reads the money as it is', () => {
  test('a deposit taken and refunded does not make an edited invoice "partial"', () => {
    const lines = [{ description: 'Work', quantity: 1, unitPrice: 100 }]
    const out: any = retotalInvoice({ amountPaid: '50.00', amountRefunded: '50.00', status: 'sent' }, lines, 0, 0)
    expect(out.fields.status).toBe('sent')
    // Money still held is still "partial"; paid in full is still "paid".
    expect((retotalInvoice({ amountPaid: '50.00', amountRefunded: '10.00', status: 'sent' }, lines, 0, 0) as any).fields.status).toBe('partial')
    expect((retotalInvoice({ amountPaid: '100.00', status: 'sent' }, lines, 0, 0) as any).fields.status).toBe('paid')
  })

  test('an edit after a payment keeps the payment’s status', async () => {
    const made = await json(await call('/api/invoices', { method: 'POST', json: { contactId, lineItems: [{ description: 'Work', quantity: 1, unitPrice: 100 }] } }))
    expect(made.status).toBe(201)
    expect((await call(`/api/invoices/${made.body.id}/payments`, { method: 'POST', json: { amount: 40, method: 'cash' } })).status).toBe(201)
    const edited = await json(await call(`/api/invoices/${made.body.id}`, { method: 'PUT', json: { lineItems: [{ description: 'Work', quantity: 1, unitPrice: 120 }] } }))
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ total: '120.00', status: 'partial', amountPaid: '40.00' })
    // Below what is paid is refused.
    expect((await call(`/api/invoices/${made.body.id}`, { method: 'PUT', json: { lineItems: [{ description: 'Work', quantity: 1, unitPrice: 30 }] } })).status).toBe(400)
  })
})

describe('02-3: a recurring schedule’s money is an invoice’s money', () => {
  test('tax is on what is left after the discount, and bad figures are refused', async () => {
    expect(scheduleTotals([{ description: 'Mowing', quantity: 1, unitPrice: 100 }], 10, 10)).toMatchObject({ subtotal: 100, taxAmount: 9, total: 99 })
    const body = { contactId, frequency: 'monthly', startDate: '2030-01-15', taxRate: 10, discount: 10, lineItems: [{ description: 'Mowing', quantity: 1, unitPrice: 100 }] }
    const made = await json(await call('/api/recurring', { method: 'POST', json: body }))
    expect(made.status).toBe(201)
    expect(Number(made.body.total)).toBe(99)
    expect(Number(made.body.taxAmount)).toBe(9)
    expect((await call('/api/recurring', { method: 'POST', json: { ...body, discount: 500 } })).status).toBe(400)
    expect((await call('/api/recurring', { method: 'POST', json: { ...body, lineItems: [{ description: 'Mowing', quantity: -2, unitPrice: 100 }] } })).status).toBe(400)
    // The rate alone re-works the total.
    const noTax = await json(await call(`/api/recurring/${made.body.id}`, { method: 'PUT', json: { taxRate: 0 } }))
    expect(noTax.status).toBe(200)
    expect(Number(noTax.body.total)).toBe(90)
    expect(Number(noTax.body.taxAmount)).toBe(0)
    // An edit does not change whether the schedule runs: that is pause, resume and cancel.
    expect((await call(`/api/recurring/${made.body.id}/pause`, { method: 'POST' })).status).toBe(200)
    const sneaky = await json(await call(`/api/recurring/${made.body.id}`, { method: 'PUT', json: { status: 'active', notes: 'x' } }))
    expect(sneaky.body.status).toBe('paused')
  })
})

describe('02-5: one clock-in at a time', () => {
  test('two clock-ins sent together leave one open entry', async () => {
    const both = await Promise.all([call('/api/time/clock-in', { method: 'POST', json: {} }), call('/api/time/clock-in', { method: 'POST', json: {} })])
    expect(both.map((r) => r.status).sort()).toEqual([201, 409].sort())
    const open = await t.db.select().from(t.schema.timeEntry).where(and(eq(t.schema.timeEntry.companyId, companyId), isNull(t.schema.timeEntry.clockOut)))
    expect(open.length).toBe(1)
  })
})

describe('02-6: an amount between two commission brackets', () => {
  test('belongs to the lower bracket; past the last one the plan still does not say', () => {
    const plan = { planType: 'tiered', tiers: [{ min: 0, max: 1000, rate: 5 }, { min: 1001, max: 5000, rate: 10 }] }
    expect(commissionFor(plan, 1000.5)).toEqual({ amount: 50.03, rate: 5 })
    expect(commissionFor(plan, 2000)).toEqual({ amount: 200, rate: 10 })
    expect('error' in commissionFor(plan, 6000)).toBe(true)
  })
})

describe('02-10: a service agreement’s bill carries the business’s tax rate', () => {
  test('8% in Settings: $600 bills $648.00; no rate set: $600.00', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'invoices', 'jobs', 'recurring_jobs', 'time_tracking', 'service_agreements'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    const agreement = async (name: string) => (await json(await call('/api/agreements', { method: 'POST', json: { contactId, name, startDate: '2026-01-01', endDate: '2027-01-01', amount: 600, billingFrequency: 'annual', renewalType: 'manual' } }))).body
    const plain = await agreement('Plain plan')
    const billedPlain = await json(await call(`/api/agreements/${plain.id}/bill`, { method: 'POST', json: {} }))
    expect(billedPlain.body).toMatchObject({ subtotal: '600.00', taxAmount: '0.00', total: '600.00' })
    const [co] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId))
    await t.db.update(t.schema.company).set({ settings: { ...((co.settings as any) || {}), defaultTaxRate: 8 } } as any).where(eq(t.schema.company.id, companyId))
    const taxed = await agreement('Taxed plan')
    const billed = await json(await call(`/api/agreements/${taxed.id}/bill`, { method: 'POST', json: {} }))
    expect(billed.body).toMatchObject({ subtotal: '600.00', taxAmount: '48.00', total: '648.00' })
    expect(Number(billed.body.taxRate)).toBe(8)
    await t.db.update(t.schema.company).set({ settings: co.settings } as any).where(eq(t.schema.company.id, companyId))
  })
})
