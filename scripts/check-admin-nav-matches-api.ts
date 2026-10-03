// CI guard: a sidebar entry whose API requires a RANK declares that rank.
//
// "Pages that load a 403. Email is in the manager (and staff) sidebar but fails with 'Failed to
//  load: 403' on Roofing, Landscaping, RV, Vet and Events. Google Reviews (gbp/status 403, yet a
//  Connect button) and Settings (company/users 403) fail in the background." — T41, fleet summary
//
// check-nav-permission-gates.ts already covers the PERMISSION question: a page whose list route asks
// for `invoices:read` must say so on its nav item. It cannot cover these two, because the routers
// behind them do not ask a permission at all — they are mounted `authenticate, requireAdmin`, a rank.
// So the menu offered them to every rung, and only the API said no.
//
// The rule, in both directions, because each half is a different bug:
//
//   - a router mounted requireAdmin ⇒ its nav entry must declare minRole admin (or owner).
//     Otherwise staff are shown a link that only ever 403s.
//   - a router NOT mounted requireAdmin ⇒ its nav entry must NOT declare admin.
//     Otherwise a rung the server serves happily cannot reach the page — the mistake Salon T28 M5
//     made in the other direction, hiding Invoices from `viewer`, who holds invoices:read.
//
// Nothing here is a judgement about which rung ought to own these pages. The server's own mounting is
// read out of each template's route file; the guard only insists the menu agrees with it. Change the
// server and this guard tells you which nav entries to change with it.
//
//   bun scripts/check-admin-nav-matches-api.ts
import { readFileSync, existsSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return null } }

let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

/**
 * Sidebar route → the backend router it opens, per template. Only routes whose router is gated by
 * RANK belong here; everything else is check-nav-permission-gates.ts's job.
 */
const PAGE_ROUTER: Record<string, string> = {
  '/crm/email': 'backend/src/routes/inboundMessages.ts',
  '/crm/google-reviews': 'backend/src/routes/gbp.ts',
}

/** Templates whose sidebar comes from the shared shell's shellConfig.ts. */
const SHELL_TEMPLATES = [
  'crm', 'crm-basic', 'crm-fieldservice', 'crm-landscaping',
  'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet',
]
/**
 * crm-roof does not use the shared shell: its nav is three arrays in
 * components/layout/AppLayout.tsx and its URL gate is a RoleRoute in App.tsx. Same rule, read from
 * the two places roof keeps it. (crm-dispensary has its own AppLayout too and is listed here for the
 * same reason; crm-homecare is parked and crm-store has no CRM sidebar.)
 */
const LAYOUT_TEMPLATES = ['crm-roof', 'crm-dispensary']

const ADMIN_OR_ABOVE = ['admin', 'owner']

/** Is this router mounted behind a rank check? */
const requiresAdmin = (src: string) =>
  /app\.use\(\s*'\*'\s*,\s*authenticate\s*,\s*require(Admin|Owner)\b/.test(src)

for (const t of [...SHELL_TEMPLATES, ...LAYOUT_TEMPLATES]) {
  for (const [route, routerPath] of Object.entries(PAGE_ROUTER)) {
    const router = read(`templates/${t}/${routerPath}`)
    if (router === null) continue // this vertical does not have the module at all
    const serverWantsAdmin = requiresAdmin(router)

    // Find the nav entry. The shared-shell templates keep it on one line in shellConfig.ts; roof and
    // dispensary keep it on one line in their own AppLayout.
    const navFile = SHELL_TEMPLATES.includes(t)
      ? `templates/${t}/frontend/src/shellConfig.ts`
      : `templates/${t}/frontend/src/components/layout/AppLayout.tsx`
    const nav = read(navFile)
    if (nav === null) { fail(`${t}: ${navFile} not found — this guard's walk is stale, fix the walk`); continue }
    const line = nav.split('\n').find((l) => l.includes(`'${route}'`) && /icon:|to:/.test(l))
    if (!line) continue // no sidebar entry for this page in this vertical

    const declared = line.match(/minRole:\s*'([a-z]+)'/)?.[1]
    const navWantsAdmin = !!declared && ADMIN_OR_ABOVE.includes(declared)

    if (serverWantsAdmin && !navWantsAdmin) {
      fail(`${t}: ${routerPath} is mounted requireAdmin, but the ${route} nav entry declares `
        + `${declared ? `minRole '${declared}'` : 'no minRole'} — staff are shown a link that only 403s.\n`
        + `       ${line.trim().slice(0, 140)}`)
    }
    if (!serverWantsAdmin && navWantsAdmin) {
      fail(`${t}: the ${route} nav entry declares minRole '${declared}', but ${routerPath} does not `
        + `require a rank — a role the server serves cannot reach the page.`)
    }
  }
}

/**
 * roof's URL half. The nav entry hides the link; RoleRoute is what answers a typed address or a
 * bookmark with the dashboard instead of the API's raw 403. Every admin-only page roof routes must be
 * wrapped, so the two sides cannot drift apart. The shared-shell templates need no equivalent check:
 * AppShell's own URL guard reads the SAME `minRole` field the nav entry declares.
 */
{
  const app = read('templates/crm-roof/frontend/src/App.tsx')
  if (app === null) fail('crm-roof/frontend/src/App.tsx not found — fix this guard\'s walk')
  else {
    // path → the component it must be guarding. Each of these four routers is requireAdmin.
    const MUST_WRAP: Record<string, string> = {
      'settings/email': 'EmailAliasesPage',
      'settings/email-domain': 'EmailDomainPage',
      'settings/email-inbox': 'InboundMessagesPage',
      'email': 'InboundMessagesPage',
      'google-reviews': 'GbpReviewsPage',
    }
    if (!/function RoleRoute\b/.test(app)) {
      fail('crm-roof: App.tsx has no RoleRoute — the admin-only pages have no URL gate at all')
    } else {
      for (const [path, component] of Object.entries(MUST_WRAP)) {
        const line = app.split('\n').find((l) => l.includes(`path="${path}"`))
        if (!line) { fail(`crm-roof: no route declared for "${path}" — fix this guard's walk`); continue }
        if (!/<RoleRoute\s+minRole="(admin|owner)"/.test(line)) {
          fail(`crm-roof: the "${path}" route (${component}) is not wrapped in <RoleRoute minRole="admin"> — `
            + `a typed URL gets the API's 403 instead of the dashboard.\n       ${line.trim().slice(0, 140)}`)
        }
      }
    }
  }
}

if (failed) { console.error(`\n${failed} problem(s).`); process.exit(1) }
console.log('ok: every rank-gated page\'s sidebar entry and route declare the rank its API requires')
