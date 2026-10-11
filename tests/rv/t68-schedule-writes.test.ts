// T68 — RV's appointments: the read-only seat could book, move and cancel them, and nobody could save an edit.
//
// Found sweeping the viewer's screens (T43 viewer round): Schedule offered "New Appointment" and "+ Add" on every day,
// and the server agreed — routes/scheduleEvents.ts asked nothing but a login. Booking now asks schedule:create,
// rescheduling and cancelling schedule:update; the floor seat is granted both so its scheduling is unchanged.
//
// And the screen's "Save" on an EDITED appointment sends PUT (the shared api client has no patch()), while the route
// only answered PATCH — so editing an appointment 404'd for every seat. PUT is accepted now. Asserted on the real route.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, scheduleEvent } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Lakeside Marine', slug: 'lakeside-t68', email: 'lakeside-t68@test.local', state: 'OH', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@lakeside.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const manager = await mk('manager', 'manager'), floor = await mk('field', 'floor'), viewer = await mk('viewer', 'viewer')

const app = new Hono()
app.route('/api/schedule-events', (await import('./src/routes/scheduleEvents.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const M = as(manager), F = as(floor), V = as(viewer)
const start = new Date(Date.now() + 2 * 86400000); start.setUTCHours(15, 0, 0, 0)
const end = new Date(start.getTime() + 3600000)
const appt = (title: string) => ({ title, type: 'test_drive', start: start.toISOString(), end: end.toISOString() })

// the floor still books and moves
const fb = await F('POST', '/api/schedule-events', appt('Test drive — Bennington 22'))
check('the floor books a test drive (201)', fb.status === 201 || fb.status === 200, fb)
const id = fb.json?.id || fb.json?.data?.id
const fput = await F('PUT', `/api/schedule-events/${id}`, { title: 'Test drive — Bennington 22 SSBX' })
check('the floor saves an edit by PUT — what the screen sends (it 404\'d)', fput.status === 200 && fput.json?.title === 'Test drive — Bennington 22 SSBX', fput)
const fpatch = await F('PATCH', `/api/schedule-events/${id}`, { notes: 'bring the trailer' })
check('…and PATCH still works', fpatch.status === 200 && fpatch.json?.notes === 'bring the trailer', fpatch)

// the viewer reads and writes nothing
const vlist = await V('GET', `/api/schedule-events?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 7 * 86400000).toISOString()}`)
check('viewer: reads the schedule (200)', vlist.status === 200, { status: vlist.status })
const vb = await V('POST', '/api/schedule-events', appt('viewer booking'))
check('viewer: cannot book (403)', vb.status === 403, vb)
for (const m of ['PUT', 'PATCH'] as const) {
  const r = await V(m, `/api/schedule-events/${id}`, { title: 'moved by the viewer' })
  check(`viewer: cannot ${m} an appointment (403)`, r.status === 403, r)
}
const vd = await V('DELETE', `/api/schedule-events/${id}`)
check('viewer: cannot cancel one (403)', vd.status === 403, vd)
const [row] = await db.select().from(scheduleEvent).where(eq(scheduleEvent.id, id))
check('…and the appointment is exactly as the floor left it', row?.title === 'Test drive — Bennington 22 SSBX' && row?.status !== 'cancelled', { title: row?.title, status: row?.status })
const nothingNew = (await db.select().from(scheduleEvent).where(eq(scheduleEvent.companyId, co.id))).length
check('…and the viewer\'s booking was not written', nothingNew === 1, nothingNew)

// the manager cancels (soft) — the route's own behaviour unchanged
const md = await M('DELETE', `/api/schedule-events/${id}`)
check('a manager cancels it (soft — it stays, greyed)', md.status === 200 && md.json?.status === 'cancelled', md)

console.log(`\nt68 rv schedule writes: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
