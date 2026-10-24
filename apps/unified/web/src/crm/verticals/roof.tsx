// Roofing: its own screens (crm/pages/roof/{jobs,insurance,reports,field}) — docs/UNIFIED_ROOF_SCREENS.md. Its customers,
// quotes, invoices, documents and the rest are the CRM's shared screens; its jobs pages are roofing's own, over the CRM's
// job (the server's /api/jobs is roofing's module for this vertical), so they are registered before the CRM's.
import type { ReactElement } from 'react'
import { Calculator } from 'lucide-react'
import type { NavItem } from '../../shared'
import { verticalScreens } from '../vertical'
import * as jobs from '../pages/roof/jobs'
import * as insurance from '../pages/roof/insurance'
import * as reports from '../pages/roof/reports'
import * as field from '../pages/roof/field'

const home = verticalScreens().home
/** True where this page was served for a roofer (verticals/roof/settings.ts screens.home). Read once. */
export const isRoofing = typeof home === 'string' && home === 'roofing'

const GROUPS = [jobs, insurance, reports, field]

/** Routes inside /crm, for a roofer only (one route per path: roofing's /crm/jobs is the page for its /api/jobs). */
export const routes: ReactElement[] = isRoofing ? GROUPS.flatMap((g) => g.routes) : []
/** Menu items, for a roofer only, each behind the feature and permission roofing's menu used. */
export const nav: NavItem[] = isRoofing ? GROUPS.flatMap((g) => g.nav) : []
/**
 * The shared menu items a roofer doesn't get, because roofing's own page is at that address (its pipeline is the home,
 * its jobs and reports pages are roofing's) — and the shared Reports item's `reports` feature and reports:read gate,
 * matched by path, is roofing's own item's (it asks reports:read too).
 */
export const SHARED_REPLACED = ['/crm/dashboard', '/crm/jobs', '/crm/reports']

// Roofing's menu (templates/crm-roof components/layout/AppLayout.tsx): its working items first, shared ones among them.
// The Lead Inbox and Storm Leads sit with the contacts: at the shared menu's end the inbox fell under the Website heading
// and the storm leads under the field tools, where a roofer never looked (live test 2026-10-22).
const LEAD = ['/crm/pipeline', '/crm/jobs', '/crm/contacts', '/crm/leads', '/crm/storm-leads', '/crm/crews', '/crm/measurements', '/crm/materials', '/crm/quotes', '/crm/invoices', '/crm/adjusters']
// …and its field tools under their own heading.
const FIELD = ['/crm/canvassing', '/crm/storm-radar', '/crm/estimator', '/crm/roof-reports']

/**
 * A roofer's whole menu from the shared one: roofing's order — its working items first under Business, roofing's own
 * Reports where the shared Reports stood, its field tools under a Roofing heading before the shared sections. The
 * shared items at addresses roofing's pages hold are dropped. Each item keeps its own feature and permission gate.
 */
export function roofingMenu(shared: NavItem[]): NavItem[] {
  const own = new Map(nav.map((i) => [i.to, i]))
  const base = shared.filter((i) => !nav.includes(i) && !SHARED_REPLACED.includes(i.to))
  const theirs = new Map(base.map((i) => [i.to, i]))
  const pick = (to: string) => own.get(to) ?? theirs.get(to)
  const lead = LEAD.map(pick).filter(Boolean) as NavItem[]
  const field = FIELD.map(pick).filter(Boolean) as NavItem[]
  if (lead[0]) lead[0] = { ...lead[0], section: 'Business' }
  if (field[0]) field[0] = { ...field[0], section: 'Roofing' }
  const used = new Set([...LEAD, ...FIELD])
  const rest = base.filter((i) => !used.has(i.to))
  const reports = own.get('/crm/reports')
  const at = rest.findIndex((i) => i.to === '/crm/job-costing' || i.to === '/crm/lead-sources')
  if (reports) rest.splice(at === -1 ? rest.length : at, 0, reports)
  // The Business block runs until the first shared item that opens another heading; the field tools go there.
  const split = rest.findIndex((i) => !!i.section)
  const cut = split === -1 ? rest.length : split
  return [...lead, ...rest.slice(0, cut), ...field, ...rest.slice(cut)]
}
/** The permission each roofing page asks, for a URL typed in (the shell's routePermissions). */
export const routePermissions: Record<string, string> = isRoofing ? Object.assign({}, ...GROUPS.map((g) => g.routePermissions)) : {}
/**
 * The canvasser's full-screen view (a phone in one hand at a door), outside the shell at /crm/canvass — App.tsx mounts it
 * for a roofer only; the page itself checks canvassing_tool (the shell's gate doesn't reach outside the shell).
 */
export const CanvassView = field.canvassView
/**
 * Roofing's own Settings card (the template's "Instant Estimator Widget"): the widget's headline, prices and embed
 * snippet — for whoever may change the company (PUT /api/settings/estimator asks company:update), with the estimator on.
 */
export const SETTINGS_EXTRA = isRoofing
  ? [{ to: '/crm/settings/estimator', label: 'Instant Estimator Widget', icon: Calculator, permission: 'company:update', feature: 'instant_estimator' }]
  : []
/** The roofer's home at /crm/dashboard (crm/screens.tsx HOMES). */
export const dashboard = jobs.dashboard
