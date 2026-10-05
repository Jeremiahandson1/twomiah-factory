/**
 * GUARD: a crm-roof screen that writes must ask a permission before it offers the control.
 *
 * The roof-specific twin of check-write-controls-ask-permission (which covers the SHARED pages in
 * packages/tenant-ui). Roof forks almost its whole frontend, so none of its own screens are reached
 * by that guard — which is how T42 found twelve ungated write controls on this template after the
 * shared sweep had been done.
 *
 *   "Roofing: twelve write controls are offered to every seat — claim status stepper, Save to
 *    Adjuster Directory, the Scope buttons, editable Claim Info, Settings QuickBooks and Storm
 *    settings, Canvassing scripts, AI Receptionist New Rule, Add Adjuster, New Report, Storm Leads
 *    New; viewer also sees Close Job and Advance Stage."
 *
 * There were fifty-odd, not twelve. The twelve were a sample of one missing habit, and a guard is the
 * only thing that keeps the other forty from coming back one page at a time.
 *
 * WHAT THIS CAN AND CANNOT SEE. It is a static check: it asserts a page that writes also ASKS
 * (useMayWrite / usePermissions / useFeature-and-permission), not that the right control is wrapped
 * in the right answer. Wiring a gate and then not using it would pass here — which is why the
 * behaviour suite asserts the server side and the briefs ask a human to look. Being honest about the
 * ceiling is the point: a guard that claims more than it checks is worse than none.
 *
 * Roof CAN ask: App.tsx mounts `<PermissionsProvider role={…} permissions={permissions}>` and the
 * login answers a permissions array. (A comment in AppLayout.tsx used to say otherwise; it was stale
 * and is corrected.) `useMayWrite` returns `!known || can(…)`, so a page gating on it is safe even
 * where the provider has not loaded — it hides only what it positively knows is refused.
 */
import { readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.argv[2] || process.cwd()
const FE = join(ROOT, 'templates/crm-roof/frontend/src')
let failures = 0
const fail = (msg: string) => { console.log(`FAIL: ${msg}`); failures++ }

/**
 * Screens that write and legitimately ask NOTHING of the permission matrix.
 *   portal/*            the customer's own screens — they authenticate as the contact, not a seat
 *   PortalLogin         ditto
 *   OnboardingWizard    runs before there is a company, let alone a role
 *   contexts/           AuthContext's own login POST
 *   *TrialPage          "ask us about this add-on" — POSTs /api/support/tickets, open to any seat
 *                       by design, because the whole point is that the shop cannot use the module yet
 *   ContactSupportPage  the same, to the platform desk
 */
const EXEMPT = [
  /^pages\/portal\//,
  /^contexts\//,
  /^pages\/OnboardingWizard\.tsx$/,
  /^pages\/\w*TrialPage\.tsx$/,
  /^pages\/support\/ContactSupportPage\.tsx$/,
]

/**
 * Screens that write, are NOT yet gated, and why — each with the permission its routes ask, so the
 * next person has the answer rather than the question. Listed is not excused: these are the
 * remainder of the same sweep, named out loud instead of left to be re-found.
 */
const NOT_SWEPT: Record<string, string> = {
  'pages/ads/AdsPage.tsx':
    'ads:update (approve, request changes, create an experiment). Roof forks the shared Ads page; the shared one is on the same list.',
  'pages/leads/LeadInboxPage.tsx':
    'leads:update to triage and leads:create (or contacts:create) to convert — roof keeps its own copy of a page the shared sweep already gated.',
  'pages/leads/LeadSourcesPage.tsx':
    'leads:update, and the webhook SECRET and the secret-bearing URL must be withheld as well as the controls — the shared copy does both already.',
  'pages/roofing/ImportPage.tsx':
    'admin-by-route: routes/import.ts carries app.use(requireAdmin), so a non-admin gets 403 rather than a wrong answer. Needs the control hidden and the raw "403" text replaced.',
  'pages/settings/EstimatorSettingsPage.tsx':
    'admin-by-route (PUT /api/settings/estimator is requireAdmin). Same two jobs as ImportPage.',
  'pages/EstimatorPage.tsx':
    'estimator:update — the estimator is its own add-on module and its save is ungated on the screen.',
}

function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const s = statSync(p)
    if (s.isDirectory()) { if (e !== 'node_modules' && e !== 'dist') walk(p, out); continue }
    if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const rels = walk(FE).map((p) => p.slice(FE.length + 1).replace(/\\/g, '/')).sort()
if (rels.length < 40) fail(`only ${rels.length} .tsx files found under ${FE} — the walk is broken, not the code`)

const writes: string[] = []
const gated: string[] = []
const ungated: string[] = []

for (const rel of rels) {
  const src = readFileSync(join(FE, rel), 'utf8').replace(/\r\n/g, '\n')
  // Does the screen write? api.post/put/patch/delete, api.request with a method, or a bare fetch
  // whose options name a write method.
  const viaHelper = /\b(?:api|client)\.(?:post|put|patch|delete)\s*\(/.test(src)
  const viaRequest = /\b(?:api|client)\.request\s*\([\s\S]{0,300}?method:\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]/.test(src)
  // `method:` is not always a quoted literal — AdjusterDirectoryPage writes with
  // `method: editId ? 'PUT' : 'POST'`, which a pattern anchored on a quote walks straight past. So
  // match the KEY and then look for a write verb anywhere in the short window after it. (Found by
  // this guard reporting AdjusterDirectoryPage as ungated when it is gated: the page was missing
  // from the writer list entirely, not from the gated list.)
  const viaFetch = [...src.matchAll(/\bfetch\s*\([\s\S]{0,320}?method:\s*([\s\S]{0,60})/gi)]
    .some((m) => /\b(?:POST|PUT|PATCH|DELETE)\b/.test(m[1]))
  if (!viaHelper && !viaRequest && !viaFetch) continue
  if (EXEMPT.some((re) => re.test(rel))) continue
  writes.push(rel)

  const asks = /\buseMayWrite\s*\(/.test(src) || /\busePermissions\s*\(/.test(src) || /\bcfg\.can\s*\(/.test(src)
  if (asks) gated.push(rel)
  else ungated.push(rel)
}

// 1 — every ungated writer must be a named, explained remainder
for (const rel of ungated) {
  if (!(rel in NOT_SWEPT)) {
    fail(
      `${rel} writes to the API and asks no permission. Read the permission off the route in `
      + `templates/crm-roof/backend/src/routes/, gate the control on it with useMayWrite, and gate `
      + `the API side too if it is open. If it genuinely needs nothing, add it to EXEMPT with the reason.`,
    )
  }
}

// 2 — a page that HAS been swept must not reappear on the remainder list
for (const rel of Object.keys(NOT_SWEPT)) {
  if (gated.includes(rel)) {
    fail(`${rel} now asks a permission — remove it from NOT_SWEPT so the list keeps meaning something.`)
  } else if (!rels.includes(rel)) {
    fail(`NOT_SWEPT names ${rel}, which no longer exists. Delete the entry (or fix the path).`)
  }
}

// 3 — and the pages the T42 round gated must keep their gate. Named explicitly: this is the
//     regression lock on that work, and a rename should make somebody think rather than pass.
const MUST_STAY_GATED = [
  'pages/roofing/AdjusterDirectoryPage.tsx',
  'pages/roofing/AIReceptionistPage.tsx',
  'pages/roofing/CanvassingDashboard.tsx',
  'pages/roofing/CanvassingView.tsx',
  'pages/roofing/ContactsPage.tsx',
  'pages/roofing/CrewsPage.tsx',
  'pages/roofing/FinancingPage.tsx',
  'pages/roofing/InsuranceClaimPage.tsx',
  'pages/roofing/InvoicesPage.tsx',
  'pages/roofing/JobDetailPage.tsx',
  'pages/roofing/JobsPage.tsx',
  'pages/roofing/MeasurementsPage.tsx',
  'pages/roofing/PipelineBoard.tsx',
  'pages/roofing/QuotesPage.tsx',
  'pages/roofing/ReviewsPage.tsx',
  'pages/roofing/StormLeadsPage.tsx',
  'pages/roofing/StormRadarPage.tsx',
  'pages/roofReports/MapEdgeEditor.tsx',
  'pages/roofReports/RoofReportsPage.tsx',
  'pages/settings/SettingsPage.tsx',
]
// Read each file directly rather than asking whether it landed in `gated`: that set depends on the
// writer-detection above, so a miss there would report a gated page as a regression. The question
// here is only "does this page still ask?", and the file answers it.
for (const rel of MUST_STAY_GATED) {
  if (!rels.includes(rel)) { fail(`${rel} is gone — if it moved, update this list; if it was deleted, remove the entry.`); continue }
  const src = readFileSync(join(FE, rel), 'utf8')
  if (!/\buseMayWrite\s*\(|\busePermissions\s*\(/.test(src)) {
    fail(`${rel} was gated in T42 and no longer asks any permission. That is a regression.`)
  }
}

// 4 — and every gate must be imported, or it is a runtime crash rather than a gate
for (const rel of gated) {
  const src = readFileSync(join(FE, rel), 'utf8')
  if (/\buseMayWrite\s*\(/.test(src) && !/import\s*\{[^}]*\buseMayWrite\b[^}]*\}\s*from/.test(src)) {
    fail(`${rel} calls useMayWrite without importing it — the page will throw, not gate.`)
  }
  if (/\busePermissions\s*\(/.test(src) && !/import\s*\{[^}]*\busePermissions\b[^}]*\}\s*from/.test(src)) {
    fail(`${rel} calls usePermissions without importing it.`)
  }
}

console.log(
  failures
    ? `\nroof write controls: ${failures} problem(s)`
    : `roof write controls: ok — ${gated.length} of ${writes.length} writing screens ask a permission, `
      + `${ungated.length} named as not-yet-swept, ${rels.length - writes.length} do not write or are exempt`,
)
process.exit(failures ? 1 : 0)
