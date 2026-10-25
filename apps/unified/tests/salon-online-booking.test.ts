// Salon live test, 2026-10-25. A salon had two service lists that never met: the Service Menu's "Bookable online" box was
// read by nothing, /book offered the booking engine's own list (a provisioned "Consultation"), and an online booking
// reached The Book with no menu item — so no price from the menu, no loyalty on the service, no rebooking reminder. And
// booking hours were seeded Mon–Fri 9–5 at provisioning, so a shop open Tue–Sat stayed bookable Mon–Fri.
//
//   1. The Service Menu is the one list behind a salon's online booking: a ticked item is on /book (name, length, price,
//      description); booked, it is The Book's appointment with that menu item and its price; unticked or taken off the
//      menu, it is off /book while the bookings already made keep working. Booking settings keeps no second list.
//   2. A new salon's starting service is a Service Menu item.
//   3. Booking hours follow the business's opening hours until the owner sets their own — every vertical, one rule.
//   4. The Bookings calendar of a business whose online bookings land in its own book hands over to that book.
//   The vet's practice book is unchanged (vet-online-booking.test.ts).
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { loadVertical } from '../server/core/vertical.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
/** The first date at least `ahead` days out that falls on this weekday (0 = Sunday). */
function next(dow: number, ahead = 3) {
  let d = addDays(today(), ahead)
  while (weekdayOf(d) !== dow) d = addDays(d, 1)
  return d
}

async function tenant(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken as string
  const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  expect((await as('/api/company/features', { method: 'PUT', json: { features } })).status).toBe(200)
  await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, seeded.company.id))
  expect((await as('/api/booking/settings', { method: 'PATCH', json: { enabled: true, leadTimeMinutes: 0 } })).status).toBe(200)
  return { t, as, companyId: seeded.company.id as string, ownerId: seeded.owner.id as string }
}
const json = async (r: Response | Promise<Response>) => (await r).json() as Promise<any>

describe('1. a salon: the Service Menu is the one list behind online booking', () => {
  let s: Awaited<ReturnType<typeof tenant>>
  let cut: any, colour: any
  const publicSlugs = async () => ((await json(s.t.call('/api/book/services'))).data as any[]).map((x) => x.slug)
  beforeAll(async () => {
    s = await tenant('salon', ['online_booking', 'contacts', 'salon_booking', 'service_menu'])
    cut = await json(s.as('/api/service-menu', { method: 'POST', json: { name: 'Cut & Finish', category: 'hair', durationMin: 45, price: 55, description: 'Wash, cut and blow-dry.', bookableOnline: true, rebookIntervalDays: 42 } }))
    colour = await json(s.as('/api/service-menu', { method: 'POST', json: { name: 'Full Colour', category: 'colour', durationMin: 120, price: 140, bookableOnline: false } }))
  }, 60_000)

  test('a ticked menu item is on /book with its name, length, price and description; an unticked one is not', async () => {
    const list = (await json(s.t.call('/api/book/services'))).data as any[]
    expect(list).toEqual([{ slug: 'cut-finish', name: 'Cut & Finish', description: 'Wash, cut and blow-dry.', durationMinutes: 45, price: '55.00', tipPresets: null }])
    const page = await (await s.t.call('/book')).text()
    expect(page).toContain('Cut &amp; Finish')
    expect(page).toContain('45 min')
    expect(page).toContain('$55')
    expect(page).toContain('Wash, cut and blow-dry.')
    expect(page).not.toContain('Full Colour')
    expect((await s.t.call('/book/cut-finish')).status).toBe(200)
    // The engine's row is the menu item's, and nothing else is: no rebook interval of its own (the menu's Rebooking
    // reads the menu's — one client, one reminder).
    const rows = await s.t.db.select().from(s.t.schema.bookingService)
    expect(rows.map((r: any) => [r.serviceMenuId, r.active, r.rebookIntervalDays])).toEqual([[cut.id, true, null]])
  })

  let booked: any
  test('booked online, it is The Book’s appointment with that menu item, its length and its price', async () => {
    const day = next(3) // a Wednesday: the starting week (no opening hours yet) is weekdays 9–5
    const r = await s.t.call('/api/book/services/cut-finish', { method: 'POST', json: { date: day, time: '10:00', name: 'Robin Client', email: 'robin@example.com', phone: '608-555-0160' } })
    expect(r.status).toBe(201)
    ;[booked] = await s.t.db.select().from(s.t.schema.booking)
    const [a] = await s.t.db.select().from(s.t.schema.appointment).where(eq(s.t.schema.appointment.id, booked.appointmentId))
    expect(a.serviceId).toBe(cut.id)
    expect(Number(a.quotedPrice)).toBe(55)
    expect(a.endTime!.getTime() - a.startTime.getTime()).toBe(45 * 60_000)
    expect(a.contactId).toBe(booked.contactId)
    // The Book shows it with the menu's name, as a desk appointment would be.
    const book = (await json(s.as(`/api/appointments?from=${day}T00:00:00Z&to=${addDays(day, 1)}T12:00:00Z`))).data as any[]
    expect(book.find((x) => x.id === a.id)?.serviceName).toBe('Cut & Finish')
  })

  test('a menu change shows on /book at once; unticking takes it off /book, and the booking already made keeps working', async () => {
    expect((await s.as(`/api/service-menu/${cut.id}`, { method: 'PUT', json: { price: 60, durationMin: 50 } })).status).toBe(200)
    expect(((await json(s.t.call('/api/book/services'))).data as any[])[0]).toMatchObject({ price: '60.00', durationMinutes: 50 })

    expect((await s.as(`/api/service-menu/${cut.id}`, { method: 'PUT', json: { bookableOnline: false } })).status).toBe(200)
    expect(await publicSlugs()).toEqual([])
    expect((await s.t.call('/book/cut-finish')).status).toBe(404)
    expect((await s.t.call(`/api/book/services/cut-finish/dates`)).status).toBe(404)
    const refused = await s.t.call('/api/book/services/cut-finish', { method: 'POST', json: { date: next(4), time: '10:00', name: 'Late Comer', email: 'late@example.com', phone: '608-555-0161' } })
    expect(refused.status).toBe(404)
    expect((await s.t.call('/book')).status).toBe(200)
    expect(await (await s.t.call('/book')).text()).toContain('opening soon')

    // The booking made before: still confirmed, its appointment still in The Book; the desk can still move it.
    const [b] = await s.t.db.select().from(s.t.schema.booking).where(eq(s.t.schema.booking.id, booked.id))
    expect(b.status).toBe('confirmed')
    const moved = await s.as(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { date: tzParts(b.startAt, TZ).date, time: '13:00' } })
    expect(moved.status).toBe(200)
    const [a] = await s.t.db.select().from(s.t.schema.appointment).where(eq(s.t.schema.appointment.id, b.appointmentId!))
    expect(a.status).toBe('scheduled')
    expect(tzParts(a.startTime, TZ).minutes).toBe(13 * 60)

    // Ticked again, it is back at the same address.
    expect((await s.as(`/api/service-menu/${cut.id}`, { method: 'PUT', json: { bookableOnline: true } })).status).toBe(200)
    expect(await publicSlugs()).toEqual(['cut-finish'])
  })

  test('taken off the menu (deleted), it is off /book; ticking another puts that one on', async () => {
    expect((await s.as(`/api/service-menu/${cut.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await publicSlugs()).toEqual([])
    expect((await s.as(`/api/service-menu/${colour.id}`, { method: 'PUT', json: { bookableOnline: true } })).status).toBe(200)
    expect(await publicSlugs()).toEqual(['full-colour'])
    // Still one engine row per menu item: re-ticking never makes a second.
    expect((await s.t.db.select().from(s.t.schema.bookingService)).length).toBe(2)
  })

  test('Booking settings keeps no second list: no new services; what the menu owns is changed on the menu; how it is booked stays here', async () => {
    const created = await s.as('/api/booking/services', { method: 'POST', json: { name: 'Consultation', durationMinutes: 30 } })
    expect(created.status).toBe(409)
    expect((await created.json()).error).toContain('Service Menu')
    const [row] = await s.t.db.select().from(s.t.schema.bookingService).where(eq(s.t.schema.bookingService.serviceMenuId, colour.id))
    const rename = await s.as(`/api/booking/services/${row.id}`, { method: 'PATCH', json: { name: 'Colour (online)', price: 99 } })
    expect(rename.status).toBe(409)
    expect((await rename.json()).error).toContain('come from your Service Menu')
    // Sending back what it was shown is fine (the dialog's own fields), and the booking rules save.
    const rules = await s.as(`/api/booking/services/${row.id}`, { method: 'PATCH', json: { name: 'Full Colour', slotStepMinutes: 60, bufferAfterMinutes: 15 } })
    expect(rules.status).toBe(200)
    expect(await rules.json()).toMatchObject({ name: 'Full Colour', slotStepMinutes: 60, bufferAfterMinutes: 15, price: '140.00' })
    expect((await s.as(`/api/booking/services/${row.id}`, { method: 'DELETE' })).status).toBe(409)
  })

  test('a service made before (not on the menu) is not offered, nor booked at the desk; bookings of it keep working', async () => {
    const [old] = await s.t.db.insert(s.t.schema.bookingService).values({ companyId: s.companyId, slug: 'consultation', name: 'Consultation', durationMinutes: 30 }).returning()
    expect(await publicSlugs()).toEqual(['full-colour'])
    expect((await s.t.call('/book/consultation')).status).toBe(404)
    const pub = await s.t.call('/api/book/services/consultation', { method: 'POST', json: { date: next(4), time: '11:00', name: 'A', email: 'a@example.com', phone: '608-555-0162' } })
    expect(pub.status).toBe(404)
    const desk = await s.as('/api/booking/bookings', { method: 'POST', json: { serviceId: old.id, date: next(4), time: '11:00', name: 'A', email: 'a@example.com', phone: '608-555-0162' } })
    expect(desk.status).toBe(409)
    expect((await desk.json()).error).toContain('Service Menu')
    expect((await s.as(`/api/booking/services/${old.id}`, { method: 'PATCH', json: { slotStepMinutes: 15 } })).status).toBe(409)
    // It can be cleared away.
    expect((await s.as(`/api/booking/services/${old.id}`, { method: 'DELETE' })).status).toBe(200)
  })
})

describe('2. a new salon that takes bookings starts with a Service Menu item, not a stray service', () => {
  test('provisioned: a 30-minute Consultation on the menu, ticked bookable online, and that is what /book offers', async () => {
    const t = await bootTenant({ vertical: 'salon' })
    process.env.FACTORY_SYNC_KEY = 'factory-key-salon-online'
    const res = await t.call('/api/internal/provision', {
      method: 'POST', headers: { 'X-Factory-Key': 'factory-key-salon-online' },
      json: {
        company: { name: 'Shear Joy', slug: 'shear-joy', state: 'WI', timezone: TZ },
        owner: { email: 'owner@shear.example', passwordHash: await Bun.password.hash('Owner-pass-1-long', 'bcrypt'), firstName: 'Sam', lastName: 'Shear' },
        features: ['contacts', 'service_menu', 'salon_booking', 'online_booking'], industry: 'Hair Salon', takesBookings: true,
      },
    })
    expect(res.status).toBe(201)
    const menu = await t.db.select().from(t.schema.serviceMenu)
    expect(menu.map((m: any) => [m.name, m.durationMin, m.bookableOnline, m.active])).toEqual([['Consultation', 30, true, true]])
    const svc = await t.db.select().from(t.schema.bookingService)
    expect(svc.map((x: any) => [x.slug, x.serviceMenuId, x.active])).toEqual([['consultation', menu[0].id, true]])
    expect(await t.db.select().from(t.schema.bookingHours)).toEqual([])
    expect(((await json(t.call('/api/book/services'))).data as any[]).map((x) => x.name)).toEqual(['Consultation'])
    expect(((await json(t.call('/api/book/services/consultation/dates'))).data as any[]).length).toBeGreaterThan(10)
  }, 60_000)
})

describe('3. booking hours follow the opening hours until the owner sets their own — every vertical', () => {
  for (const vertical of ['salon', 'contractor']) {
    test(`${vertical}: starting week, then the opening hours, then the owner's own, then back`, async () => {
      const s = await tenant(vertical, vertical === 'salon' ? ['online_booking', 'contacts', 'salon_booking', 'service_menu'] : ['online_booking', 'contacts'])
      if (vertical === 'salon') await s.as('/api/service-menu', { method: 'POST', json: { name: 'Blow-dry', durationMin: 30, price: 30, bookableOnline: true } })
      else await s.as('/api/booking/services', { method: 'POST', json: { name: 'Blow-dry', durationMinutes: 30 } })
      const dates = async () => ((await json(s.t.call('/api/book/services/blow-dry/dates'))).data as string[])
      const days = async () => [...new Set((await dates()).map(weekdayOf))].sort()
      const hours = async () => json(s.as('/api/booking/hours'))

      // Nothing said yet: weekdays 9–5, and the screen is told so.
      expect((await hours()).from).toBe('starting')
      expect(await days()).toEqual([1, 2, 3, 4, 5])

      // The shop's opening hours, Tue–Sat (the live test's): bookings follow them.
      const tueSat = { monday: { closed: true }, tuesday: { open: '09:00', close: '17:00' }, wednesday: { open: '09:00', close: '17:00' }, thursday: { open: '10:00', close: '19:00' }, friday: { open: '09:00', close: '17:00' }, saturday: { open: '08:00', close: '14:00' }, sunday: { closed: true } }
      expect((await s.as('/api/company', { method: 'PUT', json: { settings: { businessHours: tueSat } } })).status).toBe(200)
      const following = await hours()
      expect(following.from).toBe('business')
      expect(following.data.map((w: any) => [w.dayOfWeek, w.startMinute, w.endMinute, w.userId])).toEqual([[2, 540, 1020, null], [3, 540, 1020, null], [4, 600, 1140, null], [5, 540, 1020, null], [6, 480, 840, null]])
      expect(await days()).toEqual([2, 3, 4, 5, 6])
      const sat = next(6)
      const satTimes = ((await json(s.t.call(`/api/book/services/blow-dry/times?date=${sat}`))).data as any[]).map((x) => x.time)
      expect(satTimes[0]).toBe('08:00')
      expect(satTimes).not.toContain('14:00')
      expect((await json(s.t.call(`/api/book/services/blow-dry/times?date=${next(1)}`))).data).toEqual([])

      // The owner's own booking hours: those, and opening hours changed later no longer move them.
      const own = await s.as('/api/booking/hours', { method: 'PUT', json: { hours: [{ dayOfWeek: 3, start: '12:00', end: '16:00' }] } })
      expect(own.status).toBe(200)
      expect((await own.json()).from).toBe('own')
      expect(await days()).toEqual([3])
      expect((await s.as('/api/company', { method: 'PUT', json: { settings: { businessHours: { ...tueSat, monday: { open: '09:00', close: '17:00' } } } } })).status).toBe(200)
      expect(await days()).toEqual([3])

      // An empty week of their own is theirs too: closed online, not handed back to the opening hours.
      expect((await s.as('/api/booking/hours', { method: 'PUT', json: { hours: [] } })).status).toBe(200)
      expect((await hours()).from).toBe('own')
      expect(await dates()).toEqual([])

      // Back to following the opening hours (now Mon–Sat).
      const back = await s.as('/api/booking/hours', { method: 'DELETE' })
      expect(back.status).toBe(200)
      expect((await back.json()).from).toBe('business')
      expect(await days()).toEqual([1, 2, 3, 4, 5, 6])
      expect(await s.t.db.select().from(s.t.schema.bookingHours)).toEqual([])
    }, 60_000)
  }
})

describe("migration 0036: existing businesses' menus and hours", () => {
  test('a ticked menu item gets its booking service; seeded hours are dropped (and said); the owner’s own are kept as theirs', async () => {
    const t = await bootTenant({ vertical: 'salon' })
    // Two businesses as they stood before (one company per tenant in life; two here to see both outcomes).
    const [seededCo] = await t.db.insert(t.schema.company).values({ name: 'Seeded Salon', slug: 'seeded' }).returning()
    const [ownCo] = await t.db.insert(t.schema.company).values({ name: 'Own Hours Salon', slug: 'own' }).returning()
    // Provisioning's rows: written in the company's own transaction, so stamped with its created_at.
    await t.db.insert(t.schema.bookingHours).values([1, 2, 3, 4, 5].map((d) => ({ companyId: seededCo.id, userId: null, dayOfWeek: d, startMinute: 540, endMinute: 1020, createdAt: seededCo.createdAt })))
    await t.db.insert(t.schema.bookingHours).values({ companyId: ownCo.id, userId: null, dayOfWeek: 2, startMinute: 600, endMinute: 900, createdAt: new Date(ownCo.createdAt.getTime() + 86_400_000) })
    const [ticked] = await t.db.insert(t.schema.serviceMenu).values({ companyId: seededCo.id, name: 'Balayage!', durationMin: 150, price: '180.00', bookableOnline: true }).returning()
    await t.db.insert(t.schema.serviceMenu).values({ companyId: seededCo.id, name: 'Beard trim', durationMin: 15, bookableOnline: false })
    // A slug already taken by an older engine row.
    await t.db.insert(t.schema.bookingService).values({ companyId: seededCo.id, slug: 'balayage', name: 'Old balayage', durationMinutes: 60 })

    const file = fs.readFileSync(path.join(import.meta.dir, '..', 'server', 'db', 'migrations', '0036_menu_bookings_hours.sql'), 'utf8')
    // The data statements (everything after the schema change, which the harness has already applied).
    const statements = file.split('--> statement-breakpoint').map((x) => x.trim()).filter((x) => /^(INSERT|WITH)/.test(x))
    expect(statements.length).toBe(3)
    for (const sql of statements) await t.client.exec(sql)

    const svc = await t.db.select().from(t.schema.bookingService).where(eq(t.schema.bookingService.serviceMenuId, ticked.id))
    expect(svc.map((x: any) => [x.name, x.durationMinutes, x.price, x.active, x.slug])).toEqual([['Balayage!', 150, '180.00', true, `balayage-${ticked.id.slice(0, 8).toLowerCase()}`]])
    expect((await t.db.select().from(t.schema.bookingService)).length).toBe(2)

    expect(await t.db.select().from(t.schema.bookingHours).where(eq(t.schema.bookingHours.companyId, seededCo.id))).toEqual([])
    const said = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.companyId, seededCo.id))
    expect(said.length).toBe(1)
    expect(JSON.stringify(said[0].metadata)).toContain('follow your opening hours')

    expect((await t.db.select().from(t.schema.bookingHours).where(eq(t.schema.bookingHours.companyId, ownCo.id))).length).toBe(1)
    const [ownSettings] = await t.db.select().from(t.schema.bookingSettings).where(eq(t.schema.bookingSettings.companyId, ownCo.id))
    expect(ownSettings.hoursSetAt).toBeTruthy()
    expect((await t.db.select().from(t.schema.bookingSettings).where(eq(t.schema.bookingSettings.companyId, seededCo.id))).length).toBe(0)

    // Run again (a retried deploy): nothing doubles.
    for (const sql of statements) await t.client.exec(sql)
    expect((await t.db.select().from(t.schema.bookingService)).length).toBe(2)
  }, 60_000)
})

describe('4 and the rule behind it: every vertical whose bookings land in its own book says where, and what its clients book from', () => {
  test("'chair' (the salon) has its book and its Service Menu on the screens; no other vertical claims a Service Menu", async () => {
    // Every vertical the app runs (core/vertical.ts loadVertical; roofing's folder is verticals/roof).
    const ids = ['contractor', 'fieldservice', 'basic', 'vet', 'salon', 'landscaping', 'restaurant', 'rv', 'bar', 'homecare', 'roofing', 'store']
    for (const id of ids) {
      const v = await loadVertical(id)
      const screens = (v.screens as any).booking ?? {}
      if (v.booking?.calendar === 'chair') {
        expect(screens.serviceMenuPath).toBe('/crm/service-menu')
        expect(screens.calendarPath).toBe('/crm/appointments')
      } else expect(screens.serviceMenuPath).toBeUndefined()
    }
  })

  test('the Bookings calendar hands over to that book: no menu item of its own, and its address goes there', () => {
    const shell = fs.readFileSync(path.join(import.meta.dir, '..', 'web', 'src', 'shell.ts'), 'utf8')
    expect(shell).toContain("typeof verticalScreens().booking.calendarPath === 'string' ? [] : [{ to: '/crm/bookings/calendar'")
    const app = fs.readFileSync(path.join(import.meta.dir, '..', 'web', 'src', 'App.tsx'), 'utf8')
    expect(app).toContain("<Route path=\"bookings/calendar\" element={typeof OWN_BOOK === 'string' ? <Navigate to={OWN_BOOK} replace /> : <BookingCalendarPage />} />")
  })
})
