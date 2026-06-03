import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { providerIntegration } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import * as eagleview from '../services/eagleview.ts'
import * as hover from '../services/hover.ts'

const app = new Hono()

const VALID_PROVIDERS = ['eagleview', 'hover'] as const
type Provider = typeof VALID_PROVIDERS[number]

function validateProvider(provider: string): provider is Provider {
  return VALID_PROVIDERS.includes(provider as Provider)
}

function getService(provider: Provider) {
  return provider === 'eagleview' ? eagleview : hover
}

// PUT /:provider/credentials — save BYOA client ID + secret
app.put('/:provider/credentials', authenticate, async (c) => {
  const provider = c.req.param('provider')
  if (!validateProvider(provider)) return c.json({ error: 'Invalid provider' }, 400)

  const { companyId } = c.get('user') as any
  const schema = z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  const data = schema.parse(await c.req.json())

  // Upsert credentials
  const [existing] = await db.select().from(providerIntegration)
    .where(and(
      eq(providerIntegration.companyId, companyId),
      eq(providerIntegration.provider, provider),
    )).limit(1)

  if (existing) {
    await db.update(providerIntegration).set({
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      updatedAt: new Date(),
    }).where(eq(providerIntegration.id, existing.id))
  } else {
    await db.insert(providerIntegration).values({
      companyId,
      provider,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
    })
  }

  return c.json({ success: true })
})

// GET /:provider/connect — initiate OAuth redirect
app.get('/:provider/connect', authenticate, async (c) => {
  const provider = c.req.param('provider')
  if (!validateProvider(provider)) return c.json({ error: 'Invalid provider' }, 400)

  const { companyId } = c.get('user') as any

  const [integration] = await db.select().from(providerIntegration)
    .where(and(
      eq(providerIntegration.companyId, companyId),
      eq(providerIntegration.provider, provider),
    )).limit(1)

  if (!integration?.clientId || !integration?.clientSecret) {
    return c.json({ error: 'Please save your API credentials first' }, 400)
  }

  const redirectUri = provider === 'eagleview'
    ? (process.env.EAGLEVIEW_REDIRECT_URI || `${process.env.APP_URL || ''}/api/integrations/eagleview/callback`)
    : (process.env.HOVER_REDIRECT_URI || `${process.env.APP_URL || ''}/api/integrations/hover/callback`)

  const service = getService(provider)
  const url = service.getAuthUrl(companyId, integration.clientId, redirectUri)
  return c.redirect(url)
})

// GET /:provider/callback — OAuth callback (no auth middleware)
app.get('/:provider/callback', async (c) => {
  const provider = c.req.param('provider')
  if (!validateProvider(provider)) return c.json({ error: 'Invalid provider' }, 400)

  const code = c.req.query('code')
  const state = c.req.query('state')

  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400)

  let companyId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
    companyId = decoded.companyId
  } catch {
    return c.json({ error: 'Invalid state parameter' }, 400)
  }

  try {
    const service = getService(provider)
    await service.handleCallback(code, companyId)
    return c.redirect(`/crm/settings?connected=${provider}`)
  } catch (err: any) {
    return c.json({ error: `Failed to connect ${provider}: ${err.message}` }, 500)
  }
})

// POST /:provider/disconnect
app.post('/:provider/disconnect', authenticate, async (c) => {
  const provider = c.req.param('provider')
  if (!validateProvider(provider)) return c.json({ error: 'Invalid provider' }, 400)

  const { companyId } = c.get('user') as any
  const service = getService(provider)
  await service.disconnect(companyId)
  return c.json({ success: true })
})

// GET /:provider/status
app.get('/:provider/status', authenticate, async (c) => {
  const provider = c.req.param('provider')
  if (!validateProvider(provider)) return c.json({ error: 'Invalid provider' }, 400)

  const { companyId } = c.get('user') as any
  const service = getService(provider)
  const status = await service.getStatus(companyId)
  return c.json(status)
})

export default app
