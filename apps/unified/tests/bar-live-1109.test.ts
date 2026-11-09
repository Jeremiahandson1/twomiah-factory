// The bar live test, 2026-11-09 (Chrome Test Tap): the findings, on the real server.
//   · a manager's void of a sent line on a check still open at close counts on that night's close-out and on Reports;
//   · the week grid says when no opening hours are set (every day read Closed, with no reason given);
//   · a bartender reads their own tip nights (GET /api/tips/mine) and the Tips menu item is theirs to open;
//   · the first-run wizard of a bar and a restaurant asks for the opening hours first.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { bootFood } from './foodKit.ts'
import { loadVertical } from '../server/core/vertical.ts'
import { readFileSync } from 'node:fs'

const BASE = ['contacts', 'invoices', 'dashboard', 'bar_menu', 'bar_register', 'bar_tonight', 'bar_schedule', 'bar_tip_pooling', 'time_tracking', 'team', 'reports']
let k: Awaited<ReturnType<typeof bootFood>>
let items: { burger: any; soda: any }

beforeAll(async () => {
  k = await bootFood({ vertical: 'bar', features: BASE })
  items = await k.menu()
}, 60_000)
afterAll(() => k?.restore())

describe('voids are counted on the night they were made', () => {
  test("a manager's void of a sent line on a check still open shows on the close-out and on Reports", async () => {
    const id = (await k.B('POST', '/api/register/check', { kind: 'tab', label: 'Mike' })).json.check.id as string
    expect((await k.B('POST', `/api/register/check/${id}/items`, { menuItemId: items.burger.id })).status).toBe(200)
    expect((await k.B('POST', `/api/register/check/${id}/send`, {})).status).toBe(200)
    const line = (await k.B('GET', `/api/register/check/${id}`)).json.check.items[0]
    expect((await k.M('POST', `/api/register/item/${line.id}/void`, { reason: 'Sent back' })).status).toBe(200)
    // The check stays open: before 0106 its void waited for the check to close and was left off tonight's figures.
    expect((await k.M('GET', `/api/register/check/${id}`)).json.check.status).toBe('open')
    const night = (await k.M('GET', '/api/register/day')).json
    const v = night.summary.voids.find((x: any) => x.kind === 'item' && x.what.includes('Burger'))
    expect(v).toBeTruthy()
    expect(v.reason).toBe('Sent back')
    expect(v.amountCents).toBe(1200)
    const report = (await k.M('GET', `/api/register/report?from=${night.day}&to=${night.day}`)).json.report
    expect(report.voids.count).toBeGreaterThanOrEqual(1)
    expect(report.voids.amountCents).toBeGreaterThanOrEqual(1200)
  })
})

describe('a card run on another machine', () => {
  test('is "Card (own machine)" by tender on the night, never "Card (reader)"', async () => {
    const id = (await k.B('POST', '/api/register/check', { kind: 'walkup' })).json.check.id as string
    expect((await k.B('POST', `/api/register/check/${id}/items`, { menuItemId: items.soda.id })).status).toBe(200)
    const owed = (await k.B('GET', `/api/register/check/${id}`)).json.check.totals.balanceCents
    expect((await k.B('POST', `/api/register/check/${id}/pay`, { tender: 'card_external', amountCents: owed })).status).toBe(200)
    const t = (await k.M('GET', '/api/register/day')).json.summary.byTender.find((x: any) => x.tender === 'card_external')
    expect(t.label).toBe('Card (own machine)')
    expect(t.amountCents).toBe(owed)
  })
})

describe('the week grid with no opening hours', () => {
  test('says the hours are not set; once they are, it does not', async () => {
    expect((await k.M('GET', '/api/schedule/week')).json.hoursSet).toBe(false)
    const day = [{ open: '11:00', close: '02:00' }]
    const week = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }
    expect((await k.O('PUT', '/api/bar/settings', { hours: { bar: week, kitchen: {}, holidays: [] } })).status).toBe(200)
    const w = (await k.M('GET', '/api/schedule/week')).json
    expect(w.hoursSet).toBe(true)
    expect(w.forecastDays.open).toBe(7)
  })
})

describe("a bartender's own tips", () => {
  test('GET /api/tips/mine answers the bartender with their own nights; the Tips menu item asks only the register', async () => {
    const r = await k.B('GET', '/api/tips/mine?from=2026-11-01&to=2026-11-30')
    expect(r.status).toBe(200)
    expect(r.json.nights).toEqual([])
    expect((await k.B('GET', '/api/tips/report?from=2026-11-01&to=2026-11-30')).status).toBe(403)
    // Read as text: the menu file pulls in the map library, which needs a browser.
    const navSrc = readFileSync(new URL('../web/src/crm/verticals/bar.tsx', import.meta.url), 'utf8')
    expect(navSrc.split('\n').find((l) => l.includes("to: '/crm/tips'"))).toContain("permission: 'bar:register'")
  })
})

describe('the first-run wizard', () => {
  test('a bar and a restaurant are asked for their opening hours first, on the page that keeps them', async () => {
    for (const v of ['bar', 'restaurant']) {
      const ob = ((await loadVertical(v)).screens as any).onboarding
      expect(ob.integrations[0]).toBe('food_hours')
      const hours = ob.extra.find((x: any) => x.id === 'food_hours')
      expect(hours.category).toBe('hours')
      expect(hours.open.to).toBe('/crm/bar-settings')
    }
  })
})
