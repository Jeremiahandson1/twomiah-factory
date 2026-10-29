#!/usr/bin/env bun
// The phone-app parity map: EVERY desktop menu item of every trade the phone serves, what the phone has for it today, and
// the phase it is planned in. Writes docs/mobile/PARITY.md. Re-run it whenever a menu, a permission or a phone screen changes:
//
//   bun apps/unified/scripts/mobile-parity.ts            write docs/mobile/PARITY.md
//   bun apps/unified/scripts/mobile-parity.ts --check    fail (exit 1) when the file is not what the code now says
//   bun apps/unified/scripts/mobile-parity.ts --json     print the rows (tests/mobile/parity-map.test.ts reads these)
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

const ROOT = join(import.meta.dir, '../../..')
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
/**
 * The trades the phone does NOT serve yet — salon, restaurant, bar, store and vet still open the "use the website" screen
 * (src/vertical/WrongAppGate.tsx). Their desktop menus are mapped here so the plan (phases, the home per seat) is made from the
 * desktop's own pages before anything is built. Nothing generated for the phone's own menu (menu.generated.ts) covers them.
 */
export const DESIGN_TRADES = [
  { phone: 'salon', dir: 'salon', label: 'Salon / barber / spa' },
  { phone: 'restaurant', dir: 'restaurant', label: 'Restaurant / caterer / event venue' },
  { phone: 'bar', dir: 'bar', label: 'Bar / tavern' },
  { phone: 'store', dir: 'store', label: 'Online store' },
  { phone: 'vet', dir: 'vet', label: 'Veterinary practice' },
] as const
export type Trade = (typeof TRADES)[number] | (typeof DESIGN_TRADES)[number]
export const ALL_TRADES: readonly Trade[] = [...TRADES, ...DESIGN_TRADES]
export const isServed = (phone: string) => (TRADES as readonly { phone: string }[]).some((t) => t.phone === phone)

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
  { paths: ['/crm/dashboard'], trades: ['contractor', 'basic', 'fieldservice', 'landscaping', 'roofing', 'rv'], how: 'tab', what: 'Home tab: tiles for the seat, each opens the list it counts (roofing: also the pipeline\'s stages, each opens its jobs)', files: ['app/(tabs)/dashboard.tsx'] },
  { paths: ['/crm/dashboard'], trades: ['homecare'], how: 'tab', what: 'Today tab (the caregiver\'s day); the office seats get a Home tab with the overview tiles', files: ['app/(tabs)/shifts.tsx', 'app/(tabs)/dashboard.tsx'] },
  { paths: ['/crm/pipeline'], trades: ['roofing'], how: 'screen', what: 'Pipeline board (a column per stage), a row in More; the stages are also on the Home tab', files: ['app/(tabs)/pipeline.tsx'] },
  { paths: ['/crm/jobs'], trades: ['contractor', 'basic', 'landscaping', 'roofing'], how: 'tab', what: 'Jobs tab + job detail + new/edit job form', files: ['app/(tabs)/jobs.tsx', 'app/(details)/job/[id].tsx', 'app/(details)/job/form.tsx'] },
  { paths: ['/crm/jobs'], trades: ['fieldservice'], how: 'tab', what: 'Service Calls tab + job detail + form', files: ['app/(tabs)/service-calls.tsx', 'app/(details)/job/[id].tsx', 'app/(details)/job/form.tsx'] },
  { paths: ['/crm/contacts'], trades: ['contractor', 'basic', 'fieldservice', 'landscaping', 'roofing', 'rv'], how: 'tab', what: 'Contacts tab + contact detail + form', files: ['app/(tabs)/contacts.tsx', 'app/(details)/contact/[id].tsx', 'app/(details)/contact/form.tsx'] },
  { paths: ['/crm/quotes'], trades: ['contractor', 'basic'], how: 'tab', what: 'Quotes tab + quote detail + form', files: ['app/(tabs)/quotes.tsx', 'app/(details)/quote/[id].tsx', 'app/(details)/quote/form.tsx'] },
  { paths: ['/crm/quotes'], trades: ['fieldservice', 'landscaping', 'roofing'], how: 'screen', what: 'Quotes list (More, or the Pending quotes tile) + quote detail + form', files: ['app/(tabs)/quotes.tsx', 'app/(details)/quote/[id].tsx', 'app/(details)/quote/form.tsx'] },
  { paths: ['/crm/invoices'], how: 'screen', what: 'Invoices list (More, or the Open invoices tile) + invoice detail: Record payment, Send invoice', files: ['app/(details)/invoices.tsx', 'app/(details)/invoice/[id].tsx'] },
  { paths: ['/crm/schedule'], trades: ['fieldservice', 'landscaping'], how: 'tab', what: 'Schedule tab', files: ['app/(tabs)/schedule.tsx'] },
  { paths: ['/crm/schedule'], trades: ['homecare'], how: 'tab', what: 'Schedule tab (two weeks: swap, move, miss)', files: ['app/(tabs)/care-schedule.tsx'] },
  { paths: ['/crm/leads', '/crm/new-leads'], how: 'screen', what: 'Leads list (status filter, search, call/text/email) + lead detail (note, convert, create quote) + quick-add', files: ['app/(details)/leads/index.tsx', 'app/(details)/leads/[id].tsx', 'app/(details)/lead/quick-add.tsx'] },
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

// ── the phone's More menu: grouping, icons, and which rows open a phone screen ───────────────────────────────────────
/** Groups, in the order the menu lists them. Settled with the owner (2026-10-28): Sell / Work / Projects / … , not the desktop's section names. */
export const MORE_GROUP_ORDER = ['Home', 'Sell', 'Work', 'Projects', 'Clients & care', 'Scheduling', 'Caregivers', 'Visit records', 'Billing & payroll', 'Compliance', 'Communication', 'Money & reports', 'Customers', 'Equipment & records', 'Business & website', 'Help'] as const
/** Home care's desktop sections are its own; each becomes one group (never a name that sounds medical). */
const HOMECARE_SECTION_GROUP: Record<string, string> = { Operations: 'Clients & care', Scheduling: 'Scheduling', Clinical: 'Visit records', Caregivers: 'Caregivers', Financial: 'Billing & payroll', Compliance: 'Compliance', Communication: 'Communication', Settings: 'Business & website' }
const SECTION_GROUP: Record<string, string> = { Website: 'Business & website', Bookings: 'Customers', Projects: 'Projects' }
const GROUP_BY_PATH: Record<string, string> = {
  '/crm/accounting': 'Money & reports',
  '/crm/adjusters': 'Customers',
  '/crm/agreements': 'Equipment & records',
  '/crm/ai-leads': 'Sell',
  '/crm/ai-receptionist': 'Customers',
  '/crm/ai-reports': 'Money & reports',
  '/crm/ai-trade': 'Sell',
  '/crm/aia-forms': 'Projects',
  '/crm/alerts': 'Work',
  '/crm/area-pricing': 'Money & reports',
  '/crm/audit': 'Business & website',
  '/crm/bids': 'Sell',
  '/crm/bills': 'Projects',
  '/crm/bookings': 'Customers',
  '/crm/bookings/calendar': 'Customers',
  '/crm/bookings/insights': 'Customers',
  '/crm/bookings/settings': 'Customers',
  '/crm/bookings/waitlist': 'Customers',
  '/crm/call-tracking': 'Customers',
  '/crm/canvassing': 'Sell',
  '/crm/change-orders': 'Projects',
  '/crm/commissions': 'Money & reports',
  '/crm/contact-support': 'Help',
  '/crm/contacts': 'Customers',
  '/crm/crews': 'Work',
  '/crm/daily-logs': 'Work',
  '/crm/dashboard': 'Home',
  '/crm/desking': 'Sell',
  '/crm/dispatch': 'Work',
  '/crm/documents': 'Equipment & records',
  '/crm/domain': 'Business & website',
  '/crm/draw-schedules': 'Projects',
  '/crm/email': 'Business & website',
  '/crm/equipment': 'Equipment & records',
  '/crm/expenses': 'Work',
  '/crm/fi': 'Sell',
  '/crm/fleet': 'Equipment & records',
  '/crm/floorplan': 'Money & reports',
  '/crm/gantt': 'Projects',
  '/crm/geofences': 'Equipment & records',
  '/crm/google-reviews': 'Customers',
  '/crm/help': 'Help',
  '/crm/inspections': 'Work',
  '/crm/inventory': 'Equipment & records',
  '/crm/invoices': 'Sell',
  '/crm/job-costing': 'Money & reports',
  '/crm/jobs': 'Work',
  '/crm/labor-guide': 'Work',
  '/crm/lead-sources': 'Sell',
  '/crm/leads': 'Sell',
  '/crm/lien-waivers': 'Projects',
  '/crm/locations': 'Business & website',
  '/crm/maintenance': 'Work',
  '/crm/marketing': 'Customers',
  '/crm/materials': 'Work',
  '/crm/messages': 'Sell',
  '/crm/parts': 'Work',
  '/crm/parts-catalog': 'Work',
  '/crm/pipeline': 'Sell',
  '/crm/pricebook': 'Money & reports',
  '/crm/pricebook-rates': 'Money & reports',
  '/crm/projects': 'Projects',
  '/crm/punch-lists': 'Work',
  '/crm/purchase-orders': 'Projects',
  '/crm/quotes': 'Sell',
  '/crm/recurring': 'Sell',
  '/crm/recurring-routes': 'Work',
  '/crm/rentals': 'Work',
  '/crm/reports': 'Money & reports',
  '/crm/reviews': 'Customers',
  '/crm/rfis': 'Projects',
  '/crm/sales-pipeline': 'Sell',
  '/crm/schedule': 'Work',
  '/crm/selections': 'Sell',
  '/crm/service': 'Work',
  '/crm/snow-billing': 'Money & reports',
  '/crm/storm-leads': 'Sell',
  '/crm/submittals': 'Projects',
  '/crm/support': 'Customers',
  '/crm/takeoffs': 'Sell',
  '/crm/tasks': 'Work',
  '/crm/team': 'Business & website',
  '/crm/tech': 'Work',
  '/crm/time': 'Work',
  '/crm/title-reg': 'Sell',
  '/crm/units': 'Sell',
  '/crm/visualizer': 'Equipment & records',
  '/crm/warranties': 'Equipment & records',
  '/crm/website': 'Business & website',
  '/crm/website/blog': 'Business & website',
  '/crm/website/pages': 'Business & website',
  '/crm/website/photos': 'Business & website',
  '/crm/website/portfolio': 'Business & website',
  '/crm/website/settings': 'Business & website',
}
export function moreGroupOf(trade: string, section: string, path: string): string {
  if (trade === 'homecare' && HOMECARE_SECTION_GROUP[section]) return HOMECARE_SECTION_GROUP[section]
  return SECTION_GROUP[section] || GROUP_BY_PATH[path] || (() => { throw new Error(`More menu: ${path} (${trade}, section ${section}) has no group — add it to GROUP_BY_PATH in apps/unified/scripts/mobile-parity.ts`) })()
}
const ICON_BY_PATH: Record<string, string> = {
  '/crm/accounting': 'cash',
  '/crm/adjusters': 'person',
  '/crm/agreements': 'document-attach',
  '/crm/ai-leads': 'sparkles',
  '/crm/ai-receptionist': 'headset',
  '/crm/ai-reports': 'analytics',
  '/crm/ai-trade': 'cash',
  '/crm/aia-forms': 'document',
  '/crm/alerts': 'notifications',
  '/crm/area-pricing': 'map',
  '/crm/audit': 'eye',
  '/crm/bids': 'pricetag',
  '/crm/bills': 'card',
  '/crm/bookings': 'calendar-number',
  '/crm/bookings/calendar': 'ellipse',
  '/crm/bookings/insights': 'ellipse',
  '/crm/bookings/settings': 'ellipse',
  '/crm/bookings/waitlist': 'ellipse',
  '/crm/call-tracking': 'call',
  '/crm/canvassing': 'walk',
  '/crm/change-orders': 'swap-horizontal',
  '/crm/commissions': 'ribbon',
  '/crm/contact-support': 'chatbubble-ellipses',
  '/crm/contacts': 'people',
  '/crm/crews': 'people-circle',
  '/crm/daily-logs': 'journal',
  '/crm/dashboard': 'home',
  '/crm/desking': 'calculator',
  '/crm/dispatch': 'git-network',
  '/crm/documents': 'folder',
  '/crm/domain': 'link',
  '/crm/draw-schedules': 'trending-up',
  '/crm/email': 'mail',
  '/crm/equipment': 'build',
  '/crm/expenses': 'wallet',
  '/crm/fi': 'shield-checkmark',
  '/crm/fleet': 'car',
  '/crm/floorplan': 'business',
  '/crm/gantt': 'stats-chart',
  '/crm/geofences': 'locate',
  '/crm/google-reviews': 'logo-google',
  '/crm/help': 'information-circle',
  '/crm/inspections': 'search',
  '/crm/inventory': 'cube',
  '/crm/invoices': 'receipt',
  '/crm/job-costing': 'calculator',
  '/crm/jobs': 'hammer',
  '/crm/labor-guide': 'time',
  '/crm/lead-sources': 'link',
  '/crm/leads': 'mail-unread',
  '/crm/lien-waivers': 'document-lock',
  '/crm/locations': 'location',
  '/crm/maintenance': 'construct',
  '/crm/marketing': 'megaphone',
  '/crm/materials': 'layers',
  '/crm/messages': 'chatbubbles',
  '/crm/parts': 'construct',
  '/crm/parts-catalog': 'construct',
  '/crm/pipeline': 'funnel',
  '/crm/pricebook': 'book',
  '/crm/pricebook-rates': 'pricetags',
  '/crm/projects': 'folder-open',
  '/crm/punch-lists': 'list',
  '/crm/purchase-orders': 'cart',
  '/crm/quotes': 'document-text',
  '/crm/recurring': 'repeat',
  '/crm/recurring-routes': 'repeat',
  '/crm/rentals': 'key',
  '/crm/reports': 'bar-chart',
  '/crm/reviews': 'star',
  '/crm/rfis': 'help-circle',
  '/crm/sales-pipeline': 'funnel',
  '/crm/schedule': 'calendar',
  '/crm/selections': 'color-palette',
  '/crm/service': 'build',
  '/crm/snow-billing': 'snow',
  '/crm/storm-leads': 'thunderstorm',
  '/crm/submittals': 'send',
  '/crm/support': 'help-buoy',
  '/crm/takeoffs': 'resize',
  '/crm/tasks': 'checkbox',
  '/crm/team': 'people-circle',
  '/crm/tech': 'phone-portrait',
  '/crm/time': 'time',
  '/crm/title-reg': 'document-text',
  '/crm/units': 'car-sport',
  '/crm/visualizer': 'image',
  '/crm/warranties': 'shield-checkmark',
  '/crm/website': 'globe',
  '/crm/website/blog': 'ellipse',
  '/crm/website/pages': 'ellipse',
  '/crm/website/photos': 'ellipse',
  '/crm/website/portfolio': 'ellipse',
  '/crm/website/settings': 'ellipse',
}
export const moreIconOf = (path: string) => ICON_BY_PATH[path] || 'ellipse'

/**
 * Where a More row opens ON THE PHONE when a screen exists: the expo-router path. `for` limits it to the field seat (the
 * caregiver's own screens) or the office seats. A row with no entry opens the real desktop page inside the app.
 */
export interface PhoneRoute { paths: string[]; trades?: string[]; for?: 'field' | 'office'; route: string }
const JOBS_TRADES = ['contractor', 'basic', 'fieldservice', 'landscaping', 'roofing']
export const PHONE_ROUTES: PhoneRoute[] = [
  { paths: ['/crm/dashboard'], trades: ['contractor', 'basic', 'fieldservice', 'landscaping', 'rv'], route: '/(tabs)/dashboard' },
  { paths: ['/crm/dashboard'], trades: ['homecare'], for: 'office', route: '/(tabs)/dashboard' },
  { paths: ['/crm/dashboard'], trades: ['homecare'], for: 'field', route: '/(tabs)/shifts' },
  { paths: ['/crm/pipeline'], trades: ['roofing'], route: '/(tabs)/pipeline' },
  { paths: ['/crm/jobs'], trades: ['contractor', 'basic', 'landscaping', 'roofing'], route: '/(tabs)/jobs' },
  { paths: ['/crm/jobs'], trades: ['fieldservice'], route: '/(tabs)/service-calls' },
  { paths: ['/crm/contacts'], trades: ['contractor', 'basic', 'fieldservice', 'landscaping', 'roofing', 'rv'], route: '/(tabs)/contacts' },
  { paths: ['/crm/quotes'], trades: JOBS_TRADES, route: '/(tabs)/quotes' },
  { paths: ['/crm/invoices'], trades: JOBS_TRADES, route: '/(details)/invoices' },
  { paths: ['/crm/leads', '/crm/new-leads'], trades: JOBS_TRADES, route: '/(details)/leads' },
  { paths: ['/crm/schedule'], trades: ['fieldservice', 'landscaping'], route: '/(tabs)/schedule' },
  { paths: ['/crm/schedule'], trades: ['homecare'], for: 'field', route: '/(tabs)/care-schedule' },
  { paths: ['/crm/canvassing'], trades: ['roofing'], route: '/(tabs)/canvass' },
  { paths: ['/crm/time'], trades: ['homecare'], for: 'field', route: '/(tabs)/time-clock' },
  { paths: ['/crm/messages'], trades: ['homecare'], route: '/(tabs)/messages' },
  { paths: ['/crm/units'], trades: ['rv'], route: '/(tabs)/units' },
  { paths: ['/crm/parts-catalog', '/crm/parts'], trades: ['rv'], route: '/(tabs)/parts' },
  { paths: ['/crm/ai-trade'], trades: ['rv'], route: '/(tabs)/ai-trade' },
  { paths: ['/crm/clients'], trades: ['homecare'], for: 'field', route: '/(care)/clients' },
  { paths: ['/crm/open-shifts'], trades: ['homecare'], for: 'field', route: '/(care)/open-shifts' },
  { paths: ['/crm/incidents', '/crm/incident-reporting'], trades: ['homecare'], for: 'field', route: '/(care)/incident' },
  { paths: ['/crm/documents'], trades: ['homecare'], for: 'field', route: '/(care)/documents' },
  { paths: ['/crm/notifications', '/crm/notification-center'], trades: ['homecare'], for: 'field', route: '/(care)/notifications' },
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
/**
 * The five trades the phone does not serve yet have their own plan: the generic rules above were written for the jobs family
 * (they would call a salon's Rebooking list "C" and a restaurant's Register "quote on site, take payment on site"). Each rule is
 * the answer to "what does this trade do away from a desk every day?", read from that trade's own desktop pages. A path no
 * rule names is C. The phone is never a register: nothing that takes a card or rings a sale is anything but D.
 */
const SITE = ['/crm/website', '/crm/website/pages', '/crm/website/photos', '/crm/website/blog', '/crm/website/portfolio', '/crm/website/settings', '/crm/domain']
const SETUP = ['/crm/audit', '/crm/marketing', '/crm/email', '/crm/google-reviews', '/crm/lead-sources']
const LINKS = ['/crm/help', '/crm/contact-support']
export const DESIGN_PHASE_RULES: Record<string, PhaseRule[]> = {
  salon: [
    { paths: ['/crm/dashboard'], phase: 'A', why: 'the home screen: who is due to rebook, today\'s book' },
    { paths: ['/crm/appointments'], phase: 'A', why: 'the book: check in, move, complete, no-show' },
    { paths: ['/crm/reminders'], phase: 'A', why: 'rebooking: text the clients who are due' },
    { paths: ['/crm/clients'], phase: 'A', why: 'the client chart: allergies, formulas, visits' },
    { paths: ['/crm/messages'], phase: 'A', why: 'texting clients from the chair' },
    { paths: ['/crm/invoices', '/crm/time', '/crm/leads', '/crm/memberships', '/crm/loyalty'], phase: 'B', why: 'useful on the phone, not the chair\'s daily loop' },
    { paths: [...SITE, ...SETUP, '/crm/bookings/insights', '/crm/bookings/settings'], phase: 'D', why: 'set-up, review and website building are desk jobs' },
    { paths: LINKS, phase: 'D', why: 'a link out is enough' },
  ],
  restaurant: [
    { paths: ['/crm/dashboard'], phase: 'A', why: 'the home screen: the events book and what is owed on it' },
    { paths: ['/crm/events'], phase: 'A', why: 'the whole trade: inquiry, booking, the banquet event order' },
    { paths: ['/crm/invoices'], phase: 'A', why: 'deposits and balances: status and chasing (nothing is charged on the phone)' },
    { paths: ['/crm/messages', '/crm/leads'], phase: 'A', why: 'the first to answer a wedding enquiry usually books it' },
    { paths: ['/crm/tonight', '/crm/menu'], phase: 'A', why: 'close the kitchen and 86 an item mid-service (when switched on)' },
    { paths: ['/crm/contacts', '/crm/reports', '/crm/spaces', '/crm/menus', '/crm/orders'], phase: 'B', why: 'useful later; the event already names the client and the room' },
    { paths: ['/crm/register', '/crm/kiosk', '/crm/register-settings'], phase: 'D', why: 'takes card payments and is a counter screen; the phone is not a register' },
    { paths: ['/crm/bar-settings', ...SITE, ...SETUP], phase: 'D', why: 'set-up, review and website building are desk jobs' },
    { paths: LINKS, phase: 'D', why: 'a link out is enough' },
  ],
  bar: [
    { paths: ['/crm/dashboard'], phase: 'A', why: 'the home screen: tonight and the private-party book' },
    { paths: ['/crm/tonight', '/crm/menu', '/crm/taps'], phase: 'A', why: 'the bar\'s live board: open/closed, 86, what is on tap' },
    { paths: ['/crm/stock'], phase: 'A', why: 'blind count and receiving a delivery in the back room' },
    { paths: ['/crm/shifts', '/crm/time'], phase: 'A', why: 'my shifts, time off and the clock' },
    { paths: ['/crm/events'], phase: 'A', why: 'private parties: who, when, how many' },
    { paths: ['/crm/messages', '/crm/leads', '/crm/invoices', '/crm/regulars', '/crm/orders', '/crm/spaces', '/crm/menus', '/crm/reports'], phase: 'B', why: 'useful later, not the bar\'s nightly loop' },
    { paths: ['/crm/register', '/crm/kiosk', '/crm/register-settings', '/crm/gift-cards'], phase: 'D', why: 'rings sales, takes cards or sells stored value; the phone is not a register' },
    { paths: ['/crm/bar-settings', '/crm/ai-receptionist', '/crm/call-tracking', ...SITE, ...SETUP], phase: 'D', why: 'set-up, review and website building are desk jobs' },
    { paths: LINKS, phase: 'D', why: 'a link out is enough' },
  ],
  store: [
    { paths: ['/crm/dashboard'], phase: 'A', why: 'the home screen: what is waiting to be packed' },
    { paths: ['/crm/orders'], phase: 'A', why: 'pick, pack and ship' },
    { paths: ['/crm/products'], phase: 'A', why: 'stock look-up and count from the shelf' },
    { paths: ['/crm/product-reviews'], phase: 'A', why: 'a small queue: approve or reject between orders' },
    { paths: ['/crm/customers', '/crm/leads'], phase: 'B', why: 'useful later; the order already carries the buyer' },
    { paths: ['/crm/payments', '/crm/suppliers', '/crm/shipping', '/crm/store-settings', '/crm/gift-cards', '/crm/customer-groups', '/crm/store-loyalty'], phase: 'D', why: 'moves or sets up money, carrier keys or price tables; not a phone job' },
    { paths: [...SITE, ...SETUP], phase: 'D', why: 'set-up, review and website building are desk jobs' },
    { paths: LINKS, phase: 'D', why: 'a link out is enough' },
  ],
  vet: [
    { paths: ['/crm/dashboard'], phase: 'A', why: 'the home screen: the book and the vaccines due' },
    { paths: ['/crm/appointments'], phase: 'A', why: 'the day sheet: check in, start, done' },
    { paths: ['/crm/patients'], phase: 'A', why: 'look up a pet: alerts, allergies, vaccines' },
    { paths: ['/crm/reminders'], phase: 'A', why: 'recall: text the owners whose pets are overdue' },
    { paths: ['/crm/contacts', '/crm/messages'], phase: 'A', why: 'ring or text the owner' },
    { paths: ['/crm/documents', '/crm/reports', '/crm/bookings', '/crm/leads'], phase: 'B', why: 'useful later, not the floor\'s daily loop' },
    { paths: ['/crm/bookings/settings', ...SITE, ...SETUP], phase: 'D', why: 'set-up, review and website building are desk jobs' },
    { paths: LINKS, phase: 'D', why: 'a link out is enough' },
  ],
}
export const phaseOf = (path: string, trade?: string): { phase: Phase; why: string } => {
  const own = trade ? DESIGN_PHASE_RULES[trade] : undefined
  if (own) {
    const r = own.find((x) => x.paths.includes(path))
    return r ? { phase: r.phase, why: r.why } : { phase: 'C', why: '' }
  }
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
 * The five unserved trades each run their own dashboard (not the jobs one). Each tile: label, where the desktop opens it, the
 * permission that decides whether a seat sees it, whether it is money, and an anchor that must still be in the source.
 */
interface DTile extends Tile { money?: boolean }
const D = 'apps/unified/web/src/crm/pages/'
export const DESIGN_TILES: Record<string, { note: string; tiles: DTile[] }> = {
  salon: { note: 'The salon\'s own dashboard (pages/salon/DashboardPage.tsx): a Due-to-Rebook banner and four tiles. The "Services This Month" tile carries a money line. Stylist = the staff seat, Front Desk = the viewer seat.', tiles: [
    { label: 'Due to rebook (overdue / due soon)', opens: '/crm/reminders', permission: 'contacts:read', file: D + 'salon/DashboardPage.tsx', needle: 'Due to Rebook' },
    { label: 'Clients', opens: '/crm/clients', permission: 'contacts:read', file: D + 'salon/DashboardPage.tsx', needle: '>Clients</p>' },
    { label: 'Appointments today', opens: '/crm/appointments', permission: 'schedule:read', file: D + 'salon/DashboardPage.tsx', needle: 'Appointments Today' },
    { label: 'Services this month (no list on the desktop)', opens: 'not a link', permission: 'dashboard:read', file: D + 'salon/DashboardPage.tsx', needle: 'Services This Month' },
    { label: 'Members', opens: '/crm/memberships', permission: 'dashboard:read', file: D + 'salon/DashboardPage.tsx', needle: '>Members</p>' },
  ] },
  restaurant: { note: 'The events dashboard (pages/restaurant/DashboardPage.tsx) under the bar HomePage strips. Money tiles need invoices:read, and the server leaves the key out for a seat without it. "Booked Value Ahead" is not a link, so it is a money line on the phone, not a tile.', tiles: [
    { label: 'Payments overdue', opens: '/crm/invoices', permission: 'invoices:read', money: true, file: D + 'restaurant/DashboardPage.tsx', needle: 'Payments Overdue' },
    { label: 'Open inquiries', opens: '/crm/events', permission: 'contacts:read', file: D + 'restaurant/DashboardPage.tsx', needle: 'Open Inquiries' },
    { label: 'Next 30 days', opens: '/crm/events', permission: 'contacts:read', file: D + 'restaurant/DashboardPage.tsx', needle: 'Next 30 Days' },
    { label: 'Booked value ahead (not a link)', opens: 'not a link', permission: 'invoices:read', money: true, file: D + 'restaurant/DashboardPage.tsx', needle: 'Booked Value Ahead' },
    { label: 'Confirmed', opens: '/crm/spaces', permission: 'contacts:read', file: D + 'restaurant/DashboardPage.tsx', needle: '>Confirmed</p>' },
    { label: 'Payments due (panel)', opens: '/crm/events', permission: 'invoices:read', money: true, file: D + 'restaurant/DashboardPage.tsx', needle: 'Payments Due' },
    { label: 'Coming up (panel)', opens: '/crm/events', permission: 'contacts:read', file: D + 'restaurant/DashboardPage.tsx', needle: 'Coming Up' },
  ] },
  bar: { note: 'The bar\'s home (pages/bar/HomePage.tsx): the Tonight strip, "Today on the register", then the same events dashboard as the restaurant (pages/restaurant/DashboardPage.tsx). The register strip is a sales figure and stays off the phone.', tiles: [
    { label: 'Tonight strip', opens: '/crm/tonight', permission: 'bar:read', file: D + 'bar/HomePage.tsx', needle: '> Tonight</p>' },
    { label: 'Today on the register (sales; stays on the desktop)', opens: '/crm/closeout', permission: 'bar:register', money: true, file: D + 'bar/HomePage.tsx', needle: 'Today on the register' },
    { label: 'Payments overdue', opens: '/crm/invoices', permission: 'invoices:read', money: true, file: D + 'restaurant/DashboardPage.tsx', needle: 'Payments Overdue' },
    { label: 'Open inquiries', opens: '/crm/events', permission: 'contacts:read', file: D + 'restaurant/DashboardPage.tsx', needle: 'Open Inquiries' },
    { label: 'Next 30 days', opens: '/crm/events', permission: 'contacts:read', file: D + 'restaurant/DashboardPage.tsx', needle: 'Next 30 Days' },
    { label: 'Confirmed', opens: '/crm/spaces', permission: 'contacts:read', file: D + 'restaurant/DashboardPage.tsx', needle: '>Confirmed</p>' },
    { label: 'Coming up (panel)', opens: '/crm/events', permission: 'contacts:read', file: D + 'restaurant/DashboardPage.tsx', needle: 'Coming Up' },
  ] },
  store: { note: 'The store\'s own dashboard (pages/store/orders/DashboardPage.tsx): money tiles for revenue:read, three counts for orders:read. Every figure is all-time (no date window). A shop hands out only manager and staff seats; a viewer holds no store permission.', tiles: [
    { label: 'Revenue', opens: 'not a link', permission: 'revenue:read', money: true, file: D + 'store/orders/DashboardPage.tsx', needle: 'label="Revenue"' },
    { label: 'Refunded', opens: 'not a link', permission: 'revenue:read', money: true, file: D + 'store/orders/DashboardPage.tsx', needle: 'Refunded (' },
    { label: 'Net sales', opens: 'not a link', permission: 'revenue:read', money: true, file: D + 'store/orders/DashboardPage.tsx', needle: 'label="Net sales"' },
    { label: 'Orders (paid and refunded)', opens: '/crm/orders', permission: 'orders:read', file: D + 'store/orders/DashboardPage.tsx', needle: 'label="Orders"' },
    { label: 'To fulfill', opens: '/crm/orders', permission: 'orders:read', file: D + 'store/orders/DashboardPage.tsx', needle: 'label="To fulfill"' },
    { label: 'At supplier (only when above 0)', opens: '/crm/orders', permission: 'orders:read', file: D + 'store/orders/DashboardPage.tsx', needle: 'label="At supplier"' },
  ] },
  vet: { note: 'The practice dashboard (pages/vet/DashboardPage.tsx), not the jobs dashboard. The phone splits "Reminders Due" into two tiles (overdue, due soon). The money lines under Visits need revenue:read.', tiles: [
    { label: 'Reminders due (overdue / due soon)', opens: '/crm/reminders', permission: 'contacts:read', file: D + 'vet/DashboardPage.tsx', needle: 'Reminders Due' },
    { label: 'Active patients (not a link)', opens: 'not a link', permission: 'contacts:read', file: D + 'vet/DashboardPage.tsx', needle: 'Active Patients' },
    { label: 'Appointments today', opens: '/crm/appointments', permission: 'contacts:read', file: D + 'vet/DashboardPage.tsx', needle: 'Appointments Today' },
    { label: 'Visits this month (not a link)', opens: 'not a link', permission: 'contacts:read', file: D + 'vet/DashboardPage.tsx', needle: 'Visits This Month' },
    { label: 'Visits: billed / not yet invoiced / still to come (money lines)', opens: 'not a link', permission: 'revenue:read', money: true, file: D + 'vet/DashboardPage.tsx', needle: 'Visits This Month' },
    { label: 'Wellness enrollments (not a link)', opens: 'not a link', permission: 'contacts:read', file: D + 'vet/DashboardPage.tsx', needle: 'Wellness Enrollments' },
  ] },
}
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
    if (!has) return fail(`caregiver page "${p.page}" (${p.label}) is new on the desktop — add it to CAREGIVER_PHONE in apps/unified/scripts/mobile-parity.ts`)
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
  /** The raw gates, for the phone's menu: nav permission / minRole, and the route's own (maySeeRoute reads both). */
  perm: string | string[] | null; routeRole: string | null; routePerm: string | string[] | null
}
export interface TradeMap { trade: Trade; featureSet: string; rows: Row[]; tiles: TileSet }
export interface TileSet { kind: 'jobs' | 'roofing' | 'homecare' | 'rv' | 'design'; bySeat: Record<string, string[]>; note: string }

const fail = (m: string): never => { console.error('FAIL: ' + m); process.exit(1) }
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

function buildMenu(t: Trade): Built {
  const r = spawnSync(process.execPath, [import.meta.path, '--menu', t.dir], { cwd: ROOT, encoding: 'utf8', timeout: 240_000 })
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@MENU@@'))
  if (r.status !== 0 || !line) return fail(`${t.phone}: its menu could not be built — ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`)
  return JSON.parse(line.slice('@@MENU@@'.length))
}

function tilesFor(t: Trade, b: Built, permsBySeat: Record<string, string[]>): TileSet {
  const own = DESIGN_TILES[t.phone]
  if (own) {
    for (const tile of own.tiles) {
      const f = join(ROOT, tile.file)
      if (!existsSync(f) || !readFileSync(f, 'utf8').includes(tile.needle)) fail(`dashboard tile "${tile.label}" (${t.phone}): ${tile.file} no longer has \`${tile.needle}\` — the desktop's rule changed; update DESIGN_TILES in apps/unified/scripts/mobile-parity.ts`)
    }
    const bySeat: Record<string, string[]> = {}
    for (const s of SEATS) {
      const can = canWith(permsBySeat[s.id])
      if (!can('dashboard:read')) { bySeat[s.id] = []; continue }
      bySeat[s.id] = own.tiles.filter((x) => !x.permission || x.permission.split('|').some((p) => can(p))).map((x) => `${x.label}${x.money ? ' (money)' : ''} → ${x.opens}`)
    }
    return { kind: 'design', bySeat, note: own.note }
  }
  for (const tile of [...JOBS_TILES, ...HOMECARE_OFFICE_TILES]) {
    const f = join(ROOT, tile.file)
    if (!existsSync(f) || !strip(readFileSync(f, 'utf8')).includes(tile.needle) && !readFileSync(f, 'utf8').includes(tile.needle)) fail(`dashboard tile "${tile.label}": ${tile.file} no longer has \`${tile.needle}\` — the desktop's rule changed; update TILE rules in apps/unified/scripts/mobile-parity.ts`)
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
  for (const t of ALL_TRADES) {
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
      const has = isServed(t.phone) ? PHONE_HAS.find((p) => p.paths.includes(i.to) && (!p.trades || p.trades.includes(t.phone))) : undefined
      const ph = phaseOf(i.to, isServed(t.phone) ? undefined : t.phone)
      rows.push({
        trade: t.phone, section: i.section, label: i.label, path: i.to,
        permission: Array.isArray(i.permission) ? i.permission.join(' or ') : (i.permission || ''), minRole: i.minRole || '',
        features: i.features,
        featureState: !i.features.length ? 'core' : i.features.some((f) => onByDefault.has(f)) ? 'on by default' : 'off by default (add-on or opt-in)',
        perm: i.permission, routeRole: b.routeRoles[i.to] ?? null, routePerm: b.routePermissions[i.to] ?? null,
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
  L.push('Generated by `bun apps/unified/scripts/mobile-parity.ts` from the desktop\'s own menu, permissions and feature registry. **Do not edit by hand** — change the code and re-run (`--check` fails when this file is stale; `tests/mobile/parity-map.test.ts` runs it).', '')
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
    if (!isServed(m.trade.phone)) L.push('> **Design round — the phone does not serve this trade yet** (it opens the "use the website" screen). Phase here means: **A** what this trade does away from a desk every day · **B** useful later · **C** works on a phone, not daily · **D** desktop only, with the reason. Rules: `DESIGN_PHASE_RULES` in the script. Homes and bars: `docs/mobile/DESIGN.md`.', '')
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

// ── the phone's menu data, generated from the same rows ─────────────────────────────────────────────────────────────
const APP_OUT = join(ROOT, 'apps/mobile/src/more/menu.generated.ts')
const routeFile = (route: string) => [`app${route}.tsx`, `app${route}/index.tsx`].map((f) => join(ROOT, 'apps/mobile', f)).find(existsSync)
export function appMenu(maps: TradeMap[]): string {
  const lines: string[] = [
    '// GENERATED by `bun apps/unified/scripts/mobile-parity.ts` from the desktop\'s own menu definitions (the same rows as docs/mobile/PARITY.md).',
    '// Do not edit: tests/mobile/more-menu.test.ts fails when this file is not what the code now says.',
    "import type { MenuRow } from './menu'",
    '',
    'export const MENU: Record<string, MenuRow[]> = {',
  ]
  for (const m of maps.filter((x) => isServed(x.trade.phone))) {
    lines.push(`  ${m.trade.phone}: [`)
    for (const r of m.rows) {
      const routes = PHONE_ROUTES.filter((x) => x.paths.includes(r.path) && (!x.trades || x.trades.includes(m.trade.phone))).map((x) => {
        if (!routeFile(x.route)) fail(`PHONE_ROUTES: ${x.route} has no screen file under apps/mobile/app`)
        return { for: x.for, route: x.route }
      })
      const row: Record<string, unknown> = {
        label: r.label, path: r.path, group: moreGroupOf(m.trade.phone, r.section, r.path), icon: moreIconOf(r.path),
        minRole: r.minRole || undefined, permission: r.perm ?? undefined, routeRole: r.routeRole ?? undefined, routePermission: r.routePerm ?? undefined,
        features: r.features.length ? r.features : undefined, native: routes.length ? routes : undefined,
      }
      lines.push('    ' + JSON.stringify(row) + ',')
    }
    lines.push('  ],')
  }
  lines.push('}', '')
  return lines.join('\n')
}

if (import.meta.main && process.argv[2] !== '--menu') {
  const maps = await collect()
  if (process.argv[2] === '--json') {
    process.stdout.write('@@ROWS@@' + JSON.stringify(maps.map((m) => ({ trade: m.trade.phone, featureSet: m.featureSet, rows: m.rows, tiles: m.tiles }))) + '\n')
  } else {
    const md = render(maps) + '\n'
    const app = appMenu(maps)
    if (process.argv[2] === '--check') {
      if (!existsSync(APP_OUT) || readFileSync(APP_OUT, 'utf8').replace(/\r\n/g, '\n') !== app) { console.error('FAIL: apps/mobile/src/more/menu.generated.ts is not what the code now says — run `bun apps/unified/scripts/mobile-parity.ts` and commit it'); process.exit(1) }
      // A Windows checkout writes CRLF; the map is the same either way.
      if (!existsSync(OUT) || readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') !== md) { console.error('FAIL: docs/mobile/PARITY.md is not what the code now says — run `bun apps/unified/scripts/mobile-parity.ts` and commit it'); process.exit(1) }
      console.log('PARITY.md is current')
    } else {
      mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, md)
      mkdirSync(dirname(APP_OUT), { recursive: true }); writeFileSync(APP_OUT, app)
      console.log('wrote ' + OUT)
      for (const m of maps) console.log(`${m.trade.phone}: ${m.rows.length} items, phone has ${m.rows.filter((r) => r.phone !== 'none').length}`)
    }
  }
}
