import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import search from '../services/search.ts'

const app = new Hono()
app.use('*', authenticate)

// Global search
app.get('/', async (c) => {
  const user = c.get('user') as any
  const q = c.req.query('q')
  const limit = c.req.query('limit') || '20'
  const types = c.req.query('types')

  const result = await search.globalSearch(
    user.companyId,
    q,
    {
      limit: Math.min(parseInt(limit), 50),
      types: types ? types.split(',') : null,
    }
  )

  return c.json(result)
})

// Quick search (lighter)
app.get('/quick', async (c) => {
  const user = c.get('user') as any
  const q = c.req.query('q')
  const limit = c.req.query('limit') || '10'
  const results = await search.quickSearch(
    user.companyId,
    q,
    Math.min(parseInt(limit), 20)
  )
  return c.json(results)
})

// Recent items (for empty search state)
app.get('/recent', async (c) => {
  const user = c.get('user') as any
  const limit = c.req.query('limit') || '10'
  const results = await search.getRecentItems(
    user.companyId,
    Math.min(parseInt(limit), 20)
  )
  return c.json(results)
})

export default app
