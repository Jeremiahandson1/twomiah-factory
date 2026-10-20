// The data move's trades steps (apps/api/src/unified/move/steps/trades.ts) on a bar tenant (templates/crm-bar): the
// template's database as a live tenant has it (templateLive.ts), a row for every step — the bar's own extras included
// (user.location_id, contact.opted_out_sms, job.job_type, the takeoff measurements prune-legacy adds as bare numeric) —
// moved into an empty unified database, and each value looked for where it should have landed.
import { test, expect, beforeAll } from 'bun:test'
import { planMove } from '../../api/src/unified/move/schema.ts'
import { moveTenant, type MoveReport } from '../../api/src/unified/move/copy.ts'
import { tradesMove } from '../../api/src/unified/move/steps/trades.ts'
import { liveTemplate, unifiedDb, putter, type Db } from './templateLive.ts'

let src: Db
let dst: Db
let report: MoveReport

const one = async (d: Db, sql: string) => (await d.query(sql)).rows[0]
const did = (step: string) => report.steps.find((s) => s.step === step)?.did ?? ''

beforeAll(async () => {
  src = await liveTemplate('crm-bar')
  dst = await unifiedDb()
  const put = putter(src)
  // A company whose colour is blank: the widget's colour was the one customers saw, so it moves.
  await put('company', { id: 'bar1', name: 'Amber-like Inn', slug: 'amber-like', primary_color: '', logo: '/logo.svg', settings: '{}' })
  await put('user', { id: 'u1', company_id: 'bar1', email: 'owner@bar.example', first_name: 'Bo', last_name: 'Owner', role: 'owner', location_id: 'loc-north' })
  await put('user', { id: 'u2', company_id: 'bar1', email: 'staff@bar.example', first_name: 'Sam', last_name: 'Staff', role: 'field', location_id: null })
  await put('contact', { id: 'c1', company_id: 'bar1', name: 'Rae Regular', type: 'client', email: 'rae@x.example', opted_out_sms: null })
  await put('contact', { id: 'c2', company_id: 'bar1', name: 'Out Person', type: 'client', email: 'out@x.example', opted_out_sms: true })
  await put('job', { id: 'j1', company_id: 'bar1', contact_id: 'c1', title: 'Tap line clean', number: 'JOB-1', job_type: null })
  await put('job', { id: 'j2', company_id: 'bar1', contact_id: 'c1', title: 'Install', number: 'JOB-2', job_type: 'install' })
  await put('invoice', { id: 'i1', company_id: 'bar1', contact_id: 'c1', number: 'INV-00003', status: 'draft', created_at: '2026-09-01 10:00:00' })
  await put('invoice', { id: 'i2', company_id: 'bar1', contact_id: 'c1', number: 'INV-00003', status: 'draft', created_at: '2026-09-01 11:00:00' })

  // Booking with no services: the widget took bare slots. Three at once (concurrent_bookings), which the new engine can't say.
  await put('booking_settings', {
    id: 'bs1', company_id: 'bar1', enabled: true, lead_time_days: 0, max_days_out: 14, slot_duration_minutes: 120, concurrent_bookings: 3, timezone: 'America/Chicago',
    working_hours: JSON.stringify({ thursday: { start: '17:00', end: '23:00', enabled: true }, friday: { start: '17:00', end: '23:30', enabled: true }, saturday: { start: '12:00', end: '23:30', enabled: true } }),
    primary_color: '#aa5500', logo: '/booking.png', welcome_message: null, confirmation_message: 'Table held — see you!',
  })
  await put('online_booking', { id: 'ob1', company_id: 'bar1', contact_id: 'c1', service_id: null, customer_name: 'Rae Regular', customer_email: 'rae@x.example', customer_phone: '555-0199',
    scheduled_date: '2026-10-23 23:00:00', notes: 'Party of 6', status: 'confirmed', confirmation_code: 'BAR234', deposit_amount: '0', deposit_status: 'none', created_at: '2026-10-15 10:00:00', updated_at: '2026-10-15 10:00:00' })
  await put('online_booking', { id: 'ob2', company_id: 'bar1', contact_id: 'c1', service_id: null, customer_name: 'Rae Regular', customer_email: 'rae@x.example',
    scheduled_date: '2026-09-12 22:00:00', status: 'completed', deposit_amount: '0', deposit_status: 'none', created_at: '2026-09-01 10:00:00', updated_at: '2026-09-13 10:00:00' })

  await put('qb_integration', { id: 'qb1', company_id: 'bar1', access_token: 'at', refresh_token: 'rt', realm_id: '42', sync_enabled: false })

  // Takeoff measurements: the bar's migrations made takeoff_item without them, prune-legacy added them as bare numeric.
  await put('takeoff_sheet', { id: 'ts1', company_id: 'bar1', name: 'Back bar' })
  if (src.layout.has('takeoff')) await put('takeoff', { id: 'tk1', company_id: 'bar1', name: 'Takeoff' })
  await put('takeoff_item', { id: 'ti1', sheet_id: 'ts1', takeoff_id: 'tk1', name: 'Counter', quantity: '1', unit: 'lf', measurement_value: '12.345678', length: '3.5', width: '0.6', height: '1.1', waste_factor: '10' })
  await put('ai_receptionist_settings', { company_id: 'bar1', enabled: false })

  const plan = planMove(src.layout, dst.layout)
  report = await moveTenant({ read: src.query, write: dst.query, plan, target: dst.layout, ...tradesMove({ vertical: 'crm-bar', source: src.layout, target: dst.layout, plan }) })
}, 300_000)

test('the move matches and every step reported', () => {
  expect(report.mismatches).toEqual([])
  expect(report.steps.length).toBe(12)
})

test("the bar's own columns: an empty opt-out is not opted out, an empty job type is 'service', a seat's branch is reported", async () => {
  expect((await dst.query(`SELECT id, opted_out_sms FROM contact ORDER BY id`)).rows).toEqual([{ id: 'c1', opted_out_sms: false }, { id: 'c2', opted_out_sms: true }])
  expect((await dst.query(`SELECT id, job_type FROM job ORDER BY id`)).rows).toEqual([{ id: 'j1', job_type: 'service' }, { id: 'j2', job_type: 'install' }])
  expect(did('required values the old database left empty')).toContain('contact.opted_out_sms 1')
  expect(did('required values the old database left empty')).toContain('job.job_type 1')
  expect(did('columns the new app dropped')).toContain('user.location_id: 1 seat(s) carry a branch no screen set (u1)')
  expect((await dst.query(`SELECT count(*)::int AS n FROM "user"`)).rows[0].n).toBe(2)
})

test('takeoff measurements: rounded to the new columns and reported', async () => {
  expect(await one(dst, `SELECT measurement_value::text AS m, length::text AS l, waste_factor::text AS w FROM takeoff_item WHERE id = 'ti1'`)).toEqual({ m: '12.3457', l: '3.5000', w: '10.00' })
  expect(did('narrowing conversions')).toContain('takeoff_item.measurement_value: 1 value(s) rounded to 4 places (ti1 12.345678→12.3457)')
})

test('invoice numbers: the later live draft is renumbered', async () => {
  expect((await dst.query(`SELECT id, number FROM invoice ORDER BY id`)).rows).toEqual([{ id: 'i1', number: 'INV-00003' }, { id: 'i2', number: 'INV-00004' }])
})

test('booking with no services: the "Online booking" service at the slot length, the bare bookings put on it, crowding reported', async () => {
  expect(await one(dst, `SELECT lead_time_minutes, hero_title, thanks_message FROM booking_settings WHERE company_id = 'bar1'`)).toEqual({ lead_time_minutes: 0, hero_title: null, thanks_message: 'Table held — see you!' })
  expect((await dst.query(`SELECT day_of_week, start_minute, end_minute FROM booking_hours ORDER BY day_of_week`)).rows)
    .toEqual([{ day_of_week: 4, start_minute: 1020, end_minute: 1380 }, { day_of_week: 5, start_minute: 1020, end_minute: 1410 }, { day_of_week: 6, start_minute: 720, end_minute: 1410 }])
  expect(await one(dst, `SELECT id, slug, name, duration_minutes, slot_step_minutes, capacity, active FROM booking_service`))
    .toEqual({ id: 'bsvc_online_bar1', slug: 'online-booking', name: 'Online booking', duration_minutes: 120, slot_step_minutes: 120, capacity: 1, active: true })
  expect((await dst.query(`SELECT id, service_id, to_char(end_at, 'YYYY-MM-DD HH24:MI') AS e, status, customer_notes FROM booking ORDER BY id`)).rows).toEqual([
    { id: 'ob1', service_id: 'bsvc_online_bar1', e: '2026-10-24 01:00', status: 'confirmed', customer_notes: 'Party of 6' },
    { id: 'ob2', service_id: 'bsvc_online_bar1', e: '2026-09-13 00:00', status: 'completed', customer_notes: null },
  ])
  expect(did('booking settings')).toContain('it took 3 bookings at once')
  // The company had a logo (kept) and a blank colour (the widget's, which customers saw, fills it).
  expect(await one(dst, `SELECT logo, primary_color FROM company WHERE id = 'bar1'`)).toEqual({ logo: '/logo.svg', primary_color: '#aa5500' })
})

test('QuickBooks: the connection moves as stored; the bar never had the legacy table', async () => {
  expect(await one(dst, `SELECT access_token, refresh_token, realm_id, sync_enabled FROM qb_integration WHERE company_id = 'bar1'`)).toEqual({ access_token: 'at', refresh_token: 'rt', realm_id: '42', sync_enabled: false })
  expect(did('QuickBooks')).toBe("1 of 1 connection(s) moved with their tokens (sync on: 0); they need the Factory's QBO_* settings on the new service")
  expect(await one(dst, `SELECT id FROM ai_receptionist_settings`)).toEqual({ id: 'ars_bar1' })
})
