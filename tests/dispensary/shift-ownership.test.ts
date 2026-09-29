// crm-dispensary — clocking in belongs to the person whose shift it is (8e69d0d7).
//
// /shifts/:id/clock-in and /clock-out resolved the shift by company_id ALONE, so any signed-in user
// could clock a colleague in or out — a payroll write on someone else's timesheet — while the
// sibling /swap-request right beside them had always matched user_id too. Phase B gated both at
// budtender, which stopped a viewer and not a colleague; requireOwnership is the other half.
//
// requireOwnership lets manager and above act for another person (a supervisor covering a missed
// punch is legitimate) and holds everyone below to their own row. So this is tested in three
// directions, and the one that matters most is the FIRST: a budtender clocking their OWN shift must
// keep working. A fix that locked the floor out of the clock would be worse than the bug.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, shift } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Clock Dispensary', slug: 'clockdisp', email: 'clock@test.local',
  settings: {}, enabledFeatures: ['scheduling'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-clock@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const manager = await mkUser('manager', 'manager')
const alice = await mkUser('user', 'alice')     // budtender
const bob = await mkUser('user', 'bob')         // budtender, the colleague

// TODAY on the shop's clock, not a date picked out of the air: you cannot clock in to a shift that
// has not happened yet, and an owner doing exactly that was T46 N24's last item. This shop is in
// Ohio, so its day is the one that matters — the server's UTC day is a different day for five
// hours every night.
const shiftDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const mkShift = async (owner: any) => (await db.insert(shift).values({
  companyId: co.id, userId: owner.id, role: 'budtender',
  date: shiftDay, startTime: '09:00', endTime: '17:00', status: 'scheduled',
} as any).returning())[0]

const app = new Hono()
app.route('/api/scheduling', (await import('./src/routes/scheduling.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── 1. the thing that must not break: your own shift ────────────────────────────
{
  const s = await mkShift(alice)
  const r = await as(alice)('POST', `/api/scheduling/shifts/${s.id}/clock-in`, {})
  check('a budtender can clock in their OWN shift', r.status === 200, { status: r.status, error: r.json?.error })
  const [after] = await db.select().from(shift).where(eq(shift.id, s.id))
  check('…and the row really changed', after?.status === 'clocked_in' && !!after?.clockInAt, { status: after?.status })
}

// ── 2. the bug: a colleague's shift ─────────────────────────────────────────────
{
  const s = await mkShift(bob)
  const r = await as(alice)('POST', `/api/scheduling/shifts/${s.id}/clock-in`, {})
  check('a budtender CANNOT clock in a colleague', r.status === 403, { status: r.status, error: r.json?.error })
  check('…and says why', r.json?.error === 'You can only modify your own entries', r.json)
  const [after] = await db.select().from(shift).where(eq(shift.id, s.id))
  check('…and the colleague\'s row is untouched', after?.status === 'scheduled' && !after?.clockInAt, { status: after?.status })
}

// ── 3. a supervisor may still cover a missed punch ──────────────────────────────
{
  const s = await mkShift(bob)
  const r = await as(manager)('POST', `/api/scheduling/shifts/${s.id}/clock-in`, {})
  check('a manager CAN clock in someone else', r.status === 200, { status: r.status, error: r.json?.error })
}

// ── 4. clock-out carries the same rule ──────────────────────────────────────────
{
  const mine = await mkShift(alice)
  await as(alice)('POST', `/api/scheduling/shifts/${mine.id}/clock-in`, {})
  const outOwn = await as(alice)('POST', `/api/scheduling/shifts/${mine.id}/clock-out`, {})
  check('a budtender can clock OUT of their own shift', outOwn.status === 200, { status: outOwn.status, error: outOwn.json?.error })

  const theirs = await mkShift(bob)
  await as(manager)('POST', `/api/scheduling/shifts/${theirs.id}/clock-in`, {})
  const outOther = await as(alice)('POST', `/api/scheduling/shifts/${theirs.id}/clock-out`, {})
  check('a budtender CANNOT clock out a colleague', outOther.status === 403, { status: outOther.status, error: outOther.json?.error })
}

// ── 5. a shift that does not exist is refused, not answered with 404 ────────────
// requireOwnership resolves '' for a missing row, so a non-owner never learns whether it exists.
{
  const r = await as(alice)('POST', '/api/scheduling/shifts/nope000/clock-in', {})
  check('an unknown shift id is refused for a budtender', r.status === 403, { status: r.status })
}

// ── 6. the sibling that was ALREADY correct must stay correct ───────────────────
{
  const theirs = await mkShift(bob)
  const r = await as(alice)('POST', `/api/scheduling/shifts/${theirs.id}/swap-request`, { swapWithUserId: manager.id })
  check('swap-request still refuses a colleague\'s shift', r.status === 404 || r.status === 403, { status: r.status, error: r.json?.error })
  const mine = await mkShift(alice)
  const ok = await as(alice)('POST', `/api/scheduling/shifts/${mine.id}/swap-request`, { swapWithUserId: manager.id })
  check('…and still allows your own', ok.status === 200, { status: ok.status, error: ok.json?.error })
}

console.log(`\ndispensary-shift-ownership: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
