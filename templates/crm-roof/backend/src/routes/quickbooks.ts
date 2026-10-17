import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { qbIntegration } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import * as qb from '../services/quickbooks.ts'

const app = new Hono()

// GET /auth-url — where to send the browser to connect QuickBooks. Settings fetches it with the session and then
// navigates. (It used to navigate to /connect directly: a page load carries no Authorization header, so authenticate
// answered 401 to every click.) Connecting the books is integrations:create, like disconnect and sync below.
app.get('/auth-url', authenticate, requirePermission('integrations:create'), async (c) => {
  if (!qb.isConfigured()) return c.json({ error: 'QuickBooks is not set up on this server yet.' }, 503)
  const { companyId } = c.get('user')
  return c.json({ url: qb.getAuthUrl(companyId) })
})

// GET /connect — redirect to QuickBooks OAuth (kept for API callers that send the bearer token themselves)
app.get('/connect', authenticate, requirePermission('integrations:create'), async (c) => {
  if (!qb.isConfigured()) return c.json({ error: 'QuickBooks is not set up on this server yet.' }, 503)
  const { companyId } = c.get('user')
  const url = qb.getAuthUrl(companyId)
  return c.redirect(url)
})

// GET /callback — handle OAuth callback
app.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const realmId = c.req.query('realmId')

  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400)

  // Signed by getAuthUrl; arrives either straight from Intuit or through the Factory's relay — the same bytes either way.
  const companyId = qb.verifyState(state)
  if (!companyId) return c.json({ error: 'Invalid state parameter' }, 400)

  try {
    await qb.handleCallback(code, companyId)

    // Store realmId if provided
    if (realmId) {
      await db.update(qbIntegration).set({ realmId, updatedAt: new Date() })
        .where(eq(qbIntegration.companyId, companyId))
    }

    // Redirect to settings page
    return c.redirect('/crm/settings')
  } catch (err) {
    return c.json({ error: 'Failed to connect QuickBooks' }, 500)
  }
})

// POST /disconnect
app.post('/disconnect', authenticate, requirePermission('integrations:create'), async (c) => {
  const { companyId } = c.get('user')
  await qb.disconnect(companyId)
  return c.json({ success: true })
})

// GET /status
app.get('/status', authenticate, async (c) => {
  const { companyId } = c.get('user')
  const [integration] = await db.select({
    syncEnabled: qbIntegration.syncEnabled,
    lastSyncedAt: qbIntegration.lastSyncedAt,
    realmId: qbIntegration.realmId,
    createdAt: qbIntegration.createdAt,
  }).from(qbIntegration)
    .where(eq(qbIntegration.companyId, companyId))
    .limit(1)

  return c.json({
    connected: !!integration?.syncEnabled,
    lastSyncedAt: integration?.lastSyncedAt || null,
    realmId: integration?.realmId || null,
    connectedSince: integration?.createdAt || null,
  })
})

// POST /sync — full sync
app.post('/sync', authenticate, requirePermission('integrations:create'), async (c) => {
  const { companyId } = c.get('user')
  try {
    await qb.fullSync(companyId)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /sync/invoice/:id
app.post('/sync/invoice/:id', authenticate, requirePermission('integrations:create'), async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  try {
    const qbId = await qb.syncInvoice(companyId, id)
    return c.json({ success: true, qbInvoiceId: qbId })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /sync/contact/:id
app.post('/sync/contact/:id', authenticate, requirePermission('integrations:create'), async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  try {
    const qbId = await qb.syncContact(companyId, id)
    return c.json({ success: true, qbCustomerId: qbId })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

export default app
