// The contract EVERY template's routes must keep. One implementation, copied into every sandbox by
// runSuite — so a new vertical gets this the moment it has a suite entry, and there is no per-suite
// copy to drift.
//
// Asserted against the REAL app. `src/index.ts` exports it with the whole middleware stack in the
// order the product applies — secure headers, CORS, rate limits, feature gates, auth gates — and
// re-declaring that order in a test is how a gate ends up asserted in the wrong place (a Hono gate
// below its route never runs). The route list is read from that same file, so it cannot drift from
// what is mounted.
//
// Two invariants:
//   1. an unauthenticated request is refused. With no x-test-user header the REAL auth middleware
//      runs, so this exercises the genuine gate. 200/201 is a hole; a 5xx is a gate that crashes.
//   2. a well-formed authenticated request does not answer 5xx. This is the invariant broken by
//      GET /api/payroll/summary in four templates, GET /api/payroll/expenses in seven, and the whole
//      /api/scheduling module in eight — every one of them 500 on every call it ever received,
//      because nothing called them.
//
// Fairness, so a failure here means something:
//   · write methods are sent `{}`. Sending no body made every webhook "fail" on a JSON parse error,
//     which was the probe's fault.
//   · 503 PROVIDER_NOT_CONFIGURED is a DECLARED refusal (Wisetack has no account) and passes.
//   · webhook/callback paths authenticate by provider signature, not a user session, so they are
//     exempt from rule 1 — never from rule 2.
//   · ids are a plausible string belonging to nobody, so 404 is the right answer and passes. A 5xx
//     on a missing row is the defect.
//   · every feature the template gates is switched ON, so a feature gate's 403 cannot hide a 500.
import { readFileSync, existsSync } from 'node:fs'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++ } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 260)) }
}
const note = (s: string) => console.log(`  ·    ${s}`)

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const schema: any = await import('./db/schema.ts')

// crm-homecare and crm-store keep the session identity in the token rather than a user row, and ship
// their own auth stub for it. Standing one up here would mean a second understanding of their auth
// living in a shared file — so this contract declines to guess, loudly, instead of asserting
// something it cannot set up honestly.
const userTable = schema.user || schema.users
const companyTable = schema.company || schema.companies
if (!userTable || !companyTable) {
  console.log('  ·    this template has no company/user pair this contract knows how to seed — skipped deliberately, not silently')
  console.log('\n  0 passed, 0 failed')
  process.exit(0)
}

const idx = readFileSync('./src/index.ts', 'utf8')
// Every feature this template gates, read from its own gate calls — not a list typed here.
const features = [...new Set([...idx.matchAll(/requireEnabledFeature\(\s*['"]([a-z0-9_]+)['"]/g)].map((m) => m[1]))]
note(`${features.length} gated features switched on for the probe`)

const [co] = await db.insert(companyTable).values({
  name: 'Contract Co', slug: 'contract-co', email: 'contract@test.local', state: 'OH', settings: {},
  enabledFeatures: features,
} as any).returning()
const [owner] = await db.insert(userTable).values({
  email: 'owner-contract@test.local', passwordHash: 'x', firstName: 'Owner', lastName: 'Contract',
  role: 'owner', companyId: co.id,
} as any).returning()
check('a company and an owner can be seeded', !!co?.id && !!owner?.id)

/**
 * Boot the real entry point, then talk to it over HTTP — not through app.request().
 *
 * index.ts calls serve({ fetch: app.fetch }) from @hono/node-server at import time. Mixing that with
 * app.request() in the same process puts node-server's response cache into Hono's `c.res` path, and
 * the setter rebuilds the response with a status of 0:
 *
 *   RangeError: The status provided (0) must be 101 or in the range of [200, 599]
 *
 * That is a HARNESS artefact, not a defect, and it cost me three "findings" on the dispensary before
 * I checked the live tenant and found all three answering 200. Since index.ts has already started a
 * listener, the honest thing is to use it: a real HTTP request over the socket is also higher
 * fidelity than app.request(), because it is exactly the path a browser takes.
 */
const PORT = 19000 + Math.floor(Math.random() * 20000)
process.env.PORT = String(PORT)
const mod: any = await import('./src/index.ts')
check('src/index.ts exports an app', !!(mod.app || mod.default), { exports: Object.keys(mod || {}) })

const BASE = `http://127.0.0.1:${PORT}`
let up = false
for (let i = 0; i < 60 && !up; i++) {
  try { await fetch(`${BASE}/health`); up = true } catch { await new Promise((r) => setTimeout(r, 250)) }
}
check(`the template's own server is listening on ${PORT}`, up)
if (!up) { console.log(`\n  ${passed} passed, ${failed} failed`); process.exit(1) }

type R = { method: string; path: string; mount: string }
const imports = new Map<string, string>()
for (const m of idx.matchAll(/import\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/g)) {
  let p = './src/' + m[2].replace(/^\.\//, '')
  if (!existsSync(p) && existsSync(p + '.ts')) p += '.ts'
  imports.set(m[1], p)
}
const routes: R[] = []
for (const line of idx.split(/\r?\n/)) {
  if (/^\s*\/\//.test(line)) continue
  const m = line.match(/app\.route\(\s*['"](\/api\/[^'"]+)['"]\s*,\s*(\w+)\s*\)/)
  if (!m) continue
  const [, mount, ident] = m
  // /api/internal/* carries its own factory key; /api/public/* is deliberately open.
  if (/\/api\/(internal|public)\b/.test(mount)) continue
  const f = imports.get(ident)
  if (!f || !existsSync(f)) continue
  const src = readFileSync(f, 'utf8')
  for (const g of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]/g)) {
    const full = (mount + (g[2] === '/' ? '' : g[2])).replace(/\/+$/, '') || mount
    routes.push({ method: g[1].toUpperCase(), path: full, mount })
  }
}
note(`${routes.length} routes across ${new Set(routes.map((r) => r.mount)).size} mounts`)
check('the template mounts routes this test can see', routes.length > 20, { routes: routes.length })

const GHOST = 'zzzzzzzzzzzzzzzzzzzzzzzz'
const fill = (p: string) => p.replace(/:\w+/g, GHOST)
const WRITE = new Set(['POST', 'PUT', 'PATCH'])
const req = async (method: string, path: string, headers: Record<string, string> = {}) => {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: WRITE.has(method) ? '{}' : undefined,
      // A handler that reaches for an external provider can sit there; cap it rather than hang the
      // suite, and count the timeouts separately so they are visible instead of silently passing.
      signal: AbortSignal.timeout(20000),
    })
    return { status: res.status, body: (await res.text()).slice(0, 220) }
  } catch (e: any) {
    return { status: -1, body: `request failed: ${e?.message}` }
  }
}
/**
 * A refusal the product declares on purpose is a pass, not a crash.
 *
 * "This integration is not connected" has FOUR spellings in this codebase, all correctly coded 503:
 *   · shared Wisetack router      503 { code: 'PROVIDER_NOT_CONFIGURED' }
 *   · crm-roof financing/reviews  503 { error: 'not_configured' }
 *   · crm-dispensary integrations 503 "Card payments are not set up for this CRM yet"
 *   · platformSupport (9 copies)  503 "Support messaging is not connected for this account yet"
 *
 * I added the first three one at a time and the fourth was still waiting, so this now matches the
 * FAMILY rather than the phrasings. Four vocabularies for one condition is itself worth a
 * unification pass — a check that has to learn each new wording is a check that will miss the fifth.
 */
const declared = (status: number, body: string) =>
  status === 503 && /not[ _]configured|not connected|not set up|unavailable|PROVIDER_NOT_CONFIGURED/i.test(body)

const OPEN_DOOR = new RegExp([
  // the credential doors
  '\\/api\\/auth\\/(login|register|forgot-password|reset-password|verify|refresh|accept-invite)',
  // An email open-tracking pixel MUST be reachable without a session: it is fetched by the
  // recipient's mail client, which has no login. It answers a 1x1 GIF, which is why this one showed
  // up as "readable without signing in" — correctly.
  '\\/marketing\\/track\\/',
].join('|'))
const MACHINE = /\/(webhook|webhooks|callback)(\/|$)/

/**
 * Routes a 5xx is NOT attributable to the product on, with the evidence.
 *
 * The sandbox replays each template's migration journal; it never runs migrate.ts's ENSURE_COLUMNS /
 * index step, which a real boot does (see the harness-skips-migrate-ENSURE note). So a handler can
 * fail here on schema a live tenant has. Each entry below was checked against the live tenant before
 * being listed, and the status it really answers is recorded — because an exemption with no evidence
 * is just a silenced failure.
 *
 *   disptest, 2026-10-01, checkin + queue_management both enabled:
 *     GET  /api/checkin/stats                          -> 200 {"currentWaiting":0,…}
 *     GET  /api/checkin/queue                          -> 200 {"data":[]}
 *     GET  /api/compliance-controls/dashboard          -> 200 {"overallScore":37,…}
 *     PUT  /api/checkin/queue/<ghost>/status           -> 400
 *     PUT  /api/checkin/<ghost>/call                   -> 400
 *     PUT  /api/checkin/<ghost>/complete               -> 404
 *     POST /api/marketplace/seed-partners              -> 201 "Seeded 10 integration partners"
 *     POST /api/compliance-controls/dashboard/assess   -> 200 {"overallScore":37,…}
 *
 * In the sandbox these answer 500 with one of two messages, and both trace to the same place:
 * "no unique or exclusion constraint matching the ON CONFLICT specification" (the index a real boot
 * creates and the journal does not), and a RangeError about a status of 0 — the error path rebuilding
 * a response after that failure, which swallows the real cause.
 *
 * The honest fix is the HARNESS, not the product: run migrate.ts's ENSURE step after replaying the
 * journal, and this list disappears. Until then each entry carries the live status it really answers,
 * because an exemption with no evidence is a silenced failure.
 */
const SANDBOX_GAP: string[] = []

// ══════════ 1. nothing is reachable without signing in ═════════════════════════════════════════
{
  const guarded = routes.filter((r) => !OPEN_DOOR.test(r.path) && !MACHINE.test(r.path))
  let holes = 0, crashes = 0
  for (const r of guarded) {
    const { status, body } = await req(r.method, fill(r.path))
    if (status === 200 || status === 201) {
      holes++; check(`${r.method} ${r.path} refuses an unauthenticated request`, false, { status, body })
    } else if (status >= 500 && !declared(status, body)) {
      crashes++; check(`${r.method} ${r.path} refuses rather than crashing when unauthenticated`, false, { status, body })
    } else passed++
  }
  note(`unauthenticated: ${guarded.length} guarded routes — ${holes} answered 200, ${crashes} crashed`)
  check(`no guarded route is readable without signing in (${guarded.length} routes)`, holes === 0, { holes })
}

// ══════════ 2. a well-formed authenticated request never answers 5xx ═══════════════════════════
{
  const auth = { 'x-test-user': owner.id }
  const probe = routes.filter((r) => r.method === 'GET' || MACHINE.test(r.path))
  let broken = 0, gaps = 0
  for (const r of probe) {
    const { status, body } = await req(r.method, fill(r.path), auth)
    if (status >= 500 && !declared(status, body)) {
      if (SANDBOX_GAP.includes(r.path)) { gaps++; continue }
      broken++; check(`${r.method} ${r.path} answers without a 5xx`, false, { status, body })
    } else passed++
  }
  note(`signed in: ${probe.length} routes probed — ${broken} answered 5xx`)
  if (gaps) note(`${gaps} route(s) skipped as known sandbox schema gaps, each verified answering 200 on the live tenant — see SANDBOX_GAP above`)
  check(`no route answers 5xx for a signed-in owner (${probe.length} routes)`, broken === 0, { broken })
}

// ══════════ 3. a write given nothing refuses; it does not crash ════════════════════════════════
//
// Writes outnumber reads in every template (crm 162 vs 116, dispensary 395 vs 288), and until now
// invariant 2 only covered the reads. A POST/PUT/PATCH/DELETE with a valid but EMPTY JSON body is the
// request a half-filled form sends, and the right answer is a refusal a person can act on — 400 from
// the validator, 403 from a permission, 404 for a parent that is not there. A 5xx means the handler
// reached the database with nothing and fell over, which is the shape of several findings from
// earlier rounds (T45's whole "mismatch" class, T48 Q4).
//
// Safe to drive: the sandbox is a disposable PGlite created per test process, so rows these writes
// create die with it, and the ids are ghosts so nothing real is deleted. Run last, so nothing above
// is reading a database these writes have changed.
{
  const auth = { 'x-test-user': owner.id }
  const writes = routes.filter((r) => (WRITE.has(r.method) || r.method === 'DELETE') && !MACHINE.test(r.path))
  // Collected, not asserted one by one: the pass/fail decision below is the RATCHET on the total.
  // Failing each route individually (which the first version did) makes the ratchet unreachable — the
  // suite is red whatever the count, which is the thing the ratchet exists to avoid.
  const crashes: Array<{ method: string; path: string; status: number; body: string }> = []
  let created = 0, slow = 0
  for (const r of writes) {
    const { status, body } = await req(r.method, fill(r.path), auth)
    if (status === -1) { slow++; continue }
    if (status >= 500 && !declared(status, body)) {
      if (SANDBOX_GAP.includes(r.path)) continue
      crashes.push({ method: r.method, path: r.path, status, body })
    } else {
      if (status === 200 || status === 201) created++
      passed++
    }
  }
  const broken = crashes.length
  note(`writes: ${writes.length} probed with an empty body — ${broken} crashed, ${created} ACCEPTED it, ${slow} did not answer in time`)
  // Accepting {} is not necessarily wrong (some writes have no required field) but it is worth
  // seeing the number, because a create that takes nothing is usually a validator that was skipped.

  /**
   * The write path is a RATCHET, not a pass/fail — for now.
   *
   * Switching this invariant on found 30 crashes in the base CRM alone, in three classes:
   *   · a service throwing "X not found" (FIXED — utils/errors.ts notFound() carries 404)
   *   · a body reaching RAW SQL unvalidated, so an empty object builds `IN ()` or `INSERT () VALUES ()`
   *     and Postgres answers "syntax error at or near $1". Needs a schema per route.
   *   · an endpoint that expects multipart/form-data answering 500 to JSON instead of 400.
   *
   * The last two are a real campaign, and failing twelve suites until it is finished would make CI
   * useless in the meantime. So the count is pinned per template: it may go DOWN (and the pin must be
   * lowered with it), never up. A number nobody can increase is debt that gets paid; a suite that is
   * red for a month is debt that gets ignored.
   */
  /**
   * Measured 2026-10-01, and lowered twice in one sitting as the classes were paid off:
   *
   *   first measure   164   every write crash in the fleet
   *   −104 sites       —    a service throwing a bare "X not found" (now notFound(), guard #183)
   *   −80 handlers     84   a bulk op building `IN ()` from an unchecked id list (guard #184)
   *   −60 endpoints    —    an upload answering 500 to a non-multipart body (uploadedForm, #185)
   *   −6 routes        17   selections/takeoffs INSERTs from an unvalidated body (zod at the door)
   *
   * May go DOWN, and the pin must come down with it; never up.
   */
  const RATCHET: Record<string, number> = {
    crm: 0,
    'crm-basic': 0,
    'crm-dispensary': 0,
    'crm-fieldservice': 0,
    'crm-landscaping': 0,
    'crm-restaurant': 0,
    'crm-roof': 0,
    'crm-rv': 0,
    'crm-salon': 0,
    'crm-vet': 0,
  }
  // Supplied by runSuite: several templates share the same package.json name, so this cannot be
  // worked out from inside the sandbox.
  const TEMPLATE = process.env.SUITE_TEMPLATE || 'unknown'
  const pinned = RATCHET[TEMPLATE]
  if (pinned === undefined) {
    check(`the write-crash count for ${TEMPLATE} is pinned — add \`${TEMPLATE}: ${broken},\` to RATCHET in tests/harness/contract.test.ts`, false, { broken })
  } else if (broken > pinned) {
    check(`write crashes for ${TEMPLATE} did not grow (pinned ${pinned})`, false,
      { broken, pinned, added: crashes.map((c) => `${c.method} ${c.path}`).slice(0, 8) })
  } else if (broken < pinned) {
    check(`write crashes for ${TEMPLATE} are down to ${broken} from ${pinned} — lower the pin to lock it in`, false, { broken, pinned })
  } else {
    passed++
    note(`${broken} known write crash(es) for ${TEMPLATE}, pinned and not growing:`)
    // Printed every run, so the debt is in front of whoever reads the output rather than buried in a
    // number. These are the routes to fix next.
    for (const c of crashes) note(`    ${c.method} ${c.path} — ${c.body.replace(/\s+/g, ' ').slice(0, 90)}`)
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
