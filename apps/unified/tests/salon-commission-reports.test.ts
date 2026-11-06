// Commission summary, line-item report and payroll file (salon parity row 16; server crm/salon/commissionReports.ts, /api/salon-reports/commissions/*).
// Built on commission rows in every status, checked against hand-worked totals: cancelled and voided are shown apart and never added in, a taking-back
// is negative, a period is the salon's own days, the payroll file takes approved commissions only (unless asked), a name can never run as a formula,
// and ADP's file needs a company code and a File # per person.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { shiftDays } from '../server/crm/salon/days.ts'
import { tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'salon_reports', 'salon_commissions']
const PASSWORD = 'Commission-1031-x'

describe('salon: commission summary, line items and payroll file', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', sam = '', kim = '', evil = '', plan = '', cora: any
  const tokens: Record<string, string> = {}
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* csv */ }
    return { status: r.status, body, headers: r.headers }
  }
  const today = tzParts(new Date(), TZ).date
  const at = (daysAgo: number) => new Date(`${shiftDays(today, -daysAgo)}T18:00:00Z`)
  const q = `from=${shiftDays(today, -29)}&to=${today}`
  const row = async (userId: string, status: string, base: number, amt: number, daysAgo = 5, extra: Record<string, unknown> = {}) => {
    const inv = await ins(t.schema.invoice, { companyId: co, number: `INV-${Math.random().toString(36).slice(2, 7)}`, contactId: cora.id, status: 'paid' })
    return ins(t.schema.commission, { companyId: co, planId: plan, userId, invoiceId: inv.id, baseAmount: String(base), rateApplied: '40', commissionAmount: String(amt), earnedAt: at(daysAgo), status, source: 'auto', ...extra })
  }

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const mk = async (email: string, first: string, last: string, role: string) => (await ins(t.schema.user, { email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: first, lastName: last, role, companyId: co })).id as string
    sam = await mk('sam@test.example', 'Sam', 'Stylist', 'field')
    kim = await mk('kim@test.example', 'Kim', 'Stylist', 'field')
    evil = await mk('evil@test.example', '=HYPERLINK("x")', 'Hacker', 'field')
    await mk('mgr@test.example', 'Mia', 'Manager', 'manager'); await mk('desk@test.example', 'Dana', 'Desk', 'viewer')
    for (const k of ['mgr', 'desk']) tokens[k] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${k}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    cora = await ins(t.schema.contact, { companyId: co, name: 'Cora Client', email: 'cora@example.com', type: 'client' })
    plan = (await ins(t.schema.commissionPlan, { companyId: co, name: 'Services 40%', planType: 'percent', percentRate: '40' })).id
    await row(sam, 'pending', 100, 40); await row(sam, 'approved', 200, 80); await row(sam, 'paid', 50, 20); await row(sam, 'void', 75, 30)
    await row(kim, 'approved', 150, 60); await row(kim, 'disputed', 100, 40); await row(kim, 'cancelled', 100, 40)
    await row(kim, 'approved', -50, -20, 4, { source: 'reversal' })
    await row(sam, 'approved', 999, 999, 60)                         // earned long before the period
    await row(evil, 'approved', 10, 4)
  }, 120_000)

  test('the rights are checked on the server: a manager reads, only whoever approves payouts takes the payroll file, a read-only seat sees nothing; off, nothing', async () => {
    expect((await as('desk', `/api/salon-reports/commissions/summary?${q}`)).status).toBe(403)
    expect((await as('mgr', `/api/salon-reports/commissions/summary?${q}`)).status).toBe(200)
    expect((await as('mgr', `/api/salon-reports/commissions/lines?${q}`)).status).toBe(200)
    for (const p of ['payroll.csv?format=gusto', 'file-numbers']) expect([p, (await as('mgr', `/api/salon-reports/commissions/${p}&${q}`.replace('file-numbers&', 'file-numbers?'))).status]).toEqual([p, 403])
    expect((await as('mgr', '/api/salon-reports/commissions/file-numbers', 'PUT', { fileNumbers: {} })).status).toBe(403)
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'salon_commissions') } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures()
    expect((await as('owner', `/api/salon-reports/commissions/summary?${q}`)).status).toBe(404)
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures()
  })

  test('the period is checked', async () => {
    for (const bad of ['from=2026-02-30', 'to=soon', 'from=2026-05-01&to=2026-04-01', 'from=2020-01-01&to=2026-01-01']) {
      const r = await as('owner', `/api/salon-reports/commissions/summary?${bad}`)
      expect([bad, r.status, r.body.code]).toEqual([bad, 400, 'BAD_RANGE'])
    }
  })

  test('summary: one line per stylist, money by status, cancelled and void shown apart, the taking-back subtracted, an earlier commission left out', async () => {
    const r = (await as('owner', `/api/salon-reports/commissions/summary?${q}`)).body
    const by = Object.fromEntries(r.stylists.map((s: any) => [s.name, s]))
    expect(by['Sam Stylist']).toMatchObject({ lines: 3, sales: 350, pending: 40, approved: 80, paid: 20, disputed: 0, total: 140, setAside: 30 })
    expect(by['Kim Stylist']).toMatchObject({ lines: 3, sales: 200, pending: 0, approved: 40, paid: 0, disputed: 40, total: 80, setAside: 40 })
    expect(r.totals).toMatchObject({ lines: 7, pending: 40, approved: 124, paid: 20, disputed: 40, total: 224 })
    expect(r.stylists[0].name).toBe('Sam Stylist')                           // largest first
  })

  test('line items: every commission in the period with its bill, client, plan and kind; one stylist on request', async () => {
    const r = (await as('owner', `/api/salon-reports/commissions/lines?${q}`)).body
    expect(r.lines.length).toBe(9)                                           // the 60-day-old one is not in
    const taken = r.lines.find((l: any) => l.kind === 'Taken back')
    expect(taken).toMatchObject({ stylist: 'Kim Stylist', amount: -20, sales: -50, plan: 'Services 40%', client: 'Cora Client', status: 'approved' })
    expect(r.lines.every((l: any) => /^INV-/.test(l.bill) && l.date >= shiftDays(today, -29))).toBe(true)
    const one = (await as('owner', `/api/salon-reports/commissions/lines?${q}&userId=${kim}`)).body
    expect(one.lines.map((l: any) => l.stylist)).toEqual(['Kim Stylist', 'Kim Stylist', 'Kim Stylist', 'Kim Stylist'])
  })

  test('Gusto file: approved commissions only, one row per person, net of a taking-back; a name cannot run as a formula', async () => {
    const r = await as('owner', `/api/salon-reports/commissions/payroll.csv?${q}&format=gusto`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/csv')
    expect(r.headers.get('content-disposition')).toContain(`gusto-commission-${shiftDays(today, -29)}-to-${today}.csv`)
    const lines = (r.body as string).split('\n')
    expect(lines[0]).toBe('First Name,Last Name,Email,Commission')
    expect(lines.slice(1).sort()).toEqual(['"\'=HYPERLINK(""x"")","Hacker","evil@test.example",4.00', '"Kim","Stylist","kim@test.example",40.00', '"Sam","Stylist","sam@test.example",80.00'])
    // waiting commissions too, when asked
    const more = (await as('owner', `/api/salon-reports/commissions/payroll.csv?${q}&format=gusto&statuses=approved,pending`)).body as string
    expect(more).toContain('"Sam","Stylist","sam@test.example",120.00')
    expect((await as('owner', `/api/salon-reports/commissions/payroll.csv?${q}&statuses=cancelled`)).status).toBe(400)
    expect((await as('owner', `/api/salon-reports/commissions/payroll.csv?${q}&format=quickbooks`)).status).toBe(400)
  })

  test('ADP file: needs the company code and each person\'s File #; people without one are named, not silently dropped', async () => {
    const no = await as('owner', `/api/salon-reports/commissions/payroll.csv?${q}&format=adp`)
    expect([no.status, no.body.code, typeof no.body.fields?.coCode]).toEqual([400, 'BAD_RANGE', 'string'])
    const bad = await as('owner', '/api/salon-reports/commissions/file-numbers', 'PUT', { fileNumbers: { [sam]: '10,01' } })
    expect([bad.status, bad.body.code]).toEqual([400, 'BAD_FILE_NUMBER'])
    expect((await as('owner', '/api/salon-reports/commissions/file-numbers', 'PUT', { fileNumbers: { nobody: '1' } })).status).toBe(400)
    expect((await as('owner', '/api/salon-reports/commissions/file-numbers', 'PUT', { fileNumbers: { [sam]: '1001' } })).body.fileNumbers).toEqual({ [sam]: '1001' })
    const r = await as('owner', `/api/salon-reports/commissions/payroll.csv?${q}&format=adp&coCode=ACME01&earningCode=COMM`)
    expect(r.status).toBe(200)
    const lines = (r.body as string).split('\n')
    expect(lines[0]).toBe('Co Code,Batch Id,File #,Batch Description,Earning 3 Code,Earning 3 Amount')
    const mmddyy = `${today.slice(5, 7)}${today.slice(8, 10)}${today.slice(2, 4)}`
    expect(lines.slice(1)).toEqual([`"ACME01","${mmddyy}COMM","1001","Commission ${shiftDays(today, -29)} to ${today}","COMM",80.00`])
    const warned = decodeURIComponent(r.headers.get('x-payroll-warnings') || '')
    expect(warned).toContain('Kim Stylist has no ADP File #')
    expect(warned).toContain('Hacker has no ADP File #')
    expect(r.headers.get('x-payroll-people')).toBe('3')
  })
})
