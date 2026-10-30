// The menu by time of day with an 86 that comes back at open (restaurant-bar-depth #11), and the count by how full each open
// bottle is (#13). On the real server, a restaurant tenant (the bar shares both through the same routes and features).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { servedAt, nextOpening, windowRefusal } from '../server/crm/bar/menuDay.ts'
import { createBarLive } from '../server/crm/bar/barLive.ts'
import { localParts, EMPTY_HOURS } from '../server/crm/bar/barHours.ts'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
const BASE = ['contacts', 'invoices', 'dashboard', 'bar_menu', 'bar_register', 'bar_tonight', 'bar_stock']
const hhmm = (mins: number) => { const m = ((mins % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
const HR = 60

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: BASE })
  items = await k.menu()
}, 60_000)
afterAll(() => k.restore())

describe('#11 a section is served only in its window', () => {
  test('the window rule: days, and a window that crosses midnight belongs to the day it started', () => {
    const tz = 'America/Chicago'
    const at = (iso: string) => new Date(iso)   // 2026-11-02 is a Monday; Chicago is UTC-6 in November
    const lunch = { availableFrom: '11:00', availableTo: '15:00', availableDays: [1, 2, 3, 4, 5] }
    expect(servedAt(lunch, at('2026-11-02T18:00:00Z'), tz)).toBe(true)    // Monday 12:00
    expect(servedAt(lunch, at('2026-11-02T22:00:00Z'), tz)).toBe(false)   // Monday 16:00
    expect(servedAt(lunch, at('2026-11-01T18:00:00Z'), tz)).toBe(false)   // Sunday noon
    const late = { availableFrom: '22:00', availableTo: '02:00', availableDays: [5] }   // Friday night
    expect(servedAt(late, at('2026-11-07T05:00:00Z'), tz)).toBe(true)     // Friday 23:00
    expect(servedAt(late, at('2026-11-07T07:00:00Z'), tz)).toBe(true)     // Saturday 01:00, still Friday's
    expect(servedAt(late, at('2026-11-07T09:00:00Z'), tz)).toBe(false)    // Saturday 03:00
    expect(servedAt({ availableFrom: null, availableTo: null, availableDays: [] }, new Date(), tz)).toBe(true)
    expect(windowRefusal({ availableFrom: '11:00' })).toMatch(/both/)
    expect(windowRefusal({ availableFrom: '25:00', availableTo: '12:00' })).toMatch(/11:00/)
    expect(windowRefusal({ availableFrom: '11:00', availableTo: '15:00', availableDays: [7] })).toMatch(/0 \(Sunday\)/)
  })

  test('off, a window cannot be set; on, a section outside its hours leaves the website and the register picker and cannot be rung', async () => {
    const sec = (await k.M('GET', '/api/bar/menu')).json.sections.find((s: any) => s.name === 'Burgers')
    expect((await k.M('PUT', `/api/bar/menu/sections/${sec.id}`, { name: 'Burgers', kind: 'food', availableFrom: '11:00', availableTo: '15:00' })).status).toBe(400)
    await k.features([...BASE, 'menu_dayparts'])
    expect((await k.B('PUT', `/api/bar/menu/sections/${sec.id}`, { name: 'Burgers', kind: 'food', availableFrom: '11:00', availableTo: '15:00' })).status).toBe(403)
    const tz = (await createBarLive(k.t.db as any).hoursFor(k.companyId)).timezone || 'America/Chicago'
    const p = localParts(new Date(), tz), now = p.h * 60 + p.mi
    // Inside: an hour either side of now.
    expect((await k.M('PUT', `/api/bar/menu/sections/${sec.id}`, { name: 'Burgers', kind: 'food', availableFrom: hhmm(now - HR), availableTo: hhmm(now + HR) })).status).toBe(200)
    const sectionNames = async () => ((await k.pub('GET', '/api/public/bar/menu')).json.sections || (await k.pub('GET', '/api/public/bar/menu')).json.data?.sections || []).map((s: any) => s.name)
    expect(await sectionNames()).toContain('Burgers')
    const reg = async () => (await k.B('GET', '/api/register/state')).json.menu.map((s: any) => s.name)
    expect(await reg()).toContain('Burgers')
    // Outside: two to three hours from now.
    expect((await k.M('PUT', `/api/bar/menu/sections/${sec.id}`, { name: 'Burgers', kind: 'food', availableFrom: hhmm(now + 2 * HR), availableTo: hhmm(now + 3 * HR) })).status).toBe(200)
    expect(await sectionNames()).not.toContain('Burgers')
    expect(await reg()).not.toContain('Burgers')
    const chk = await k.B('POST', '/api/register/check', { kind: 'walkup', label: 'Late' })
    const refused = await k.B('POST', `/api/register/check/${chk.json.check.id}/items`, { menuItemId: items.burger.id })
    expect(refused.status).toBeGreaterThanOrEqual(400); expect(JSON.stringify(refused.json)).toMatch(/not being served/)
    // The manager's own menu list still shows it with its window, to change.
    const mine = (await k.M('GET', '/api/bar/menu')).json.sections.find((s: any) => s.id === sec.id)
    expect(mine.availableFrom).toBe(hhmm(now + 2 * HR))
    // Feature off again: the section is served all day, as it always was.
    await k.features(BASE)
    expect(await sectionNames()).toContain('Burgers')
    await k.features([...BASE, 'menu_dayparts'])
    await k.M('PUT', `/api/bar/menu/sections/${sec.id}`, { name: 'Burgers', kind: 'food', availableFrom: null, availableTo: null, availableDays: [] })
  })
})

describe('#11 an 86 comes back at open', () => {
  test('the next opening is the kitchen\'s hours, else the bar\'s, else 5 AM', () => {
    const tz = 'America/Chicago'
    const hours = { ...EMPTY_HOURS, timezone: tz, kitchen: { tue: [{ open: '11:00', close: '21:00' }] } }
    // Monday 2026-11-02 23:00 local = Tuesday 05:00Z: the next kitchen opening is Tuesday 11:00 local = 17:00Z.
    expect(nextOpening(hours as any, tz, new Date('2026-11-03T05:00:00Z')).toISOString()).toBe('2026-11-03T17:00:00.000Z')
    expect(nextOpening({ ...EMPTY_HOURS, timezone: tz } as any, tz, new Date('2026-11-03T05:00:00Z')).toISOString()).toBe('2026-11-03T11:00:00.000Z')
  })

  test('put out until we open: off it is refused; on it stays out tonight and is back after an opening; a plain 86 stays out', async () => {
    const out = (id: string, body: object) => k.B('PUT', `/api/bar/menu/items/${id}/86`, body)
    await k.features(BASE)
    expect((await out(items.soda.id, { is86ed: true, untilOpen: true })).status).toBe(400)
    await k.features([...BASE, 'menu_dayparts'])
    const a = await out(items.soda.id, { is86ed: true, untilOpen: true })
    expect(a.status).toBe(200); expect(a.json.eightySixUntilOpen).toBe(true)
    const plain = await out(items.burger.id, { is86ed: true })
    expect(plain.json.eightySixUntilOpen).toBe(false)
    const is86 = async (id: string) => (await k.M('GET', '/api/bar/menu')).json.sections.flatMap((s: any) => s.items).find((i: any) => i.id === id).is86ed
    expect(await is86(items.soda.id)).toBe(true)
    // Last night, before an opening since: both were put out three days ago.
    const db = k.t.db as any
    await db.update(k.S.barMenuItem).set({ eightySixedAt: new Date(Date.now() - 3 * 86400000) }).where(eq(k.S.barMenuItem.companyId, k.companyId))
    expect(await is86(items.soda.id)).toBe(false)     // back at open
    expect(await is86(items.burger.id)).toBe(true)    // a plain 86 stays until someone puts it back
    // Put out again now: no opening has passed, so it stays.
    await out(items.soda.id, { is86ed: true, untilOpen: true })
    expect(await is86(items.soda.id)).toBe(true)
    // Off, an old "until open" does nothing by itself.
    await db.update(k.S.barMenuItem).set({ eightySixedAt: new Date(Date.now() - 3 * 86400000) }).where(eq(k.S.barMenuItem.id, items.soda.id))
    await k.features(BASE)
    expect(await is86(items.soda.id)).toBe(true)
    // The floor seat can put it out (bar:console) and the website and register see the reset on their next read.
    await k.features([...BASE, 'menu_dayparts'])
    const pubItems = async () => ((await k.pub('GET', '/api/public/bar/menu')).json.sections || []).flatMap((s: any) => s.items)
    expect((await pubItems()).find((i: any) => i.name === 'Soda')?.is86ed).toBeFalsy()
  })
})

describe('#13 the count by how full each open bottle is', () => {
  let rum = ''
  test('off it is refused; on, a bartender slides each open bottle and the quantity is the full ones plus the fills', async () => {
    rum = (await k.M('POST', '/api/stock/items', { name: 'Spiced rum', category: 'liquor', unit: 'each', packName: 'case', packSize: 12, packCostCents: 24000 })).json.item.id
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: rum, packs: 2, fills: [0.5] })).status).toBe(400)
    await k.features([...BASE, 'stock_fill_levels'])
    // A first count with nothing open: 24.
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: rum, packs: 2 })).json.qty).toBe(24)
    expect((await k.B('POST', '/api/stock/count/finish')).status).toBe(200)
    const r = await k.B('POST', '/api/stock/count/item', { stockItemId: rum, packs: 1, units: 0, fills: [0.8, 0.3] })
    expect(r.status).toBe(200); expect(r.json.qty).toBe(13.1)
    expect((await k.B('GET', '/api/stock/count')).json.count.lines.find((l: any) => l.stockItemId === rum).fills).toEqual([0.8, 0.3])
    // Between empty and full, at most 24 bottles.
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: rum, fills: [1.5] })).status).toBe(400)
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: rum, fills: [-0.1] })).status).toBe(400)
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: rum, fills: Array(25).fill(0.5) })).status).toBe(400)
  })
  test('the same variance reads it: 24 before, 13.1 now, nothing sold, nothing received', async () => {
    await new Promise((r) => setTimeout(r, 30))
    const fin = await k.B('POST', '/api/stock/count/finish')
    const report = await k.M('GET', `/api/stock/counts/${fin.json.count.id}/report`)
    const row = report.json.rows.find((x: any) => x.stockItemId === rum)
    expect(row).toMatchObject({ start: 24, end: 13.1, actual: 10.9, expected: 0, varianceUnits: 10.9 })
  })
  test('a count that clears an item clears its open bottles too', async () => {
    await k.B('POST', '/api/stock/count/item', { stockItemId: rum, packs: 1, fills: [0.4] })
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: rum, clear: true })).status).toBe(200)
    expect((await k.B('GET', '/api/stock/count')).json.count?.lines.find((l: any) => l.stockItemId === rum)).toBeUndefined()
  })
})
