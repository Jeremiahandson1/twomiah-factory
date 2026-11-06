// From enquiry to answered quote (contractor parity, item 4): an enquiry can be marked Lost with the reason, a site visit can be
// booked from it straight onto the schedule, and the pipeline strip and the list of quotes still waiting on a customer say where
// the work stands. Three not-ready features: lead_lost, lead_site_visit, lead_pipeline. Server half, through the real app; the
// screen half is lead-pipeline-ui.test.ts (a DOM installed as globals stops the in-memory database booting).
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { daysWaiting } from '../server/crm/leads/leadPipeline.ts'

const json = async (r: Response) => (await r.json()) as any
const DAY = 86_400_000
const BASE = ['contacts', 'quotes', 'jobs', 'lead_inbox', 'dashboard', 'schedule']
const ALL = [...BASE, 'lead_lost', 'lead_site_visit', 'lead_pipeline']

describe('the features', () => {
  test.each(['lead_lost', 'lead_site_visit', 'lead_pipeline'])('%s is registered, not ready, and offered to the general contractor only', (id) => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === id)
    expect(f).toBeTruthy()
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm'])
  })
})

async function boot(features: string[]) {
  const t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, s.company.id))
  // The one place a row is written straight to the database: typed by the table it goes into.
  const ins = async <T extends PgTable>(table: T, values: T['$inferInsert']) => ((await t.db.insert(table).values(values as any).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const companyId = s.company.id as string
  /** A seat of this role, with the named extra permissions the owner gave it. */
  const seat = async (role: string, extraPermissions: string[] = []) => {
    const email = `${role}-${extraPermissions.join('-').replace(/[^a-z-]/g, '') || 'plain'}@test.example`
    await ins(t.schema.user, { companyId, email, firstName: role, lastName: 'Seat', role, extraPermissions, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') } as any)
    return as(await login(email, 'Correct-horse-1'))
  }
  const enquiry = (name: string, extra: Record<string, unknown> = {}, forCompany = companyId) =>
    ins(t.schema.lead, { companyId: forCompany, homeownerName: name, sourcePlatform: 'website', status: 'new', receivedAt: new Date(Date.now() - 2 * DAY), ...extra } as any)
  return { t, ins, owner, seat, companyId, enquiry }
}
type X = Awaited<ReturnType<typeof boot>>

describe('Lost, with the reason', () => {
  test('off: the route is not there (403), nothing changes', async () => {
    const x = await boot(BASE)
    const l = await x.enquiry('Ann Able')
    expect((await x.owner(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'price' } })).status).toBe(403)
    const [row] = await x.t.db.select().from(x.t.schema.lead).where(eq(x.t.schema.lead.id, l.id))
    expect(row.status).toBe('new')
  }, 120_000)

  test('on: marks the enquiry lost with the reason, takes it out of New, files it under Lost, and counts it by reason', async () => {
    const x = await boot(ALL)
    const l = await x.enquiry('Ann Able')
    await x.enquiry('Bob Baker')
    expect((await json(await x.owner('/api/dashboard/stats'))).newLeads).toBe(2)

    const r = await x.owner(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'price', note: 'Went with the cheaper bid' } })
    expect(r.status).toBe(200)
    const body = await json(r)
    expect([body.status, body.lostReason, body.lostNote]).toEqual(['lost', 'price', 'Went with the cheaper bid'])
    expect(body.lostAt).toBeTruthy()

    expect((await json(await x.owner('/api/dashboard/stats'))).newLeads).toBe(1)
    const lost = await json(await x.owner('/api/leads?status=lost'))
    expect(lost.data.map((d: any) => d.homeownerName)).toEqual(['Ann Able'])
    expect((await json(await x.owner('/api/leads?status=new'))).data.map((d: any) => d.homeownerName)).toEqual(['Bob Baker'])

    const reasons = await json(await x.owner('/api/lead-lost/reasons'))
    const by = Object.fromEntries(reasons.data.map((q: any) => [q.id, q.lost]))
    expect(by.price).toBe(1)
    expect(by.chose_other).toBe(0)
    expect(reasons.data.find((q: any) => q.id === 'price').label).toBe('Our price was too high')
  }, 120_000)

  test('refuses a missing or unknown reason, an "other" with no note, a converted enquiry and a second Lost', async () => {
    const x = await boot(ALL)
    const l = await x.enquiry('Ann Able')
    expect((await x.owner(`/api/lead-lost/${l.id}`, { method: 'POST', json: {} })).status).toBe(400)
    expect((await x.owner(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'because' } })).status).toBe(400)
    const noNote = await x.owner(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'other' } })
    expect(noNote.status).toBe(400)
    expect((await json(noNote)).fields.note).toBe('Say what the reason was')
    expect((await x.owner(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'other', note: 'Moved away' } })).status).toBe(200)
    expect((await x.owner(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'price' } })).status).toBe(409)

    const done = await x.enquiry('Cy Converted', { status: 'converted' })
    expect((await x.owner(`/api/lead-lost/${done.id}`, { method: 'POST', json: { reason: 'price' } })).status).toBe(409)
    const [still] = await x.t.db.select().from(x.t.schema.lead).where(eq(x.t.schema.lead.id, done.id))
    expect(still.status).toBe('converted')
  }, 120_000)

  test('reopening puts it back to New and clears the reason; reopening one that is not lost is refused', async () => {
    const x = await boot(ALL)
    const l = await x.enquiry('Ann Able')
    expect((await x.owner(`/api/lead-lost/${l.id}`, { method: 'DELETE' })).status).toBe(409)
    await x.owner(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'not_ready', note: 'Next spring' } })
    const r = await x.owner(`/api/lead-lost/${l.id}`, { method: 'DELETE' })
    expect(r.status).toBe(200)
    const [row] = await x.t.db.select().from(x.t.schema.lead).where(eq(x.t.schema.lead.id, l.id))
    expect([row.status, row.lostReason, row.lostNote, row.lostAt]).toEqual(['new', null, null, null])
    expect((await json(await x.owner('/api/lead-lost/reasons'))).data.every((q: any) => q.lost === 0)).toBe(true)
  }, 120_000)

  test('seats without leads:update are refused by the server; a seat granted it is let in; another company\'s enquiry is not found', async () => {
    const x = await boot(ALL)
    const l = await x.enquiry('Ann Able')
    const field = await x.seat('field')
    const viewer = await x.seat('viewer')
    for (const who of [field, viewer]) {
      expect((await who(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'price' } })).status).toBe(403)
      expect((await who(`/api/lead-lost/${l.id}`, { method: 'DELETE' })).status).toBe(403)
      expect((await who('/api/lead-lost/reasons')).status).toBe(403)
    }
    const [other] = await x.t.db.insert(x.t.schema.company).values({ name: 'Other Co', slug: 'other-co' }).returning()
    const theirs = await x.enquiry('Not Ours', {}, other.id)
    expect((await x.owner(`/api/lead-lost/${theirs.id}`, { method: 'POST', json: { reason: 'price' } })).status).toBe(404)
    const granted = await x.seat('field', ['leads:update'])
    expect((await granted(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'price' } })).status).toBe(200)
    const [row] = await x.t.db.select().from(x.t.schema.lead).where(eq(x.t.schema.lead.id, theirs.id))
    expect(row.status).toBe('new')
  }, 120_000)
})

describe('a site visit, booked from the enquiry', () => {
  const when = () => new Date(Date.now() + 3 * DAY).toISOString()
  const events = async (x: X) => (await json(await x.owner('/api/schedule-events'))).data as any[]

  test('off: no booking (403) and no calendar route', async () => {
    const x = await boot(BASE)
    const l = await x.enquiry('Ann Able')
    expect((await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start: when() } })).status).toBe(403)
    expect((await x.owner('/api/schedule-events')).status).toBe(403)
  }, 120_000)

  test('on: puts a site visit on the schedule, remembers it on the enquiry and marks a New enquiry Contacted', async () => {
    const x = await boot(ALL)
    const l = await x.enquiry('Ann Able', { location: '12 Elm St', phone: '715-555-0100', jobType: 'Kitchen remodel' })
    const start = when()
    const r = await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start, minutes: 90, notes: 'Bring the tape' } })
    expect(r.status).toBe(201)
    const body = await json(r)
    expect(body.status).toBe('contacted')
    expect(new Date(body.siteVisitAt).toISOString()).toBe(new Date(start).toISOString())
    expect(body.contactedAt).toBeTruthy()
    const list = await events(x)
    expect(list.length).toBe(1)
    expect([list[0].id, list[0].type, list[0].title, list[0].status]).toEqual([body.eventId, 'site_visit', 'Site visit — Ann Able', 'scheduled'])
    expect(new Date(list[0].end).getTime() - new Date(list[0].start).getTime()).toBe(90 * 60_000)
    expect(list[0].notes).toContain('12 Elm St')
    expect(list[0].notes).toContain('Bring the tape')
  }, 120_000)

  test('booking again moves the one entry (never a second); cancelling greys it and clears the enquiry', async () => {
    const x = await boot(ALL)
    const l = await x.enquiry('Ann Able')
    const first = await json(await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start: when() } }))
    const later = new Date(Date.now() + 5 * DAY).toISOString()
    const moved = await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start: later } })
    expect(moved.status).toBe(200)
    expect((await json(moved)).eventId).toBe(first.eventId)
    const list = await events(x)
    expect(list.length).toBe(1)
    expect(new Date(list[0].start).toISOString()).toBe(later)

    expect((await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'DELETE' })).status).toBe(200)
    const [row] = await x.t.db.select().from(x.t.schema.lead).where(eq(x.t.schema.lead.id, l.id))
    expect([row.siteVisitAt, row.siteVisitEventId]).toEqual([null, null])
    expect((await events(x))[0].status).toBe('cancelled')
    expect((await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'DELETE' })).status).toBe(409)
  }, 120_000)

  test('refuses a bad date, a person who is not on the team, and an enquiry that is lost', async () => {
    const x = await boot(ALL)
    const l = await x.enquiry('Ann Able')
    expect((await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start: 'next week' } })).status).toBe(400)
    expect((await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start: when(), minutes: 5 } })).status).toBe(400)
    const stranger = await x.t.db.insert(x.t.schema.company).values({ name: 'Other Co', slug: 'other-co' }).returning()
    const theirUser = await x.ins(x.t.schema.user, { companyId: stranger[0].id, email: 'them@other.example', firstName: 'Them', lastName: 'Other', role: 'admin', passwordHash: 'x' } as any)
    expect((await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start: when(), assigneeId: theirUser.id } })).status).toBe(400)
    await x.owner(`/api/lead-lost/${l.id}`, { method: 'POST', json: { reason: 'price' } })
    expect((await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start: when() } })).status).toBe(409)
    expect((await events(x)).length).toBe(0)
  }, 120_000)

  test('needs BOTH leads:update and schedule:create (cancel: schedule:update); anyone else is refused', async () => {
    const x = await boot(ALL)
    const l = await x.enquiry('Ann Able')
    const field = await x.seat('field')
    const leadsOnly = await x.seat('field', ['leads:update'])
    const scheduleOnly = await x.seat('field', ['schedule:create', 'schedule:update'])
    for (const who of [field, leadsOnly, scheduleOnly]) {
      expect((await who(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start: when() } })).status).toBe(403)
    }
    expect((await events(x)).length).toBe(0)
    const both = await x.seat('field', ['leads:update', 'schedule:create'])
    expect((await both(`/api/lead-site-visit/${l.id}`, { method: 'POST', json: { start: when() } })).status).toBe(201)
    // cancelling asks schedule:update, which this seat was not given
    expect((await both(`/api/lead-site-visit/${l.id}`, { method: 'DELETE' })).status).toBe(403)
    expect((await x.owner(`/api/lead-site-visit/${l.id}`, { method: 'DELETE' })).status).toBe(200)
  }, 120_000)
})

describe('the pipeline strip', () => {
  async function seeded(x: X) {
    const { ins, companyId, enquiry } = x
    // Enquiries: one New, one New with a visit still to come, one Contacted, one lost this week, one lost long ago.
    await enquiry('New Nora')
    await enquiry('Visit Vic', { siteVisitAt: new Date(Date.now() + 2 * DAY) })
    await enquiry('Contacted Cal', { status: 'contacted', contactedAt: new Date() })
    await enquiry('Lost Lou', { status: 'lost', lostReason: 'price', lostAt: new Date(Date.now() - 3 * DAY) })
    await enquiry('Lost Long Ago', { status: 'lost', lostReason: 'price', lostAt: new Date(Date.now() - 40 * DAY) })
    const [other] = await x.t.db.insert(x.t.schema.company).values({ name: 'Other Co', slug: 'other-co' }).returning()
    await enquiry('Not Ours', {}, other.id)
    const customer = await ins(x.t.schema.contact, { companyId, type: 'client', name: 'Ann Able' })
    const q = (number: string, status: string, total: string, extra: Record<string, unknown> = {}) =>
      ins(x.t.schema.quote, { companyId, number, name: `Quote ${number}`, status, total, contactId: customer.id, ...extra } as any)
    const sent = await q('Q-1', 'sent', '1000', { sentAt: new Date(Date.now() - 3 * DAY) })
    const viewed = await q('Q-2', 'viewed', '2000', { sentAt: new Date(Date.now() - 5 * DAY), viewedAt: new Date(Date.now() - 4 * DAY) })
    await q('Q-3', 'draft', '500')
    await q('Q-4', 'rejected', '700', { sentAt: new Date(Date.now() - 6 * DAY) })
    await q('Q-5', 'approved', '4000', { sentAt: new Date(Date.now() - 4 * DAY), approvedAt: new Date(Date.now() - 2 * DAY) })
    await q('Q-6', 'approved', '9000', { sentAt: new Date(Date.now() - 50 * DAY), approvedAt: new Date(Date.now() - 45 * DAY) })
    return { sent, viewed, customer }
  }

  test('off: the strip and the list are not there (403)', async () => {
    const x = await boot(BASE)
    expect((await x.owner('/api/lead-pipeline')).status).toBe(403)
    expect((await x.owner('/api/lead-pipeline/awaiting-reply')).status).toBe(403)
  }, 120_000)

  test('on: each enquiry is in one step, quotes out and won are quotes, Lost is this month, and money is the quotes\' totals', async () => {
    const x = await boot(ALL)
    await seeded(x)
    const r = await x.owner('/api/lead-pipeline')
    expect(r.status).toBe(200)
    const b = await json(r)
    const by = Object.fromEntries(b.stages.map((s: any) => [s.id, s]))
    expect(b.stages.map((s: any) => s.id)).toEqual(['new', 'contacted', 'site_visit', 'quotes_out', 'won', 'lost'])
    expect(by.new.count).toBe(1) // New Nora; Visit Vic is in Site visit booked, not also here
    expect(by.contacted.count).toBe(1)
    expect(by.site_visit.count).toBe(1)
    expect([by.quotes_out.count, by.quotes_out.value]).toEqual([2, 3000]) // sent + viewed; not the draft, rejected or approved
    expect([by.won.count, by.won.value]).toEqual([1, 4000]) // approved 2 days ago; not the one from 45 days ago
    expect(by.lost.count).toBe(1) // Lost Lou; not the one from 40 days ago, not Not Ours
    expect(b.days).toBe(30)
  }, 120_000)

  test('a seat that reads leads but not quotes gets the enquiry steps and no quote figures at all', async () => {
    const x = await boot(ALL)
    await seeded(x)
    const desk = await x.seat('field', ['leads:read'])
    const r = await desk('/api/lead-pipeline')
    expect(r.status).toBe(200)
    const b = await json(r)
    expect(b.stages.map((s: any) => s.id)).toEqual(['new', 'contacted', 'site_visit', 'lost'])
    expect(b.quotes).toBeNull()
    expect(JSON.stringify(b)).not.toMatch(/"value"|3000|4000/)
    expect((await desk('/api/lead-pipeline/awaiting-reply')).status).toBe(403)
    expect((await (await x.seat('field'))('/api/lead-pipeline')).status).toBe(403)
  }, 120_000)
})

describe('quotes awaiting a reply', () => {
  test('lists the quotes sent and not answered, longest-waiting first, with the days they have waited and how often they were nudged', async () => {
    const x = await boot(ALL)
    const { ins, companyId } = x
    const customer = await ins(x.t.schema.contact, { companyId, type: 'client', name: 'Ann Able' })
    const q = (number: string, status: string, extra: Record<string, unknown> = {}) =>
      ins(x.t.schema.quote, { companyId, number, name: `Quote ${number}`, status, total: '1500', contactId: customer.id, ...extra } as any)
    const recent = await q('Q-1', 'sent', { sentAt: new Date(Date.now() - 2.5 * DAY) })
    const oldest = await q('Q-2', 'viewed', { sentAt: new Date(Date.now() - 9.5 * DAY), viewedAt: new Date(Date.now() - 9 * DAY) })
    await q('Q-3', 'draft')
    await q('Q-4', 'approved', { sentAt: new Date(Date.now() - 20 * DAY), approvedAt: new Date(Date.now() - 19 * DAY) })
    await q('Q-5', 'rejected', { sentAt: new Date(Date.now() - 20 * DAY) })
    await ins(x.t.schema.reminderLog, { companyId, kind: 'quote_followup', subjectId: oldest.id, step: 'after_3:2026-10-01', status: 'sent' })
    await ins(x.t.schema.reminderLog, { companyId, kind: 'quote_followup', subjectId: oldest.id, step: 'after_7:2026-10-01', status: 'sent' })
    await ins(x.t.schema.reminderLog, { companyId, kind: 'quote_followup', subjectId: recent.id, step: 'after_3:2026-10-28', status: 'skipped' })

    const r = await x.owner('/api/lead-pipeline/awaiting-reply')
    expect(r.status).toBe(200)
    const rows = (await json(r)).data as any[]
    expect(rows.map((d) => d.number)).toEqual(['Q-2', 'Q-1'])
    expect(rows[0].daysWaiting).toBeGreaterThanOrEqual(9)
    expect(rows[0].daysWaiting).toBeLessThanOrEqual(10)
    expect(rows[1].daysWaiting).toBeGreaterThanOrEqual(2)
    expect(rows[1].daysWaiting).toBeLessThanOrEqual(3)
    expect([rows[0].viewed, rows[1].viewed]).toEqual([true, false])
    expect([rows[0].followUpsSent, rows[1].followUpsSent]).toEqual([2, 0]) // a skipped step is not a nudge that went out
    expect([rows[0].contactName, rows[0].total]).toEqual(['Ann Able', 1500])
  }, 120_000)

  test('days waiting are counted on the company\'s calendar, not the server\'s', () => {
    // Sent 23:00 UTC on the 10th = noon on the 11th in Auckland; asked 03:00 UTC on the 12th = 4pm on the 12th there.
    const sent = new Date('2026-10-10T23:00:00Z'), now = new Date('2026-10-12T03:00:00Z')
    expect(daysWaiting(sent, 'Pacific/Auckland', now)).toBe(1)
    expect(daysWaiting(sent, 'UTC', now)).toBe(2)
    expect(daysWaiting(sent, 'America/Chicago', now)).toBe(1) // 6pm on the 10th → 10pm on the 11th
    expect(daysWaiting(new Date('2026-10-12T02:00:00Z'), 'UTC', now)).toBe(0)
  })

  test('a seat without quotes:read is refused; another company\'s quotes are never listed', async () => {
    const x = await boot(ALL)
    const { ins, companyId } = x
    const [other] = await x.t.db.insert(x.t.schema.company).values({ name: 'Other Co', slug: 'other-co' }).returning()
    await ins(x.t.schema.quote, { companyId: other.id, number: 'Q-X', name: 'Theirs', status: 'sent', total: '999', sentAt: new Date() } as any)
    await ins(x.t.schema.quote, { companyId, number: 'Q-1', name: 'Ours', status: 'sent', total: '100', sentAt: new Date() } as any)
    expect(((await json(await x.owner('/api/lead-pipeline/awaiting-reply'))).data as any[]).map((d) => d.number)).toEqual(['Q-1'])
    expect((await (await x.seat('field'))('/api/lead-pipeline/awaiting-reply')).status).toBe(403)
  }, 120_000)
})
