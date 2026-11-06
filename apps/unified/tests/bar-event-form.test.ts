// Restaurant & bar parity #4 on the BAR's side (docs/parity/restaurant-3-website-form.md): the bar's party form offers the venue's
// rooms and a campaign's form tags the party enquiry's lead source. Through the real site form (POST /api/leads) and the public
// form pages, on a bar tenant (its party form is crm/bar/enquiry.ts partyEnquiry). Each test fails without the change.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let ipCount = 0
let roomId = '', token = ''
const future = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10)
const post = (body: Record<string, unknown>) => t.call('/api/leads', { method: 'POST', json: { t: String(Date.now() - 10_000), ...body }, headers: { 'X-Forwarded-For': `203.0.113.${++ipCount}` } })
const events = async () => (await t.db.select().from(t.schema.event).where(eq(t.schema.event.companyId, companyId))) as any[]
const FEATURES = ['contacts', 'event_bookings', 'event_spaces', 'lead_inbox', 'bar_menu', 'bar_tonight', 'event_form_campaigns']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'bar' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ name: 'Water Street Tap', enabledFeatures: FEATURES }).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  const owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json()).accessToken
  const api = async (method: string, path: string, json?: unknown) => { const r = await t.call(path, { method, headers: { Authorization: `Bearer ${owner}` }, ...(json === undefined ? {} : { json }) }); return { status: r.status, json: await r.json() as any } }
  roomId = (await api('POST', '/api/event-spaces', { name: 'Back Room', seatedCapacity: 30, standingCapacity: 45 })).json.id
  token = (await api('POST', '/api/event-campaigns', { name: 'Google profile', source: 'google_business' })).json.token
}, 60_000)

describe('the bar party form: rooms, and a campaign that tags the lead source', () => {
  test('the campaign page is the party form (phone first, a date, how many) with the room and its capacity', async () => {
    const res = await t.app.request(`/api/event-form/${token}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Water Street Tap')
    expect(html).toContain('name="formType" value="party"'); expect(html).toContain('name="requestedDate"'); expect(html).toContain('name="partySize"')
    expect(html).toContain('Back Room (seats 30, standing 45)')
    expect(html).toContain(`name="campaign" value="${token}"`)
  })

  test('a dated party request through the campaign: tagged with its source, the room preferred, holding nothing', async () => {
    const r = await post({ name: 'Pat Kowalski', phone: '(715) 555-0142', formType: 'party', partySize: 24, requestedDate: future, occasion: 'Retirement', campaign: token, spaceId: roomId, startTime: '17:00', endTime: '21:00', message: 'Back room please' })
    expect(r.status).toBe(200)
    const [ev] = await events()
    expect(ev).toMatchObject({ status: 'enquiry', source: 'google_business', spaceId: roomId, startTime: '17:00', endTime: '21:00', guestCount: 24 })
    expect(ev.campaignId).toBeTruthy()
  })

  test('the plain party form is the website form as before; a stale campaign or a foreign room changes nothing', async () => {
    expect((await post({ name: 'Sam Lee', phone: '715-555-0199', formType: 'party', partySize: 8, requestedDate: future, occasion: 'Birthday', campaign: 'bbbbbbbbbbbbbbbbbbbbbbbb', spaceId: 'elsewhere' })).status).toBe(200)
    const sam = (await events()).find((e: any) => e.name.includes('Sam Lee'))
    expect(sam).toMatchObject({ status: 'enquiry', source: 'website', campaignId: null, spaceId: null })
  })

  test('with the feature off the campaign is ignored and its pages are gone', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'event_form_campaigns') }).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect((await t.app.request(`/api/event-form/${token}`)).status).toBe(404)
    expect((await t.app.request('/api/event-form/rooms')).status).toBe(404)
    expect((await post({ name: 'Off Switch', phone: '715-555-0123', formType: 'party', partySize: 6, requestedDate: future, occasion: 'Party', campaign: token, spaceId: roomId })).status).toBe(200)
    expect((await events()).find((e: any) => e.name.includes('Off Switch'))).toMatchObject({ source: 'website', campaignId: null, spaceId: null })
  })
})
