// CI guard: every feature an industry is offered has a screen in that industry's app (2026-10-22).
//
// Live testers on a contractor found GPS Tracking, Route Optimization, Map View, Consumer Financing, Referral Program,
// Custom Dashboards and Recurring Jobs switched on in Settings › Features with no page anywhere; a home-care agency
// was sold GPS ("/crm/gps — there's no page here"). The registry's templates[] (packages/tenant-backend/src/
// featureRegistry.ts) is what the Factory's signup, its admin and the tenant's Settings › Features all offer, so a
// feature listed there for an industry is a promise to that industry.
//
// For each vertical (apps/unified/verticals/<v>/settings.ts) and each feature its featureSet is offered and may switch on
// (getAdvertisableFeaturesForTemplate — every one but the not-ready), there must be a SURFACE:
//   · an item in that vertical's own menu whose `features` name it — the menu is BUILT, not read: the admin page's
//     shell (apps/unified/web/src/shell.ts SHELL_HERE) is loaded in a browser-like window with the vertical's screen
//     settings, one child process per vertical (each vertical's menu is decided when the module loads);
//   · a Settings page offered for it (the roofer's estimator card), or
//   · one entry in SURFACES below: a page IN THAT VERTICAL'S MENU where the feature lives as a tab, a panel or a
//     behaviour, with the code that does it (a needle in a file, comments stripped). An entry names its page, so it
//     covers only the verticals whose menu has that page — never a blanket.
// A feature with none fails here: build its screen, wire the page that exists, or take the industry off templates[].
//
//   bun scripts/check-unified-feature-has-screen.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dir, '..')
const UNIFIED = join(ROOT, 'apps/unified')

interface MenuItem { to: string; features: string[] }
interface Built { id: string; featureSet: string; screens: any; menu: MenuItem[]; settings: { to: string; feature?: string }[] }

// ── child: build one vertical's menu ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[2] === '--menu') {
  const v = process.argv[3]
  const s: any = (await import(join(UNIFIED, 'verticals', v, 'settings.ts'))).default
  const { Window } = await import('happy-dom')
  const w = new Window({ url: 'https://tenant.test/crm' })
  // The page as the server serves it (server/http/adminScreens.ts): the vertical's screens as JSON in #vertical-screens.
  w.document.body.innerHTML = `<script type="application/json" id="vertical-screens">${JSON.stringify(s.screens || {}).replace(/</g, '\\u003c')}</script>`
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'getComputedStyle']) {
    ;(globalThis as any)[k] = k === 'window' ? w : (w as any)[k]
  }
  const shell = await import(join(UNIFIED, 'web/src/shell.ts'))
  const roof = await import(join(UNIFIED, 'web/src/crm/verticals/roof.tsx'))
  const store = await import(join(UNIFIED, 'web/src/crm/verticals/store.tsx'))
  const built: Built = {
    id: s.id, featureSet: s.featureSet, screens: s.screens || {},
    menu: shell.SHELL_HERE.nav.map((i: any) => ({ to: i.to, features: i.features || [] })),
    settings: [...shell.SETTINGS_SUB_PAGES.map((to: string) => ({ to })), ...roof.SETTINGS_EXTRA, ...store.SETTINGS_EXTRA].map((x: any) => ({ to: x.to, feature: x.feature })),
  }
  process.stdout.write('\n@@MENU@@' + JSON.stringify(built) + '\n')
  process.exit(0)
}

// ── parent ───────────────────────────────────────────────────────────────────────────────────────────────────────────
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

/** Source with comments removed: a rule about what the product does is not satisfied by prose about it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

/**
 * Where a feature lives inside a page rather than as a menu item of its own. `page` must be in the vertical's built menu
 * (or its Settings pages); `needle`, if given, must be in `file` with comments stripped; `when` narrows it by the
 * vertical's settings. Each entry says what the person does there.
 */
const SURFACES: { feature: string; page: string; file?: string; needle?: string; when?: (b: Built) => boolean; what: string }[] = [
  { feature: 'drag_drop_calendar', page: '/crm/schedule', file: 'apps/unified/web/src/crm/screens.tsx', needle: "hasFeature('drag_drop_calendar')", what: 'drag a job to another day on the Schedule' },
  { feature: 'photo_capture', page: '/crm/jobs', file: 'apps/unified/web/src/crm/screens.tsx', needle: "hasFeature('photo_capture')", when: (b) => !!b.screens?.jobs?.photos, what: "the job page's Photos" },
  { feature: 'photo_capture', page: '/crm/jobs', file: 'apps/unified/web/src/crm/pages/roof/jobs/JobDetailPage.tsx', needle: "hasFeature('photo_capture')", when: (b) => b.id === 'roofing', what: "the roofing job page's Photos" },
  // The contractor's job photos are taken in the phone app and filed as documents (GET/POST /api/photos).
  { feature: 'photo_capture', page: '/crm/jobs', file: 'apps/mobile/src/components/PhotoGallery.tsx', needle: '/api/photos/bulk', when: (b) => b.id === 'contractor', what: "the phone app's job photos" },
  { feature: 'online_payments', page: '/crm/settings/integrations', file: 'packages/tenant-ui/src/settings/IntegrationsPage.tsx', needle: '/api/integrations/stripe/connect-url', what: 'connect Stripe in Settings › Integrations; customers pay invoices by card' },
  { feature: 'quickbooks', page: '/crm/settings/integrations', file: 'packages/tenant-ui/src/settings/IntegrationsPage.tsx', needle: '/api/quickbooks', what: 'connect and sync QuickBooks in Settings › Integrations' },
  { feature: 'client_portal', page: '/crm/contacts', file: 'packages/tenant-ui/src/contacts/types.ts', needle: "'client_portal'", when: (b) => b.screens?.contacts?.sections?.portal !== false, what: "the customer's portal panel on a contact" },
  { feature: 'vendor_portal', page: '/crm/bills', file: 'apps/unified/web/src/crm/pages/BillsPage.tsx', needle: 'vendor_portal', what: "bills a vendor sent through the vendor's portal" },
  // '/crm' is the admin's home in every vertical (App.tsx's index route): it opens the dashboard where the feature is on.
  { feature: 'dashboard', page: '/crm', file: 'apps/unified/web/src/screens.tsx', needle: "hasFeature('dashboard') ? '/crm/dashboard'", what: 'the home page after sign-in' },
  { feature: 'pipeline_board', page: '/crm/pipeline', file: 'apps/unified/web/src/crm/pages/roof/jobs/index.tsx', needle: 'path="pipeline"', what: "the roofer's pipeline board" },
  { feature: 'banquet_orders', page: '/crm/events', file: 'apps/unified/web/src/crm/pages/restaurant/EventDetailPage.tsx', needle: "'runsheet'", what: "an event's run of show" },
  { feature: 'event_deposits', page: '/crm/events', file: 'apps/unified/web/src/crm/pages/restaurant/EventDetailPage.tsx', needle: "'money'", what: "an event's payment schedule" },
  { feature: 'deal_desk', page: '/crm/sales-pipeline', file: 'apps/unified/web/src/crm/pages/rv/SalesPipelinePage.tsx', needle: "hasFeature('deal_desk')", what: 'structure a deal from the pipeline' },
  { feature: 'recall_lookup', page: '/crm/units', file: 'apps/unified/web/src/crm/pages/rv/InventoryPage.tsx', needle: "hasFeature('recall_lookup')", what: "a unit's open-recall check" },
  { feature: 'inventory_syndication', page: '/crm/units', file: 'apps/unified/web/src/crm/pages/rv/InventoryPage.tsx', needle: "hasFeature('inventory_syndication')", what: 'push units to the marketplaces' },
  { feature: 'trade_in', page: '/crm/ai-trade', file: 'apps/unified/web/src/crm/pages/rv/AITradeAppraisalPage.tsx', needle: '/api/ai-trade', what: 'appraise a trade' },
  { feature: 'service_status_texts', page: '/crm/service', file: 'apps/unified/server/crm/rv/repairOrders.ts', needle: 'RO_STATUS_TEXT[body.status]', what: 'the customer is texted as a repair order moves' },
  { feature: 'medical_records', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: "'visits'", what: "a patient's visits (SOAP notes)" },
  { feature: 'vaccinations', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: "'vaccinations'", what: "a patient's vaccinations" },
  { feature: 'lab_results', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: "'labs'", what: "a patient's lab results" },
  { feature: 'rabies_certificates', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: '/api/reminders/rabies/', what: 'print a rabies certificate' },
  { feature: 'prescriptions', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: "'prescriptions'", what: "a patient's prescriptions" },
  // The store's and the agency's own pages carry no feature gate (each is that industry's only app); the core features
  // they were sold under live at these addresses.
  { feature: 'contacts', page: '/crm/customers', when: (b) => b.id === 'store', what: "the store's customers" },
  { feature: 'products', page: '/crm/products', when: (b) => b.id === 'store', what: "the store's catalogue" },
  { feature: 'orders', page: '/crm/orders', when: (b) => b.id === 'store', what: "the store's orders" },
  { feature: 'contacts', page: '/crm/clients', when: (b) => b.id === 'homecare', what: "the agency's clients" },
  { feature: 'scheduling', page: '/crm/scheduling', when: (b) => b.id === 'homecare', what: "the agency's schedule hub" },
  { feature: 'team', page: '/crm/caregivers', when: (b) => b.id === 'homecare', what: "the agency's caregivers" },
]

const { getAdvertisableFeaturesForTemplate } = await import(join(ROOT, 'packages/tenant-backend/src/featureRegistry.ts'))

// The anchors themselves: a renamed tab or a removed call must fail here, not leave the entry vouching for nothing.
for (const e of SURFACES) {
  if (!e.file) continue
  const path = join(ROOT, e.file)
  if (!existsSync(path)) { fail(`SURFACES: ${e.feature} names ${e.file}, which does not exist`); continue }
  if (e.needle && !code(readFileSync(path, 'utf8')).includes(e.needle)) fail(`SURFACES: ${e.feature} — ${e.file} no longer has ${e.needle} (${e.what})`)
}

const verticals = readdirSync(join(UNIFIED, 'verticals')).filter((v) => existsSync(join(UNIFIED, 'verticals', v, 'settings.ts')))
if (verticals.length < 10) fail(`only ${verticals.length} verticals under apps/unified/verticals — fix this guard's walk`)

const table: string[] = []
for (const v of verticals) {
  const r = spawnSync(process.execPath, [import.meta.path, '--menu', v], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 })
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@MENU@@'))
  if (r.status !== 0 || !line) { fail(`${v}: its menu could not be built — ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`); continue }
  const b: Built = JSON.parse(line.slice('@@MENU@@'.length))
  if (b.menu.length < 10) { fail(`${v}: only ${b.menu.length} menu items were built — fix this guard`); continue }
  const pages = new Set(['/crm', ...b.menu.map((i) => i.to), ...b.settings.map((s) => s.to)])
  const offered: { id: string }[] = getAdvertisableFeaturesForTemplate(b.featureSet)
  if (!offered.length) { fail(`${v}: featureSet ${b.featureSet} is offered nothing`); continue }
  const missing: string[] = []
  for (const { id } of offered) {
    const inMenu = b.menu.some((i) => i.features.includes(id))
    const inSettings = b.settings.some((s) => s.feature === id)
    const inPage = SURFACES.some((e) => e.feature === id && pages.has(e.page) && (!e.when || e.when(b)))
    if (!inMenu && !inSettings && !inPage) missing.push(id)
  }
  for (const id of missing) fail(`${v} (${b.featureSet}) is offered "${id}" and has no screen for it: no menu item, Settings page or SURFACES entry — build it, wire the page that exists, or take ${b.featureSet} off its templates[] in packages/tenant-backend/src/featureRegistry.ts`)
  table.push(`${v.padEnd(13)} ${String(offered.length).padStart(3)} offered, ${missing.length} without a screen`)
}

console.log(table.join('\n'))
if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1) }
console.log('\nOK — every feature an industry is offered has a screen in its app')
