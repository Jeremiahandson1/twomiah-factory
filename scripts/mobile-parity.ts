#!/usr/bin/env bun
// The phone-app parity map: EVERY desktop menu item of every trade the phone serves, what the phone has for it today, and
// the phase it is planned in. Writes docs/mobile/PARITY.md. Re-run it whenever a menu, a permission or a phone screen changes:
//
//   bun scripts/mobile-parity.ts            write docs/mobile/PARITY.md
//   bun scripts/mobile-parity.ts --check    fail (exit 1) when the file is not what the code now says
//   bun scripts/mobile-parity.ts --json     print the rows (tests/mobile/parity-map.test.ts reads these)
//
// Nothing about the desktop is typed here. The menu is BUILT by the desktop's own code (apps/unified/web/src/shell.ts, one
// child process per trade, because each trade's menu is decided when the module loads — the technique of
// scripts/check-unified-feature-has-screen.ts), then filtered the way the desktop shell filters it:
//   · the trade's switches — an item is in the menu when it has no `features`, or any of its features is one the trade's
//     template offers (packages/tenant-backend/src/featureRegistry.ts; not-ready features are never offered);
//   · the trade's own hidden pages (the shell's routeAbsent);
//   · the seat — owner, admin, manager, staff (the field rung), viewer — through the SAME functions the desktop uses:
//     BASE_ROLE_PERMISSIONS (+ the trade's extra / withheld permissions from apps/unified/verticals/<trade>/settings.ts)
//     and maySeeRoute (packages/tenant-ui/src/shell/types.ts: minRole, routeRoles, permission, routePermissions).
// What IS written by hand below, and only here: PHONE_HAS (what the phone has today — each entry names the file that
// proves it, and the script fails when that file is gone) and PHASE_RULES (the plan). Both are data the owner reviews.
//
// The dashboard tiles per seat come from the desktop dashboards' own rules; TILE_RULES copies each rule with an anchor into
// the source file that the script checks, so a changed rule fails the run instead of leaving a stale map.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const UNIFIED = join(ROOT, 'apps/unified')
const OUT = join(ROOT, 'docs/mobile/PARITY.md')

/** The trades the phone serves: the phone's vertical id, the apps/unified/verticals folder, the registry's template. */
export const TRADES = [
  { phone: 'contractor', dir: 'contractor', label: 'Contractor' },
  { phone: 'basic', dir: 'basic', label: 'Basic (general service business)' },
  { phone: 'fieldservice', dir: 'fieldservice', label: 'Field service' },
  { phone: 'landscaping', dir: 'landscaping', label: 'Landscaping' },
  { phone: 'roofing', dir: 'roof', label: 'Roofing' },
  { phone: 'homecare', dir: 'homecare', label: 'Home care' },
  { phone: 'rv', dir: 'rv', label: 'RV / powersports dealership' },
] as const
export type Trade = (typeof TRADES)[number]

export const SEATS = [
  { id: 'owner', name: 'owner', short: 'O' },
  { id: 'admin', name: 'admin', short: 'A' },
  { id: 'manager', name: 'manager', short: 'M' },
  { id: 'field', name: 'staff', short: 'S' },
  { id: 'viewer', name: 'viewer', short: 'V' },
] as const

interface RawItem { section: string; label: string; to: string; permission: string | string[] | null; minRole: string | null; features: string[]; external: boolean }
interface Built {
  featureSet: string
  nav: RawItem[]
  routeRoles: Record<string, string>
  routePermissions: Record<string, string | string[]>
  routeAbsent: string[]
  extraRolePermissions: Record<string, string[]>
  withheldRolePermissions: Record<string, string[]>
}

// ── child: build one trade's menu with the desktop's own code ─────────────────────────────────────────────────────────
if (process.argv[2] === '--menu') {
  const dir = process.argv[3]
  const s: any = (await import(join(UNIFIED, 'verticals', dir, 'settings.ts'))).default
  const { Window } = await import('happy-dom')
  const w = new Window({ url: 'https://tenant.test/crm' })
  // The page as the server serves it: the trade's screens as JSON in #vertical-screens (server/http/adminScreens.ts).
  w.document.body.innerHTML = `<script type="application/json" id="vertical-screens">${JSON.stringify(s.screens || {}).replace(/</g, '\\u003c')}</script>`
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'getComputedStyle']) {
    ;(globalThis as any)[k] = k === 'window' ? w : (w as any)[k]
  }
  const shell = await import(join(UNIFIED, 'web/src/shell.ts'))
  const H = shell.SHELL_HERE
  let section = ''
  const built: Built = {
    featureSet: s.featureSet,
    // The shell prints a section header above the first item of each group, so a later item inherits the last header.
    nav: H.nav.map((i: any) => ({
      section: (section = i.section || section), label: i.label, to: i.to, permission: i.permission ?? null, minRole: i.minRole ?? null,
      features: i.features || [], external: !!i.external,
    })),
    routeRoles: H.routeRoles || {},
    routePermissions: H.routePermissions || {},
    routeAbsent: H.routeAbsent || [],
    extraRolePermissions: s.extraRolePermissions || {},
    withheldRolePermissions: s.withheldRolePermissions || {},
  }
  process.stdout.write('\n@@MENU@@' + JSON.stringify(built) + '\n')
  process.exit(0)
}

// ── what the phone has today ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * One entry per desktop address the phone covers (all trades listed in `trades`; none = every trade that shows the item).
 * `file`s are under apps/mobile and must exist. `how`: 'tab' (bottom bar), 'screen' (opened from another screen),
 * 'partial' (part of the page only). Anything not listed here is "none".
 */
export interface PhoneHas { paths: string[]; trades?: string[]; how: 'tab' | 'screen' | 'partial'; what: string; files: string[] }
export const PHONE_HAS: PhoneHas[] = [
  { paths: ['/crm/dashboard'], trades: ['contractor', 'basic', 'fieldservice', 'landscaping', 'rv'], how: 'tab', what: 'Dashboard tab: fixed stat cards, not tappable', files: ['app/(tabs)/dashboard.tsx'] },
  { paths: ['/crm/dashboard'], trades: ['homecare'], how: 'tab', what: 'Today tab (the caregiver\'s day); no office overview', files: ['app/(tabs)/shifts.tsx'] },
  { paths: ['/crm/pipeline'], trades: ['roofing'], how: 'tab', what: 'Pipeline tab (stage list)', files: ['app/(tabs)/pipeline.tsx'] },
  { paths: ['/crm/jobs'], trades: ['contractor', 'basic', 'landscaping', 'roofing'], how: 'tab', what: 'Jobs tab + job detail + new/edit job form', files: ['app/(tabs)/jobs.tsx', 'app/(details)/job/[id].tsx', 'app/(details)/job/form.tsx'] },
  { paths: ['/crm/jobs'], trades: ['fieldservice'], how: 'tab', what: 'Service Calls tab + job detail + form', files: ['app/(tabs)/service-calls.tsx', 'app/(details)/job/[id].tsx', 'app/(details)/job/form.tsx'] },
  { paths: ['/crm/contacts'], trades: ['contractor', 'basic', 'fieldservice', 'landscaping', 'roofing', 'rv'], how: 'tab', what: 'Contacts tab + contact detail + form', files: ['app/(tabs)/contacts.tsx', 'app/(details)/contact/[id].tsx', 'app/(details)/contact/form.tsx'] },
  { paths: ['/crm/quotes'], trades: ['contractor', 'basic'], how: 'tab', what: 'Quotes tab + quote detail + form', files: ['app/(tabs)/quotes.tsx', 'app/(details)/quote/[id].tsx', 'app/(details)/quote/form.tsx'] },
  { paths: ['/crm/quotes'], trades: ['fieldservice', 'landscaping', 'roofing'], how: 'partial', what: 'Quote detail and form open from a contact or job; no quotes list', files: ['app/(details)/quote/[id].tsx', 'app/(details)/quote/form.tsx'] },
  { paths: ['/crm/invoices'], how: 'partial', what: 'Invoice detail opens from a contact, job or quote; no invoices list, no payment', files: ['app/(details)/invoice/[id].tsx'] },
  { paths: ['/crm/schedule'], trades: ['fieldservice', 'landscaping'], how: 'tab', what: 'Schedule tab', files: ['app/(tabs)/schedule.tsx'] },
  { paths: ['/crm/schedule'], trades: ['homecare'], how: 'tab', what: 'Schedule tab (two weeks: swap, move, miss)', files: ['app/(tabs)/care-schedule.tsx'] },
  { paths: ['/crm/leads', '/crm/new-leads'], how: 'partial', what: 'Lead detail and quick-add exist; no leads list and no way in except a push alert', files: ['app/(details)/lead/[id].tsx', 'app/(details)/lead/quick-add.tsx'] },
  { paths: ['/crm/canvassing'], trades: ['roofing'], how: 'tab', what: 'Canvass tab (door-to-door)', files: ['app/(tabs)/canvass.tsx'] },
  { paths: ['/crm/time'], trades: ['homecare'], how: 'tab', what: 'Clock tab (clock in/out, open visit)', files: ['app/(tabs)/time-clock.tsx'] },
  { paths: ['/crm/messages'], trades: ['homecare'], how: 'tab', what: 'Messages tab + thread + compose', files: ['app/(tabs)/messages.tsx', 'app/(care)/thread/[id].tsx', 'app/(care)/compose.tsx'] },
  { paths: ['/crm/units'], trades: ['rv'], how: 'tab', what: 'Inventory tab + unit detail', files: ['app/(tabs)/units.tsx', 'app/(details)/unit/[id].tsx'] },
  { paths: ['/crm/parts-catalog', '/crm/parts'], trades: ['rv'], how: 'tab', what: 'Parts tab (sample catalogue)', files: ['app/(tabs)/parts.tsx'] },
  { paths: ['/crm/ai-trade'], trades: ['rv'], how: 'tab', what: 'Trade tab (appraisal)', files: ['app/(tabs)/ai-trade.tsx'] },
  { paths: ['/crm/desking'], trades: ['rv'], how: 'screen', what: 'Deal worksheet', files: ['app/(details)/deal/worksheet.tsx'] },
  { paths: ['/crm/fi'], trades: ['rv'], how: 'screen', what: 'F&I screen', files: ['app/(details)/deal/fi.tsx'] },
  { paths: ['/crm/clients'], trades: ['homecare'], how: 'screen', what: 'My clients (More) + client detail — the caregiver\'s own clients', files: ['app/(care)/clients.tsx', 'app/(care)/client/[id].tsx'] },
  { paths: ['/crm/open-shifts'], trades: ['homecare'], how: 'screen', what: 'Open shifts (More)', files: ['app/(care)/open-shifts.tsx'] },
  { paths: ['/crm/incidents', '/crm/incident-reporting'], trades: ['homecare'], how: 'screen', what: 'Report an incident (More)', files: ['app/(care)/incident.tsx'] },
  { paths: ['/crm/documents'], trades: ['homecare'], how: 'screen', what: 'Documents to sign (More)', files: ['app/(care)/documents.tsx'] },
  { paths: ['/crm/notifications', '/crm/notification-center'], trades: ['homecare'], how: 'screen', what: 'Notifications (More)', files: ['app/(care)/notifications.tsx'] },
]

// ── the plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Phase = 'A' | 'B' | 'C' | 'D'
export interface PhaseRule { paths: string[]; phase: Phase; why: string }
/**
 * Phase A is daily field and office work; B is the construction/estimating set; C is everything else that works on a phone;
 * D is "desktop only", each with its one-line reason. First matching rule wins; a path no rule names is C.
 */
export const PHASE_RULES: PhaseRule[] = [
  // A — daily field and office work
  { paths: ['/crm/dashboard', '/crm/pipeline'], phase: 'A', why: 'the home screen' },
  { paths: ['/crm/leads', '/crm/new-leads'], phase: 'A', why: 'leads are answered from the phone' },
  { paths: ['/crm/jobs', '/crm/dispatch', '/crm/schedule', '/crm/recurring-routes'], phase: 'A', why: 'the day\'s work' },
  { paths: ['/crm/contacts', '/crm/clients'], phase: 'A', why: 'who the work is for' },
  { paths: ['/crm/quotes', '/crm/invoices'], phase: 'A', why: 'quote on site, take payment on site' },
  { paths: ['/crm/time'], phase: 'A', why: 'time clock' },
  { paths: ['/crm/messages'], phase: 'A', why: 'texting customers' },
  { paths: ['/crm/shifts', '/crm/scheduling', '/crm/live-board', '/crm/open-shifts', '/crm/visit-docs', '/crm/time-tracking', '/crm/evv', '/crm/no-show-alerts', '/crm/emergency-coverage'], phase: 'A', why: 'home care visits and shifts' },
  { paths: ['/crm/canvassing'], phase: 'A', why: 'door-to-door, already on the phone' },
  // B — projects and estimating
  { paths: ['/crm/projects', '/crm/bids', '/crm/change-orders', '/crm/daily-logs', '/crm/punch-lists', '/crm/inspections', '/crm/pricebook', '/crm/pricebook-rates', '/crm/reports', '/crm/job-costing'], phase: 'B', why: 'projects, bids and the price book' },
  // D — desktop only
  { paths: ['/crm/tech'], phase: 'D', why: 'this IS the phone-sized field view; the app replaces it' },
  { paths: ['/crm/website', '/crm/website/pages', '/crm/website/photos', '/crm/website/blog', '/crm/website/portfolio', '/crm/website/settings', '/crm/domain'], phase: 'D', why: 'building the public website is a desk job' },
  { paths: ['/crm/audit', '/crm/geofences', '/crm/locations', '/crm/email', '/crm/google-reviews', '/crm/ai-receptionist', '/crm/call-tracking', '/crm/ads', '/crm/marketing'], phase: 'D', why: 'set-up and review screens for the owner at a desk' },
  { paths: ['/crm/gantt', '/crm/takeoffs', '/crm/aia-forms', '/crm/visualizer', '/crm/storm-radar', '/crm/estimator', '/crm/roof-reports', '/crm/measurements'], phase: 'D', why: 'needs a large canvas (chart, plan or map) or is an add-on' },
  { paths: ['/crm/help', '/crm/contact-support'], phase: 'D', why: 'a link out is enough' },
  { paths: ['/crm/lead-sources'], phase: 'D', why: 'connecting lead sources is a set-up task' },
  { paths: ['/crm/users', '/crm/agency-features', '/crm/integrations', '/crm/form-builder', '/crm/login-activity', '/crm/audit-logs'], phase: 'D', why: 'account and set-up administration' },
  { paths: ['/crm/billing-import', '/crm/billing-engine', '/crm/payers-service-codes', '/crm/portal-claim-days', '/crm/claims', '/crm/authorizations', '/crm/payroll', '/crm/company-optimizer', '/crm/route-optimizer'], phase: 'D', why: 'bulk billing, payroll and optimiser runs need a full-size table' },
]
export const phaseOf = (path: string): { phase: Phase; why: string } => {
  const r = PHASE_RULES.find((x) => x.paths.includes(path))
  return r ? { phase: r.phase, why: r.why } : { phase: 'C', why: '' }
}

// ── the desktop dashboards' tile rules ───────────────────────────────────────────────────────────────────────────────
/**
 * Each tile of each desktop dashboard: its label, where it opens, the permission the desktop asks, and an anchor — text that
 * must still be in the source file, so a changed rule fails this script instead of leaving the map stale.
 */
interface Tile { label: string; opens: string; permission?: string; feature?: string; file: string; needle: string }
const JOBS_DASH = 'packages/tenant-ui/src/reporting/JobsDashboardPage.tsx'
const HOME_OFFICE = 'apps/unified/web/src/crm/pages/homecare/office/OfficeHome.tsx'
const ROOF_BOARD = 'apps/unified/web/src/crm/pages/roof/jobs/PipelineBoard.tsx'
export const JOBS_TILES: Tile[] = [
  { label: 'New leads', opens: '/crm/new-leads', permission: 'leads:read', file: JOBS_DASH, needle: "link: '/crm/new-leads'" },
  { label: 'Active projects', opens: '/crm/projects', feature: 'projects', file: JOBS_DASH, needle: "link: '/crm/projects'" },
  { label: '<Jobs> today', opens: '/crm/jobs', file: JOBS_DASH, needle: 'today' },
  { label: 'Pending quotes', opens: '/crm/quotes', permission: 'quotes:read', file: JOBS_DASH, needle: "const maySeeQuotes = can('quotes:read')" },
  { label: 'Open invoices', opens: '/crm/invoices', permission: 'invoices:read', file: JOBS_DASH, needle: "const maySeeInvoices = can('invoices:read')" },
  { label: 'Outstanding', opens: '/crm/invoices', permission: 'invoices:read', file: JOBS_DASH, needle: "label: 'Outstanding'" },
]
export const HOMECARE_OFFICE_TILES: Tile[] = [
  { label: 'Active clients', opens: '/crm/clients', permission: 'care-office:read|care-billing:read', file: HOME_OFFICE, needle: 'const seesCounts = seesMoney || can(\'care-office:read\')' },
  { label: 'Active caregivers', opens: '/crm/caregivers', permission: 'care-office:read|care-billing:read', file: HOME_OFFICE, needle: '<h3>Active Caregivers</h3>' },
  { label: 'Pending invoices', opens: '/crm/billing', permission: 'care-billing:read', file: HOME_OFFICE, needle: '<h3>Pending Invoices</h3>' },
  { label: 'This month revenue', opens: '/crm/billing', permission: 'care-billing:read', file: HOME_OFFICE, needle: 'This Month Revenue' },
  { label: 'Shifts today', opens: '/crm/schedule', permission: 'care-office:read|care-billing:read', file: HOME_OFFICE, needle: "label: 'Shifts Today'" },
  { label: 'Clocked in now', opens: '/crm/time-tracking', permission: 'care-office:read|care-billing:read', file: HOME_OFFICE, needle: "label: 'Clocked In Now'" },
  { label: 'Shifts remaining', opens: '/crm/schedule', permission: 'care-office:read|care-billing:read', file: HOME_OFFICE, needle: "label: 'Shifts Remaining'" },
  { label: 'Coverage gaps', opens: '/crm/emergency-coverage', permission: 'care-office:read|care-billing:read', file: HOME_OFFICE, needle: "label: 'Coverage Gaps'" },
  { label: 'Action items (to-do list)', opens: 'each item\'s own page', permission: 'care-schedule:update', file: HOME_OFFICE, needle: 'const seesSchedule = can(\'care-schedule:update\')' },
  { label: 'No-show alerts', opens: '/crm/no-show-alerts', permission: 'care-schedule:update', file: HOME_OFFICE, needle: "go('no-show-alerts')" },
  { label: 'Incident responses due', opens: '/crm/incidents', permission: 'care-compliance:read', file: HOME_OFFICE, needle: 'const seesIncidents = can(\'care-compliance:read\')' },
]
/**
 * A caregiver (the staff seat) does not see the office menu above: the desktop gives them their own pages (CaregiverDashboard.tsx
 * MAIN_PAGES / SELF_PAGES / Settings). Read from that file; each is matched to what the phone has.
 */
const CAREGIVER_FILE = 'apps/unified/web/src/crm/pages/homecare/visits/CaregiverDashboard.tsx'
const CAREGIVER_PHONE: Record<string, { what: string; files: string[] }> = {
  home: { what: 'Today tab', files: ['app/(tabs)/shifts.tsx'] },
  schedule: { what: 'Schedule tab (swap, move, miss)', files: ['app/(tabs)/care-schedule.tsx'] },
  clients: { what: 'My clients (More)', files: ['app/(care)/clients.tsx'] },
  history: { what: 'Visit history (More)', files: ['app/(care)/history.tsx'] },
  'open-shifts': { what: 'Open shifts (More)', files: ['app/(care)/open-shifts.tsx'] },
  availability: { what: 'none', files: [] },
  'miss-report': { what: "Can't make a shift (More)", files: ['app/(care)/shift-action.tsx'] },
  'incident-report': { what: 'Report an incident (More)', files: ['app/(care)/incident.tsx'] },
  'time-off': { what: 'Requests (More) — time off is not asked for yet', files: ['app/(care)/requests.tsx'] },
  settings: { what: 'none (the app has its own sign-out and theme)', files: [] },
}
export function caregiverPages(): { page: string; label: string; phone: string }[] {
  const src = readFileSync(join(ROOT, CAREGIVER_FILE), 'utf8')
  const grab = (name: string) => [...(new RegExp(name + ':[^=]*=\\s*\\[([\\s\\S]*?)\\n\\]').exec(src)?.[1] || '').matchAll(/page: '([a-z-]+)'[^}]*label: '([^']+)'/g)].map((m) => ({ page: m[1], label: m[2] }))
  const pages = [...grab('MAIN_PAGES'), ...grab('SELF_PAGES'), { page: 'settings', label: 'Settings' }]
  if (pages.length < 8) fail(`${CAREGIVER_FILE}: only ${pages.length} caregiver pages found — fix the reader`)
  return pages.map((p) => {
    const has = CAREGIVER_PHONE[p.page]
    if (!has) return fail(`caregiver page "${p.page}" (${p.label}) is new on the desktop — add it to CAREGIVER_PHONE in scripts/mobile-parity.ts`)
    for (const f of has.files) if (!existsSync(join(ROOT, 'apps/mobile', f))) fail(`CAREGIVER_PHONE: apps/mobile/${f} does not exist`)
    return { ...p, phone: has.what }
  })
}

export const ROOF_STAGES_FILE = 'apps/unified/web/src/crm/pages/roof/jobs/model.ts'

// ── parent ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const { BASE_ROLE_PERMISSIONS } = await import(join(ROOT, 'packages/tenant-backend/src/auth/permissions.ts'))
const { maySeeRoute, allowsPermission } = await import(join(ROOT, 'packages/tenant-ui/src/shell/types.ts'))
const registry = await import(join(ROOT, 'packages/tenant-backend/src/featureRegistry.ts'))

/** The seat's permission list in this trade: the shared matrix, plus the trade's extras, minus what it withholds. */
export function seatPermissions(built: Pick<Built, 'extraRolePermissions' | 'withheldRolePermissions'>, seat: string): string[] {
  const withheld = new Set(built.withheldRolePermissions[seat] || [])
  return [...new Set([...(BASE_ROLE_PERMISSIONS[seat] || []), ...(built.extraRolePermissions[seat] || [])])].filter((p) => !withheld.has(p))
}
export const canWith = (perms: string[]) => (p: string): boolean => perms.includes('*') || perms.includes(p) || perms.includes(`${p.split(':')[0]}:*`)

export interface Row {
  trade: string; section: string; label: string; path: string
  permission: string; minRole: string; features: string[]; featureState: string
  seats: string[]; phone: string; phoneHow: string; phase: Phase; why: string; external: boolean
}
export interface TradeMap { trade: Trade; featureSet: string; rows: Row[]; tiles: TileSet }
export interface TileSet { kind: 'jobs' | 'roofing' | 'homecare' | 'rv'; bySeat: Record<string, string[]>; note: string }

const fail = (m: string): never => { console.error('FAIL: ' + m); process.exit(1) }
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

function buildMenu(t: Trade): Built {
  const r = spawnSync(process.execPath, [import.meta.path, '--menu', t.dir], { cwd: ROOT, encoding: 'utf8', timeout: 240_000 })
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@MENU@@'))
  if (r.status !== 0 || !line) return fail(`${t.phone}: its menu could not be built — ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`)
  return JSON.parse(line.slice('@@MENU@@'.length))
}

function tilesFor(t: Trade, b: Built, permsBySeat: Record<string, string[]>): TileSet {
  for (const tile of [...JOBS_TILES, ...HOMECARE_OFFICE_TILES]) {
    const f = join(ROOT, tile.file)
    if (!existsSync(f) || !strip(readFileSync(f, 'utf8')).includes(tile.needle) && !readFileSync(f, 'utf8').includes(tile.needle)) fail(`dashboard tile "${tile.label}": ${tile.file} no longer has \`${tile.needle}\` — the desktop's rule changed; update TILE rules in scripts/mobile-parity.ts`)
  }
  const offered = new Set(registry.getAdvertisableFeaturesForTemplate(b.featureSet).map((f: any) => f.id))
  const bySeat: Record<string, string[]> = {}
  const okPerm = (can: (p: string) => boolean, permission?: string) => !permission || permission.split('|').some((p) => can(p))
  if (t.phone === 'roofing') {
    const model = readFileSync(join(ROOT, ROOF_STAGES_FILE), 'utf8')
    const m = /PIPELINE_STATUSES = \[([\s\S]*?)\] as const/.exec(model)
    if (!m) return fail('roofing stages not found in ' + ROOF_STAGES_FILE)
    if (!strip(readFileSync(join(ROOT, ROOF_BOARD), 'utf8')).includes('STAGES.map')) return fail('roofing board no longer maps STAGES')
    const stages = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).filter((s) => s !== 'measurement_ordered' || offered.has('measurement_reports'))
    for (const s of SEATS) bySeat[s.id] = permsBySeat[s.id].length && canWith(permsBySeat[s.id])('jobs:read') ? stages.map((x) => `Stage: ${x.replace(/_/g, ' ')}`) : []
    return { kind: 'roofing', bySeat, note: 'Roofing\'s home is the pipeline board (a column per stage, a count on each), not a tile grid. Needs jobs:read.' }
  }
  if (t.phone === 'homecare') {
    for (const s of SEATS) {
      const can = canWith(permsBySeat[s.id])
      if (s.id === 'field') { bySeat[s.id] = ['My shifts today', 'Clock in / out', 'My visits', 'Open shifts', 'Messages from the office']; continue }
      bySeat[s.id] = HOMECARE_OFFICE_TILES.filter((x) => okPerm(can, x.permission)).map((x) => `${x.label} → ${x.opens}`)
    }
    return { kind: 'homecare', bySeat, note: 'A caregiver (staff) gets a day view (CaregiverDashboard: Home, Schedule, Clients, History + self-service pages); everyone else gets the office overview, each tile for whoever holds its permission (OfficeHome.tsx).' }
  }
  if (t.phone === 'rv') {
    const file = 'apps/unified/web/src/crm/pages/rv/DashboardPage.tsx'
    for (const s of SEATS) bySeat[s.id] = canWith(permsBySeat[s.id])('dashboard:read') ? ['Inventory → /crm/units', 'Open leads → /crm/sales-pipeline', 'Open repair orders → /crm/service'] : []
    return { kind: 'rv', bySeat, note: `The dealership's own dashboard (${file}); tiles are the three counts the phone shows today. Dealership seats are not split further on the desktop.` }
  }
  const projects = offered.has('projects')
  for (const s of SEATS) {
    const can = canWith(permsBySeat[s.id])
    if (!can('dashboard:read')) { bySeat[s.id] = []; continue }
    bySeat[s.id] = JOBS_TILES.filter((x) => okPerm(can, x.permission) && (!x.feature || (x.feature === 'projects' && projects)))
      .map((x) => `${x.label.replace('<Jobs>', t.phone === 'fieldservice' ? 'Service calls' : 'Jobs')} → ${x.opens}`)
  }
  return { kind: 'jobs', bySeat, note: 'The shared jobs dashboard (JobsDashboardPage.tsx): a tile is dropped when the seat cannot open the page it links to; "New leads" needs the Lead Inbox switch and leads:read; "Active projects" needs the Projects switch. The server also leaves money out for a seat that may not see it.' }
}

export async function collect(): Promise<TradeMap[]> {
  const out: TradeMap[] = []
  for (const t of TRADES) {
    const b = buildMenu(t)
    const offered = new Set(registry.getAdvertisableFeaturesForTemplate(b.featureSet).map((f: any) => f.id))
    const onByDefault = new Set(registry.getDefaultFeaturesForTemplate(b.featureSet))
    const absent = new Set(b.routeAbsent)
    const permsBySeat: Record<string, string[]> = Object.fromEntries(SEATS.map((s) => [s.id, seatPermissions(b, s.id)]))
    const rows: Row[] = []
    for (const i of b.nav) {
      if (absent.has(i.to)) continue
      if (i.features.length && !i.features.some((f) => offered.has(f))) continue
      const seats = SEATS.filter((s) => {
        const can = canWith(permsBySeat[s.id])
        return maySeeRoute({ routeRoles: b.routeRoles, routePermissions: b.routePermissions, nav: [{ to: i.to, minRole: i.minRole || undefined, permission: i.permission || undefined }] }, i.to, s.id, can)
      }).map((s) => s.name)
      const has = PHONE_HAS.find((p) => p.paths.includes(i.to) && (!p.trades || p.trades.includes(t.phone)))
      const ph = phaseOf(i.to)
      rows.push({
        trade: t.phone, section: i.section, label: i.label, path: i.to,
        permission: Array.isArray(i.permission) ? i.permission.join(' or ') : (i.permission || ''), minRole: i.minRole || '',
        features: i.features,
        featureState: !i.features.length ? 'core' : i.features.some((f) => onByDefault.has(f)) ? 'on by default' : 'off by default (add-on or opt-in)',
        seats, phone: has ? has.what : 'none', phoneHow: has ? has.how : 'none', phase: has && ph.phase === 'C' && false ? 'C' : ph.phase, why: ph.why, external: i.external,
      })
    }
    out.push({ trade: t, featureSet: b.featureSet, rows, tiles: tilesFor(t, b, permsBySeat) })
  }
  for (const h of PHONE_HAS) for (const f of h.files) if (!existsSync(join(ROOT, 'apps/mobile', f))) fail(`PHONE_HAS: ${h.what} names apps/mobile/${f}, which does not exist`)
  return out
}

const seatsText = (seats: string[]) => (seats.length === SEATS.length ? 'all' : seats.length ? seats.join(', ') : 'nobody')
const esc = (s: string) => s.replace(/\|/g, '\\|')

export function render(maps: TradeMap[]): string {
  const L: string[] = []
  L.push('# Phone app parity map', '')
  L.push('Generated by `bun scripts/mobile-parity.ts` from the desktop\'s own menu, permissions and feature registry. **Do not edit by hand** — change the code and re-run (`--check` fails when this file is stale; `tests/mobile/parity-map.test.ts` runs it).', '')
  L.push('Seats: owner, admin, manager, staff (the field rung), viewer — permissions, not ranks. "Seats" lists who is shown the item by the desktop\'s own rule (permission, minimum role, route rules), before any per-business switch. "Switch" says whether the item is part of a new business\'s default set.', '')
  L.push('Phase: **A** daily field and office work · **B** projects, bids and the price book · **C** everything else that works on a phone · **D** desktop only (with the reason).', '')
  L.push('## Summary', '')
  L.push('| Trade | Desktop items | Phone has today | A | B | C | D |', '|---|---:|---:|---:|---:|---:|---:|')
  for (const m of maps) {
    const n = (p: Phase) => m.rows.filter((r) => r.phase === p).length
    L.push(`| ${m.trade.label} | ${m.rows.length} | ${m.rows.filter((r) => r.phone !== 'none').length} | ${n('A')} | ${n('B')} | ${n('C')} | ${n('D')} |`)
  }
  L.push('')
  for (const m of maps) {
    L.push(`## ${m.trade.label} (\`${m.trade.phone}\`, feature set \`${m.featureSet}\`)`, '')
    L.push('### Dashboard tiles by seat', '', m.tiles.note, '')
    for (const s of SEATS) {
      const t = m.tiles.bySeat[s.id] || []
      L.push(`- **${s.name}** (${t.length}): ${t.length ? t.join('; ') : 'no dashboard (cannot read it)'}`)
    }
    L.push('', '### Menu', '')
    L.push('| Menu section | Label | Path | Permission | Switch | Seats | Phone today | Phase |', '|---|---|---|---|---|---|---|---|')
    for (const r of m.rows) {
      const perm = [r.permission, r.minRole ? `role ≥ ${r.minRole}` : ''].filter(Boolean).join('; ') || '—'
      const ph = r.phase === 'D' ? `D — ${r.why}` : r.why && r.phase !== 'C' ? `${r.phase} — ${r.why}` : r.phase
      L.push(`| ${esc(r.section || '—')} | ${esc(r.label)} | \`${r.path}\` | ${esc(perm)} | ${esc(r.features.join(', ') || '—')} (${r.featureState}) | ${seatsText(r.seats)} | ${esc(r.phone)} | ${esc(ph)} |`)
    }
    L.push('')
    if (m.trade.phone === 'homecare') {
      L.push('### The caregiver\'s own pages (staff seat — the desktop gives a caregiver this instead of the menu above)', '', '| Page | Phone today |', '|---|---|')
      for (const p of caregiverPages()) L.push(`| ${esc(p.label)} | ${esc(p.phone)} |`)
      L.push('')
    }
  }
  return L.join('\n')
}

if (import.meta.main && process.argv[2] !== '--menu') {
  const maps = await collect()
  if (process.argv[2] === '--json') {
    process.stdout.write('@@ROWS@@' + JSON.stringify(maps.map((m) => ({ trade: m.trade.phone, featureSet: m.featureSet, rows: m.rows, tiles: m.tiles }))) + '\n')
  } else {
    const md = render(maps) + '\n'
    if (process.argv[2] === '--check') {
      if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== md) { console.error('FAIL: docs/mobile/PARITY.md is not what the code now says — run `bun scripts/mobile-parity.ts` and commit it'); process.exit(1) }
      console.log('PARITY.md is current')
    } else {
      mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, md)
      console.log('wrote ' + OUT)
      for (const m of maps) console.log(`${m.trade.phone}: ${m.rows.length} items, phone has ${m.rows.filter((r) => r.phone !== 'none').length}`)
    }
  }
}
