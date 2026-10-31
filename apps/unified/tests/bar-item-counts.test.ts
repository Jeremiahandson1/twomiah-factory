// An item count that counts down and refreshes (restaurant-bar parity row 13, Toast). On the real server: staff set
// "12 left"; each sale takes one (the register, and a website order); at zero the item 86es itself; a void gives the count
// back and puts it back on; the count comes back to its refresh figure at the next opening, or when staff set it; the
// register and online menus carry the figure. Fails without the change: no /count route, no stock_count column.
import { describe, test, expect, beforeAll, afterAll, setSystemTime } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { countRefusal, resetCountsAtOpen } from '../server/crm/bar/menuDay.ts'
import { EMPTY_HOURS } from '../server/crm/bar/barHours.ts'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
const BASE = ['contacts', 'invoices', 'dashboard', 'bar_menu', 'bar_register', 'bar_tonight', 'online_ordering']
const burgerOnRegister = async () => (await k.B('GET', '/api/register/state')).json.menu.flatMap((s: any) => s.items).find((i: any) => i.id === items.burger.id)

describe('item counts', () => {
  beforeAll(async () => { k = await bootFood({ features: BASE }); items = await k.menu() }, 120_000)
  afterAll(() => { k?.restore(); setSystemTime() })

  test('the figures are checked in words', () => {
    expect(countRefusal({ stockCount: -1 })).toContain('How many are left')
    expect(countRefusal({ stockCount: 3.5 })).toContain('whole number')
    expect(countRefusal({ stockCountReset: 'many' })).toContain('refreshes to')
    expect(countRefusal({ stockCount: 12, stockCountReset: null })).toBeNull()
  })

  test('off it is refused; on, a bartender sets the count, each sale takes one, and at zero the item 86es itself on the register and online', async () => {
    expect((await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/count`, { stockCount: 2 })).json.error).toContain('not switched on')
    await k.features([...BASE, 'menu_item_counts'])
    expect((await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/count`, { stockCount: -1 })).status).toBe(400)
    const set = await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/count`, { stockCount: 2, stockCountReset: 5 })
    expect(set.status).toBe(200); expect(set.json).toMatchObject({ stockCount: 2, stockCountReset: 5, is86ed: false })
    expect((await burgerOnRegister()).stockCount).toBe(2)
    expect(JSON.stringify((await k.pub('GET', '/api/public/food/ordering')).json)).toContain('"stockCount":2')
    const chk = (await k.B('POST', '/api/register/check', { kind: 'walkup', label: 'Counter' })).json.check
    expect((await k.B('POST', `/api/register/check/${chk.id}/items`, { menuItemId: items.burger.id })).status).toBe(200)
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 1, is86ed: false })
    expect((await k.B('POST', `/api/register/check/${chk.id}/items`, { menuItemId: items.burger.id })).status).toBe(200)
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 0, is86ed: true })
    // Sold out: the register refuses the next one in the words it always used for an 86.
    const refused = await k.B('POST', `/api/register/check/${chk.id}/items`, { menuItemId: items.burger.id })
    expect(refused.status).toBeGreaterThanOrEqual(400); expect(JSON.stringify(refused.json)).toContain("86'd")
    // A held line taken off gives one back and the item comes back on; a quantity raised takes the difference.
    const lines = (await k.B('GET', `/api/register/check/${chk.id}`)).json.check.items.filter((i: any) => i.menuItemId === items.burger.id)
    expect((await k.B('PATCH', `/api/register/item/${lines[0].id}`, { qty: 0 })).status).toBe(200)
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 1, is86ed: false })
    expect((await k.B('PATCH', `/api/register/item/${lines[1].id}`, { qty: 2 })).status).toBe(200)
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 0, is86ed: true })
    expect((await k.B('PATCH', `/api/register/item/${lines[1].id}`, { qty: 1 })).status).toBe(200)
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 1, is86ed: false })
  })

  test('a hand-set count puts a count-86 back; a hand 86 is left alone by the count', async () => {
    await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/count`, { stockCount: 0 })
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 0, is86ed: true })
    await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/count`, { stockCount: 3 })
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 3, is86ed: false })
    // 86ed by hand with a count left: the count does not bring it back on its own.
    await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/86`, { is86ed: true })
    await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/count`, { stockCount: 4 })
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 4, is86ed: true })
    await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/86`, { is86ed: false })
    // Stop counting: no figure, and nothing happens on a sale.
    expect((await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/count`, { stockCount: null })).json).toMatchObject({ stockCount: null, stockCountReset: null })
    expect((await burgerOnRegister()).stockCount).toBeNull()
  })

  test('the count comes back to its refresh figure at the next opening (5 AM with no hours set), and the item with it', async () => {
    await k.B('PUT', `/api/bar/menu/items/${items.burger.id}/count`, { stockCount: 0, stockCountReset: 6 })
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 0, is86ed: true })
    // It was set at 9 PM on a Monday in Eau Claire (pinned on the row, so the clock need not move and the sign-ins stand).
    await (k.t.db as any).update(k.S.barMenuItem).set({ stockCountedAt: new Date('2026-11-03T03:00:00Z') }).where(eq(k.S.barMenuItem.id, items.burger.id))
    const hours = { ...EMPTY_HOURS, timezone: 'America/Chicago' } as any
    // Still the same night (midnight): nothing.
    expect(await resetCountsAtOpen(k.t.db, k.companyId, hours, new Date('2026-11-03T06:00:00Z'))).toBe(0)
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 0, is86ed: true })
    // Past 5 AM (6 AM): refreshed and back on - the same pass the menu's every read runs.
    expect(await resetCountsAtOpen(k.t.db, k.companyId, hours, new Date('2026-11-03T12:00:00Z'))).toBe(1)
    expect(await burgerOnRegister()).toMatchObject({ stockCount: 6, is86ed: false })
    // Once per opening: refreshed at 6 AM, it is not refreshed again at 6:30.
    expect(await resetCountsAtOpen(k.t.db, k.companyId, hours, new Date('2026-11-03T12:30:00Z'))).toBe(0)
    // Switched off, the pass does nothing and the count is just a number nobody moves.
    await k.features(BASE)
    expect(await resetCountsAtOpen(k.t.db, k.companyId, hours, new Date('2026-11-04T12:00:00Z'))).toBe(0)
  })
})
