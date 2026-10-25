// Texts to the customer about a booking (server/booking/texts.ts), the premium site's three: the confirmation when it
// is booked, the reminder the day before (20–28 hours out, once), and the review request beside the review email. Sent
// through the CRM's texting (a fake here): to the booking's contact; a business that can't text yet (refused) is
// tried again on the next pass; a customer who opted out is not tried again. Plus the real sender's three answers.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createBookingEngine } from '../server/booking/engine.ts'
import { createHappenings } from '../server/booking/happenings.ts'
import { createBookingExtras } from '../server/booking/extras.ts'
import { createBookingWebhooks } from '../server/booking/webhooks.ts'
import { createBookingTexts, type BookingTexts, type TextOutcome } from '../server/booking/texts.ts'

const quiet = { info() {}, warn() {}, error() {} } as any
const NOW = Date.parse('2026-11-02T15:00:00Z') // Monday 09:00 Chicago
let clock = NOW
let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const texted: Array<{ contactId: string | null; message: string }> = []
let answer: TextOutcome = 'sent'
const texts: BookingTexts = { send: async (b, message) => { texted.push({ contactId: b.contactId, message }); return answer } }

let engine: ReturnType<typeof createBookingEngine>
let extras: ReturnType<typeof createBookingExtras>
const row = async (id: string) => (await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.id, id)))[0]
const who = { name: 'Pat Jones', email: 'pat@example.com', phone: '608-555-0100' }

beforeAll(async () => {
  process.env.SITE_URL = 'https://acme.example'
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id
  // One clock (coordinator 10/23): the business's zone, set in Settings › Company, is the one Bookings keeps time on.
  await t.db.update(t.schema.company).set({ name: 'Acme Remodeling', timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
  const webhooks = createBookingWebhooks({ db: t.db, logger: quiet })
  const happen = createHappenings({ db: t.db, email: t.services.email, logger: quiet, webhooks, texts, offered: (svc) => engine.offered(svc) })
  engine = createBookingEngine({ db: t.db, requireAddressDefault: false, now: () => clock, onHappening: (h) => happen(h) })
  extras = createBookingExtras({ db: t.db, engine, email: t.services.email, logger: quiet, webhooks, texts, now: () => clock })
  await engine.updateSettings(companyId, { timezone: 'America/Chicago', leadTimeMinutes: 60, maxDaysOut: 14, reviewLink: 'https://g.page/r/acme' })
  await engine.setHours(companyId, [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' })))
  await engine.createService(companyId, { name: 'Estimate', durationMinutes: 60, slotStepMinutes: 60 })
})

describe('the confirmation', () => {
  test('a booking is confirmed by text to its contact, naming the business, the time and the way to change it', async () => {
    texted.length = 0
    const { booking: b } = await engine.book(companyId, { service: 'estimate', date: '2026-11-03', time: '14:00', ...who }, { by: 'customer' })
    expect(b.contactId).toBeTruthy()
    expect(texted).toHaveLength(1)
    expect(texted[0].contactId).toBe(b.contactId)
    expect(texted[0].message).toContain('Acme Remodeling: your Estimate is booked for')
    expect(texted[0].message).toContain('2:00')
    expect(texted[0].message).toContain(`https://acme.example/booking/${b.token}`)
    expect(texted[0].message).toContain('Reply STOP to opt out')
  })
})

describe('the reminder the day before', () => {
  test('sent once, 20–28 hours out; not again on the next pass', async () => {
    texted.length = 0
    // the 14:00 booking above is 29 hours from Monday 09:00 — the pass an hour later finds it (28 hours out)
    clock = NOW + 3600_000
    const first = await extras.runJobs()
    const reminders = texted.filter((x) => x.message.includes('a reminder of your Estimate'))
    expect(reminders).toHaveLength(1)
    expect(first.reminders).toBeGreaterThanOrEqual(1)
    await extras.runJobs()
    expect(texted.filter((x) => x.message.includes('a reminder of your Estimate'))).toHaveLength(1)
    clock = NOW
  })

  test('a business that cannot text yet is tried again; a customer who opted out is not', async () => {
    const { booking: b } = await engine.book(companyId, { service: 'estimate', date: '2026-11-03', time: '15:00', ...who, email: 'two@example.com' }, { by: 'customer' })
    clock = NOW + 2 * 3600_000
    answer = 'refused'
    texted.length = 0
    await extras.runJobs()
    expect(texted.some((x) => x.message.includes('a reminder'))).toBe(true)
    expect((await row(b.id)).reminderSmsSentAt).toBeNull()
    answer = 'skipped' // they replied STOP since
    await extras.runJobs()
    expect((await row(b.id)).reminderSmsSentAt).not.toBeNull()
    texted.length = 0
    await extras.runJobs()
    expect(texted.some((x) => x.message.includes('a reminder'))).toBe(false)
    answer = 'sent'
    clock = NOW
  })
})

describe('the review request', () => {
  test('a day after a completed visit, beside the email, once', async () => {
    const { booking: b } = await engine.book(companyId, { service: 'estimate', date: '2026-11-04', time: '10:00', ...who, email: 'three@example.com' }, { by: 'customer' })
    clock = Date.parse('2026-11-04T17:00:00Z')
    await engine.setStatus(companyId, b, 'completed')
    clock = Date.parse('2026-11-05T18:00:00Z')
    texted.length = 0
    await extras.runJobs()
    const review = texted.filter((x) => x.message.includes('a quick review'))
    expect(review).toHaveLength(1)
    expect(review[0].message).toBe('Hi Pat, thanks for choosing Acme Remodeling! If we did good work, a quick review would mean a lot: https://g.page/r/acme')
    await extras.runJobs()
    expect(texted.filter((x) => x.message.includes('a quick review'))).toHaveLength(1)
    clock = NOW
  })
})

describe('the real sender', () => {
  test('sent, opted out (null) and refused (no texting / no balance) read as such; no contact or phone is skipped', async () => {
    const asked: any[] = []
    const make = (r: any, consented = true) => createBookingTexts({ sendSMS: async (companyId, p) => { asked.push({ companyId, ...p }); return r } }, async () => consented)
    const b = { companyId: 'co', contactId: 'ct', customerPhone: '608-555-0100' }
    expect(await make({ status: 'sent' }).send(b, 'hi')).toBe('sent')
    expect(asked[0]).toEqual({ companyId: 'co', contactId: 'ct', message: 'hi' })
    expect(await make(null).send(b, 'hi')).toBe('skipped')
    expect(await make({ status: 'refused', refused: true }).send(b, 'hi')).toBe('refused')
    expect(await make({ status: 'sent' }).send({ ...b, contactId: null }, 'hi')).toBe('skipped')
    expect(await make({ status: 'sent' }).send({ ...b, customerPhone: null }, 'hi')).toBe('skipped')
  })

  test('a number that never agreed to texts is skipped, and nothing is sent', async () => {
    const asked: any[] = []
    const texts = createBookingTexts({ sendSMS: async (companyId, p) => { asked.push({ companyId, ...p }); return { status: 'sent' } } }, async (co, phone) => co === 'co' && phone === '608-555-0199')
    expect(await texts.send({ companyId: 'co', contactId: 'ct', customerPhone: '608-555-0100' }, 'hi')).toBe('skipped')
    expect(asked).toEqual([])
    expect(await texts.send({ companyId: 'co', contactId: 'ct', customerPhone: '608-555-0199' }, 'hi')).toBe('sent')
  })
})
