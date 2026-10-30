// The phone's Tier 2 office screens (apps/mobile/src/trades/office.ts) against a REAL unified server: each screen's own list
// request answers, its row mapping reads the real rows, its detail opens, and its actions do what they say — approve a
// team member's hours and expense, confirm then complete a booking, take someone off the waitlist. The specs are data, so the
// very requests the phone makes are the ones run here. (Google reviews needs a connected Google account: not connected, the
// server says so in words — what the phone shows.)
//
//   cd apps/unified && bun test --timeout 240000 tests/mobile-office-screens.test.ts
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { OFFICE } from '../../mobile/src/trades/office.ts'
import { fillDates } from '../../mobile/src/trades/kit.ts'
import { reqUrl } from '../../mobile/src/home/tiles.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
const ids: Record<string, string> = {}
const spec = (id: string) => OFFICE.find((s) => s.id === id)!
const call = async (method: string, path: string, body?: unknown) => {
  const res = await t.call(path, { method, headers: { Authorization: `Bearer ${token}` }, ...(body !== undefined ? { json: body } : {}) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const listOf = async (id: string, chip?: string) => {
  const s = spec(id)
  const query = fillDates({ ...(s.list.query || {}), ...(s.chips?.find((c) => c.id === chip)?.query || {}) })
  const r = await call('GET', reqUrl({ path: s.list.path, query }))
  expect(r.status).toBe(200)
  const rows: any[] = s.pick ? s.pick(r.body) : Array.isArray(r.body?.data) ? r.body.data : r.body
  return rows.map((row) => ({ row, shown: s.rows(row, {}) }))
}
const act = (specId: string, actionId: string, d: any, values: Record<string, string> = {}) => {
  const a = spec(specId).detail!.actions!.find((x) => x.id === actionId)!
  const req = a.request(d, values)
  return call(req.method, req.path, req.body)
}

beforeAll(async () => {
  t = await bootTenant()
  const seeded = await seedOwner(t)
  const companyId = seeded.company.id
  const S = t.schema as any
  await t.db.update(S.company).set({ enabledFeatures: ['contacts', 'jobs', 'time_tracking', 'expense_tracking', 'online_booking', 'google_reviews', 'google_business', 'reports'] }).where(eq(S.company.id, companyId))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  const [crew] = await t.db.insert(S.user).values({ email: 'crew@test.example', passwordHash: 'x', firstName: 'Casey', lastName: 'Crew', role: 'field', companyId }).returning()
  ids.time = (await t.db.insert(S.timeEntry).values({ companyId, userId: crew.id, date: new Date(), hours: '7.5', description: 'Framing' }).returning())[0].id
  ids.expense = (await t.db.insert(S.expense).values({ companyId, category: (await call('GET', '/api/expenses/categories')).body.categories[0].value, description: 'Tile spacers', amount: '24.50', submittedById: crew.id }).returning())[0].id
  const svc = (await t.db.insert(S.bookingService).values({ companyId, slug: 'estimate', name: 'Estimate', durationMinutes: 60 }).returning())[0]
  // One that began half a minute ago (today, and it may be marked done); one an hour ahead (it may not, yet).
  const start = new Date(Date.now() - 30_000), ahead = new Date(Date.now() + 3_600_000)
  ids.booking = (await t.db.insert(S.booking).values({ companyId, serviceId: svc.id, startAt: start, endAt: new Date(start.getTime() + 3_600_000), customerName: 'Pat Booker', customerEmail: 'pat@example.net', customerPhone: '715-555-0199', status: 'pending', token: 'tok-1' }).returning())[0].id
  ids.later = (await t.db.insert(S.booking).values({ companyId, serviceId: svc.id, startAt: ahead, endAt: new Date(ahead.getTime() + 3_600_000), customerName: 'Lou Later', customerEmail: 'lou@example.net', status: 'confirmed', token: 'tok-2' }).returning())[0].id
  ids.wait = (await t.db.insert(S.bookingWaitlist).values({ companyId, serviceId: svc.id, customerName: 'Wren Waiting', customerEmail: 'wren@example.net' }).returning())[0].id
  const [contact] = await t.db.insert(S.contact).values({ companyId, name: 'Rae Reviewer', email: 'rae@example.net' }).returning()
  ids.request = (await t.db.insert(S.reviewRequest).values({ companyId, contactId: contact.id, status: 'sent', sentAt: new Date() }).returning())[0].id
}, 180_000)

describe('the phone office screens, by their own requests', () => {
  test('Hours: the team member\'s entry is waiting; Approve approves it', async () => {
    const waiting = await listOf('office-time', 'waiting')
    const mine = waiting.find((r) => r.row.id === ids.time)!
    expect(mine.shown.title).toBe('Casey Crew')
    expect(mine.shown.badge).toBe('Waiting')
    expect((await act('office-time', 'approve', mine.row)).status).toBe(200)
    expect((await listOf('office-time', 'waiting')).some((r) => r.row.id === ids.time)).toBe(false)
  })

  test('Expenses: listed with who spent it; the detail opens; Approve approves it', async () => {
    const rows = await listOf('office-expenses')
    const e = rows.find((r) => r.row.id === ids.expense)!
    expect(e.shown.meta).toBe('$24.50')
    expect(e.shown.subtitle).toContain('Casey Crew')
    const d = await call('GET', spec('office-expenses').detail!.path(ids.expense)!)
    expect(d.status).toBe(200)
    expect((await act('office-expenses', 'approve', d.body)).status).toBe(200)
    expect((await call('GET', `/api/expenses/${ids.expense}`)).body.approved).toBe(true)
  })

  test('Bookings: today\'s booking is on Today; Confirm, then Mark done', async () => {
    const today = await listOf('office-bookings', 'today')
    expect(today.map((r) => r.row.id)).toContain(ids.booking)
    const d = await call('GET', spec('office-bookings').detail!.path(ids.booking)!)
    expect(d.status).toBe(200)
    expect(spec('office-bookings').detail!.actions!.find((a) => a.id === 'confirm')!.when!(d.body)).toBe(true)
    expect((await act('office-bookings', 'confirm', d.body)).status).toBe(200)
    const after = (await call('GET', `/api/booking/bookings/${ids.booking}`)).body
    expect(after.status ?? after.data?.status).toBe('confirmed')
    expect((await act('office-bookings', 'complete', after.data ?? after)).status).toBe(200)
  })

  test('Bookings: a visit not begun is not offered Mark done or No-show (the server refuses both)', async () => {
    const d = (await call('GET', `/api/booking/bookings/${ids.later}`)).body
    const row = d.data ?? d
    const offered = spec('office-bookings').detail!.actions!.filter((a) => !a.when || a.when(row)).map((a) => a.id)
    expect(offered).toEqual(['cancel'])
    expect((await act('office-bookings', 'complete', row)).status).toBe(400)
  })

  test('Waitlist: listed; Take off removes it', async () => {
    const rows = await listOf('office-waitlist')
    const w = rows.find((r) => r.row.id === ids.wait)!
    expect(w.shown.title).toBe('Wren Waiting')
    expect((await act('office-waitlist', 'remove', w.row)).status).toBe(200)
    expect((await listOf('office-waitlist')).some((r) => r.row.id === ids.wait)).toBe(false)
  })

  test('Review requests: listed by the customer\'s name', async () => {
    const rows = await listOf('office-review-requests')
    expect(rows.find((r) => r.row.id === ids.request)?.shown.title).toBe('Rae Reviewer')
  })

  test('Google reviews: not connected, the server says so in words (the phone shows them)', async () => {
    const r = await call('GET', spec('office-google-reviews').list.path)
    expect(r.status).toBe(400)
    expect(String(r.body.error)).toMatch(/Connect Google/)
  })

  test('Reports summary: the dashboard answers owed, today and the week', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const r = await call('GET', `/api/reports/dashboard?startDate=${day}&endDate=${day}`)
    expect(r.status).toBe(200)
    for (const k of ['invoiced', 'collected', 'outstanding', 'outstandingCount', 'overdue', 'overdueCount']) expect(r.body.revenue).toHaveProperty(k)
  })
})
