import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import quickbooks from '../services/quickbooks.ts'
import glPosting from '../services/glPosting.ts'

// ── Accounting / GL ─────────────────────────────────────────────────────────
// Native general ledger. Real revenue + COGS + gross profit posted from counter
// sales and repair orders (services/glPosting.ts). QuickBooks push is switch-ready:
// connected=false surfaces a "Connect" CTA; sync marks entries posted (stub until
// QBO OAuth), then a live QuickBooks provider drops in without changing this route.
const app = new Hono()
app.use('*', authenticate)

app.get('/status', async (c) => {
  const u = c.get('user') as any
  let connected = false
  try { const qb: any = await quickbooks.getConnectionStatus(u.companyId); connected = !!qb?.connected } catch { /* not connected */ }
  const configured = !!(process.env.QBO_CLIENT_ID && process.env.QBO_REDIRECT_URI)
  const summary = await glPosting.summary(u.companyId)
  return c.json({
    provider: 'QuickBooks Online',
    connected, configured,
    totals: summary.totals,
    byCategory: summary.byCategory,
    pending: summary.qbPending,
  })
})

app.get('/entries', async (c) => {
  const u = c.get('user') as any
  const limit = parseInt(c.req.query('limit') || '0') || 100
  const from = c.req.query('from') || undefined
  const to = c.req.query('to') || undefined
  return c.json(await glPosting.listEntries(u.companyId, { limit, from, to }))
})

app.get('/summary', async (c) => {
  const u = c.get('user') as any
  return c.json(await glPosting.summary(u.companyId))
})

app.post('/sync', async (c) => {
  const u = c.get('user') as any
  const result = await glPosting.syncToQb(u.companyId)
  if (!result.posted) return c.json({ error: 'Nothing to sync.' }, 400)
  return c.json({ result, provider: 'QuickBooks Online' })
})

export default app
