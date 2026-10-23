// The field-service live retest of 2026-10-22, held: every public booking door keeps the same rules (the waitlist took a
// date 74 days out with no phone while the booking create refused both), a booker keeps the name they typed, and the
// numbers and formats the testers typed are bounded — payment terms, ZIPs, a roster title, a hire date, a geofence's
// point and radius, the tracking settings — and an empty list reports the limit asked for, not 1.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { addDays, tzParts } from '@twomiah/tenant-backend'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
const TZ = 'America/Chicago'
let today = '', day = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const err = async (r: Response) => ((await r.json()) as any).error as string
const who = { name: 'Pat Lee', email: 'pat@example.com', phone: '608-555-0100', address: '1 Elm St' }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  // Branches and projects aren't field service's own switches; the shared schemas behind them are still under test here.
  // One clock (coordinator 10/23): the business's zone, set in Settings › Company, is the one Bookings keeps time on.
  await t.db.update(t.schema.company).set({ timezone: TZ, enabledFeatures: ['online_booking', 'contacts', 'jobs', 'team', 'invoices', 'recurring_jobs', 'gps_tracking', 'multi_location', 'projects'] } as any).where(eq(t.schema.company.id, s.company.id))
  expect((await as('/api/booking/settings', { method: 'PATCH', json: { timezone: TZ, enabled: true, maxDaysOut: 30, leadTimeMinutes: 60, requirePhone: true } })).status).toBe(200)
  expect((await as('/api/booking/services', { method: 'POST', json: { name: 'Furnace Check', durationMinutes: 60, slotStepMinutes: 60 } })).status).toBe(201)
  expect((await as('/api/booking/hours', { method: 'PUT', json: { hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' })) } })).status).toBe(200)
  today = tzParts(new Date(), TZ).date
  day = addDays(today, 3)
}, 60_000)

describe('every public booking door holds the same rules', () => {
  const wait = (b: Record<string, unknown>) => t.call('/api/book/services/furnace-check/waitlist', { method: 'POST', json: { name: 'Wren Waiter', email: 'wren@example.com', phone: '608-555-0111', ...b } })

  test('the waitlist refuses a date past the window, as the create does', async () => {
    const far = addDays(today, 74)
    const r = await wait({ from: far, to: addDays(far, 6) })
    expect(r.status).toBe(400)
    expect(await err(r)).toContain('within 30 days')
    const only = await wait({ to: far })
    expect(only.status).toBe(400)
    const create = await t.call('/api/book/services/furnace-check', { method: 'POST', json: { ...who, date: far, time: '10:00' } })
    expect(create.status).toBe(400)
    expect(await err(create)).toContain('within 30 days')
  })

  test('the waitlist refuses no phone when the booking form asks for one, as the create does', async () => {
    const r = await wait({ phone: '' })
    expect(r.status).toBe(400)
    expect(await err(r)).toContain('phone')
    const create = await t.call('/api/book/services/furnace-check', { method: 'POST', json: { ...who, phone: '', date: day, time: '10:00' } })
    expect(create.status).toBe(400)
    expect(await err(create)).toContain('phone')
  })

  test('a phone or ZIP that is given must be one, on both doors', async () => {
    expect((await wait({ phone: 'call me' })).status).toBe(400)
    expect((await wait({ zip: 'abcdef' })).status).toBe(400)
    const r = await t.call('/api/book/services/furnace-check', { method: 'POST', json: { ...who, zip: 'abcdef', date: day, time: '11:00' } })
    expect(r.status).toBe(400)
    expect(await err(r)).toContain('ZIP')
  })

  test('a waitlist entry inside the window with a phone is taken; the form asks for the phone and bounds its dates', async () => {
    const r = await wait({ from: day, to: addDays(today, 20), zip: '54701' })
    expect(r.status).toBe(200)
    const [row] = await t.db.select().from(t.schema.bookingWaitlist).where(eq(t.schema.bookingWaitlist.customerEmail, 'wren@example.com'))
    expect(row.customerPhone).toBe('608-555-0111')
    const page = await (await t.call('/book/furnace-check')).text()
    const form = page.slice(page.indexOf('id="book-waitlist"'), page.indexOf('</form>', page.indexOf('id="book-waitlist"')))
    expect(form).toMatch(/name="phone" required/)
    expect(form).toContain(`max="${addDays(today, 30)}"`)
  })

  test('a customer cannot move a booking past the window', async () => {
    const r = await t.call('/api/book/services/furnace-check', { method: 'POST', json: { ...who, email: 'mover@example.com', date: day, time: '09:00' } })
    expect(r.status).toBe(201)
    const { token: tok } = await r.json()
    const moved = await t.call(`/api/book/bookings/${tok}/reschedule`, { method: 'POST', json: { date: addDays(today, 74), time: '10:00' } })
    expect(moved.status).toBe(400)
    expect(await err(moved)).toContain('within 30 days')
  })

  test('with online booking switched off, the waitlist is closed too', async () => {
    expect((await as('/api/booking/settings', { method: 'PATCH', json: { enabled: false } })).status).toBe(200)
    // The public half answers on the feature, not the switch: the waitlist refuses like the create.
    const r = await wait({ email: 'off@example.com' })
    expect(r.status).toBe(403)
    expect((await as('/api/booking/settings', { method: 'PATCH', json: { enabled: true } })).status).toBe(200)
  })
})

describe('a booker keeps the name they typed', () => {
  test('matching an existing contact by email links it and renames nobody', async () => {
    const c = await (await as('/api/contacts', { method: 'POST', json: { name: 'Casey Contact', email: 'casey@example.com', type: 'client' } })).json()
    const r = await t.call('/api/book/services/furnace-check', { method: 'POST', json: { ...who, name: 'Booker Typed', email: 'casey@example.com', date: day, time: '13:00' } })
    expect(r.status).toBe(201)
    const { token: tok } = await r.json()
    expect((await (await t.call(`/api/book/bookings/${tok}`)).json()).customerName).toBe('Booker Typed')
    const listed = (await (await as(`/api/booking/bookings?contactId=${c.id}`)).json()).data
    expect(listed).toHaveLength(1)
    expect(listed[0].customerName).toBe('Booker Typed')
    expect(listed[0].contactId).toBe(c.id)
    expect((await (await as(`/api/booking/bookings/${listed[0].id}`)).json()).customerName).toBe('Booker Typed')
    // Staff booking for the same person by email: the same. (The business asks for a phone, so the desk gives one —
    // a staff booking is held to that too: booking-doors-1023.test.ts.)
    const staff = await as('/api/booking/bookings', { method: 'POST', json: { serviceId: listed[0].serviceId, name: 'Desk Typed', email: 'casey@example.com', phone: '608-555-0123', date: day, time: '14:00' } })
    expect(staff.status).toBe(201)
    expect((await staff.json()).customerName).toBe('Desk Typed')
    expect((await (await as(`/api/contacts/${c.id}`)).json()).name).toBe('Casey Contact')
  })
})

describe('payment terms: a whole number of days, 0 to 365, wherever they are typed', () => {
  let contactId = ''
  const recurring = (b: Record<string, unknown>) => as('/api/recurring', { method: 'POST', json: { contactId, frequency: 'monthly', lineItems: [{ description: 'Maintenance plan', quantity: 1, unitPrice: 25 }], ...b } })
  beforeAll(async () => { contactId = (await (await as('/api/contacts', { method: 'POST', json: { name: 'Terms Client', email: 'terms@example.com', type: 'client' } })).json()).id }, 30_000)

  test('a recurring invoice refuses 999, 366, -1 and 1.5 — the days box or a number in terms', async () => {
    for (const v of [999, 366, -1, 1.5, 'abc']) {
      const r = await recurring({ paymentTermsDays: v })
      expect(r.status).toBe(400)
      expect(await err(r)).toBe('Payment terms must be a whole number of days between 0 and 365.')
    }
    expect((await recurring({ terms: '999' })).status).toBe(400)
  })

  test('the days box is saved and read back (it was never read)', async () => {
    const r = await recurring({ paymentTermsDays: 45, terms: '' })
    expect(r.status).toBe(201)
    const made = await r.json()
    expect(made.terms).toBe('45')
    const back = await (await as(`/api/recurring/${made.id}`)).json()
    expect(back.paymentTermsDays).toBe(45)
    const put = await as(`/api/recurring/${made.id}`, { method: 'PUT', json: { paymentTermsDays: 999 } })
    expect(put.status).toBe(400)
    expect((await as(`/api/recurring/${made.id}`, { method: 'PUT', json: { paymentTermsDays: 15 } })).status).toBe(200)
    expect((await (await as(`/api/recurring/${made.id}`)).json()).paymentTermsDays).toBe(15)
  })

  test('Settings: paymentTermsDays and any payment-terms key refuse 999', async () => {
    for (const k of ['paymentTermsDays', 'paymentTerms', 'defaultPaymentTerms']) {
      const r = await as('/api/company', { method: 'PUT', json: { settings: { [k]: 999 } } })
      expect(r.status).toBe(400)
      expect(await err(r)).toContain('between 0 and 365')
    }
    expect((await as('/api/company', { method: 'PUT', json: { settings: { paymentTermsDays: 30 } } })).status).toBe(200)
  })
})

describe('a ZIP is a US ZIP in every shared schema', () => {
  test('"abcdef" is refused on the company, a contact, a job, a branch and a project; 12345-6789 is kept tidy', async () => {
    const company = await as('/api/company', { method: 'PUT', json: { zip: 'abcdef' } })
    expect(company.status).toBe(400)
    expect(await err(company)).toContain('ZIP code')
    expect((await as('/api/contacts', { method: 'POST', json: { name: 'Zip Test', zip: 'abcdef', type: 'client' } })).status).toBe(400)
    expect((await as('/api/jobs', { method: 'POST', json: { title: 'Zip job', zip: 'abcdef' } })).status).toBe(400)
    expect((await as('/api/locations', { method: 'POST', json: { name: 'North', code: 'N', zip: 'abcdef' } })).status).toBe(400)
    expect((await as('/api/projects', { method: 'POST', json: { name: 'Zip project', zip: 'abcdef' } })).status).toBe(400)
    const ok = await as('/api/jobs', { method: 'POST', json: { title: 'Zip job', zip: '54701 1234' } })
    expect(ok.status).toBe(201)
    expect((await ok.json()).zip).toBe('54701-1234')
    expect((await as('/api/company', { method: 'PUT', json: { zip: '54701' } })).status).toBe(200)
  })
})

describe('the roster', () => {
  test('a role that is an access level is refused; a job title is taken', async () => {
    for (const role of ['superadmin', 'Super Admin', 'admin', 'Owner', 'root']) {
      const r = await as('/api/team', { method: 'POST', json: { name: 'Sam', role } })
      expect(r.status).toBe(400)
      expect(await err(r)).toContain('access level')
    }
    const made = await as('/api/team', { method: 'POST', json: { name: 'Sam', role: 'Lead Technician' } })
    expect(made.status).toBe(201)
    const id = (await made.json()).id
    expect((await as(`/api/team/${id}`, { method: 'PUT', json: { role: 'superadmin' } })).status).toBe(400)
    expect((await as(`/api/team/${id}`, { method: 'PUT', json: { role: 'Office Admin' } })).status).toBe(200)
  })

  test('a login can only be given one of the vertical\'s roles', async () => {
    const r = await as('/api/company/users', { method: 'POST', json: { email: 'su@example.com', firstName: 'Su', lastName: 'Per', role: 'superadmin', password: 'Long-enough-1' } })
    expect(r.status).toBe(400)
  })

  test('a hire date is a real day in a plausible year (99999 was a 500)', async () => {
    for (const hireDate of ['99999-01-01', '2026-02-30', '1850-01-01']) expect((await as('/api/team', { method: 'POST', json: { name: 'Hire', hireDate } })).status).toBe(400)
    expect((await as('/api/team', { method: 'POST', json: { name: 'Hire', hireDate: '2024-05-01' } })).status).toBe(201)
  })
})

describe('GPS & Geofences', () => {
  const fence = (b: Record<string, unknown>) => as('/api/geofencing', { method: 'POST', json: { name: 'Site', lat: 44.81, lng: -91.5, radius: 100, ...b } })

  test('an empty list reports the limit asked for, not 1', async () => {
    const asked = await (await as('/api/geofencing?limit=25')).json()
    expect(asked.data).toEqual([])
    expect(asked.pagination).toEqual({ page: 1, limit: 25, total: 0, pages: 0 })
    expect((await (await as('/api/geofencing')).json()).pagination.limit).toBe(50)
    expect((await (await as('/api/booking/waitlist?limit=50')).json()).pagination.limit).toBe(50)
    expect((await (await t.call('/api/book/services/furnace-check/times?date=' + addDays(today, 60) + '&limit=20')).json()).pagination).toEqual({ page: 1, limit: 20, total: 0, pages: 0 })
  })

  test('a point off the Earth and a radius out of range are refused with a plain sentence', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ lat: 999 }, 'Latitude must be a number between -90 and 90.'], [{ lat: -91 }, 'Latitude'], [{ lng: 200 }, 'Longitude must be a number between -180 and 180.'],
      [{ lat: '12abc' }, 'Latitude'], [{ radius: -5 }, 'Radius must be a whole number of metres between 25 and 500.'], [{ radius: 99999999 }, 'Radius'], [{ radius: 24 }, 'Radius'], [{ radius: 10.5 }, 'Radius'],
    ]
    for (const [b, said] of cases) {
      const r = await fence(b)
      expect(r.status).toBe(400)
      expect(await err(r)).toContain(said)
    }
    expect((await (await as('/api/geofencing?active=all')).json()).data).toEqual([])
  })

  test('a real fence is taken — the equator too — and an edit is held to the same rule', async () => {
    expect((await fence({ lat: 0, lng: 0, radius: 25 })).status).toBe(201)
    const r = await fence({ radius: 500 })
    expect(r.status).toBe(201)
    const id = (await r.json()).id
    for (const b of [{ lat: 999 }, { lng: -181 }, { radius: -5 }, { radius: 99999999 }, { lat: null }]) expect((await as(`/api/geofencing/${id}`, { method: 'PUT', json: b })).status).toBe(400)
    expect((await as(`/api/geofencing/${id}`, { method: 'PUT', json: { radius: 250 } })).status).toBe(200)
    const [row] = await t.db.select().from(t.schema.geofence).where(eq(t.schema.geofence.id, id))
    expect(row.radius).toBe(250)
    expect(Number(row.lat)).toBeCloseTo(44.81)
  })

  test('the phone\'s location and the lookups take only a real point; the tracking settings are bounded', async () => {
    expect((await as('/api/geofencing/location', { method: 'POST', json: { lat: 999, lng: 1 } })).status).toBe(400)
    expect((await as('/api/geofencing/check?lat=999&lng=1')).status).toBe(400)
    expect((await as('/api/geofencing/nearest?lat=1&lng=999')).status).toBe(400)
    expect((await as('/api/geofencing/settings', { method: 'PUT', json: { trackingInterval: 'abc' } })).status).toBe(400)
    expect((await as('/api/geofencing/settings', { method: 'PUT', json: { trackingInterval: 0 } })).status).toBe(400)
    expect((await as('/api/geofencing/settings', { method: 'PUT', json: { locationTrackingEnabled: 'yes' } })).status).toBe(400)
    expect((await as('/api/geofencing/settings', { method: 'PUT', json: { locationTrackingEnabled: true, trackingInterval: 60 } })).status).toBe(200)
  })
})
