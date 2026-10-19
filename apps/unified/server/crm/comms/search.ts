// /api/search — the global search box, quick search and recent items. Moved from templates/crm/backend/src/routes/
// search.ts; the queries are in searchService.ts.
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createSearchService } from './searchService.ts'

// Search only shows what this tenant can open: a result type whose module is switched off — or that this CRM does
// not have at all (false) — is left out of search, quick search and Recent, and cannot be asked for with ?types=.
// Types not listed are always shown.
// The core records need their own features too: a website-only business keeps website enquiries as contacts, and
// has no CRM to open them in. Documents live with the CRM's records, so they follow contacts.
const TYPE_FEATURES: Record<string, string[] | false> = {
  project: ['projects'], rfi: ['rfis'], contact: ['contacts'], job: ['jobs'], quote: ['quotes'], invoice: ['invoices'],
  team: ['team'], document: ['contacts'],
  // A venue's events, rooms and catering packages, each with its module (templates/crm-restaurant services/search.ts).
  event: ['event_bookings'], space: ['event_spaces'], menu: ['catering_menus'],
  // A clinic's patients (templates/crm-vet services/search.ts).
  patient: ['patient_records'],
  // A bar's menu items and taps (templates/crm-bar services/search.ts and its search route's gates).
  item: ['bar_menu'], tap: ['bar_menu'],
  // A dealership's units (templates/crm-rv routes/search.ts).
  unit: ['unit_inventory'],
  // A salon's service menu (templates/crm-salon services/search.ts).
  service: ['service_menu'],
}

// What the search box looks through when it isn't told: everything below that this business has switched on and this
// person may read (the base set, and a venue's own records — the restaurant copy searched events, spaces and menus in
// place of projects and jobs, which a venue doesn't have switched on). 'patient' first, as searchService.ts orders it:
// the pet is what a clinic searches by.
// 'unit' first beside it: a dealership searches by stock number, VIN or model (RV T19 M7).
// 'service' beside contacts: a salon searches its menu where a contractor searches projects and jobs.
const DEFAULT_TYPES = ['patient', 'unit', 'contact', 'service', 'project', 'job', 'quote', 'invoice', 'document', 'event', 'space', 'menu', 'item', 'tap']

// …and what the SEARCHER may read: each pair is the permission that type's own list route requires, so a result
// is never a door the API will refuse to open. A type whose list route asks for nothing has no entry.
const TYPE_PERMISSIONS: Record<string, string> = {
  invoice: 'invoices:read',
  quote: 'quotes:read',
  job: 'jobs:read',
  team: 'team:read',
  contact: 'contacts:read',
  patient: 'contacts:read',
  unit: 'contacts:read',
  event: 'contacts:read',
  service: 'contacts:read',
  menu: 'contacts:read',
  space: 'contacts:read',
  // the bar's menu items and taps: their list routes ask bar:read (server/crm/bar/barRoutes.ts)
  item: 'bar:read',
  tap: 'bar:read',
}

export function createSearchRoutes(d: CrmDeps) {
  const { hasPermission, getExtraPermissions } = d.permissions
  const search = createSearchService(d.db)
  const app = new Hono<AppEnv>()

  async function shownTypes(companyId: string, user?: any) {
    const extra = user ? await getExtraPermissions(user.userId) : []
    const enabled = await d.features.enabledFeaturesFor(companyId)
    return (type: string) => {
      const gate = TYPE_FEATURES[type]
      const moduleOn = gate === undefined || (gate !== false && gate.some((f) => enabled.includes(f)))
      if (!moduleOn) return false
      const needs = TYPE_PERMISSIONS[type]
      return !needs || !user || hasPermission(user.role, needs, extra)
    }
  }

  /** A client opens on their chart where the business keeps charts (client_profiles; Salon T28 L7). */
  const clientChartOn = async (companyId: string) => (await d.features.enabledFeaturesFor(companyId)).includes('client_profiles')

  app.get('/', async (c) => {
    const user = c.get('user')
    const limit = c.req.query('limit') || '20'
    const types = c.req.query('types')
    const shown = await shownTypes(user.companyId, user)
    const result = await search.globalSearch(user.companyId, c.req.query('q'), {
      limit: Math.min(parseInt(limit), 50),
      types: (types ? types.split(',') : DEFAULT_TYPES).filter(shown),
      clientChart: await clientChartOn(user.companyId),
    })
    const results = result.results.filter((r: any) => shown(r.type))
    return one(c, { ...result, results, count: results.length })
  })

  app.get('/quick', async (c) => {
    const user = c.get('user')
    const limit = c.req.query('limit') || '10'
    const shown = await shownTypes(user.companyId, user)
    const results = (await search.quickSearch(user.companyId, c.req.query('q'), Math.min(parseInt(limit), 20), {
      types: DEFAULT_TYPES.filter(shown), clientChart: await clientChartOn(user.companyId),
    })).filter((r: any) => shown(r.type))
    return list(c, results, { page: 1, limit: results.length, total: results.length })
  })

  app.get('/recent', async (c) => {
    const user = c.get('user')
    const limit = c.req.query('limit') || '10'
    const shown = await shownTypes(user.companyId, user)
    const results = (await search.getRecentItems(user.companyId, Math.min(parseInt(limit), 20), await clientChartOn(user.companyId))).filter((r: any) => shown(r.type))
    return list(c, results, { page: 1, limit: results.length, total: results.length })
  })

  return app
}
