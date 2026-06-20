/**
 * Trade-In Valuation Routes
 *
 * Exposes book-value estimates from the configured provider (J.D. Power /
 * Black Book) for the deal desk and the website "Value My Trade" flow.
 */
import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import valuation from '../services/valuation.ts'

const app = new Hono()
app.use('*', authenticate)

// List providers + which one is enabled for this company
app.get('/providers', async (c) => {
  const user = c.get('user') as any
  const enabled = await valuation.getEnabledValuationProvider(user.companyId)
  return c.json(valuation.getAllValuationProviders().map((p) => ({
    name: p.name,
    displayName: p.displayName,
    logo: p.logo,
    description: p.description,
    enabled: enabled?.provider.name === p.name,
  })))
})

// Estimate a trade-in value
app.post('/estimate', async (c) => {
  const user = c.get('user') as any
  const trade = await c.req.json().catch(() => ({}))
  const result = await valuation.getTradeValuation(user.companyId, trade)
  return c.json(result)
})

export default app
