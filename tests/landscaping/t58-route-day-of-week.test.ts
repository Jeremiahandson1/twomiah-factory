// crm-landscaping — a recurring route runs on a day of the week, and there are seven.
//
//   "Landscaping: the route day-of-week checks."
//
// dayOfWeek was parseInt'd with no validation in three places — create, edit, and the list filter —
// and the consequence is not a bad error message. The week BOARD builds itself by walking the seven
// day names, so a route stored on day 9 matched no column and was not on the screen at all, with its
// stops and its weekly revenue. A crew's day missing from the only board they work off, and nothing
// saying anything was wrong.
//
// What is pinned:
//
//   * every write refuses a day that is not 0–6, on create AND on edit (the edit path had no check of
//     any kind, so a route could be MOVED off the board);
//   * Sunday is 0 and must still be accepted — a `!value || value == null` style check is exactly how
//     a legitimate zero gets rejected, and this route's required-field check sits right beside it;
//   * a filter that was asked for and is not a day is refused rather than silently widening to the
//     whole week, which is the kind of wrong answer nobody notices;
//   * and a row ALREADY stored off the week — which a fixed writer does nothing about — is reported
//     by the board instead of vanishing from it.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 340)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, recurringRoute } = await import('./db/schema.ts')
const routes = await import('./src/routes/recurringRoutes.ts')

const [co] = await db.insert(company).values({
  name: 'Green Verge', slug: 'verge-t58', email: 'v58@test.local', settings: {},
  enabledFeatures: ['recurring_routes', 'jobs', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-v58@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U',
  role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/recurring-routes', routes.default)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// ══════════ creating a route on a day that does not exist ══════════════════════════════════════════
console.log('\n══════════ create ══════════')
for (const [label, value] of [
  ['9 — there is no ninth day', 9],
  ['-1', -1],
  ['7 — the days are 0 to 6, so seven is off the end', 7],
  ['"Monday" — a name, which parseInt turned into NaN', 'Monday'],
  ['2.5', 2.5],
  ['"3days" — which parseInt would have read as 3', '3days'],
] as [string, unknown][]) {
  const r = await api('POST', '/api/recurring-routes', { name: `Bad ${label}`, dayOfWeek: value })
  check(`create refuses dayOfWeek ${label}`, r.status === 400, { status: r.status, body: r.text?.slice(0, 200) })
  check(`…and names the rule`, /0 \(Sunday\)/.test(String(r.json?.error || '')), { error: r.json?.error })
}

// …and the days that ARE days. Sunday is the one a required-field check gets wrong.
console.log('\n══════════ the seven real days ══════════')
const made: Record<number, string> = {}
for (let day = 0; day <= 6; day++) {
  const r = await api('POST', '/api/recurring-routes', { name: `Route ${day}`, dayOfWeek: day, estimatedHours: 3 })
  check(`day ${day} is accepted`, r.status === 201, { day, status: r.status, body: r.text?.slice(0, 200) })
  if (r.json?.id) made[day] = r.json.id
}
check('SUNDAY (0) was accepted — a falsy day must not read as a missing one', !!made[0], { made: Object.keys(made) })
check('all seven were created', Object.keys(made).length === 7, { made: Object.keys(made) })

// A route with no day at all is still required to have one.
{
  const r = await api('POST', '/api/recurring-routes', { name: 'No day' })
  check('a route with no dayOfWeek is still refused', r.status === 400, { status: r.status, body: r.text?.slice(0, 200) })
}

// ══════════ MOVING a route off the week ════════════════════════════════════════════════════════════
console.log('\n══════════ edit ══════════')
{
  const id = made[1]
  const r = await api('PUT', `/api/recurring-routes/${id}`, { dayOfWeek: 9 })
  check('edit refuses a day that is not a day — this path had no check at all', r.status === 400,
    { status: r.status, body: r.text?.slice(0, 200) })
  const [row] = await db.select().from(recurringRoute).where(eq(recurringRoute.id, id))
  check('…and the route is still on Monday', (row as any)?.dayOfWeek === 1, { dayOfWeek: (row as any)?.dayOfWeek })

  const ok = await api('PUT', `/api/recurring-routes/${id}`, { dayOfWeek: 4 })
  check('a real day still moves it', ok.status === 200, { status: ok.status, body: ok.text?.slice(0, 200) })
  const [moved] = await db.select().from(recurringRoute).where(eq(recurringRoute.id, id))
  check('…to Thursday', (moved as any)?.dayOfWeek === 4, { dayOfWeek: (moved as any)?.dayOfWeek })
  // Put it back so the board counts below are the seven created above.
  await api('PUT', `/api/recurring-routes/${id}`, { dayOfWeek: 1 })
}

// ══════════ the list filter ════════════════════════════════════════════════════════════════════════
console.log('\n══════════ filter ══════════')
{
  const all = await api('GET', '/api/recurring-routes')
  check('no filter lists every route', (all.json?.data || []).length === 7, { count: (all.json?.data || []).length })

  const one = await api('GET', '/api/recurring-routes?dayOfWeek=3')
  check('a real day filters to that day', (one.json?.data || []).length === 1 && one.json.data[0].dayOfWeek === 3,
    { data: (one.json?.data || []).map((r: any) => r.dayOfWeek) })
  check('…and the day is named', one.json?.data?.[0]?.dayName === 'Wednesday', { dayName: one.json?.data?.[0]?.dayName })

  const sunday = await api('GET', '/api/recurring-routes?dayOfWeek=0')
  check('Sunday filters to Sunday, not to everything', (sunday.json?.data || []).length === 1 && sunday.json.data[0].dayOfWeek === 0,
    { data: (sunday.json?.data || []).map((r: any) => r.dayOfWeek) })

  const bad = await api('GET', '/api/recurring-routes?dayOfWeek=abc')
  check('a filter that is not a day is REFUSED, not widened to the whole week', bad.status === 400,
    { status: bad.status, rows: (bad.json?.data || []).length })
  const over = await api('GET', '/api/recurring-routes?dayOfWeek=9')
  check('…and so is a ninth day', over.status === 400, { status: over.status })
  const blank = await api('GET', '/api/recurring-routes?dayOfWeek=')
  check('an EMPTY filter still means no filter', blank.status === 200 && (blank.json?.data || []).length === 7,
    { status: blank.status, count: (blank.json?.data || []).length })
}

// ══════════ a row already stored off the week ══════════════════════════════════════════════════════
console.log('\n══════════ the board does not swallow a stray route ══════════')
{
  // Written straight into the table, which is how the old write path left them.
  const [stray] = await db.insert(recurringRoute).values({
    companyId: co.id, name: 'Stranded crew', dayOfWeek: 9, estimatedHours: '5', status: 'active',
  } as any).returning()

  const board = await api('GET', '/api/recurring-routes/board')
  check('the board loads', board.status === 200, { status: board.status, body: board.text?.slice(0, 200) })
  const days: any[] = board.json?.data || []
  check('…with seven columns', days.length === 7, { columns: days.length })

  const onAColumn = days.some((d) => (d.routes || []).some((r: any) => r.id === stray.id))
  check('the stray route is on no column — which is why it was invisible', !onAColumn, null)

  // THE FIX: it is reported instead of dropped.
  const unscheduled: any[] = board.json?.unscheduled || []
  check('the board reports it separately', unscheduled.some((r) => r.id === stray.id),
    { unscheduled: unscheduled.map((r) => r.name) })
  check('…with its stop count, so the row is usable', unscheduled[0]?.stopCount === 0, { row: unscheduled[0] })
  check('…and a note the screen can show', /not a day of the week/.test(String(board.json?.unscheduledNote || '')),
    { note: board.json?.unscheduledNote })

  // And a clean board says nothing, rather than carrying an empty warning.
  await db.delete(recurringRoute).where(eq(recurringRoute.id, stray.id))
  const clean = await api('GET', '/api/recurring-routes/board')
  check('a clean board carries no warning at all', clean.json?.unscheduled === undefined && clean.json?.unscheduledNote === undefined,
    { unscheduled: clean.json?.unscheduled, note: clean.json?.unscheduledNote })
  check('…and still has its seven columns', (clean.json?.data || []).length === 7, { columns: (clean.json?.data || []).length })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
