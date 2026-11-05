// Team revenue, finished (field service and basic): the parts Jobber / Housecall Pro / ServiceTitan have that this lacked.
//   · several people on one job: its invoices and payments are shared between them — equally, by the billable hours each
//     logged on the job, or by percentages the office sets — to the cent, and the parts add back to the Reports page's totals;
//   · billable hours and revenue per hour for each person;
//   · a salesperson on the quote (the writer by default, any team member, or no one) and quote conversion by it;
//   · quotes counted on the date you choose: drafted, sent, approved, converted to a job, or the job completed;
//   · a custom date range, filters (customer, person), chosen columns, CSV, and the invoices / jobs / quotes behind a number;
//   · saved reports and scheduled ones (the same engine as the plan reports).
// Through the real server and database on BOTH verticals; the clock is passed in; no email leaves (a recorder).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq, and } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { sharesOf, splitCents } from '../server/data/teamRevenue.ts'

const json = async (r: Response) => (await r.json()) as any
const data = async (r: Response) => { const b = await json(r); return b?.data ?? b }
const DAY = 86_400_000
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const ago = (days: number) => new Date(Date.now() - days * DAY)
const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'reports', 'time_tracking', 'team_revenue_reports', 'plan_reports']

describe('the arithmetic', () => {
  test('a split never loses or gains a cent, for any shares', () => {
    for (const total of [1, 2, 3, 100, 10001, 33333, 99999, -10001]) {
      for (const shares of [{ a: 0.5, b: 0.5 }, { a: 1 / 3, b: 1 / 3, c: 1 / 3 }, { a: 0.6, b: 0.4 }, { a: 0.75, b: 0.25 }, { a: 0.07, b: 0.93 }] as Array<Record<string, number>>) {
        const keys = Object.keys(shares)
        const cut = splitCents(total, keys, shares as Record<string, number>)
        expect({ total, shares, sum: Object.values(cut).reduce((n, v) => n + v, 0) }).toEqual({ total, shares, sum: total })
      }
    }
  })

  test('shares: equal, by hours, by percent — and the fall-backs say why', () => {
    expect(sharesOf(['u:a', 'u:b'], 'equal', undefined, {})).toMatchObject({ mode: 'equal', shares: { 'u:a': 0.5, 'u:b': 0.5 }, fallback: null })
    expect(sharesOf(['u:a', 'u:b'], 'hours', undefined, { 'u:a': 6, 'u:b': 2 })).toMatchObject({ mode: 'hours', shares: { 'u:a': 0.75, 'u:b': 0.25 } })
    expect(sharesOf(['u:a', 'u:b'], 'hours', undefined, {}).fallback).toContain('No billable hours')
    expect(sharesOf(['u:a', 'u:b'], 'percent', { 'u:a': 60, 'u:b': 40 }, {})).toMatchObject({ mode: 'percent', shares: { 'u:a': 0.6, 'u:b': 0.4 } })
    expect(sharesOf(['u:a', 'u:b', 'u:c'], 'percent', { 'u:a': 60, 'u:b': 40 }, {}).fallback).toContain('no longer match')
    expect(sharesOf(['u:a'], 'percent', { 'u:a': 100 }, {})).toMatchObject({ mode: 'equal', shares: { 'u:a': 1 } })
  })
})

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let companyId = ''
    let owner: (p: string, init?: any) => Promise<Response>
    const seat: Record<string, (p: string, init?: any) => Promise<Response>> = {}
    const id: Record<string, string> = {}
    const mails: any[] = []
    let n = 0
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
    const invoice = (over: any) => ins(t.schema.invoice, { companyId, number: `INV-${++n}`, status: 'sent', contactId: id.ann, subtotal: String(over.total), ...over, total: String(over.total) })
    const pay = (invoiceId: string, amount: number) => ins(t.schema.payment, { invoiceId, amount: String(amount), method: 'cash', paidAt: new Date() })
    const job = (over: any) => ins(t.schema.job, { companyId, number: `TJ-${++n}`, title: 'Visit', contactId: id.ann, ...over })
    const crewOf = (jobId: string, userId: string, position = 1) => ins(t.schema.jobAssignee, { companyId, jobId, userId, position })
    const hours = (userId: string, jobId: string, h: number, billable = true) => ins(t.schema.timeEntry, { companyId, userId, jobId, hours: String(h), billable, date: new Date() })
    const table = async (q: string, call = owner) => data(await call(`/api/team-revenue/table?${q}`))
    const rowOf = (tb: any, name: string) => tb.rows.find((r: any) => r.person === name)

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      companyId = s.company.id
      await t.db.update(t.schema.company).set({ name: 'Test Builders', timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
      await features(FEATURES)
      ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
      const login = async (e: string, p: string) => (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } }))).accessToken
      const as = (tok: string) => (p: string, init: any = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
      owner = as(await login('owner@test.example', s.password))
      for (const role of ['manager', 'field', 'viewer'] as const) {
        const u = await ins(t.schema.user, { email: `${role}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: role === 'manager' ? 'Mona' : role, lastName: 'Seat', role, companyId })
        id[role] = u.id
        seat[role] = as(await login(`${role}@test.example`, 'Seat-pass-1'))
      }
      id.owner = (await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'owner@test.example')))[0].id
      id.tia = (await ins(t.schema.user, { email: 'tia@test.example', passwordHash: 'x', firstName: 'Tia', lastName: 'Tech', role: 'field', companyId })).id
      id.ann = (await ins(t.schema.contact, { companyId, type: 'client', name: 'Ann Able', email: 'ann@example.com' })).id
      id.bob = (await ins(t.schema.contact, { companyId, type: 'client', name: 'Bob Baker', email: 'bob@example.com' })).id
    })

    describe('sharing a job between the people on it', () => {
      let shared = ''
      test('equal by default: an invoice is cut between the crew to the cent, and so is each payment', async () => {
        const j = await job({ assignedToId: id.tia })
        await crewOf(j.id, id.manager)
        shared = j.id
        const inv = await invoice({ total: 1000.01, jobId: j.id, contactId: id.ann })
        await pay(inv.id, 100.01)
        const tb = await table('tab=revenue&startDate=' + ymd(Date.now() - 2 * DAY) + '&endDate=' + ymd(Date.now() + DAY))
        const tia = rowOf(tb, 'Tia Tech'), mona = rowOf(tb, 'Mona Seat')
        expect(Math.round((tia.invoiced + mona.invoiced) * 100)).toBe(100001)
        expect([tia.invoiced, mona.invoiced].sort()).toEqual([500, 500.01])
        expect(Math.round((tia.collected + mona.collected) * 100)).toBe(10001)
        // Each is on the invoice once: the invoice is one invoice for each of them, and one in all.
        expect(tia.invoices).toBe(1); expect(mona.invoices).toBe(1)
        expect(tb.totals.invoices).toBe(1)
        expect(tia.sharedInvoiced).toBe(tia.invoiced)
      })

      test('by billable hours: the hours logged on the job decide; non-billable time does not count', async () => {
        await hours(id.tia, shared, 6); await hours(id.manager, shared, 2); await hours(id.manager, shared, 5, false)
        const set = await owner(`/api/team-revenue/jobs/${shared}/split`, { method: 'PUT', json: { mode: 'hours' } })
        expect(set.status).toBe(200)
        const tb = await table('tab=revenue&period=year')
        const tia = rowOf(tb, 'Tia Tech'), mona = rowOf(tb, 'Mona Seat')
        expect(Math.round((tia.invoiced + mona.invoiced) * 100)).toBe(100001)
        expect(tia.invoiced).toBeCloseTo(750.01, 1)
        expect(mona.invoiced).toBeCloseTo(250, 1)
      })

      test('by percent: the office\'s own split, checked against the crew and totalling 100', async () => {
        const put = (body: any, call = owner) => call(`/api/team-revenue/jobs/${shared}/split`, { method: 'PUT', json: body })
        expect((await put({ mode: 'percent', percents: { [`u:${id.tia}`]: 60, [`u:${id.manager}`]: 40 } })).status).toBe(200)
        const tb = await table('tab=revenue&period=year')
        expect(rowOf(tb, 'Tia Tech').invoiced).toBeCloseTo(600.01, 1)
        expect(rowOf(tb, 'Mona Seat').invoiced).toBeCloseTo(400, 1)
        expect(rowOf(tb, 'Tia Tech').collected).toBeCloseTo(60.01, 1)
        // The refusals say what is wrong.
        const short = await put({ mode: 'percent', percents: { [`u:${id.tia}`]: 60, [`u:${id.manager}`]: 30 } })
        expect(short.status).toBe(400); expect((await json(short)).error).toContain('90')
        const stray = await put({ mode: 'percent', percents: { [`u:${id.tia}`]: 50, [`u:${id.manager}`]: 25, [`u:${id.owner}`]: 25 } })
        expect(stray.status).toBe(400); expect((await json(stray)).error).toContain('not on this job')
        const missing = await put({ mode: 'percent', percents: { [`u:${id.tia}`]: 100 } })
        expect(missing.status).toBe(400); expect((await json(missing)).error).toContain('Mona Seat')
        expect((await put({ mode: 'percent', percents: { [`u:${id.tia}`]: 120, [`u:${id.manager}`]: -20 } })).status).toBe(400)
        expect((await put({ mode: 'whatever' })).status).toBe(400)
        // Who may: changing it asks jobs:update; reading it asks jobs:read.
        expect((await put({ mode: 'equal' }, seat.viewer)).status).toBe(403)
        expect((await owner(`/api/team-revenue/jobs/${shared}/split`)).status).toBe(200)
        expect((await owner('/api/team-revenue/jobs/nope/split')).status).toBe(404)
        // The saved split is read back.
        const got = await data(await owner(`/api/team-revenue/jobs/${shared}/split`))
        expect(got).toMatchObject({ mode: 'percent', applied: 'percent' })
        expect(got.people.map((p: any) => p.name).sort()).toEqual(['Mona Seat', 'Tia Tech'])
        expect(got.people.find((p: any) => p.name === 'Tia Tech').hours).toBe(6)
      })

      test('a job with one person cannot be split; when the crew changes the percentages stop fitting and it says so', async () => {
        const solo = await job({ assignedToId: id.tia })
        const one = await owner(`/api/team-revenue/jobs/${solo.id}/split`, { method: 'PUT', json: { mode: 'equal' } })
        expect(one.status).toBe(400)
        await crewOf(shared, id.owner, 2) // a third person arrives after the 60/40 was set
        const got = await data(await owner(`/api/team-revenue/jobs/${shared}/split`))
        expect(got.applied).toBe('equal')
        expect(got.note).toContain('no longer match')
        const inv = await table('tab=jobs&period=year')
        const row = inv.rows.find((r: any) => r.jobId === shared)
        expect(row.split).toBe('Equal shares')
        expect(row.note).toContain('no longer match')
        await t.db.delete(t.schema.jobAssignee).where(and(eq(t.schema.jobAssignee.jobId, shared), eq(t.schema.jobAssignee.userId, id.owner)))
      })

      test('the people\'s parts add back to the Reports page\'s totals for the same period', async () => {
        await invoice({ total: 25 }) // an office sale: no job
        const solo = await job({}) // a job nobody is on
        await invoice({ total: 50, jobId: solo.id })
        const by = await data(await owner('/api/team-revenue/by-tech'))
        const page = await json(await owner('/api/reports/revenue'))
        expect(by.rows.some((r: any) => r.bucket === 'no_job')).toBe(true)
        expect(by.rows.some((r: any) => r.bucket === 'unassigned')).toBe(true)
        expect(Number(page.invoiced ?? page.totalInvoiced ?? page.invoices?.total)).toBe(by.totals.invoiced)
        expect(Number(page.collected ?? page.totalCollected)).toBe(by.totals.collected)
        const tb = await table('tab=revenue&period=all')
        expect(Math.round(tb.rows.reduce((s: number, r: any) => s + r.invoiced, 0) * 100)).toBe(Math.round(tb.totals.invoiced * 100))
      })
    })

    describe('billable hours and revenue per hour', () => {
      test('hours are the billable time entries in the period; revenue per hour is invoiced ÷ hours; no hours, no figure', async () => {
        const tb = await table('tab=revenue&period=year')
        const tia = rowOf(tb, 'Tia Tech')
        expect(tia.hours).toBe(6)
        expect(tia.perHour).toBeCloseTo(tia.invoiced / 6, 1)
        expect(rowOf(tb, 'Mona Seat').hours).toBe(2) // the 5 non-billable hours are not counted
        expect(rowOf(tb, 'No one on the job').hours ?? null).toBeNull()
        expect(rowOf(tb, 'No one on the job').perHour ?? null).toBeNull()
        expect(tb.totals.hours).toBe(8)
        // A period without them has none.
        const old = await table(`tab=revenue&startDate=2001-01-01&endDate=2001-01-31`)
        expect(old.totals.hours).toBe(0)
      })

      test('with a customer chosen, only the time on that customer\'s jobs is counted', async () => {
        const bobJob = await job({ assignedToId: id.tia, contactId: id.bob })
        await hours(id.tia, bobJob.id, 3)
        const inv = await invoice({ total: 300, jobId: bobJob.id, contactId: id.bob })
        await pay(inv.id, 300)
        const tb = await table(`tab=revenue&period=year&contactId=${id.bob}`)
        expect(tb.rows.map((r: any) => r.person)).toEqual(['Tia Tech'])
        expect(tb.rows[0]).toMatchObject({ invoiced: 300, collected: 300, hours: 3, perHour: 100, invoices: 1, jobs: 1 })
      })
    })

    describe('drilling in', () => {
      test('a revenue row opens its invoices and its jobs; each line shows the person\'s share and links to the invoice, customer and job', async () => {
        const tb = await table('tab=revenue&period=year')
        const tia = rowOf(tb, 'Tia Tech')
        expect(tia.drill.invoices).toMatchObject({ tab: 'invoices', person: `u:${id.tia}` })
        expect(tia.drill.jobs).toMatchObject({ tab: 'jobs', person: `u:${id.tia}` })
        const invs = await table(`tab=invoices&period=year&person=u:${id.tia}`)
        expect(invs.rows.length).toBeGreaterThanOrEqual(2)
        expect(invs.rows.every((r: any) => r.person === 'Tia Tech')).toBe(true)
        expect(invs.columns.find((c: any) => c.key === 'invoice')).toMatchObject({ link: 'invoice', idKey: 'invoiceId' })
        expect(invs.columns.find((c: any) => c.key === 'job')).toMatchObject({ link: 'job', idKey: 'jobId' })
        const sharedLine = invs.rows.find((r: any) => r.jobId === id.sharedJob || r.share < 100)
        expect(sharedLine.share).toBeGreaterThan(0); expect(sharedLine.share).toBeLessThan(100)
        const sum = invs.rows.reduce((s: number, r: any) => s + r.invoiced, 0)
        expect(Math.round(invs.totals.invoiced * 100)).toBe(Math.round(sum * 100))
        const jobs = await table(`tab=jobs&period=year&person=u:${id.tia}`)
        const withCrew = jobs.rows.find((r: any) => /Mona Seat/.test(r.people))
        expect(withCrew.people).toMatch(/Tia Tech \d+(\.\d+)?% · Mona Seat \d+(\.\d+)?%/)
        expect(jobs.columns.find((c: any) => c.key === 'job')).toMatchObject({ link: 'job', idKey: 'jobId' })
      })

      test('the buckets can be opened too', async () => {
        const none = await table('tab=invoices&period=all&person=no_job')
        expect(none.rows.every((r: any) => r.person === 'Not on a job (office sales)')).toBe(true)
        expect(none.rows.length).toBeGreaterThanOrEqual(1)
        const nobody = await table('tab=invoices&period=all&person=unassigned')
        expect(nobody.rows.every((r: any) => r.person === 'No one on the job')).toBe(true)
      })
    })

    describe('quotes: salesperson and the date they are counted on', () => {
      const quote = (call: any, body: any = {}) => call('/api/quotes', { method: 'POST', json: { contactId: id.ann, name: 'Tune-up quote', lineItems: [{ description: 'Tune-up', quantity: 1, unitPrice: 120 }], ...body } })
      const stored = async (qid: string) => (await t.db.select().from(t.schema.quote).where(eq(t.schema.quote.id, qid)))[0] as any

      test('the writer is the salesperson unless the form names someone else or no one; a stranger is refused', async () => {
        const mine = await json(await quote(owner))
        expect((await stored(mine.id)).salespersonId).toBe(id.owner)
        const chosen = await json(await quote(owner, { salespersonId: id.manager }))
        expect((await stored(chosen.id)).salespersonId).toBe(id.manager)
        expect((await stored(chosen.id)).createdById).toBe(id.owner) // who typed it is kept apart
        const none = await json(await quote(owner, { salespersonId: null }))
        expect((await stored(none.id)).salespersonId).toBeNull()
        const bad = await quote(owner, { salespersonId: 'not-a-person' })
        expect(bad.status).toBe(400)
        expect((await json(bad)).error).toContain('team')
        const put = await owner(`/api/quotes/${mine.id}`, { method: 'PUT', json: { salespersonId: id.tia } })
        expect(put.status).toBe(200)
        expect((await stored(mine.id)).salespersonId).toBe(id.tia)
        expect((await owner(`/api/quotes/${mine.id}`, { method: 'PUT', json: { salespersonId: 'nope' } })).status).toBe(400)
      })

      test('converting a quote to a job stamps the day it happened', async () => {
        const q = await json(await quote(owner))
        await t.db.update(t.schema.quote).set({ status: 'approved', approvedAt: new Date() } as any).where(eq(t.schema.quote.id, q.id))
        const res = await owner(`/api/quotes/${q.id}/convert-to-job`, { method: 'POST', json: {} })
        expect(res.status).toBeLessThan(300)
        expect((await stored(q.id)).convertedAt).toBeTruthy()
      })

      test('each date basis counts a quote on its own day; a quote without that date is left out', async () => {
        // Drafted 20 days ago, sent 18, approved 15, converted 12 into a job completed 9 days ago — all by Sam.
        const sam = (await ins(t.schema.user, { email: 'sam@test.example', passwordHash: 'x', firstName: 'Sam', lastName: 'Sales', role: 'manager', companyId })).id
        const j = await job({ assignedToId: id.tia, completedAt: ago(9), status: 'completed' })
        const q = await ins(t.schema.quote, { companyId, number: `BQ-${++n}`, name: 'Basis quote', contactId: id.ann, status: 'approved', total: '500', subtotal: '500', salespersonId: sam, createdById: sam, createdAt: ago(20), sentAt: ago(18), approvedAt: ago(15), convertedAt: ago(12), convertedToJobId: j.id, jobId: null })
        await t.db.update(t.schema.job).set({ quoteId: q.id } as any).where(eq(t.schema.job.id, j.id))
        // A second one that was never sent.
        const q2 = await ins(t.schema.quote, { companyId, number: `BQ-${++n}`, name: 'Never sent', contactId: id.ann, status: 'draft', total: '80', subtotal: '80', salespersonId: sam, createdById: sam, createdAt: ago(20) })
        const window = (from: number, to: number) => `startDate=${ymd(Date.now() - from * DAY)}&endDate=${ymd(Date.now() - to * DAY)}`
        const count = async (basis: string, from: number, to: number, extra = '') => {
          const tb = await table(`tab=quotes&by=salesperson&basis=${basis}&${window(from, to)}${extra}`)
          return rowOf(tb, 'Sam Sales')?.quotes ?? 0
        }
        expect(await count('drafted', 21, 19)).toBe(2)
        expect(await count('sent', 19, 17)).toBe(1) // the unsent one has no sent day
        expect(await count('sent', 21, 19)).toBe(0)
        expect(await count('approved', 16, 14)).toBe(1)
        expect(await count('approved', 21, 17)).toBe(0)
        expect(await count('converted', 13, 11)).toBe(1)
        expect(await count('completed', 10, 8)).toBe(1)
        expect(await count('completed', 21, 11)).toBe(0)
        // No range at all: a basis the quote lacks still leaves it out.
        const all = await table('tab=quotes&by=salesperson&basis=sent&period=all')
        expect(rowOf(all, 'Sam Sales').quotes).toBe(1)
        expect((await owner('/api/team-revenue/table?tab=quotes&basis=nonsense')).status).toBe(400)
        id.sam = sam; id.q = q.id; id.q2 = q2.id; id.basisJob = j.id
      })

      test('conversion by salesperson, by who wrote it and by the tech on the job it became', async () => {
        const by = async (group: string) => table(`tab=quotes&by=${group}&basis=drafted&startDate=${ymd(Date.now() - 22 * DAY)}&endDate=${ymd(Date.now() - 18 * DAY)}`)
        const sales = await by('salesperson')
        expect(rowOf(sales, 'Sam Sales')).toMatchObject({ quotes: 2, approved: 1, open: 1, declined: 0, approvedValue: 500, rate: 100 })
        const writer = await by('writer')
        expect(rowOf(writer, 'Sam Sales')).toMatchObject({ quotes: 2 })
        const tech = await by('tech')
        expect(rowOf(tech, 'Tia Tech')).toMatchObject({ quotes: 1, approved: 1 })
        expect(tech.rows.map((r: any) => r.person)).toContain('No one on the job') // the never-sent one has no job
        expect(sales.columns.find((c: any) => c.key === 'person').label).toBe('Salesperson')
        // The old door takes the same choices.
        const legacy = await data(await owner(`/api/team-revenue/quote-conversion?by=salesperson&basis=approved&startDate=${ymd(Date.now() - 16 * DAY)}&endDate=${ymd(Date.now() - 14 * DAY)}`))
        expect(legacy).toMatchObject({ by: 'salesperson', basis: 'approved' })
        expect(legacy.rows.find((r: any) => r.person?.name === 'Sam Sales')).toMatchObject({ sent: 1, approved: 1, approvedValue: 500 })
        expect((await owner('/api/team-revenue/quote-conversion?basis=nonsense')).status).toBe(400)
      })

      test('a number opens the quotes behind it; the list filters by result, person and customer', async () => {
        const sales = await table(`tab=quotes&by=salesperson&basis=drafted&startDate=${ymd(Date.now() - 22 * DAY)}&endDate=${ymd(Date.now() - 18 * DAY)}`)
        const row = rowOf(sales, 'Sam Sales')
        expect(row.drill.approved).toMatchObject({ tab: 'quote_list', person: `u:${id.sam}`, status: 'approved' })
        const list = await table(`tab=quote_list&by=salesperson&basis=drafted&startDate=${ymd(Date.now() - 22 * DAY)}&endDate=${ymd(Date.now() - 18 * DAY)}&person=u:${id.sam}&status=approved`)
        expect(list.rows).toHaveLength(1)
        expect(list.rows[0]).toMatchObject({ name: 'Basis quote', status: 'Approved', total: 500, customer: 'Ann Able' })
        expect(list.rows[0].converted).toBeTruthy(); expect(list.rows[0].completed).toBeTruthy()
        expect(list.columns.find((c: any) => c.key === 'quote')).toMatchObject({ link: 'quote', idKey: 'quoteId' })
        const bob = await table(`tab=quote_list&by=salesperson&basis=drafted&period=all&contactId=${id.bob}`)
        expect(bob.rows).toHaveLength(0)
        const waiting = await table(`tab=quote_list&by=salesperson&basis=drafted&startDate=${ymd(Date.now() - 22 * DAY)}&endDate=${ymd(Date.now() - 18 * DAY)}&status=open`)
        expect(waiting.rows.map((r: any) => r.name)).toEqual(['Never sent'])
      })
    })

    describe('range, columns and CSV', () => {
      test('a custom range works; a backwards or malformed one is a plain 400', async () => {
        expect((await owner(`/api/team-revenue/table?tab=revenue&startDate=${ymd(Date.now() - 5 * DAY)}&endDate=${ymd(Date.now())}`)).status).toBe(200)
        const back = await owner(`/api/team-revenue/table?tab=revenue&startDate=${ymd(Date.now())}&endDate=${ymd(Date.now() - 5 * DAY)}`)
        expect(back.status).toBe(400); expect((await json(back)).error).toBeTruthy()
        expect((await owner('/api/team-revenue/table?tab=revenue&startDate=yesterday')).status).toBe(400)
        expect((await owner('/api/team-revenue/table?tab=nope')).status).toBe(400)
        expect((await owner('/api/team-revenue/table?tab=invoices&person=somebody')).status).toBe(400)
      })

      test('chosen columns keep the report\'s order; optional columns are offered; an unknown choice falls back', async () => {
        const tb = await table('tab=revenue&period=year&columns=perHour,person,nonsense')
        expect(tb.shown).toEqual(['person', 'perHour'])
        const usual = await table('tab=revenue&period=year')
        expect(usual.shown).not.toContain('collectedPerHour')
        expect(usual.columns.map((c: any) => c.key)).toEqual(expect.arrayContaining(['collectedPerHour', 'sharedInvoiced']))
        expect((await table('tab=revenue&period=year&columns=zzz')).shown).toEqual(usual.shown)
      })

      test('CSV: chosen columns, header, a total line, byte-order mark', async () => {
        const res = await owner('/api/team-revenue/table?tab=revenue&period=year&columns=person,invoiced&format=csv')
        expect(res.status).toBe(200)
        expect(res.headers.get('content-disposition')).toContain('team-revenue-revenue.csv')
        const bytes = new Uint8Array(await res.arrayBuffer())
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
        const lines = new TextDecoder().decode(bytes.slice(3)).split('\r\n')
        expect(lines[0]).toBe('"Person","Invoiced"')
        expect(lines.some((l) => l.startsWith('"Tia Tech"'))).toBe(true)
        expect(lines[lines.length - 1]).toMatch(/^"Total",/)
      })

      test('filters list the people and customers to choose from', async () => {
        const f = await data(await owner('/api/team-revenue/filters'))
        expect(f.people.map((p: any) => p.name)).toEqual(expect.arrayContaining(['Tia Tech', 'Mona Seat', 'Sam Sales']))
        expect(f.people[0].key).toMatch(/^[um]:/)
        expect(f.customers.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Ann Able', 'Bob Baker']))
      })
    })

    describe('saved and scheduled reports', () => {
      test('a team view is saved apart from the plan reports and mailed on its schedule, once a day', async () => {
        mails.length = 0
        const params = { tab: 'revenue', period: '30', columns: ['person', 'invoiced'] }
        const schedule = { frequency: 'weekly', weekday: 1, hour: 7, recipients: ['boss@example.com'] }
        const res = await owner('/api/team-revenue/saved', { method: 'POST', json: { name: 'Weekly team revenue', params, schedule } })
        expect(res.status).toBeLessThan(300)
        const list = await data(await owner('/api/team-revenue/saved'))
        expect(list.map((x: any) => x.name)).toEqual(['Weekly team revenue'])
        expect(await data(await owner('/api/plan-reports/saved'))).toEqual([]) // plan reports keep their own list
        expect((await owner('/api/team-revenue/saved', { method: 'POST', json: { name: 'x', params: { tab: 'zzz' } } })).status).toBe(400)
        const pass = (t.services as any).crm.eventJobs.savedReportsPass as (now?: Date) => Promise<number>
        expect(await pass(new Date('2026-11-02T12:30:00Z'))).toBe(0) // 6:30 on the business's clock: before the hour
        expect(await pass(new Date('2026-11-02T13:15:00Z'))).toBe(1)
        expect(mails.map((m) => m.to)).toEqual(['boss@example.com'])
        expect(Buffer.from(mails[0].attachments[0].content).toString('utf8')).toContain('"Person","Invoiced"')
        expect(await pass(new Date('2026-11-02T20:00:00Z'))).toBe(0)
      })
    })

    describe('the doors', () => {
      test('reports:read for the report; the split follows the job\'s own permissions; closed while the feature is off', async () => {
        const doors = ['/api/team-revenue/table?tab=revenue', '/api/team-revenue/filters', '/api/team-revenue/saved', '/api/team-revenue/by-tech']
        for (const d of doors) {
          expect((await seat.manager(d)).status).toBe(200)
          expect((await seat.field(d)).status).toBe(403)
          expect((await seat.viewer(d)).status).toBe(403)
          expect((await t.call(d)).status).toBe(401)
        }
        await features(FEATURES.filter((f) => f !== 'team_revenue_reports'))
        try { for (const d of [...doors, `/api/team-revenue/jobs/${id.basisJob}/split`]) expect([403, 404]).toContain((await owner(d)).status) } finally { await features(FEATURES) }
      })
    })
  })
}
