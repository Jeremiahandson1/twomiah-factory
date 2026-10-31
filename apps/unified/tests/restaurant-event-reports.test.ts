// Restaurant & bar parity #6 (docs/parity/restaurant-7-lead-source.md): marketing spend per lead source per month, the source report's
// cost per enquiry / cost per booked event / return on spend, and a report emailed weekly or monthly to chosen seats.
// On the real server (bootFood, a restaurant tenant); each test fails without the change.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore } from '../server/crm/restaurant/eventGuarantee.ts'
import { spendShare } from '../server/crm/restaurant/eventSources.ts'
import { dueDayOf, periodOf } from '../server/crm/restaurant/eventReports.ts'
import { shopClock } from '../server/crm/lowStockDigest.ts'
import { companyTimeZone } from '@twomiah/tenant-backend'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'reports']
const DEPTH = ['event_reports', 'event_marketing_spend', 'event_report_schedules']
let k: Awaited<ReturnType<typeof bootFood>>
let today = ''
let tz = ''
let clientId = ''
let bartenderId = ''
let ownerEmail = ''
const results: Array<{ template: string; ok: unknown }> = []
const month = () => today.slice(0, 7)
const monthEnd = () => { const [y, m] = month().split('-').map(Number); return `${month()}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }
const jobs = () => (k.t.services.crm as any).eventJobs
/** An instant at which the venue's clock reads `day` and `hour` (whatever zone the venue is in). */
const venueAt = (day: string, hour: number): Date => {
  for (let off = -14; off <= 14; off++) {
    const at = new Date(Date.parse(`${day}T00:00:00Z`) + (hour + off) * 3600_000 + 15 * 60_000)
    const c = shopClock(tz, at)
    if (c.day === day && c.hour === hour) return at
  }
  throw new Error(`no instant reads ${day} ${hour}h`)
}
const dow = (day: string) => new Date(day + 'T12:00:00Z').getUTCDay()
const mailsTo = (to: string) => k.mails.filter((m) => m.to === to && /report/i.test(m.subject))
const report = (who: 'O' | 'B' | 'M' = 'O') => k[who]('GET', `/api/event-reports/sources?from=${month()}-01&to=${monthEnd()}`)

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: [...BASE, ...DEPTH] })
  today = await venueToday(k.t.db, k.companyId)
  tz = await companyTimeZone(k.t.db, k.companyId)
  await (k.t.db as any).update(k.S.company).set({ email: 'events@venue.test', name: 'The Loft Venue' }).where(eq(k.S.company.id, k.companyId))
  // Record what each email says (its template data) and whether the real template accepted it.
  const svc = k.t.services.crm.emailService as any
  const realSend = svc.send.bind(svc)
  svc.send = async (to: string, template: string, data: any) => {
    const r = await realSend(to, template, data)
    results.push({ template, ok: r?.success })
    k.mails.push({ to, subject: String(data.subject ?? template), html: JSON.stringify({ template, ...data }) })
    return r
  }
  clientId = (await k.O('POST', '/api/contacts', { name: 'Harper Diaz', email: 'harper@client.test', phone: '7155550111', type: 'client' })).json.id
  // The bartender seat may read reports (a grant on top of its role) but has no right to money.
  bartenderId = k.ids.bartender
  await (k.t.db as any).update(k.S.user).set({ extraPermissions: ['reports:read'] }).where(eq(k.S.user.id, bartenderId))
  ;(k.t.services as any).permissions.invalidateExtraPermissions(bartenderId)
  ownerEmail = ((await (k.t.db as any).select().from(k.S.user).where(eq(k.S.user.id, k.ids.owner)))[0]).email
}, 60_000)
afterAll(() => k.restore())

describe('the day share of a month’s spend', () => {
  test('a month’s spend is spread evenly over its days and a period takes its days, rounded once to whole cents', () => {
    expect(spendShare([{ month: '2026-02', amountCents: 28000 }], '2026-02-01', '2026-02-07')).toBe(7000)
    expect(spendShare([{ month: '2026-04', amountCents: 30000 }], '2026-04-01', '2026-04-15')).toBe(15000)
    expect(spendShare([{ month: '2026-04', amountCents: 30000 }], '2026-04-01', '2026-04-30')).toBe(30000)
    // A period over two months takes a share of each.
    expect(spendShare([{ month: '2026-01', amountCents: 3100 }, { month: '2026-02', amountCents: 2800 }], '2026-01-31', '2026-02-02')).toBe(300)
    // A month outside the period adds nothing; an odd split rounds to a whole cent.
    expect(spendShare([{ month: '2026-03', amountCents: 1000 }], '2026-04-01', '2026-04-30')).toBe(0)
    expect(Number.isInteger(spendShare([{ month: '2026-04', amountCents: 1000 }], '2026-04-01', '2026-04-10'))).toBe(true)
  })
  test('the day a schedule falls due and the days its report covers', () => {
    // Wednesday 11 March 2026: a Monday schedule fell due on the 9th; the 15th of the month on 15 February.
    expect(dueDayOf({ frequency: 'weekly', weekday: 1, monthDay: null }, '2026-03-11')).toBe('2026-03-09')
    expect(dueDayOf({ frequency: 'weekly', weekday: 3, monthDay: null }, '2026-03-11')).toBe('2026-03-11')
    expect(dueDayOf({ frequency: 'monthly', weekday: null, monthDay: 15 }, '2026-03-10')).toBe('2026-02-15')
    expect(dueDayOf({ frequency: 'monthly', weekday: null, monthDay: 20 }, '2026-01-05')).toBe('2025-12-20')
    expect(periodOf('weekly', '2026-03-09')).toEqual({ from: '2026-03-02', to: '2026-03-08' })
    expect(periodOf('monthly', '2026-03-01')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodOf('monthly', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
})

describe('marketing spend per source per month', () => {
  test('it is entered in whole cents by a seat that may change money, checked, and a zero takes it away', async () => {
    const put = (body: Record<string, unknown>) => k.O('PUT', '/api/event-spend', body)
    expect((await put({ source: 'a billboard', month: month(), amountCents: 100 })).status).toBe(400)
    expect((await put({ source: 'website', month: 'March', amountCents: 100 })).status).toBe(400)
    expect((await put({ source: 'website', month: month(), amountCents: 12.5 })).status).toBe(400)
    expect((await put({ source: 'website', month: month(), amountCents: -5 })).status).toBe(400)
    expect((await put({ source: 'website', month: month(), amountCents: 100_000_001 })).status).toBe(400)
    expect((await put({ month: month(), amountCents: 100 })).status).toBe(400)
    const made = await put({ source: 'website', month: month(), amountCents: 50000, note: 'Search ads' })
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ source: 'website', sourceLabel: 'Website form', month: month(), amountCents: 50000, note: 'Search ads' })
    // Entering it again changes it; one row per source per month.
    expect((await put({ source: 'website', month: month(), amountCents: 60000 })).status).toBe(200)
    expect((await put({ source: 'website', month: month(), amountCents: 50000 })).status).toBe(200)
    expect((await put({ source: 'the_knot', month: month(), amountCents: 10000 })).status).toBe(201)
    const list = await k.O('GET', `/api/event-spend?from=${month()}&to=${month()}`)
    expect(list.status).toBe(200)
    expect(list.json.data.map((r: any) => [r.source, r.amountCents])).toEqual([['the_knot', 10000], ['website', 50000]])
    expect((await k.O('GET', '/api/event-spend?from=2026-5&to=2026-05')).status).toBe(400)
    // Zero takes it away.
    expect((await put({ source: 'the_knot', month: month(), amountCents: 0 })).status).toBe(200)
    expect((await k.O('GET', `/api/event-spend?from=${month()}&to=${month()}`)).json.data).toHaveLength(1)
    expect((await put({ source: 'the_knot', month: month(), amountCents: 10000 })).status).toBe(201)
  })

  test('a seat without the right to money cannot read or enter it', async () => {
    expect((await k.B('GET', `/api/event-spend?from=${month()}&to=${month()}`)).status).toBe(403)
    expect((await k.B('PUT', '/api/event-spend', { source: 'website', month: month(), amountCents: 1 })).status).toBe(403)
  })
})

describe('the source report with spend', () => {
  test('cost per enquiry, cost per booked event and return on spend, in cents, per source and in total', async () => {
    const mk = (name: string, source: string) => k.O('POST', '/api/events', { name, eventDate: dayBefore(today, -90), source, contactId: clientId })
    const w1 = await mk('W1', 'website'), w2 = await mk('W2', 'website'), kn = await mk('K1', 'the_knot')
    expect([w1, w2, kn].every((r) => r.status === 201)).toBe(true)
    await k.O('PUT', `/api/events/${w1.json.id}`, { status: 'confirmed', quotedTotal: 4000 })
    await k.O('PUT', `/api/events/${w2.json.id}`, { status: 'lost' })
    await k.O('PUT', `/api/events/${kn.json.id}`, { status: 'confirmed', quotedTotal: 1500 })
    const rep = await report()
    expect(rep.status).toBe(200)
    const web = rep.json.sources.find((s: any) => s.source === 'website')
    // $500 over 2 enquiries and 1 booked event of $4,000: $250 each enquiry, $500 each booking, $8 booked for every $1.
    expect(web).toMatchObject({ enquiries: 2, booked: 1, bookedValue: 4000, spendCents: 50000, costPerEnquiryCents: 25000, costPerBookingCents: 50000, returnOnSpend: 8 })
    const knot = rep.json.sources.find((s: any) => s.source === 'the_knot')
    expect(knot).toMatchObject({ enquiries: 1, booked: 1, bookedValue: 1500, spendCents: 10000, costPerEnquiryCents: 10000, costPerBookingCents: 10000, returnOnSpend: 15 })
    expect(rep.json.totals).toMatchObject({ enquiries: 3, booked: 2, spendCents: 60000, costPerEnquiryCents: 20000, costPerBookingCents: 30000, returnOnSpend: 9.17 })
    // A source with no spend has no cost to show, not zero.
    const phone = await mk('P1', 'phone')
    expect(phone.status).toBe(201)
    expect((await report()).json.sources.find((s: any) => s.source === 'phone')).toMatchObject({ spendCents: 0, costPerEnquiryCents: null, returnOnSpend: null })
    // A period that takes part of a month takes that part of the spend.
    const part = await k.O('GET', `/api/event-reports/sources?from=${month()}-01&to=${month()}-01`)
    expect(part.json.sources.find((s: any) => s.source === 'website')?.spendCents ?? 0).toBe(spendShare([{ month: month(), amountCents: 50000 }], `${month()}-01`, `${month()}-01`))
  })

  test('a seat that reads reports but not money gets the counts and no figure of money; with spend switched off nobody gets spend', async () => {
    const asBartender = await report('B')
    expect(asBartender.status).toBe(200)
    const web = asBartender.json.sources.find((s: any) => s.source === 'website')
    expect(web).toMatchObject({ enquiries: 2, booked: 1 })
    for (const key of ['bookedValue', 'spendCents', 'costPerEnquiryCents', 'costPerBookingCents', 'returnOnSpend']) expect(web[key]).toBeUndefined()
    expect(JSON.stringify(asBartender.json)).not.toContain('spendCents')
    await k.features([...BASE, 'event_reports'])
    const off = await report()
    expect(off.status).toBe(200)
    expect(off.json.sources.find((s: any) => s.source === 'website').spendCents).toBeUndefined()
    expect([403, 404]).toContain((await k.O('GET', `/api/event-spend?from=${month()}&to=${month()}`)).status)
    expect([403, 404]).toContain((await k.O('PUT', '/api/event-spend', { source: 'website', month: month(), amountCents: 1 })).status)
    await k.features([...BASE, ...DEPTH])
  })
})

describe('a report emailed on a schedule', () => {
  let scheduleId = ''
  let viewerId = ''
  test('only a seat that may change settings makes one; it goes only to people who can read reports', async () => {
    const opts = await k.O('GET', '/api/event-report-schedules/options')
    expect(opts.status).toBe(200)
    expect(opts.json.reports.map((r: any) => r.id)).toEqual(['sources', 'years'])
    expect(opts.json.seats.map((s: any) => s.email).sort()).toEqual(['bartender@bar.test', 'manager@bar.test', ownerEmail].sort())
    expect(opts.json.seats.every((s: any) => s.roleLabel && s.roleLabel !== 'field' && s.roleLabel !== 'manager')).toBe(true) // the role's own words, never the code
    const body = { report: 'sources', frequency: 'weekly', weekday: dow(today), recipients: [k.ids.owner, k.ids.manager, bartenderId] }
    expect((await k.B('POST', '/api/event-report-schedules', body)).status).toBe(403)
    expect((await k.B('GET', '/api/event-report-schedules/options')).status).toBe(403)
    expect((await k.O('POST', '/api/event-report-schedules', { ...body, report: 'payroll' })).status).toBe(400)
    expect((await k.O('POST', '/api/event-report-schedules', { ...body, frequency: 'daily' })).status).toBe(400)
    expect((await k.O('POST', '/api/event-report-schedules', { ...body, weekday: 9 })).status).toBe(400)
    expect((await k.O('POST', '/api/event-report-schedules', { ...body, frequency: 'monthly', monthDay: 31 })).status).toBe(400)
    expect((await k.O('POST', '/api/event-report-schedules', { ...body, recipients: [] })).status).toBe(400)
    // A seat that cannot read reports cannot be chosen.
    const [viewer] = await (k.t.db as any).insert(k.S.user).values({ email: 'viewer@bar.test', passwordHash: 'x', firstName: 'Vi', lastName: 'Ewer', role: 'viewer', companyId: k.companyId }).returning()
    viewerId = viewer.id
    const refused = await k.O('POST', '/api/event-report-schedules', { ...body, recipients: [viewerId] })
    expect(refused.status).toBe(400)
    expect(refused.json.error).toMatch(/can read reports/)
    const made = await k.O('POST', '/api/event-report-schedules', body)
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ report: 'sources', reportLabel: 'Where enquiries come from', frequency: 'weekly', active: true })
    expect(made.json.when).toBe(`Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow(today)]}`)
    expect(made.json.recipients).toHaveLength(3)
    scheduleId = made.json.id
    expect((await k.B('GET', '/api/event-report-schedules')).json.data).toHaveLength(1) // reports:read may look
  })

  test('a schedule is not sent on the day it was made, nor before 8 in the morning on the venue’s clock', async () => {
    k.mails.length = 0
    expect(await jobs().runScheduledReports(venueAt(today, 9))).toBe(0)
    expect(k.mails).toHaveLength(0)
    // Made earlier, it is due today, but not before 8.
    await (k.t.db as any).update(k.S.eventReportSchedule).set({ createdAt: new Date(Date.now() - 10 * 86400_000) }).where(eq(k.S.eventReportSchedule.id, scheduleId))
    expect(await jobs().runScheduledReports(venueAt(today, 7))).toBe(0)
    expect(k.mails).toHaveLength(0)
  })

  test('from 8 it goes once for the day, to each seat as that seat may see it, then not again until the next week', async () => {
    // The events already in the book were made today; move them into the week the report covers.
    for (const ev of await (k.t.db as any).select().from(k.S.event)) await (k.t.db as any).update(k.S.event).set({ createdAt: new Date(Date.now() - 2 * 86400_000) }).where(eq(k.S.event.id, ev.id))
    expect(await jobs().runScheduledReports(venueAt(today, 9))).toBe(1)
    expect(k.mails.filter((m) => /report/i.test(m.subject)).length).toBe(3)
    const owner = mailsTo(ownerEmail)[0], bartender = mailsTo('bartender@bar.test')[0]
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.template === 'eventReport' && r.ok === true)).toBe(true) // the real template took every one
    expect(owner.subject).toMatch(/^Weekly report: where enquiries came from/)
    for (const word of ['Source', 'Enquiries', 'Booked value', 'Spent', 'Per enquiry', 'Per booked event', 'Return', 'Website form']) expect(owner.html).toContain(word)
    // The seat that reads no money gets the counts and none of the money columns.
    expect(bartender.html).toContain('Website form'); expect(bartender.html).toContain('Enquiries')
    for (const word of ['Booked value', 'Spent', 'Per enquiry', 'Per booked event', 'Return']) expect(bartender.html).not.toContain(word)
    expect(bartender.html).not.toContain('$')
    // Once for the day: a later pass the same day, and the next day, send nothing.
    expect(await jobs().runScheduledReports(venueAt(today, 15))).toBe(0)
    expect(await jobs().runScheduledReports(venueAt(dayBefore(today, -1), 9))).toBe(0)
    expect(k.mails.filter((m) => /report/i.test(m.subject)).length).toBe(3)
    const list = (await k.O('GET', '/api/event-report-schedules')).json.data[0]
    expect(list.lastSentFor).toBe(today)
    // A week on it goes again; a seat that has left is not written to.
    await (k.t.db as any).update(k.S.user).set({ isActive: false }).where(eq(k.S.user.id, bartenderId))
    expect(await jobs().runScheduledReports(venueAt(dayBefore(today, -7), 9))).toBe(1)
    expect(mailsTo(ownerEmail)).toHaveLength(2)
    expect(mailsTo('bartender@bar.test')).toHaveLength(1)
    await (k.t.db as any).update(k.S.user).set({ isActive: true }).where(eq(k.S.user.id, bartenderId))
  })

  test('a monthly schedule goes on its day of the month with the month before', async () => {
    const dom = Math.min(Number(today.slice(8, 10)), 28)
    const made = await k.O('POST', '/api/event-report-schedules', { report: 'years', frequency: 'monthly', monthDay: dom, recipients: [k.ids.owner] })
    expect(made.status).toBe(201)
    expect(made.json.when).toMatch(/^On the \d+(st|nd|rd|th) of each month$/)
    await (k.t.db as any).update(k.S.eventReportSchedule).set({ createdAt: new Date(Date.now() - 45 * 86400_000) }).where(eq(k.S.eventReportSchedule.id, made.json.id))
    const before = mailsTo(ownerEmail).length
    const due = dueDayOf({ frequency: 'monthly', weekday: null, monthDay: dom }, today)
    // The weekly schedule is not due again until a week after its last day; only this one goes.
    expect(await jobs().runScheduledReports(venueAt(today, 9))).toBe(1)
    const sent = mailsTo(ownerEmail).slice(before)
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toMatch(/^Monthly report: events booked each month, \d{4}$/)
    expect(sent[0].html).toContain('Booked')
    expect((await k.O('GET', '/api/event-report-schedules')).json.data.find((s: any) => s.id === made.json.id).lastSentFor).toBe(due)
    await k.O('DELETE', `/api/event-report-schedules/${made.json.id}`)
  })

  test('send now mails the chosen seats at once without using up the day; only a seat that may change settings can', async () => {
    k.mails.length = 0
    expect((await k.B('POST', `/api/event-report-schedules/${scheduleId}/send-now`)).status).toBe(403)
    const res = await k.O('POST', `/api/event-report-schedules/${scheduleId}/send-now`)
    expect(res.status).toBe(200)
    expect(res.json.message).toBe('Sent to 3 people.')
    expect(k.mails.filter((m) => /report/i.test(m.subject))).toHaveLength(3)
    expect((await k.O('POST', '/api/event-report-schedules/nothing/send-now')).status).toBe(404)
  })

  test('paused, removed or with the feature off, it sends nothing; the routes and the timer follow the feature', async () => {
    expect((await k.O('PUT', `/api/event-report-schedules/${scheduleId}`, { active: false })).json.active).toBe(false)
    k.mails.length = 0
    expect(await jobs().runScheduledReports(venueAt(dayBefore(today, -14), 9))).toBe(0)
    expect((await k.O('PUT', `/api/event-report-schedules/${scheduleId}`, { active: true })).json.active).toBe(true)
    await k.features([...BASE, 'event_reports', 'event_marketing_spend'])
    expect(await jobs().runScheduledReports(venueAt(dayBefore(today, -14), 9))).toBe(0)
    expect([403, 404]).toContain((await k.O('GET', '/api/event-report-schedules')).status)
    expect(k.mails).toHaveLength(0)
    await k.features([...BASE, ...DEPTH])
    expect((await k.O('DELETE', `/api/event-report-schedules/${scheduleId}`)).status).toBe(200)
    expect((await k.O('GET', '/api/event-report-schedules')).json.data).toHaveLength(0)
    expect(await jobs().runScheduledReports(venueAt(dayBefore(today, -21), 9))).toBe(0)
  })
})
