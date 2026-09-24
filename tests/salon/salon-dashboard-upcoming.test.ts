// Salon T20 M1 — "The dashboard's Upcoming Appointments panel is always empty, and contradicts the
// tile above it." /api/dashboard/stats returns appointments.upcoming7 = 5 while
// /api/dashboard/recent-activity returns upcomingAppointments: []. Creating a fresh appointment two
// days out raised the tile from 4 to 5 and left the panel at zero rows.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, appointment, teamMember } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 240)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear', slug: 'shear-dash', email: 'd@test.local', settings: {}, enabledFeatures: ['appointments'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'd@test.local', passwordHash: 'x', firstName: 'Dee', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Ann Appt', email: 'ann@test.local' } as any).returning()
const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Blowout', price: '40', durationMin: 60 } as any).returning()
const [roster] = await db.insert(teamMember).values({ companyId: co.id, name: 'Rosa Roster', role: 'stylist', active: true } as any).returning()

const app = new Hono()
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
const inDays = (d: number, h = 10) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString() }

// Two days out, exactly the tester's probe.
const made = await call('POST', '/api/appointments', { contactId: client.id, stylistId: owner.id, serviceId: svc.id, startTime: inDays(2) })
check('an appointment two days out is created', made.status === 201, made.json)
// and one held by a roster stylist, who has no `user` row at all
const rosterAppt = await call('POST', '/api/appointments', { contactId: client.id, stylistId: roster.id, serviceId: svc.id, startTime: inDays(3) })
check('…and one for a roster stylist', rosterAppt.status === 201, rosterAppt.json)

{
  const stats = await call('GET', '/api/dashboard/stats')
  const upcoming7 = stats.json?.appointments?.upcoming7
  check('the tile counts them', Number(upcoming7) === 2, stats.json?.appointments)

  const act = await call('GET', '/api/dashboard/recent-activity')
  const panel = act.json?.upcomingAppointments || []
  check('M1: the Upcoming Appointments panel is NOT empty (it always was)', panel.length > 0, { panel, upcoming7 })
  check('M1: the panel agrees with the tile above it', panel.length === Number(upcoming7), { panel: panel.length, tile: upcoming7 })
  check('…and names the client', panel.some((a: any) => a.clientName === 'Ann Appt'), panel)
  check('…and the service', panel.some((a: any) => a.serviceName === 'Blowout'), panel)
  check('…the login stylist is named', panel.some((a: any) => `${a.stylistFirstName || ''} ${a.stylistLastName || ''}`.trim() === 'Dee Owner'), panel)
  check('…and so is the roster stylist, who has no user row', panel.some((a: any) => `${a.stylistFirstName || ''} ${a.stylistLastName || ''}`.trim() === 'Rosa Roster'), panel)
  check('…soonest first', panel.length < 2 || new Date(panel[0].startTime) <= new Date(panel[1].startTime), panel.map((a: any) => a.startTime))
}

// a cancelled appointment is not "upcoming", on either surface
{
  const cancelled = await call('POST', '/api/appointments', { contactId: client.id, serviceId: svc.id, startTime: inDays(4) })
  await call('PUT', `/api/appointments/${cancelled.json?.id}`, { status: 'cancelled' })
  const stats = await call('GET', '/api/dashboard/stats')
  const act = await call('GET', '/api/dashboard/recent-activity')
  const panel = act.json?.upcomingAppointments || []
  check('a cancelled appointment is excluded from both', Number(stats.json?.appointments?.upcoming7) === 2 && panel.length === 2, { tile: stats.json?.appointments?.upcoming7, panel: panel.length })
}

// something far out still shows in the panel, which is not limited to 7 days
{
  await call('POST', '/api/appointments', { contactId: client.id, serviceId: svc.id, startTime: inDays(20) })
  const stats = await call('GET', '/api/dashboard/stats')
  const act = await call('GET', '/api/dashboard/recent-activity')
  check('the 7-day tile does not count something 20 days out', Number(stats.json?.appointments?.upcoming7) === 2, stats.json?.appointments?.upcoming7)
  check('…while the panel, which is not a 7-day list, still shows it', (act.json?.upcomingAppointments || []).length === 3, (act.json?.upcomingAppointments || []).length)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
