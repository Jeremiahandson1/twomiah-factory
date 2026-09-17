import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { enabledFeaturesFor } from '../middleware/enabledFeature.ts'
import search from '../services/search.ts'

const app = new Hono()
app.use('*', authenticate)

// Search only shows what this tenant can open. A result type whose module is switched off — or that this CRM
// does not have at all (false) — is left out of search, quick search and Recent, and cannot be asked for with
// ?types=. The same gates the API applies (index.ts, #167); scripts/check-search-feature-gates.ts keeps the two
// in step. Types not listed are always shown. (events T18: "review jobs" under Recent on a tenant with Jobs off)
const TYPE_FEATURES: Record<string, string[] | false> = { project: ['projects'], rfi: ['rfis'] }

async function shownTypes(companyId: string) {
  const enabled = await enabledFeaturesFor(companyId)
  return (type: string) => {
    const gate = TYPE_FEATURES[type]
    return gate === undefined || (gate !== false && gate.some((f) => enabled.includes(f)))
  }
}

// Global search
app.get('/', async (c) => {
  const user = c.get('user') as any
  const q = c.req.query('q')
  const limit = c.req.query('limit') || '20'
  const types = c.req.query('types')
  const shown = await shownTypes(user.companyId)

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
  const shown = await shownTypes(user.companyId)
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
  const shown = await shownTypes(user.companyId)
  const results = await search.getRecentItems(
    user.companyId,
    Math.min(parseInt(limit), 20)
  )
  return c.json(results.filter((r: any) => shown(r.type)))
})

export default app
