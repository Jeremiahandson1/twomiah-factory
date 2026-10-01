// T32 M5 — "Time: overnight shifts impossible, clock times stored 5 h off."
//
// The report logged 19:00–23:30 on 30 September from a tenant in Eau Claire (America/Chicago). The
// entry landed on 30 September and the pay run for 30 September picked it up — the brief's key check
// PASSED, and that is why this was invisible. But clockIn was stored as 19:00Z: the shop's wall time
// tagged UTC. The real instant was 00:00Z on 1 October, five hours later.
//
// Nothing on screen was wrong, and every clock_in in the table was out by the offset. Anything that
// reasons about the INSTANT rather than the day reads those wrong — an overlap check, an export to a
// payroll provider, hours across a boundary.
//
// And a 22:00–02:00 shift was refused with "End time must be after start time". 02:00 IS after
// 22:00; it is on the next day. Night shifts could not be entered at all.
//
// The tenant here is on America/Chicago ON PURPOSE. A UTC tenant cannot tell a correct instant from
// a wall-time-tagged-UTC one — they are the same number — so a test on a UTC company would have
// passed on the broken code.
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
const { company, user, timeEntry } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Night Shift Co', slug: 'night-co', email: 'n@test.local', state: 'WI',
  settings: { timezone: 'America/Chicago' },
  enabledFeatures: ['time_tracking'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-night@test.local', passwordHash: 'x', firstName: 'Noor', lastName: 'Byrne',
  role: 'owner', companyId: co.id, isActive: true, hourlyRate: '30.00',
} as any).returning()

const app = new Hono()
app.route('/api/time', (await import('./src/routes/time.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null)

// 30 Sep 2026 is CDT (UTC−5), so 19:00 local is 2026-10-01T00:00:00Z. That five-hour gap is the
// whole finding, and it is why the date is fixed rather than relative.
const DAY = '2026-09-30'

// ══════════ the evening shift the report logged ════════════════════════════════════════════════
{
  const r = await api('POST', '/api/time', { date: DAY, startTime: '19:00', endTime: '23:30', description: 'Evening pour' })
  check('the evening entry is accepted', r.status === 201, { status: r.status, body: r.text?.slice(0, 220) })
  check('…4.5 hours', Number(r.json?.hours) === 4.5, r.json?.hours)

  // The part that was right and must stay right: the entry belongs to the day it was worked.
  check('…filed against 30 September, not the UTC day it spills into',
    iso(r.json?.date)?.slice(0, 10) === DAY, { date: iso(r.json?.date) })

  // The part that was wrong.
  check('clockIn is the REAL instant — 19:00 in Eau Claire is 00:00Z the next day',
    iso(r.json?.clockIn) === '2026-10-01T00:00:00.000Z',
    { clockIn: iso(r.json?.clockIn), wallTimeTaggedUtc: '2026-09-30T19:00:00.000Z' })
  check('…and clockOut likewise', iso(r.json?.clockOut) === '2026-10-01T04:30:00.000Z',
    { clockOut: iso(r.json?.clockOut) })
  check('…the stored gap is the hours worked',
    (new Date(r.json.clockOut).getTime() - new Date(r.json.clockIn).getTime()) / 3600000 === 4.5,
    { hours: r.json?.hours })
}

// ══════════ the overnight shift that could not be entered ══════════════════════════════════════
{
  const r = await api('POST', '/api/time', { date: DAY, startTime: '22:00', endTime: '02:00', description: 'Night pour' })
  check('a 22:00–02:00 shift is accepted', r.status === 201, { status: r.status, body: r.text?.slice(0, 240) })
  check('…as FOUR hours, not refused and not twenty', Number(r.json?.hours) === 4, r.json?.hours)
  check('…filed against the day it STARTED', iso(r.json?.date)?.slice(0, 10) === DAY, { date: iso(r.json?.date) })
  check('…clocking in at 22:00 local = 03:00Z', iso(r.json?.clockIn) === '2026-10-01T03:00:00.000Z', { clockIn: iso(r.json?.clockIn) })
  check('…and out at 02:00 the NEXT day = 07:00Z', iso(r.json?.clockOut) === '2026-10-01T07:00:00.000Z', { clockOut: iso(r.json?.clockOut) })
  check('…so clockOut is after clockIn, which is the thing the old refusal was protecting',
    new Date(r.json.clockOut) > new Date(r.json.clockIn), null)
}

// ══════════ a break still comes off, across midnight ═══════════════════════════════════════════
{
  const r = await api('POST', '/api/time', { date: DAY, startTime: '21:00', endTime: '05:00', breakMinutes: 30, description: 'Long night' })
  check('an overnight shift with a break is 7.5 hours', r.status === 201 && Number(r.json?.hours) === 7.5,
    { status: r.status, hours: r.json?.hours })
  // The break comes off the HOURS, not off the clock — the person was there 21:00 to 05:00.
  check('…and the clock still spans the whole eight hours they were there',
    (new Date(r.json.clockOut).getTime() - new Date(r.json.clockIn).getTime()) / 3600000 === 8,
    { clockIn: iso(r.json?.clockIn), clockOut: iso(r.json?.clockOut) })
  const tooLong = await api('POST', '/api/time', { date: DAY, startTime: '21:00', endTime: '21:20', breakMinutes: 30 })
  check('a break longer than the shift is still refused', tooLong.status === 400, { status: tooLong.status })
}

// ══════════ a reversed typo is refused, not paid as 23 hours ═══════════════════════════════════
{
  // 09:00 → 08:00 reads as an overnight shift of 23 hours. It is a mistyped 09:00 → 18:00, and
  // treating it as a day's work would be worse than saying so. The same 24-hour ceiling the `hours`
  // field already has.
  const typo = await api('POST', '/api/time', { date: DAY, startTime: '09:00', endTime: '08:00' })
  check('09:00 to 08:00 is refused rather than read as 23 hours', typo.status === 400, { status: typo.status, body: typo.text?.slice(0, 240) })
  check('…and says it is across midnight, so the mistake is obvious', /across midnight/i.test(String(typo.json?.error || '')), typo.json?.error)
}

// ══════════ editing the times goes through the same resolution ═════════════════════════════════
{
  const made = await api('POST', '/api/time', { date: DAY, startTime: '08:00', endTime: '12:00' })
  const id = made.json?.id
  const edited = await api('PUT', `/api/time/${id}`, { startTime: '23:00', endTime: '03:00' })
  check('an edit to an overnight pair is accepted', edited.status === 200 && Number(edited.json?.hours) === 4,
    { status: edited.status, hours: edited.json?.hours })
  const [row] = await db.select().from(timeEntry).where(eq(timeEntry.id, id))
  check('…and stores the real instants too, not just on create',
    iso(row?.clockIn) === '2026-10-01T04:00:00.000Z' && iso(row?.clockOut) === '2026-10-01T08:00:00.000Z',
    { clockIn: iso(row?.clockIn), clockOut: iso(row?.clockOut) })
}

// ══════════ a plain hours entry is untouched ═══════════════════════════════════════════════════
{
  const r = await api('POST', '/api/time', { date: DAY, hours: 3.25, description: 'No clock' })
  check('an hours-only entry still works and has no clock', r.status === 201 && Number(r.json?.hours) === 3.25 && !r.json?.clockIn,
    { status: r.status, hours: r.json?.hours, clockIn: r.json?.clockIn })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
