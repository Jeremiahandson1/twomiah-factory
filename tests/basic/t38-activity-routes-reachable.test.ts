// crm-basic — the two activity routes were unreachable, and both of them answered 200. (T38)
//
// Hono matches in REGISTRATION ORDER. `GET /activity/feed` sat BELOW `GET /:entityType/:entityId`,
// and `GET /activity/user/:userId` sat BELOW `GET /activity/:entityType/:entityId`, in eight
// templates. Neither failed: the first was answered as a comment lookup for an entity of type
// "activity" with id "feed", the second as an activity lookup for entity type "user". Both returned
// HTTP 200 with a plausible empty array, for the life of the endpoint.
//
// WHY THIS TEST EXISTS AND NOT JUST THE GUARD. scripts/check-route-shadowing.ts (#192) enforces the
// declaration ORDER, which is what stops the fault coming back. It cannot say that the handler now
// being reached is the right one. And the live tenant could not say it either: basictest's activity
// table is empty, so the correct handler and the one that was shadowing it both answered `[]` —
// indistinguishable over HTTP. Seeded rows are the only thing that separates them.
//
// EACH ASSERTION IS A DISCRIMINATOR, not a status code. The two handlers differ in a way the
// response shows:
//
//   getUserActivity   SELECT * FROM activity WHERE user_id = $1          → no joined columns
//   getEntityActivity SELECT a.*, u.first_name … WHERE entity_type = $2  → first_name present
//   getComments       SELECT c.*, u.first_name … FROM comment            → content present
//   getActivityFeed   returns { activities, pagination }                 → not an array at all
//
// So the fixture is built so that the WRONG handler would return a different, identifiable answer —
// and the test fails on that answer rather than on a 404 it would never have produced.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Showcase Gym', slug: 'showcase-gym-activity', email: 'gym@test.local', state: 'OH',
  settings: {}, enabledFeatures: [],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner@gym.local', passwordHash: 'x', firstName: 'Olive', lastName: 'Owner',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [coach] = await db.insert(user).values({
  email: 'coach@gym.local', passwordHash: 'x', firstName: 'Cass', lastName: 'Coach',
  role: 'user', companyId: co.id, isActive: true,
} as any).returning()

const app = new Hono()
app.route('/api/comments', (await import('./src/routes/comments.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// ── the fixture, built so the WRONG handler has something of its own to return ─────────────────
//
// Raw SQL, because these two modules read these tables with raw SQL; a drizzle insert here could
// drift from the thing under test.

// The owner did two things. Note the second one is on an entity of type 'user' — that row is exactly
// what the SHADOWING handler (entity_type = 'user') would hand back, and nothing else.
await db.execute(sql`
  INSERT INTO activity (id, company_id, user_id, entity_type, entity_id, action, description, created_at)
  VALUES ('act-own-job', ${co.id}, ${owner.id}, 'job', 'job-1', 'created', 'opened the job', NOW() - INTERVAL '2 hours')
`)
await db.execute(sql`
  INSERT INTO activity (id, company_id, user_id, entity_type, entity_id, action, description, created_at)
  VALUES ('act-own-user', ${co.id}, ${owner.id}, 'user', ${owner.id}, 'updated', 'changed their own details', NOW() - INTERVAL '1 hour')
`)
// …and the coach did one, which must never appear in the owner's activity.
await db.execute(sql`
  INSERT INTO activity (id, company_id, user_id, entity_type, entity_id, action, description, created_at)
  VALUES ('act-coach-job', ${co.id}, ${coach.id}, 'job', 'job-1', 'updated', 'moved the job', NOW())
`)
// A comment parked on entity_type 'activity', id 'feed'. This is what the handler that was
// swallowing GET /activity/feed would return — so if the feed route is ever shadowed again, this
// comment comes back instead of the feed and the assertion below names it.
await db.execute(sql`
  INSERT INTO comment (id, company_id, user_id, entity_type, entity_id, content, parent_id, created_at, updated_at)
  VALUES ('cmt-decoy', ${co.id}, ${owner.id}, 'activity', 'feed', 'DECOY — a comment on entity "activity"/"feed"', NULL, NOW(), NOW())
`)

// ══════════ GET /activity/feed — the company feed, not a comment thread ════════════════════════
{
  const r = await api('GET', '/api/comments/activity/feed')
  check('the feed answers', r.status === 200, { status: r.status, body: r.text?.slice(0, 200) })

  // The shadowing handler returns a bare array of COMMENTS. The feed returns an object.
  check('…and it is the feed, not the comment thread that used to swallow it',
    !Array.isArray(r.json) && r.json && typeof r.json === 'object',
    { shape: Array.isArray(r.json) ? 'array' : typeof r.json, body: r.text?.slice(0, 200) })
  check('…with activities and pagination',
    Array.isArray(r.json?.activities) && !!r.json?.pagination,
    { keys: Object.keys(r.json || {}) })

  // Named explicitly: the decoy must NOT be what came back.
  check('…and the decoy comment on entity "activity"/"feed" is nowhere in it',
    !/DECOY/.test(r.text), r.text?.slice(0, 240))

  check('all three activity rows are in the feed', r.json?.pagination?.total === 3, { total: r.json?.pagination?.total })
  const actions = (r.json?.activities || []).map((a: any) => a.id)
  check('…newest first', actions[0] === 'act-coach-job', actions)
  // `.every()` on an empty array is true, and under the shadowed version `activities` is undefined —
  // so the length is asserted first or this passes vacuously on exactly the fault it is here for.
  check('…and the feed joins the person, so a row can say who did it',
    (r.json?.activities || []).length === 3 && r.json.activities.every((a: any) => 'first_name' in a),
    { count: (r.json?.activities || []).length, keys: Object.keys((r.json?.activities || [])[0] || {}) })
}

// ══════════ GET /activity/user/:userId — one person's activity ════════════════════════════════
{
  const r = await api('GET', `/api/comments/activity/user/${owner.id}`)
  check('one person\'s activity answers', r.status === 200, { status: r.status, body: r.text?.slice(0, 200) })
  const rows: any[] = Array.isArray(r.json) ? r.json : []

  // THE DISCRIMINATOR. The correct handler filters on user_id and returns BOTH of the owner's rows.
  // The handler that was shadowing it filters on entity_type = 'user' and would return only
  // act-own-user — one row, and with first_name joined onto it.
  check('both of the owner\'s rows come back — filtered by who did it, not by entity type',
    rows.length === 2, { count: rows.length, ids: rows.map((x) => x.id) })
  check('…including the one on a job, which the shadowing handler could never return',
    rows.some((x) => x.id === 'act-own-job'), rows.map((x) => x.id))
  check('…and it is NOT the entity-activity handler answering',
    rows.length > 0 && !('first_name' in rows[0]),
    { keys: Object.keys(rows[0] || {}) })

  // Scoping, which is the other thing this route has to get right.
  check('the coach\'s activity is not in the owner\'s list',
    !rows.some((x) => x.id === 'act-coach-job'), rows.map((x) => x.id))
}

// ══════════ the route it sits above still works ═══════════════════════════════════════════════
//
// Moving a literal above a parameter route can only break the parameter route by shadowing it in
// turn, so the thing that was shadowing is checked too — '/activity/user/:userId' must not have
// become a catch-all that eats '/activity/job/job-1'.
{
  const r = await api('GET', '/api/comments/activity/job/job-1')
  check('GET /activity/:entityType/:entityId still answers', r.status === 200, { status: r.status })
  const rows: any[] = Array.isArray(r.json) ? r.json : []
  check('…with both rows on that job, from both people', rows.length === 2, { ids: rows.map((x) => x.id) })
  check('…and it is the joined query, so the move did not redirect it',
    rows.length > 0 && 'first_name' in rows[0], Object.keys(rows[0] || {}))
}

// ══════════ and the comment thread the feed route sits above ══════════════════════════════════
{
  const r = await api('GET', '/api/comments/activity/feed-not-the-feed')
  check('GET /:entityType/:entityId still answers', r.status === 200, { status: r.status })
  check('…as a comment thread', Array.isArray(r.json), { shape: Array.isArray(r.json) ? 'array' : typeof r.json })
  const decoy = await api('GET', '/api/comments/activity/feed-decoy-check')
  check('…and an empty thread is still an empty array, not the feed object',
    Array.isArray(decoy.json) && decoy.json.length === 0, decoy.text?.slice(0, 160))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
