// crm-dispensary — T46 N24 and N27.
//
// N24  The payroll "CSV" was a JSON object with a .csv extension. Clocking in wrote to `shifts` and
//      nothing else while the Time Tracking tab reads `time_entries`, so the tab stayed empty after
//      a clock-in and a clock-out and a manager had nothing to approve. Every hourly rate read
//      $0.00, because the export read the rate column on the LOGIN while the rate a shop types is on
//      the team member. And the owner could clock in to a shift dated twelve days ahead.
// N27  Six screens still answered a bad form with "Invalid request" and a raw validator dump. Most
//      of the product names the field, because an uncaught ZodError falls through to the error
//      handler, which does — the routes that catch their own parse failure did not.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, shift, teamMember, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-m4', email: 'm4@test.local', state: 'OH',
  enabledFeatures: ['scheduling', 'team', 'products', 'orders', 'wholesale', 'loyalty', 'referrals', 'compliance'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t46m4@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Shift', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const bud = await mkUser('user', 'ada')

// The rate a shop actually types lives on the team member, not on the login.
await db.insert(teamMember).values({
  companyId: co.id, userId: bud.id, name: 'ada Shift', email: bud.email, hourlyRate: '20.00', active: true,
} as any)

const app = new Hono()
app.route('/api/scheduling', (await import('./src/routes/scheduling.ts')).default)
app.route('/api/wholesale', (await import('./src/routes/wholesale.ts')).default)
app.route('/api/referrals', (await import('./src/routes/referrals.ts')).default)
app.route('/api/gamified-loyalty', (await import('./src/routes/gamified-loyalty.ts')).default)
app.route('/api/compliance', (await import('./src/routes/compliance.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t, headers: res.headers }
}
const asOwner = as(owner)
const asBud = as(bud)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// This shop is in Ohio, so its day is the one that decides whether a shift has happened.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const inTwelveDays = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() + 12 * 86400000))

// ═══════════════════════════════════ N24 · the clock and the payroll ════════════════════════════
{
  const [future] = await db.insert(shift).values({
    companyId: co.id, userId: bud.id, role: 'budtender', date: inTwelveDays,
    startTime: '09:00', endTime: '17:00', status: 'scheduled',
  } as any).returning()
  const early = await asBud('POST', `/api/scheduling/shifts/${future.id}/clock-in`)
  check('N24: a shift twelve days out cannot be clocked in to', early.status === 400 && early.json?.code === 'shift_not_today',
    { status: early.status, body: early.json })

  const [todays] = await db.insert(shift).values({
    companyId: co.id, userId: bud.id, role: 'budtender', date: today,
    startTime: '09:00', endTime: '17:00', status: 'scheduled',
  } as any).returning()
  const inNow = await asBud('POST', `/api/scheduling/shifts/${todays.id}/clock-in`)
  check('N24: today\'s shift clocks in', inNow.status === 200, { status: inNow.status, body: inNow.json })

  // The Time Tracking tab reads time_entries, which nothing was writing.
  const entries = await asOwner('GET', `/api/scheduling/time-entries?startDate=${today}&endDate=${today}`)
  const list = entries.json?.data || entries.json || []
  check('N24: …and the Time Tracking tab has something in it', Array.isArray(list) && list.length === 1, { count: Array.isArray(list) ? list.length : list })
  check('N24: …for the right person', list[0]?.employeeName?.includes('ada'), list[0])
  check('N24: …still running', !list[0]?.clockOut, list[0])

  // Backdate the clock-in so clocking out produces a real 10-hour day.
  await db.execute(sql`UPDATE shifts SET clock_in_at = NOW() - INTERVAL '10 hours' WHERE id = ${todays.id}`)
  await db.execute(sql`UPDATE time_entries SET clock_in = NOW() - INTERVAL '10 hours' WHERE shift_id = ${todays.id}`)

  const out = await asBud('POST', `/api/scheduling/shifts/${todays.id}/clock-out`)
  check('N24: clocking out works', out.status === 200, { status: out.status, body: out.json })

  const [entry] = await rows(sql`SELECT clock_out, total_minutes, overtime_minutes FROM time_entries WHERE shift_id = ${todays.id}`)
  check('N24: …the time entry is closed', !!entry?.clock_out, entry)
  check('N24: …with the hours on it, so there is something to approve — 10 hours clocked, less the 30-minute break', Number(entry?.total_minutes) === 570, entry)
  check('N24: …and the overtime worked out — 1.5 hours past eight', Number(entry?.overtime_minutes) === 90, entry)

  // Ten hours clocked, less the shift's own 30-minute break, is 9.5 worked: 8 regular and 1.5 of
  // overtime, at the rate the shop typed. The regular half is the part that used to be dropped
  // entirely, so a long day paid nothing but its overtime. (T45 M12)
  const payroll = await asOwner('GET', `/api/scheduling/payroll-export?startDate=${today}&endDate=${today}`)
  const line = (payroll.json?.data || [])[0]
  check('N24: the payroll export has the day on it', !!line, payroll.json)
  check('N24: …8 regular hours, not nothing', Number(line?.regular_hours) === 8, line)
  check('N24: …1.5 of overtime', Number(line?.overtime_hours) === 1.5, line)
  check('N24: …at the rate on the team member, not $0.00', Number(line?.hourly_rate) === 20, line)
  check('N24: …so the gross pay is 8×20 + 1.5×30 = $205', Number(line?.gross_pay) === 205, line)

  const csv = await asOwner('GET', `/api/scheduling/payroll-export?startDate=${today}&endDate=${today}&format=csv`)
  check('N24: …and format=csv returns a CSV, not JSON in a .csv file',
    (csv.headers.get('content-type') || '').includes('text/csv'), csv.headers.get('content-type'))
  const firstLine = String(csv.text).split(/\r?\n/)[0]
  check('N24: …with a header row a spreadsheet can read', /^Employee,Email,Total hours/.test(firstLine), firstLine)
  check('N24: …and the figures in it', /,8\.00,1\.50,20\.00,205\.00/.test(String(csv.text).split(/\r?\n/)[1] || ''), String(csv.text).split(/\r?\n/)[1])
  check('N24: …offered as a download', /attachment; filename=/.test(csv.headers.get('content-disposition') || ''), csv.headers.get('content-disposition'))
}

// ═════════════════════════════════ N27 · a refusal that names the field ═════════════════════════
{
  // Each of these is one of the six the retest listed.
  const cases: [string, string, string, any][] = [
    ['a wholesale buyer with no licence', 'POST', '/api/wholesale/customers', { name: 'T46 Buyer' }],
    ['a negative multiplier', 'POST', '/api/gamified-loyalty/multiplier-events', { name: 'T46 Bad', multiplier: -2 }],
    ['a referral value below zero', 'PUT', '/api/referrals/config', { referrerRewardValue: -5 }],
  ]
  for (const [label, method, path, body] of cases) {
    const r = await asOwner(method, path, body)
    check(`N27: ${label} is refused`, r.status === 400, { status: r.status, body: r.json })
    check(`N27: …and the message names the field, not "Invalid request"`,
      r.json?.error !== 'Invalid request' && /: /.test(String(r.json?.error || '')), r.json?.error)
    check('N27: …with the field on the answer, so the form can point at the box', typeof r.json?.field === 'string' && r.json.field.length > 0, r.json)
  }

  // …and a good one still goes through.
  const good = await asOwner('POST', '/api/gamified-loyalty/multiplier-events', { name: 'T46 Fine', multiplier: 2 })
  check('N27: a valid request is unaffected', good.status === 201, { status: good.status, body: good.json })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
