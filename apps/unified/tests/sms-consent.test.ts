// Texting consent, the way the carriers require it before a business may text (A2P 10DLC), and what the Factory's
// campaign for each business describes (apps/api services/a2p.ts campaignContent):
//   · the business's own /privacy and /terms, with the text-message terms, linked from every page (site/legal.ts);
//   · an unticked "Text me" box beside every phone field — the enquiry forms, the booking page, the roof estimator —
//     one wording everywhere (site/smsConsent.ts);
//   · a ticked box kept by phone number, with where and what it said; an unticked one keeps nothing;
//   · a customer who texts the business first has agreed to be answered; STOP takes it back and marks them opted out.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createSmsService } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { consentWording, hasConsent, recordConsent, withdrawConsent } from '../server/site/smsConsent.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = ''
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const consents = async () => t.db.select().from(t.schema.smsConsent).where(eq(t.schema.smsConsent.companyId, companyId))
const enquiry = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return t.call('/api/leads', { method: 'POST', body: fd, headers: { accept: 'application/json', 'x-forwarded-for': '203.0.113.9' } })
}

beforeAll(async () => {
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ name: 'Acme Remodeling', email: 'hello@acme.example', phone: '608-555-0142' }).where(eq(t.schema.company.id, companyId))
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  await t.db.insert(t.schema.website).values({ companyId } as any)
  await as('/api/company/features', { method: 'PUT', json: { features: ['online_booking'] } })
  // ONE CLOCK (batch 2, fix-e): bookings keep the business's zone (Settings › Company); a zone of their own is refused.
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
  expect((await as('/api/booking/settings', { method: 'PATCH', json: { leadTimeMinutes: 60, maxDaysOut: 30 } })).status).toBe(200)
  await as('/api/booking/services', { method: 'POST', json: { name: 'Estimate', durationMinutes: 60, slotStepMinutes: 60 } })
  await as('/api/booking/hours', { method: 'PUT', json: { hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '08:00', end: '18:00' })) } })
})

describe('the business\'s own privacy policy and terms', () => {
  test('/privacy: the carriers\' words about texting, and the business\'s own contact', async () => {
    const r = await t.call('/privacy')
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('Privacy Policy')
    expect(html).toContain('No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.')
    expect(html).toContain('Reply STOP to stop receiving texts')
    expect(html).toContain('hello@acme.example')
    // only the analytics this business switched on — none here
    expect(html).not.toContain('Google Analytics')
  })

  test('/terms: what is texted, how often, the cost, STOP and HELP', async () => {
    const html = await (await t.call('/terms')).text()
    for (const words of ['Message frequency varies.', 'Message and data rates may apply.', '<strong>STOP</strong>', '<strong>HELP</strong>', 'never a condition of buying']) expect(html).toContain(words)
  })

  test('every page links to both', async () => {
    const html = await (await t.call('/privacy')).text()
    expect(html).toContain('<a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>')
  })
})

describe('the "Text me" box on a website enquiry', () => {
  test('ticked: kept by number, with the page, the address and the words it said; not part of the message', async () => {
    const r = await enquiry({ name: 'Pat Jones', email: 'pat@example.com', phone: '(608) 555-0100', message: 'A deck, please', source: '/contact', smsConsent: 'yes', smsConsentFor: 'enquiry' })
    expect(r.status).toBe(200)
    const [c] = (await consents()).filter((x) => x.phone === '+16085550100')
    expect(c).toMatchObject({ source: 'website_form', page: '/contact', ip: '203.0.113.9', wording: consentWording('enquiry') })
    const [lead] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'pat@example.com'))
    expect(String(lead.notes)).not.toContain('Sms')
  })

  test('unticked: nothing kept', async () => {
    await enquiry({ name: 'Sam Lee', email: 'sam@example.com', phone: '608-555-0111', message: 'A roof', source: '/contact' })
    expect(await hasConsent(t.db, companyId, '608-555-0111')).toBe(false)
  })
})

describe('the booking page', () => {
  test('the box is beside the phone field, unticked', async () => {
    const html = await (await t.call('/book/estimate')).text()
    expect(html).toContain('<input type="checkbox" name="smsConsent" value="yes">')
    expect(html).toContain(consentWording('booking'))
  })

  test('a booking with the box ticked is kept; without, nothing', async () => {
    const dates = (await (await t.call('/api/book/services/estimate/dates')).json()).data
    const date = dates[1]
    const times = (await (await t.call(`/api/book/services/estimate/times?date=${date}`)).json()).data
    const book = (time: string, phone: string, extra: any = {}) => t.call('/api/book/services/estimate', { method: 'POST', json: { date, time, name: 'Pat Jones', email: 'pat@example.com', phone, address: '12 Main St', zip: '53593', ...extra } })
    const first = await book(times[0].time, '608-555-0122', { smsConsent: 'yes' })
    expect(first.status).toBe(201)
    expect((await book(times[1].time, '608-555-0133')).status).toBe(201)
    const [c] = (await consents()).filter((x) => x.phone === '+16085550122')
    expect(c).toMatchObject({ source: 'booking', wording: consentWording('booking') })
    expect(await hasConsent(t.db, companyId, '608-555-0133')).toBe(false)
  })
})

describe('the customer\'s own texts', () => {
  test('texting first starts a record but never overwrites a ticked box; STOP takes it back and marks them opted out', async () => {
    // the business's own number (the Factory writes it on approval)
    await t.db.update(t.schema.company).set({ integrations: { twilioMessagingServiceSid: 'MG' + 'a'.repeat(32), twilioPhoneNumber: '+17155550123' } }).where(eq(t.schema.company.id, companyId))
    const [ct] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Pat Jones', phone: '608-555-0100' }).returning()
    const s = t.schema
    const sms = createSmsService({
      db: t.db, tables: { smsConversation: s.smsConversation, smsMessage: s.smsMessage, smsTemplate: s.smsTemplate, contact: s.contact, company: s.company, job: s.job, user: s.user, teamMember: s.teamMember },
      onConsent: (co: string, phone: string, change: 'given' | 'withdrawn') => change === 'given' ? recordConsent(t.db, co, { phone, source: 'texted_first' }).then(() => {}) : withdrawConsent(t.db, co, phone),
    } as any)
    // a new number texts in: consent to be answered
    await sms.handleIncomingSMS({ From: '+16085550144', To: '+17155550123', Body: 'Do you do decks?', MessageSid: 'SM1' })
    expect((await consents()).find((x) => x.phone === '+16085550144')?.source).toBe('texted_first')
    // Pat ticked the box on the website: a later text from Pat keeps that record
    await sms.handleIncomingSMS({ From: '+16085550100', To: '+17155550123', Body: 'Thanks!', MessageSid: 'SM2' })
    expect((await consents()).find((x) => x.phone === '+16085550100')?.source).toBe('website_form')
    // STOP
    await sms.handleIncomingSMS({ From: '+16085550100', To: '+17155550123', Body: ' stop ', MessageSid: 'SM3' })
    expect(await hasConsent(t.db, companyId, '608-555-0100')).toBe(false)
    expect((await t.db.select().from(s.contact).where(eq(s.contact.id, ct.id)))[0].optedOutSms).toBe(true)
    // START undoes the opt-out
    await sms.handleIncomingSMS({ From: '+16085550100', To: '+17155550123', Body: 'START', MessageSid: 'SM4' })
    expect((await t.db.select().from(s.contact).where(eq(s.contact.id, ct.id)))[0].optedOutSms).toBe(false)
  })
})

test('the roof estimator widget says the same words as the server keeps', () => {
  const src = fs.readFileSync(path.join(import.meta.dir, '../site/public/scripts/estimator.ts'), 'utf8')
  const m = /const SMS_CONSENT_WORDING = '([^']+)'/.exec(src)
  expect(m?.[1]).toBe(consentWording('estimate'))
})
