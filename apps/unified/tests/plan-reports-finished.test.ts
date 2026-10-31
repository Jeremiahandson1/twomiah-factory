// Service-plan reports, finished (field service and basic): the parts Jobber / Housecall Pro / ServiceTitan have that this lacked.
//   · "Sold by" on the plan (the person who made it by default, or the one chosen, or no one) — checked and validated;
//   · a plan's history: made, renewed, suspended, reactivated, cancelled, ran out — each with who and when; a plan can be
//     suspended (no billing, term does not run out) and reactivated (the days held are given back to the term);
//   · the summary: active at the start and at the end of a period, made / renewed / suspended / reactivated / ended;
//   · recurring revenue and collected revenue by month (12 months) and by plan name, the payments behind a collected figure;
//   · every view takes filters (plan name, seller, customer, status), the columns you choose, CSV, and drill data;
//   · saved reports (by name, editable) and scheduled ones (weekly / monthly, once a day, CSV attached to the email).
// Through the real server and database on BOTH verticals; the clock is passed in; no email leaves (a recorder).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq, and, sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => (await r.json()) as any
const data = async (r: Response) => { const b = await json(r); return b?.data ?? b }
const DAY = 86_400_000
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'reports', 'service_agreements', 'plan_reports']

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let companyId = ''
    let owner: (p: string, init?: any) => Promise<Response>
    const seat: Record<string, (p: string, init?: any) => Promise<Response>> = {}
    const id: Record<string, string> = {}
    const mails: any[] = []
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
    const make = async (call: any, name: string, body: any = {}) => {
      const res = await call('/api/agreements', { method: 'POST', json: { contactId: id.ann, name, startDate: ymd(Date.now() - 100 * DAY), amount: 600, billingFrequency: 'annual', endDate: ymd(Date.now() + 200 * DAY), renewalType: 'manual', ...body } })
      expect(res.status).toBeLessThan(300)
      return (await json(res)).id as string
    }
    const events = (agreementId: string) => t.db.select().from(t.schema.agreementEvent).where(eq(t.schema.agreementEvent.agreementId, agreementId))
    const agreement = async (agreementId: string) => (await t.db.select().from(t.schema.serviceAgreement).where(eq(t.schema.serviceAgreement.id, agreementId)))[0] as any
    /** Move one recorded event (and optionally the plan's creation) to a day in the past, so a period can be tested. */
    const backdate = async (agreementId: string, kind: string, daysAgo: number) => {
      await t.db.update(t.schema.agreementEvent).set({ at: new Date(Date.now() - daysAgo * DAY) } as any)
        .where(and(eq(t.schema.agreementEvent.agreementId, agreementId), eq(t.schema.agreementEvent.kind, kind)))
    }
    const table = async (q: string, call = owner) => data(await call(`/api/plan-reports/table?${q}`))
    const rowOf = (tb: any, key: string, val: string) => tb.rows.find((r: any) => r[key] === val)

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
      id.ann = (await ins(t.schema.contact, { companyId, type: 'client', name: 'Ann Able', email: 'ann@example.com' })).id
      id.bob = (await ins(t.schema.contact, { companyId, type: 'client', name: 'Bob Baker', email: 'bob@example.com' })).id
    })

    describe('sold by, and the history of a plan', () => {
      test('a plan is credited to whoever made it, unless the form names someone else or no one', async () => {
        const mine = await make(owner, 'Furnace club')
        expect((await agreement(mine)).soldById).toBe(id.owner)
        const chosen = await make(owner, 'AC club', { soldById: id.manager })
        expect((await agreement(chosen)).soldById).toBe(id.manager)
        const nobody = await make(owner, 'Duct club', { soldById: null })
        expect((await agreement(nobody)).soldById).toBeNull()
        id.mine = mine; id.chosen = chosen; id.nobody = nobody
      })

      test('someone who is not on the team cannot be named; the plan can be re-credited later', async () => {
        const bad = await owner('/api/agreements', { method: 'POST', json: { contactId: id.ann, name: 'Bad', startDate: ymd(Date.now()), amount: 10, billingFrequency: 'monthly', soldById: 'not-a-person' } })
        expect(bad.status).toBe(400)
        expect((await json(bad)).error).toContain('team')
        const put = await owner(`/api/agreements/${id.nobody}`, { method: 'PUT', json: { soldById: id.owner } })
        expect(put.status).toBe(200)
        expect((await agreement(id.nobody)).soldById).toBe(id.owner)
        await owner(`/api/agreements/${id.nobody}`, { method: 'PUT', json: { soldById: null } })
        expect((await agreement(id.nobody)).soldById).toBeNull()
      })

      test('making a plan is recorded with who made it; the history route lists it', async () => {
        const ev = await events(id.mine)
        expect(ev.map((e: any) => e.kind)).toEqual(['created'])
        expect(ev[0].byUserId).toBe(id.owner)
        const h = await json(await owner(`/api/agreements/${id.mine}/history`))
        expect(h.events).toHaveLength(1)
        expect(h.events[0]).toMatchObject({ kind: 'created', by: 'Olive Owner' })
        expect((await owner('/api/agreements/nope/history')).status).toBe(404)
      })

      test('suspend: only an active plan; it is recorded, not billed, and a field seat is refused', async () => {
        expect((await seat.field(`/api/agreements/${id.mine}/suspend`, { method: 'POST', json: {} })).status).toBe(403)
        const r = await owner(`/api/agreements/${id.mine}/suspend`, { method: 'POST', json: { reason: 'Customer away' } })
        expect(r.status).toBe(200)
        expect((await agreement(id.mine)).status).toBe('suspended')
        expect((await events(id.mine)).map((e: any) => e.kind)).toEqual(['created', 'suspended'])
        expect((await owner(`/api/agreements/${id.mine}/suspend`, { method: 'POST', json: {} })).status).toBe(409)
        const before = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.serviceAgreementId, id.mine))
        await owner('/api/agreements/billing/run', { method: 'POST', json: {} })
        const after = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.serviceAgreementId, id.mine))
        expect(after.length).toBe(before.length)
      })

      test('reactivate: the days it was held are added to the term, and it bills again', async () => {
        await backdate(id.mine, 'suspended', 10)
        const was = await agreement(id.mine)
        expect((await seat.field(`/api/agreements/${id.mine}/reactivate`, { method: 'POST', json: {} })).status).toBe(403)
        expect((await owner(`/api/agreements/${id.mine}/reactivate`, { method: 'POST', json: {} })).status).toBe(200)
        const now = await agreement(id.mine)
        expect(now.status).toBe('active')
        expect(Math.round((new Date(now.endDate).getTime() - new Date(was.endDate).getTime()) / DAY)).toBe(10)
        expect((await events(id.mine)).map((e: any) => e.kind)).toEqual(['created', 'suspended', 'reactivated'])
        expect((await owner(`/api/agreements/${id.mine}/reactivate`, { method: 'POST', json: {} })).status).toBe(409)
      })

      test('renew, cancel and running out are recorded too; a suspended plan can be cancelled', async () => {
        const r = await make(owner, 'Renew club', { endDate: ymd(Date.now() + 20 * DAY) })
        expect((await owner(`/api/agreements/${r}/renew`, { method: 'POST', json: {} })).status).toBe(200)
        expect((await events(r)).map((e: any) => e.kind)).toContain('renewed')
        const c = await make(owner, 'Cancel club')
        await owner(`/api/agreements/${c}/suspend`, { method: 'POST', json: {} })
        expect((await owner(`/api/agreements/${c}/cancel`, { method: 'POST', json: { reason: 'Moved' } })).status).toBe(200)
        expect((await events(c)).map((e: any) => e.kind)).toEqual(['created', 'suspended', 'cancelled'])
        const lapsed = await make(owner, 'Gutter club', { endDate: ymd(Date.now() + 5 * DAY) })
        await t.db.update(t.schema.serviceAgreement).set({ endDate: new Date(Date.now() - 3 * DAY) } as any).where(eq(t.schema.serviceAgreement.id, lapsed))
        await (t.services as any).crm.agreements.processDueAgreements()
        expect((await events(lapsed)).map((e: any) => e.kind)).toEqual(['created', 'expired'])
        id.cancelled = c; id.lapsed = lapsed
      })
    })

    describe('the summary and the history tab', () => {
      test('active at the start and the end of a period; a plan on hold is not active', async () => {
        const a = await make(owner, 'Summary club')
        // Made 100 days ago, put on hold 20 days ago, taken off hold 5 days ago.
        await backdate(a, 'created', 100)
        await t.db.update(t.schema.serviceAgreement).set({ createdAt: new Date(Date.now() - 100 * DAY) } as any).where(eq(t.schema.serviceAgreement.id, a))
        await owner(`/api/agreements/${a}/suspend`, { method: 'POST', json: {} })
        await backdate(a, 'suspended', 20)
        await owner(`/api/agreements/${a}/reactivate`, { method: 'POST', json: {} })
        await backdate(a, 'reactivated', 5)
        id.sum = a

        const last30 = await table(`tab=summary&startDate=${ymd(Date.now() - 29 * DAY)}&endDate=${ymd(Date.now())}&planName=Summary%20club`)
        expect(rowOf(last30, 'name', 'Summary club')).toMatchObject({ activeAtStart: 1, made: 0, suspended: 1, reactivated: 1, activeAtEnd: 1 })

        // A window that closes while it is on hold: active at its start, not at its end.
        const held = await table(`tab=summary&startDate=${ymd(Date.now() - 40 * DAY)}&endDate=${ymd(Date.now() - 10 * DAY)}&planName=Summary%20club`)
        expect(rowOf(held, 'name', 'Summary club')).toMatchObject({ activeAtStart: 1, suspended: 1, reactivated: 0, activeAtEnd: 0 })

        // A window before it existed: nothing.
        const early = await table(`tab=summary&startDate=${ymd(Date.now() - 200 * DAY)}&endDate=${ymd(Date.now() - 120 * DAY)}&planName=Summary%20club`)
        expect(early.rows.length === 0 || rowOf(early, 'name', 'Summary club')?.activeAtEnd === 0).toBe(true)

        // The made-in-window count.
        const made = await table(`tab=summary&startDate=${ymd(Date.now() - 110 * DAY)}&endDate=${ymd(Date.now() - 90 * DAY)}&planName=Summary%20club`)
        expect(rowOf(made, 'name', 'Summary club')).toMatchObject({ made: 1, activeAtStart: 0, activeAtEnd: 1 })
      })

      test('the totals row adds the plans up, and every count carries drill data to the events behind it', async () => {
        const tb = await table(`tab=summary&period=year`)
        expect(tb.totals.name).toBe('All plans')
        for (const k of ['activeAtStart', 'made', 'renewed', 'suspended', 'reactivated', 'cancelled', 'expired', 'activeAtEnd']) {
          expect(tb.rows.reduce((n: number, r: any) => n + r[k], 0)).toBe(tb.totals[k])
        }
        const row = rowOf(tb, 'name', 'Summary club')
        expect(row.drill.suspended).toMatchObject({ tab: 'events', kind: 'suspended', planName: 'Summary club' })
      })

      test('history: newest first, with who, filterable by what happened, links to the plan and the customer', async () => {
        const tb = await table(`tab=events&period=year&planName=Summary%20club`)
        expect(tb.rows.map((r: any) => r.what)).toEqual(['Reactivated', 'Suspended', 'Made'])
        expect(tb.rows[0]).toMatchObject({ customer: 'Ann Able', by: 'Olive Owner', contactId: id.ann, planId: id.sum })
        expect(tb.columns.find((c: any) => c.key === 'number')).toMatchObject({ link: 'agreement', idKey: 'planId' })
        expect(tb.columns.find((c: any) => c.key === 'customer')).toMatchObject({ link: 'contact', idKey: 'contactId' })
        const only = await table(`tab=events&period=year&kind=suspended&planName=Summary%20club`)
        expect(only.rows.map((r: any) => r.what)).toEqual(['Suspended'])
      })
    })

    describe('sold by person, plans made, coming due, ended', () => {
      test('sold counts per person and "made before we kept track"; the number drills to the plans', async () => {
        await ins(t.schema.serviceAgreement, { companyId, contactId: id.ann, number: 'AGR-OLD', name: 'Before events', amount: '100', billingFrequency: 'annual', startDate: new Date(Date.now() - 400 * DAY), endDate: new Date(Date.now() + 20 * DAY), status: 'active', renewalType: 'manual', createdAt: new Date(Date.now() - 30 * DAY) })
        const tb = await table('tab=sold&period=year')
        const mona = rowOf(tb, 'seller', 'Mona Seat')
        expect(mona).toMatchObject({ plans: 1 })
        expect(mona.drill.plans).toMatchObject({ tab: 'plans', sellerId: id.manager })
        expect(rowOf(tb, 'seller', 'Made before we kept track').plans).toBeGreaterThanOrEqual(1)
        const plans = await table(`tab=plans&period=year&sellerId=${id.manager}`)
        expect(plans.rows.map((r: any) => r.name)).toEqual(['AC club'])
        expect(plans.rows[0]).toMatchObject({ seller: 'Mona Seat', customer: 'Ann Able', status: 'Active', yearlyValue: 600 })
        const none = await table(`tab=plans&period=year&sellerId=none`)
        expect(none.rows.map((r: any) => r.name)).toContain('Before events')
      })

      test('a plan with no events yet still shows up in the summary (the old data)', async () => {
        const tb = await table(`tab=summary&period=year&planName=Before%20events`)
        expect(rowOf(tb, 'name', 'Before events')).toMatchObject({ activeAtEnd: 1 })
      })

      test('coming due and ended carry the filters and links', async () => {
        const due = await table('tab=renewals&days=30')
        expect(due.rows.map((r: any) => r.name)).toContain('Before events')
        expect(due.rows.find((r: any) => r.name === 'Before events').renews).toBe('Needs a person')
        const dueAnn = await table(`tab=renewals&days=60&contactId=${id.bob}`)
        expect(dueAnn.rows).toHaveLength(0)
        const ended = await table('tab=ended&period=year')
        expect(ended.rows.map((r: any) => r.name).sort()).toEqual(expect.arrayContaining(['Cancel club', 'Gutter club']))
        expect(ended.rows.find((r: any) => r.name === 'Cancel club')).toMatchObject({ how: 'Cancelled', reason: 'Moved' })
        const expired = await table('tab=ended&period=year&status=expired')
        expect(expired.rows.map((r: any) => r.name)).toEqual(['Gutter club'])
        // A plan still running has not ended, so "active" finds nothing here; and a cancelled filter finds nothing coming due.
        expect((await table('tab=ended&period=year&status=active')).rows).toHaveLength(0)
        expect((await table('tab=renewals&days=60&status=cancelled')).rows).toHaveLength(0)
      })

      test('the old routes take the same filters', async () => {
        const r = await json(await owner(`/api/plan-reports/sold?sellerId=${id.manager}`))
        expect(r.rows.every((x: any) => x.person?.id === id.manager)).toBe(true)
        expect(r.rows.length).toBe(1)
      })
    })

    describe('revenue by month and by plan', () => {
      test('recurring revenue: the monthly value of what was active at each month end, twelve months, a row per plan name', async () => {
        const a = await make(owner, 'Monthly club', { amount: 50, billingFrequency: 'monthly' })
        await backdate(a, 'created', 100)
        await t.db.update(t.schema.serviceAgreement).set({ createdAt: new Date(Date.now() - 100 * DAY) } as any).where(eq(t.schema.serviceAgreement.id, a))
        const tb = await table('tab=revenue&measure=recurring&planName=Monthly%20club')
        expect(tb.columns).toHaveLength(13) // the plan, then 12 months
        const row = rowOf(tb, 'name', 'Monthly club')
        const month = (n: number) => `m${n}`
        // This month's column (the last) counts it at 50 a month; a month before it was made counts nothing.
        expect(row[month(11)]).toBe(50)
        expect(row[month(0)]).toBe(0)
        expect(tb.totals.name).toBe('All plans')
        expect(tb.totals[month(11)]).toBe(50)
        // A plan on hold is not counted.
        await owner(`/api/agreements/${a}/suspend`, { method: 'POST', json: {} })
        const held = await table('tab=revenue&measure=recurring&planName=Monthly%20club')
        expect(rowOf(held, 'name', 'Monthly club')[month(11)]).toBe(0)
        await owner(`/api/agreements/${a}/reactivate`, { method: 'POST', json: {} })
        id.monthly = a
      })

      test('billing links its invoice to the plan, and collected revenue is the payments on those invoices net of refunds', async () => {
        await owner('/api/agreements/billing/run', { method: 'POST', json: {} })
        const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.serviceAgreementId, id.monthly))
        expect(inv).toBeTruthy()
        await ins(t.schema.payment, { invoiceId: inv.id, amount: '50', method: 'cash', paidAt: new Date() })
        const tb = await table('tab=revenue&measure=collected&planName=Monthly%20club')
        const row = rowOf(tb, 'name', 'Monthly club')
        expect(row.m11).toBe(50)
        expect(row.total).toBe(50)
        expect(row.drill.m11).toMatchObject({ tab: 'payments', planName: 'Monthly club' })
        const thisMonth = row.drill.m11.month
        const pay = await table(`tab=payments&month=${thisMonth}&planName=Monthly%20club`)
        expect(pay.rows).toHaveLength(1)
        expect(pay.rows[0]).toMatchObject({ invoiceNumber: inv.number, invoiceId: inv.id, planId: id.monthly, customer: 'Ann Able', amount: 50 })
        expect(pay.totals.amount).toBe(50)
        expect(pay.columns.find((c: any) => c.key === 'invoiceNumber')).toMatchObject({ link: 'invoice', idKey: 'invoiceId' })
        // A refund comes off.
        await ins(t.schema.payment, { invoiceId: inv.id, amount: '-10', method: 'cash', paidAt: new Date() })
        const net = await table('tab=revenue&measure=collected&planName=Monthly%20club')
        expect(rowOf(net, 'name', 'Monthly club').m11).toBe(40)
      })

      test('the migration links old invoices to their plan by the wording billing wrote, and gives old plans their history; run twice it changes nothing more', async () => {
        const legacy = await ins(t.schema.serviceAgreement, { companyId, contactId: id.ann, number: 'AGR-LEG', name: 'Legacy club', amount: '600', billingFrequency: 'annual', startDate: new Date(Date.now() - 300 * DAY), endDate: new Date(Date.now() - 20 * DAY), status: 'cancelled', endedHow: 'cancelled', endedAt: new Date(Date.now() - 20 * DAY), createdAt: new Date(Date.now() - 300 * DAY) })
        const old = await ins(t.schema.invoice, { companyId, number: 'INV-OLD', status: 'sent', contactId: id.ann, subtotal: '600', total: '600' })
        await ins(t.schema.invoiceLineItem, { invoiceId: old.id, description: 'Legacy club - annual billing', quantity: '1', unitPrice: '600', total: '600' })
        await ins(t.schema.payment, { invoiceId: old.id, amount: '600', method: 'cash', paidAt: new Date() })
        const other = await ins(t.schema.invoice, { companyId, number: 'INV-OTHER', status: 'sent', contactId: id.ann, subtotal: '90', total: '90' })
        await ins(t.schema.invoiceLineItem, { invoiceId: other.id, description: 'Drain cleaning', quantity: '1', unitPrice: '90', total: '90' })
        await ins(t.schema.payment, { invoiceId: other.id, amount: '90', method: 'cash', paidAt: new Date() })
        // Before the migration runs, nothing links them and the legacy plan has no history.
        expect(await events(legacy.id)).toHaveLength(0)
        const file = await Bun.file(new URL('../server/db/migrations/0054_plan_events_saved_reports.sql', import.meta.url)).text()
        const backfill = file.slice(file.indexOf('-- Plans that already exist')).split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean)
        expect(backfill.length).toBe(3)
        for (let pass = 0; pass < 2; pass++) for (const stmt of backfill) await t.db.execute(sql.raw(stmt))
        expect((await events(legacy.id)).map((e: any) => e.kind)).toEqual(['created', 'cancelled'])
        const [linked] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, old.id))
        const [unrelated] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, other.id))
        expect(linked.serviceAgreementId).toBe(legacy.id)
        expect(unrelated.serviceAgreementId).toBeNull()
        const tb = await table('tab=revenue&measure=collected&period=year')
        expect(rowOf(tb, 'name', 'Legacy club')?.m11).toBe(600)
        expect(tb.rows.map((r: any) => r.name)).not.toContain('Drain cleaning')
        expect(tb.totals.m11).toBe(tb.rows.reduce((n: number, r: any) => n + r.m11, 0))
      })
    })

    describe('filters, columns and CSV', () => {
      test('plan name, seller, customer and status narrow every view', async () => {
        const bob = await make(owner, 'Bob club', { contactId: id.bob })
        const byCustomer = await table(`tab=plans&period=year&contactId=${id.bob}`)
        expect(byCustomer.rows.map((r: any) => r.id)).toEqual([bob])
        const byName = await table('tab=plans&period=year&planName=Bob%20club')
        expect(byName.rows).toHaveLength(1)
        const byStatus = await table('tab=plans&period=year&status=cancelled')
        expect(byStatus.rows.map((r: any) => r.name).sort()).toEqual(['Cancel club', 'Legacy club'])
        const filters = await data(await owner('/api/plan-reports/filters'))
        expect(filters.planNames).toEqual(expect.arrayContaining(['Bob club', 'Furnace club']))
        expect(filters.sellers.map((s: any) => s.name)).toEqual(expect.arrayContaining(['Mona Seat', 'Olive Owner']))
        expect(filters.customers.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Ann Able', 'Bob Baker']))
      })

      test('chosen columns are kept in the report\'s order; an unknown choice falls back to the usual set; optional columns are on offer', async () => {
        const tb = await table('tab=plans&period=year&columns=status,name,nonsense')
        expect(tb.shown).toEqual(['name', 'status'])
        expect(tb.columns.length).toBeGreaterThan(tb.shown.length)
        const usual = await table('tab=sold&period=year')
        expect(usual.shown).not.toContain('average')
        expect(usual.columns.map((c: any) => c.key)).toContain('average')
        const fallback = await table('tab=sold&period=year&columns=zzz')
        expect(fallback.shown).toEqual(usual.shown)
      })

      test('CSV: the chosen columns, a header row, a total line, quoted cells, a byte-order mark', async () => {
        const res = await owner('/api/plan-reports/table?tab=sold&period=year&columns=seller,plans&format=csv')
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('text/csv')
        expect(res.headers.get('content-disposition')).toContain('plan-reports-sold.csv')
        const bytes = new Uint8Array(await res.arrayBuffer())
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // a spreadsheet opens it as UTF-8
        const lines = new TextDecoder().decode(bytes.slice(3)).split('\r\n')
        expect(lines[0]).toBe('"Sold by","Plans"')
        expect(lines.some((l) => l.startsWith('"Olive Owner"'))).toBe(true)
        expect(lines[lines.length - 1]).toMatch(/^"Total",/)
      })

      test('a custom range works; a backwards or malformed one is a plain 400', async () => {
        const ok = await owner(`/api/plan-reports/table?tab=plans&startDate=${ymd(Date.now() - 5 * DAY)}&endDate=${ymd(Date.now())}`)
        expect(ok.status).toBe(200)
        const back = await owner(`/api/plan-reports/table?tab=plans&startDate=${ymd(Date.now())}&endDate=${ymd(Date.now() - 5 * DAY)}`)
        expect(back.status).toBe(400)
        expect((await json(back)).error).toBeTruthy()
        expect((await owner('/api/plan-reports/table?tab=plans&startDate=yesterday')).status).toBe(400)
        expect((await owner('/api/plan-reports/table?tab=nope')).status).toBe(400)
        expect((await owner('/api/plan-reports/table?tab=plans&status=whatever')).status).toBe(400)
      })
    })

    describe('saved and scheduled reports', () => {
      let savedId = ''
      const params = { tab: 'sold', period: '30', columns: ['seller', 'plans'] }
      const schedule = { frequency: 'weekly', weekday: 1, hour: 7, recipients: ['boss@example.com', 'books@example.com'] }

      test('save by name, list, change, and the settings are checked', async () => {
        const res = await owner('/api/plan-reports/saved', { method: 'POST', json: { name: 'Weekly sales', params, schedule } })
        expect(res.status).toBeLessThan(300)
        savedId = (await data(res)).id
        const list = await data(await owner('/api/plan-reports/saved'))
        expect(list).toHaveLength(1)
        expect(list[0]).toMatchObject({ name: 'Weekly sales', params: { tab: 'sold', period: '30' }, schedule: { frequency: 'weekly', weekday: 1, hour: 7 } })
        const noName = await owner('/api/plan-reports/saved', { method: 'POST', json: { name: ' ', params } })
        expect(noName.status).toBe(400)
        const badMail = await owner('/api/plan-reports/saved', { method: 'POST', json: { name: 'x', params, schedule: { ...schedule, recipients: ['not an email'] } } })
        expect(badMail.status).toBe(400)
        const badTab = await owner('/api/plan-reports/saved', { method: 'POST', json: { name: 'x', params: { tab: 'zzz' } } })
        expect(badTab.status).toBe(400)
        const put = await owner(`/api/plan-reports/saved/${savedId}`, { method: 'PUT', json: { name: 'Weekly sales (all)', params, schedule } })
        expect(put.status).toBe(200)
        expect((await data(await owner('/api/plan-reports/saved')))[0].name).toBe('Weekly sales (all)')
      })

      test('only the person who saved it, or a manager, changes or deletes it; a field seat cannot read the list', async () => {
        const mine = await data(await seat.manager('/api/plan-reports/saved', { method: 'POST', json: { name: 'Manager view', params: { tab: 'plans', period: 'year' } } }))
        expect((await seat.field('/api/plan-reports/saved')).status).toBe(403)
        expect((await seat.field(`/api/plan-reports/saved/${savedId}`, { method: 'DELETE' })).status).toBe(403)
        expect((await seat.manager(`/api/plan-reports/saved/${mine.id}`, { method: 'DELETE' })).status).toBeLessThan(300)
      })

      test('the timed pass mails the CSV once a day, to the people on the schedule, at its hour on the business\'s clock', async () => {
        mails.length = 0
        const pass = (t.services as any).crm.eventJobs.savedReportsPass as (now?: Date) => Promise<number>
        // 2026-11-02 is a Monday. 06:30 Chicago is before the hour; 07:15 is after it.
        const early = new Date('2026-11-02T12:30:00Z'), after = new Date('2026-11-02T13:15:00Z'), tuesday = new Date('2026-11-03T13:15:00Z')
        expect(await pass(early)).toBe(0)
        expect(mails).toHaveLength(0)
        expect(await pass(after)).toBe(1)
        expect(mails.map((m) => m.to).sort()).toEqual(['books@example.com', 'boss@example.com'])
        expect(mails[0].subject).toContain('Weekly sales (all)')
        expect(mails[0].attachments[0].filename).toMatch(/\.csv$/)
        const csv = Buffer.from(mails[0].attachments[0].content).toString('utf8')
        expect(csv).toContain('"Sold by","Plans"')
        expect(await pass(new Date('2026-11-02T20:00:00Z'))).toBe(0) // already sent today
        expect(await pass(tuesday)).toBe(0) // not its day
        expect(mails).toHaveLength(2)
        const [row] = await data(await owner('/api/plan-reports/saved'))
        expect(row.lastSentAt).toBeTruthy()
      })

      test('a monthly schedule goes on its day; "send now" mails it to the schedule (or the asker when it has none)', async () => {
        mails.length = 0
        const m = await data(await owner('/api/plan-reports/saved', { method: 'POST', json: { name: 'Monthly', params: { tab: 'summary', period: 'last_month' }, schedule: { frequency: 'monthly', dayOfMonth: 5, hour: 6, recipients: ['cfo@example.com'] } } }))
        const pass = (t.services as any).crm.eventJobs.savedReportsPass as (now?: Date) => Promise<number>
        expect(await pass(new Date('2026-11-04T14:00:00Z'))).toBe(0)
        expect(await pass(new Date('2026-11-05T14:00:00Z'))).toBe(1)
        expect(mails.map((x) => x.to)).toEqual(['cfo@example.com'])
        mails.length = 0
        const manual = await data(await owner('/api/plan-reports/saved', { method: 'POST', json: { name: 'No schedule', params: { tab: 'plans', period: 'year' } } }))
        expect((await owner(`/api/plan-reports/saved/${manual.id}/send`, { method: 'POST', json: {} })).status).toBeLessThan(300)
        expect(mails.map((x) => x.to)).toEqual(['owner@test.example'])
        expect((await owner(`/api/plan-reports/saved/${m.id}`, { method: 'DELETE' })).status).toBeLessThan(300)
      })

      test('a report saved on a rolling period reports on the latest days each time it is sent', async () => {
        const run = (await import('../server/crm/field/planReportRoutes.ts')).planParamsToTable
        const a = await run(t.db, companyId, { tab: 'plans', period: '30' } as any, new Date('2026-11-05T14:00:00Z'))
        const b = await run(t.db, companyId, { tab: 'plans', period: '30' } as any, new Date(Date.now() + 400 * DAY))
        expect(a.table.rows.length).toBeGreaterThan(0)
        expect(b.table.rows).toHaveLength(0)
      })
    })

    describe('the doors', () => {
      test('reports:read only; closed while the feature is off', async () => {
        const doors = ['/api/plan-reports/table?tab=sold', '/api/plan-reports/filters', '/api/plan-reports/saved']
        for (const d of doors) {
          expect((await seat.manager(d)).status).toBe(200)
          expect((await seat.field(d)).status).toBe(403)
          expect((await seat.viewer(d)).status).toBe(403)
          expect((await t.call(d)).status).toBe(401)
        }
        await features(FEATURES.filter((f) => f !== 'plan_reports'))
        try { for (const d of doors) expect([403, 404]).toContain((await owner(d)).status) } finally { await features(FEATURES) }
      })
    })
  })
}
