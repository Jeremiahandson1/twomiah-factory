// "We take bookings" at signup reaches the first setup (live test 2026-10-22): the business starts with weekday hours
// and a 30-minute Consultation on its own clock, so /book offers times on day one; a business that didn't say so starts
// with nothing switched into the book. And a booking settings row made later takes the company's zone, not Chicago.
import { describe, test, expect } from 'bun:test'
import { bootTenant } from './harness.ts'

const KEY = 'factory-key-for-provision-bookings'
const body = (hash: string, takesBookings?: boolean) => ({
  company: { name: 'Hudson Plumbing', slug: 'hudson-plumbing', email: 'office@hudson.example', state: 'NY', timezone: 'America/New_York' },
  owner: { email: 'owner@hudson.example', passwordHash: hash, firstName: 'Hal', lastName: 'Hudson' },
  features: ['contacts', 'jobs', 'online_booking'],
  industry: 'Plumbing',
  ...(takesBookings === undefined ? {} : { takesBookings }),
})

async function provisioned(takesBookings?: boolean) {
  const t = await bootTenant({ vertical: 'fieldservice' })
  process.env.FACTORY_SYNC_KEY = KEY
  const res = await t.call('/api/internal/provision', { method: 'POST', json: body(await Bun.password.hash('Owner-pass-1-long', 'bcrypt'), takesBookings), headers: { 'X-Factory-Key': KEY } })
  expect(res.status).toBe(201)
  return t
}

describe('provisioning a business that takes bookings', () => {
  test('weekday hours 9–5, one 30-minute Consultation, on the business’s own clock — and /book offers days', async () => {
    const t = await provisioned(true)
    const [s] = await t.db.select().from(t.schema.bookingSettings)
    expect(s).toMatchObject({ enabled: true, timezone: 'America/New_York' })
    const hours = (await t.db.select().from(t.schema.bookingHours)).map((h: any) => [h.dayOfWeek, h.startMinute, h.endMinute, h.userId])
    expect(hours.sort()).toEqual([1, 2, 3, 4, 5].map((d) => [d, 540, 1020, null]))
    const svc = await t.db.select().from(t.schema.bookingService)
    expect(svc.map((x: any) => [x.slug, x.name, x.durationMinutes, x.active])).toEqual([['consultation', 'Consultation', 30, true]])
    const list = await (await t.call('/api/book/services')).json()
    expect(list.data.map((x: any) => x.slug)).toEqual(['consultation'])
    const dates = (await (await t.call('/api/book/services/consultation/dates')).json()).data
    expect(dates.length).toBeGreaterThan(10)
    const page = await (await t.call('/book')).text()
    expect(page).toContain('Consultation')
    expect(page).not.toContain('opening soon')
  })

  test('a business that did not say so starts with no service and no hours; its first settings row is on its own clock', async () => {
    const t = await provisioned()
    expect(await t.db.select().from(t.schema.bookingService)).toEqual([])
    expect(await t.db.select().from(t.schema.bookingHours)).toEqual([])
    await t.call('/api/book/services')
    const [s] = await t.db.select().from(t.schema.bookingSettings)
    expect(s.timezone).toBe('America/New_York')
  })
})
