// A pet owner books online (VerticalSettings.booking.calendar 'practice', server/crm/vet/onlineBooking.ts): the live vet
// CRM made the owner, the pet's chart and an appointment for both (templates/crm-vet routes/booking.ts), and refused a
// booking with no pet ("The pet's name is required."). Booked again for the same owner and pet, both are found again.
// Every other vertical's booking is unchanged: no pet asked, no chart, no appointment.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createBookingEngine } from '../server/booking/engine.ts'
import { addDays, tzParts, zonedWallTimeToUtc } from '@twomiah/tenant-backend'

/** A weekday at least two days out, in Chicago. */
function weekday() {
  let d = addDays(tzParts(new Date(), 'America/Chicago').date, 2)
  while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = addDays(d, 1)
  return d
}

/** A tenant with online booking on, one 30-minute service, and weekday hours 08:00–16:00. */
async function bookingTenant(vertical: string) {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken as string
  const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  // The owner's own switch, for every vertical: the registry offers online_booking to crm-vet (the live vet CRM had it on).
  const features = vertical === 'vet' ? ['online_booking', 'appointment_scheduling', 'patient_records'] : vertical === 'salon' ? ['online_booking', 'service_menu'] : ['online_booking']
  expect((await as('/api/company/features', { method: 'PUT', json: { features } })).status).toBe(200)
  // One clock (coordinator 10/23): the business's zone, set in Settings › Company, is the one Bookings keeps time on.
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, seeded.company.id))
  expect((await as('/api/booking/settings', { method: 'PATCH', json: { timezone: 'America/Chicago', leadTimeMinutes: 60, maxDaysOut: 30 } })).status).toBe(200)
  // A salon's online services are its Service Menu's (salon live test, 2026-10-25: crm/salon/onlineBooking.ts); every
  // other vertical makes them in Booking settings.
  let slug: string
  if (vertical === 'salon') {
    const item = await as('/api/service-menu', { method: 'POST', json: { name: 'Wellness exam', durationMin: 30, price: 65, bookableOnline: true } })
    expect(item.status).toBe(201)
    slug = ((await (await as('/api/booking/services')).json()).data as any[])[0].slug
  } else {
    const svc = await as('/api/booking/services', { method: 'POST', json: { name: 'Wellness exam', durationMinutes: 30, price: 65, slotStepMinutes: 30 } })
    expect(svc.status).toBe(201)
    slug = (await svc.json()).slug
  }
  const hours = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '08:00', end: '16:00' }))
  expect((await as('/api/booking/hours', { method: 'PUT', json: { hours } })).status).toBe(200)
  return { t, as, companyId: seeded.company.id as string, ownerId: seeded.owner.id as string, slug }
}

describe('vet: a public booking becomes the owner, the pet and the appointment', () => {
  let v: Awaited<ReturnType<typeof bookingTenant>>
  const day = weekday()
  const book = (json: Record<string, unknown>) => v.t.call(`/api/book/services/${v.slug}`, { method: 'POST', json: { date: day, phone: '608-555-0101', ...json } })
  const rows = async () => ({
    contacts: await v.t.db.select().from(v.t.schema.contact),
    patients: await v.t.db.select().from(v.t.schema.patient),
    appointments: await v.t.db.select().from(v.t.schema.appointment),
    bookings: await v.t.db.select().from(v.t.schema.booking),
  })

  beforeAll(async () => { v = await bookingTenant('vet') }, 60_000)

  test("the form asks for the pet's name (required) and species", async () => {
    const html = await (await v.t.call(`/book/${v.slug}`)).text()
    expect(html).toMatch(/<label>Pet&#39;s name<input type="text" name="petName"[^>]* required>/)
    expect(html).toContain('name="petSpecies"')
    expect(html).toContain('Address (optional)')
  })

  test("no pet: refused with the live CRM's sentence, and nothing is written", async () => {
    const r = await book({ time: '08:00', name: 'Dana Fox', email: 'dana@example.com' })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe("The pet's name is required.")
    const blank = await book({ time: '08:00', name: 'Dana Fox', email: 'dana@example.com', petName: '   ' })
    expect(blank.status).toBe(400)
    const now = await rows()
    expect(now.bookings.length).toBe(0)
    expect(now.contacts.length).toBe(0)
    expect(now.patients.length).toBe(0)
    expect(now.appointments.length).toBe(0)
  })

  test('with a pet: the owner, the chart and the appointment, linked together', async () => {
    const r = await book({ time: '09:00', name: 'Dana Fox', email: 'Dana@Example.com', phone: '608-555-0101', petName: 'Bella', petSpecies: 'Puppy', notes: 'Limping on the left paw' })
    expect(r.status).toBe(201)
    const { contacts, patients, appointments, bookings } = await rows()
    expect(contacts.length).toBe(1)
    expect(contacts[0]).toMatchObject({ email: 'dana@example.com', name: 'Dana Fox', type: 'client', source: 'online_booking' })
    expect(patients.length).toBe(1)
    // "Puppy" is placed in the practice's vocabulary.
    expect(patients[0]).toMatchObject({ ownerId: contacts[0].id, name: 'Bella', species: 'dog', companyId: v.companyId })
    expect(appointments.length).toBe(1)
    expect(bookings.length).toBe(1)
    const a = appointments[0], b = bookings[0]
    expect(a).toMatchObject({ ownerId: contacts[0].id, patientId: patients[0].id, status: 'scheduled', type: 'wellness', reason: 'Wellness exam', companyId: v.companyId })
    expect(a.startTime.getTime()).toBe(b.startAt.getTime())
    expect(a.endTime!.getTime()).toBe(b.endAt.getTime())
    expect(a.notes).toBe('Online booking: Wellness exam — Limping on the left paw')
    expect(b.contactId).toBe(contacts[0].id)
    expect(b.appointmentId).toBe(a.id) // the booking knows its appointment (the template's online_booking.appointment_id)
  })

  test('the same owner and pet again: both are found, not made twice; the name typed is kept', async () => {
    const r = await book({ time: '10:00', name: 'Sam Fox', email: 'dana@example.com', petName: '  bella ', petSpecies: 'cat' })
    expect(r.status).toBe(201)
    const { contacts, patients, appointments } = await rows()
    expect(contacts.length).toBe(1)
    expect(contacts[0].name).toBe('Dana Fox') // the owner's record is not overwritten
    expect(patients.length).toBe(1)
    expect(patients[0].species).toBe('dog') // the chart is not changed by a booking
    expect(appointments.length).toBe(2)
    const second = appointments.find((a) => a.id !== appointments[0].id && a.notes?.includes('Sam Fox')) ?? appointments.find((a) => a.notes?.includes('Booked by'))
    expect(second).toMatchObject({ ownerId: contacts[0].id, patientId: patients[0].id })
    expect(second!.notes).toBe('Online booking: Wellness exam — Booked by Sam Fox (account: Dana Fox)')
  })

  test("another pet of the same owner gets its own chart; a species we can't place is kept on its notes", async () => {
    const r = await book({ time: '11:00', name: 'Dana Fox', email: 'dana@example.com', petName: 'Sparkle', petSpecies: 'Unicorn' })
    expect(r.status).toBe(201)
    const { contacts, patients, appointments } = await rows()
    expect(contacts.length).toBe(1)
    expect(patients.length).toBe(2)
    const sparkle = patients.find((p) => p.name === 'Sparkle')!
    expect(sparkle).toMatchObject({ ownerId: contacts[0].id, species: 'other', notes: 'Species as booked: "Unicorn"' })
    expect(appointments.filter((a) => a.patientId === sparkle.id).length).toBe(1)
  })

  test('the same pet name under a different owner is a different pet', async () => {
    const r = await book({ time: '12:00', name: 'Lee Park', email: 'lee@example.com', petName: 'Bella' })
    expect(r.status).toBe(201)
    const { contacts, patients } = await rows()
    expect(contacts.length).toBe(2)
    const lee = contacts.find((c) => c.email === 'lee@example.com')!
    const leesBella = patients.filter((p) => p.ownerId === lee.id)
    expect(leesBella.length).toBe(1)
    expect(leesBella[0]).toMatchObject({ name: 'Bella', species: 'other' }) // unanswered is not a dog
  })

  const at = (d: string, hm: string) => zonedWallTimeToUtc(d, hm, 'America/Chicago')
  const apptOf = async (token: string) => {
    const [b] = await v.t.db.select().from(v.t.schema.booking).where(eq(v.t.schema.booking.token, token))
    const [a] = await v.t.db.select().from(v.t.schema.appointment).where(eq(v.t.schema.appointment.id, b.appointmentId!))
    return { b, a }
  }

  test('the booking moved: its appointment moves with it; cancelled: its appointment is cancelled', async () => {
    const r = await book({ time: '14:00', name: 'Kim Day', email: 'kim@example.com', petName: 'Rufus' })
    expect(r.status).toBe(201)
    const { token } = await r.json()
    const moved = await v.t.call(`/api/book/bookings/${token}/reschedule`, { method: 'POST', json: { date: day, time: '15:00' } })
    expect(moved.status).toBe(200)
    let { b, a } = await apptOf(token)
    expect(a.startTime.getTime()).toBe(at(day, '15:00').getTime())
    expect(a.endTime!.getTime()).toBe(at(day, '15:30').getTime())
    expect(a.startTime.getTime()).toBe(b.startAt.getTime())
    expect(a.status).toBe('scheduled')
    const gone = await v.t.call(`/api/book/bookings/${token}/cancel`, { method: 'POST', json: {} })
    expect(gone.status).toBe(200)
    ;({ a } = await apptOf(token))
    expect(a.status).toBe('cancelled')
    // A cancelled appointment holds no time: 15:00 is on offer again.
    const times = (await (await v.t.call(`/api/book/services/${v.slug}/times?date=${day}`)).json()).data.map((x: any) => x.time)
    expect(times).toContain('15:00')
  })

  test('staff cancelling a booking: its appointment follows', async () => {
    const r = await book({ time: '15:30', name: 'Kim Day', email: 'kim@example.com', petName: 'Rufus' })
    const { token } = await r.json()
    const { b } = await apptOf(token)
    const viaStaff = await v.as(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { status: 'cancelled' } })
    expect(viaStaff.status).toBe(200)
    expect((await apptOf(token)).a.status).toBe('cancelled')
  })

  test("the desk's appointments hold their time online: everybody's with no provider, the provider's own when named", async () => {
    let day2 = addDays(day, 1)
    while ([0, 6].includes(new Date(day2 + 'T12:00:00Z').getUTCDay())) day2 = addDays(day2, 1)
    const times = async () => (await (await v.t.call(`/api/book/services/${v.slug}/times?date=${day2}`)).json()).data.map((x: any) => x.time) as string[]
    const desk = (json: Record<string, unknown>) => v.as('/api/appointments', { method: 'POST', json: { type: 'sick', ...json } })
    expect(await times()).toContain('09:00')
    // No provider named: the practice's time is taken.
    expect((await desk({ startTime: at(day2, '09:00').toISOString(), endTime: at(day2, '09:30').toISOString() })).status).toBe(201)
    expect(await times()).not.toContain('09:00')
    expect(await times()).toContain('09:30')
    // A desk appointment without an end holds the book's 30 minutes.
    expect((await desk({ startTime: at(day2, '10:00').toISOString() })).status).toBe(201)
    expect(await times()).not.toContain('10:00')
    expect(await times()).toContain('10:30')
    // A cancelled desk appointment holds nothing.
    const c = await desk({ startTime: at(day2, '11:00').toISOString(), status: 'cancelled' })
    expect(c.status).toBe(201)
    expect(await times()).toContain('11:00')
    // Two vets with their own hours: one vet's appointment leaves the other free, and the booking goes to the free one.
    const [vet2] = await v.t.db.insert(v.t.schema.user).values({ email: 'vet2@test.example', passwordHash: 'x', firstName: 'Val', lastName: 'Vet', role: 'field', companyId: v.companyId }).returning()
    const hours = [1, 2, 3, 4, 5].flatMap((d) => [v.ownerId, vet2.id].map((userId) => ({ userId, dayOfWeek: d, start: '08:00', end: '16:00' })))
    expect((await v.as('/api/booking/hours', { method: 'PUT', json: { hours } })).status).toBe(200)
    expect((await desk({ startTime: at(day2, '13:00').toISOString(), endTime: at(day2, '13:30').toISOString(), providerId: v.ownerId })).status).toBe(201)
    expect(await times()).toContain('13:00')
    const r = await book({ date: day2, time: '13:00', name: 'Kim Day', email: 'kim@example.com', petName: 'Rufus' })
    expect(r.status).toBe(201)
    const { b, a } = await apptOf((await r.json()).token)
    expect(b.assignedUserId).toBe(vet2.id)
    expect(a.providerId).toBe(vet2.id)
    // Both vets now busy at 13:00: the owner at the desk, the second with the booking.
    expect(await times()).not.toContain('13:00')
    // An appointment a booking made is that booking's own time, not a second hold: cancelling the booking frees it.
    expect((await v.t.call(`/api/book/bookings/${b.token}/cancel`, { method: 'POST', json: {} })).status).toBe(200)
    expect(await times()).toContain('13:00')
  })

  test('the chart and the appointment are written in the booking\'s own transaction: a failure undoes the booking', async () => {
    const before = await rows()
    const engine = createBookingEngine({
      db: v.t.db, requireAddressDefault: false,
      addOn: { questions: [], booked: async (tx) => {
        await tx.insert(v.t.schema.patient).values({ companyId: v.companyId, ownerId: before.contacts[0].id, name: 'Ghost' })
        throw new Error('the add-on failed')
      } },
    })
    await expect(engine.book(v.companyId, { service: v.slug, date: day, time: '13:00', name: 'Dana Fox', email: 'dana@example.com', phone: '608-555-0101' }, { by: 'customer' })).rejects.toThrow('the add-on failed')
    const after = await rows()
    expect(after.bookings.length).toBe(before.bookings.length)
    expect(after.patients.length).toBe(before.patients.length)
    expect(after.patients.some((p) => p.name === 'Ghost')).toBe(false)
  })
})

describe('every other vertical: no pet', () => {
  // The salon's booking is an appointment in The Book (calendar 'chair', crm/salon/onlineBooking.ts — fix-h,
  // booking-doors-1023.test.ts) but never a pet's chart; the contractor's is the booking alone.
  for (const vertical of ['salon', 'contractor']) {
    test(`${vertical}: no pet asked, none needed, no chart made${vertical === 'salon' ? '; the appointment is in The Book, with no patient' : ', no appointment'}`, async () => {
      const v = await bookingTenant(vertical)
      const html = await (await v.t.call(`/book/${v.slug}`)).text()
      expect(html).not.toContain('petName')
      const r = await v.t.call(`/api/book/services/${v.slug}`, { method: 'POST', json: { date: weekday(), time: '09:00', name: 'Ann Lee', email: 'ann@example.com', phone: '608-555-0102', address: '1 Elm St', petName: 'Rex' } })
      expect(r.status).toBe(201)
      expect((await v.t.db.select().from(v.t.schema.booking)).length).toBe(1)
      expect((await v.t.db.select().from(v.t.schema.patient)).length).toBe(0)
      const appts = await v.t.db.select().from(v.t.schema.appointment)
      const [b] = await v.t.db.select().from(v.t.schema.booking).where(eq(v.t.schema.booking.customerEmail, 'ann@example.com'))
      expect(b.contactId).toBeTruthy()
      if (vertical === 'salon') {
        expect(appts).toHaveLength(1)
        expect(appts[0].patientId).toBeNull()
        expect(appts[0].contactId).toBe(b.contactId)
        expect(b.appointmentId).toBe(appts[0].id)
        // The menu item booked, at its price (salon live test, 2026-10-25).
        const [menu] = await v.t.db.select().from(v.t.schema.serviceMenu)
        expect(appts[0].serviceId).toBe(menu.id)
        expect(Number(appts[0].quotedPrice)).toBe(65)
      } else expect(appts).toHaveLength(0)
    }, 60_000)
  }
})
