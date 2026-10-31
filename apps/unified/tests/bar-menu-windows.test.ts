// Several time windows per menu section (restaurant-bar parity row 12, Toast): breakfast, lunch, happy hour, late night,
// each with its own days. The rule (pure), then the real server: a section with two windows is served in either; outside
// both it leaves the website menu, online ordering and the register's picker (the kiosk reads the same), and the register
// refuses a line from it. Fails without the change: bar_menu_section has no available_windows, and windowRefusal refuses the list.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { bootFood } from './foodKit.ts'
import { allWindows, cleanWindows, servedAt, windowRefusal, windowWords } from '../server/crm/bar/menuDay.ts'
import { createBarLive } from '../server/crm/bar/barLive.ts'
import { localParts } from '../server/crm/bar/barHours.ts'

const hhmm = (mins: number) => { const m = ((mins % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
const HR = 60

describe('the rule', () => {
  const tz = 'America/Chicago'   // 2026-11-02 is a Monday; UTC-6 in November
  const at = (iso: string) => new Date(iso)
  test('a section is served in any of its windows, each with its own days; the first window is the old three columns', () => {
    const s = { availableFrom: '11:00', availableTo: '15:00', availableDays: [1, 2, 3, 4, 5], availableWindows: [{ from: '16:00', to: '18:00', days: [] }, { from: '22:00', to: '02:00', days: [5] }] }
    expect(allWindows(s).length).toBe(3)
    expect(servedAt(s, at('2026-11-02T18:00:00Z'), tz)).toBe(true)    // Monday noon: lunch
    expect(servedAt(s, at('2026-11-02T22:30:00Z'), tz)).toBe(true)    // Monday 16:30: happy hour, every day
    expect(servedAt(s, at('2026-11-01T22:30:00Z'), tz)).toBe(true)    // Sunday 16:30: happy hour (lunch is weekdays only)
    expect(servedAt(s, at('2026-11-03T01:00:00Z'), tz)).toBe(false)   // Monday 19:00: after happy hour, no late night on a Monday
    expect(servedAt(s, at('2026-11-07T07:00:00Z'), tz)).toBe(true)    // Saturday 01:00: Friday's late night
    expect(servedAt(s, at('2026-11-08T07:00:00Z'), tz)).toBe(false)   // Sunday 01:00: Saturday had no late night
    expect(windowWords(s)).toBe('Served 11:00 to 15:00 Mon, Tue, Wed, Thu, Fri; 16:00 to 18:00; 22:00 to 02:00 Fri')
    // Only extra windows, no first: still windows.
    expect(servedAt({ availableFrom: null, availableTo: null, availableDays: [], availableWindows: [{ from: '09:00', to: '11:00', days: [] }] }, at('2026-11-02T15:30:00Z'), tz)).toBe(true)
    expect(servedAt({ availableFrom: null, availableTo: null, availableDays: [], availableWindows: [{ from: '09:00', to: '11:00', days: [] }] }, at('2026-11-02T18:00:00Z'), tz)).toBe(false)
  })
  test('the list is checked in words and cleaned', () => {
    expect(windowRefusal({ availableWindows: [{ from: '16:00' }] })).toMatch(/first and a last/)
    expect(windowRefusal({ availableWindows: [{ from: '16:00', to: '16:00' }] })).toMatch(/longer/)
    expect(windowRefusal({ availableWindows: [{ from: '16:00', to: '18:00', days: [9] }] })).toMatch(/0 \(Sunday\)/)
    expect(windowRefusal({ availableWindows: 'x' })).toMatch(/list/)
    expect(windowRefusal({ availableWindows: Array.from({ length: 8 }, () => ({ from: '1:00', to: '2:00' })) })).toMatch(/Up to 8/)
    expect(windowRefusal({ availableFrom: '11:00', availableTo: '15:00', availableWindows: [{ from: '22:00', to: '02:00', days: [5, 5] }] })).toBeNull()
    expect(cleanWindows([{ from: '22:00', to: '02:00', days: [5, 5, '6'] }, { from: 'x' }])).toEqual([{ from: '22:00', to: '02:00', days: [5, 6] }])
  })
})

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
const BASE = ['contacts', 'invoices', 'dashboard', 'bar_menu', 'bar_register', 'bar_tonight', 'online_ordering']

describe('on the real server', () => {
  beforeAll(async () => { k = await bootFood({ features: [...BASE, 'menu_dayparts'] }); items = await k.menu() }, 120_000)
  afterAll(() => k?.restore())

  test('two windows: served in either; outside both the section leaves the website, online ordering and the register, and cannot be rung', async () => {
    const sec = (await k.M('GET', '/api/bar/menu')).json.sections.find((s: any) => s.name === 'Burgers')
    const tz = (await createBarLive(k.t.db as any).hoursFor(k.companyId)).timezone || 'America/Chicago'
    const p = localParts(new Date(), tz), now = p.h * 60 + p.mi
    const put = (first: [string, string], extra: Array<[string, string]>) => k.M('PUT', `/api/bar/menu/sections/${sec.id}`, { name: 'Burgers', kind: 'food', availableFrom: first[0], availableTo: first[1], availableDays: [], availableWindows: extra.map(([from, to]) => ({ from, to, days: [] })) })
    const onWebsite = async () => JSON.stringify((await k.pub('GET', '/api/public/bar/menu')).json).includes('Burgers')
    const onOnline = async () => JSON.stringify((await k.pub('GET', '/api/public/food/ordering')).json).includes('Burgers')
    const onRegister = async () => (await k.B('GET', '/api/register/state')).json.menu.some((s: any) => s.name === 'Burgers')
    // First window long gone (6 to 5 hours ago), the second around now: served by the second.
    expect((await put([hhmm(now - 6 * HR), hhmm(now - 5 * HR)], [[hhmm(now - HR), hhmm(now + HR)]])).status).toBe(200)
    expect(await onWebsite()).toBe(true); expect(await onOnline()).toBe(true); expect(await onRegister()).toBe(true)
    // Both windows away from now: gone everywhere, and the register says so with both windows in words.
    expect((await put([hhmm(now - 6 * HR), hhmm(now - 5 * HR)], [[hhmm(now + 2 * HR), hhmm(now + 3 * HR)]])).status).toBe(200)
    expect(await onWebsite()).toBe(false); expect(await onOnline()).toBe(false); expect(await onRegister()).toBe(false)
    const chk = await k.B('POST', '/api/register/check', { kind: 'walkup', label: 'Late' })
    const refused = await k.B('POST', `/api/register/check/${chk.json.check.id}/items`, { menuItemId: items.burger.id })
    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(refused.json)).toMatch(/not being served/); expect(JSON.stringify(refused.json)).toContain(hhmm(now + 2 * HR))
    // The manager's own list keeps every window, to change; a bad list is refused in words; the feature off serves it all day.
    const mine = (await k.M('GET', '/api/bar/menu')).json.sections.find((s: any) => s.id === sec.id)
    expect(mine.availableWindows).toEqual([{ from: hhmm(now + 2 * HR), to: hhmm(now + 3 * HR), days: [] }])
    expect((await k.M('PUT', `/api/bar/menu/sections/${sec.id}`, { name: 'Burgers', kind: 'food', availableWindows: [{ from: '16:00' }] })).json.error).toMatch(/first and a last/)
    await k.features(BASE)
    expect(await onWebsite()).toBe(true)
  })
})
