// The veterinary vertical (verticals/vet/settings.ts, server/crm/vet, from templates/crm-vet) through the real server:
// its modules answer behind their features, /api/dashboard and /api/appointments are the practice's, the refusals the
// chart and the book act on carry their codes (a double-book, a documented allergy, a billed visit), an owner's record
// lists their pets and search finds a pet by name. The reply shapes here are the rulebook's; the vet suite's documented
// divergences (tests/unified/harness/unified-divergences.ts, vet) name what they replaced.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
let companyId = ''
let ownerId = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { Authorization: `Bearer ${token}` } })
const features = (list: string[]) => as('/api/company/features', { method: 'PUT', json: { features: list } })
const VET = ['contacts', 'invoices', 'team', 'dashboard', 'documents', 'patient_records', 'appointment_scheduling', 'medical_records', 'vaccinations', 'reminders_recall', 'wellness_plans']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'vet' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ownerId = seeded.owner.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  expect((await features(VET)).status).toBe(200)
}, 60_000)

const newOwnerAndPet = async (name: string, allergies?: string) => {
  const client = await (await as('/api/contacts', { method: 'POST', json: { name: `${name} Owner`, type: 'client' } })).json()
  const pet = await (await as('/api/patients', { method: 'POST', json: { ownerId: client.id, name, species: 'dog', ...(allergies ? { allergies } : {}) } })).json()
  return { client, pet }
}

describe('vet', () => {
  test("its modules answer behind their features (the template's menu gates)", async () => {
    // Patients, the book and recall are the vet's core features (always on); wellness plans are a switch.
    expect((await features(['contacts'])).status).toBe(200)
    const off = await as('/api/wellness-plans')
    expect((await features(VET)).status).toBe(200)
    expect(off.status).toBe(403)
    expect((await off.json()).code).toBe('FEATURE_NOT_ENABLED')
    for (const p of ['/api/patients', '/api/visits', '/api/vaccinations', '/api/prescriptions', '/api/lab-results', '/api/appointments', '/api/reminders/due', '/api/reminders/lapsed', '/api/wellness-plans', '/api/wellness-plans/enrollments', '/api/tasks']) {
      expect((await as(p)).status).toBe(200)
    }
  }, 30_000)

  test('lists are { data, pagination }; the dashboard is the practice\'s', async () => {
    await newOwnerAndPet('Biscuit')
    const list = await (await as('/api/patients')).json()
    expect(list.pagination).toEqual({ page: 1, limit: 50, total: expect.any(Number), pages: expect.any(Number) })
    expect(list.data.some((p: any) => p.name === 'Biscuit' && p.ownerName === 'Biscuit Owner')).toBe(true)
    for (const p of ['/api/appointments', '/api/visits', '/api/vaccinations', '/api/wellness-plans']) {
      const body = await (await as(p)).json()
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.pagination).toBeDefined()
    }
    const stats = await (await as('/api/dashboard/stats')).json()
    expect(stats.patients.active).toBeGreaterThan(0)
    expect(stats.visits).toBeDefined()
    expect(stats.reminders).toEqual({ overdue: expect.any(Number), dueSoon: expect.any(Number) })
  }, 30_000)

  test('an owner\'s record lists their pets, and they are not deleted while they have any', async () => {
    const { client } = await newOwnerAndPet('Pepper')
    const contact = await (await as(`/api/contacts/${client.id}`)).json()
    expect(contact.patients.map((p: any) => p.name)).toEqual(['Pepper'])
    const del = await as(`/api/contacts/${client.id}`, { method: 'DELETE' })
    expect(del.status).toBe(409)
    expect((await del.json()).error).toMatch(/patient/)
  }, 30_000)

  test('a double-booked provider or room is a 409 appointment_conflict; allowConflict books it anyway', async () => {
    const { client, pet } = await newOwnerAndPet('Mochi')
    const start = new Date(Date.now() + 5 * 86400000)
    start.setUTCHours(15, 0, 0, 0)
    const at = (mins: number) => new Date(start.getTime() + mins * 60000).toISOString()
    const first = await as('/api/appointments', { method: 'POST', json: { patientId: pet.id, ownerId: client.id, providerId: ownerId, room: 'Room 7', startTime: at(0), endTime: at(30) } })
    expect(first.status).toBe(201)
    const sameVet = await as('/api/appointments', { method: 'POST', json: { patientId: pet.id, providerId: ownerId, startTime: at(10), endTime: at(40) } })
    expect(sameVet.status).toBe(409)
    expect((await sameVet.json()).code).toBe('appointment_conflict')
    const sameRoom = await as('/api/appointments', { method: 'POST', json: { patientId: pet.id, room: ' room 7 ', startTime: at(15), endTime: at(45) } })
    expect(sameRoom.status).toBe(409)
    const room = await sameRoom.json()
    expect(room.code).toBe('appointment_conflict')
    expect(room.error).toMatch(/already booked/)
    const anyway = await as('/api/appointments', { method: 'POST', json: { patientId: pet.id, room: 'Room 7', startTime: at(15), endTime: at(45), allowConflict: true } })
    expect(anyway.status).toBe(201)
  }, 30_000)

  test('a script over a documented allergy is a 409 allergy_conflict until it is acknowledged', async () => {
    const { pet } = await newOwnerAndPet('Rufus', 'penicillin')
    const refused = await as('/api/prescriptions', { method: 'POST', json: { patientId: pet.id, drug: 'Amoxicillin' } })
    expect(refused.status).toBe(409)
    const body = await refused.json()
    expect(body.code).toBe('allergy_conflict')
    expect(body.error).toMatch(/penicillin/i)
    const ok = await as('/api/prescriptions', { method: 'POST', json: { patientId: pet.id, drug: 'Amoxicillin', acknowledgeAllergy: true } })
    expect(ok.status).toBe(201)
  }, 30_000)

  test('a billed visit is not deleted: 409 visit_already_invoiced, naming the invoice in the sentence', async () => {
    const { pet } = await newOwnerAndPet('Hazel')
    const visit = await (await as('/api/visits', { method: 'POST', json: { patientId: pet.id, reason: 'Check-up', total: 88 } })).json()
    const inv = await as(`/api/visits/${visit.id}/invoice`, { method: 'POST' })
    expect(inv.status).toBe(201)
    const invoice = await inv.json()
    expect((await as(`/api/visits/${visit.id}/invoice`, { method: 'POST' })).status).toBe(409)
    const del = await as(`/api/visits/${visit.id}`, { method: 'DELETE' })
    expect(del.status).toBe(409)
    const body = await del.json()
    expect(body.code).toBe('visit_already_invoiced')
    expect(body.error).toContain(invoice.number)
    // The invoice names the animal (CrmSettings.patients: invoices link a patient).
    const forPet = await (await as(`/api/invoices?patientId=${pet.id}`)).json()
    expect(forPet.data.map((i: any) => i.id)).toEqual([invoice.id])
  }, 30_000)

  test('search finds a pet by name', async () => {
    await newOwnerAndPet('Zephyrine')
    const r = await (await as('/api/search?q=Zephyr')).json()
    expect(r.results.some((x: any) => x.type === 'patient' && x.name === 'Zephyrine' && x.url.startsWith('/crm/patients/'))).toBe(true)
  }, 30_000)
})

describe('contractor', () => {
  test('a business without patient records is not offered patients in search, and has no practice book', async () => {
    const c = await bootTenant({ vertical: 'contractor' })
    const seeded = await seedOwner(c)
    const tok = (await (await c.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
    const r = await c.call('/api/search?q=anything', { headers: { Authorization: `Bearer ${tok}` } })
    expect(r.status).toBe(200)
    expect((await r.json()).results.every((x: any) => x.type !== 'patient')).toBe(true)
    // The practice's dashboard is the vet's only.
    const stats = await (await c.call('/api/dashboard/stats', { headers: { Authorization: `Bearer ${tok}` } })).json()
    expect(stats.patients).toBeUndefined()
    expect(companyId).toBeTruthy()
  }, 60_000)
})
