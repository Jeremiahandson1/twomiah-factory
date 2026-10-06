// A booking must still know what it was FOR when the owner reads the list back.
//
// Written chasing "Showcase: the job number is right now, but the service name is still lost" — and
// what it measures is that the trades booking path does NOT lose it. A widget service's
// `legacyServiceId` is its bookable_service id (catalog.ts), so the booking row carries serviceId and
// bookingOut resolves the name straight from it. Showcase's Service column is empty because that
// tenant has never created a bookable service: 31 of 31 bookings with serviceId null against zero
// services, measured at T51, which the bookings screen now states instead of printing "No service" on
// every row. That is a setup answer, not a code one.
//
// So this file is the regression guard that keeps it true: the number AND the name both survive the
// round trip from the public widget to the owner's list, and a booking with no service picked reports
// no service rather than inventing one from the job's "Online Booking" fallback title. The job
// calendar's lookup now supplies serviceName as well, which closes the menu-sourced case no template
// wires yet — see the note on jobCalendar.lookup.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, bookingSettings, job } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Wrench Works', slug: 'wrench-t58', email: 'w58@test.local', settings: {},
  enabledFeatures: ['online_booking', 'jobs', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-w58@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U',
  role: 'owner', companyId: co.id,
} as any).returning()

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
  return { status: res.status, json: j, text: t }
}
const api = as(owner)
const pub = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// ══════════ a shop that takes bookings, and one service on the list ════════════════════════════════
console.log('\n══════════ setup ══════════')
{
  const s = await api('PUT', '/api/booking/settings', {
    enabled: true, leadTimeHours: 0, slotDurationMinutes: 60,
    workingHours: {
      monday: { start: '08:00', end: '18:00', enabled: true },
      tuesday: { start: '08:00', end: '18:00', enabled: true },
      wednesday: { start: '08:00', end: '18:00', enabled: true },
      thursday: { start: '08:00', end: '18:00', enabled: true },
      friday: { start: '08:00', end: '18:00', enabled: true },
      saturday: { start: '08:00', end: '18:00', enabled: true },
      sunday: { start: '08:00', end: '18:00', enabled: true },
    },
  })
  check('booking is switched on', s.status === 200, { status: s.status, body: s.text?.slice(0, 260) })
}

const SERVICE_NAME = 'Furnace tune-up'
let serviceId = ''
{
  const made = await api('POST', '/api/booking/services', {
    name: SERVICE_NAME, description: 'Annual service', durationMinutes: 60, price: 149,
  })
  check('a service is on the list', made.status === 200 || made.status === 201, { status: made.status, body: made.text?.slice(0, 300) })
  serviceId = made.json?.id || made.json?.data?.id
  check('…and it came back with an id', !!serviceId, made.json)
}

// ══════════ a customer books it ════════════════════════════════════════════════════════════════════
console.log('\n══════════ a booking off the public widget ══════════')
let bookingId = ''
{
  // Far enough out to clear any notice period, and on a weekday the hours above have open.
  const when = new Date(Date.now() + 8 * 864e5)
  const date = when.toISOString().slice(0, 10)
  const res = await pub('POST', `/api/booking/public/${co.slug}`, {
    serviceId, date, time: '10:00',
    firstName: 'Ada', lastName: 'Customer', email: 'ada-w58@test.local', phone: '555-0101',
    // requireAddress is on for trades — a van has to go somewhere.
    address: '14 Mill Lane', city: 'Dayton', state: 'OH', zip: '45402',
    notes: 'Round the back',
  })
  check('the booking is taken', res.status === 200 || res.status === 201, { status: res.status, body: res.text?.slice(0, 400) })
  bookingId = res.json?.bookingId || res.json?.id
  // The confirmation has always carried it — this is not where it was lost.
  check('the confirmation names the service', res.json?.appointment?.service === SERVICE_NAME,
    { service: res.json?.appointment?.service, expected: SERVICE_NAME })
}

// ══════════ the job it created ═════════════════════════════════════════════════════════════════════
console.log('\n══════════ the job on the board ══════════')
{
  const jobs = await db.select().from(job).where(eq(job.companyId, co.id))
  check('a job was created', (jobs as any[]).length === 1, { jobs: (jobs as any[]).length })
  const j: any = (jobs as any[])[0] || {}
  check('…numbered', /^JOB-\d+/.test(String(j.number || '')), { number: j.number })
  // The data was never missing: the name is right here.
  check('…and its title IS the service name', j.title === SERVICE_NAME, { title: j.title, expected: SERVICE_NAME })
  check('…with the clock time the customer picked', !!j.scheduledTime, { scheduledTime: j.scheduledTime })
}

// ══════════ THE FINDING: the owner's list ══════════════════════════════════════════════════════════
console.log('\n══════════ reading the list back ══════════')
{
  const list = await api('GET', '/api/booking')
  check('the list answers', list.status === 200, { status: list.status, body: list.text?.slice(0, 260) })
  const rows: any[] = list.json?.data ?? (Array.isArray(list.json) ? list.json : [])
  check('…and holds the booking', rows.length === 1, { rows: rows.length })
  const row = rows[0] || {}

  check('the job number is on the row (fixed last round, must stay)', /^JOB-\d+/.test(String(row.calendar?.label || '')),
    { calendar: row.calendar })
  check('…and the row points at the job itself', !!row.calendar?.id && row.calendar?.kind === 'job', { calendar: row.calendar })
  // The finding itself.
  check('THE SERVICE NAME is on the row', row.serviceName === SERVICE_NAME,
    { serviceName: row.serviceName, expected: SERVICE_NAME, keys: Object.keys(row) })
}

// ══════════ a booking with no service picked ═══════════════════════════════════════════════════════
console.log('\n══════════ a booking with no service ══════════')
{
  const when = new Date(Date.now() + 9 * 864e5)
  const res = await pub('POST', `/api/booking/public/${co.slug}`, {
    date: when.toISOString().slice(0, 10), time: '11:00',
    firstName: 'Bo', lastName: 'Nobody', email: 'bo-w58@test.local', phone: '555-0202',
    address: '2 High Street', city: 'Dayton', state: 'OH', zip: '45402',
  })
  check('it is taken', res.status === 200 || res.status === 201, { status: res.status, body: res.text?.slice(0, 300) })

  const list = await api('GET', '/api/booking')
  const rows: any[] = list.json?.data ?? []
  const bo = rows.find((r: any) => String(r.customerEmail || '').startsWith('bo-'))
  check('the row is there', !!bo, rows.map((r: any) => r.customerEmail))
  // The job's title falls back to the literal "Online Booking". Reporting that as a SERVICE would be
  // inventing one; the row says it has none.
  check('…and it reports NO service rather than a service called "Online Booking"',
    bo && (bo.serviceName === null || bo.serviceName === undefined), { serviceName: bo?.serviceName })
  /**
   * …and NOT the job number either. (T58 follow-up)
   *
   * I briefly had the job calendar hand its `title` back as the service name, on the reasoning that
   * create() writes the service name into it. Jobs made by other paths carry their NUMBER as the
   * title, so the Service column started printing "JOB-00007" — a worse answer than the blank, on the
   * tenant the change was meant to help. The column must stay empty when nothing was chosen.
   */
  check('…and certainly not the JOB number', !/^JOB-/.test(String(bo?.serviceName || '')),
    { serviceName: bo?.serviceName, calendarLabel: bo?.calendar?.label })
  check('…though the job number IS on the row, where it belongs', /^JOB-\d+/.test(String(bo?.calendar?.label || '')),
    { calendar: bo?.calendar })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
