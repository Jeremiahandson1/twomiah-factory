// One contact-delete rule for both doors (tenant-backend createContactDeleter, built with the vertical's guards in
// server/modules/crm.ts and handed to the bulk door as CrmDeps.contactDeleter). Salon live test, 2026-10-25: POST
// /api/bulk/contacts/delete ran no guard at all — a salon client with appointments, visits and a membership was deleted,
// which the contact's own DELETE refuses. Now each contact in a bulk delete is deleted or refused by the same rule, and
// the answer names who was refused and why, in the single delete's own words. Every vertical's guards flow through it.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

async function tenant(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, seeded.company.id))
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  const as = async (method: string, path: string, json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${token}` } })
    const s = await r.text()
    return { status: r.status, body: s ? JSON.parse(s) : null }
  }
  const contactNamed = async (name: string, type = 'client') => (await as('POST', '/api/contacts', { name, type })).body.id as string
  const exists = async (id: string) => (await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, id))).length === 1
  return { t, as, contactNamed, exists, companyId: seeded.company.id as string }
}

/**
 * The single DELETE's refusal for this contact, read BEFORE the bulk door runs (a 409 deletes nothing), and the bulk
 * door's answer: the free ones deleted, the held one refused with that same sentence.
 */
async function bothDoors(x: Awaited<ReturnType<typeof tenant>>, held: string, free: string[]) {
  const single = await x.as('DELETE', `/api/contacts/${held}`)
  expect(single.status).toBe(409)
  const bulk = await x.as('POST', '/api/bulk/contacts/delete', { ids: [held, ...free] })
  expect(bulk.status).toBe(200)
  expect(bulk.body.deleted).toBe(free.length)
  expect([...bulk.body.deletedIds].sort()).toEqual([...free].sort())
  expect(bulk.body.refused).toHaveLength(1)
  expect(bulk.body.refused[0]).toMatchObject({ id: held, error: single.body.error })
  expect(bulk.body.refused[0].name).toBeTruthy()
  expect(await x.exists(held)).toBe(true)
  for (const id of free) expect(await x.exists(id)).toBe(false)
  return bulk.body.refused[0].error as string
}

describe('the bulk delete runs the contact-delete rule, per contact, in every vertical', () => {
  test('salon: a client with a visit and an appointment is refused and named; a free client is deleted', async () => {
    const x = await tenant('salon', ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking'])
    const held = await x.contactNamed('Has Visits')
    expect((await x.as('POST', '/api/service-records', { contactId: held, notes: 'Cut' })).status).toBe(201)
    expect((await x.as('POST', '/api/appointments', { contactId: held, startTime: new Date(Date.now() + 86400000).toISOString() })).status).toBe(201)
    const free = await x.contactNamed('Free Client')
    const why = await bothDoors(x, held, [free])
    expect(why).toMatch(/1 appointment/)
    expect(why).toMatch(/1 service record/)
  }, 60_000)

  test("vet: an owner with a patient is refused in the vet's own words", async () => {
    const x = await tenant('vet', ['contacts', 'patient_records'])
    const held = await x.contactNamed('Pet Owner')
    await x.t.db.insert(x.t.schema.patient).values({ companyId: x.companyId, ownerId: held, name: 'Biscuit' } as any)
    const free = await x.contactNamed('No Pets')
    const why = await bothDoors(x, held, [free])
    expect(why).toMatch(/1 patient with medical history/)
  }, 60_000)

  test('contractor: a customer with an invoice is refused (the standard guards); the others are deleted', async () => {
    const x = await tenant('contractor', ['contacts', 'invoices'])
    const held = await x.contactNamed('Owes Money')
    await x.t.db.insert(x.t.schema.invoice).values({ companyId: x.companyId, contactId: held, number: 'INV-1', status: 'sent', subtotal: '10', total: '10' } as any)
    const free = [await x.contactNamed('Free One', 'lead'), await x.contactNamed('Free Two', 'vendor')]
    const why = await bothDoors(x, held, free)
    expect(why).toMatch(/1 invoice/)
  }, 60_000)

  test("another company's contact, or one that is not there, is refused as not found and never deleted", async () => {
    const x = await tenant('contractor', ['contacts'])
    const [other] = await x.t.db.insert(x.t.schema.company).values({ name: 'Other Co', slug: 'other-co' }).returning()
    const [theirs] = await x.t.db.insert(x.t.schema.contact).values({ companyId: other.id, name: 'Not Yours', type: 'client' } as any).returning()
    const bulk = await x.as('POST', '/api/bulk/contacts/delete', { ids: [theirs.id, 'no-such-id'] })
    expect(bulk.status).toBe(200)
    expect(bulk.body.deleted).toBe(0)
    expect(bulk.body.refused.map((r: any) => r.error)).toEqual(['Contact not found', 'Contact not found'])
    expect(await x.exists(theirs.id)).toBe(true)
  }, 60_000)
})
