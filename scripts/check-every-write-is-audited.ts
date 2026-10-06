// CI guard: the contractor CRM records every successful write, and the middleware that guarantees it
// stays mounted, stays quiet about the things it must not log, and stays unable to break a request.
//
// Measured when this was written: of 163 write endpoints in templates/crm, 17 wrote an audit row and
// 146 did not — whole modules with no audit import at all, including draw-schedule approve and
// mark-paid, every bulk action (assign jobs, mark invoices paid, delete quotes, approve time), support
// tickets, selections and call tracking. An audit log covering a tenth of the writes is not a gap in
// the log, it is a log nobody can rely on.
//
// The fix is a floor, not 146 hand-written calls — a 147th endpoint would have been added without one,
// which is how this happened. So what is guarded is the floor:
//
//   1. the middleware exists and is mounted with app.use('*', …), so no route can be outside it;
//   2. it is mounted in the APP, not inside one router, or the modules that need it most are missed;
//   3. it reads the actor AFTER next(), because a middleware above authenticate cannot see who acted;
//   4. it never copies the request BODY into the log — bodies here carry passwords, reset tokens and
//      provider secrets, and the log is read by more people than the data it describes;
//   5. it only logs a 2xx, so refusals from scanners and stale tabs do not bury the real entries;
//   6. and it cannot throw: an audit log that can 500 an invoice is worse than one with gaps.
//
//   bun scripts/check-every-write-is-audited.ts
import { readFileSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const MW = 'templates/crm/backend/src/middleware/auditWrites.ts'
const INDEX = 'templates/crm/backend/src/index.ts'

// ── 1 & 2. mounted, on the app, for everything ────────────────────────────────────────────────────
const index = read(INDEX)
if (!index) fail(`${INDEX} is missing`)
else {
  if (!/import \{ auditWrites \} from '\.\/middleware\/auditWrites\.ts'/.test(index)) {
    fail(`${INDEX} must import auditWrites — without the import the mount below is a crash at boot, not a floor`)
  }
  if (!/app\.use\('\*', auditWrites\)/.test(index)) {
    fail(`${INDEX} must mount it as app.use('*', auditWrites) — anything narrower leaves write endpoints outside the log, which is the fault this closes`)
  }
}

// ── the middleware itself ─────────────────────────────────────────────────────────────────────────
const mw = read(MW)
if (!mw) { fail(`${MW} is missing — the audit floor is gone`); }
else {
  /**
   * 3. The handler runs FIRST, and the actor is read after it.
   *
   * This pinned the literal `await next()` and went red when the middleware began running the request
   * inside an async scope — `await requestAudit.run(scope, next)` — which is the same thing done
   * properly. The rule is the ordering, not the spelling: whatever invokes the handler must be
   * awaited, and `c.get('user')` must come after it, because the route's own authenticate is what
   * puts the user on the context.
   */
  const runAt = mw.search(/await\s+(?:next\(\)|requestAudit\.run\(\s*\w+\s*,\s*next\s*\))/)
  const userAt = mw.indexOf("c.get('user')")
  if (runAt < 0) fail(`${MW} must await the handler — a middleware that answers before it cannot know whether the write succeeded`)
  else if (userAt < 0 || userAt < runAt) {
    fail(`${MW} must read the user AFTER the handler has run, or every write is recorded as nobody`)
  }

  /**
   * 4. One row per write. The floor must stand down when a handler has already logged.
   *
   * The first version wrote its row unconditionally, so every payment and every settings change
   * appeared twice — once with the amount and the field diff, once as "update · via request". The
   * handler's entry is always the better one.
   */
  if (!/requestAudit\.run\(/.test(mw)) {
    fail(`${MW} must run the request inside requestAudit so it can tell whether a handler already logged it`)
  }
  if (!/scope\.logged/.test(mw)) {
    fail(`${MW} must skip its own row when the request has already been logged — a floor that files a second copy of a richer entry is noise in the one place that has to stay readable`)
  }
  const audit = read('templates/crm/backend/src/services/audit.ts')
  if (!/requestAudit\.getStore\(\)/.test(audit)) {
    fail('services/audit.ts must mark the request scope when it writes, or the middleware cannot know a handler logged')
  }

  // 4. the body never reaches the log.
  for (const forbidden of ['c.req.json()', 'req.parseBody', 'await c.req.text()']) {
    if (mw.includes(forbidden)) {
      fail(`${MW} reads the request body (${forbidden}) — bodies here carry passwords, reset tokens and provider secrets, and must not be copied into a log that more people can read`)
    }
  }
  if (!/NOT the request body/i.test(mw)) {
    fail(`${MW} must record WHY the body is left out, or the next person adds it as an improvement`)
  }

  // 5. only what actually happened.
  if (!/status < 200 \|\| status >= 300/.test(mw)) {
    fail(`${MW} must log only a 2xx — a refused write is the gate working, and logging 401/403/404 fills the log with scanner noise`)
  }

  // 6. it cannot take the request down with it.
  if (!/catch\s*\(/.test(mw)) {
    fail(`${MW} must wrap its write in try/catch — an audit log that can 500 an invoice is worse than one with gaps`)
  }

  // The skips, each of which exists for a reason worth keeping.
  for (const [needle, why] of [
    ['/api/auth', 'credentials in the body, and auth records its own events'],
    ['webhook', 'unauthenticated provider callbacks with no actor and no company'],
    ['/api/internal', 'factory sync, not a person'],
    ['/api/audit', 'reading the log is not a change'],
  ] as [string, string][]) {
    if (!mw.includes(needle)) fail(`${MW} must skip ${needle} — ${why}`)
  }
}

// ── and the measurement that started it, so the floor's value is not forgotten ────────────────────
// Not a threshold on hand-written calls: the floor covers everything, so counting them would only
// punish a module for relying on it. What is checked is that the handlers which DO write their own
// richer entry — the ones with a field-level diff — still do, because the generic row is a floor and
// not a replacement.
const RICHER = [
  ['templates/crm/backend/src/routes/changeOrders.ts', 'a change order moves the contract value'],
  ['templates/crm/backend/src/routes/contacts.ts', 'the customer record'],
]
for (const [p, what] of RICHER) {
  const src = read(p)
  if (!src) { fail(`${p} is missing`); continue }
  if (!/audit/.test(src)) fail(`${p} no longer writes its own audit entry — ${what} deserves more than the generic floor row`)
}

if (failed) { console.error(`\nevery write is audited: ${failed} check(s) FAILED`); process.exit(1) }
console.log('every write is audited: the contractor CRM logs every successful write, skips reads, refusals and webhooks, and cannot be broken by its own log')
