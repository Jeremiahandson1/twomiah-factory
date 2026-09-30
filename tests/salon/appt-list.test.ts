// crm-salon — GET /api/appointments answers the question it was asked.
//
// This is not a reported finding. It is the endpoint that turned an operator cleanup script into a
// tenant-wide accident: the script asked for ONE client's appointments so it could remove the row it
// had just created, and the list returned all 525 the company had, with a 200 and no clue. It then
// cancelled every one of them — which, for a completed visit, also reverses loyalty, voids the sale
// and deletes the visit record.
//
// Two rules, and both are here because the failure was silent rather than loud:
//
//   1. A filter the caller sends is either applied or refused. Ignoring it returns the answer to a
//      different question in the shape of the right one, and no caller can detect that.
//   2. A list is bounded. from/to are optional, so a bare GET / was the whole table.
//
// Bounding it had to not break the book, which is the only real caller and asks for a single day.
// So a date WINDOW counts as a bound and stays unlimited; it is the windowless call that gets a page
// and is told so. That asymmetry is the point of this file — a default limit applied to the windowed
// case would silently drop appointments off the end of a busy day, which is a worse bug than the one
// being fixed.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, appointment } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Appt List Salon', slug: 'apptlist', email: 'al@test.local', enabledFeatures: ['salon_booking'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-al@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()
const [svc] = await db.insert(serviceMenu).values({
  name: 'Cut', price: '40', durationMin: 30, companyId: co.id,
} as any).returning()
const [alice] = await db.insert(contact).values({ name: 'Alice', type: 'client', companyId: co.id } as any).returning()
const [bob] = await db.insert(contact).values({ name: 'Bob', type: 'client', companyId: co.id } as any).returning()

// Alice has 3, Bob has 140 — enough that a default page cannot accidentally contain them all.
const base = new Date('2026-06-01T14:00:00Z').getTime()
const mk = async (who: any, n: number, dayOffset: number) => {
  for (let i = 0; i < n; i++) {
    const start = new Date(base + (dayOffset + i) * 86400000)
    await db.insert(appointment).values({
      companyId: co.id, contactId: who.id, serviceId: svc.id, title: 'Cut',
      startTime: start, endTime: new Date(start.getTime() + 30 * 60000), status: 'scheduled',
    } as any)
  }
}
await mk(alice, 3, 0)
await mk(bob, 140, 10)
const TOTAL = 143

const app = new Hono()
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rowsOf = (r: any) => (r.json?.data || []) as any[]

// ══════════ 1 · a filter that is sent is applied ════════════════════════════════════════════════
{
  const one = await api(`/api/appointments?contactId=${alice.id}`)
  check('asking for one client answers 200', one.status === 200, one.status)
  check("…with only that client's appointments", rowsOf(one).length === 3, { got: rowsOf(one).length, want: 3 })
  check('…and every row really is theirs',
    rowsOf(one).every((a) => a.contactId === alice.id), [...new Set(rowsOf(one).map((a) => a.contactId))])

  // The exact shape of the accident: one client asked for, the whole company returned.
  check('…so it is NOT the whole company', rowsOf(one).length < TOTAL, rowsOf(one).length)

  const other = await api(`/api/appointments?contactId=${bob.id}&limit=500`)
  check('the other client gets their own 140', rowsOf(other).length === 140, rowsOf(other).length)

  // A client with nothing gets nothing, rather than everything.
  const [carol] = await db.insert(contact).values({ name: 'Carol', type: 'client', companyId: co.id } as any).returning()
  const none = await api(`/api/appointments?contactId=${carol.id}`)
  check('a client with no appointments gets an empty list, not the whole book', rowsOf(none).length === 0, rowsOf(none).length)
}

// ══════════ 2 · a windowless list is bounded, and says so ═══════════════════════════════════════
{
  const all = await api('/api/appointments')
  check('a bare list answers 200', all.status === 200, all.status)
  check(`…and is bounded to the default page, not all ${TOTAL}`, rowsOf(all).length === 100, rowsOf(all).length)
  check('…and reports the whole count, so a caller can tell there is more',
    all.json?.pagination?.total === TOTAL, all.json?.pagination)
  check('…and how many pages that is', all.json?.pagination?.pages === 2, all.json?.pagination)

  const p2 = await api('/api/appointments?page=2')
  check('page 2 returns the remainder', rowsOf(p2).length === TOTAL - 100, rowsOf(p2).length)
  const ids1 = new Set(rowsOf(all).map((a) => a.id))
  check('…and does not repeat page 1', rowsOf(p2).every((a) => !ids1.has(a.id)), true)

  const big = await api('/api/appointments?limit=500')
  check('a caller may ask for a bigger page', rowsOf(big).length === TOTAL, rowsOf(big).length)
  // Asserted on the limit the server REPORTS, not on the row count. This fixture holds 143
  // appointments and the cap is 500, so "did it return at most 500 rows" is true whether the cap
  // exists or not — the first version of this line passed with the cap deleted.
  //
  // In the deployed app an over-cap limit never reaches this handler: index.ts carries an
  // app-wide pagination validator that refuses it with 400 invalid_pagination, which is the
  // stronger form of the rule. The harness mounts routes directly and not index.ts, so what this
  // asserts is the handler's own clamp — the second line of defence, and the only one the sandbox
  // can see.
  const silly = await api('/api/appointments?limit=99999')
  check('…but not an unbounded one — the handler clamps to 500', silly.json?.pagination?.limit === 500, silly.json?.pagination)
  const zero = await api('/api/appointments?limit=0&page=0')
  check('nonsense paging does not divide by zero or return everything',
    zero.status === 200 && rowsOf(zero).length >= 1 && rowsOf(zero).length <= 500, { status: zero.status, n: rowsOf(zero).length })
}

// ══════════ 3 · the book is NOT truncated — the reason this is not a blanket limit ═══════════════
{
  // Bob's 140 sit on consecutive days from day 10. A window over all of them must return all of
  // them: a default page here would silently lose 40 appointments off a busy stretch.
  const from = new Date(base + 10 * 86400000 - 3600_000).toISOString()
  const to = new Date(base + 200 * 86400000).toISOString()
  const win = await api(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  check('a windowed request returns every appointment in the window', rowsOf(win).length === 140, rowsOf(win).length)
  check('…and is deliberately NOT paged — the window is the bound', win.json?.pagination === undefined, win.json?.pagination)

  // One day, which is what the book actually asks for.
  const d = new Date(base)
  const dayFrom = new Date(d.getTime() - 3600_000).toISOString()
  const dayTo = new Date(d.getTime() + 3600_000).toISOString()
  const day = await api(`/api/appointments?from=${encodeURIComponent(dayFrom)}&to=${encodeURIComponent(dayTo)}`)
  check("a single day returns that day's appointments", rowsOf(day).length === 1, rowsOf(day).length)

  // …and a window combined with a client filter narrows to both.
  const both = await api(`/api/appointments?contactId=${bob.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  check('a window and a client filter together narrow to both', rowsOf(both).length === 140, rowsOf(both).length)
  const neither = await api(`/api/appointments?contactId=${alice.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  check('…and a client with nothing in the window gets nothing', rowsOf(neither).length === 0, rowsOf(neither).length)
}

// ══════════ 4 · the filters that already worked still work ══════════════════════════════════════
{
  await db.execute(sql`UPDATE appointment SET status = 'completed' WHERE contact_id = ${alice.id}`)
  const done = await api('/api/appointments?status=completed&limit=500')
  check('status still filters', rowsOf(done).length === 3, rowsOf(done).length)
  check('…to the right rows', rowsOf(done).every((a) => a.contactId === alice.id), true)
  const mixed = await api(`/api/appointments?status=completed&contactId=${bob.id}`)
  check('status and client together agree on nothing', rowsOf(mixed).length === 0, rowsOf(mixed).length)
}

// ══════════ 5 · one company cannot page into another's book ═════════════════════════════════════
{
  const [other] = await db.insert(company).values({
    name: 'Other Salon', slug: 'otherapptlist', email: 'oth@test.local', enabledFeatures: ['salon_booking'],
  } as any).returning()
  const [oc] = await db.insert(contact).values({ name: 'Theirs', type: 'client', companyId: other.id } as any).returning()
  const [osvc] = await db.insert(serviceMenu).values({ name: 'Cut', price: '40', durationMin: 30, companyId: other.id } as any).returning()
  const start = new Date(base + 500 * 86400000)
  await db.insert(appointment).values({
    companyId: other.id, contactId: oc.id, serviceId: osvc.id, title: 'Cut',
    startTime: start, endTime: new Date(start.getTime() + 1800_000), status: 'scheduled',
  } as any)

  const mine = await api('/api/appointments?limit=500')
  check("another salon's appointment is not in this list", rowsOf(mine).every((a) => a.companyId === co.id), true)
  check('…and the total does not count it', mine.json?.pagination?.total === TOTAL, mine.json?.pagination?.total)
  // Naming their client id must not reach across either.
  const cross = await api(`/api/appointments?contactId=${oc.id}`)
  check('asking by their client id returns nothing, not everything', rowsOf(cross).length === 0, rowsOf(cross).length)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
