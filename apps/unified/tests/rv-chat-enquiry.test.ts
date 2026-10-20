// The dealership website chat's lead on the one app's enquiry door (POST /api/leads, CrmSettings.websiteEnquiries
// 'pipeline', crm/rv/enquiry.ts) — what templates/crm-rv/backend/src/routes/webhooks.ts took from website-rv's
// /api/chat and /reserve (tests/rv/t59-website-lead-one-person.test.ts holds it on the template):
//   · a phone and no email is a lead (the chat asks for "a PHONE or EMAIL")
//   · `unitOfInterest` is on the lead's notes, and its stock number links the lead to THIS dealer's unit, case aside
//   · a stock number the dealer does not have links nothing and never breaks the enquiry
//   · a contractor's form with no email is still refused, as before
// rv-enquiry.test.ts holds the pipeline and one-person rule with an email; this file holds the chat's shape.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let otherCompanyId: string
let unitId: string
let ipCount = 0

// Each post from its own address: the form allows five per visitor per ten minutes.
const send = (body: Record<string, unknown>) =>
  t.call('/api/leads', { method: 'POST', json: body, headers: { 'X-Forwarded-For': `198.51.100.${++ipCount}` } })
const people = () => t.db.select().from(t.schema.contact).where(eq(t.schema.contact.companyId, companyId))
const leads = () => t.db.select().from(t.schema.salesLead).where(eq(t.schema.salesLead.companyId, companyId))
const leadOf = async (name: string) => {
  const p = (await people()).find((x: any) => x.name === name)
  return { person: p, lead: p ? (await leads()).find((l: any) => l.contactId === p.id) : undefined }
}

// The shape website-rv/server-static.ts posted from the AI chat.
const chat = (o: Record<string, unknown>) => ({ service: 'Website Chat', leadType: 'chat', source: 'website_chat', message: 'Captured by the AI chat assistant', ...o })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'rv' })
  const [co] = await t.db.insert(t.schema.company).values({ name: 'Lakeside RV', slug: 'lakeside-rv', email: 'owner@lakeside.example' }).returning()
  companyId = co.id
  const [u] = await t.db.insert(t.schema.unit).values({ companyId, category: 'travel_trailer', stockNumber: 'J1042', year: 2024, make: 'Jayco', modelName: 'Jay Flight' } as any).returning()
  unitId = u.id
  // Another company's unit with a stock number this dealer does not have: never linked.
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Dealer', slug: 'other-dealer', email: 'owner@other.example' }).returning()
  otherCompanyId = other.id
  await t.db.insert(t.schema.unit).values({ companyId: otherCompanyId, category: 'motorhome', stockNumber: 'X77', make: 'Winnebago', modelName: 'View' } as any).returning()
})

describe('the website chat\'s lead at a dealership', () => {
  test('a phone and no email is accepted: a lead contact with the phone, and a sales lead at new', async () => {
    const r = await send(chat({ name: 'Rita Rambler', phone: '(608) 555-0181', email: '', unitOfInterest: 'Jayco' }))
    expect(r.status).toBe(200)
    const { person, lead } = await leadOf('Rita Rambler')
    expect(person).toMatchObject({ type: 'lead', phone: '(608) 555-0181', source: 'website_chat' })
    expect(person!.email).toBeFalsy()
    expect(lead).toMatchObject({ stage: 'new', source: 'website_chat', unitId: null })
    expect(lead!.notes).toContain('Interested in: Jayco')
    expect(lead!.notes).toContain('Captured by the AI chat assistant')
  })

  test('a stock number links the lead to that unit, case aside, and the interest is on the notes once', async () => {
    const r = await send(chat({ name: 'Vic Viewer', phone: '608-555-0199', unitOfInterest: '2024 Jayco Jay Flight (Stock #j1042)' }))
    expect(r.status).toBe(200)
    const { lead } = await leadOf('Vic Viewer')
    expect(lead!.unitId).toBe(unitId)
    expect(lead!.notes).toContain('Interested in: 2024 Jayco Jay Flight (Stock #j1042)')
    expect(lead!.notes!.split('Jay Flight').length - 1).toBe(1)
  })

  test('a unit of interest is enough without a message, as the reserve button sends it', async () => {
    const r = await send({ name: 'Ray Reserve', phone: '608-555-0111', source: 'inventory-detail', unitOfInterest: '2024 Jayco Jay Flight (Stock #J1042)' })
    expect(r.status).toBe(200)
    expect((await leadOf('Ray Reserve')).lead!.unitId).toBe(unitId)
  })

  test('a stock number this dealer does not have links nothing, and the enquiry is still taken', async () => {
    expect((await send(chat({ name: 'Wes Wanderer', phone: '608-555-0122', unitOfInterest: 'something with bunks (Stock #NOPE9)' }))).status).toBe(200)
    const wes = await leadOf('Wes Wanderer')
    expect(wes.lead).toMatchObject({ unitId: null, stage: 'new' })
    expect(wes.lead!.notes).toContain('Interested in: something with bunks')
    // Another company's stock number is not this dealer's unit.
    expect((await send(chat({ name: 'Olive Other', phone: '608-555-0133', unitOfInterest: 'View (Stock #X77)' }))).status).toBe(200)
    expect((await leadOf('Olive Other')).lead!.unitId).toBeNull()
  })

  test('neither an email nor a phone is refused; a bad email is refused; nothing to go on is refused', async () => {
    const before = (await leads()).length
    expect((await send(chat({ name: 'No Way', unitOfInterest: 'Jayco' }))).status).toBe(400)
    expect((await send(chat({ name: 'Bad Mail', email: 'not-an-email', phone: '608-555-0144' }))).status).toBe(400)
    expect((await send({ name: 'Blank Ask', phone: '608-555-0155' })).status).toBe(400)
    expect((await leads()).length).toBe(before)
  })

  test('the spam checks still hold: the honeypot is a quiet thanks and saves nothing', async () => {
    const before = (await leads()).length
    expect((await send(chat({ name: 'Bot Bot', phone: '608-555-0166', website: 'http://spam.example' }))).status).toBe(200)
    expect((await leads()).length).toBe(before)
  })
})

describe('other verticals', () => {
  test('a contractor\'s form with a phone and no email is still refused, and unitOfInterest is just an answer', async () => {
    const c = await bootTenant({ vertical: 'contractor' })
    await seedOwner(c)
    const r = await c.call('/api/leads', { method: 'POST', json: { name: 'Pat Painter', phone: '715-555-0100', message: 'Need a quote', unitOfInterest: 'Stock #J1042' }, headers: { 'X-Forwarded-For': '198.51.100.250' } })
    expect(r.status).toBe(400)
  })
})
