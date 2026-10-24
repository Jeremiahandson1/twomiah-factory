// Home care: the agency's screens (templates/crm-homecare/frontend), moved into crm/pages/homecare/<group>/, their
// routes under /crm and their menu items, registered only where the vertical's screens say home: 'homecare'
// (verticals/homecare/settings.ts), so no other vertical sees them. Each group folder owns its screens and exports
// `routes`, `nav` and `routePermissions` (and the public pages, `publicRoutes`); this file puts them together.
//
// The template's office was one page with a sidebar of sections (components/AdminDashboard.tsx) and its caregivers had
// their own app (components/CaregiverDashboard.tsx). Here each section is a page under /crm in the shell's menu, in the
// template's order and headings (MENU below), and /crm/dashboard is the office's overview or the caregiver's day.
//
// The agency's routes come BEFORE the CRM's in App.tsx: where both name a path (/crm/documents, /crm/reports,
// /crm/expenses, /crm/messages) the server's /api/<path> is home care's for this vertical, so the page must be too.
import type { ReactElement } from 'react'
import { Navigate, Route } from 'react-router-dom'
import { Users } from 'lucide-react'
import type { NavItem } from '../../shared'
import { useAuth, usePermissions } from '../../shared'
import { page } from '../lazy'
import { verticalScreens } from '../vertical'
import { HomecareFrame } from '../pages/homecare/lib/HomecareFrame'
import * as clients from '../pages/homecare/clients'
import * as schedule from '../pages/homecare/schedule'
import * as shifts from '../pages/homecare/shifts'
import * as visits from '../pages/homecare/visits'
import * as billing from '../pages/homecare/billing'
import * as people from '../pages/homecare/people'
import * as portals from '../pages/homecare/portals'
import * as office from '../pages/homecare/office'

const home = verticalScreens().home
/** True where this page was served for a home-care agency. Read once. */
export const isHomecare = typeof home === 'string' && home === 'homecare'

/**
 * The menu, in the template's order under its headings (AdminDashboard.tsx NAV_SECTIONS). Each group's `nav` gives the
 * item (its icon, label and the permission its page's API asks); this orders them and sets the heading. An item a
 * group has not registered is skipped. The template's items that are the app's shared screens (the lead inbox, lead
 * sources, paid ads, Contact Twomiah, branded email, Google reviews, the email domain and inbox, the AI receptionist,
 * sign-in & security, plan & billing) are the shared menu's own items (web/src/shell.ts), not repeated here.
 */
export const MENU: Array<[path: string, section: string]> = [
  ['/crm/clients', 'Operations'],
  ['/crm/client-onboarding', 'Operations'],
  ['/crm/client-documents', 'Operations'],
  ['/crm/referral-sources', 'Operations'],
  ['/crm/contacts', 'Operations'],
  ['/crm/care-plans', 'Operations'],
  ['/crm/scheduling', 'Scheduling'],
  ['/crm/live-board', 'Scheduling'],
  ['/crm/emergency-coverage', 'Scheduling'],
  ['/crm/no-show-alerts', 'Scheduling'],
  ['/crm/shift-approvals', 'Scheduling'],
  ['/crm/route-optimizer', 'Scheduling'],
  ['/crm/company-optimizer', 'Scheduling'],
  ['/crm/adl', 'Clinical'],
  ['/crm/medications', 'Clinical'],
  ['/crm/visit-docs', 'Clinical'],
  ['/crm/incidents', 'Clinical'],
  ['/crm/form-builder', 'Clinical'],
  ['/crm/caregivers', 'Caregivers'],
  ['/crm/performance', 'Caregivers'],
  ['/crm/applications', 'Caregivers'],
  ['/crm/job-postings', 'Caregivers'],
  ['/crm/onboarding-packets', 'Caregivers'],
  ['/crm/billing', 'Financial'],
  ['/crm/billing-import', 'Financial'],
  ['/crm/portal-claim-days', 'Financial'],
  ['/crm/claims', 'Financial'],
  ['/crm/billing-engine', 'Financial'],
  ['/crm/payers-service-codes', 'Financial'],
  ['/crm/authorizations', 'Financial'],
  ['/crm/client-week', 'Financial'],
  ['/crm/payroll', 'Financial'],
  ['/crm/expenses', 'Financial'],
  ['/crm/reports', 'Financial'],
  ['/crm/revenue-forecast', 'Financial'],
  ['/crm/compliance', 'Compliance'],
  ['/crm/evv', 'Compliance'],
  ['/crm/background-checks', 'Compliance'],
  ['/crm/documents', 'Compliance'],
  ['/crm/audit-logs', 'Compliance'],
  ['/crm/login-activity', 'Compliance'],
  ['/crm/communication-log', 'Communication'],
  ['/crm/sms', 'Communication'],
  ['/crm/family-portal', 'Communication'],
  ['/crm/alerts', 'Communication'],
  ['/crm/messages', 'Communication'],
  ['/crm/integrations', 'Communication'],
  ['/crm/agency-features', 'Communication'],
  ['/crm/notifications', 'Communication'],
  ['/crm/users', 'Settings'],
]

const GROUPS = [clients, schedule, shifts, visits, billing, people, portals, office]

/**
 * The shared screens an agency keeps, placed under its own headings (MENU) rather than the shared menu's: Contacts, the
 * office's address book — the enquiries the Lead Inbox converts, and suppliers. Switched on in Settings › Features
 * (contacts is core) and opened only by typing the address (live test, 2026-10-22). The same features and permission
 * as the shared item (web/src/shell.ts), which SHARED_HIDDEN keeps out of the shared list so it shows once.
 */
const SHARED_IN_MENU: NavItem[] = [
  { to: '/crm/contacts', icon: Users, label: 'Contacts', features: ['contacts'], permission: 'contacts:read' },
]

/** The shell's header View As button (crm/pages/homecare/office/ViewAs.tsx: staff and the client-portal preview): an agency's only. The strip under the header is every vertical's (crm/viewAs.tsx). */
export { ViewAsButton as headerActions } from '../pages/homecare/office/ViewAs'

/** Menu items, ordered and headed as MENU says. Empty everywhere but home care. */
export const nav: NavItem[] = isHomecare ? (() => {
  const byPath = new Map<string, NavItem>()
  for (const item of [...SHARED_IN_MENU, ...GROUPS.flatMap((g) => g.nav)]) byPath.set(item.to, item)
  return MENU.flatMap(([path, section]) => {
    const item = byPath.get(path)
    return item ? [{ ...item, section }] : []
  })
})() : []

/**
 * The shared menu's items an agency doesn't get: the CRM's pages home care never had, those whose path is the agency's
 * own page here (its documents, reports, expenses, messages), and Contacts, which MENU places under Operations
 * (SHARED_IN_MENU). Invoices: an agency bills its clients' visits on Financial › Billing (its own invoices, numbering,
 * family portal and pay links); the shared Invoices bills a contact in a second book none of those read, so the
 * registry does not offer it to home care (featureRegistry.ts) and its address goes to Billing (routes below). Taken
 * off the shared items only (shell.ts), not screens.navHidden, which would take the agency's own item of the same path
 * off too.
 */
export const SHARED_HIDDEN = [
  '/crm/contacts', '/crm/jobs', '/crm/quotes', '/crm/invoices', '/crm/schedule', '/crm/time', '/crm/expenses',
  '/crm/documents', '/crm/team', '/crm/reports', '/crm/messages', '/crm/pricebook', '/crm/tasks',
  // GPS & Geofences is the trades' (job-site fences, the crew's phones): a caregiver's location is EVV's, at clock-in.
  '/crm/geofences',
]

/**
 * Settings pages an agency doesn't get: Migrate Data and Import from CSV bring contacts, jobs, products and invoices
 * from contractor platforms (Jobber, ServiceTitan, Housecall Pro…) — an agency has none of those records, and home
 * care's own client and caregiver import is left off by the owner (2026-10-19). Their addresses go to Settings.
 */
export const SETTINGS_HIDDEN = ['/crm/settings/migration', '/crm/settings/import']

/** The permission each agency page asks for, for a URL typed in (the shell's routePermissions). */
export const routePermissions: Record<string, string | string[]> = isHomecare
  ? Object.assign({}, ...GROUPS.map((g) => g.routePermissions))
  : {}

/**
 * The stored roles that are the caregiver seat — the server's rule (server/crm/homecare/core/caregiverAccess.ts
 * isCaregiverSeat: the roles that normalise to the field rung; 'caregiver' by home care's roleMapping, 'user' by the
 * shared one). apps/unified/tests/homecare-whose-records.test.ts holds this list to the server's.
 */
export const CAREGIVER_SEATS = ['field', 'caregiver', 'user']

/**
 * The dashboard at /crm/dashboard: a caregiver's day (their shifts, clocking in and out, their visits) for a caregiver,
 * and the office's overview — each tile for whoever holds its permission — for everyone else: the template's split
 * (App.tsx MainApp: caregiver → CaregiverDashboard, else AdminDashboard). It was drawn on care-schedule:update, so a
 * seat granted read access was shown a caregiver's day, with "my shifts" and "my availability" (2026-10-19).
 */
function HomecareDashboard() {
  const { user } = useAuth()
  const { known } = usePermissions()
  if (!known) return null
  const Home = CAREGIVER_SEATS.includes(String(user?.role || '')) ? visits.CaregiverHome : office.OfficeHome
  return <HomecareFrame><Home /></HomecareFrame>
}
export const dashboard = HomecareDashboard

/** Routes inside /crm (behind the CRM's first-run gate), each in the agency's frame. */
export const routes: ReactElement[] = isHomecare ? [
  <Route key="homecare-frame" element={<HomecareFrame />}>
    {GROUPS.flatMap((g) => g.routes)}
  </Route>,
  // The template's own addresses for pages the shared app has under another name.
  <Route key="homecare-settings-security" path="security" element={<Navigate to="/crm/account" replace />} />,
  ...SETTINGS_HIDDEN.map((to) => <Route key={`homecare-hidden-${to}`} path={to.replace('/crm/', '')} element={<Navigate to="/crm/settings" replace />} />),
  // The shared Invoices is not an agency's (SHARED_HIDDEN): its addresses open the agency's Billing.
  <Route key="homecare-invoices" path="invoices" element={<Navigate to="/crm/billing" replace />} />,
  <Route key="homecare-invoice" path="invoices/:id" element={<Navigate to="/crm/billing" replace />} />,
] : []

/**
 * The agency's public pages, outside the shell (no sign-in): the client and family portals, paying a visit invoice, a
 * new hire's onboarding packet and the careers page (templates/crm-homecare App.tsx). Served by the server only for
 * home care (server/http/adminScreens.ts HOMECARE_PAGES). Their own bundle: none of it loads for the office.
 */
const PublicApp = page(() => import('../pages/homecare/publicApp'))
export const PUBLIC_PATHS = ['/portal/*', '/family/*', '/d/:token', '/pay/:invoiceId', '/payment-success', '/onboarding/:token', '/careers', '/careers/:slug']
export const publicRoutes: ReactElement[] = isHomecare
  ? PUBLIC_PATHS.map((path) => <Route key={`homecare-public-${path}`} path={path} element={<PublicApp />} />)
  : []
