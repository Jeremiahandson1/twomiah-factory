// Home care's billing group on the unified app (server/crm/homecare/billing): visit invoices, payments, payer rates,
// claims, EDI, remittance, payer payments, payers, authorizations, pricing and Stripe. Through the real server, signed in
// with real tokens. tests/unified/homecare/billing.test.ts and r3-billing.test.ts (the adapted copies of the template's
// suite files) hold the figures; this holds what the move itself changed:
//   · /api/billing is the visit invoicing AND the Factory subscription's doors, mounted once (modules/company.ts leaves
//     it to home care); /api/stripe is home care's own (modules/crm.ts leaves it too);
//   · the template's requireAdmin became care-billing permissions — a caregiver of either seat is refused, a manager
//     reads and may not write; a caregiver's pay rate by care type is care-payroll;
//   · one company's invoices, payments, rates, claims, payers and authorizations never reach another's, and nothing
//     written names another company's row;
//   · replies are camelCase, a list is { data, pagination }, a refusal is { error, code };
//   · the fixes made in the move (each named below).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { ymdIn } from '../server/crm/homecare/core/agencyTime.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const ids: Record<string, string> = {}
const tokens: Record<string, string> = {}
const PASSWORD = 'Pass-word-1'

const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const rows = async (q: any) => ((await t.db.execute(q)) as any).rows as any[]
const AGENCY_TZ = 'Pacific/Kiritimati' // UTC+14: the agency's date is a day ahead of UTC's for ten hours of every day

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: AGENCY_TZ } as any).where(eq(t.schema.company.id, companyId))
  for (const [role, email] of [['admin', 'admin@hc.example'], ['manager', 'mgr@hc.example'], ['caregiver', 'cg@hc.example'], ['field', 'fld@hc.example']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({
      email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: email.split('@')[0], lastName: 'Tester', role, companyId,
    } as any).returning()
    ids[email.split('@')[0]] = u.id
  }
  for (const who of ['admin', 'mgr', 'cg', 'fld']) tokens[who] = await signIn(`${who}@hc.example`, PASSWORD)
  tokens.owner = await signIn('owner@test.example', seeded.password)

  const [payer] = await t.db.insert(t.schema.referralSources).values({ companyId, name: 'County Plan', payerType: 'MCO', isActivePayer: true } as any).returning()
  ids.payer = payer.id
  await t.db.insert(t.schema.referralSourceRates).values({ companyId, referralSourceId: payer.id, rateAmount: '30.00', rateType: 'hourly', isActive: true } as any)
  const [ada] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Ada', lastName: 'Client', isActive: true, referredById: payer.id } as any).returning()
  ids.ada = ada.id
  const [inv] = await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'HC-1', clientId: ada.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-14', subtotal: '120', total: '120', paymentStatus: 'pending', sentAt: new Date('2026-09-15T15:00:00Z') } as any).returning()
  ids.invoice = inv.id
  const [cl] = await t.db.insert(t.schema.claims).values({ companyId, clientId: ada.id, payerId: payer.id, claimNumber: 'CLM-A', billedAmount: '120', status: 'submitted', serviceDate: '2026-09-02' } as any).returning()
  ids.claim = cl.id

  // Another company in the same database, with a payer, client, invoice, claim and rate of its own.
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Agency', slug: 'other-agency' }).returning()
  const [opayer] = await t.db.insert(t.schema.referralSources).values({ companyId: other.id, name: 'Other Plan', payerType: 'MCO', isActivePayer: true } as any).returning()
  ids.otherPayer = opayer.id
  const [orate] = await t.db.insert(t.schema.referralSourceRates).values({ companyId: other.id, referralSourceId: opayer.id, rateAmount: '99.00', rateType: 'hourly', isActive: true } as any).returning()
  ids.otherRate = orate.id
  const [ocl] = await t.db.insert(t.schema.clients).values({ companyId: other.id, firstName: 'Oscar', lastName: 'Other', isActive: true, referredById: opayer.id } as any).returning()
  ids.otherClient = ocl.id
  const [oinv] = await t.db.insert(t.schema.invoices).values({ companyId: other.id, invoiceNumber: 'OT-1', clientId: ocl.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-14', subtotal: '999', total: '999', paymentStatus: 'pending', sentAt: new Date('2026-09-15T15:00:00Z') } as any).returning()
  ids.otherInvoice = oinv.id
  const [ocla] = await t.db.insert(t.schema.claims).values({ companyId: other.id, clientId: ocl.id, payerId: opayer.id, claimNumber: 'CLM-O', billedAmount: '999', status: 'submitted', serviceDate: '2026-09-02' } as any).returning()
  ids.otherClaim = ocla.id
})

describe('the mounts', () => {
  test('/api/billing is the visit invoicing and the subscription doors, once', async () => {
    expect((await as('admin', '/api/billing/invoices')).status).toBe(200)
    // The subscription door answers (the Factory is unreachable here, so it may say so — but it is not a 404).
    expect((await as('owner', '/api/billing/subscription')).status).not.toBe(404)
    // Its gate is its own path's, not the whole prefix: a manager reads invoices but not the subscription.
    expect((await as('mgr', '/api/billing/invoices')).status).toBe(200)
    expect((await as('mgr', '/api/billing/subscription')).status).toBe(403)
    expect(t.services.mounts.filter((m: any) => m.path === '/api/billing')).toHaveLength(1)
    expect(t.services.mounts.filter((m: any) => m.path === '/api/stripe')).toHaveLength(1)
  })

  test("/api/stripe is home care's: its status answers, its webhook needs Stripe", async () => {
    expect(await (await as('cg', '/api/stripe/status')).json()).toEqual({ configured: false })
    expect((await t.call('/api/stripe/status')).status).toBe(401)
    const w = await t.call('/api/stripe/webhook', { method: 'POST', json: {} })
    expect(w.status).toBe(503)
  })
})

describe('who may', () => {
  const OFFICE: Array<[string, string, unknown?]> = [
    ['GET', '/api/billing/invoices'], ['GET', '/api/billing/invoice-payments'], ['GET', '/api/billing/referral-source-rates'],
    ['POST', '/api/billing/invoices/generate-with-rates', { clientId: 'x', billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-07' }],
    ['POST', '/api/billing/invoice-payments', { invoiceId: 'x', amount: 1 }], ['DELETE', '/api/billing/invoices/x'],
    ['GET', '/api/claims'], ['POST', '/api/claims/batch-generate', { startDate: '2026-09-01', endDate: '2026-09-30' }],
    ['GET', '/api/edi/batches'], ['GET', '/api/remittance'], ['GET', '/api/payments'], ['GET', '/api/authorizations'],
    ['GET', '/api/pricing'], ['GET', '/api/pricing/care-type-rates'], ['POST', '/api/payers', { name: 'X' }],
    // The template let any signed-in person read an invoice and its Stripe payment here.
    ['GET', '/api/stripe/payments/x'],
  ]
  test('a caregiver of either seat is refused every billing door', async () => {
    for (const who of ['cg', 'fld']) {
      for (const [method, path, json] of OFFICE) {
        const r = await as(who, path, { method, json })
        expect({ who, path, status: r.status }).toEqual({ who, path, status: 403 })
      }
    }
  })

  test("a caregiver still reads the payer list (their client screens' dropdown)", async () => {
    const r = await (await as('cg', '/api/payers')).json()
    expect(r.data.map((p: any) => p.id)).toEqual([ids.payer])
  })

  test('a manager reads the billing it produces and writes none of it; pay rates are payroll', async () => {
    for (const path of ['/api/billing/invoices', '/api/claims', '/api/billing/billing-summary', '/api/authorizations', '/api/payments']) {
      expect({ path, status: (await as('mgr', path)).status }).toEqual({ path, status: 200 })
    }
    expect((await as('mgr', '/api/billing/invoice-payments', { method: 'POST', json: { invoiceId: ids.invoice, amount: 1 } })).status).toBe(403)
    expect((await as('mgr', `/api/billing/invoices/${ids.invoice}/release`, { method: 'POST' })).status).toBe(403)
    expect((await as('mgr', '/api/pricing/care-type-rates')).status).toBe(403)
    expect((await as('admin', '/api/pricing/care-type-rates')).status).toBe(200)
  })
})

describe("one company's billing", () => {
  test('lists hold only this company', async () => {
    const inv = await (await as('admin', '/api/billing/invoices')).json()
    expect(inv.data.map((i: any) => i.id)).toEqual([ids.invoice])
    expect(inv.pagination).toMatchObject({ page: 1, total: 1 })
    const claims = await (await as('admin', '/api/claims')).json()
    expect(claims.data.map((c: any) => c.id)).toEqual([ids.claim])
    const rates = await (await as('admin', '/api/billing/referral-source-rates')).json()
    expect(rates.data.every((r: any) => r.referralSourceId === ids.payer)).toBe(true)
    const sum = await (await as('admin', '/api/billing/billing-summary')).json()
    expect(Number(sum.summary.totalBilled)).toBe(120)
  })

  test("another company's records are not found, and nothing of theirs is written", async () => {
    expect((await as('admin', `/api/billing/invoices/${ids.otherInvoice}`)).status).toBe(404)
    expect((await as('admin', '/api/billing/invoice-payments', { method: 'POST', json: { invoiceId: ids.otherInvoice, amount: 5 } })).status).toBe(404)
    expect((await as('admin', `/api/billing/invoices/${ids.otherInvoice}/release`, { method: 'POST' })).status).toBe(404)
    expect((await as('admin', `/api/billing/invoices/${ids.otherInvoice}`, { method: 'DELETE' })).status).toBe(404)
    expect((await as('admin', `/api/billing/referral-source-rates/${ids.otherRate}`, { method: 'PUT', json: { rateAmount: 1 } })).status).toBe(404)
    // A new rate must be for this company's payer (the template trusted the id).
    expect((await as('admin', '/api/billing/referral-source-rates', { method: 'POST', json: { referralSourceId: ids.otherPayer, rateAmount: 5 } })).status).toBe(404)
    expect((await as('admin', `/api/claims/${ids.otherClaim}`)).status).toBe(404)
    expect((await as('admin', '/api/claims', { method: 'POST', json: { invoiceId: ids.otherInvoice } })).status).toBe(404)
    expect((await as('admin', `/api/payers/${ids.otherPayer}`, { method: 'PUT', json: { name: 'Mine now' } })).status).toBe(404)
    expect((await as('admin', '/api/authorizations', { method: 'POST', json: { clientId: ids.otherClient, authorizedUnits: 10, startDate: '2026-01-01', endDate: '2026-12-31' } })).status).toBe(404)
    const [other] = await rows(sql`SELECT amount_paid, sent_at FROM invoices WHERE id = ${ids.otherInvoice}`)
    expect(other.amount_paid).toBeNull()
    const [orate] = await rows(sql`SELECT rate_amount FROM referral_source_rates WHERE id = ${ids.otherRate}`)
    expect(Number(orate.rate_amount)).toBe(99)
  })

  test("a payer payment matched to another company's claim is refused before anything is written (it used to fail on the foreign key after the payment row)", async () => {
    const before = (await rows(sql`SELECT COUNT(*)::int AS n FROM payments`))[0].n
    const r = await as('admin', '/api/payments', { method: 'POST', json: { checkAmount: 999, claimMatches: [{ claimId: ids.otherClaim, amount: 999 }] } })
    expect(r.status).toBe(404)
    expect((await rows(sql`SELECT COUNT(*)::int AS n FROM payments`))[0].n).toBe(before)
    const [oc] = await rows(sql`SELECT status FROM claims WHERE id = ${ids.otherClaim}`)
    expect(oc.status).toBe('submitted')
  })

  test('a body cannot set the company or the id of what it creates', async () => {
    const r = await as('admin', '/api/pricing', { method: 'POST', json: { serviceType: 'Companion', clientHourlyRate: '30', id: 'chosen-id', companyId: 'other' } })
    expect(r.status).toBe(201)
    const p = await r.json()
    expect(p.id).not.toBe('chosen-id')
    expect(p.companyId).toBe(companyId)
  })
})

describe('reply shapes', () => {
  test('rows are camelCase', async () => {
    const one = await (await as('admin', `/api/billing/invoices/${ids.invoice}`)).json()
    expect(one).toMatchObject({ invoiceNumber: 'HC-1', billingPeriodStart: '2026-09-01', firstName: 'Ada', lineItems: [], totalHours: 0 })
    expect(Object.keys(one).some((k) => k.includes('_'))).toBe(false)
    const claim = await (await as('admin', `/api/claims/${ids.claim}`)).json()
    expect(claim).toMatchObject({ claimNumber: 'CLM-A', chargeAmount: '120.00', serviceDate: '2026-09-02', statusHistory: [] })
    const aging = (await (await as('admin', '/api/claims/reports/summary')).json()).aging
    expect(Object.keys(aging).sort()).toEqual(['days30To60', 'days60To90', 'over90', 'under30'])
  })

  test('a refusal is { error, code }', async () => {
    const r = await as('admin', '/api/billing/invoice-payments', { method: 'POST', json: { invoiceId: ids.invoice, amount: 500 } })
    expect(r.status).toBe(409)
    const b = await r.json()
    expect(Object.keys(b).sort()).toEqual(['code', 'error'])
    expect(b.code).toBe('overpayment')
    expect(b.error).toMatch(/exceeds the \$120\.00 balance due/)
  })
})

describe('fixes made in the move', () => {
  test('a blank low-units alert box takes the default on a new authorization and leaves it alone on an edit', async () => {
    const made = await as('admin', '/api/authorizations', { method: 'POST', json: { clientId: ids.ada, authorizedUnits: 40, startDate: '2026-01-01', endDate: '2026-12-31', lowUnitsAlertThreshold: null } })
    expect(made.status).toBe(201)
    const auth = await made.json()
    expect(Number(auth.lowUnitsAlertThreshold)).toBe(20)
    await as('admin', `/api/authorizations/${auth.id}`, { method: 'PUT', json: { lowUnitsAlertThreshold: 8 } })
    const edited = await as('admin', `/api/authorizations/${auth.id}`, { method: 'PUT', json: { notes: 'renewed', lowUnitsAlertThreshold: '' } })
    expect(edited.status).toBe(200)
    expect(Number((await edited.json()).lowUnitsAlertThreshold)).toBe(8)
  })

  test("an undated payer payment is dated today on the agency's clock (the template took UTC's date)", async () => {
    const r = await as('admin', '/api/payments', { method: 'POST', json: { checkAmount: 120, claimMatches: [{ claimId: ids.claim, amount: 120 }] } })
    expect(r.status).toBe(200)
    const out = await r.json()
    expect(out.payment.paymentDate).toBe(ymdIn(new Date(), AGENCY_TZ))
    const [cl] = await rows(sql`SELECT status, to_char(paid_date, 'YYYY-MM-DD') AS paid FROM claims WHERE id = ${ids.claim}`)
    expect(cl).toEqual({ status: 'paid', paid: ymdIn(new Date(), AGENCY_TZ) })
  })

  test('a payer payment records who entered it (the template read user.id, which its token never carried: always null)', async () => {
    const r = await as('admin', '/api/payments', { method: 'POST', json: { checkAmount: 10, paymentDate: '2026-09-30' } })
    const out = await r.json()
    const [p] = await rows(sql`SELECT created_by FROM payments WHERE id = ${out.payment.id}`)
    expect(p.created_by).toBe(ids.admin)
  })
})

// Last: it adds 206 invoices. The Billing page summed its first page of 200 invoices for its headline figures.
describe("the Billing page's totals cover every invoice", () => {
  test('outstanding, aging and drafts count past the first 200, and only this company\'s', async () => {
    const get = async () => (await as('admin', '/api/billing/invoices/totals')).json()
    const before = await get()
    const many = Array.from({ length: 205 }, (_, i) => ({
      companyId, invoiceNumber: `BULK-${i}`, clientId: ids.ada, billingPeriodStart: '2026-01-01', billingPeriodEnd: '2026-01-07',
      subtotal: '10', total: '10', paymentStatus: 'pending', paymentDueDate: '2026-01-15', sentAt: new Date('2026-01-08T15:00:00Z'),
    }))
    await t.db.insert(t.schema.invoices).values(many as any)
    await t.db.insert(t.schema.invoices).values({ companyId, invoiceNumber: 'DRAFT-X', clientId: ids.ada, billingPeriodStart: '2026-02-01', billingPeriodEnd: '2026-02-07', subtotal: '7', total: '7', paymentStatus: 'pending' } as any)
    const after = await get()
    expect(Math.round((after.outstanding - before.outstanding) * 100)).toBe(205000)
    expect(Math.round((after.aging.over90 - before.aging.over90) * 100)).toBe(205000)
    expect(after.draftCount - before.draftCount).toBe(1)
    expect(Math.round((after.draftTotal - before.draftTotal) * 100)).toBe(700)
    // The other agency's $999 invoice is never in them.
    const [{ n }] = await rows(sql`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0) - COALESCE(amount_adjusted,0)),0)::float AS n FROM invoices WHERE company_id = ${companyId} AND (sent_at IS NOT NULL OR payment_status IN ('paid','partial')) AND total - COALESCE(amount_paid,0) - COALESCE(amount_adjusted,0) > 0`)
    expect(Math.round(after.outstanding * 100)).toBe(Math.round(Number(n) * 100))
    expect((await as('cg', '/api/billing/invoices/totals')).status).toBe(403)
  })
})
