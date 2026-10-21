// The data move's trades steps (apps/unified/server/move/steps/trades.ts) on a contractor tenant: the template's database
// as a live tenant has it (migrations + prune-legacy + reconcile, templateLive.ts), filled with a row for every step,
// moved into an empty unified database, and each value looked for where it should have landed.
import { test, expect, beforeAll } from 'bun:test'
import { planMove } from '../server/move/schema.ts'
import { moveTenant, type MoveReport } from '../server/move/copy.ts'
import { tradesMove } from '../server/move/steps/trades.ts'
import { liveTemplate, unifiedDb, putter, type Db } from './templateLive.ts'

let src: Db
let dst: Db
let report: MoveReport
let put: ReturnType<typeof putter>

const one = async (d: Db, sql: string, params?: unknown[]) => (await d.query(sql, params)).rows[0]
const did = (step: string) => report.steps.find((s) => s.step === step)?.did ?? ''

async function move(into: Db) {
  const plan = planMove(src.layout, into.layout)
  const steps = tradesMove({ vertical: 'crm', source: src.layout, target: into.layout, plan })
  return moveTenant({ read: src.query, write: into.query, plan, target: into.layout, ...steps })
}

beforeAll(async () => {
  // keepLegacy: a tenant whose boot prune never dropped the old quickbooks_connection table.
  src = await liveTemplate('crm', { keepLegacy: true })
  dst = await unifiedDb()
  put = putter(src)
  await put('company', { id: 'co1', name: 'Higgs-like Builders', slug: 'higgs-like', logo: null, primary_color: '#ff0000', settings: JSON.stringify({ reviewChannel: 'sms', docSeq: { INV: 12 } }) })
  await put('user', { id: 'u1', company_id: 'co1', email: 'owner@x.example', first_name: 'Ann', last_name: 'Owner', role: 'owner' })
  await put('contact', { id: 'c1', company_id: 'co1', name: 'Pat Client', type: 'client', email: 'pat@x.example' })
  await put('contact', { id: 'c2', company_id: 'co1', name: 'Dee Deposit', type: 'client', email: 'dee@x.example' })
  await put('job', { id: 'j1', company_id: 'co1', contact_id: 'c1', title: 'Roof inspection', number: 'JOB-1', source: 'online_booking' })

  // Invoices: INV-00007 twice live (two drafts: the T41 race) and once void; INV-00010 the highest row; docSeq says 12 was issued.
  await put('invoice', { id: 'i-old', company_id: 'co1', contact_id: 'c1', number: 'INV-00007', status: 'draft', created_at: '2026-09-01 10:00:00' })
  await put('invoice', { id: 'i-new', company_id: 'co1', contact_id: 'c1', number: 'INV-00007', status: 'draft', created_at: '2026-09-01 10:00:01' })
  await put('invoice', { id: 'i-void', company_id: 'co1', contact_id: 'c1', number: 'INV-00007', status: 'void', created_at: '2026-08-01 10:00:00' })
  await put('invoice', { id: 'i-10', company_id: 'co1', contact_id: 'c1', number: 'INV-00010', status: 'sent', created_at: '2026-09-02 10:00:00' })
  // INV-00011: an OLDER draft beside a NEWER sent bill — the sent one keeps it (the customer holds it), the draft moves.
  await put('invoice', { id: 'i-d-old', company_id: 'co1', contact_id: 'c1', number: 'INV-00011', status: 'draft', created_at: '2026-08-15 10:00:00' })
  await put('invoice', { id: 'i-s-new', company_id: 'co1', contact_id: 'c1', number: 'INV-00011', status: 'sent', created_at: '2026-09-05 10:00:00' })

  // Booking: settings, three services (one with a deposit, one switched off with a deposit amount it never charged), three bookings.
  await put('booking_settings', {
    id: 'bs1', company_id: 'co1', enabled: true, lead_time_days: 2, max_days_out: 45, slot_duration_minutes: 30, concurrent_bookings: 1, timezone: 'America/Denver',
    working_hours: JSON.stringify({ monday: { start: '08:00', end: '16:00', enabled: true }, tuesday: { start: '08:00', end: '16:00', enabled: true }, wednesday: { start: 'bad', end: '16:00', enabled: true },
      thursday: { start: '08:00', end: '16:00', enabled: false }, friday: { start: '08:00', end: '16:00', enabled: true }, saturday: { start: '10:00', end: '14:00', enabled: true }, sunday: { start: '10:00', end: '14:00', enabled: false } }),
    primary_color: '#123456', logo: '/booking-logo.png', welcome_message: 'Book your free roof check', confirmation_message: 'Thanks — we will see you then.',
  })
  await put('bookable_service', { id: 's1', company_id: 'co1', name: 'Roof Inspection', duration_minutes: 90, price: '0', deposit_required: false, deposit_amount: '0', active: true, sort_order: 0 })
  await put('bookable_service', { id: 's2', company_id: 'co1', name: 'Gutter clean!', description: 'Both levels', duration_minutes: 60, price: '150.00', deposit_required: true, deposit_amount: '25.00', active: true, sort_order: 1 })
  await put('bookable_service', { id: 's3', company_id: 'co1', name: 'Roof inspection', duration_minutes: 45, price: '0', deposit_required: false, deposit_amount: '10.00', active: false, sort_order: 2 })
  await put('online_booking', { id: 'b1', company_id: 'co1', job_id: 'j1', contact_id: 'c1', service_id: 's1', customer_name: 'Pat Client', customer_email: 'pat@x.example', customer_phone: '555-0100',
    scheduled_date: '2026-10-21 14:00:00', notes: 'Side gate', status: 'confirmed', confirmation_code: 'ABC234', deposit_amount: '0', deposit_status: 'none', created_at: '2026-10-10 09:00:00', updated_at: '2026-10-10 09:00:00' })
  await put('online_booking', { id: 'b2', company_id: 'co1', contact_id: 'c2', service_id: 's2', customer_name: 'Dee Deposit', customer_email: 'dee@x.example',
    scheduled_date: '2026-10-22 15:30:00', status: 'pending', confirmation_code: 'XYZ789', deposit_amount: '25.00', deposit_status: 'pending', payment_intent_id: 'pi_123', created_at: '2026-10-11 09:00:00', updated_at: '2026-10-11 09:00:00' })
  await put('online_booking', { id: 'b3', company_id: 'co1', contact_id: 'c1', service_id: null, customer_name: 'Pat Client', customer_email: 'pat@x.example',
    scheduled_date: '2026-10-01 16:00:00', status: 'cancelled', confirmation_code: 'QQQ222', deposit_amount: '0', deposit_status: 'none', created_at: '2026-09-20 09:00:00', updated_at: '2026-09-21 09:00:00' })

  // QuickBooks: the live connection (qb_integration, made by the boot reconcile) and a leftover legacy row.
  await put('qb_integration', { id: 'qb1', company_id: 'co1', access_token: 'at-plain', refresh_token: 'rt-plain', realm_id: '9130350', token_expires_at: '2026-10-20 12:00:00', sync_enabled: true })
  await put('quickbooks_connection', { id: 'qbc-old', company_id: 'co1', access_token: 'old-at', refresh_token: 'old-rt', realm_id: '111', is_connected: true })

  // Recurring lines: `total` is the bare numeric prune-legacy adds. A float sum (3 × 0.1), an empty total, an `amount` with a figure.
  await put('recurring_invoice', { id: 'ri1', company_id: 'co1', contact_id: 'c1', frequency: 'monthly', status: 'active' })
  await put('recurring_line_item', { id: 'rl-float', recurring_invoice_id: 'ri1', description: 'Visit', quantity: '3', unit_price: '0.10', total: '0.30000000000000004', amount: '0', sort_order: 0 })
  await put('recurring_line_item', { id: 'rl-empty', recurring_invoice_id: 'ri1', description: 'Filter', quantity: '2', unit_price: '12.50', total: null, amount: '0', sort_order: 1 })
  await put('recurring_line_item', { id: 'rl-amount', recurring_invoice_id: 'ri1', description: 'Old line', quantity: '1', unit_price: '40.00', total: '40', amount: '45.00', sort_order: 2 })

  // Takeoffs: an item with the field-service lineage's cost figure and a company_id its sheet does not have; a material without a price.
  await put('takeoff_assembly', { id: 'ta1', company_id: 'co1', name: 'Wall', measurement_type: 'linear' })
  await put('assembly_material', { id: 'am1', assembly_id: 'ta1', name: 'Stud', quantity_per: '0.75', unit: 'each', unit_cost: '4.50', unit_price: null })
  await put('takeoff_sheet', { id: 'ts1', company_id: 'co1', name: 'Plans A' })
  if (src.layout.has('takeoff')) await put('takeoff', { id: 'tk1', company_id: 'co1', name: 'Takeoff' })
  await put('takeoff_item', { id: 'ti1', sheet_id: 'ts1', takeoff_id: 'tk1', assembly_id: 'ta1', name: 'North wall', quantity: '1', unit: 'lf', unit_cost: '12.50', total_cost: '12.50', company_id: 'co-other' })
  await put('takeoff_calculated_material', { id: 'tcm1', item_id: 'ti1', material_name: 'Stud', unit: 'each', base_quantity: '7.5', waste_quantity: '0.75', total_quantity: '8.25', unit_cost: '4.50', unit_price: null, total_cost: '37.13', total_price: null })

  // Links the old database never checked, values it let be empty.
  await put('email_log', { id: 'el1', company_id: 'co1', invoice_id: 'i-deleted', to_email: 'pat@x.example', subject: 'Invoice' })
  await put('comment', { id: 'cm1', company_id: 'co1', parent_id: 'cm-deleted', content: 'Reply', body: 'Reply', entity_type: 'job', entity_id: 'j1', user_id: 'u1' })
  await put('review_request', { id: 'rr1', company_id: 'co1', contact_id: 'c1', status: 'pending', channel: null })
  await put('tracking_number', { id: 'tn1', company_id: 'co1', phone_number: '+15550100', source: 'google', created_at: '2026-08-01 08:00:00', updated_at: null })
  await put('ai_receptionist_settings', { company_id: 'co1', enabled: true })

  report = await move(dst)
}, 300_000)

test('the move matches, and every step said what it did', () => {
  expect(report.mismatches).toEqual([])
  for (const s of ['narrowing conversions', 'hold the rules the old database never kept', 'invoice numbers: live duplicates', 'links that point at nothing', 'required values the old database left empty',
    'one-per rules', 'put the held rules back', 'booking settings', 'booking services', 'bookings', 'QuickBooks', 'columns the new app dropped']) expect(report.steps.map((x) => x.step)).toContain(s)
})

test('invoice numbers: drafts sharing a number are renumbered above everything ever issued (a sent bill keeps its number), and the mark moves past them', async () => {
  expect(await one(dst, `SELECT number FROM invoice WHERE id = 'i-old'`)).toEqual({ number: 'INV-00007' })
  expect(await one(dst, `SELECT number FROM invoice WHERE id = 'i-new'`)).toEqual({ number: 'INV-00013' })
  expect(await one(dst, `SELECT number FROM invoice WHERE id = 'i-void'`)).toEqual({ number: 'INV-00007' })
  expect(await one(dst, `SELECT number FROM invoice WHERE id = 'i-s-new'`)).toEqual({ number: 'INV-00011' })
  expect(await one(dst, `SELECT number FROM invoice WHERE id = 'i-d-old'`)).toEqual({ number: 'INV-00014' })
  expect(await one(dst, `SELECT settings::jsonb -> 'docSeq' ->> 'INV' AS mark, settings::jsonb ->> 'reviewChannel' AS ch FROM company WHERE id = 'co1'`)).toEqual({ mark: '14', ch: 'sms' })
  // The rule is back: a second live INV-00007 is refused by the database.
  await expect(dst.query(`INSERT INTO invoice (id, company_id, contact_id, number, status) VALUES ('i-x', 'co1', 'c1', 'INV-00007', 'draft')`)).rejects.toThrow()
  expect(did('invoice numbers: live duplicates')).toContain('i-new INV-00007→INV-00013, i-d-old INV-00011→INV-00014')
})

test('booking settings: notice in minutes, opening hours as rows, the wording, the widget\'s logo onto a company that had none', async () => {
  expect(await one(dst, `SELECT enabled, timezone, lead_time_minutes, max_days_out, hero_title, thanks_message FROM booking_settings WHERE company_id = 'co1'`))
    .toEqual({ enabled: true, timezone: 'America/Denver', lead_time_minutes: 2880, max_days_out: 45, hero_title: 'Book your free roof check', thanks_message: 'Thanks — we will see you then.' })
  const hours = (await dst.query(`SELECT user_id, day_of_week, start_minute, end_minute FROM booking_hours WHERE company_id = 'co1' ORDER BY day_of_week`)).rows
  expect(hours).toEqual([
    { user_id: null, day_of_week: 1, start_minute: 480, end_minute: 960 },
    { user_id: null, day_of_week: 2, start_minute: 480, end_minute: 960 },
    { user_id: null, day_of_week: 3, start_minute: 540, end_minute: 960 }, // 'bad' read as 09:00, as the template's slot list did
    { user_id: null, day_of_week: 5, start_minute: 480, end_minute: 960 },
    { user_id: null, day_of_week: 6, start_minute: 600, end_minute: 840 },
  ])
  // The company had no logo, so the widget's moves; it had a colour, so the widget's (never shown) does not.
  expect(await one(dst, `SELECT logo, primary_color FROM company WHERE id = 'co1'`)).toEqual({ logo: '/booking-logo.png', primary_color: '#ff0000' })
})

test('booking services: ids kept, addresses made, a price of 0 is none, a deposit only when one was taken, the slot grid', async () => {
  const rows = (await dst.query(`SELECT id, slug, name, description, duration_minutes, price::text AS price, deposit_amount::text AS deposit, slot_step_minutes, capacity, active FROM booking_service WHERE company_id = 'co1' ORDER BY sort_order`)).rows
  expect(rows).toEqual([
    { id: 's1', slug: 'roof-inspection', name: 'Roof Inspection', description: null, duration_minutes: 90, price: null, deposit: null, slot_step_minutes: 30, capacity: 1, active: true },
    { id: 's2', slug: 'gutter-clean', name: 'Gutter clean!', description: 'Both levels', duration_minutes: 60, price: '150.00', deposit: '25.00', slot_step_minutes: 30, capacity: 1, active: true },
    { id: 's3', slug: 'roof-inspection-2', name: 'Roof inspection', description: null, duration_minutes: 45, price: null, deposit: null, slot_step_minutes: 30, capacity: 1, active: false },
  ])
  expect(did('booking services')).toContain('s3 had a 10.00 deposit switched off')
})

test('bookings: times, the service\'s length, contact, deposit held with its payment, a private link, the job pointing at its booking', async () => {
  const b = (await dst.query(`SELECT id, service_id, contact_id, to_char(start_at, 'YYYY-MM-DD HH24:MI') AS s, to_char(end_at, 'YYYY-MM-DD HH24:MI') AS e, customer_name, customer_email, customer_phone, customer_notes,
      status, source, deposit_amount::text AS dep, deposit_status, payment_intent_id, length(token) AS tl FROM booking ORDER BY id`)).rows
  expect(b).toEqual([
    { id: 'b1', service_id: 's1', contact_id: 'c1', s: '2026-10-21 14:00', e: '2026-10-21 15:30', customer_name: 'Pat Client', customer_email: 'pat@x.example', customer_phone: '555-0100', customer_notes: 'Side gate', status: 'confirmed', source: 'public', dep: null, deposit_status: 'none', payment_intent_id: null, tl: 32 },
    { id: 'b2', service_id: 's2', contact_id: 'c2', s: '2026-10-22 15:30', e: '2026-10-22 16:30', customer_name: 'Dee Deposit', customer_email: 'dee@x.example', customer_phone: null, customer_notes: null, status: 'pending', source: 'public', dep: '25.00', deposit_status: 'pending', payment_intent_id: 'pi_123', tl: 32 },
    // No service: the slot's 30 minutes; the company has active services, so it is not given the "Online booking" one.
    { id: 'b3', service_id: null, contact_id: 'c1', s: '2026-10-01 16:00', e: '2026-10-01 16:30', customer_name: 'Pat Client', customer_email: 'pat@x.example', customer_phone: null, customer_notes: null, status: 'cancelled', source: 'public', dep: null, deposit_status: 'none', payment_intent_id: null, tl: 32 },
  ])
  expect((await dst.query(`SELECT count(DISTINCT token)::int AS n FROM booking`)).rows[0].n).toBe(3)
  expect(await one(dst, `SELECT booking_id FROM job WHERE id = 'j1'`)).toEqual({ booking_id: 'b1' })
  expect((await dst.query(`SELECT count(*)::int AS n FROM booking_service WHERE name = 'Online booking'`)).rows[0].n).toBe(0)
  expect(did('bookings')).toContain('3 confirmation code(s) not carried')
})

test('QuickBooks: the live connection moves with its tokens as stored; the removed table is reported, not copied', async () => {
  expect(await one(dst, `SELECT company_id, access_token, refresh_token, realm_id, sync_enabled FROM qb_integration`)).toEqual({ company_id: 'co1', access_token: 'at-plain', refresh_token: 'rt-plain', realm_id: '9130350', sync_enabled: true })
  expect((await dst.query(`SELECT to_regclass('quickbooks_connection') AS t`)).rows[0].t).toBeNull()
  expect(did('QuickBooks')).toContain('1 of 1 connection(s) moved')
  expect(did('QuickBooks')).toContain('1 row(s) in the removed quickbooks_connection table not moved')
  expect(did('QuickBooks')).not.toContain('old-rt')
})

test('recurring lines: the float sum rounded and reported, the empty total filled by the service\'s own sum, the stray amount reported', async () => {
  const rows = (await dst.query(`SELECT id, total::text AS total FROM recurring_line_item ORDER BY sort_order`)).rows
  expect(rows).toEqual([{ id: 'rl-float', total: '0.30' }, { id: 'rl-empty', total: '25.00' }, { id: 'rl-amount', total: '40.00' }])
  expect(did('narrowing conversions')).toContain('recurring_line_item.total: 1 value(s) rounded to 2 places (rl-float 0.30000000000000004→0.30)')
  expect(did('required values the old database left empty')).toContain('recurring_line_item.total 1')
  expect(did('columns the new app dropped')).toContain('recurring_line_item.amount: 1 row(s) hold a figure the line\'s total does not (rl-amount amount 45.00 total 40)')
})

test('takeoffs: the empty prices read as 0 and the total re-summed; the unused cost columns and the stray company reported', async () => {
  expect(await one(dst, `SELECT unit_price::text AS p FROM assembly_material WHERE id = 'am1'`)).toEqual({ p: '0.00' })
  expect(await one(dst, `SELECT unit_price::text AS p, total_price::text AS t FROM takeoff_calculated_material WHERE id = 'tcm1'`)).toEqual({ p: '0.00', t: '0.00' })
  const d = did('columns the new app dropped')
  expect(d).toContain('takeoff_item.unit_cost: 1 row(s)')
  expect(d).toContain('takeoff_item.total_cost: 1 row(s)')
  expect(d).toContain('takeoff_item.company_id: 1 row(s) name a company their sheet does not (ti1)')
})

test('links to deleted rows are cleared and the rows kept; empty required values take what the template read them as', async () => {
  expect(await one(dst, `SELECT invoice_id FROM email_log WHERE id = 'el1'`)).toEqual({ invoice_id: null })
  expect(await one(dst, `SELECT parent_id FROM comment WHERE id = 'cm1'`)).toEqual({ parent_id: null })
  expect(did('links that point at nothing')).toContain('email_log.invoice_id 1 (rows el1)')
  // The company's own review channel, which the template sent an empty one on — not the column default.
  expect(await one(dst, `SELECT channel FROM review_request WHERE id = 'rr1'`)).toEqual({ channel: 'sms' })
  expect(await one(dst, `SELECT to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS u FROM tracking_number WHERE id = 'tn1'`)).toEqual({ u: '2026-08-01 08:00' })
  expect(await one(dst, `SELECT id FROM ai_receptionist_settings WHERE company_id = 'co1'`)).toEqual({ id: 'ars_co1' })
  // Every held rule is back on: an orphan link and an empty channel are refused now.
  await expect(dst.query(`UPDATE email_log SET invoice_id = 'nope' WHERE id = 'el1'`)).rejects.toThrow()
  await expect(dst.query(`UPDATE review_request SET channel = NULL WHERE id = 'rr1'`)).rejects.toThrow()
})

test('two non-drafts sharing a number, or a required link to a deleted row, refuses the move and leaves the new database empty', async () => {
  await put('invoice', { id: 'i-sent', company_id: 'co1', contact_id: 'c1', number: 'INV-00010', status: 'sent', created_at: '2026-09-03 10:00:00' })
  const fresh = await unifiedDb()
  await expect(move(fresh)).rejects.toThrow(/INV-00010: i-10 sent, i-sent sent/)
  expect((await fresh.query(`SELECT count(*)::int AS n FROM invoice`)).rows[0].n).toBe(0)
  await src.query(`DELETE FROM invoice WHERE id = 'i-sent'`)

  // aia_form.project_id may not be empty in the new app; a form whose project was deleted (the template's delete left it) refuses.
  await put('aia_form', { id: 'aia1', company_id: 'co1', project_id: 'p-deleted', application_number: 1 })
  const fresh2 = await unifiedDb()
  await expect(move(fresh2)).rejects.toThrow(/aia_form\.project_id: 1 row\(s\) point at a project that no longer exists .*aia1/)
  expect((await fresh2.query(`SELECT count(*)::int AS n FROM company`)).rows[0].n).toBe(0)
  await src.query(`DELETE FROM aia_form WHERE id = 'aia1'`)
}, 300_000)
