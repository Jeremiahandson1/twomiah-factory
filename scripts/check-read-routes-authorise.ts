// CI guard: a module that hands out COMPANY MONEY has to check the matrix on its reads, not only its
// writes.
//
// check-write-routes-authorise.ts already insists that a write authorises. T32 H1 found the other
// half: every write in accounts payable, purchase orders, bids, change orders, selections, takeoffs
// and payroll was gated on its resource, and every GET in all seven sat on `authenticate` alone. So
// a field technician signed in and read what the company owes, what it has committed to vendors,
// what it bid and won, its contract-value changes, its client allowances, its material costs, and
// GET /api/payroll/summary — every employee's hours and pay, the owner's included. A read-only
// `viewer` read the same. Every write answered 403, correctly, which is what made it look fine.
//
// Authentication answers "who are you". Authorisation answers "may you". A module that gates one
// direction and not the other reads as guarded in review, because there IS a guard on the file.
//
// WHY A LIST AND NOT A RULE OVER EVERY MODULE
// -------------------------------------------
// Because "may a technician read this" is a real judgement and the wrong answer is expensive in both
// directions. A leak is bad; a refusal that stops somebody doing their job is worse, and the fleet
// has already been through that once — see `a-refusal-can-be-the-bug`. So the modules that MUST gate
// their reads are named here, and the ones deliberately left open are named underneath with the
// reason, which is the part that stops the next person reopening the argument from scratch.
//
//   bun scripts/check-read-routes-authorise.ts
import { readFileSync, readdirSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return null } }
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

let failed = 0, checked = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

/**
 * Module file name (under a template's src/routes) → the resource its reads must be gated on.
 *
 * The resource is the one the module's own WRITES already use, so nothing new is invented and the
 * matrix is not widened — the reads simply start asking the question the writes were already asking.
 */
const MUST_GATE_READS: Record<string, string> = {
  'bills.ts': 'bills',
  'purchaseOrders.ts': 'purchase-orders',
  'bids.ts': 'bids',
  'changeOrders.ts': 'change-orders',
  'selections.ts': 'selections',
  'takeoffs.ts': 'takeoffs',
  'payroll.ts': 'payroll',
}

/**
 * Modules whose reads are open ON PURPOSE. Each line is a decision, not an omission.
 *
 *   pricebook   — in crm-fieldservice this IS the technician's flat-rate book and is how they price
 *                 a job on site. The PRICE is theirs; `cost` and `margin` are withheld in the
 *                 response instead (see createPricebookRoutes' `carriesCost`).
 *   equipment   — customer-asset tracking. No money on the record, and a technician servicing a
 *                 customer's unit needs it. The maintenance history is tenant-scoped (it was not).
 *   team        — `team:read` is the roster: who works here. `hourlyRate` is withheld from anyone
 *                 without `payroll:read`, because what somebody earns is a different question.
 *   dashboard   — the counts are the work. The quote pipeline value and the invoice figures are
 *                 withheld per-permission, and the KEYS are dropped rather than zeroed so a screen
 *                 can tell "not allowed" from "nothing yet".
 *   inventory, fleet, warranties, agreements, calltracking — operational, no company money on the
 *                 read, and all five are things somebody in the field is doing the work with.
 */
const OPEN_ON_PURPOSE = new Set(['pricebook.ts', 'equipment.ts', 'team.ts', 'dashboard.ts', 'inventory.ts', 'fleet.ts', 'warranties.ts', 'agreements.ts', 'callTracking.ts'])

// ---------------------------------------------------------------- the matrix, read not copied
const permSrc = read('packages/tenant-backend/src/auth/permissions.ts')
if (!permSrc) { console.error('FAIL: cannot read the shared permission matrix'); process.exit(1) }
const matrixResources = new Set(
  [...stripComments(permSrc.slice(permSrc.indexOf('BASE_ROLE_PERMISSIONS'))).matchAll(/'([a-z-]+):[a-z*]+'/g)].map((m) => m[1]),
)

let templates: string[] = []
try { templates = readdirSync(ROOT + 'templates') } catch { templates = [] }

for (const [file, resource] of Object.entries(MUST_GATE_READS)) {
  // A gate on a resource the matrix does not carry refuses everyone but the owner — the exact trap
  // check-permission-vocabulary.ts exists for, and worth catching here too since this guard is what
  // tells somebody to add the gate.
  if (!matrixResources.has(resource)) {
    fail(`${file} is required to gate its reads on '${resource}:read', but '${resource}' is not a resource in BASE_ROLE_PERMISSIONS — that gate would refuse every role except owner`)
    continue
  }

  for (const t of templates) {
    const rel = `templates/${t}/backend/src/routes/${file}`
    const raw = read(rel)
    if (!raw) continue // this vertical does not ship the module
    checked++
    const src = stripComments(raw)

    const mount = src.search(new RegExp(`app\\.use\\('\\*',[^)]*requirePermission\\('${resource}:read'\\)`))
    const firstRoute = src.search(/^app\.(get|post|put|delete|patch)\(/m)

    /**
     * A blanket RANK gate on the mount also closes the door, and more tightly than the permission
     * would — `requireAdmin` admits admin and owner, where `payroll:read` also admits manager. So it
     * counts as authorised and this guard says nothing about it.
     *
     * It is not the mechanism to copy (see `rank-is-not-permission`: a rank answers a different
     * question and `viewer` outranks nobody while holding real read rights). The one module in this
     * state is crm-homecare's payroll, which is PARKED — changing a parked vertical's auth to make a
     * new guard tidier is the kind of edit that breaks something nobody is watching.
     */
    const rankMount = src.search(/app\.use\('\*',[^)]*(requireAdmin|requireRole\('(admin|owner)'\))/)
    if (mount < 0 && rankMount >= 0 && (firstRoute < 0 || rankMount < firstRoute)) continue

    if (mount < 0) {
      // A per-handler gate on every GET is just as good — what is not acceptable is a bare GET.
      const bare = src.split('\n').filter((l) => /^app\.get\(/.test(l) && !/requirePermission\(/.test(l))
      if (bare.length) {
        fail(`${rel}: ${bare.length} GET route(s) carry no permission check, and this module hands out company money. Gate the mount — app.use('*', requirePermission('${resource}:read')) — above the routes, so the next GET added here is gated by construction. First: ${bare[0].slice(0, 90)}`)
      }
      continue
    }

    // Middleware order IS the gate: a Hono app.use below its routes never runs for them.
    if (firstRoute >= 0 && mount > firstRoute) {
      fail(`${rel}: the read gate is declared AFTER the first route, so Hono never runs it for the routes above — move app.use('*', requirePermission('${resource}:read')) above them`)
    }
    // …and it has to sit below authenticate, or c.get('user') is undefined when it asks for a role.
    const auth = src.search(/app\.use\('\*',[^)]*authenticate/)
    if (auth >= 0 && auth > mount) {
      fail(`${rel}: the read gate runs BEFORE authenticate, so there is no user to check — it will answer 401 for everybody`)
    }
  }
}

// A module named as deliberately open must not quietly be in both lists.
for (const f of OPEN_ON_PURPOSE) {
  if (MUST_GATE_READS[f]) fail(`${f} is in MUST_GATE_READS and in OPEN_ON_PURPOSE — decide which`)
}

console.log(failed
  ? `read route authorisation: ${failed} check(s) FAILED`
  : `read route authorisation: ${checked} money module(s) across the fleet gate their reads, above their routes and below authenticate`)
process.exit(failed ? 1 : 0)
