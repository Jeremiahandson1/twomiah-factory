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
const auditRows = async () => (k.t.db as any).select().from(k.S.auditLog).where(eq(k.S.auditLog.companyId, k.companyId))
const asCook = async (method: string, path: string, body?: unknown) => {
  const res = await k.t.call(path, { method, headers: { Authorization: `Bearer ${cookToken}`, host: 'bar.test' }, ...(body === undefined ? {} : { json: body }) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: BASE })
  today = await venueToday(k.t.db, k.companyId)
  await (k.t.db as any).insert(k.S.user).values({ email: 'cook@bar.test', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Cora', lastName: 'Cook', role: 'cook', companyId: k.companyId })
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
