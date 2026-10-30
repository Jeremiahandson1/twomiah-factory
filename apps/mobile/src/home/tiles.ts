/**
 * THE HOME SCREEN'S TILES — which a seat gets, what number each says, and the list it opens.
 *
 * Pure (no React, no native modules), so the home screen draws from it and tests/mobile + apps/unified/tests/mobile-home-tiles
 * run the very same rules against a real server. The rules are the desktop's (apps/unified/scripts/mobile-parity.ts JOBS_TILES /
 * HOMECARE_OFFICE_TILES read the desktop's own source and hold this file to it):
 *   · a tile the seat may not open is absent — its permission (`any`), its business switch (`feature`);
 *   · the server leaves out a figure the seat may not see (money, the lead inbox), and a tile with no figure is absent too —
 *     never "$0";
 *   · a tile OPENS the list of exactly what it counts: `list` is the request the list screen makes, and the server answers it
 *     with the condition the count used (packages/tenant-backend reporting/tileConditions.ts, the home care and roofing/RV
 *     tiles.ts) — so the list's length is the number.
 */
import type { Vertical } from '../vertical/verticals'
import { SALON_TILES } from '../trades/salon'
import { RESTAURANT_TILES } from '../trades/restaurant'
import { BAR_TILES } from '../trades/bar'
import { STORE_TILES } from '../trades/store'
import { VET_TILES } from '../trades/vet'

/** One request: a path and its query, in the order written. */
export interface Req { path: string; query?: Record<string, string> }
export type ListScreen = 'new-leads' | 'jobs' | 'quotes' | 'invoices' | 'projects' | 'rows' | 'trade'

export interface TileDef {
  id: string
  label: string
  icon: string
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'info'
  /** The seat needs ANY of these permissions (the desktop's own check for the card). Empty: no permission. */
  any?: string[]
  /** The business needs this switch on (Settings › Features). */
  feature?: string
  /** Money: absent for a seat that may not see money (the server also leaves the figure out). */
  money?: boolean
  /** Where the number comes from: a request made once for the whole home, and how to read the figure out of its answer. */
  source: string
  value: (body: any) => number | undefined
  /** Plain words for "Opens …" — read by a screen reader. */
  opens: string
  /** The list this tile opens (what the list screen asks the server) and how to read how many rows it holds. */
  list: Req
  screen: ListScreen
  /** screen 'trade': the trade-kit screen (src/trades) that draws this tile's rows. */
  spec?: string
  total: (body: any) => number
  /** The banner on the list: short, in plain words ("New leads · 4"). */
  banner: string
}

export const reqUrl = (r: Req) => r.path + (r.query && Object.keys(r.query).length ? '?' + new URLSearchParams(r.query).toString() : '')

const STATS = '/api/dashboard/stats'
const SUMMARY = '/api/dashboard/summary'
const paged = (b: any): number => Number(b?.pagination?.total ?? (Array.isArray(b?.data) ? b.data.length : Array.isArray(b) ? b.length : 0))

// ── contractor, basic, field service, landscaping — the shared jobs dashboard ───────────────────────────────
const jobsFamily = (jobsToday: string): TileDef[] => [
  { id: 'new-leads', label: 'New leads', icon: 'person-add', tone: 'accent', any: ['leads:read'], source: STATS, value: (s) => s?.newLeads,
    opens: 'the new leads', list: { path: '/api/dashboard/new-leads' }, screen: 'new-leads', total: paged, banner: 'New leads' },
  { id: 'active-projects', label: 'Active projects', icon: 'folder-open', tone: 'info', feature: 'projects', source: STATS, value: (s) => s?.projects?.byStatus?.active ?? (s?.projects ? 0 : undefined),
    opens: 'the active projects', list: { path: '/api/projects', query: { status: 'active' } }, screen: 'projects', total: paged, banner: 'Active projects' },
  { id: 'jobs-today', label: jobsToday, icon: 'hammer', tone: 'accent', any: ['jobs:read'], source: STATS, value: (s) => s?.jobs?.today,
    opens: "today's work", list: { path: '/api/jobs', query: { tile: 'today' } }, screen: 'jobs', total: paged, banner: jobsToday },
  { id: 'pending-quotes', label: 'Pending quotes', icon: 'document-text', tone: 'warning', any: ['quotes:read'], source: STATS, value: (s) => s?.quotes?.pending,
    opens: 'the quotes waiting on a customer', list: { path: '/api/quotes', query: { tile: 'pending' } }, screen: 'quotes', total: paged, banner: 'Pending quotes' },
  { id: 'open-invoices', label: 'Open invoices', icon: 'receipt', tone: 'warning', any: ['invoices:read'], money: true, source: STATS, value: (s) => s?.invoices?.outstanding,
    opens: 'the invoices still owed', list: { path: '/api/invoices', query: { tile: 'open' } }, screen: 'invoices', total: paged, banner: 'Open invoices' },
  { id: 'outstanding', label: 'Outstanding', icon: 'cash', tone: 'danger', any: ['invoices:read'], money: true, source: STATS, value: (s) => s?.invoices?.outstandingValue,
    opens: 'the invoices that make up what is owed', list: { path: '/api/invoices', query: { tile: 'open' } }, screen: 'invoices', total: paged, banner: 'Owed' },
]

// ── roofing ─────────────────────────────────────────────────────────────────────────────────────────────────
const ROOF: TileDef[] = [
  { id: 'new-leads', label: 'New leads', icon: 'person-add', tone: 'accent', any: ['leads:read'], source: STATS, value: (s) => s?.newLeads,
    opens: 'the new leads', list: { path: '/api/dashboard/new-leads' }, screen: 'new-leads', total: paged, banner: 'New leads' },
  { id: 'inspections-today', label: 'Inspections today', icon: 'search', tone: 'info', any: ['jobs:read'], source: STATS, value: (s) => s?.jobs?.inspectionsToday,
    opens: "today's inspections", list: { path: '/api/jobs', query: { tile: 'inspections-today' } }, screen: 'jobs', total: paged, banner: 'Inspections today' },
  { id: 'installs-today', label: 'Installs today', icon: 'hammer', tone: 'accent', any: ['jobs:read'], source: STATS, value: (s) => s?.jobs?.installsToday,
    opens: "today's installs", list: { path: '/api/jobs', query: { tile: 'installs-today' } }, screen: 'jobs', total: paged, banner: 'Installs today' },
  { id: 'open-jobs', label: 'Open jobs', icon: 'construct', tone: 'accent', any: ['jobs:read'], source: STATS, value: (s) => s?.jobs?.open,
    opens: 'the jobs still running', list: { path: '/api/jobs', query: { tile: 'open' } }, screen: 'jobs', total: paged, banner: 'Open jobs' },
  { id: 'pending-quotes', label: 'Pending quotes', icon: 'document-text', tone: 'warning', any: ['quotes:read'], source: STATS, value: (s) => s?.quotes?.pending,
    opens: 'the quotes waiting on a customer', list: { path: '/api/quotes', query: { tile: 'pending' } }, screen: 'quotes', total: paged, banner: 'Pending quotes' },
  { id: 'open-invoices', label: 'Open invoices', icon: 'receipt', tone: 'warning', any: ['invoices:read'], money: true, source: STATS, value: (s) => s?.invoices?.outstanding,
    opens: 'the invoices still owed', list: { path: '/api/invoices', query: { tile: 'open' } }, screen: 'invoices', total: paged, banner: 'Open invoices' },
  { id: 'outstanding', label: 'Outstanding', icon: 'cash', tone: 'danger', any: ['invoices:read'], money: true, source: STATS, value: (s) => s?.invoices?.outstandingValue,
    opens: 'the invoices that make up what is owed', list: { path: '/api/invoices', query: { tile: 'open' } }, screen: 'invoices', total: paged, banner: 'Owed' },
]

/** The roofing pipeline, in order (apps/unified/server/crm/roof/validation.ts PIPELINE_STATUSES). */
export const ROOF_STAGES = [
  'lead', 'inspection_scheduled', 'inspected', 'measurement_ordered', 'proposal_sent',
  'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected',
] as const
export const stageLabel = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
export interface Stage { id: string; label: string; count: number; list: Req }
/** One row per stage this business walks (measurement_ordered only with Measurement Reports on), each opening that stage's jobs. */
export function roofStages(stats: any, hasFeature: (f: string) => boolean, nameOf?: (stage: string) => string | undefined): Stage[] {
  const by = stats?.jobs?.byStatus || {}
  return ROOF_STAGES.filter((s) => s !== 'measurement_ordered' || hasFeature('measurement_reports'))
    .map((s) => ({ id: s, label: nameOf?.(s) ?? stageLabel(s), count: Number(by[s] || 0), list: { path: '/api/jobs', query: { status: s } } }))
}

// ── RV / powersports dealership ─────────────────────────────────────────────────────────────────────────────
const RV: TileDef[] = [
  { id: 'inventory', label: 'Inventory', icon: 'car-sport', tone: 'accent', any: ['contacts:read'], feature: 'unit_inventory', source: STATS, value: (s) => s?.inventory?.total,
    opens: 'every unit on the lot', list: { path: '/api/units' }, screen: 'rows', total: paged, banner: 'Inventory' },
  { id: 'open-leads', label: 'Open leads', icon: 'people', tone: 'info', any: ['contacts:read'], feature: 'deal_pipeline', source: STATS, value: (s) => s?.sales?.openLeads,
    opens: 'the leads still being worked', list: { path: '/api/sales-leads', query: { tile: 'open' } }, screen: 'rows', total: paged, banner: 'Open leads' },
  { id: 'open-repair-orders', label: 'Open repair orders', icon: 'build', tone: 'warning', any: ['contacts:read'], feature: 'service_dept', source: STATS, value: (s) => s?.service?.openRepairOrders,
    opens: 'the repair orders not finished', list: { path: '/api/repair-orders', query: { tile: 'open' } }, screen: 'rows', total: paged, banner: 'Open repair orders' },
]

// ── home care — the office's overview ───────────────────────────────────────────────────────────────────────
const COUNTS = ['care-billing:read', 'care-office:read']
const tileSrc = (id: string) => `/api/dashboard/tile/${id}`
const care = (id: string, label: string, icon: string, tone: TileDef['tone'], any: string[], value: (b: any) => number | undefined, opens: string, extra: Partial<TileDef> = {}): TileDef => ({
  id, label, icon, tone, any, source: SUMMARY, value, opens, list: { path: tileSrc(id) }, screen: 'rows', total: paged, banner: label, ...extra,
})
const HOMECARE: TileDef[] = [
  care('active-clients', 'Active clients', 'people', 'accent', COUNTS, (s) => s?.totalClients, 'the active clients'),
  care('active-caregivers', 'Active caregivers', 'people-circle', 'accent', COUNTS, (s) => s?.activeCaregivers, 'the active caregivers'),
  care('pending-invoices', 'Pending invoices', 'receipt', 'warning', ['care-billing:read'], (s) => s?.pendingInvoices?.count, 'the invoices still owed', { money: true }),
  care('month-revenue', 'This month revenue', 'cash', 'success', ['care-billing:read'], (s) => s?.thisMonthRevenue, "this month's payments", { money: true, total: (b) => Number(b?.total ?? 0) }),
  care('shifts-today', 'Shifts today', 'calendar', 'info', COUNTS, (s) => s?.todayShifts, "today's visits"),
  care('clocked-in-now', 'Clocked in now', 'checkmark-circle', 'success', COUNTS, (s) => s?.clockedInNow, 'the caregivers clocked in'),
  care('shifts-remaining', 'Shifts remaining', 'time', 'warning', COUNTS, (s) => s?.remainingShifts, "today's visits not started"),
  care('coverage-gaps', 'Coverage gaps', 'alert-circle', 'danger', COUNTS, (s) => s?.coverageGaps, 'the visits that need cover'),
  // The to-do list: the number is how many things are on it; it opens those lines (each with its own count).
  { id: 'action-items', label: 'Action items', icon: 'checkbox', tone: 'warning', any: ['care-schedule:update'], source: '/api/dashboard/action-items', value: (b) => Array.isArray(b?.items) ? b.items.length : undefined,
    opens: 'the office to-do list', list: { path: '/api/dashboard/action-items' }, screen: 'rows', total: (b) => (Array.isArray(b?.items) ? b.items.length : 0), banner: 'Action items' },
  care('noshow-alerts', 'No-show alerts', 'warning', 'danger', ['care-schedule:update'], (b) => b?.pagination?.total, 'the open no-show alerts', { source: tileSrc('noshow-alerts') }),
  care('incident-responses', 'Incident responses due', 'document-text', 'danger', ['care-compliance:read'], (b) => b?.pagination?.total, 'the incident responses due', { source: tileSrc('incident-responses') }),
]

export function tilesFor(vertical: Vertical): TileDef[] {
  switch (vertical) {
    case 'roofing': return ROOF
    case 'rv': return RV
    case 'homecare': return HOMECARE
    case 'salon': return SALON_TILES
    case 'restaurant': return RESTAURANT_TILES
    case 'bar': return BAR_TILES
    case 'store': return STORE_TILES
    case 'vet': return VET_TILES
    case 'fieldservice': return jobsFamily('Service calls today')
    case 'contractor': case 'basic': case 'landscaping': return jobsFamily('Jobs today')
    default: return []
  }
}

export interface Ctx { can: (permission: string) => boolean; hasFeature: (feature: string) => boolean }
/** Could this seat open the tile's list at all? (permission and switch — not the figure) */
export const mayOpen = (t: TileDef, ctx: Ctx) => (!t.any || !t.any.length || t.any.some((p) => ctx.can(p))) && (!t.feature || ctx.hasFeature(t.feature))

/** The requests the home must make, once each, for the tiles this seat may open. */
export function sourcesFor(vertical: Vertical, ctx: Ctx): string[] {
  return [...new Set(tilesFor(vertical).filter((t) => mayOpen(t, ctx)).map((t) => t.source))]
}
/** The home's tiles for this seat, in the desktop's order, with their numbers (a tile with no figure is left out). */
export interface Shown { def: TileDef; value: number; text: string }
export const dollars = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
export function resolveTiles(vertical: Vertical, ctx: Ctx, answers: Record<string, any>): Shown[] {
  const out: Shown[] = []
  for (const def of tilesFor(vertical)) {
    if (!mayOpen(def, ctx)) continue
    const v = def.value(answers[def.source])
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    out.push({ def, value: v, text: def.id === 'outstanding' || def.id === 'month-revenue' ? dollars(v) : String(v) })
  }
  return out
}

/** Where a tile's list lives on the phone (expo-router paths) — one rule for the home screen and the tests. */
export function tileRoute(def: TileDef, vertical: string): { pathname: string; params: { tile: string; spec?: string } } {
  const params = { tile: def.id }
  switch (def.screen) {
    case 'new-leads': return { pathname: '/(details)/leads', params }
    case 'jobs': return { pathname: vertical === 'fieldservice' ? '/(tabs)/service-calls' : '/(tabs)/jobs', params }
    case 'quotes': return { pathname: '/(tabs)/quotes', params }
    case 'invoices': return { pathname: '/(details)/invoices', params }
    case 'trade': return { pathname: '/(details)/t/[spec]', params: { ...params, spec: def.spec || '' } }
    default: return { pathname: '/(details)/rows', params } // projects, home care and the dealership's rows
  }
}

/** The short banner over a tile's list: "New leads · 4". The × beside it clears the filter. */
export const bannerText = (label: string, count?: number) => (count == null ? label : `${label} · ${count}`)
