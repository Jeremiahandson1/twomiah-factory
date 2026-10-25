// Restaurants (and the food trucks routed to them) get the bar's food side (verticals/restaurant/settings.ts,
// featureRegistry crm-restaurant): the menu, the register and grill, the kitchen's hours, and where switched on the
// card reader, the kiosk and online ordering — keeping the private-events side; the bar-only parts stay out until
// switched on: long tabs (Register Settings) and draft taps (draft_taps, on the server as well as in the menu).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { loadVertical } from '../server/core/vertical.ts'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
const FEATURES = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'catering_menus', 'bar_menu', 'bar_register', 'bar_tonight', 'card_reader', 'order_kiosk', 'online_ordering']

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: FEATURES })
  await (k.t.db as any).update(k.S.company).set({ settings: { defaultTaxRate: 5.5 } }).where(eq(k.S.company.id, k.companyId))
  items = await k.menu()
}, 60_000)
afterAll(() => k.restore())

describe('a restaurant has the food side', () => {
  test('Settings › Features offers it; the bar\'s menu, register and hours are not forced on (opt-in here), and draft taps are offered', async () => {
    const cat = await k.O('GET', '/api/company/features/catalog')
    const byId = Object.fromEntries(cat.json.features.map((f: any) => [f.id, f]))
    for (const f of ['bar_menu', 'bar_register', 'bar_tonight', 'card_reader', 'order_kiosk', 'online_ordering', 'draft_taps', 'event_bookings']) expect(byId[f]).toBeTruthy()
    expect([byId.bar_menu.core, byId.bar_register.core, byId.bar_tonight.core]).toEqual([false, false, false])
    // The bar-only parts a restaurant has never had stay off it: stock, the schedule.
    expect(byId.bar_stock).toBeUndefined()
    // A save without the register leaves it off (a core feature would be forced back on).
    const saved = await k.O('PUT', '/api/company/features', { features: ['contacts', 'invoices', 'dashboard', 'event_bookings'] })
    expect(saved.status).toBe(200)
    const [co] = await (k.t.db as any).select({ f: k.S.company.enabledFeatures }).from(k.S.company).where(eq(k.S.company.id, k.companyId))
    expect(co.f).not.toContain('bar_register')
    expect(co.f).not.toContain('bar_menu')
    await k.features(FEATURES)
  })

  test('the register rings walk-ups and tables; long tabs are off until the owner turns them on', async () => {
    const state = await k.B('GET', '/api/register/state')
    expect(state.json.tabs).toBe(false)
    expect((await k.B('POST', '/api/register/check', { kind: 'tab', label: 'Mike' })).status).toBe(403)
    const t = await k.B('POST', '/api/register/check', { kind: 'table', spot: 'Table 4' })
    expect(t.status).toBe(200)
    expect((await k.B('POST', `/api/register/check/${t.json.check.id}/items`, { menuItemId: items.burger.id, modifierIds: ['modnoonion'] })).status).toBe(200)
    expect((await k.B('POST', `/api/register/check/${t.json.check.id}/send`, {})).status).toBe(200)
    const grill = (await k.B('GET', '/api/grill/state')).json.open
    expect(grill.map((x: any) => [x.label, x.source, x.items[0].note])).toEqual([['Table 4', 'table', 'No onions']])
    expect((await k.M('PUT', '/api/food/settings', { tabs: true })).status).toBe(200)
    expect((await k.B('POST', '/api/register/check', { kind: 'tab', label: 'Mike' })).status).toBe(200)
  })

  test('draft taps: closed on the server without draft_taps, open with it', async () => {
    expect((await k.M('GET', '/api/bar/taps')).status).toBe(403)
    expect((await k.M('POST', '/api/bar/taps', { lineNumber: 1, beerName: 'Spotted Cow', price: '6' })).status).toBe(403)
    await k.features([...FEATURES, 'draft_taps'])
    expect((await k.M('POST', '/api/bar/taps', { lineNumber: 1, beerName: 'Spotted Cow', price: '6' })).status).toBe(201)
    await k.features(FEATURES)
  })

  test('the kiosk, the reader, the hours and online ordering work here as at the bar', async () => {
    expect((await k.M('PUT', '/api/register/pin', { pin: '2468' })).status).toBe(200)
    expect((await k.B('POST', '/api/food/kiosk/unlock', { pin: '2468' })).status).toBe(200)
    const r = await k.B('POST', '/api/food/kiosk/order', { name: 'Ana', pay: 'counter', lines: [{ menuItemId: items.soda.id }] })
    expect(r.json.order.status).toBe('at_counter')
    expect((await k.M('POST', '/api/food/readers', { code: 'simulated-wpe', label: 'Counter' })).status).toBe(200)
    expect((await k.M('PUT', '/api/bar/tonight', { kitchenOpen: true, kitchenClosesAt: new Date(Date.now() + 3 * 3600_000).toISOString() })).status).toBe(200)
    const a = await k.pub('GET', '/api/public/food/ordering')
    expect(a.json.open).toBe(true)
    expect((await k.pub('GET', '/order')).status).toBe(200)
  })

  test('the private-events side is still there, and the screens say a restaurant\'s words', async () => {
    expect((await k.O('GET', '/api/events')).status).toBe(200)
    const v = await loadVertical('restaurant')
    expect(v.crm?.foodService).toEqual({ tabs: false, tapsFeature: 'draft_taps' })
    expect((v.screens as any).navFeatures['/crm/taps']).toEqual(['draft_taps'])
    expect((v.screens as any).foodService).toEqual({ speakeasy: false, bar: false })
    expect((v.screens as any).navSections['The Bar']).toBe('Kitchen & Counter')
  })
})
