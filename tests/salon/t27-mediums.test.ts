// Salon T27 — N4, N5, N6, N7, N8, N11.
//
// N4  Completing a FUTURE appointment wrote a future-dated visit, which Log Service refuses in as many
//     words ("a visit can only be dated to a day that has happened"). Two doors into the same act, one
//     of them unlocked. Also: POST /check-in on a CANCELLED appointment returned 200 and revived it.
// N5  A roster stylist vanished on three read paths — Recent Services, Chair Productivity and the
//     client's Formula History — because each joined `user` on stylist_id alone.
// N6  CSV import skipped the validation the API enforces: "not-an-email" stored verbatim, Type
//     "banana" stored as "other", errors [].
// N7  PUT /booking/settings {leadTimeDays:"abc"} returned 200 and stored 0, switching same-day
//     booking on.
// N8  POST /appointments with 2027-02-30 returned 201 and stored 2 March.
// N11 primaryColor "banana" saved with 200.
//
// TZ=UTC: N4 compares calendar days on the shop's clock, and a developer machine in another zone can
// make that read green on broken code. (see feedback: pin the server environment)
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, teamMember, serviceRecord, bookingSettings } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'
import { eq, sql } from 'drizzle-orm'

if (process.env.TZ !== 'UTC' && Intl.DateTimeFormat().resolvedOptions().timeZone !== 'UTC') {
  console.log('  TZ=UTC bun t27-mediums.test.ts   ← run it this way; the server does')
  process.exit(1)
}

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 260)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear', slug: 'shear-t27m', email: 't27m@test.local', settings: {}, enabledFeatures: ['salon'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 't27m@test.local', passwordHash: 'x', firstName: 'Sam', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
await db.insert(bookingSettings).values({ companyId: co.id, timezone: 'America/Chicago', leadTimeDays: 1 } as any).returning().catch(() => {})
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'T27 Client', type: 'client', email: 't27c@test.local' } as any).returning()
const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: "Men's Cut", price: '30', durationMin: 30 } as any).returning()
const [roster] = await db.insert(teamMember).values({ companyId: co.id, name: 'T27 Roster Probe', active: true } as any).returning()

const app = new Hono()
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.route('/api/booking', (await import('./src/routes/booking.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const daysAhead = (d: number) => new Date(Date.now() + d * 86400_000).toISOString()

console.log('\n── N8: an impossible date is refused, not rolled forward ──')
{
  const bad = await call('POST', '/api/appointments', { contactId: client.id, stylistId: owner.id, serviceId: svc.id, startTime: '2027-02-30T15:00:00.000Z' })
  check('N8: 2027-02-30 is refused', bad.status === 400 && bad.json?.code === 'BAD_DATE', { status: bad.status, code: bad.json?.code })
  const good = await call('POST', '/api/appointments', { contactId: client.id, stylistId: owner.id, serviceId: svc.id, startTime: '2027-02-28T15:00:00.000Z' })
  check('…while a real February date books', good.status === 201 || good.status === 200, { status: good.status, err: good.json?.error })
}

console.log('\n── N4: a future appointment cannot be completed ──')
{
  const future = await call('POST', '/api/appointments', { contactId: client.id, stylistId: owner.id, serviceId: svc.id, startTime: daysAhead(35) })
  const fid = future.json?.id
  const done = await call('PUT', `/api/appointments/${fid}`, { status: 'completed' })
  check('N4: completing an appointment 5 weeks out is refused', done.status === 400 && done.json?.code === 'FUTURE_APPOINTMENT', { status: done.status, code: done.json?.code })
  const recs = await db.select().from(serviceRecord).where(eq(serviceRecord.appointmentId, fid))
  check('…and no future-dated visit was written', recs.length === 0, recs.length)

  // Today, earlier — an ordinary afternoon. The rule is a future DAY, not a future instant.
  const past = await call('POST', '/api/appointments', { contactId: client.id, stylistId: owner.id, serviceId: svc.id, startTime: hoursAgo(2) })
  const okDone = await call('PUT', `/api/appointments/${past.json?.id}`, { status: 'completed' })
  check('N4: today\'s appointment still completes normally', okDone.status === 200, { status: okDone.status, err: okDone.json?.error })
}

console.log('\n── N4b: a cancelled appointment cannot be checked in ──')
{
  const made = await call('POST', '/api/appointments', { contactId: client.id, stylistId: owner.id, serviceId: svc.id, startTime: hoursAgo(5) })
  const id = made.json?.id
  await call('DELETE', `/api/appointments/${id}`)
  const revive = await call('POST', `/api/appointments/${id}/check-in`, {})
  check('N4: checking in a cancelled appointment is refused', revive.status === 409 && revive.json?.code === 'APPOINTMENT_NOT_LIVE', { status: revive.status, code: revive.json?.code })
  const row = ((await db.execute(sql`SELECT status FROM appointment WHERE id = ${id}`)) as any).rows?.[0]
  check('…and it is still cancelled', row?.status === 'cancelled', row)
}

console.log('\n── N5: a roster stylist is a stylist on every read ──')
{
  const made = await call('POST', '/api/appointments', { contactId: client.id, stylistId: roster.id, serviceId: svc.id, startTime: hoursAgo(3) })
  await call('PUT', `/api/appointments/${made.json?.id}`, { status: 'completed' })

  const act = await call('GET', '/api/dashboard/recent-activity')
  const services: any[] = (act.json?.recentServices || act.json?.recentVisits || [])
  const mine = services.find(s => s.stylistMemberName === 'T27 Roster Probe' || s.stylistFirstName)
  check('N5: Recent Services names the roster stylist', !!services.length && services.some(s => s.stylistMemberName === 'T27 Roster Probe'), services.map(s => ({ u: s.stylistFirstName, m: s.stylistMemberName })))

  const stats = await call('GET', '/api/dashboard/stats')
  const chairs: any[] = stats.json?.byStylist || []
  check('N5: Chair Productivity includes them', chairs.some(s => s.name === 'T27 Roster Probe'), chairs.map(s => s.name))
  check('…with their visit counted', (chairs.find(s => s.name === 'T27 Roster Probe')?.visits || 0) >= 1, chairs)
}

console.log('\n── N7 / N11: booking settings refuse nonsense ──')
{
  const abc = await call('PUT', '/api/booking/settings', { leadTimeDays: 'abc' })
  check('N7: leadTimeDays "abc" is refused', abc.status >= 400, { status: abc.status, err: abc.json?.error })
  const stored = ((await db.execute(sql`SELECT lead_time_days FROM booking_settings WHERE company_id = ${co.id}`)) as any).rows?.[0]
  check('…and nothing was stored (it became 0, switching same-day booking on)', Number(stored?.lead_time_days) === 1, stored)
  const good = await call('PUT', '/api/booking/settings', { leadTimeDays: 2 })
  check('…while a real number saves', good.status === 200, good.json?.error)

  const banana = await call('PUT', '/api/booking/settings', { primaryColor: 'banana' })
  check('N11: primaryColor "banana" is refused', banana.status >= 400, { status: banana.status, err: banana.json?.error })
  const hex = await call('PUT', '/api/booking/settings', { primaryColor: '#1d4ed8' })
  check('…while a hex value saves', hex.status === 200, hex.json?.error)
}

console.log('\n── N6: the CSV import enforces what the API enforces ──')
{
  const { importContacts } = await import('./src/services/import.ts')
  const csv = [
    'name,email,type',
    'Good Client,good@test.local,client',
    'Bad Email,not-an-email,client',
    'Bad Type,badtype@test.local,banana',
  ].join('\n')
  const res: any = await importContacts(csv, co.id, { defaultType: 'client' })
  check('N6: the good row imports', res.imported === 1, { imported: res.imported, skipped: res.skipped })
  check('N6: the bad email is refused, not stored', res.errors.some((e: any) => /not a valid email/i.test(e.error)), res.errors)
  check('N6: the unknown type is refused, not turned into "other"', res.errors.some((e: any) => /not a contact type/i.test(e.error)), res.errors)
  const others = ((await db.execute(sql`SELECT COUNT(*)::int AS n FROM contact WHERE company_id = ${co.id} AND type = 'other'`)) as any).rows?.[0]
  check('…so no "other" contact exists to be miscounted as a client', Number(others?.n) === 0, others)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
