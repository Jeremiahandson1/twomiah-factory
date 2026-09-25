// Field Service T30 M-R2 — a manager could change the shop's online-booking setup.
//
// Salon T28 H1 put the first guard on these routes: before it, any signed-in user could switch booking off
// for the whole company. The guard chosen was requireRole('manager'), which stopped the stylist in that
// report and let every manager through. Hours, notice period, booking window, whether booking is on at all
// and which services are offered are company configuration — company:update, which a manager does not
// have, and which is why they are already refused Settings, Users, Billing, Features and Integrations.
//
// Rank and permission are not the same lattice, and that is the whole bug: `viewer` outranks nobody yet
// holds invoices:read, so "at least manager" can never stand in for "may configure the company".
//
// The over-correction to guard against is locking a manager out of the bookings themselves. Taking a
// booking, moving it, cancelling it and reading the diary are a manager's job and must not change.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, bookingSettings } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T30 Booking Co', slug: 't30book', email: 't30book@test.local', settings: {}, enabledFeatures: ['online_booking', 'jobs', 'contacts'] } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}-t30book@test.local`, passwordHash: 'x', firstName: tag, lastName: 'User', role, companyId: co.id } as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('user', 'staff')
// an owner can hand one named manager the key without promoting them — requireRole could never do this
const granted = (await db.insert(user).values({ email: 'granted-t30book@test.local', passwordHash: 'x', firstName: 'Granted', lastName: 'Manager', role: 'manager', companyId: co.id, extraPermissions: ['company:update'] } as any).returning())[0]

const app = new Hono()
app.route('/api/booking', (await import('./src/routes/booking.ts')).default)
app.onError(errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

console.log('\n── who may CONFIGURE booking ──')
{
  const settings = { enabled: true, leadTimeHours: 6 }
  const o = await as(owner)('PUT', '/api/booking/settings', settings)
  check('an owner sets the hours', o.status === 200, { status: o.status, body: o.json })

  const a = await as(admin)('PUT', '/api/booking/settings', settings)
  check('so does an admin', a.status === 200, { status: a.status, body: a.json })

  const m = await as(manager)('PUT', '/api/booking/settings', settings)
  check('a MANAGER is refused — this is company setup, and they have company:read only', m.status === 403, { status: m.status, body: m.json })
  check('…and is told what it needs', m.json?.required === 'company:update', { body: m.json })

  const s = await as(staff)('PUT', '/api/booking/settings', settings)
  check('staff are refused, as before', s.status === 403, { status: s.status })

  const g = await as(granted)('PUT', '/api/booking/settings', settings)
  check('a manager the owner granted company:update CAN — the escape hatch a rank could not offer', g.status === 200, { status: g.status, body: g.json })
}

console.log('\n── the bookable services list is part of that setup ──')
{
  const svc = { name: 'T30 Tune-up', durationMinutes: 60, price: 120 }
  const m = await as(manager)('POST', '/api/booking/services', svc)
  check('a manager cannot add a bookable service', m.status === 403, { status: m.status, body: m.json })
  const o = await as(owner)('POST', '/api/booking/services', svc)
  check('an owner can', o.status === 201 || o.status === 200, { status: o.status, body: o.json })
  const id = (o.json?.data ?? o.json)?.id
  if (id) {
    const mu = await as(manager)('PUT', `/api/booking/services/${id}`, { price: 999 })
    check('…nor change one', mu.status === 403, { status: mu.status })
    const md = await as(manager)('DELETE', `/api/booking/services/${id}`)
    check('…nor retire one', md.status === 403, { status: md.status })
  } else {
    check('the service was created with an id to test against', false, o.json)
  }
}

console.log('\n── and the day-to-day diary is untouched ──')
{
  const m = as(manager)
  const list = await m('GET', '/api/booking')
  check('a manager still reads the diary', list.status === 200, { status: list.status })
  const read = await m('GET', '/api/booking/settings')
  check('…and can still SEE the setup they may not change', read.status === 200, { status: read.status })
  const services = await m('GET', '/api/booking/services')
  check('…and the services on offer', services.status === 200, { status: services.status })
  const s = await as(staff)('GET', '/api/booking/settings')
  check('staff can read it too — nothing here got narrower', s.status === 200, { status: s.status })
}

console.log('\n── the setting actually moved for the people allowed to move it ──')
{
  // maxDaysOut is stored exactly as given; leadTimeHours is rounded up to whole days on the way in, so it
  // is the wrong dial to read a number straight back off.
  await as(owner)('PUT', '/api/booking/settings', { maxDaysOut: 45 })
  const [row] = await db.select().from(bookingSettings)
  check('the owner\'s change is on the row', Number(row?.maxDaysOut) === 45, { maxDaysOut: row?.maxDaysOut })
  await as(manager)('PUT', '/api/booking/settings', { maxDaysOut: 7 })
  const [after] = await db.select().from(bookingSettings)
  check('…and the manager\'s refusal changed nothing', Number(after?.maxDaysOut) === 45, { maxDaysOut: after?.maxDaysOut })
}

console.log(`\nfs-t30-booking-config: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
