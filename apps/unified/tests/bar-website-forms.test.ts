// The bar's two website forms on the unified app (crm/bar/enquiry.ts), through the real site form (POST /api/leads):
// the same behaviour tests/bar/bar-website-forms.test.ts holds on the template's webhook, which the one app replaces.
//   · a party request WITH a date opens an enquiry in the party book (it holds no room) for the guest it came from,
//     typed from the occasion, with the head count and the note; the same phone is the same guest
//   · without a real date it is an ordinary lead in the Lead Inbox, never dropped
//   · a Regulars sign-up tags the guest; birthday and consent evidence (the words, where, the visitor's own address,
//     when) are appended; no email, no email consent; an existing guest's name and type are never changed
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq, and } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let ipCount = 0
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
// Each post from its own address: the form allows five per visitor per ten minutes.
const post = (body: Record<string, unknown>, ip = `203.0.113.${++ipCount}`) =>
  t.call('/api/leads', { method: 'POST', json: { t: String(Date.now() - 10_000), ...body }, headers: { 'X-Forwarded-For': ip } })
const events = () => t.db.select().from(t.schema.event).where(eq(t.schema.event.companyId, companyId))
const guest = async (where: any) => (await t.db.select().from(t.schema.contact).where(and(eq(t.schema.contact.companyId, companyId), where)))[0]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'bar' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'event_bookings', 'lead_inbox', 'bar_menu', 'bar_tonight'] }).where(eq(t.schema.company.id, companyId))
})

describe('the party request', () => {
  let patId = ''
  test('with a date: an enquiry in the party book, typed from the occasion, named for it, for that many', async () => {
    const r = await post({ name: 'Pat Kowalski', phone: '(715) 555-0142', email: 'Pat@Example.com', message: 'Back room if you have it', formType: 'party', partySize: 24, requestedDate: future, occasion: "Dad's 70th birthday" })
    expect(r.status).toBe(200)
    const [ev] = await events()
    expect(ev).toMatchObject({ status: 'enquiry', guestCount: 24, eventType: 'birthday', name: "Dad's 70th birthday — Pat Kowalski", notes: 'Back room if you have it', source: 'website' })
    expect(String(ev.eventDate).slice(0, 10)).toBe(future)
    const g = await guest(eq(t.schema.contact.id, ev.contactId!))
    expect(g).toMatchObject({ name: 'Pat Kowalski', type: 'lead', source: 'website' })
    patId = g.id
  })

  test('the same phone is the same guest, unchanged; an occasion it does not know is "other"', async () => {
    expect((await post({ name: 'P. Kowalski', phone: '715-555-0142', formType: 'party', partySize: 10, requestedDate: future, occasion: 'Packer game' })).status).toBe(200)
    const ev2 = (await events()).find((e: any) => e.guestCount === 10)!
    expect(ev2.contactId).toBe(patId)
    expect(ev2.eventType).toBe('other')
    expect((await guest(eq(t.schema.contact.id, patId))).name).toBe('Pat Kowalski')
  })

  test('without a date, or with a day that does not exist, it is an ordinary lead in the inbox — never dropped', async () => {
    const before = (await events()).length
    expect((await post({ name: 'Sam Lee', phone: '715-555-0199', formType: 'party', partySize: 8, occasion: 'retirement' })).status).toBe(200)
    expect((await post({ name: 'Una Day', phone: '715-555-0188', formType: 'party', requestedDate: '2026-02-31' })).status).toBe(200)
    expect((await events()).length).toBe(before)
    const inbox = await t.db.select().from(t.schema.lead).where(eq(t.schema.lead.companyId, companyId))
    expect(inbox.map((l: any) => l.homeownerName).sort()).toEqual(['Sam Lee', 'Una Day'])
  })

  test('a form with neither an email nor a phone is refused', async () => {
    const r = await post({ name: 'No Way', formType: 'party', requestedDate: future })
    expect(r.status).toBe(400)
  })

  describe('the Regulars', () => {
    test('a known guest signs up: tagged, with the birthday and the consent evidence, name and type untouched', async () => {
      expect((await post({ name: 'Pat K', email: 'pat@example.com', formType: 'regulars', birthdayMonth: 6, birthdayDay: 14, consentText: 'Yes, email me now and then.', consentSource: 'website:/regulars' }, '198.51.100.7')).status).toBe(200)
      const g = await guest(eq(t.schema.contact.id, patId))
      expect(g.tags).toContain('regular')
      const cf = g.customFields as any
      expect(cf.birthday).toEqual({ month: 6, day: 14 })
      expect(cf.marketingConsent).toHaveLength(1)
      // The visitor's own address, as the app saw it — not one a form could claim.
      expect(cf.marketingConsent[0]).toMatchObject({ channel: 'email', text: 'Yes, email me now and then.', source: 'website:/regulars', ip: '198.51.100.7' })
      expect(cf.marketingConsent[0].at).toBeTruthy()
      expect(g).toMatchObject({ name: 'Pat Kowalski', type: 'lead' })
    })

    test('signing up twice adds a second consent record and not a second tag', async () => {
      await post({ name: 'Pat K', email: 'pat@example.com', formType: 'regulars', consentText: 'Yes again.', consentSource: 'website:/regulars' })
      const g = await guest(eq(t.schema.contact.id, patId))
      expect((g.customFields as any).marketingConsent).toHaveLength(2)
      expect((g.tags as string[]).filter((x) => x === 'regular')).toHaveLength(1)
    })

    test('a new regular with only a phone: a guest, tagged, and no email consent (nowhere to send it)', async () => {
      expect((await post({ name: 'Joe Phone', phone: '715-555-0177', formType: 'regulars', consentText: 'Yes', consentSource: 'website:/regulars' })).status).toBe(200)
      const j = await guest(eq(t.schema.contact.name, 'Joe Phone'))
      expect(j.type).toBe('client')
      expect(j.tags).toContain('regular')
      expect((j.customFields as any).marketingConsent).toBeUndefined()
    })
  })
})

describe('other verticals', () => {
  test('a contractor\'s site does not answer the bar\'s forms: a form with no email is refused as an ordinary enquiry', async () => {
    const c = await bootTenant({ vertical: 'contractor' })
    await seedOwner(c)
    const r = await c.call('/api/leads', { method: 'POST', json: { name: 'Pat', phone: '715-555-0100', formType: 'regulars', t: String(Date.now() - 10_000) } })
    expect(r.status).toBe(400)
  })
})
