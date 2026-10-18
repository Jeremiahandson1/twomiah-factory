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
}

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

  app.get('/', async (c) => {
    const user = c.get('user')
    const limit = c.req.query('limit') || '20'
    const types = c.req.query('types')
    const shown = await shownTypes(user.companyId, user)
    const result = await search.globalSearch(user.companyId, c.req.query('q'), {
      limit: Math.min(parseInt(limit), 50),
      types: types ? types.split(',').filter(shown) : null,
    })
    const results = result.results.filter((r: any) => shown(r.type))
    return one(c, { ...result, results, count: results.length })
  })

  app.get('/quick', async (c) => {
    const user = c.get('user')
    const limit = c.req.query('limit') || '10'
    const shown = await shownTypes(user.companyId, user)
    const results = (await search.quickSearch(user.companyId, c.req.query('q'), Math.min(parseInt(limit), 20))).filter((r: any) => shown(r.type))
    return list(c, results, { page: 1, limit: results.length, total: results.length })
  })

  app.get('/recent', async (c) => {
    const user = c.get('user')
    const limit = c.req.query('limit') || '10'
    const shown = await shownTypes(user.companyId, user)
    const results = (await search.getRecentItems(user.companyId, Math.min(parseInt(limit), 20))).filter((r: any) => shown(r.type))
    return list(c, results, { page: 1, limit: results.length, total: results.length })
  })

  return app
}
