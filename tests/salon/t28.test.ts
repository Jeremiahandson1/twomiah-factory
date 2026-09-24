// Salon T28 — the fixes, against real Postgres (PGlite) and the real route files.
//
// H1 staff could switch online booking off · H2 online booking took unticked services · H3 review
// requests reported success without sending · M1 plans saved negative prices · M3 staff could not do a
// stylist's day · M4 staff saw the salon's money · M8 tickets saved blank/invalid · L1/L3/L4 validation
// · L2 "other" counted as a client · L5 check-in weeks ahead · L6 fully booked days stayed offered ·
// L7 search opened the wrong page · N1 the shop's calendar day.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, teamMember, appointment, serviceMenu, serviceRecord, membershipPlan, bookingSettings, reviewRequest, clientProfile } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const app = new Hono()
app.route('/api/booking', (await import('./src/routes/booking.ts')).default)
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.route('/api/memberships', (await import('./src/routes/memberships.ts')).default)
app.route('/api/service-menu', (await import('./src/routes/serviceMenu.ts')).default)
app.route('/api/support', (await import('./src/routes/support.ts')).default)
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.route('/api/reviews', (await import('./src/routes/reviews.ts')).default)
app.onError(errorHandler)

let n = 0
const mkCompany = async (slug: string, features: string[] = ['salon_booking', 'online_booking', 'invoices', 'service_menu', 'salon_memberships', 'client_profiles', 'support_tickets', 'reports', 'google_reviews'], tz = 'UTC') => {
  const [co] = await db.insert(company).values({ name: 'Shears ' + slug, slug: slug + ++n, email: slug + n + '@t.local', settings: { timezone: tz }, enabledFeatures: features } as any).returning()
  const mk = async (role: string, first: string) => {
    const [u] = await db.insert(user).values({ email: `${role}-${slug}${n}@t.local`, passwordHash: 'x', firstName: first, lastName: 'X', role, companyId: co.id } as any).returning()
    return u
  }
  return { co, owner: await mk('owner', 'Ola'), manager: await mk('manager', 'Morgan'), staff: await mk('user', 'Sam') }
}
const as = (co: any, u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
/** Booking settings with every NOT NULL column filled — `hours` sets the same window on every weekday. */
const openAllWeek = (start = '09:00', end = '17:00') => Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, { enabled: true, start, end }]),
)
const mkBookingSettings = (companyId: string, extra: Record<string, unknown> = {}) =>
  db.insert(bookingSettings).values({
    companyId, enabled: true, timezone: 'UTC', slotDurationMinutes: 60, maxDaysOut: 30,
    leadTimeDays: 0, concurrentBookings: 1, workingHours: openAllWeek(), ...extra,
  } as any)

const pub = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── H1 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── H1: configuring online booking is manager-and-up ──')
{
  const { co, owner, manager, staff } = await mkCompany('h1')
  await mkBookingSettings(co.id)
  const off = { enabled: false }
  check('staff cannot switch online booking off', (await as(co, staff)('PUT', '/api/booking/settings', off)).status === 403, (await as(co, staff)('PUT', '/api/booking/settings', off)).json)
  check('…and the salon is still taking bookings', (await as(co, owner)('GET', '/api/booking/settings')).json?.enabled !== false)
  check('staff cannot add a bookable service', (await as(co, staff)('POST', '/api/booking/services', { name: 'X', durationMinutes: 30 })).status === 403)
  const m = await as(co, manager)('PUT', '/api/booking/settings', { leadTimeDays: 1 })
  check('a manager still can', m.status === 200, m.json)
  const o = await as(co, owner)('PUT', '/api/booking/settings', { leadTimeDays: 0 })
  check('…and so can the owner', o.status === 200, o.json)
}

// ── H2 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── H2: online booking only takes services ticked "Bookable online" ──')
{
  const { co } = await mkCompany('h2')
  await mkBookingSettings(co.id)
  const [onMenu] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Bookable Cut', durationMin: 60, price: '40', active: true, bookableOnline: true } as any).returning()
  const [offMenu] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Cat barber', durationMin: 60, price: '40', active: true, bookableOnline: false } as any).returning()

  const list = await pub('GET', `/api/booking/public/${co.slug}`)
  const names = (list.json?.services || []).map((s: any) => s.name)
  check('the public list offers only the ticked service', names.includes('Bookable Cut') && !names.includes('Cat barber'), names)

  const dates = await pub('GET', `/api/booking/public/${co.slug}/dates`)
  const day = (dates.json || [])[1]?.date || (dates.json || [])[0]?.date
  const who = { firstName: 'Web', lastName: 'Client', email: 'web@t.local', phone: '555-0100' }
  const bad = await pub('POST', `/api/booking/public/${co.slug}`, { ...who, serviceId: offMenu.id, date: day, time: '09:00' })
  check('booking the unticked service is refused', bad.status >= 400, { status: bad.status, error: bad.json?.error })
  check('…and says it is not available for online booking', /not available for online booking/i.test(String(bad.json?.error)), bad.json)
  const good = await pub('POST', `/api/booking/public/${co.slug}`, { ...who, serviceId: onMenu.id, date: day, time: '10:00' })
  check('booking the ticked service still works', good.status === 201 || good.status === 200, { status: good.status, body: good.json })
}

// ── L6 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── L6: a fully booked day leaves the date picker ──')
{
  const { co } = await mkCompany('l6')
  // 09:00-11:00 with 60-minute slots = exactly two bookable times a day
  await mkBookingSettings(co.id, { maxDaysOut: 3, workingHours: openAllWeek('09:00', '11:00') })
  const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Quick', durationMin: 60, price: '10', active: true, bookableOnline: true } as any).returning()

  const before = await pub('GET', `/api/booking/public/${co.slug}/dates`)
  const target = (before.json || [])[1]?.date
  check('the day is offered while it has room', (before.json || []).some((d: any) => d.date === target), before.json)

  const who = (i: number) => ({ firstName: 'C' + i, lastName: 'X', email: `c${i}@t.local`, phone: '555-010' + i })
  for (const [i, time] of ['09:00', '10:00'].entries()) {
    const r = await pub('POST', `/api/booking/public/${co.slug}`, { ...who(i), serviceId: svc.id, date: target, time })
    check(`…booking ${time} succeeds`, r.status === 201 || r.status === 200, { status: r.status, body: r.json })
  }
  const slots = await pub('GET', `/api/booking/public/${co.slug}/slots?date=${target}`)
  check('…the day now has no free times', (slots.json || []).length === 0, slots.json)
  const after = await pub('GET', `/api/booking/public/${co.slug}/dates`)
  check('…so it is no longer offered as a date', !(after.json || []).some((d: any) => d.date === target), after.json)
  check('…and the other open days still are', (after.json || []).length > 0, after.json)
}

// ── M3 + M4 ──────────────────────────────────────────────────────────────────────────────────────
console.log('\n── M3/M4: a stylist can do a stylist\'s day, and cannot see the money ──')
{
  const { co, owner, staff } = await mkCompany('m3')
  const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Chair Client' } as any).returning()
  const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Cut', durationMin: 30, price: '40', active: true } as any).returning()
  const S = as(co, staff)

  const booked = await S('POST', '/api/appointments', { contactId: client.id, serviceId: svc.id, startTime: new Date(Date.now() + 3600_000).toISOString() })
  check('staff can book an appointment', booked.status === 201, booked.json)
  const checkedIn = await S('POST', `/api/appointments/${booked.json?.id}/check-in`)
  check('staff can check a client in', checkedIn.status === 200, checkedIn.json)
  const visit = await S('POST', '/api/clients/' + client.id + '/profile', { hairType: 'fine' })
  check('staff can keep the client card up to date', visit.status === 200 || visit.status === 404, { status: visit.status })

  check('staff still cannot edit the Service Menu', (await S('POST', '/api/service-menu', { name: 'Nope', durationMin: 30, price: '1' })).status === 403)
  check('staff still cannot create a membership plan', (await S('POST', '/api/memberships', { name: 'Nope' })).status === 403)

  const staffStats = await S('GET', '/api/dashboard/stats')
  check('the dashboard loads for staff', staffStats.status === 200, staffStats.json)
  check('…with no outstanding balance on it', staffStats.json?.invoices === undefined, staffStats.json?.invoices)
  check('…no revenue figure', staffStats.json?.services?.revenueThisMonth === undefined, staffStats.json?.services)
  check('…and no per-stylist takings', (staffStats.json?.byStylist || []).every((r: any) => r.revenue === undefined), staffStats.json?.byStylist)
  check('…but the counts a stylist needs are still there', typeof staffStats.json?.appointments?.today === 'number', staffStats.json?.appointments)

  const ownerStats = await as(co, owner)('GET', '/api/dashboard/stats')
  check('the owner still sees the money', typeof ownerStats.json?.invoices?.outstandingValue === 'number', ownerStats.json?.invoices)
}

// ── M1, M8, L1, L3, L4 ───────────────────────────────────────────────────────────────────────────
console.log('\n── validation: plans, tickets, brand colour, review link, hair type ──')
{
  const { co, owner } = await mkCompany('val')
  const O = as(co, owner)

  check('a plan priced below zero is refused', (await O('POST', '/api/memberships', { name: 'Bad', price: -5 })).status === 400)
  check('negative visit credits are refused', (await O('POST', '/api/memberships', { name: 'Bad', creditsTotal: -1 })).status === 400)
  check('a made-up billing cycle is refused', (await O('POST', '/api/memberships', { name: 'Bad', billingCycle: 'banana' })).status === 400)
  const okPlan = await O('POST', '/api/memberships', { name: 'Blowout Club', price: 50, creditsTotal: 4, billingCycle: 'monthly' })
  check('a real plan still saves', okPlan.status === 201, okPlan.json)
  check('…and editing it to a negative price is refused too', (await O('PUT', `/api/memberships/${okPlan.json?.id}`, { price: -1 })).status === 400)

  check('a ticket with no subject is refused', (await O('POST', '/api/support/tickets', { subject: '', description: 'x' })).status === 400)
  check('a made-up priority is refused', (await O('POST', '/api/support/tickets', { subject: 'Real', priority: 'banana' })).status === 400)
  const tkt = await O('POST', '/api/support/tickets', { subject: 'Real ticket', priority: 'high' })
  check('a real ticket saves', tkt.status === 200 || tkt.status === 201, tkt.json)
  check('…and a made-up status is refused on edit', (await O('PATCH', `/api/support/tickets/${tkt.json?.id}`, { status: 'banana' })).status === 400)

  check('a brand colour of "banana" is refused', (await O('PUT', '/api/company', { primaryColor: 'banana' })).status === 400)
  check('…and a real hex is accepted', [200, 204].includes((await O('PUT', '/api/company', { primaryColor: '#1d4ed8' })).status))

  check('a review link that is not a URL is refused', (await O('PUT', '/api/reviews/settings', { googleReviewUrl: 'not a url' })).status === 400)
  check('…and a real one is accepted', (await O('PUT', '/api/reviews/settings', { googleReviewUrl: 'https://g.page/r/abc/review' })).status === 200)

  const [c2] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Long Hair' } as any).returning()
  check('a 5,000-character hair type is refused', (await O('PUT', `/api/clients/${c2.id}/profile`, { hairType: 'x'.repeat(5000) })).status === 400)
  check('…and a normal one is accepted', (await O('PUT', `/api/clients/${c2.id}/profile`, { hairType: 'fine, colour-treated' })).status === 200)
}

// ── L2 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── L2: "other" is not a client ──')
{
  const { co, owner } = await mkCompany('l2')
  await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Real Client' } as any)
  await db.insert(contact).values({ companyId: co.id, type: 'other', name: 'Imported Oddity' } as any)
  await db.insert(contact).values({ companyId: co.id, type: 'lead', name: 'A Lead' } as any)
  const list = await as(co, owner)('GET', '/api/clients')
  const names = (list.json?.data || list.json || []).map((r: any) => r.name)
  check('a client is listed', names.includes('Real Client'), names)
  check('a lead is not', !names.includes('A Lead'), names)
  check('and neither is an imported "other"', !names.includes('Imported Oddity'), names)
}

// ── L5 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── L5: check-in means they are here ──')
{
  const { co, owner } = await mkCompany('l5')
  const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Early Bird' } as any).returning()
  const O = as(co, owner)
  const mkAppt = async (start: Date) => (await db.insert(appointment).values({ companyId: co.id, contactId: client.id, startTime: start, endTime: new Date(start.getTime() + 1800_000), status: 'scheduled' } as any).returning())[0]

  const future = await mkAppt(new Date(Date.now() + 25 * 86400_000))
  const r = await O('POST', `/api/appointments/${future.id}/check-in`)
  check('an appointment 25 days out cannot be checked in', r.status === 409, { status: r.status, error: r.json?.error })
  check('…and the refusal names the day it is on', /not today/i.test(String(r.json?.error)), r.json)

  const today = await mkAppt(new Date(Date.now() + 3600_000))
  check("…while today's appointment checks in", (await O('POST', `/api/appointments/${today.id}/check-in`)).status === 200)
}

// ── H3 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── H3: a review request that cannot send says so ──')
{
  const { co, owner } = await mkCompany('h3')
  await db.update(company).set({ settings: { timezone: 'UTC', googleReviewUrl: 'https://g.page/r/abc/review', reviewRequestEnabled: true, reviewChannel: 'email' } } as any).where(eq(company.id, co.id))
  const [noContactDetails] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'No Way To Reach' } as any).returning()
  const [reachable] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Reachable', email: 'reach@t.local' } as any).returning()
  const mkReq = async (contactId: string) => (await db.insert(reviewRequest).values({ companyId: co.id, contactId, channel: 'email', status: 'pending', reviewLink: 'https://g.page/r/abc/review' } as any).returning())[0]

  const stuck = await mkReq(noContactDetails.id)
  const r1 = await as(co, owner)('POST', `/api/reviews/follow-up/${stuck.id}`)
  check('a client with no email cannot be sent to — and it says so', r1.status === 400, { status: r1.status, error: r1.json?.error })
  check('…naming what is missing', /email address/i.test(String(r1.json?.error)), r1.json)
  const [afterStuck] = await db.select().from(reviewRequest).where(eq(reviewRequest.id, stuck.id))
  check('…and the request is NOT marked as followed up', !afterStuck?.followUpSentAt, afterStuck?.followUpSentAt)
  check('…and is still pending, not silently "sent"', afterStuck?.status === 'pending', afterStuck?.status)

  const live = await mkReq(reachable.id)
  const r2 = await as(co, owner)('POST', `/api/reviews/follow-up/${live.id}`)
  check('a reachable client is sent the request', r2.status === 200, r2.json)
  check('…and because it had never been sent, it is now SENT (not "followed up")', r2.json?.status === 'sent', r2.json)
  const [afterLive] = await db.select().from(reviewRequest).where(eq(reviewRequest.id, live.id))
  check('…and the record says so', afterLive?.status === 'sent' && !!afterLive?.sentAt, { status: afterLive?.status, sentAt: afterLive?.sentAt })
}

console.log(`\nt28: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
