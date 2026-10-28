// "Text opened on your phone — not confirmed sent" (server/crm/textActivity.ts): the Text button writes an `activity` row on the
// contact or lead, the contact's Activity card reads them back, and both sides ask the permission to READ that record.
import { describe, test, expect } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { TEXT_STARTED_LABEL } from '../server/crm/textActivity.ts'
import { TEXT_STARTED_LABEL as UI_LABEL } from '../../../packages/tenant-ui/src/text/record.ts'

async function tenant(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  const companyId = seeded.company.id as string
  await t.db.update(t.schema.company).set({ enabledFeatures: features, settings: { onboardingComplete: true } } as any).where(eq(t.schema.company.id, companyId))
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
  const asToken = (token: string) => async (method: string, path: string, json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${token}` } })
    const s = await r.text()
    return { status: r.status, body: s ? JSON.parse(s) : null }
  }
  const owner = asToken(await login('owner@test.example', seeded.password))
  const person = async (role: string) => {
    const email = `${role}@test.example`
    await t.db.insert(t.schema.user).values({ companyId, email, firstName: 'Pat', lastName: role, role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') } as any)
    return asToken(await login(email, 'Correct-horse-1'))
  }
  const [contact] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Sam Lee', type: 'client', phone: '6085550111' } as any).returning()
  const [lead] = await t.db.insert(t.schema.lead).values({ companyId, sourcePlatform: 'website', homeownerName: 'Lee Lead', phone: '6085550112' } as any).returning()
  const rows = (entityType: string, entityId: string) => t.db.select().from(t.schema.activity).where(and(eq(t.schema.activity.entityType, entityType), eq(t.schema.activity.entityId, entityId)))
  return { t, owner, person, contact, lead, rows, companyId }
}

const BODY = { message: 'ready', label: "We're on our way" }

describe('the record', () => {
  test('the owner words are exact, on the server and in the screen', () => {
    expect(TEXT_STARTED_LABEL).toBe('Text opened on your phone — not confirmed sent')
    expect(UI_LABEL).toBe(TEXT_STARTED_LABEL)
  })

  test('opening a text writes a text_started row on the contact, with the chosen message in metadata and who opened it; the card reads it back', async () => {
    const x = await tenant('contractor', ['contacts', 'lead_inbox'])
    const r = await x.owner('POST', `/api/text-activity/contact/${x.contact.id}`, BODY)
    expect(r.status).toBe(201)
    const [row] = await x.rows('contact', x.contact.id)
    expect(row).toMatchObject({ companyId: x.companyId, entityType: 'contact', entityId: x.contact.id, action: 'text_started', description: TEXT_STARTED_LABEL })
    expect(row.metadata).toEqual({ message: 'ready', label: "We're on our way" })
    expect(row.userId).toBeTruthy()
    const read = await x.owner('GET', `/api/text-activity/contact/${x.contact.id}`)
    expect(read.status).toBe(200)
    expect(read.body.data).toHaveLength(1)
    expect(read.body.data[0]).toMatchObject({ action: 'text_started', description: TEXT_STARTED_LABEL, by: 'Olive Owner' })
    expect(read.body.data[0].createdAt).toBeTruthy()
  })

  test('a lead is recorded on the lead, and not on any contact', async () => {
    const x = await tenant('contractor', ['contacts', 'lead_inbox'])
    expect((await x.owner('POST', `/api/text-activity/lead/${x.lead.id}`, { message: 'blank', label: 'A blank text' })).status).toBe(201)
    expect(await x.rows('lead', x.lead.id)).toHaveLength(1)
    expect(await x.rows('contact', x.contact.id)).toHaveLength(0)
  })

  test('what is kept of the message is its id and label, never its words (an invoice message carries a private link); markup in a label is stripped', async () => {
    const x = await tenant('contractor', ['contacts'])
    const r = await x.owner('POST', `/api/text-activity/contact/${x.contact.id}`, { message: 'invoice', label: 'Your <b>invoice</b>', body: 'Hi https://x.example/d/' + 'ab'.repeat(32) })
    expect(r.status).toBe(201)
    const [row] = await x.rows('contact', x.contact.id)
    expect(row.metadata).toEqual({ message: 'invoice', label: 'Your invoice' })
    expect(JSON.stringify(row)).not.toContain('/d/')
  })

  test('a made-up message id, no body, or another company\'s / a missing record is refused and writes nothing', async () => {
    const x = await tenant('contractor', ['contacts', 'lead_inbox'])
    expect((await x.owner('POST', `/api/text-activity/contact/${x.contact.id}`, { message: 'spam', label: 'x' })).status).toBe(400)
    expect((await x.owner('POST', `/api/text-activity/contact/${x.contact.id}`, undefined)).status).toBe(400)
    expect((await x.owner('POST', '/api/text-activity/contact/nope', BODY)).status).toBe(404)
    expect((await x.owner('POST', '/api/text-activity/lead/nope', BODY)).status).toBe(404)
    expect(await x.t.db.select().from(x.t.schema.activity)).toHaveLength(0)
  })
})

describe('permissions: the same as reading the record, refused without it', () => {
  test('a lead: a field seat (no leads:read) is refused; nothing is written', async () => {
    const x = await tenant('contractor', ['contacts', 'lead_inbox'])
    const field = await x.person('field')
    expect((await field('GET', '/api/leads')).status).toBe(403) // the Lead Inbox itself is refused them
    const r = await field('POST', `/api/text-activity/lead/${x.lead.id}`, BODY)
    expect(r.status).toBe(403)
    expect(await x.rows('lead', x.lead.id)).toHaveLength(0)
  })

  test('a contact: home care\'s caregiver seat (contacts:read withheld) is refused the write AND the read; nothing is written', async () => {
    const x = await tenant('homecare', ['contacts'])
    const caregiver = await x.person('field')
    expect((await caregiver('GET', `/api/contacts/${x.contact.id}`)).status).toBe(403) // the contact itself is refused them
    const w = await caregiver('POST', `/api/text-activity/contact/${x.contact.id}`, BODY)
    expect(w.status).toBe(403)
    const r = await caregiver('GET', `/api/text-activity/contact/${x.contact.id}`)
    expect(r.status).toBe(403)
    expect(await x.rows('contact', x.contact.id)).toHaveLength(0)
  })

  test('a field seat reads only the customers on its own jobs — and may record on, and read the activity of, only those', async () => {
    const x = await tenant('contractor', ['contacts', 'jobs'])
    const field = await x.person('field')
    // Not on any of its jobs: the contact itself answers 404 to this seat, and so does its activity — read and write.
    expect((await field('GET', `/api/contacts/${x.contact.id}`)).status).toBe(404)
    expect((await field('POST', `/api/text-activity/contact/${x.contact.id}`, BODY)).status).toBe(404)
    expect((await field('GET', `/api/text-activity/contact/${x.contact.id}`)).status).toBe(404)
    expect(await x.rows('contact', x.contact.id)).toHaveLength(0)
    // The owner records one; the field seat still cannot read it.
    expect((await x.owner('POST', `/api/text-activity/contact/${x.contact.id}`, BODY)).status).toBe(201)
    expect((await field('GET', `/api/text-activity/contact/${x.contact.id}`)).status).toBe(404)
    // Put the customer on a job assigned to this seat: now the contact opens, and so does the record.
    const [me] = await x.t.db.select().from(x.t.schema.user).where(eq(x.t.schema.user.email, 'field@test.example'))
    await x.t.db.insert(x.t.schema.job).values({ companyId: x.companyId, contactId: x.contact.id, title: 'Roof', number: 'J-1', assignedToId: me.id } as any)
    expect((await field('GET', `/api/contacts/${x.contact.id}`)).status).toBe(200)
    expect((await field('POST', `/api/text-activity/contact/${x.contact.id}`, BODY)).status).toBe(201)
    expect((await field('GET', `/api/text-activity/contact/${x.contact.id}`)).status).toBe(200)
  })

  test('no sign-in: refused', async () => {
    const x = await tenant('contractor', ['contacts'])
    const r = await x.t.call(`/api/text-activity/contact/${x.contact.id}`, { method: 'POST', json: BODY })
    expect(r.status).toBe(401)
  })

  test('with the contacts feature off the route is not there', async () => {
    const x = await tenant('contractor', ['dashboard'])
    const r = await x.owner('POST', `/api/text-activity/contact/${x.contact.id}`, BODY)
    expect([403, 404]).toContain(r.status)
    expect(await x.rows('contact', x.contact.id)).toHaveLength(0)
  })
})
