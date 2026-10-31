// Automatic retention sends (salon gap #9; server/crm/salon/retention.ts, feature `retention_sends`). Rebook on the due date, birthday, win-back
// after N days, a "book your next visit" prompt after a completed visit, and drips started by completed visits. A text goes only to a number that
// agreed and never to one that replied STOP, else an email with its unsubscribe link; nothing in quiet hours; once per client per event.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'rebooking_reminders', 'email_marketing', 'invoices']
const PASSWORD = 'Retain-1030-x'
const DAY = 86400_000

describe('salon: automatic retention sends', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', stylist = '', colour = ''
  const tokens: Record<string, string> = {}
  const texts: Array<{ to: string; message: string; contactId: string }> = []
  const emails: Array<{ to: string; subject: string; html: string }> = []
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.9.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const today = () => tzParts(new Date(), TZ).date
  // n days ago on the SHOP's calendar (the app counts the rebook date on it); UTC's date is a day ahead every Chicago evening.
  const shopDaysAgo = (n: number) => tzParts(new Date(Date.now() - n * DAY), TZ).date
  const noon = (dateStr: string) => new Date(`${dateStr}T18:00:00Z`)           // midday in Chicago, whatever the season
  const settings = (patch: Record<string, unknown>) => as('owner', '/api/retention/settings', 'PUT', patch)
  const run = (dryRun = false) => as('owner', '/api/retention/run', 'POST', { dryRun })
  const logOf = async () => ((await as('owner', '/api/retention/log')).body.data as any[])
  const client = (name: string, extra: Record<string, unknown> = {}) => ins(t.schema.contact, { companyId: co, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, mobile: `608555${String(1000 + ++ip).slice(-4)}`, type: 'client', ...extra })
  const consent = (c: any) => ins(t.schema.smsConsent, { companyId: co, phone: '+1' + String(c.mobile).replace(/\D/g, ''), source: 'booking', givenAt: new Date() })
  const visitOn = (c: any, dateStr: string) => ins(t.schema.serviceRecord, { companyId: co, contactId: c.id, serviceId: colour, performedAt: noon(dateStr), formula: [], stylistId: stylist })

  beforeAll(async () => {
    process.env.API_BASE_URL = 'https://api.salon.test'
    process.env.SITE_URL = 'https://salon.test'
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, name: 'Test Salon' } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const u = await ins(t.schema.user, { email: 'stylist@test.example', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: 'Sam', lastName: 'Stylist', role: 'field', companyId: co })
    stylist = u.id
    tokens.stylist = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'stylist@test.example', password: PASSWORD } })).json()) as any).accessToken
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 120, rebookIntervalDays: 28 })).body.id
    ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push({ to: m.toPhone, message: m.message, contactId: m.contactId }); return { status: 'sent' } }
    ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { emails.push(m) }
  }, 120_000)

  test('off by default: closed without the feature, and with it on but every part off, a pass sends nothing', async () => {
    expect((await as('owner', '/api/retention/settings')).status).not.toBe(200)
    await features([...FEATURES, 'retention_sends'])
    const s = (await as('owner', '/api/retention/settings')).body
    expect([s.rebook, s.birthday, s.winBack, s.nextVisit, s.drips, s.since]).toEqual([false, false, false, false, false, null])
    const c = await client('Due Dora'); await consent(c); await visitOn(c, shopDaysAgo(28))
    expect((await run()).body.sent).toBe(0)
    expect(texts).toHaveLength(0)
  })

  test('only a seat that may change the company changes the settings; values are checked', async () => {
    expect((await as('stylist', '/api/retention/settings', 'PUT', { rebook: true })).status).toBe(403)
    expect((await as('stylist', '/api/retention/run', 'POST', {})).status).toBe(403)
    for (const bad of [{ rebook: 'yes' }, { winBackDays: 5 }, { winBackDays: 90.5 }, { quietStart: '25:00' }, { templates: { rebook: 'Hi {nickname}' } }, { templates: { sale: 'x' } }, { templates: { rebook: 'x'.repeat(400) } }]) {
      const r = await settings(bad)
      expect([r.status, r.body.code]).toEqual([400, 'BAD_SETTING'])
    }
    expect((await as('stylist', '/api/retention/settings')).status).toBe(200)               // anyone who reads clients can read them
  })

  test('quiet hours: nothing is sent inside them (a preview still lists who would be), and it goes out once they end', async () => {
    const p = tzParts(new Date(), TZ).minutes
    const hhmm = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}` }
    expect((await settings({ rebook: true, quietStart: hhmm(p - 60), quietEnd: hhmm(p + 60) })).status).toBe(200)
    expect((await as('owner', '/api/retention/settings')).body.since).toBeTruthy()
    const quiet = (await run()).body
    expect([quiet.quiet, quiet.sent]).toEqual([true, 0])
    expect(texts).toHaveLength(0)
    const preview = (await run(true)).body
    expect(preview.wouldSend.map((w: any) => [w.client, w.kind, w.via])).toEqual([['Due Dora', 'rebook', 'sms']])
    expect(texts).toHaveLength(0)
    expect((await settings({ quietStart: '00:00', quietEnd: '00:00' })).status).toBe(200)     // no quiet hours
  })

  test('rebook on the due date: text to a number that agreed; email (with unsubscribe) to the rest; STOP and unsubscribed never; old history never; once', async () => {
    const bob = await client('Email Bob'); await visitOn(bob, shopDaysAgo(28))      // phone but no consent -> email
    const cy = await client('Quiet Cy', { emailOptOut: true }); await visitOn(cy, shopDaysAgo(28))
    const dee = await client('Stopped Dee', { optedOutSms: true }); await consent(dee); await visitOn(dee, shopDaysAgo(28))
    const olga = await client('Old Olga'); await consent(olga); await visitOn(olga, shopDaysAgo(30))   // was due 2 days ago: before it was switched on
    const r = (await run()).body
    expect(r.sent).toBe(3)                                                                    // Dora (text), Bob (email), Dee (email)
    expect(texts.map((x) => x.message.startsWith('Test Salon: Hi Due,') && /Book online: https:\/\/salon\.test\/book/.test(x.message) && /Reply STOP/.test(x.message))).toEqual([true])
    expect(emails.map((e) => e.to).sort()).toEqual(['email@example.com', 'stopped@example.com'])
    expect(emails.every((e) => e.html.includes('/api/marketing/unsubscribe/none/') && e.html.includes('https://salon.test/book'))).toBe(true)
    const log = await logOf()
    expect(log.find((l) => l.clientName === 'Quiet Cy')).toMatchObject({ status: 'skipped' })
    expect(log.find((l) => l.clientName === 'Quiet Cy').reason).toContain('unsubscribed')
    expect(log.find((l) => l.clientName === 'Old Olga')).toBeUndefined()
    // a second pass, a third: nothing more
    expect((await run()).body.sent).toBe(0)
    expect(texts).toHaveLength(1)
    expect(emails).toHaveLength(2)
  })

  test('birthday, win-back, next-visit prompt: each once; a client already messaged this week waits; a client with a booking is not chased; a rebooking due before the switch-on day waits for it', async () => {
    texts.length = 0; emails.length = 0
    // The salon switched retention on two days ago (a visit completed before that moment is never chased).
    const [row] = await t.db.select({ settings: t.schema.company.settings }).from(t.schema.company).where(eq(t.schema.company.id, co))
    const rs: any = row.settings; rs.retention.since = new Date(Date.now() - 2 * DAY).toISOString()
    await t.db.update(t.schema.company).set({ settings: rs } as any).where(eq(t.schema.company.id, co))
    expect((await settings({ birthday: true, winBack: true, winBackDays: 90, nextVisit: true })).status).toBe(200)
    const p = tzParts(new Date(), TZ).date.split('-')
    const bday = await client('Birthday Bea'); await consent(bday)
    await ins(t.schema.clientProfile, { contactId: bday.id, companyId: co, birthday: `1990-${p[1]}-${p[2]}` })
    const gone = await client('Lapsed Lou'); await consent(gone); await visitOn(gone, addDays(tzParts(new Date(), TZ).date, -90))
    const booked = await client('Booked Bo'); await consent(booked); await visitOn(booked, addDays(tzParts(new Date(), TZ).date, -90))
    await ins(t.schema.appointment, { companyId: co, contactId: booked.id, status: 'scheduled', startTime: new Date(Date.now() + 3 * DAY), endTime: new Date(Date.now() + 3 * DAY + 3600_000) })
    const fresh = await client('Fresh Fay'); await consent(fresh)
    const done = await ins(t.schema.appointment, { companyId: co, contactId: fresh.id, status: 'completed', startTime: new Date(Date.now() - 2 * 3600_000), endTime: new Date(Date.now() - 3600_000), stylistId: stylist })
    await t.db.update(t.schema.appointment).set({ updatedAt: new Date(Date.now() - 40 * 60_000) } as any).where(eq(t.schema.appointment.id, done.id))
    const stay = await client('Staying Sue'); await consent(stay)
    const stayDone = await ins(t.schema.appointment, { companyId: co, contactId: stay.id, status: 'completed', startTime: new Date(Date.now() - 2 * 3600_000), endTime: new Date(Date.now() - 3600_000) })
    await t.db.update(t.schema.appointment).set({ updatedAt: new Date(Date.now() - 40 * 60_000) } as any).where(eq(t.schema.appointment.id, stayDone.id))
    await ins(t.schema.appointment, { companyId: co, contactId: stay.id, status: 'confirmed', startTime: new Date(Date.now() + 20 * DAY), endTime: new Date(Date.now() + 20 * DAY + 3600_000) })
    const r = (await run()).body
    const sentTo = texts.map((x) => x.message.split(',')[0] + '|' + (x.message.match(/Happy birthday|miss you|Thanks for coming/)?.[0] ?? '')).sort()
    expect(sentTo).toEqual(['Test Salon: Happy birthday|Happy birthday', 'Test Salon: Hi Lapsed|miss you', 'Test Salon: Thanks for coming in|Thanks for coming', 'Test Salon: Hi Old|'].sort())     // Olga: due 2 days ago, now after the switch-on day
    expect(r.sent).toBe(4)
    // Dora was texted at the rebook step, earlier this week: she gets nothing else; and a second pass sends nothing
    expect(texts.some((x) => /Due/.test(x.message))).toBe(false)
    expect((await run()).body.sent).toBe(0)
  })

  test('drips: a completed visit starts the salon\'s own follow-up sequence (and only once)', async () => {
    const seq = (await as('owner', '/api/marketing/sequences', 'POST', { name: 'After a visit', trigger: 'visit_completed', active: true, steps: [{ delayDays: 1, delayHours: 0, subject: 'How was it?', body: '<p>Thanks for coming in</p>' }] }))
    expect(seq.status).toBe(201)
    expect((await settings({ drips: true })).status).toBe(200)
    const dripper = await client('Drip Dan'); await consent(dripper)
    const a = await ins(t.schema.appointment, { companyId: co, contactId: dripper.id, status: 'completed', startTime: new Date(Date.now() - 2 * 3600_000), endTime: new Date(Date.now() - 3600_000) })
    await t.db.update(t.schema.appointment).set({ updatedAt: new Date(Date.now() - 40 * 60_000) } as any).where(eq(t.schema.appointment.id, a.id))
    expect((await run()).body.sent).toBeGreaterThan(0)
    const enrolled = (await as('owner', `/api/marketing/sequences/${seq.body.id}/enrollments`)).body
    const rows = (enrolled.data ?? enrolled) as any[]
    expect(rows.filter((e) => /Dan/.test(e.contact_name ?? e.contactName ?? '')).length).toBe(1)
    await run()
    expect(((await as('owner', `/api/marketing/sequences/${seq.body.id}/enrollments`)).body.data ?? []).filter((e: any) => /Dan/.test(e.contact_name ?? e.contactName ?? '')).length).toBe(1)
  })
})
