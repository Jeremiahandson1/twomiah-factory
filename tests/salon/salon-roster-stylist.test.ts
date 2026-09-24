// Salon T20 H1 — "A stylist added on the Team page can never be scheduled — and the API offers them anyway."
// appointment.stylist_id and service_records.stylist_id are foreign keys to `user`; a chair-only stylist
// lives in team_member with a different id, so every write was refused with a 409 that named nothing,
// while GET /api/team/assignable listed them tagged source "member". Seven builds open.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, teamMember, serviceMenu, appointment, serviceRecord } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 240)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear', slug: 'shear', email: 's@test.local', settings: {}, enabledFeatures: ['appointments'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 's@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Cleo Client', email: 'cleo@test.local' } as any).returning()
const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Blowout', price: '40', durationMin: 60 } as any).returning()
// the chair-only stylist: on the roster, no login
const [roster] = await db.insert(teamMember).values({ companyId: co.id, name: 'Rosa Roster', email: 'rosa@test.local', role: 'stylist', active: true } as any).returning()

const app = new Hono()
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.route('/api/service-records', (await import('./src/routes/serviceRecords.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
const at = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.toISOString() }
// A completion has to be dated to a day that has happened (T27 N4), so the block that COMPLETES an
// appointment books it for a couple of hours ago rather than tomorrow. The point of that test is which
// column the stylist lands in, not when; tomorrow was only ever a convenient way to dodge a clash.
const earlierToday = () => new Date(Date.now() - 2 * 3600_000).toISOString()

// ── the roster stylist can actually be booked ──────────────────────────────────────────────────────
{
  const made = await call('POST', '/api/appointments', { contactId: client.id, stylistId: roster.id, serviceId: svc.id, startTime: at(10) })
  check('H1: a roster stylist can be booked (every write used to be refused 409)', made.status === 201, { status: made.status, body: made.json })
  check('…and the appointment answers with the stylist id that was asked for', made.json?.stylistId === roster.id, made.json?.stylistId)

  const list = await call('GET', '/api/appointments')
  const mine = (list.json?.data || []).find((a: any) => a.id === made.json?.id)
  check('…the book lists it against that stylist', mine?.stylistId === roster.id, mine?.stylistId)
  check('…and names them, so the chair is not blank', `${mine?.stylistFirstName || ''} ${mine?.stylistLastName || ''}`.trim() === 'Rosa Roster', { f: mine?.stylistFirstName, l: mine?.stylistLastName })

  const filtered = await call('GET', `/api/appointments?stylistId=${roster.id}`)
  check('…and filtering the book by that stylist finds it', (filtered.json?.data || []).some((a: any) => a.id === made.json?.id), (filtered.json?.data || []).length)
}

// ── a login stylist still works exactly as before ──────────────────────────────────────────────────
{
  const made = await call('POST', '/api/appointments', { contactId: client.id, stylistId: owner.id, serviceId: svc.id, startTime: at(14) })
  check('a login stylist is unaffected', made.status === 201, made.json)
  check('…and still answers with their id', made.json?.stylistId === owner.id, made.json?.stylistId)
  const list = await call('GET', `/api/appointments?stylistId=${owner.id}`)
  check('…and filters to them', (list.json?.data || []).some((a: any) => a.id === made.json?.id), null)
}

// ── a roster stylist can be double-booked, and is caught ───────────────────────────────────────────
{
  const clash = await call('POST', '/api/appointments', { contactId: client.id, stylistId: roster.id, serviceId: svc.id, startTime: at(10) })
  check('H1: double-booking the roster stylist is still refused (the check follows them)', clash.status === 409, { status: clash.status, body: clash.json })
  check('…and says so plainly', /already booked/i.test(String(clash.json?.error)), clash.json?.error)
}

// ── an id that is nobody is refused clearly, not by a foreign key ──────────────────────────────────
{
  const bogus = await call('POST', '/api/appointments', { contactId: client.id, stylistId: 'not-a-person', serviceId: svc.id, startTime: at(16) })
  check('an unknown stylist is a 400 that names the field, not a 409 about "a related record"', bogus.status === 400 && bogus.json?.code === 'UNKNOWN_STYLIST', { status: bogus.status, body: bogus.json })
  const none = await call('POST', '/api/appointments', { contactId: client.id, serviceId: svc.id, startTime: at(18) })
  check('…and an appointment with no stylist at all is still allowed', none.status === 201, none.json)
}

// ── the service record: the same person, the same answer ───────────────────────────────────────────
{
  const rec = await call('POST', '/api/service-records', { contactId: client.id, stylistId: roster.id, serviceId: svc.id, priceCharged: 40 })
  check('H1: a service record can name the roster stylist (this was the second 409)', rec.status === 201 || rec.status === 200, { status: rec.status, body: rec.json })

  const list = await call('GET', '/api/service-records')
  const mine = (list.json?.data || []).find((r: any) => r.id === rec.json?.id)
  check('…the visit lists against them', mine?.stylistId === roster.id, mine?.stylistId)
  check('…and names them', `${mine?.stylistFirstName || ''} ${mine?.stylistLastName || ''}`.trim() === 'Rosa Roster', { f: mine?.stylistFirstName, l: mine?.stylistLastName })
  const filtered = await call('GET', `/api/service-records?stylistId=${roster.id}`)
  check('…and filtering visits by that stylist finds it', (filtered.json?.data || []).some((r: any) => r.id === rec.json?.id), (filtered.json?.data || []).length)

  const bogus = await call('POST', '/api/service-records', { contactId: client.id, stylistId: 'nobody', priceCharged: 10 })
  check('…an unknown stylist on a visit is refused the same way', bogus.status === 400 && bogus.json?.code === 'UNKNOWN_STYLIST', bogus.status)
}

// ── reassigning a chair between the two kinds of stylist ───────────────────────────────────────────
{
  const made = await call('POST', '/api/appointments', { contactId: client.id, stylistId: owner.id, serviceId: svc.id, startTime: at(20) })
  const moved = await call('PUT', `/api/appointments/${made.json?.id}`, { stylistId: roster.id })
  check('an appointment can be moved from a login stylist to a roster one', moved.status === 200, { status: moved.status, body: moved.json })
  const [row] = await db.select().from(appointment).where(eq(appointment.id, made.json?.id))
  check('…and only ONE of the two columns is set', !!(row as any).stylistMemberId && !(row as any).stylistId, { u: (row as any).stylistId, m: (row as any).stylistMemberId })
  const back = await call('PUT', `/api/appointments/${made.json?.id}`, { stylistId: owner.id })
  check('…and back again', back.status === 200, back.status)
  const [row2] = await db.select().from(appointment).where(eq(appointment.id, made.json?.id))
  check('…leaving only the user column set', !!(row2 as any).stylistId && !(row2 as any).stylistMemberId, { u: (row2 as any).stylistId, m: (row2 as any).stylistMemberId })
}

// ── completing a roster stylist's appointment carries them onto the visit ──────────────────────────
{
  const made = await call('POST', '/api/appointments', { contactId: client.id, stylistId: roster.id, serviceId: svc.id, startTime: earlierToday() })
  await call('PUT', `/api/appointments/${made.json?.id}`, { status: 'completed' })
  const recs = await db.select().from(serviceRecord).where(eq(serviceRecord.appointmentId, made.json?.id))
  check('completing the visit records who was in the chair', recs.length === 1 && (recs[0] as any).stylistMemberId === roster.id, recs.map((r: any) => ({ u: r.stylistId, m: r.stylistMemberId })))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
