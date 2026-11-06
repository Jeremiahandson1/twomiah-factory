// Restaurant & bar parity #4 (docs/parity/restaurant-3-website-form.md): the website enquiry form offers the venue's rooms with their
// capacity and shows whether each LOOKS free on the date, from the live bookings, taking no hold; and each campaign has its own
// form (link and embed code) that tags the enquiry's lead source by itself. On the real server (bootFood, a restaurant tenant);
// each test fails without the change: the feature off, a seat without the permission, or the old form path, is what it catches.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore } from '../server/crm/restaurant/eventGuarantee.ts'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'reports']
const DEPTH = ['event_calendar', 'event_reports', 'event_web_enquiries', 'event_form_campaigns']
let k: Awaited<ReturnType<typeof bootFood>>
let today = ''
const later = (n: number) => dayBefore(today, -n)
let ip = 0
const post = (body: Record<string, unknown>) => k.t.call('/api/leads', { method: 'POST', json: { t: String(Date.now() - 10_000), ...body }, headers: { 'X-Forwarded-For': `198.51.100.${++ip}` } })
const evs = async () => (await (k.t.db as any).select().from(k.S.event).where(eq(k.S.event.companyId, k.companyId))) as any[]
const waits = async () => (await (k.t.db as any).select().from(k.S.eventWaitlist).where(eq(k.S.eventWaitlist.companyId, k.companyId))) as any[]
let loftId = '', cellarId = '', token = '', campaignId = ''

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: [...BASE, ...DEPTH] })
  today = await venueToday(k.t.db, k.companyId)
  await (k.t.db as any).update(k.S.company).set({ name: 'The Loft Venue' }).where(eq(k.S.company.id, k.companyId))
  loftId = (await k.O('POST', '/api/event-spaces', { name: 'The Loft', seatedCapacity: 50, standingCapacity: 80, hireFee: 437, minimumSpend: 2113 })).json.id
  cellarId = (await k.O('POST', '/api/event-spaces', { name: 'The Cellar', seatedCapacity: 24 })).json.id
}, 60_000)
afterAll(() => k.restore())

describe('campaigns: one form, one link, one embed each, tagged with a lead source', () => {
  test('the owner makes one; a source must be on the list; a manager reads but cannot write; the link and embed come from the server', async () => {
    expect((await k.M('POST', '/api/event-campaigns', { name: 'Instagram bio', source: 'instagram' })).status).toBe(403)
    expect((await k.O('POST', '/api/event-campaigns', { name: 'Billboard', source: 'a billboard' })).status).toBe(400)
    expect((await k.O('POST', '/api/event-campaigns', { name: '  ', source: 'instagram' })).status).toBe(400)
    expect((await k.O('POST', '/api/event-campaigns', { name: 'No source' })).status).toBe(400)
    const made = await k.O('POST', '/api/event-campaigns', { name: 'Instagram bio', source: 'instagram' })
    expect(made.status).toBe(201)
    campaignId = made.json.id; token = made.json.token
    expect(token).toMatch(/^[0-9a-f]{24}$/)
    expect(made.json.path).toBe(`/api/event-form/${token}`)
    expect(made.json.embedScriptPath).toBe('/api/event-form/embed.js')
    expect(made.json.sourceLabel).toBe('Instagram / Facebook')
    const list = await k.M('GET', '/api/event-campaigns')
    expect(list.status).toBe(200); expect(list.json.data.map((c: any) => c.name)).toEqual(['Instagram bio'])
    expect((await k.B('PUT', `/api/event-campaigns/${campaignId}`, { name: 'x' })).status).toBe(403)
    expect((await k.O('PUT', `/api/event-campaigns/${campaignId}`, { source: 'nope' })).status).toBe(400)
  })

  test('the form is a page at the campaign link: the venue, each room with its capacity, the campaign inside, and any https page may frame it', async () => {
    const res = await k.t.app.request(`/api/event-form/${token}`, { headers: { host: 'bar.test' } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('The Loft Venue')
    expect(html).toContain('The Loft (seats 50, standing 80)'); expect(html).toContain('The Cellar (seats 24)')
    expect(html).toContain(`name="campaign" value="${token}"`)
    expect(html).toContain('name="eventDate"'); expect(html).toContain('action="/api/leads"')
    expect(res.headers.get('content-security-policy')).toMatch(/frame-ancestors[^;]*https:/)
    // A price is never on a public page.
    expect(html.includes('437') || html.includes('2113')).toBe(false)
    expect((await k.t.app.request('/api/event-form/ffffffffffffffffffffffff', { headers: { host: 'bar.test' } })).status).toBe(404)
    expect((await k.t.app.request('/api/event-form/not-a-token', { headers: { host: 'bar.test' } })).status).toBe(404)
    const js = await k.t.app.request('/api/event-form/embed.js', { headers: { host: 'bar.test' } })
    expect(js.status).toBe(200); expect(js.headers.get('content-type')).toContain('javascript')
    expect(await js.text()).toContain('twomiah-event-form')
  })

  test('an enquiry through the campaign carries its lead source, the room it preferred and its hours — and holds nothing', async () => {
    const date = later(120)
    const before = (await evs()).length
    const r = await post({ name: 'Riley Quinn', email: 'riley@quinn.test', phone: '7155550177', eventDate: date, headcount: 40, venueType: 'Wedding', notes: 'Rehearsal dinner', campaign: token, spaceId: loftId, startTime: '18:00', endTime: '22:00', source: 'Event form — Instagram bio' })
    expect(r.status).toBe(200)
    const all = await evs()
    expect(all.length).toBe(before + 1)
    const made = all.find((e: any) => e.name.includes('Riley'))
    expect(made).toMatchObject({ status: 'enquiry', source: 'instagram', campaignId, spaceId: loftId, startTime: '18:00', endTime: '22:00', guestCount: 40 })
    // The room is a preference: someone else can still book it for those very hours, and nobody is waitlisted.
    const book = await k.O('POST', '/api/events', { name: 'Gala', eventDate: date, status: 'confirmed', spaceId: loftId, startTime: '18:00', endTime: '22:00' })
    expect(book.status).toBe(201)
    expect((await waits()).length).toBe(0)
    // And the source report counts it under Instagram without anyone choosing it.
    const rep = await k.O('GET', `/api/event-reports/sources?from=${today}&to=${today}`)
    expect(rep.json.sources.find((s: any) => s.source === 'instagram')?.enquiries).toBe(1)
    // The campaign list counts what came through it.
    expect((await k.O('GET', '/api/event-campaigns')).json.data[0].enquiries).toBe(1)
  })

  test('an unknown or switched-off campaign, a room that is not the venue\'s, or a bad hour is ignored — the enquiry is still taken as the website form', async () => {
    const stray = await post({ name: 'Stray One', email: 's1@x.test', phone: '7155550201', eventDate: later(121), headcount: 10, venueType: 'Other', campaign: 'aaaaaaaaaaaaaaaaaaaaaaaa', spaceId: 'nothere', startTime: '25:00', endTime: '07:00' })
    expect(stray.status).toBe(200)
    const a = (await evs()).find((e: any) => e.name.includes('Stray One'))
    expect(a).toMatchObject({ status: 'enquiry', source: 'website', campaignId: null, spaceId: null, startTime: null })
    await k.O('PUT', `/api/event-campaigns/${campaignId}`, { active: false })
    expect((await k.t.app.request(`/api/event-form/${token}`, { headers: { host: 'bar.test' } })).status).toBe(404)
    await post({ name: 'Stray Two', email: 's2@x.test', phone: '7155550202', eventDate: later(122), headcount: 10, venueType: 'Other', campaign: token })
    expect((await evs()).find((e: any) => e.name.includes('Stray Two'))).toMatchObject({ source: 'website', campaignId: null })
    await k.O('PUT', `/api/event-campaigns/${campaignId}`, { active: true })
  })
})

describe('the form shows whether a room looks free, from live bookings, taking no hold', () => {
  const day = () => later(140)
  test('rooms with capacity; a held hour shows the room as taken for crossing hours and free for others; no date means no look', async () => {
    await k.O('POST', '/api/events', { name: 'Held dinner', eventDate: day(), status: 'tentative', spaceId: loftId, startTime: '18:00', endTime: '22:00' })
    const rooms = (q: string) => k.pub('GET', `/api/event-form/rooms${q}`)
    const none = await rooms('')
    expect(none.status).toBe(200)
    expect(none.json.data.map((r: any) => [r.name, r.seatedCapacity, r.standingCapacity, r.looksFree])).toEqual([['The Cellar', 24, null, null], ['The Loft', 50, 80, null]])
    const crossing = (await rooms(`?date=${day()}&startTime=19:00&endTime=21:00&guests=60`)).json.data
    expect(crossing.find((r: any) => r.name === 'The Loft')).toMatchObject({ looksFree: false, fits: true })
    expect(crossing.find((r: any) => r.name === 'The Cellar')).toMatchObject({ looksFree: true, fits: false })
    const lunch = (await rooms(`?date=${day()}&startTime=11:00&endTime=14:00`)).json.data
    expect(lunch.find((r: any) => r.name === 'The Loft').looksFree).toBe(true)
    // With no hours asked, a room with any hold that day does not look free.
    expect((await rooms(`?date=${day()}`)).json.data.find((r: any) => r.name === 'The Loft').looksFree).toBe(false)
    // A bad date is not asked, not an error.
    expect((await rooms('?date=2027-02-30')).json.data.every((r: any) => r.looksFree === null)).toBe(true)
    // Prices are never in it.
    expect(JSON.stringify(none.json)).not.toMatch(/hireFee|minimumSpend|437|2113/)
  })

  test('looking takes nothing: no event, no hold, no place on the waitlist', async () => {
    const before = [(await evs()).length, (await waits()).length]
    for (let i = 0; i < 3; i++) expect((await k.pub('GET', `/api/event-form/rooms?date=${day()}&startTime=18:00&endTime=22:00`)).status).toBe(200)
    expect([(await evs()).length, (await waits()).length]).toEqual(before)
    // The held dinner is still the only hold on the Loft that night.
    const grid = (await k.O('GET', `/api/event-calendar?from=${day()}&to=${day()}`)).json.events.filter((e: any) => e.spaceId === loftId)
    expect(grid.map((e: any) => e.name)).toEqual(['Held dinner'])
  })

  test('the look follows the same overlap rule as editing: a hold released shows the room free again', async () => {
    const held = (await evs()).find((e: any) => e.name === 'Held dinner')
    await k.O('PUT', `/api/events/${held.id}`, { status: 'cancelled' })
    const after = (await k.pub('GET', `/api/event-form/rooms?date=${day()}&startTime=19:00&endTime=21:00`)).json.data
    expect(after.find((r: any) => r.name === 'The Loft').looksFree).toBe(true)
  })
})

describe('one rule on both sides: with the feature off none of it is there', () => {
  test('rooms, form page, embed and campaigns are gone, and a posted campaign is ignored', async () => {
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_form_campaigns')])
    expect((await k.pub('GET', '/api/event-form/rooms')).status).toBe(404)
    expect((await k.t.app.request(`/api/event-form/${token}`, { headers: { host: 'bar.test' } })).status).toBe(404)
    expect((await k.t.app.request('/api/event-form/embed.js', { headers: { host: 'bar.test' } })).status).toBe(404)
    expect([403, 404]).toContain((await k.O('GET', '/api/event-campaigns')).status)
    expect([403, 404]).toContain((await k.O('POST', '/api/event-campaigns', { name: 'Off', source: 'website' })).status)
    await post({ name: 'Off Switch', email: 'off@x.test', phone: '7155550210', eventDate: later(160), headcount: 12, venueType: 'Other', campaign: token, spaceId: loftId })
    expect((await evs()).find((e: any) => e.name.includes('Off Switch'))).toMatchObject({ status: 'enquiry', source: 'website', campaignId: null, spaceId: null })
    await k.features([...BASE, ...DEPTH])
  })
})
