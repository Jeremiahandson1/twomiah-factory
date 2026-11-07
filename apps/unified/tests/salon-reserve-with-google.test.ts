// Salon parity row 23 — Reserve with Google, the Actions Center APPOINTMENTS REDIRECT integration (server/booking/googleRedirect.ts; feature
// reserve_with_google, not ready), to Google's published spec: the entity, action and services feeds with their fileset descriptors; the
// rwg_token kept 30 days from the click on Google; the booking that follows reported once as text/plain to Google's conversion endpoint (the
// sandbox's when GOOGLE_RWG_SANDBOX=1), with no personal data. Up to the partner step: nothing is sent without Twomiah's partner id.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { googleConversions, e164, serviceEntry } from '../server/booking/googleRedirect.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices']
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)) }

describe('salon: Reserve with Google (redirect)', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', owner = ''
  const sent: Array<{ url: string; body: any }> = []
  const realPost = googleConversions.post
  const envBefore = { id: process.env.GOOGLE_RWG_PARTNER_ID, sb: process.env.GOOGLE_RWG_SANDBOX, site: process.env.SITE_URL }
  let ip = 0
  const as = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${owner}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = next(2, 3)
  const book = (time: string, email: string, cookie?: string) => t.call('/api/book/services/cut', { method: 'POST', json: { date: day, time, name: 'Google Client', email, phone: '608-555-0111' }, headers: { 'x-forwarded-for': `10.12.0.${++ip}`, ...(cookie ? { Cookie: cookie } : {}) } })
  const bookingBy = async (email: string) => ((await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.customerEmail, email))) as any[])[0]

  beforeAll(async () => {
    process.env.SITE_URL = 'https://glow.example.com'
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, name: 'Glow Salon', phone: '(715) 555-0100', address: '214 Water St', city: 'Eau Claire', state: 'WI', zip: '54703' } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    expect((await as('/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    expect((await as('/api/booking/hours', 'PUT', { hours: [{ userId: null, dayOfWeek: 2, start: '09:00', end: '17:00' }] })).status).toBe(200)
    expect((await as('/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).status).toBe(201)
    expect((await as('/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 90, price: 120, priceIsFrom: true, bookableOnline: true })).status).toBe(201)
    expect((await as('/api/service-menu', 'POST', { name: 'Consult', category: 'other', durationMin: 15, bookableOnline: true })).status).toBe(201)
    googleConversions.post = async (url, body) => { sent.push({ url, body: JSON.parse(body) }); return 200 }
  }, 120_000)
  afterAll(() => {
    googleConversions.post = realPost
    for (const [k, v] of [['GOOGLE_RWG_PARTNER_ID', envBefore.id], ['GOOGLE_RWG_SANDBOX', envBefore.sb], ['SITE_URL', envBefore.site]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  })

  test('off: no feeds, no token kept, nothing reported', async () => {
    expect((await as('/api/booking/google/feeds')).status).toBe(404)
    const r = await t.call('/book/cut?rwg_token=abc123')
    expect(r.headers.get('set-cookie') || '').not.toContain('rwg_token')
    process.env.GOOGLE_RWG_PARTNER_ID = '20001234'
    expect((await book('09:00', 'off@example.com', 'rwg_token=abc123')).status).toBe(201)
    await settle()
    expect(sent).toHaveLength(0)
    expect((await bookingBy('off@example.com')).rwgToken).toBeNull()
  })

  test('on: the three feeds as Google takes them, with their descriptors', async () => {
    await features([...FEATURES, 'reserve_with_google'])
    const f = (await as('/api/booking/google/feeds')).body
    expect(f.problems).toEqual([])
    expect(f.entity.data).toEqual([{ entity_id: co, name: 'Glow Salon', telephone: '+17155550100', url: 'https://glow.example.com',
      location: { address: { country: 'US', locality: 'Eau Claire', region: 'WI', postal_code: '54703', street_address: '214 Water St' } } }])
    expect(f.action.data).toEqual([{ entity_id: co, link_id: `book-${co}`, url: 'https://glow.example.com/book', actions: [{ appointment_info: {} }] }])
    const byName = Object.fromEntries(f.service.data.map((s: any) => [s.localized_service_name.value, s]))
    expect(byName.Cut).toMatchObject({ merchant_id: co, localized_service_category: { value: 'Hair' }, service_price: { price_interpretation: 'INTERPRETATION_EXACT', min_price: { price_micros: 40_000_000, currency_code: 'USD' } }, action_link: [{ url: 'https://glow.example.com/book/cut' }], service_duration: { duration_interpretation: 'INTERPRETATION_EXACT', min_duration_sec: 1800 } })
    expect(byName.Colour.service_price).toEqual({ price_interpretation: 'INTERPRETATION_STARTS_AT', min_price: { price_micros: 120_000_000, currency_code: 'USD' } })
    expect(byName.Consult.service_price).toEqual({ price_interpretation: 'INTERPRETATION_NOT_DISPLAYED' })
    expect(Object.values(f.descriptors).map((d: any) => d.name).sort()).toEqual(['glam.service.v0', 'reservewithgoogle.action.v2', 'reservewithgoogle.entity'])
    expect(f.descriptors.entity.data_file).toEqual([f.files.entity])
    // what keeps Google from taking them, in words
    await t.db.update(t.schema.company).set({ address: null } as any).where(eq(t.schema.company.id, co))
    expect((await as('/api/booking/google/feeds')).body.problems[0]).toContain('street address')
    await t.db.update(t.schema.company).set({ address: '214 Water St' } as any).where(eq(t.schema.company.id, co))
  })

  test('the click from Google is kept 30 days; the booking it leads to is reported once, with no personal data', async () => {
    const r = await t.call('/book/cut?rwg_token=tok_ABC-123')
    expect(r.headers.get('set-cookie')).toContain('rwg_token=tok_ABC-123; Max-Age=2592000; Path=/')
    expect((await book('10:00', 'google@example.com', 'rwg_token=tok_ABC-123')).status).toBe(201)
    await settle()
    expect(sent).toEqual([{ url: 'https://www.google.com/maps/conversion/collect', body: { conversion_partner_id: '20001234', rwg_token: 'tok_ABC-123', merchant_changed: '2' } }])
    const b = await bookingBy('google@example.com')
    expect([b.rwgToken, !!b.rwgReportedAt]).toEqual(['tok_ABC-123', true])
    // a booking with no Google click is not reported
    expect((await book('11:00', 'walkin@example.com')).status).toBe(201)
    await settle()
    expect(sent).toHaveLength(1)
  })

  test('the sandbox endpoint while in Google’s review; nothing without the partner id, and it is tried again later', async () => {
    process.env.GOOGLE_RWG_SANDBOX = '1'
    expect((await book('12:00', 'sandbox@example.com', 'rwg_token=tokB')).status).toBe(201)
    await settle()
    expect(sent.at(-1)!.url).toBe('https://www.google.com/maps/conversion/debug/collect')
    delete process.env.GOOGLE_RWG_SANDBOX
    delete process.env.GOOGLE_RWG_PARTNER_ID
    const before = sent.length
    expect((await book('13:00', 'nopartner@example.com', 'rwg_token=tokC')).status).toBe(201)
    await settle()
    expect(sent.length).toBe(before)
    expect((await bookingBy('nopartner@example.com')).rwgReportedAt).toBeNull()
  })

  test('the pieces', () => {
    expect([e164('(715) 555-0100'), e164('+44 20 7946 0958'), e164('555'), e164(null)]).toEqual(['+17155550100', '+442079460958', null, null])
    expect(serviceEntry('m', { id: 's', slug: 'x', name: 'X', description: null, durationMinutes: 45, price: null, priceIsFrom: false } as any, null, 'https://a').localized_service_category).toEqual({ value: 'All Services' })
  })
})
