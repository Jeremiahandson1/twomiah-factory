// Home care split billing (care_split_billing, not ready) — the AxisCare / WellSky way the owner chose (10/30): a client's
// payers in priority order, each a percent of each visit or an amount per hour, the family paying the rest; never more than
// the visit. Through the real server:
//   · off: the routes are refused and an invoice is made whole, as before; a caregiver seat cannot read or set a split;
//   · the rules are refused in words: a payer that is not an active payer, the same payer twice, percents over 100%;
//   · one invoice made for a split client is one invoice per party, made together: the payers' shares in order, each
//     capped at what is left of each visit, the family's rest — and to the cent they add up to the visit;
//   · the period is then billed: a second invoice is refused; a part's lines cannot be edited by hand;
//   · the family's card, the family portal and the family's email see only the family's part; a payer's part is emailed
//     to the payer's billing contact; the caregiver's hours count once;
//   · deleting a part deletes the split — and not while a payment is on any part of it.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { splitLines } from '../server/crm/homecare/core/splitBilling.ts'
import { invoicesDueForCharge } from '../server/data/homecareAutopay.ts'
import { clientVisibleInvoiceSql } from '../server/data/homecareBilling.ts'
import { billingSummaryFigures } from '../server/data/homecareBillingRoutes.ts'

const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any })
let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', clientId = '', caregiverId = '', ltc = '', va = '', idle = ''
const tokens: Record<string, string> = {}
const sent: Array<{ to: string; template: string }> = []
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const as = (who: string) => async (p: string, init: any = {}): Promise<Response> => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const BASE = ['contacts', 'scheduling', 'team']
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const invoicesOf = async (start: string) => (await t.db.select().from(t.schema.invoices)
  .where(and(eq(t.schema.invoices.clientId, clientId), eq(t.schema.invoices.billingPeriodStart, start)))) as any[]
/** A manual invoice for the period: a 4-hour and a 2-hour visit at the client's $25 an hour ($100 + $50). */
const bill = (start: string, end: string, dates = [start, end]) => as('owner')('/api/billing/invoices/manual', { method: 'POST', json: {
  clientId, billingPeriodStart: start, billingPeriodEnd: end,
  lineItems: [{ caregiverId, hours: 4, serviceDate: dates[0], description: 'Personal care' }, { caregiverId, hours: 2, serviceDate: dates[1], description: 'Companionship' }],
} }).then(json)
const setSplit = (payers: any[], who = 'owner') => as(who)(`/api/care-split/clients/${clientId}`, { method: 'PUT', json: { payers } }).then(json)

beforeAll(async () => {
  process.env.SMTP_HOST ||= 'smtp.invalid' // a provider, so the agency "can send"; the send itself is replaced below
  t = await bootTenant({ vertical: 'homecare' })
  const s = await seedOwner(t)
  companyId = s.company.id
  tokens.owner = await login('owner@test.example', s.password)
  const email: any = t.services.email
  email.send = async (to: string, template: string) => { sent.push({ to, template }); return { success: true, dev: true } }
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  caregiverId = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  clientId = (await ins(t.schema.clients, { companyId, firstName: 'Ada', lastName: 'Client', email: 'ada@family.example', isActive: true, isPrivatePay: true, privatePayRate: '25', privatePayRateType: 'hourly' })).id
  ltc = (await ins(t.schema.referralSources, { companyId, name: 'Genworth LTC', payerType: 'ltc_insurance', isActivePayer: true, billingContactEmail: 'claims@genworth.example' })).id
  va = (await ins(t.schema.referralSources, { companyId, name: 'VA Community Care', payerType: 'va', isActivePayer: true, email: 'billing@va.example' })).id
  idle = (await ins(t.schema.referralSources, { companyId, name: 'Old payer', payerType: 'other', isActivePayer: false })).id
  await setFeatures(BASE)
}, 120_000)

describe('the arithmetic', () => {
  test('in order, each capped at what is left; the parts add up to every visit to the cent', () => {
    const lines = [{ hours: 4, amount: 100 }, { hours: 2, amount: 50 }, { hours: 3, amount: 33.33 }]
    const { parts } = splitLines(lines, [{ payerId: 'a', priority: 1, kind: 'percent', value: 50 }, { payerId: 'b', priority: 2, kind: 'per_hour', value: 10 }])
    // a: half of each ($50, $25, $16.67). b: $10 an hour of what is left ($40, $20, and $16.66 — all that is left of the
    // third, not its $30). The family: $10 + $5 + $0.
    expect(parts.map((p) => [p.billTo, p.payerId, p.total])).toEqual([['payer', 'a', 91.67], ['payer', 'b', 76.66], ['family', null, 15]])
    expect(Math.round(parts.reduce((s, p) => s + p.total, 0) * 100)).toBe(Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100))
    // An hourly share bigger than the visit stops at the visit; nothing is left for the family, so the family has no part.
    const capped = splitLines([{ hours: 1, amount: 20 }], [{ payerId: 'a', priority: 1, kind: 'per_hour', value: 30 }])
    expect(capped.parts.map((p) => [p.billTo, p.total])).toEqual([['payer', 20]])
  })
})

describe('switched off, and for the billing seats only', () => {
  test('without the feature the routes are refused and an invoice is made whole', async () => {
    expect((await as('owner')(`/api/care-split/clients/${clientId}`)).status).toBe(403)
    await t.db.insert(t.schema.clientBillingSplits).values({ companyId, clientId, payerId: ltc, priority: 1, kind: 'percent', value: '50' })
    const r = await bill('2026-09-01', '2026-09-07')
    expect(r.status).toBe(201)
    const made = await invoicesOf('2026-09-01')
    expect(made.map((i) => [i.total, i.billTo, i.splitGroupId])).toEqual([['150.00', 'family', null]])
    await t.db.delete(t.schema.clientBillingSplits).where(eq(t.schema.clientBillingSplits.clientId, clientId))
  })

  test('a caregiver cannot read or set a split', async () => {
    await setFeatures([...BASE, 'care_split_billing'])
    expect((await as('ann')(`/api/care-split/clients/${clientId}`)).status).toBe(403)
    expect((await setSplit([{ payerId: ltc, kind: 'percent', value: 50 }], 'ann')).status).toBe(403)
  })
})

describe('the rules', () => {
  test('refused in words', async () => {
    for (const [payers, words] of [
      [[{ payerId: idle, kind: 'percent', value: 10 }], 'active payers'],
      [[{ payerId: ltc, kind: 'percent', value: 10 }, { payerId: ltc, kind: 'per_hour', value: 5 }], 'once'],
      [[{ payerId: ltc, kind: 'percent', value: 60 }, { payerId: va, kind: 'percent', value: 50 }], 'more than 100%'],
      [[{ payerId: ltc, kind: 'percent', value: 0 }], 'more than 0'],
      [[{ payerId: ltc, kind: 'flat', value: 5 }], 'percent'],
    ] as const) {
      const r = await setSplit(payers as any)
      expect([r.status, r.body.error]).toEqual([400, expect.stringContaining(words)])
    }
  })

  test('saved in the order given, read back with the payers named', async () => {
    const r = await setSplit([{ payerId: ltc, kind: 'percent', value: 50 }, { payerId: va, kind: 'per_hour', value: 10 }])
    expect(r.status).toBe(200)
    expect(r.body.payers.map((p: any) => [p.payerName, p.kind, p.value, p.priority])).toEqual([['Genworth LTC', 'percent', 50, 1], ['VA Community Care', 'per_hour', 10, 2]])
  })
})

describe('an invoice for a split client', () => {
  let parts: any[] = []
  test('is one per party, made together, and they add up to the visits', async () => {
    const r = await bill('2026-10-01', '2026-10-07')
    expect(r.status).toBe(201)
    expect(r.body.billTo).toBe('family')
    parts = (await invoicesOf('2026-10-01')).sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber))
    // Genworth: half of each visit ($50 + $25). VA: $10 an hour of what is left ($40 + $20). The family: the rest ($10 + $5).
    expect(parts.map((p) => [p.referralSourceId, p.billTo, p.total, p.countsHours])).toEqual([
      [ltc, 'payer', '75.00', true], [va, 'payer', '60.00', false], [null, 'family', '15.00', false],
    ])
    expect(new Set(parts.map((p) => p.splitGroupId)).size).toBe(1)
    expect(parts.reduce((s, p) => s + Number(p.total), 0)).toBe(150)
    const vaLines = await t.db.select().from(t.schema.invoiceLineItems).where(eq(t.schema.invoiceLineItems.invoiceId, parts[1].id)) as any[]
    expect(vaLines.map((l) => [Number(l.hours), Number(l.rate), Number(l.amount)]).sort()).toEqual([[2, 10, 20], [4, 10, 40]])
  })

  test('the period is billed: a second invoice is refused, and a part cannot be edited by hand', async () => {
    const again = await bill('2026-10-01', '2026-10-07')
    expect(again.status).toBe(400)
    expect(again.body.error).toContain('already exists')
    const edit = await json(await as('owner')(`/api/billing/invoices/${parts[2].id}/line-items`, { method: 'PUT', json: { lineItems: [{ caregiverId, hours: 1 }] } }))
    expect([edit.status, edit.body.code]).toEqual([409, 'split_part'])
  })

  test("the family's card and portal see only the family's part; the caregiver's hours count once", async () => {
    for (const p of parts) expect((await as('owner')(`/api/billing/invoices/${p.id}/release`, { method: 'POST' })).status).toBe(200)
    await t.db.insert(t.schema.clientAutopay).values({ companyId, clientId, status: 'active', stripeCustomerId: 'cus_1', paymentMethodId: 'pm_1' } as any)
    const due = (await invoicesDueForCharge(t.db as any, companyId, 4, 15)).map((r) => r.id)
    expect(due).toEqual([parts[2].id])
    const visible = (await t.db.select({ id: t.schema.invoices.id }).from(t.schema.invoices)
      .where(and(eq(t.schema.invoices.clientId, clientId), eq(t.schema.invoices.billingPeriodStart, '2026-10-01'), clientVisibleInvoiceSql()))).map((r: any) => r.id)
    expect(visible).toEqual([parts[2].id])
    const fig = await billingSummaryFigures(t.db as any, companyId, '2026-10-01', '2026-10-31')
    expect(Number(fig.byCaregiver.find((c: any) => c.caregiverName === 'Ann Carer')?.totalHours)).toBe(6)
    expect(Number(fig.summary.totalBilled)).toBe(150)
  })

  test("a payer's part is emailed to the payer's billing contact, the family's to the family", async () => {
    for (const [p, to] of [[parts[0], 'claims@genworth.example'], [parts[1], 'billing@va.example'], [parts[2], 'ada@family.example']] as const) {
      const r = await as('owner')(`/api/billing/invoices/${p.id}/send-email`, { method: 'POST', json: {} })
      expect(r.status).toBe(200)
      expect(sent.at(-1)?.to).toBe(to)
    }
  })

  test('deleting a part deletes the split — but not while a payment is on any part', async () => {
    await t.db.insert(t.schema.invoicePayments).values({ companyId, invoiceId: parts[0].id, amount: '75.00', paymentDate: '2026-10-20', paymentMethod: 'check' } as any)
    await t.db.update(t.schema.invoices).set({ amountPaid: '75.00', paymentStatus: 'paid' } as any).where(eq(t.schema.invoices.id, parts[0].id))
    const refused = await json(await as('owner')(`/api/billing/invoices/${parts[2].id}`, { method: 'DELETE' }))
    expect([refused.status, refused.body.code]).toEqual([409, 'split_has_payment'])
    expect((await invoicesOf('2026-10-01')).length).toBe(3)
    // Another period, nothing paid: one delete takes the whole split, and the period can be billed again.
    expect((await bill('2026-11-01', '2026-11-07')).status).toBe(201)
    const nov = await invoicesOf('2026-11-01')
    expect(nov.length).toBe(3)
    expect((await as('owner')(`/api/billing/invoices/${nov[1].id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await invoicesOf('2026-11-01')).toEqual([])
    expect((await bill('2026-11-01', '2026-11-07')).status).toBe(201)
  })
})
