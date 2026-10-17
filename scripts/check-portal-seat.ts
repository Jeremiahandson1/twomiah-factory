// CI guard: the front page after sign-in offers each seat only what it can open, and reads what its own
// endpoint sends. (Bar Run 2)
//   · Website Manager opens the site's own admin, which is the owner's sign-in. Every portal showed it to a
//     manager and to staff, a door with a refusal behind it. The tile's condition must start with a seat gate.
//   · The bar's Recent Activity read crm-basic's recentJobs / recentQuotes / recentInvoices, keys its
//     /api/dashboard/recent-activity never sends, so a bar with a booked party read "Get started by adding
//     contacts and jobs". It must read the keys that route returns.
//   · The bar's CRM card named "stock" to a bartender with no Stock page. It is built from SHELL.nav, through
//     the same three tests the sidebar runs.
//   bun scripts/check-portal-seat.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// crm-automotive is parked (CLAUDE.md) and is not touched.
const templates = readdirSync(ROOT + 'templates').filter((t) => t.startsWith('crm') && t !== 'crm-automotive')
let tiles = 0
for (const t of templates) {
  const rel = `templates/${t}/frontend/src/pages/CustomerPortal.tsx`
  if (!existsSync(ROOT + rel)) continue
  const src = read(rel)
  let at = src.indexOf('>Website Manager<')
  while (at !== -1) {
    tiles++
    // The JSX condition that renders this tile: the last `{… && (` opening before it.
    const before = src.slice(0, at)
    const conds = [...before.matchAll(/\{([^{}\n]*?&&[^{}\n]*?)&& \(\s*\n\s*<a\b/g)]
    const cond = conds.length ? conds[conds.length - 1][1].trim() : ''
    if (!/^(runsTheCompany|isAdmin) &&/.test(cond + ' &&')) fail(`${t}: the Website Manager tile must start with a seat gate (runsTheCompany / isAdmin), found {${cond} && (`)
    at = src.indexOf('>Website Manager<', at + 1)
  }
}
if (tiles < 10) fail(`expected a Website Manager tile in at least 10 portals, walked ${tiles} — has the tile moved?`)

// Comments stripped: the fix's own explanation names the old keys and the old words.
const bar = read('templates/crm-bar/frontend/src/pages/CustomerPortal.tsx').replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '')
const dash = read('templates/crm-bar/backend/src/routes/dashboard.ts')
if (!bar || !dash) fail('the bar portal or its dashboard route is missing')
for (const k of ['recentJobs', 'recentQuotes', 'recentInvoices']) if (new RegExp(`\\b${k}\\b`).test(bar)) fail(`the bar portal reads ${k}, a key its recent-activity route never sends`)
// Every object the route can answer with (it has two: with and without the money), as a shorthand key.
const route = dash.slice(dash.indexOf("app.get('/recent-activity'"))
const reply = (route.match(/return c\.json\(([^\n]*)\)\n/) || [])[1] || ''
const shapes = reply.match(/\{[^{}]*\}/g) || []
if (shapes.length < 2) fail(`the bar's /recent-activity reply has changed shape (found ${shapes.length} object(s)) — re-read it`)
for (const k of ['upcomingEvents', 'newEnquiries']) {
  if (!new RegExp(`activity\\?\\.${k}\\b`).test(bar)) fail(`the bar portal must read activity?.${k}`)
  for (const s of shapes) if (!new RegExp(`[{,]\\s*${k}\\s*[,}]`).test(s)) fail(`…and every reply of the bar's /recent-activity must send ${k}: ${s}`)
}
if (/contacts and jobs/.test(bar)) fail('the bar portal still says "contacts and jobs"')
if (!/SHELL\.nav\.some\(/.test(bar) || !/\{crmCardText\}/.test(bar)) fail("the bar's CRM card must be built from the seat's own menu (SHELL.nav), not a fixed sentence")
if (/>\s*The register, the grill, the menu and taps, stock/.test(bar)) fail('…and must not be the fixed sentence that named stock to a bartender')
// The card's three tests are the sidebar's (packages/tenant-ui/src/shell/AppShell.tsx), so the two cannot disagree.
for (const [what, re] of [['role', /meetsRole\(user\?\.role, i\.minRole\)/], ['permission', /\(!i\.permission \|\| can\(i\.permission\)\)/], ['feature', /\(!i\.features \|\| i\.features\.some\(\(f\) => hasFeature\(f\)\)\)/]] as const)
  if (!re.test(bar)) fail(`the CRM card must apply the sidebar's ${what} test`)

if (failed) { console.error(`\n${failed} portal check(s) failed`); process.exit(1) }
console.log(`portal seat: ${tiles} Website Manager tiles gated; the bar portal reads its own feed and its own menu`)
