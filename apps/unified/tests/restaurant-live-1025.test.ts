// The restaurant's live test (2026-10-25, Twomiah Live Test Bistro): the server's side of the fixes.
//   · an event's clash message and its BEO print the date in words, and its type, stage and department as words;
//   · the BEO tops each run-of-show cell, so a step's department sits beside its title;
//   · Reports' event tiles: the enquiries in the chosen period, and the book ahead by stage (what "booked ahead" counts);
//   · the public pages' tab titles; the unsubscribe page in no trade's words; long addresses wrap on every design.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { bootFood } from './foodKit.ts'
import { tabTitle } from '../server/http/adminScreens.ts'
import { siteStylesheet } from '../server/site/routes.ts'
import { SITE_DESIGNS } from '../server/core/vertical.ts'

let k: Awaited<ReturnType<typeof bootFood>>
const FEATURES = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'bar_menu', 'bar_register', 'bar_tonight']
let spaceId = ''
let harperId = ''

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: FEATURES })
  const sp = await k.O('POST', '/api/event-spaces', { name: 'Garden Room', capacitySeated: 40 })
  spaceId = sp.json.id
  const ev = await k.O('POST', '/api/events', { name: 'Harper Wedding Rehearsal', eventDate: '2026-11-20', spaceId, status: 'tentative', eventType: 'private_dining', guestCount: 35, startTime: '17:30', endTime: '22:00' })
  harperId = ev.json.id
}, 60_000)
afterAll(() => k.restore())

describe('event dates and codes in words', () => {
  test('a room clash names the day in words, not 2026-11-20', async () => {
    const clash = await k.O('POST', '/api/events', { name: 'Second party', eventDate: '2026-11-20', spaceId, status: 'tentative' })
    expect(clash.status).toBe(409)
    const msg = JSON.stringify(clash.json)
    expect(msg).toContain('Friday, November 20, 2026')
    expect(msg).not.toContain('2026-11-20')
  })

  test('the BEO prints the date, type, stage and department as words, each step on one row', async () => {
    expect((await k.O('POST', `/api/events/${harperId}/timeline`, { time: '18:00', title: 'Reception', department: 'floor', details: 'Starters passed at 18:30' })).status).toBe(201)
    const beo = await k.O('GET', `/api/events/${harperId}/beo`)
    expect(beo.status).toBe(200)
    expect(beo.text).toContain('Friday, November 20, 2026')
    expect(beo.text).toContain('>Private dining<')
    expect(beo.text).toContain('>Tentative<')
    expect(beo.text).not.toMatch(/>(tentative|private dining|2026-11-20)</)
    // The step, its details and its department in one row, the cells topped.
    expect(beo.text).toMatch(/<tr><td>18:00<\/td><td><strong>Reception<\/strong><span class="detail">Starters passed at 18:30<\/span><\/td><td class="dept">Floor<\/td><\/tr>/)
    expect(beo.text).toMatch(/table\.grid td,table\.grid th\{[^}]*vertical-align:top/)
  })
})

describe('Reports: the event tiles agree with the period and with each other', () => {
  test('enquiries in the asked period; the book ahead by stage', async () => {
    await k.O('POST', '/api/events', { name: 'Webb anniversary', eventDate: '2026-12-05' })
    const today = new Date().toISOString().slice(0, 10)
    const inPeriod = await k.O('GET', `/api/dashboard/stats?startDate=2020-01-01&endDate=${today}`)
    expect(inPeriod.status).toBe(200)
    const ev = inPeriod.json.events
    // Both events came in today; the tentative one is the book ahead ("booked ahead" counts it), none confirmed.
    expect(ev.enquiriesInPeriod).toBe(2)
    expect(ev.ahead).toEqual({ confirmed: 0, tentative: 1 })
    const before = await k.O('GET', '/api/dashboard/stats?startDate=2020-01-01&endDate=2020-12-31')
    expect(before.json.events.enquiriesInPeriod).toBe(0)
    // No period asked: no period figure.
    expect((await k.O('GET', '/api/dashboard/stats')).json.events.enquiriesInPeriod).toBeUndefined()
  })
})

describe('public pages are titled for their visitor', () => {
  test('the invoice link, the vendor portal and the home-care pages are not "· Admin"', () => {
    expect(tabTitle('/d/abc123', 'Twomiah Live Test Bistro')).toBe('Twomiah Live Test Bistro — Your quote or invoice')
    expect(tabTitle('/vendor/abc', 'Bistro')).toBe('Bistro — Vendor portal')
    expect(tabTitle('/pay/abc', 'Care Co')).toBe('Care Co — Pay your invoice')
    expect(tabTitle('/portal/abc', 'Bistro')).toBe('Bistro — Customer portal')
    expect(tabTitle('/crm/invoices', 'Bistro')).toBe('Bistro')
  })

  test('the unsubscribe page speaks no trade', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dir, '../../../packages/tenant-backend/src/marketing/marketing.ts'), 'utf8')
    expect(src).not.toContain('your jobs, quotes and invoices')
  })
})

describe('a long email address never widens a phone screen', () => {
  for (const design of SITE_DESIGNS) {
    test(`${design}: email links and contact values break; their grid cells can shrink`, () => {
      const sheet = siteStylesheet({ design, colours: { primary: '#1d4ed8', accent: null, secondary: null }, options: { cover: design === 'bar', shop: false } } as any)
      expect(sheet).toMatch(/a\[href\^="mailto:"\][^{]*\.contact-section__value[^{]*\{ overflow-wrap: anywhere; \}/)
      expect(sheet).toMatch(/\.contact-section__grid > \*, \.contact-section__row > \* \{ min-width: 0; \}/)
    })
  }
})
