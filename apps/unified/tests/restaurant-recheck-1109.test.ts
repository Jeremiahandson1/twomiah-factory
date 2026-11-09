// The restaurant re-check, 2026-11-09 (Chrome Test Kitchen): each finding still open after the first round, on the real server.
//   · a guarantee set while the line still billed the estimate: later guarantee changes now move the line;
//   · the Cook is kept off the register (tabs, payments, voids) but keeps the grill, the clock and their own till PIN;
//   · the pay run values hours clocked before the roster card had a rate at the card's rate (was Earned $0.00);
//   · the Audit Log names a stock count's item, a stock order, a PIN clock-in, and an event saved with no changes;
//   · a note typed on Tonight on its own is not taken down by an earlier override that has already ended.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore } from '../server/crm/restaurant/eventGuarantee.ts'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'event_calendar', 'bar_menu', 'bar_register', 'bar_tonight', 'bar_schedule', 'bar_stock', 'time_tracking', 'team']
let k: Awaited<ReturnType<typeof bootFood>>
let today = ''
let cookToken = ''
let cookId = ''
const auditRows = async () => (k.t.db as any).select().from(k.S.auditLog).where(eq(k.S.auditLog.companyId, k.companyId))
const asCook = async (method: string, path: string, body?: unknown) => {
  const res = await k.t.call(path, { method, headers: { Authorization: `Bearer ${cookToken}`, host: 'bar.test' }, ...(body === undefined ? {} : { json: body }) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: BASE })
  today = await venueToday(k.t.db, k.companyId)
  const [cook] = await (k.t.db as any).insert(k.S.user).values({ email: 'cook@bar.test', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Cora', lastName: 'Cook', role: 'cook', companyId: k.companyId }).returning()
  cookId = cook.id
  cookToken = (await (await k.t.call('/api/auth/login', { method: 'POST', json: { email: 'cook@bar.test', password: 'Seat-pass-1' } })).json()).accessToken
}, 60_000)
afterAll(() => k?.restore())

describe('the guaranteed count, when the line was still on the estimate', () => {
  test('a guarantee change moves a line that bills the old estimate', async () => {
    const clientId = (await k.O('POST', '/api/contacts', { name: 'Gina Guest', email: 'gina@guest.test', type: 'lead' })).json.id
    const pkg = (await k.O('POST', '/api/menu-packages', { name: 'Dinner Package', pricePerPerson: 65, minGuests: 10 })).json
    const ev = (await k.O('POST', '/api/events', { name: 'Birthday', contactId: clientId, eventDate: dayBefore(today, -40), guestCount: 30, status: 'enquiry' })).json
    await k.O('POST', `/api/events/${ev.id}/menu`, { packageId: pkg.id })
    // As on the test site: the guarantee was 26 while the line still said 30 (set before the line followed the count).
    await (k.t.db as any).update(k.S.event).set({ guestCountFinal: 26 }).where(eq(k.S.event.id, ev.id))
    expect((await k.O('PUT', `/api/events/${ev.id}`, { guestCountFinal: 27 })).status).toBe(200)
    const line = (await (k.t.db as any).select().from(k.S.eventMenuItem).where(eq(k.S.eventMenuItem.eventId, ev.id)))[0]
    expect(line.quantity).toBe(27)
    // A save that changed nothing says so in the log.
    expect((await k.O('PUT', `/api/events/${ev.id}`, { guestCountFinal: 27 })).status).toBe(200)
    const rows = (await auditRows()).filter((r: any) => r.entity === 'event' && r.action === 'update')
    expect(rows.some((r: any) => r.metadata?.description === 'Saved — nothing changed')).toBe(true)
  })
})

describe('the Cook and the register', () => {
  test('the register is refused; the grill, the clock and their own PIN are not', async () => {
    expect((await asCook('GET', '/api/register/state')).status).toBe(403)
    expect((await asCook('POST', '/api/register/check', { name: 'Tab', kind: 'tab' })).status).toBe(403)
    expect((await asCook('GET', '/api/grill/state')).status).toBe(200)
    expect((await asCook('GET', '/api/register/clock')).status).toBe(200)
    expect((await asCook('GET', '/api/register/clock')).json.hasPin).toBe(false)
    expect((await asCook('GET', '/api/register/clock')).json.register).toBe(false)
    expect((await k.B('GET', '/api/register/clock')).json.register).toBe(true)
    expect((await asCook('PUT', '/api/register/pin', { pin: '482915' })).status).toBe(200)
    // The cook clocks in with their own PIN; the row names them.
    const r = await asCook('POST', '/api/register/clock', { pin: '482915' })
    expect(r.status).toBe(200); expect(r.json.action).toBe('in')
    await k.settle()
    expect((await auditRows()).some((a: any) => a.entity === 'time_entry' && a.entityName === 'Cora Cook' && a.metadata?.description === 'Clocked in with their till PIN')).toBe(true)
    const [entry] = await (k.t.db as any).select().from(k.S.timeEntry).where(and(eq(k.S.timeEntry.companyId, k.companyId)))
    expect(entry.description).toBe('Time clock (PIN)')
    // A server (the Staff rung) still has the register.
    expect((await k.B('GET', '/api/register/state')).status).toBe(200)
    // What the screen is told: no bar:register for the cook.
    const me = (await asCook('GET', '/api/auth/me')).json
    expect(me.permissions).not.toContain('bar:register')
    expect(me.permissions).toContain('bar:console')
  })
})

describe('the pay run', () => {
  test('hours with no rate stamped are valued at the roster card', async () => {
    await k.O('POST', '/api/team', { name: 'Bartender Seat', email: 'bartender@bar.test', hourlyRate: 15 })
    await (k.t.db as any).insert(k.S.timeEntry).values({ companyId: k.companyId, userId: k.ids.bartender, date: new Date(`${today}T12:00:00Z`), hours: '2.00', hourlyRate: null, billable: true })
    const r = await k.O('GET', `/api/payroll/summary?startDate=${dayBefore(today, 1)}&endDate=${today}`)
    expect(r.status).toBe(200)
    const mine = r.json.users.find((u: any) => u.user?.id === k.ids.bartender)
    expect(mine.totalPay).toBe(30)
  })
})

describe('stock rows in the Audit Log', () => {
  test('a count names the item; an order names its number', async () => {
    const item = (await k.O('POST', '/api/stock/items', { name: 'House whiskey', category: 'spirits', unit: 'each', packSize: 1, parPacks: 6 })).json.item
    expect((await k.O('POST', '/api/stock/count/item', { stockItemId: item.id, packs: 1 })).status).toBe(200)
    const order = (await k.O('POST', '/api/stock/orders', { lines: [{ stockItemId: item.id, packs: 2 }] })).json
    expect((await k.O('PUT', `/api/stock/orders/${order.id}`, { note: 'Thursday drop', lines: [{ stockItemId: item.id, packs: 3 }] })).status).toBe(200)
    await k.settle()
    const rows = await auditRows()
    const count = rows.find((r: any) => r.entity === 'bar_stock_count' && r.changes && 'House whiskey' in r.changes)
    expect(count).toBeTruthy()
    expect(rows.some((r: any) => r.entity === 'bar_purchase_order' && /^Stock order #\d+$/.test(r.entityName || '') && r.action === 'update')).toBe(true)
    expect(rows.some((r: any) => r.entity === 'order')).toBe(false)
  })
})

describe('Tonight: a note on its own', () => {
  test('is not taken down by an override that already ended', async () => {
    await k.O('PUT', '/api/bar/tonight', { kitchenOpen: false })
    // That override ended yesterday.
    await (k.t.db as any).update(k.S.barStatus).set({ overrideUntil: new Date(Date.now() - 3600_000) }).where(eq(k.S.barStatus.companyId, k.companyId))
    const live = (await k.O('PUT', '/api/bar/tonight', { note: 'Patio open' })).json.live
    expect(live.note).toBe('Patio open')
    const [st] = await (k.t.db as any).select().from(k.S.barStatus).where(eq(k.S.barStatus.companyId, k.companyId))
    // The lapsed "closed" went with its date, so it cannot come back for good.
    expect(st.kitchenOpen).toBeNull(); expect(st.overrideUntil).toBeNull()
  })
})

describe('the second report: tip-out without a shift, pickups by position, the Summary CSV', () => {
  test('a cook who clocks in with no shift that night is paid as the kitchen', async () => {
    await k.features([...BASE, 'bar_tip_pooling', 'bar_shift_swaps'])
    expect((await k.O('PUT', '/api/tips/rules', { roles: [{ name: 'Servers', positions: [], mode: 'keeps', poolPct: 0 }, { name: 'Kitchen', positions: [], mode: 'pools', poolPct: 100 }], tipOuts: [{ from: 'Servers', to: 'Kitchen', pct: 10, basis: 'tips' }], defaultRole: '', positionRoles: { Floor: 'Servers', Grill: 'Kitchen' } })).status).toBe(200)
    const day = dayBefore(today, 2)
    const ins = (t: any, v: any) => (k.t.db as any).insert(t).values(v)
    // The cook worked the Grill last week; tonight they clocked in without a shift. The server is on the Floor.
    await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: cookId, day: dayBefore(today, 9), start: '16:00', end: '22:00', position: 'Grill' })
    await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: k.ids.bartender, day, start: '16:00', end: '22:00', position: 'Floor' })
    for (const id of [cookId, k.ids.bartender]) {
      const inn = new Date(`${day}T22:00:00Z`), out = new Date(`${day}T23:30:00Z`)
      await ins(k.S.timeEntry, { companyId: k.companyId, userId: id, date: inn, hours: '1.50', clockIn: inn, clockOut: out })
    }
    await ins(k.S.barDeclaredTip, { companyId: k.companyId, userId: k.ids.bartender, businessDay: day, amountCents: 400, originalCents: 400 })
    const night = (await k.O('GET', `/api/tips/night?day=${day}`)).json
    const by = Object.fromEntries(night.payouts.map((p: any) => [p.userId, p]))
    expect(by[cookId].role).toBe('Kitchen')
    expect(by[k.ids.bartender]).toMatchObject({ role: 'Servers', tipOutPaidCents: 40 })
  })

  test("a Floor give-away is not offered to someone who only works the Grill", async () => {
    const day = dayBefore(today, -5)
    const a = (await k.M('POST', '/api/schedule/shifts', { userId: k.ids.bartender, day, start: '10:00', end: '14:00', position: 'Floor' })).json
    await k.M('POST', '/api/schedule/publish', { day })
    expect((await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: a.shift?.id || a.id })).status).toBeLessThan(300)
    expect((await asCook('GET', '/api/schedule/swaps/mine')).json.onOffer.length).toBe(0)
    // Someone who works the Floor (or has never been scheduled) is offered it.
    await (k.t.db as any).insert(k.S.barScheduleShift).values({ companyId: k.companyId, userId: k.ids.manager, day: dayBefore(today, 20), start: '10:00', end: '14:00', position: 'Floor' })
    expect((await k.M('GET', '/api/schedule/swaps/mine')).json.onOffer.length).toBe(1)
  })

  test('a download the screen made is recorded', async () => {
    expect((await k.O('POST', '/api/audit/export', { what: 'Report summary', period: 'This month' })).status).toBe(200)
    expect((await k.O('POST', '/api/audit/export', {})).status).toBe(400)
    const row = (await auditRows()).find((r: any) => r.action === 'export' && r.entityName === 'Report summary')
    expect(row?.metadata?.description).toBe('Downloaded as CSV — This month')
  })
})

describe('re-check 2: the last payment is the balance', () => {
  test('a lower guarantee shrinks the final balance instead of being refused; a higher one grows it', async () => {
    const clientId = (await k.O('POST', '/api/contacts', { name: 'Pat Payer', email: 'pat@guest.test', type: 'client' })).json.id
    const pkg = (await k.O('POST', '/api/menu-packages', { name: 'Supper Package', pricePerPerson: 65, minGuests: 10 })).json
    const ev = (await k.O('POST', '/api/events', { name: 'Anniversary', contactId: clientId, eventDate: dayBefore(today, -30), guestCount: 30, status: 'confirmed' })).json
    await k.O('POST', `/api/events/${ev.id}/menu`, { packageId: pkg.id })
    await k.O('POST', `/api/events/${ev.id}/payments`, { label: 'Deposit', amount: 500, dueDate: dayBefore(today, -5) })
    await k.O('POST', `/api/events/${ev.id}/payments`, { label: 'Final balance', amount: 1450, dueDate: dayBefore(today, -30) })
    const amounts = async () => Object.fromEntries((await (k.t.db as any).select().from(k.S.eventPayment).where(eq(k.S.eventPayment.eventId, ev.id))).map((p: any) => [p.label, Number(p.amount)]))
    const r = await k.O('PUT', `/api/events/${ev.id}`, { guestCountFinal: 27 })
    expect(r.status).toBe(200)
    expect(await amounts()).toEqual({ Deposit: 500, 'Final balance': 1255 })
    const [inv] = await (k.t.db as any).select().from(k.S.invoice).where(eq(k.S.invoice.eventId, ev.id))
    expect(Number(inv.total)).toBe(1755)
    expect((await k.O('PUT', `/api/events/${ev.id}`, { guestCountFinal: 28 })).status).toBe(200)
    expect(await amounts()).toEqual({ Deposit: 500, 'Final balance': 1320 })
  })
})
