// The restaurant live test, 2026-11-09 (Chrome Test Kitchen): each finding, on the real server, failing without its fix.
//   · the Staff Schedule reads the kitchen's hours when there are no bar hours (every day said "Closed", no gaps or labor %);
//   · a restaurant is offered the time clock (Time Tracking), with each person's hourly rate on Team;
//   · Migrate Data lists a restaurant's systems (Toast, Square, Tripleseat…), not Jobber;
//   · per-person lines and the invoice follow the guaranteed count; a booked client stops being a "Lead";
//   · the waitlist is joined from an enquiry, with the client's email; a hand-sent reminder is remembered;
//   · a new menu section goes to the end; a shift a person could not take is not offered to them;
//   · the website shows Tonight under the hero, and a rename rewrites the old name in the site's pages.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { getFeaturesForTemplate } from '@twomiah/tenant-backend'
import { staffedHours, openOn, coverageGaps } from '../server/crm/bar/barSchedulePlan.ts'
import { getAvailableProviders } from '../server/crm/office/migrationService.ts'
import { renameInSite } from '../server/modules/company.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore } from '../server/crm/restaurant/eventGuarantee.ts'
import restaurant from '../verticals/restaurant/settings.ts'
import landscaping from '../verticals/landscaping/settings.ts'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'event_calendar', 'bar_menu', 'bar_register', 'bar_tonight', 'bar_schedule', 'bar_shift_swaps', 'time_tracking', 'event_payment_automation']
let k: Awaited<ReturnType<typeof bootFood>>
let today = ''

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: BASE })
  today = await venueToday(k.t.db, k.companyId)
}, 60_000)
afterAll(() => k?.restore())

describe('the schedule against a kitchen-only restaurant', () => {
  test('no bar hours: the kitchen hours are the ones staffed', () => {
    const cfg: any = { timezone: 'America/Chicago', bar: {}, kitchen: { tue: [{ open: '11:00', close: '21:00' }] } }
    const tue = '2026-11-10'
    expect(openOn(cfg, tue)).toBeNull()
    expect(openOn(staffedHours(cfg), tue)).toBe('11:00')
    expect(coverageGaps(staffedHours(cfg), [tue], [{ userId: 'u', day: tue, start: '16:00', end: '21:00' }], 'America/Chicago')).toEqual([{ day: tue, from: '11:00', to: '16:00', minutes: 300 }])
    // A bar with its own hours is unchanged.
    const bar: any = { ...cfg, bar: { tue: [{ open: '15:00', close: '23:00' }] } }
    expect(staffedHours(bar)).toBe(bar)
  })

  test('the week shows the kitchen day open on the real server', async () => {
    await (k.t.db as any).insert(k.S.barSettings).values({ companyId: k.companyId, hours: { bar: {}, kitchen: { mon: [{ open: '11:00', close: '21:00' }], tue: [{ open: '11:00', close: '21:00' }], wed: [{ open: '11:00', close: '21:00' }], thu: [{ open: '11:00', close: '21:00' }], fri: [{ open: '11:00', close: '21:00' }], sat: [{ open: '11:00', close: '21:00' }], sun: [{ open: '11:00', close: '21:00' }] } } })
      .onConflictDoUpdate({ target: k.S.barSettings.companyId, set: { hours: { bar: {}, kitchen: { mon: [{ open: '11:00', close: '21:00' }], tue: [{ open: '11:00', close: '21:00' }], wed: [{ open: '11:00', close: '21:00' }], thu: [{ open: '11:00', close: '21:00' }], fri: [{ open: '11:00', close: '21:00' }], sat: [{ open: '11:00', close: '21:00' }], sun: [{ open: '11:00', close: '21:00' }] } } } })
    const w = (await k.M('GET', `/api/schedule/week?day=${today}`)).json
    expect(w.bar[today]).toEqual({ open: '11:00', close: '21:00' })
    expect(w.gaps.length).toBeGreaterThan(0)
    expect(w.forecastDays.open).toBe(7)
  })
})

describe('the clock, pay rates and migration for a restaurant', () => {
  test('Time Tracking is offered; Team has the hourly rate; the work week is shown', () => {
    expect(getFeaturesForTemplate('crm-restaurant').map((f: any) => f.id)).toContain('time_tracking')
    expect((restaurant.screens as any).team.hourlyRate).not.toBe(false)
    expect((restaurant.screens as any).settings.workWeek).not.toBe(false)
  })

  test('the clock-in by PIN works on a restaurant tenant', async () => {
    expect((await k.B('GET', '/api/register/clock')).status).toBe(200)
  })

  test("Migrate Data: a restaurant's systems; the trades keep theirs", async () => {
    const mine = (await k.O('GET', '/api/migration/providers')).json.data.map((p: any) => p.id)
    expect(mine).toEqual(expect.arrayContaining(['toast', 'square', 'clover', 'tripleseat', 'perfect_venue', 'opentable']))
    expect(mine).not.toContain('jobber')
    expect(getAvailableProviders().map((p) => p.id)).toEqual(['jobber', 'servicetitan', 'housecallpro', 'buildertrend', 'fieldedge', 'kickserv'])
    expect((landscaping as any).crm.migration).toBeUndefined()
  })
})

describe('events: the guarantee bills, the booked client, the waitlist', () => {
  let clientId = '', roomId = '', ev: any
  const day = () => dayBefore(today, -40)
  beforeAll(async () => {
    clientId = (await k.O('POST', '/api/contacts', { name: 'Gwen Guest', email: 'gwen@guest.test', phone: '7155550123', type: 'lead' })).json.id
    roomId = (await k.O('POST', '/api/event-spaces', { name: 'Back Room', seatedCapacity: 40 })).json.id
    const pkg = (await k.O('POST', '/api/menu-packages', { name: 'Dinner Package', pricePerPerson: 65, minGuests: 10 })).json
    ev = (await k.O('POST', '/api/events', { name: 'Birthday', contactId: clientId, eventDate: day(), spaceId: roomId, guestCount: 30, status: 'enquiry' })).json
    expect((await k.O('POST', `/api/events/${ev.id}/menu`, { packageId: pkg.id })).status).toBeLessThan(300)
    expect((await k.O('POST', `/api/events/${ev.id}/menu`, { name: 'Cake cutting', perPerson: false, quantity: 1, unitPrice: 50 })).status).toBeLessThan(300)
  })

  test('the guaranteed count moves the per-person line, not the flat one, and the client becomes a client when booked', async () => {
    expect((await k.O('PUT', `/api/events/${ev.id}`, { status: 'confirmed' })).status).toBe(200)
    const [ct] = await (k.t.db as any).select().from(k.S.contact).where(eq(k.S.contact.id, clientId))
    expect(ct.type).toBe('client')
    expect((await k.O('PUT', `/api/events/${ev.id}`, { guestCountFinal: 26 })).status).toBe(200)
    const lines = await (k.t.db as any).select().from(k.S.eventMenuItem).where(eq(k.S.eventMenuItem.eventId, ev.id))
    expect(lines.find((l: any) => l.perPerson).quantity).toBe(26)
    expect(lines.find((l: any) => !l.perPerson).quantity).toBe(1)
    // Under the package minimum: billed at the minimum, and back up with the count.
    await k.O('PUT', `/api/events/${ev.id}`, { guestCountFinal: 8 })
    let pp = (await (k.t.db as any).select().from(k.S.eventMenuItem).where(eq(k.S.eventMenuItem.eventId, ev.id))).find((l: any) => l.perPerson)
    expect(pp.quantity).toBe(10); expect(pp.notes).toMatch(/minimum \(8 entered\)/)
    await k.O('PUT', `/api/events/${ev.id}`, { guestCountFinal: 26 })
    pp = (await (k.t.db as any).select().from(k.S.eventMenuItem).where(eq(k.S.eventMenuItem.eventId, ev.id))).find((l: any) => l.perPerson)
    expect(pp.quantity).toBe(26)
  })

  test("a second enquiry for the held room joins the waitlist with its client's email", async () => {
    const otherId = (await k.O('POST', '/api/contacts', { name: 'Wren Waiting', email: 'wren@guest.test', type: 'lead' })).json.id
    const r = await k.O('POST', '/api/event-waitlist', { spaceId: roomId, eventDate: day(), contactId: otherId, name: 'Wren Waiting' })
    expect(r.status).toBe(201)
    expect(r.json.email).toBe('wren@guest.test')
  })

  test('a reminder sent by hand is remembered on the instalment', async () => {
    await k.O('POST', `/api/events/${ev.id}/payments`, { label: 'Deposit', amount: 500, dueDate: dayBefore(today, -5) })
    const before = (await k.O('GET', `/api/event-payments/${ev.id}`)).json
    const inst = (before.instalments || before.data?.instalments)[0]
    expect(inst.remindedManualAt).toBeNull()
    expect((await k.O('POST', `/api/event-payments/${ev.id}/remind/${inst.id}`)).status).toBe(200)
    const after = (await k.O('GET', `/api/event-payments/${ev.id}`)).json
    expect((after.instalments || after.data?.instalments)[0].remindedManualAt).toBeTruthy()
  })
})

describe('the menu, the swaps, the website', () => {
  test('a new section goes to the end of the menu', async () => {
    await k.O('POST', '/api/bar/menu/sections', { name: 'Mains', kind: 'food' })
    await k.O('POST', '/api/bar/menu/sections', { name: 'Dinner Only', kind: 'food' })
    const names = (await k.O('GET', '/api/bar/menu')).json.sections.map((s: any) => s.name)
    expect(names.indexOf('Dinner Only')).toBeGreaterThan(names.indexOf('Mains'))
  })

  test('a shift given away is not offered to someone already working those hours', async () => {
    const day = dayBefore(today, -3)
    const a = (await k.M('POST', '/api/schedule/shifts', { userId: k.ids.bartender, day, start: '16:00', end: '22:00' })).json
    await k.M('POST', '/api/schedule/shifts', { userId: k.ids.manager, day, start: '16:00', end: '22:00' })
    await k.M('POST', '/api/schedule/publish', { day })
    const shiftId = a.shift?.id || a.id
    expect((await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId })).status).toBeLessThan(300)
    expect((await k.M('GET', '/api/schedule/swaps/mine')).json.onOffer.length).toBe(0)
  })

  test('Tonight shows under the home hero; a rename rewrites the site', async () => {
    await (k.t.db as any).insert(k.S.website).values({ companyId: k.companyId, tagline: 'Old Name Grill, on Water St' })
    await (k.t.db as any).insert(k.S.page).values({ companyId: k.companyId, slug: 'home', title: 'Home', isPublished: true, navOrder: 0,
      sections: [{ type: 'hero', variant: 'textled', data: { title: 'Welcome to Old Name Grill' } }, { type: 'cta', variant: 'banner', data: { heading: 'Talk to Old Name Grill' } }] })
    await k.O('PUT', '/api/bar/tonight', { kitchenOpen: true, roomStatus: 'filling', note: 'Patio open' })
    await k.O('POST', '/api/bar/specials', { title: 'Walleye Basket', price: '$13' })
    const html = (await k.pub('GET', '/')).text
    expect(html).toContain('tonight-strip')
    expect(html).toContain('Open now'); expect(html).toContain('Patio open'); expect(html).toContain('Walleye Basket')
    expect(html.indexOf('Welcome to Old Name Grill')).toBeLessThan(html.indexOf('tonight-strip'))

    expect(await renameInSite(k.t.db, k.companyId, 'Old Name Grill', 'Chrome Test Kitchen')).toBe(2)
    const [p] = await (k.t.db as any).select().from(k.S.page).where(eq(k.S.page.companyId, k.companyId))
    expect(JSON.stringify(p.sections)).toContain('Welcome to Chrome Test Kitchen')
    expect(JSON.stringify(p.sections)).not.toContain('Old Name Grill')
    const [w] = await (k.t.db as any).select().from(k.S.website).where(eq(k.S.website.companyId, k.companyId))
    expect(w.tagline).toBe('Chrome Test Kitchen, on Water St')
    // Through the company save itself.
    await (k.t.db as any).update(k.S.company).set({ name: 'Chrome Test Kitchen' }).where(eq(k.S.company.id, k.companyId))
    expect((await k.O('PUT', '/api/company', { name: 'Chrome Kitchen Two' })).status).toBe(200)
    const [p2] = await (k.t.db as any).select().from(k.S.page).where(eq(k.S.page.companyId, k.companyId))
    expect(JSON.stringify(p2.sections)).toContain('Welcome to Chrome Kitchen Two')
  })
})
