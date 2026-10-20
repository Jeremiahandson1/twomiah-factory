// A pet owner books online (VerticalSettings.booking.calendar 'practice', server/crm/vet/onlineBooking.ts): the live vet
// CRM made the owner, the pet's chart and an appointment for both (templates/crm-vet routes/booking.ts), and refused a
// booking with no pet ("The pet's name is required."). Booked again for the same owner and pet, both are found again.
// Every other vertical's booking is unchanged: no pet asked, no chart, no appointment.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createBookingEngine } from '../server/booking/engine.ts'
import { addDays, tzParts } from '@twomiah/tenant-backend'

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
  if (vertical === 'vet') {
    // The registry does not offer online_booking to crm-vet (packages/tenant-backend featureRegistry.ts), so the Settings
    // switch refuses it; the live vet CRM mounted /api/booking with no feature at all. Switched on in the row here.
    await t.db.update(t.schema.company).set({ enabledFeatures: [...(seeded.company.enabledFeatures as string[] ?? []), 'online_booking'] }).where(eq(t.schema.company.id, seeded.company.id))
  } else expect((await as('/api/company/features', { method: 'PUT', json: { features: ['online_booking'] } })).status).toBe(200)
  expect((await as('/api/booking/settings', { method: 'PATCH', json: { timezone: 'America/Chicago', leadTimeMinutes: 60, maxDaysOut: 30 } })).status).toBe(200)
  const svc = await as('/api/booking/services', { method: 'POST', json: { name: 'Wellness exam', durationMinutes: 30, price: 65, slotStepMinutes: 30 } })
  expect(svc.status).toBe(201)
  const hours = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '08:00', end: '16:00' }))
  expect((await as('/api/booking/hours', { method: 'PUT', json: { hours } })).status).toBe(200)
  return { t, as, companyId: seeded.company.id as string, slug: (await svc.json()).slug as string }
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

describe('every other vertical: unchanged', () => {
  for (const vertical of ['salon', 'contractor']) {
    test(`${vertical}: no pet asked, none needed, no chart or appointment made`, async () => {
      const v = await bookingTenant(vertical)
      const html = await (await v.t.call(`/book/${v.slug}`)).text()
      expect(html).not.toContain('petName')
      const r = await v.t.call(`/api/book/services/${v.slug}`, { method: 'POST', json: { date: weekday(), time: '09:00', name: 'Ann Lee', email: 'ann@example.com', phone: '608-555-0102', address: '1 Elm St', petName: 'Rex' } })
      expect(r.status).toBe(201)
      expect((await v.t.db.select().from(v.t.schema.booking)).length).toBe(1)
      expect((await v.t.db.select().from(v.t.schema.patient)).length).toBe(0)
      expect((await v.t.db.select().from(v.t.schema.appointment)).length).toBe(0)
      const [b] = await v.t.db.select().from(v.t.schema.booking).where(eq(v.t.schema.booking.customerEmail, 'ann@example.com'))
      expect(b.contactId).toBeTruthy()
    }, 60_000)
  }
})
