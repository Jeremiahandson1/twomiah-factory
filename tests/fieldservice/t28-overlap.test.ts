// Field Service T28 H1 — a call occupies a RANGE, not an instant.
//
// The guard compared start times, so one tech was given 08:00 (1.5h), 09:00 (2h), 09:30 (1h) and 10:00
// (2h) on 14 Oct and only a SECOND 09:00 was refused — six overlapping calls on one person, and dragging
// a call into an overlap saved too. An identical start is the one overlap the old check caught, which is
// why it looked like a working guard for four runs.
//
// The two edges worth pinning are opposite mistakes: an overlap must be refused, and work that merely
// TOUCHES (09:00–10:00 then 10:00–11:00) must not be — a guard that refuses back-to-back calls would make
// the diary unusable, which is the obvious over-correction here.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T28 Overlap', slug: 't28ov', email: 't28ov@test.local', settings: { timezone: 'UTC' }, enabledFeatures: ['jobs', 'team', 'contacts', 'scheduling'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-t28ov@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [tech] = await db.insert(user).values({ email: 'tech-t28ov@test.local', passwordHash: 'x', firstName: 'Tess', lastName: 'Tech', role: 'user', companyId: co.id } as any).returning()
const [other] = await db.insert(user).values({ email: 'other-t28ov@test.local', passwordHash: 'x', firstName: 'Otto', lastName: 'Other', role: 'user', companyId: co.id } as any).returning()
const [cust] = await db.insert(contact).values({ type: 'client', name: 'T28 Customer', email: 'cust-t28ov@test.local', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.onError(errorHandler)
const H = { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner', 'content-type': 'application/json' }
const call = async (method: string, path: string, body?: any) => {
  const res = await app.request(path, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}

const DAY = '2026-10-14T00:00:00.000Z'
let n = 0
const book = (time: string, hours?: number, who: string = tech.id, day: string = DAY) =>
  call('POST', '/api/jobs', {
    title: `T28 overlap ${++n}`, contactId: cust.id, status: 'scheduled',
    assignedToId: who, scheduledDate: day, scheduledTime: time,
    ...(hours === undefined ? {} : { estimatedHours: hours }),
  })

// ── the anchor ──────────────────────────────────────────────────────────────────────────────────
console.log('\n── one tech, 14 Oct: 09:00 for two hours ──')
const anchor = await book('09:00', 2)
check('the first call saves', anchor.status === 201, anchor)
const anchorNumber = anchor.json?.number

// ── every overlap the tester found ──────────────────────────────────────────────────────────────
console.log('\n── the four the guard used to wave through ──')
for (const [time, hours, why] of [
  ['10:00', 2, 'starts inside 09:00–11:00'],
  ['09:30', 1, 'sits wholly inside it'],
  ['08:00', 1.5, 'ends inside it (08:00–09:30)'],
  ['08:00', 4, 'swallows it whole (08:00–12:00)'],
] as Array<[string, number, string]>) {
  const r = await book(time, hours)
  check(`${time} for ${hours}h is refused — ${why}`, r.status === 409, { status: r.status, error: r.json?.error })
  if (r.status === 409) check(`…and names the call it clashes with`, String(r.json?.error || '').includes(anchorNumber), r.json?.error)
}

console.log('\n── an identical start still clashes (the one case that already worked) ──')
{
  const r = await book('09:00', 1)
  check('a second 09:00 is refused', r.status === 409, { status: r.status, error: r.json?.error })
}

// ── the over-correction guard: touching is not overlapping ──────────────────────────────────────
console.log('\n── back-to-back work is NOT a clash ──')
{
  const r = await book('11:00', 1)
  check('11:00 saves — 09:00–11:00 and 11:00–12:00 only touch', r.status === 201, { status: r.status, error: r.json?.error })
  const before = await book('08:00', 1)
  check('08:00 for 1h saves — it ends exactly as the 09:00 begins', before.status === 201, { status: before.status, error: before.json?.error })
}

// ── a blank duration still holds its hour ───────────────────────────────────────────────────────
console.log('\n── a call with no estimated hours still occupies the diary ──')
{
  const a = await book('14:00')
  check('14:00 with no hours saves', a.status === 201, a)
  const b = await book('14:30')
  check('…and 14:30 is refused — a blank length counts as an hour, not as zero', b.status === 409, { status: b.status, error: b.json?.error })
  const c = await book('15:00')
  check('…while 15:00 saves, one hour clear', c.status === 201, { status: c.status, error: c.json?.error })
}

// ── the same slot is free for someone else, and on another day ──────────────────────────────────
console.log('\n── the guard is per person, per day ──')
{
  const r = await book('09:30', 1, other.id)
  check('another tech may take 09:30 the same morning', r.status === 201, { status: r.status, error: r.json?.error })
  const d = await book('09:30', 1, tech.id, '2026-10-15T00:00:00.000Z')
  check('and the same tech may take 09:30 the next day', d.status === 201, { status: d.status, error: d.json?.error })
}

// ── moving a call into an overlap is the same question ──────────────────────────────────────────
console.log('\n── dragging a call into an overlap is refused too ──')
{
  const far = await book('19:00', 1)
  check('a call at 19:00 saves', far.status === 201, far)
  const moved = await call('PUT', `/api/jobs/${far.json?.id}`, { scheduledTime: '09:30' })
  check('moving it to 09:30 is refused', moved.status === 409, { status: moved.status, error: moved.json?.error })
  const ok = await call('PUT', `/api/jobs/${far.json?.id}`, { scheduledTime: '20:00' })
  check('…and moving it somewhere free still works', ok.status === 200, { status: ok.status, error: ok.json?.error })
}

console.log('\n── lengthening a call until it reaches the next one is refused ──')
{
  // 17:00 for 1h is clear; 18:00 for 1h is clear; stretching the first to 2h runs into the second.
  const first = await book('17:00', 1)
  const second = await book('18:00', 1)
  check('two back-to-back afternoon calls save', first.status === 201 && second.status === 201, { first: first.status, second: second.status })
  const stretched = await call('PUT', `/api/jobs/${first.json?.id}`, { estimatedHours: 2 })
  check('stretching the first over the second is refused — the length is part of the question',
    stretched.status === 409, { status: stretched.status, error: stretched.json?.error })
}

console.log(`\nfs-t28-overlap: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
