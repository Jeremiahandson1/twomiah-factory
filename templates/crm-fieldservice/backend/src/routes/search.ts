import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { enabledFeaturesFor } from '../middleware/enabledFeature.ts'
import search from '../services/search.ts'

const app = new Hono()
app.use('*', authenticate)

// Search only shows what this tenant can open. A result type whose module is switched off — or that this CRM
// does not have at all (false) — is left out of search, quick search and Recent, and cannot be asked for with
// ?types=. The same gates the API applies (index.ts, #167); scripts/check-search-feature-gates.ts keeps the two
// in step. Types not listed are always shown. (events T18: "review jobs" under Recent on a tenant with Jobs off)
// `project` joins the list with T18 M6: /api/projects is gated on `projects` now, and search that
// still returned project rows would hand back links the API refuses to open.
const TYPE_FEATURES: Record<string, string[] | false> = { rfi: false, project: ['projects'] }

/**
 * …and what the SEARCHER has to be allowed to read.
 *
 * The map above asks whether the tenant has the module. It never asked whether this person may read
 * that kind of record, so a field technician — correctly refused 403 by /api/invoices — was handed
 * invoice rows with amounts on them by the search box. A result is a door: returning one the API will
 * refuse to open is a leak and a dead link at once.
 *
 * Each pair is the permission that type's OWN list route already requires, not a new rule invented here;
 * scripts/check-search-permission-gates.ts holds the two together. A type whose list route asks for
 * nothing (document, project, rfi) has no entry, because there is no door to mirror.
 * (Field Service T30 HIGH)
 */
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
}

async function shownTypes(companyId: string, user?: any) {
  const extra = user ? await getExtraPermissions(user.userId) : []
  const enabled = await enabledFeaturesFor(companyId)
  return (type: string) => {
    const gate = TYPE_FEATURES[type]
    const moduleOn = gate === undefined || (gate !== false && gate.some((f) => enabled.includes(f)))
    if (!moduleOn) return false
    const needs = TYPE_PERMISSIONS[type]
    return !needs || !user || hasPermission(user.role, needs, extra)
  }
}

// Global search
app.get('/', async (c) => {
  const user = c.get('user') as any
  const q = c.req.query('q')
  const limit = c.req.query('limit') || '20'
  const types = c.req.query('types')
  const shown = await shownTypes(user.companyId, user)

  const result = await search.globalSearch(
    user.companyId,
    q,
    {
      limit: Math.min(parseInt(limit), 50),
      types: types ? types.split(',').filter(shown) : null,
    }
  )

  const results = result.results.filter((r: any) => shown(r.type))
  return c.json({ ...result, results, count: results.length })
})

// Quick search (lighter)
app.get('/quick', async (c) => {
  const user = c.get('user') as any
  const q = c.req.query('q')
  const limit = c.req.query('limit') || '10'
  const shown = await shownTypes(user.companyId, user)
  const results = await search.quickSearch(
    user.companyId,
    q,
    Math.min(parseInt(limit), 20)
  )
  return c.json(results.filter((r: any) => shown(r.type)))
})

// Recent items (for empty search state)
app.get('/recent', async (c) => {
  const user = c.get('user') as any
  const limit = c.req.query('limit') || '10'
  const shown = await shownTypes(user.companyId, user)
  const results = await search.getRecentItems(
    user.companyId,
    Math.min(parseInt(limit), 20)
  )
  return c.json(results.filter((r: any) => shown(r.type)))
})

export default app
