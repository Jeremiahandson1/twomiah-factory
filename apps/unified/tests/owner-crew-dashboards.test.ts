// Owner and crew dashboards (contractor parity, item 5): the owner's "needs you today" and who is on which job, and the crew
// member's "my day". Two not-ready features, owner_dashboard and crew_dashboard. Server half, through the real app; the screen
// half is owner-crew-dashboards-ui.test.ts (a DOM installed as globals stops the in-memory database booting).
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { FEATURE_REGISTRY, storeDateString } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => (await r.json()) as any
const DAY = 86_400_000
const TZ = 'America/Chicago'
const BASE = ['contacts', 'quotes', 'jobs', 'projects', 'dashboard', 'vendor_bills', 'job_budgets', 'time_tracking', 'tasks']
const ALL = [...BASE, 'owner_dashboard', 'crew_dashboard']

describe('the features', () => {
  test.each(['owner_dashboard', 'crew_dashboard'])('%s is registered, not ready, and offered to the general contractor only', (id) => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === id)
    expect(f).toBeTruthy()
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm'])
  })
})

async function boot(features: string[]) {
  const t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, timezone: TZ } as any).where(eq(t.schema.company.id, s.company.id))
  // The one place a row is written straight to the database: typed by the table it goes into.
  const ins = async <T extends PgTable>(table: T, values: T['$inferInsert']) => ((await t.db.insert(table).values(values as any).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const companyId = s.company.id as string
  const [ownerRow] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'owner@test.example')).limit(1)
  let n = 0
  const person = async (role: string, first: string, extraPermissions: string[] = []) => {
    const email = `${first.toLowerCase()}@test.example`
    const row = await ins(t.schema.user, { companyId, email, firstName: first, lastName: 'Crew', role, extraPermissions, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') } as any)
    return { id: row.id as string, call: as(await login(email, 'Correct-horse-1')) }
  }
  const today = storeDateString(new Date(), TZ)
  const day = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY)
  const mkJob = (extra: Record<string, unknown> = {}, forCompany = companyId) =>
    ins(t.schema.job, { companyId: forCompany, number: `JOB-${++n}`, title: `Job ${n}`, status: 'scheduled', ...extra } as any)
  return { t, ins, owner, person, companyId, ownerId: ownerRow.id as string, today, day, mkJob }
}
type X = Awaited<ReturnType<typeof boot>>

describe('the owner dashboard', () => {
  async function seeded(x: X) {
    const { t, ins, companyId } = x
    const customer = await ins(t.schema.contact, { companyId, type: 'client', name: 'Ann Able' })
    const vendor = await ins(t.schema.contact, { companyId, type: 'vendor', name: 'Lumber Yard' })
    const q = (number: string, status: string, total: string, sentAt: Date | null) => ins(t.schema.quote, { companyId, number, name: number, status, total, sentAt, contactId: customer.id } as any)
    await q('Q-1', 'sent', '1000', new Date(Date.now() - 8 * DAY))
    await q('Q-2', 'viewed', '2000', new Date(Date.now() - 10 * DAY))
    await q('Q-3', 'sent', '500', new Date(Date.now() - 3 * DAY)) // not yet 7 days
    await q('Q-4', 'draft', '700', null)
    await q('Q-5', 'approved', '900', new Date(Date.now() - 20 * DAY))
    const bill = (status: string, amount: string, amountPaid: string, due: Date | null) => ins(t.schema.vendorBill, { companyId, vendorId: vendor.id, status, amount, amountPaid, dueDate: due } as any)
    await bill('open', '400', '100', x.day(-1)) // past due, 300 left
    await bill('open', '200', '0', x.day(3)) // due in 3 days
    await bill('open', '900', '0', x.day(20)) // not yet
    await bill('paid', '800', '800', x.day(-5)) // paid
    await bill('void', '800', '0', x.day(-5)) // void
    // Jobs: tomorrow with nobody on it (counts); tomorrow led by the owner; tomorrow with a helper only; far off; yesterday; finished.
    await x.mkJob({ scheduledDate: x.day(1) })
    await x.mkJob({ scheduledDate: x.day(1), assignedToId: x.ownerId })
    const helped = await x.mkJob({ scheduledDate: x.day(1) })
    await ins(t.schema.jobAssignee, { companyId, jobId: helped.id, userId: x.ownerId } as any)
    await x.mkJob({ scheduledDate: x.day(30) })
    await x.mkJob({ scheduledDate: x.day(-1) })
    await x.mkJob({ scheduledDate: x.day(1), status: 'completed' })
    return { customer, vendor }
  }

  test('off: the route is not there (403)', async () => {
    const x = await boot(BASE)
    expect((await x.owner('/api/owner-dashboard')).status).toBe(403)
  }, 120_000)

  test('on: counts what needs the owner — stale quotes, bills due, jobs nobody is on — with the money in each', async () => {
    const x = await boot(ALL)
    await seeded(x)
    const r = await x.owner('/api/owner-dashboard')
    expect(r.status).toBe(200)
    const by = Object.fromEntries((await json(r)).attention.map((a: any) => [a.id, a]))
    expect([by.quotes_waiting.count, by.quotes_waiting.amount]).toEqual([2, 3000]) // 8 and 10 days; not the 3-day one, the draft or the approved
    expect([by.bills_due.count, by.bills_due.amount]).toEqual([2, 500]) // 300 left on the past-due one + 200; not the far one, paid or void
    expect(by.unassigned_jobs.count).toBe(1) // not the led, helped, far-off, yesterday's or finished ones
    expect(by.quotes_waiting.href).toBe('/crm/quotes')
  }, 120_000)

  test('projects over their budget: those whose cost so far is past what the approved quote budgeted, worst first named', async () => {
    const x = await boot(ALL)
    const { ins, t, companyId } = x
    const over = await ins(t.schema.project, { companyId, number: 'PRJ-1', name: 'Kitchen remodel', status: 'active' } as any)
    const fine = await ins(t.schema.project, { companyId, number: 'PRJ-2', name: 'Bath refresh', status: 'active' } as any)
    const done = await ins(t.schema.project, { companyId, number: 'PRJ-3', name: 'Old deck', status: 'completed' } as any)
    for (const [p, cost] of [[over, '100'], [fine, '1000'], [done, '100']] as const) {
      await ins(t.schema.projectBudgetLine, { companyId, projectId: p.id, costCode: '06-Framing', estimatedCost: cost, estimatedPrice: '2000', uncostedLines: 0 } as any)
      const j = await x.mkJob({ projectId: p.id })
      await ins(t.schema.expense, { companyId, category: 'materials', description: 'Lumber', amount: '250', jobId: j.id } as any)
    }
    const by = Object.fromEntries((await json(await x.owner('/api/owner-dashboard'))).attention.map((a: any) => [a.id, a]))
    expect([by.over_budget.count, by.over_budget.amount, by.over_budget.detail]).toEqual([1, 150, ['Kitchen remodel']])
  }, 120_000)

  test('who is on which job today: by the person who leads it, nobody-yet last, cancelled and other days left out', async () => {
    const x = await boot(ALL)
    const crew = await x.person('field', 'Carl')
    const a = await x.mkJob({ scheduledDate: x.day(0), assignedToId: x.ownerId, scheduledTime: '08:00' })
    const b = await x.mkJob({ scheduledDate: x.day(0), assignedToId: crew.id })
    const c = await x.mkJob({ scheduledDate: x.day(0) })
    await x.mkJob({ scheduledDate: x.day(0), status: 'cancelled', assignedToId: crew.id })
    await x.mkJob({ scheduledDate: x.day(1), assignedToId: crew.id })
    const groups = (await json(await x.owner('/api/owner-dashboard'))).crewToday as any[]
    expect(groups.map((g) => g.person?.name ?? null)).toEqual(['Carl Crew', 'Olive Owner', null])
    expect(groups.map((g) => g.jobs.map((j: any) => j.id))).toEqual([[b.id], [a.id], [c.id]])
    expect(groups[1].jobs[0].scheduledTime).toBe('08:00')
  }, 120_000)

  test('each part is sent only to a seat that may see it, and only where the business has what it counts', async () => {
    const x = await boot(ALL)
    await seeded(x)
    const crew = await x.person('field', 'Carl')
    const deskQuotes = await x.person('field', 'Quinn', ['quotes:read'])
    const viewer = await x.person('viewer', 'Vera')
    const mine = async (who: { call: any }) => await json(await who.call('/api/owner-dashboard'))
    // a crew seat (dashboard:read, no read-all): nothing of the company's
    const c = await mine(crew)
    expect(c.attention).toEqual([])
    expect(c.crewToday).toBeUndefined()
    // given quotes:read it sees that one item only
    expect((await mine(deskQuotes)).attention.map((a: any) => a.id)).toEqual(['quotes_waiting'])
    // a viewer reads quotes and every job, not bills or reports
    const v = await mine(viewer)
    expect(v.attention.map((a: any) => a.id).sort()).toEqual(['quotes_waiting', 'unassigned_jobs'])
    expect(v.crewToday).toBeDefined()
    // signed out: refused (every role holds dashboard:read, so the route's own gate is sign-in; what a seat sees is decided per part, above)
    expect((await x.t.call('/api/owner-dashboard')).status).toBe(401)
    // bills switched off: the item is gone for the owner too
    await x.t.db.update(x.t.schema.company).set({ enabledFeatures: ALL.filter((f) => f !== 'vendor_bills') } as any).where(eq(x.t.schema.company.id, x.companyId))
    await new Promise((r) => setTimeout(r, 16_000)) // the feature gate caches for 15 seconds
    expect((await mine({ call: x.owner })).attention.map((a: any) => a.id)).not.toContain('bills_due')
  }, 180_000)

  test('another company\'s quotes and jobs are never counted', async () => {
    const x = await boot(ALL)
    const [other] = await x.t.db.insert(x.t.schema.company).values({ name: 'Other Co', slug: 'other-co' }).returning()
    await x.ins(x.t.schema.quote, { companyId: other.id, number: 'Q-X', name: 'Theirs', status: 'sent', total: '999', sentAt: new Date(Date.now() - 30 * DAY) } as any)
    await x.mkJob({ scheduledDate: x.day(0) }, other.id)
    const b = await json(await x.owner('/api/owner-dashboard'))
    expect(b.attention.find((a: any) => a.id === 'quotes_waiting').count).toBe(0)
    expect(b.crewToday).toEqual([])
  }, 120_000)
})

describe('the crew dashboard ("my day")', () => {
  test('off: the route is not there (403)', async () => {
    const x = await boot(BASE)
    expect((await x.owner('/api/crew-dashboard')).status).toBe(403)
  }, 120_000)

  test('on: only MY jobs today (led or helping), what is coming this week, my hours and my open tasks', async () => {
    const x = await boot(ALL)
    const { ins, t, companyId } = x
    const me = await x.person('field', 'Carl')
    const other = await x.person('field', 'Dana')
    const customer = await ins(t.schema.contact, { companyId, type: 'client', name: 'Ann Able', phone: '715-555-0100', email: 'ann@example.com' })
    const led = await x.mkJob({ scheduledDate: x.day(0), assignedToId: me.id, scheduledTime: '07:30', address: '12 Elm St', city: 'Eau Claire', contactId: customer.id })
    const helping = await x.mkJob({ scheduledDate: x.day(0), status: 'in_progress' })
    await ins(t.schema.jobAssignee, { companyId, jobId: helping.id, userId: me.id } as any)
    await x.mkJob({ scheduledDate: x.day(0), assignedToId: other.id })
    const tomorrow = await x.mkJob({ scheduledDate: x.day(1), assignedToId: me.id })
    await x.mkJob({ scheduledDate: x.day(2), assignedToId: other.id })
    await x.mkJob({ scheduledDate: x.day(30), assignedToId: me.id })
    await x.mkJob({ scheduledDate: x.day(1), assignedToId: me.id, status: 'completed' })
    await ins(t.schema.timeEntry, { companyId, userId: me.id, hours: '2', date: new Date() } as any)
    await ins(t.schema.timeEntry, { companyId, userId: me.id, hours: '5', date: new Date(Date.now() - 20 * DAY) } as any)
    await ins(t.schema.timeEntry, { companyId, userId: other.id, hours: '3', date: new Date() } as any)
    await ins(t.schema.task, { companyId, title: 'Order trim', assignedToId: me.id, status: 'pending' } as any)
    await ins(t.schema.task, { companyId, title: 'Call inspector', assignedToId: me.id, status: 'pending' } as any)
    await ins(t.schema.task, { companyId, title: 'Done thing', assignedToId: me.id, status: 'completed' } as any)
    await ins(t.schema.task, { companyId, title: 'Dana task', assignedToId: other.id, status: 'pending' } as any)

    const r = await me.call('/api/crew-dashboard')
    expect(r.status).toBe(200)
    const b = await json(r)
    expect(b.today.map((j: any) => j.id).sort()).toEqual([led.id, helping.id].sort())
    const l = b.today.find((j: any) => j.id === led.id)
    expect([l.scheduledTime, l.address, l.city, l.customer]).toEqual(['07:30', '12 Elm St', 'Eau Claire', 'Ann Able'])
    expect(b.next.map((j: any) => j.id)).toEqual([tomorrow.id])
    expect(b.next[0].day).toBe(storeDateString(new Date(x.day(1)), 'UTC'))
    expect(b.nextCount).toBe(1)
    expect(b.hours).toEqual({ today: 2, week: 2 })
    expect(b.tasks.open).toBe(2)
    expect(b.tasks.next.map((t: any) => t.title).sort()).toEqual(['Call inspector', 'Order trim'])
    // the crew goes to the address; the customer's phone and email are not sent
    expect(JSON.stringify(b)).not.toMatch(/715-555-0100|ann@example\.com/)
  }, 120_000)

  test('is MY day even for the owner (no jobs of their own: an empty day, not the company\'s)', async () => {
    const x = await boot(ALL)
    await x.mkJob({ scheduledDate: x.day(0) })
    const b = await json(await x.owner('/api/crew-dashboard'))
    expect(b.today).toEqual([])
    expect(b.next).toEqual([])
  }, 120_000)

  test('hours and tasks appear only where time tracking and tasks are on; signed out is refused', async () => {
    const x = await boot([...ALL].filter((f) => f !== 'time_tracking' && f !== 'tasks'))
    const me = await x.person('field', 'Carl')
    const b = await json(await me.call('/api/crew-dashboard'))
    expect(b.hours).toBeUndefined()
    expect(b.tasks).toBeUndefined()
    expect(Array.isArray(b.today)).toBe(true)
    expect((await x.t.call('/api/crew-dashboard')).status).toBe(401) // signed out (every role reads jobs: it is only ever the caller's own)
  }, 120_000)

  test('"today" is the company\'s calendar day', async () => {
    const x = await boot(ALL)
    const me = await x.person('field', 'Carl')
    // A job on tomorrow's marker is not today's, whatever the server's clock says.
    const tomorrow = await x.mkJob({ scheduledDate: x.day(1), assignedToId: me.id })
    const b = await json(await me.call('/api/crew-dashboard'))
    expect(b.today).toEqual([])
    expect(b.next.map((j: any) => j.id)).toEqual([tomorrow.id])
  }, 120_000)
})
