// Client portal depth (salon row 21; packages/tenant-backend portal.ts, server crm/salon/portalHooks.ts, seen only with `portal_appointments`):
//   · Past visits, each with "Book again" for a service that can be booked online;
//   · My account: memberships (credits left), gift-card balances (last four digits, a lapsed bonus not counted) and loyalty points;
//   · Move or cancel for a booking the DESK made, through the booking page the engine already has — under the salon's notice rules, and
//     "please call us" where the engine could not move it faithfully (several services, no email, too close, not bookable online);
//   · Booking a new appointment from inside the portal, for the signed-in client only, through the engine's own booking.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const BASE = ['contacts', 'client_portal', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices', 'portal_appointments']

describe('salon: client portal depth', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ownerToken = '', cut = '', brow = '', ana = ''
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${ownerToken}` } })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const portal = async (contactId: string) => {
    const e = await as(`/api/portal/contacts/${contactId}/enable`, 'POST')
    expect(e.status).toBe(200)
    return String(e.body.portalUrl).split('/').pop() as string
  }
  const call = async (token: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(`/api/portal/p/${token}${path}`, { method, json })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any }
  }
  const when = (days: number, hour = 10) => { const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d }

  let pia = '', noMail = '', other = ''

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    ownerToken = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(BASE)
    expect((await as('/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0, selfServiceCutoffMinutes: 120 })).status).toBe(200)
    cut = (await as('/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).body.id
    brow = (await as('/api/service-menu', 'POST', { name: 'Brow tint', category: 'skin', durationMin: 20, price: 25, bookableOnline: false })).body.id
    pia = (await ins(t.schema.contact, { companyId: co, name: 'Portal Pia', email: 'pia@example.com', type: 'client' })).id
    noMail = (await ins(t.schema.contact, { companyId: co, name: 'No Mail', email: 'nomail@example.com', type: 'client' })).id
    other = (await ins(t.schema.contact, { companyId: co, name: 'Someone Else', email: 'else@example.com', type: 'client' })).id
    ana = (await ins(t.schema.user, { email: 'ana@test.example', passwordHash: await Bun.password.hash('Portal-1031', 'bcrypt'), firstName: 'Ana', lastName: 'Stylist', role: 'field', companyId: co })).id
  }, 120_000)

  test('past visits carry "Book again" only for a service that can be booked online', async () => {
    await ins(t.schema.appointment, { companyId: co, contactId: pia, serviceId: cut, stylistId: ana, status: 'completed', startTime: when(-9), endTime: when(-9, 11) })
    await ins(t.schema.appointment, { companyId: co, contactId: pia, serviceId: brow, status: 'completed', startTime: when(-20), endTime: when(-20, 11) })
    await ins(t.schema.appointment, { companyId: co, contactId: pia, serviceId: cut, status: 'cancelled', startTime: when(-3), endTime: when(-3, 11) })
    await ins(t.schema.appointment, { companyId: co, contactId: other, serviceId: cut, status: 'completed', startTime: when(-5), endTime: when(-5, 11) })
    const r = await call(await portal(pia), '/appointments/past')
    expect(r.status).toBe(200)
    expect(r.body.map((a: any) => a.service)).toEqual(['Cut', 'Brow tint'])     // newest first; not the cancelled one, not someone else's
    expect(r.body[0]).toMatchObject({ with: 'Ana', bookAgain: { name: 'Cut' } })
    expect(typeof r.body[0].bookAgain.slug).toBe('string')
    expect(r.body[1].bookAgain).toBeNull()
    expect(JSON.stringify(r.body)).not.toContain('quotedPrice')
  })

  test('a chair-only stylist (a Team member with no login) is named by first name, upcoming and past', async () => {
    const chair = await ins(t.schema.teamMember, { companyId: co, name: 'Rosa Chairrenter', active: true })
    await ins(t.schema.appointment, { companyId: co, contactId: pia, serviceId: cut, stylistMemberId: chair.id, status: 'scheduled', startTime: when(11), endTime: when(11, 11) })
    await ins(t.schema.appointment, { companyId: co, contactId: pia, serviceId: cut, stylistMemberId: chair.id, status: 'completed', startTime: when(-30), endTime: when(-30, 11) })
    const token = await portal(pia)
    const up = (await call(token, '/appointments')).body.filter((a: any) => a.with === 'Rosa')
    expect(up).toHaveLength(1)
    expect(JSON.stringify(up)).not.toContain('Chairrenter')
    expect((await call(token, '/appointments/past')).body.some((a: any) => a.with === 'Rosa')).toBe(true)
  })

  test('the past list and everything below answer 404 without the feature', async () => {
    await features(BASE.filter((f) => f !== 'portal_appointments'))
    const token = await portal(pia)
    for (const p of ['/appointments/past', '/account', '/book/services']) expect((await call(token, p)).status).toBe(404)
    expect((await call(token, '/appointments/x/manage', 'POST')).status).toBe(404)
    await features(BASE)
  })

  test('my account: membership credits, gift-card balance (last four only, lapsed bonus left out) and loyalty points', async () => {
    await features([...BASE, 'salon_memberships', 'salon_gift_cards', 'loyalty_rewards'])
    const plan = await ins(t.schema.membershipPlan, { companyId: co, name: 'Blowout club', price: '60', billingCycle: 'monthly', creditsTotal: 4 })
    await ins(t.schema.membershipEnrollment, { companyId: co, planId: plan.id, contactId: pia, status: 'active', creditsRemaining: 3, renewsAt: addDays(today(), 12) })
    await ins(t.schema.membershipEnrollment, { companyId: co, planId: plan.id, contactId: other, status: 'active', creditsRemaining: 1 })
    await ins(t.schema.salonGiftCard, { companyId: co, code: 'GIFT-AAAA-1234', initialCents: 12000, balanceCents: 12000, purchaserContactId: pia, bonusGrantedCents: 2000, bonusCents: 2000, bonusExpiresOn: addDays(today(), -1) })
    await ins(t.schema.salonGiftCard, { companyId: co, code: 'GIFT-BBBB-9999', initialCents: 5000, balanceCents: 5000, recipientEmail: 'PIA@example.com' })
    await ins(t.schema.salonGiftCard, { companyId: co, code: 'GIFT-CCCC-0000', initialCents: 5000, balanceCents: 5000, purchaserContactId: other })
    await ins(t.schema.salonGiftCard, { companyId: co, code: 'GIFT-DDDD-7777', initialCents: 5000, balanceCents: 5000, purchaserContactId: pia, status: 'pending' })
    expect((await as('/api/loyalty/config', 'PUT', { loyaltyPointsPerDollar: 1 })).status).toBe(200)
    await ins(t.schema.loyaltyMember, { companyId: co, contactId: pia, pointsBalance: 140, lifetimePoints: 140 })
    const token = await portal(pia)
    const home = await call(token, '')
    expect(home.body.sections.account).toBe(true)
    const r = await call(token, '/account')
    expect(r.status).toBe(200)
    expect(r.body.memberships).toHaveLength(1)
    expect(r.body.memberships[0]).toMatchObject({ plan: 'Blowout club', creditsLeft: 3, creditsTotal: 4, priceCents: 6000, cycle: 'monthly' })
    expect(r.body.giftCards.map((g: any) => [g.endsWith, g.balanceCents]).sort()).toEqual([['1234', 10000], ['9999', 5000]])   // lapsed $20 bonus not spendable; pending and others' cards out
    expect(JSON.stringify(r.body)).not.toContain('GIFT-')
    expect(r.body.loyalty.points).toBe(140)
    // nobody else's data
    const theirs = await call(await portal(other), '/account')
    expect(theirs.body.memberships).toHaveLength(1)
    expect(theirs.body.memberships[0].creditsLeft).toBe(1)
    expect(theirs.body.giftCards.map((g: any) => g.endsWith)).toEqual(['0000'])
    expect(theirs.body.loyalty.points).toBe(0)
  })

  test('the account section is off, not empty, when none of memberships, gift cards or loyalty is on', async () => {
    await features(BASE)
    const token = await portal(pia)
    expect((await call(token, '')).body.sections.account).toBe(true)     // the section follows the portal feature…
    expect((await call(token, '/account')).status).toBe(404)             // …and the data door says so when the salon sells none of it
  })

  test('a desk booking can be moved or cancelled by its client: the engine\'s own booking page is made for it', async () => {
    const appt = await ins(t.schema.appointment, { companyId: co, contactId: pia, serviceId: cut, stylistId: ana, status: 'scheduled', startTime: when(6), endTime: when(6, 11) })
    const token = await portal(pia)
    const list = await call(token, '/appointments')
    const row = list.body.find((a: any) => a.id === appt.id)
    expect(row).toMatchObject({ manageUrl: null, canManage: true })
    const m = await call(token, `/appointments/${appt.id}/manage`, 'POST')
    expect(m.status).toBe(200)
    expect(m.body.url).toMatch(/\/booking\/[A-Za-z0-9_-]+$/)
    const again = await call(token, `/appointments/${appt.id}/manage`, 'POST')
    expect(again.body.url).toBe(m.body.url)                             // one page per appointment
    const page = await t.call(`/booking/${m.body.url.split('/').pop()}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Cut')
    // and the page now carries the link in the list
    expect((await call(token, '/appointments')).body.find((a: any) => a.id === appt.id).manageUrl).toBe(m.body.url)
  })

  test('where the engine cannot move it faithfully, the client is told to call', async () => {
    const token = await portal(pia)
    const notBookable = await ins(t.schema.appointment, { companyId: co, contactId: pia, serviceId: brow, status: 'scheduled', startTime: when(7), endTime: when(7, 11) })
    const soon = await ins(t.schema.appointment, { companyId: co, contactId: pia, serviceId: cut, status: 'scheduled', startTime: new Date(Date.now() + 60 * 60_000), endTime: new Date(Date.now() + 90 * 60_000) })
    const several = await ins(t.schema.appointment, { companyId: co, contactId: pia, serviceId: cut, status: 'scheduled', startTime: when(8), endTime: when(8, 12) })
    await ins(t.schema.appointmentItem, { companyId: co, appointmentId: several.id, serviceId: cut, position: 0, startOffsetMin: 0, durationMin: 30 })
    for (const [a, words] of [[notBookable, 'call us'], [soon, 'too close'], [several, 'several services']] as const) {
      const r = await call(token, `/appointments/${a.id}/manage`, 'POST')
      expect([r.status, r.body.code]).toEqual([409, 'CALL_US'])
      expect(r.body.error).toContain(words)
    }
    const list = (await call(token, '/appointments')).body
    for (const a of [notBookable, soon, several]) expect(list.find((x: any) => x.id === a.id).canManage).toBe(false)
    // no email on file
    const nm = await portal(noMail)
    await t.db.update(t.schema.contact).set({ email: null } as any).where(eq(t.schema.contact.id, noMail))
    const mine = await ins(t.schema.appointment, { companyId: co, contactId: noMail, serviceId: cut, status: 'scheduled', startTime: when(9), endTime: when(9, 11) })
    const r2 = await call(nm, `/appointments/${mine.id}/manage`, 'POST')
    expect([r2.status, r2.body.code]).toEqual([409, 'CALL_US'])
    expect(r2.body.error).toContain('email')
    // not yours
    const theirs = await ins(t.schema.appointment, { companyId: co, contactId: other, serviceId: cut, status: 'scheduled', startTime: when(10), endTime: when(10, 11) })
    expect((await call(token, `/appointments/${theirs.id}/manage`, 'POST')).status).toBe(409)
    expect(await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.appointmentId, theirs.id))).toHaveLength(0)
  })

  test('book from inside the portal: the booking page\'s services, days and times, for this client alone', async () => {
    const token = await portal(pia)
    const services = await call(token, '/book/services')
    expect(services.status).toBe(200)
    expect(services.body.map((s: any) => s.name)).toEqual(['Cut'])         // only what is bookable online
    const slug = services.body[0].slug
    const dates = await call(token, `/book/services/${slug}/dates`)
    expect(dates.status).toBe(200)
    expect(dates.body.length).toBeGreaterThan(0)
    const day = next(3, 5)
    const times = await call(token, `/book/services/${slug}/times?date=${day}`)
    expect(times.status).toBe(200)
    expect(times.body.length).toBeGreaterThan(0)
    const pick = times.body[0].time
    // the booking page needs a phone number: this client has none on file, so they are asked in words, then give one
    const noPhone = await call(token, `/book/services/${slug}`, 'POST', { date: day, time: pick })
    expect(noPhone.status).toBe(400)
    expect(noPhone.body.error).toContain('phone')
    const made = await call(token, `/book/services/${slug}`, 'POST', { date: day, time: pick, phone: '608-555-0111', notes: 'Short please', name: 'Mallory', email: 'mallory@example.com' })
    expect(made.status).toBe(201)
    expect(made.body.url).toMatch(/\/booking\/.+$/)
    const [b] = await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.token, made.body.token))
    expect(b).toMatchObject({ customerName: 'Portal Pia', customerEmail: 'pia@example.com' })   // the signed-in client, never what the body says
    const list = await call(token, '/appointments')
    expect(list.body.some((a: any) => a.manageUrl?.endsWith(made.body.token))).toBe(true)
    // the same slot is gone for the next client
    const left = await call(await portal(other), `/book/services/${slug}/times?date=${day}`)
    expect(left.body.filter((x: any) => x.time === pick)).toHaveLength(0)
    // bad day / unknown service are words, not crashes
    const bad = await call(token, `/book/services/${slug}`, 'POST', { date: '2020-01-01', time: '10:00' })
    expect(bad.status).toBeGreaterThanOrEqual(400); expect(bad.status).toBeLessThan(500)
    expect((await call(token, '/book/services/nope', 'POST', { date: day, time: pick })).status).toBeGreaterThanOrEqual(400)
  })

  test('no email on file: booking in the portal says so in words; online booking off: the door is 404', async () => {
    await t.db.update(t.schema.contact).set({ email: 'nomail@example.com' } as any).where(eq(t.schema.contact.id, noMail))
    const token = await portal(noMail)
    await t.db.update(t.schema.contact).set({ email: null } as any).where(eq(t.schema.contact.id, noMail))
    const slug = (await call(token, '/book/services')).body[0].slug
    const day = next(4, 5)
    const time = (await call(token, `/book/services/${slug}/times?date=${day}`)).body[0].time
    const r = await call(token, `/book/services/${slug}`, 'POST', { date: day, time })
    expect([r.status, r.body.code]).toEqual([409, 'NO_EMAIL'])
    expect((await as('/api/booking/settings', 'PATCH', { enabled: false })).status).toBe(200)
    expect((await call(token, '/book/services')).status).toBe(404)
    expect((await call(await portal(pia), '/appointments/past')).body[0].bookAgain).toBeNull()     // nothing to book again while it is closed
    expect((await as('/api/booking/settings', 'PATCH', { enabled: true })).status).toBe(200)
  })
})
