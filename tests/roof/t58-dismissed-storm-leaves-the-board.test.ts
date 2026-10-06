// crm-roof — dismissing a storm event takes it off the board.
//
//   "Roofing: the probe storm events are still listed."
//
// They were — and so was every event anyone had ever dismissed. `GET /events` ignored status unless a
// caller asked for one, and the page asks for none. So `dismissEvent` POSTed the dismiss, toasted
// "Event dismissed", called loadEvents(), and the event it had just dismissed came straight back onto
// the board. A control whose entire purpose is to take a row off the screen, reporting success and
// changing nothing visible.
//
// It matters more here than it reads: there is no DELETE for a storm event, by design — an event is a
// record of weather and dismissing is how you put one away. So dismiss not working meant nothing
// could ever be put away, and a board that only grows stops being a board.
//
// The fix must not make a dismissed event UNREACHABLE either, which would be deleting with extra
// steps. `?status=dismissed` and `?includeDismissed=true` are both pinned below, because the screen's
// "Show dismissed events" toggle is the way back.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 340)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const mk = async (slug: string) => {
  const [co] = await db.insert(company).values({
    name: slug, slug, email: `${slug}@test.local`, state: 'OH',
    settings: {}, enabledFeatures: ['storms', 'canvassing'],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: `owner-${slug}@test.local`, passwordHash: 'x', firstName: 'O', lastName: 'U',
    role: 'owner', companyId: co.id, isActive: true,
  } as any).returning()
  return { co, owner }
}
const mine = await mk('storm-board-t58')
const other = await mk('storm-other-t58')

const app = new Hono()
app.route('/api/storms', (await import('./src/routes/storms.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (who: any, co: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const api = as(mine.owner, mine.co)
const apiOther = as(other.owner, other.co)
const rows = (r: any) => (Array.isArray(r.json) ? r.json : r.json?.data) || []

// ══════════ two events on the board ════════════════════════════════════════════════════════════════
console.log('\n══════════ two events ══════════')
let keepId = '', dropId = ''
{
  const a = await api('POST', '/api/storms/events', {
    eventType: 'hail', affectedZipCodes: ['45402'], hailSizeInches: 1.75,
    description: 'Real storm — keep this one',
  })
  check('an event is created', a.status === 201, { status: a.status, body: a.text?.slice(0, 220) })
  keepId = a.json?.id

  const b = await api('POST', '/api/storms/events', {
    eventType: 'wind', affectedZipCodes: ['45403'], windSpeedMph: 55,
    description: 'The one to put away',
  })
  check('and a second', b.status === 201, { status: b.status, body: b.text?.slice(0, 220) })
  dropId = b.json?.id

  // The empty-body hole T42 closed, still closed.
  const empty = await api('POST', '/api/storms/events', {})
  check('an event with no affected zip codes is still refused', empty.status === 400,
    { status: empty.status, body: empty.text?.slice(0, 200) })

  const board = await api('GET', '/api/storms/events')
  check('both are on the board', rows(board).length === 2, { count: rows(board).length })
}

// ══════════ THE FINDING ════════════════════════════════════════════════════════════════════════════
console.log('\n══════════ dismissing one ══════════')
{
  const d = await api('POST', `/api/storms/events/${dropId}/dismiss`)
  check('dismissing works', d.status === 200, { status: d.status, body: d.text?.slice(0, 200) })
  check('…and the event says it is dismissed', d.json?.status === 'dismissed', { status: d.json?.status })

  const board = await api('GET', '/api/storms/events')
  const ids = rows(board).map((e: any) => e.id)
  check('the dismissed event is OFF the board', !ids.includes(dropId), { ids, dropId })
  check('…and the other one is still on it', ids.includes(keepId), { ids, keepId })
  check('…so the board is down to one', rows(board).length === 1, { count: rows(board).length })
}

// ══════════ and still reachable, which is the difference from deleting ════════════════════════════
console.log('\n══════════ the way back ══════════')
{
  const dismissed = await api('GET', '/api/storms/events?status=dismissed')
  const ids = rows(dismissed).map((e: any) => e.id)
  check('?status=dismissed finds it', ids.includes(dropId), { ids })
  check('…and shows only the dismissed one', rows(dismissed).length === 1, { count: rows(dismissed).length })

  const all = await api('GET', '/api/storms/events?includeDismissed=true')
  check('?includeDismissed=true returns the lot', rows(all).length === 2, { count: rows(all).length })

  const detected = await api('GET', '/api/storms/events?status=detected')
  check('an explicit active filter still works', rows(detected).every((e: any) => e.status === 'detected'),
    rows(detected).map((e: any) => e.status))

  // It is a record, not a deletion: the row is still there to be read.
  const detail = await api('GET', `/api/storms/events/${dropId}`)
  check('the dismissed event can still be opened directly', detail.status === 200 && detail.json?.id === dropId,
    { status: detail.status })
}

// ══════════ another company's board ═══════════════════════════════════════════════════════════════
console.log('\n══════════ scoping ══════════')
{
  const theirs = await apiOther('GET', '/api/storms/events?includeDismissed=true')
  check('another company sees none of these', rows(theirs).length === 0, { count: rows(theirs).length })
  const steal = await apiOther('POST', `/api/storms/events/${keepId}/dismiss`)
  check('…and cannot dismiss one of them', steal.status === 404, { status: steal.status })
  const board = await api('GET', '/api/storms/events')
  check('…so our board is untouched', rows(board).length === 1, { count: rows(board).length })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
