// Home care's payroll group on the unified app (server/crm/homecare/payroll): who may do what, the company's records
// only, and the defects the move fixed.
//   · Permissions: the template's admin-only paths need care-payroll:update, which a caregiver (and the office manager)
//     does not hold; a caregiver lists and records their own mileage and time off, and reads their own rates.
//   · One company's payroll never reaches another's.
//   · Fixed: a care-type rate took the request body as it came (any column, the company's included); a PUT naming no
//     rate answered 200 with nothing; "today" for the rates in force was UTC's day, not the agency's.
//   · Home care's /api/expenses and /api/payroll are its own (the CRM's shared ones stand aside).
//   · The Gusto preview answers in camelCase (RULEBOOK §2) — r3pay.test.ts's adapted copy reads it so.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
let coA = '', coB = ''
const as = (who: string, method: string, path: string, json?: unknown) =>
  t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s) } catch { return s } }

/** The calendar day in a zone, n days on. */
const dayIn = (tz: string, n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(Date.now() + n * 86400000))
// A zone whose calendar day is not UTC's right now: ahead of it from 10:00 UTC, behind it before.
const ZONE = new Date().getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago'

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const S = t.schema
  const [a] = await t.db.insert(S.company).values({ name: 'Agency A', slug: 'agency-a', timezone: ZONE }).returning()
  const [b] = await t.db.insert(S.company).values({ name: 'Agency B', slug: 'agency-b' }).returning()
  coA = a.id; coB = b.id
  const hash = await Bun.password.hash('Seat-pass-1', 'bcrypt')
  const people: [string, string, string][] = [
    ['ownerA', 'owner', coA], ['adminA', 'admin', coA], ['managerA', 'manager', coA],
    ['cg1', 'caregiver', coA], ['cg2', 'field', coA], ['ownerB', 'owner', coB], ['cgB', 'caregiver', coB],
  ]
  let n = 0
  for (const [who, role, companyId] of people) {
    const [u] = await t.db.insert(S.user).values({ email: `${who.toLowerCase()}@care.example`, passwordHash: hash, firstName: who, lastName: 'Payroll', role, companyId, defaultPayRate: '20.00' }).returning()
    ids[who] = u.id
    // Each from its own address: the sign-in limit is per address.
    const res = await t.call('/api/auth/login', { method: 'POST', json: { email: `${who.toLowerCase()}@care.example`, password: 'Seat-pass-1' }, headers: { 'X-Forwarded-For': `203.0.113.${++n}` } })
    tokens[who] = (await res.json()).accessToken
  }
})

describe('permissions: the office runs payroll; a caregiver keeps to their own', () => {
  const ADMIN_ONLY: [string, string, unknown?][] = [
    ['POST', '/api/payroll/calculate', { startDate: '2026-09-06', endDate: '2026-09-19' }],
    ['GET', '/api/payroll/summary?startDate=2026-09-06&endDate=2026-09-19'],
    ['POST', '/api/payroll-shift-reviews/generate-shifts', { startDate: '2026-09-06', endDate: '2026-09-19' }],
    ['GET', '/api/gusto/preview?startDate=2026-09-06&endDate=2026-09-19'],
    ['GET', '/api/expenses'],
    ['POST', '/api/expenses', { description: 'Gloves', amount: '12.50', date: '2026-09-07' }],
    ['GET', '/api/payroll-verification'],
    ['PUT', '/api/payroll-verification/settings', { paydayVerification: true }],
    ['PUT', '/api/caregiver-rates/someone', { base: 30 }],
    ['POST', '/api/caregiver-care-type-rates', { caregiverId: 'x', careTypeId: 'x', hourlyRate: '40' }],
    ['POST', '/api/pto/anything/approve'],
  ]
  test('a caregiver (stored as caregiver or as field) and the office manager are refused the office\'s paths', async () => {
    for (const who of ['cg1', 'cg2', 'managerA']) {
      for (const [m, p, j] of ADMIN_ONLY) {
        const r = await as(who, m, p, j)
        expect({ who, m, p, status: r.status }).toEqual({ who, m, p, status: 403 })
      }
    }
  })
  test('the owner and an admin get past every one', async () => {
    for (const who of ['ownerA', 'adminA']) {
      for (const [m, p, j] of ADMIN_ONLY) {
        const r = await as(who, m, p, j)
        expect({ who, m, p, refused: r.status === 403 || r.status === 401 }).toEqual({ who, m, p, refused: false })
      }
    }
  })

  test('mileage: a caregiver records and lists only their own, at the agency rate', async () => {
    const mine = await as('cg1', 'POST', '/api/mileage', { caregiverId: ids.cg2, date: '2026-09-07', miles: '10', ratePerMile: '4.00' })
    const row = await body(mine)
    expect(mine.status).toBe(201)
    expect(row.caregiverId).toBe(ids.cg1)
    expect(row.companyId).toBe(coA)
    expect(Number(row.ratePerMile)).toBe(0.67)
    await as('ownerA', 'POST', '/api/mileage', { caregiverId: ids.cg2, date: '2026-09-08', miles: '5' })
    const list = await body(await as('cg1', 'GET', `/api/mileage?caregiverId=${ids.cg2}`))
    expect(list.data.map((e: any) => e.caregiverId)).toEqual([ids.cg1])
    expect(list.pagination.total).toBe(1)
    const office = await body(await as('ownerA', 'GET', `/api/mileage?caregiverId=${ids.cg2}`))
    expect(office.data.length).toBe(1)
  })

  test('time off: a caregiver requests their own; naming someone else is refused', async () => {
    expect((await as('cg1', 'POST', '/api/pto', { caregiverId: ids.cg2, startDate: '2026-11-02', endDate: '2026-11-03' })).status).toBe(403)
    const ok = await as('cg1', 'POST', '/api/pto', { startDate: '2026-11-02', endDate: '2026-11-03', type: 'vacation' })
    expect(ok.status).toBe(201)
    await as('ownerA', 'POST', '/api/pto', { caregiverId: ids.cg2, startDate: '2026-11-09', endDate: '2026-11-09' })
    const mine = await body(await as('cg1', 'GET', '/api/pto'))
    expect(mine.data.map((e: any) => e.caregiverId)).toEqual([ids.cg1])
    const all = await body(await as('ownerA', 'GET', '/api/pto'))
    expect(all.data.length).toBe(2)
  })

  test('rates: a caregiver reads their own, not another\'s', async () => {
    expect((await as('cg1', 'GET', `/api/caregiver-rates/${ids.cg1}`)).status).toBe(200)
    expect((await as('cg1', 'GET', `/api/caregiver-rates/${ids.cg2}`)).status).toBe(403)
    expect((await as('cg1', 'GET', `/api/caregiver-care-type-rates?caregiverId=${ids.cg2}`)).status).toBe(403)
  })

  test('payday verification: only a caregiver confirms; a dispute tells everyone who runs payroll', async () => {
    expect((await as('ownerA', 'POST', '/api/payroll-verification/me/verify', { payPeriodStart: '2026-09-27', payPeriodEnd: '2026-10-03', confirmed: true })).status).toBe(403)
    const disp = await as('cg2', 'POST', '/api/payroll-verification/me/verify', { payPeriodStart: '2026-09-27', payPeriodEnd: '2026-10-03', confirmed: false, disputeReason: 'Short 2h' })
    expect((await body(disp)).status).toBe('disputed')
    const notes = await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.type, 'payroll_dispute'))
    expect(notes.map((n: any) => n.userId).sort()).toEqual([ids.adminA, ids.ownerA].sort())
    expect(notes.every((n: any) => n.companyId === coA)).toBe(true)
  })
})

describe('one company\'s payroll never reaches another\'s', () => {
  test('lists hold only the company\'s own rows', async () => {
    expect((await body(await as('ownerB', 'GET', '/api/mileage'))).data).toEqual([])
    expect((await body(await as('ownerB', 'GET', '/api/pto'))).data).toEqual([])
    expect((await body(await as('cgB', 'GET', '/api/mileage'))).data).toEqual([])
  })
  test('the office cannot write for another company\'s caregiver or client', async () => {
    expect((await as('ownerB', 'POST', '/api/mileage', { caregiverId: ids.cg1, date: '2026-09-07', miles: '3' })).status).toBe(404)
    expect((await as('ownerB', 'POST', '/api/pto', { caregiverId: ids.cg1, startDate: '2026-11-02', endDate: '2026-11-02' })).status).toBe(404)
    expect((await as('ownerB', 'PUT', `/api/caregiver-rates/${ids.cg1}`, { base: 99 })).status).toBe(404)
  })
  test('another company\'s time-off request cannot be answered', async () => {
    const [req] = await t.db.select().from(t.schema.caregiverTimeOff).where(eq(t.schema.caregiverTimeOff.caregiverId, ids.cg1))
    expect((await as('ownerB', 'POST', `/api/pto/${req.id}/approve`)).status).toBe(404)
  })
})

describe('care-type rates take only a rate\'s own fields (fixed: the template wrote the body as it came)', () => {
  test('a body naming another company, or another id, changes neither', async () => {
    const [ct] = await t.db.insert(t.schema.careTypes).values({ companyId: coA, name: 'Personal care' }).returning()
    const made = await as('ownerA', 'POST', '/api/caregiver-care-type-rates', { caregiverId: ids.cg1, careTypeId: ct.id, hourlyRate: '22.00', companyId: coB, id: 'chosen-id' })
    const row = await body(made)
    expect(made.status).toBe(201)
    expect(row.companyId).toBe(coA)
    expect(row.id).not.toBe('chosen-id')
    const put = await body(await as('ownerA', 'PUT', `/api/caregiver-care-type-rates/${row.id}`, { hourlyRate: '24.00', companyId: coB }))
    expect(put.companyId).toBe(coA)
    expect(put.hourlyRate).toBe('24.00')
  })
  test('a PUT naming no rate of the company is a 404 (the template answered 200 with nothing)', async () => {
    expect((await as('ownerA', 'PUT', '/api/caregiver-care-type-rates/nope', { hourlyRate: '1' })).status).toBe(404)
  })
  test('a care type of another company is refused', async () => {
    const [other] = await t.db.insert(t.schema.careTypes).values({ companyId: coB, name: 'Elsewhere' }).returning()
    expect((await as('ownerA', 'POST', '/api/caregiver-care-type-rates', { caregiverId: ids.cg1, careTypeId: other.id, hourlyRate: '1' })).status).toBe(404)
  })
})

describe('the rates in force are the agency\'s today (fixed: the template took UTC\'s day)', () => {
  test('a rate starting on the agency\'s today is in force; one starting on its tomorrow is not', async () => {
    await t.db.insert(t.schema.caregiverRates).values([
      { companyId: coA, caregiverId: ids.cg2, rateType: 'base', hourlyRate: '20.00', effectiveDate: dayIn(ZONE) },
      { companyId: coA, caregiverId: ids.cg2, rateType: 'base', hourlyRate: '99.00', effectiveDate: dayIn(ZONE, 1) },
    ])
    const r = await body(await as('ownerA', 'GET', `/api/caregiver-rates/${ids.cg2}`))
    expect({ zone: ZONE, base: r.base?.hourlyRate ?? null }).toEqual({ zone: ZONE, base: '20.00' })
  })
})

describe('home care\'s own /api/expenses and /api/payroll', () => {
  test('/api/expenses is the agency\'s expense book (the `expenses` records), a list reply', async () => {
    const made = await as('ownerA', 'POST', '/api/expenses', { description: 'Gloves', amount: '12.50', expenseDate: '2026-09-07' })
    expect(made.status).toBe(201)
    const row = await body(made)
    expect(row.companyId).toBe(coA)
    const [stored] = await t.db.select().from(t.schema.expenses).where(eq(t.schema.expenses.id, row.id))
    expect(stored?.description).toBe('Gloves')
    const list = await body(await as('ownerA', 'GET', '/api/expenses'))
    // (the owner and the admin each recorded one above, getting past the gates)
    expect(list.data.map((e: any) => e.id)).toContain(row.id)
    expect(list.pagination.total).toBe(3)
    expect((await body(await as('ownerB', 'GET', '/api/expenses'))).data).toEqual([])
  })
  test('/api/payroll is home care\'s pay run', async () => {
    const r = await body(await as('ownerA', 'GET', '/api/payroll/summary?startDate=2026-09-06&endDate=2026-09-19'))
    expect(Array.isArray(r.caregivers)).toBe(true)
  })
})

describe('the Gusto preview answers in camelCase', () => {
  test('rows and warnings', async () => {
    const S = t.schema
    const [cl] = await t.db.insert(S.clients).values({ companyId: coA, firstName: 'Pat', lastName: 'Example' }).returning()
    await t.db.insert(S.payrollShiftReviews).values(['2026-09-07', '2026-09-08'].map((d) => ({
      companyId: coA, payPeriodStart: '2026-09-06', payPeriodEnd: '2026-09-19', caregiverId: ids.cg1, clientId: cl.id, shiftDate: d, payableMinutes: 480, status: 'approved',
    })))
    await t.db.insert(S.payrollShiftReviews).values({ companyId: coA, payPeriodStart: '2026-09-06', payPeriodEnd: '2026-09-19', caregiverId: ids.cg1, clientId: cl.id, shiftDate: '2026-09-09', payableMinutes: 60, status: 'pending' })
    const pv = await body(await as('ownerA', 'GET', '/api/gusto/preview?startDate=2026-09-06&endDate=2026-09-19'))
    const row = pv.preview.find((r: any) => r.id === ids.cg1)
    expect(row).toMatchObject({ firstName: 'cg1', shiftCount: 2, totalHours: '16.00', regularHours: '16.00', grossPay: '320.00', gustoMapped: false })
    expect(pv.warnings).toEqual({ unresolvedReviews: 1, clockEntriesWithoutReview: 0 })
    // Agency B sees none of it.
    expect((await body(await as('ownerB', 'GET', '/api/gusto/preview?startDate=2026-09-06&endDate=2026-09-19'))).preview).toEqual([])
  })
})

describe('time off of every kind the payroll screen offers', () => {
  test('personal, bereavement, jury duty and unpaid are recorded (the template refused them); an unknown kind is not', async () => {
    for (const type of ['personal', 'bereavement', 'jury_duty', 'unpaid']) {
      const r = await as('ownerA', 'POST', '/api/pto', { caregiverId: ids.cg2, startDate: '2026-12-01', endDate: '2026-12-01', type })
      expect(r.status).toBe(201)
    }
    const listed = (await body(await as('ownerA', 'GET', '/api/pto'))).data.map((r: any) => r.type)
    for (const type of ['personal', 'bereavement', 'jury_duty', 'unpaid']) expect(listed).toContain(type)
    expect((await as('ownerA', 'POST', '/api/pto', { caregiverId: ids.cg2, startDate: '2026-12-01', endDate: '2026-12-01', type: 'blackout' })).status).toBe(400)
  })
})

describe("removing a caregiver's care-type rate", () => {
  test('Remove deletes it (the template had no route); only the office, only the company\'s', async () => {
    const [ct] = await t.db.insert(t.schema.careTypes).values({ companyId: coA, name: 'Respite' }).returning()
    const made = await body(await as('ownerA', 'POST', '/api/caregiver-care-type-rates', { caregiverId: ids.cg1, careTypeId: ct.id, hourlyRate: '24.00' }))
    expect((await as('cg1', 'DELETE', `/api/caregiver-care-type-rates/${made.id}`)).status).toBe(403)
    expect((await as('ownerB', 'DELETE', `/api/caregiver-care-type-rates/${made.id}`)).status).toBe(404)
    expect((await as('ownerA', 'DELETE', `/api/caregiver-care-type-rates/${made.id}`)).status).toBe(200)
    const left = (await body(await as('ownerA', 'GET', `/api/caregiver-care-type-rates?caregiverId=${ids.cg1}`))).data.map((r: any) => r.id)
    expect(left).not.toContain(made.id)
  })
})

describe("the expense form's fields are kept", () => {
  test('vendor, payment method and the two flags are stored and listed (migration 0011)', async () => {
    const made = await body(await as('ownerA', 'POST', '/api/expenses', { description: 'Gloves', amount: '42.10', date: '2026-10-01', vendor: 'Medline', paymentMethod: 'credit_card', taxDeductible: true, reimbursable: false }))
    expect(made).toMatchObject({ vendor: 'Medline', paymentMethod: 'credit_card', taxDeductible: true, reimbursable: false })
    await as('ownerA', 'PUT', `/api/expenses/${made.id}`, { reimbursable: true })
    const listed = (await body(await as('ownerA', 'GET', '/api/expenses'))).data.find((r: any) => r.id === made.id)
    expect(listed).toMatchObject({ vendor: 'Medline', paymentMethod: 'credit_card', taxDeductible: true, reimbursable: true })
  })
})
