// A dealership's website enquiry goes into the sales pipeline (CrmSettings.websiteEnquiries 'pipeline'), and a
// returning customer is not a new person — what tests/rv/t59-website-lead-one-person.test.ts holds for the template's
// POST /api/webhooks/leads, held here on the one app's own enquiry door (POST /api/leads, the site's contact form).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string

beforeAll(async () => {
  t = await bootTenant({ vertical: 'rv' })
  const [co] = await t.db.insert(t.schema.company).values({ name: 'Lakeside RV', slug: 'lakeside-rv', email: 'owner@lakeside.example' }).returning()
  companyId = co.id
})

const send = (body: Record<string, unknown>) =>
  t.call('/api/leads', { method: 'POST', json: body, headers: { 'X-Forwarded-For': '203.0.113.' + Math.floor(Math.random() * 250) } })
const people = () => t.db.select().from(t.schema.contact).where(eq(t.schema.contact.companyId, companyId))
const leads = () => t.db.select().from(t.schema.salesLead).where(eq(t.schema.salesLead.companyId, companyId))

describe('a dealership website enquiry', () => {
  test('is a lead contact and ONE sales lead at new, in the pipeline', async () => {
    const r = await send({ name: 'Rita Rambler', email: 'Rita-T59@test.example', phone: '(608) 555-0181', message: 'Is the 2024 Jayco still here?' })
    expect(r.status).toBe(200)
    const ps = await people(), ls = await leads()
    expect(ps.length).toBe(1)
    expect(ps[0].type).toBe('lead')
    expect(ls.length).toBe(1)
    expect(ls[0].stage).toBe('new')
    expect(ls[0].contactId).toBe(ps[0].id)
    expect(ls[0].source).toBe('website')
    expect(ls[0].notes).toContain('Is the 2024 Jayco still here?')
  })

  test('the same message again (the email in another case) is the same person and the same open lead', async () => {
    expect((await send({ name: 'Rita Rambler', email: 'rita-t59@test.example', phone: '608-555-0181', message: 'Is the 2024 Jayco still here?' })).status).toBe(200)
    expect((await people()).length).toBe(1)
    expect((await leads()).length).toBe(1)
  })

  test('the same person asking about something else is a second open lead on the SAME contact', async () => {
    expect((await send({ name: 'Rita Rambler', email: 'rita-t59@test.example', message: 'Any fifth wheels under 30ft?' })).status).toBe(200)
    const ps = await people(), ls = await leads()
    expect(ps.length).toBe(1)
    expect(ls.length).toBe(2)
    expect(ls.every((l: any) => l.contactId === ps[0].id)).toBe(true)
  })

  test('a shared phone is not a shared identity: another name on the same line is a second person', async () => {
    expect((await send({ name: 'Sam Rambler', email: 'sam-t59@test.example', phone: '608-555-0181', message: 'Trade-in value?' })).status).toBe(200)
    const ps = await people()
    expect(ps.filter((p: any) => p.name === 'Sam Rambler').length).toBe(1)
    expect(ps.length).toBe(2)
  })

  test('with the Lead Inbox on it still goes to the pipeline, not the inbox', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['lead_inbox'] }).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect((await send({ name: 'Vic Viewer', email: 'vic-t59@test.example', message: 'Do you take trades?' })).status).toBe(200)
    expect(await t.db.select().from(t.schema.lead).where(eq(t.schema.lead.email, 'vic-t59@test.example'))).toEqual([])
    const vic = (await people()).find((p: any) => p.email === 'vic-t59@test.example')
    expect(vic).toBeTruthy()
    expect((await leads()).some((l: any) => l.contactId === vic!.id && l.stage === 'new')).toBe(true)
  })
})
