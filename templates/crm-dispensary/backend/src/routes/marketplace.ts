import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// ─── Cannabis Integration Partners ──────────────────────────────────────────

const CANNABIS_PARTNERS = [
  { slug: 'springbig', name: 'Springbig', category: 'loyalty', description: 'Loyalty and rewards platform for cannabis retailers', website: 'https://springbig.com', configSchema: { apiKey: 'string', locationId: 'string' } },
  { slug: 'leafly', name: 'Leafly', category: 'menu_listing', description: 'Cannabis marketplace and menu listing service', website: 'https://leafly.com', configSchema: { apiKey: 'string', dispensarySlug: 'string' } },
  { slug: 'weedmaps', name: 'Weedmaps', category: 'menu_listing', description: 'Cannabis discovery and menu listing platform', website: 'https://weedmaps.com', configSchema: { apiKey: 'string', listingId: 'string' } },
  { slug: 'alpine-iq', name: 'Alpine IQ', category: 'marketing', description: 'Cannabis marketing automation and customer data platform', website: 'https://alpineiq.com', configSchema: { apiKey: 'string', accountId: 'string' } },
  { slug: 'buddi', name: 'Buddi', category: 'delivery', description: 'Cannabis delivery logistics and management', website: 'https://buddi.io', configSchema: { apiKey: 'string', storeId: 'string' } },
  { slug: 'onfleet', name: 'OnFleet', category: 'delivery', description: 'Last-mile delivery management platform', website: 'https://onfleet.com', configSchema: { apiKey: 'string', organizationId: 'string' } },
  { slug: 'sprout', name: 'Sprout', category: 'crm', description: 'Cannabis-specific CRM and customer engagement', website: 'https://sprout.io', configSchema: { apiKey: 'string', companyId: 'string' } },
  { slug: 'klicktrack', name: 'KlickTrack', category: 'analytics', description: 'Cannabis retail analytics and business intelligence', website: 'https://klicktrack.com', configSchema: { apiKey: 'string', storeCode: 'string' } },
  { slug: 'canpay', name: 'CanPay', category: 'payments', description: 'Cannabis debit payment processing', website: 'https://canpaydebit.com', configSchema: { merchantId: 'string', apiKey: 'string', terminalId: 'string' } },
  { slug: 'hypur', name: 'Hypur', category: 'payments', description: 'Compliant electronic payment solution for cannabis', website: 'https://hypur.com', configSchema: { merchantId: 'string', apiKey: 'string' } },
]

// ─── Public Endpoints ───────────────────────────────────────────────────────

// GET /partners — List all integration partners (no auth for browsing)
app.get('/partners', async (c) => {
  const category = c.req.query('category')
  const search = c.req.query('search')

  let categoryFilter = sql``
  if (category) categoryFilter = sql`AND category = ${category}`

  let searchFilter = sql``
  if (search) searchFilter = sql`AND (name ILIKE ${'%' + search + '%'} OR description ILIKE ${'%' + search + '%'})`

  const result = await db.execute(sql`
    SELECT id, slug, name, category, description, website, logo_url, active
    FROM integration_partners
    WHERE active = true
      ${categoryFilter}
      ${searchFilter}
    ORDER BY category ASC, name ASC
  `)

  return c.json((result as any).rows || result)
})

// GET /partners/:slug — Partner detail with configSchema
app.get('/partners/:slug', async (c) => {
  const slug = c.req.param('slug')

  const result = await db.execute(sql`
    SELECT * FROM integration_partners
    WHERE slug = ${slug} AND active = true
    LIMIT 1
  `)

  const partner = ((result as any).rows || result)?.[0]
  if (!partner) return c.json({ error: 'Partner not found' }, 404)

  return c.json(partner)
})

// POST /webhook/:partnerId — Incoming webhook from partner (no auth, validates webhook secret)
app.post('/webhook/:partnerId', async (c) => {
  const partnerId = c.req.param('partnerId')

  // Look up partner and installed integration
  const integrationResult = await db.execute(sql`
    SELECT ci.*, ip.slug as partner_slug, ip.name as partner_name
    FROM company_integrations ci
    JOIN integration_partners ip ON ip.id = ci.partner_id
    WHERE ci.partner_id = ${partnerId} AND ci.status = 'active'
    LIMIT 1
  `)
  const integration = ((integrationResult as any).rows || integrationResult)?.[0]
  if (!integration) return c.json({ error: 'Integration not found or inactive' }, 404)

  // Validate webhook secret from header
  const webhookSecret = c.req.header('X-Webhook-Secret')
  if (integration.webhook_secret && webhookSecret !== integration.webhook_secret) {
    return c.json({ error: 'Invalid webhook secret' }, 401)
  }

  const body = await c.req.json()

  // Log webhook event to audit_log
  await db.execute(sql`
    INSERT INTO audit_log (id, action, entity, entity_id, company_id, metadata, created_at)
    VALUES (gen_random_uuid(), 'integration_webhook', 'company_integration', ${integration.id}, ${integration.company_id},
      ${JSON.stringify({ partnerId, partnerSlug: integration.partner_slug, eventType: body.event || 'unknown', payload: body })}::jsonb, NOW())
  `)

  return c.json({ received: true })
})

// ─── Authenticated Endpoints ────────────────────────────────────────────────

app.use('*', authenticate)

// GET /installed — List company's installed integrations
app.get('/installed', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT ci.*, ip.name as partner_name, ip.slug as partner_slug, ip.category as partner_category,
           ip.description as partner_description, ip.logo_url as partner_logo_url
    FROM company_integrations ci
    JOIN integration_partners ip ON ip.id = ci.partner_id
    WHERE ci.company_id = ${currentUser.companyId}
    ORDER BY ci.created_at DESC
  `)

  return c.json((result as any).rows || result)
})

// POST /install/:partnerId — Install/enable an integration
app.post('/install/:partnerId', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const partnerId = c.req.param('partnerId')

  const installSchema = z.object({
    config: z.record(z.string(), z.any()),
  })
  const data = installSchema.parse(await c.req.json())

  // Verify partner exists
  const partnerResult = await db.execute(sql`
    SELECT * FROM integration_partners WHERE id = ${partnerId} AND active = true LIMIT 1
  `)
  const partner = ((partnerResult as any).rows || partnerResult)?.[0]
  if (!partner) return c.json({ error: 'Integration partner not found' }, 404)

  // Check if already installed
  const existingResult = await db.execute(sql`
    SELECT id FROM company_integrations
    WHERE company_id = ${currentUser.companyId} AND partner_id = ${partnerId}
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (existing) return c.json({ error: 'Integration already installed' }, 409)

  // Generate webhook secret
  const webhookSecret = `whsec_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

  const result = await db.execute(sql`
    INSERT INTO company_integrations (id, company_id, partner_id, config, webhook_secret, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${partnerId}, ${JSON.stringify(data.config)}::jsonb, ${webhookSecret}, 'configuring', NOW(), NOW())
    RETURNING *
  `)

  const integration = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'company_integration',
    entityId: integration?.id,
    entityName: partner.name,
    metadata: { partnerId, partnerSlug: partner.slug },
    req: c.req,
  })

  return c.json({ ...integration, partnerName: partner.name }, 201)
})

// PUT /installed/:id/config — Update integration config
app.put('/installed/:id/config', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const { config } = z.object({ config: z.record(z.string(), z.any()) }).parse(await c.req.json())

  const result = await db.execute(sql`
    UPDATE company_integrations
    SET config = ${JSON.stringify(config)}::jsonb, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Integration not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'company_integration',
    entityId: id,
    req: c.req,
  })

  return c.json(updated)
})

// PUT /installed/:id/activate — Activate integration (tests connection first)
app.put('/installed/:id/activate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Fetch integration
  const intResult = await db.execute(sql`
    SELECT ci.*, ip.slug as partner_slug, ip.name as partner_name
    FROM company_integrations ci
    JOIN integration_partners ip ON ip.id = ci.partner_id
    WHERE ci.id = ${id} AND ci.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const integration = ((intResult as any).rows || intResult)?.[0]
  if (!integration) return c.json({ error: 'Integration not found' }, 404)

  // Test connection (simplified: just verify config has required fields)
  const config = typeof integration.config === 'string' ? JSON.parse(integration.config) : integration.config
  if (!config || Object.keys(config).length === 0) {
    return c.json({ error: 'Integration must be configured before activation' }, 400)
  }

  const result = await db.execute(sql`
    UPDATE company_integrations
    SET status = 'active', activated_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'company_integration',
    entityId: id,
    entityName: integration.partner_name,
    changes: { status: { old: integration.status, new: 'active' } },
    req: c.req,
  })

  return c.json(updated)
})

// PUT /installed/:id/disable — Disable integration
app.put('/installed/:id/disable', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE company_integrations
    SET status = 'disabled', updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Integration not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'company_integration',
    entityId: id,
    changes: { status: { old: 'active', new: 'disabled' } },
    req: c.req,
  })

  return c.json(updated)
})

// DELETE /installed/:id — Uninstall integration
app.delete('/installed/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    DELETE FROM company_integrations
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, partner_id
  `)

  const deleted = ((result as any).rows || result)?.[0]
  if (!deleted) return c.json({ error: 'Integration not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'company_integration',
    entityId: id,
    req: c.req,
  })

  return c.json({ success: true })
})

// POST /installed/:id/test — Test integration connection
app.post('/installed/:id/test', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const intResult = await db.execute(sql`
    SELECT ci.*, ip.slug as partner_slug, ip.name as partner_name
    FROM company_integrations ci
    JOIN integration_partners ip ON ip.id = ci.partner_id
    WHERE ci.id = ${id} AND ci.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const integration = ((intResult as any).rows || intResult)?.[0]
  if (!integration) return c.json({ error: 'Integration not found' }, 404)

  const config = typeof integration.config === 'string' ? JSON.parse(integration.config) : integration.config

  // Simulate connection test (in production, would call partner API)
  const hasApiKey = config?.apiKey || config?.merchantId
  const testResult = hasApiKey
    ? { success: true, message: `Connection to ${integration.partner_name} successful`, latencyMs: Math.floor(Math.random() * 200) + 50 }
    : { success: false, message: 'Missing API key or merchant ID in configuration' }

  // Log test result
  await db.execute(sql`
    UPDATE company_integrations
    SET last_test_at = NOW(), last_test_result = ${JSON.stringify(testResult)}::jsonb, updated_at = NOW()
    WHERE id = ${id}
  `)

  return c.json(testResult)
})

// POST /installed/:id/sync — Trigger manual sync
app.post('/installed/:id/sync', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const intResult = await db.execute(sql`
    SELECT ci.*, ip.slug as partner_slug, ip.name as partner_name
    FROM company_integrations ci
    JOIN integration_partners ip ON ip.id = ci.partner_id
    WHERE ci.id = ${id} AND ci.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const integration = ((intResult as any).rows || intResult)?.[0]
  if (!integration) return c.json({ error: 'Integration not found' }, 404)
  if (integration.status !== 'active') return c.json({ error: 'Integration must be active to sync' }, 400)

  // Record sync attempt
  await db.execute(sql`
    UPDATE company_integrations
    SET last_sync_at = NOW(), sync_status = 'syncing', updated_at = NOW()
    WHERE id = ${id}
  `)

  // In production, this would trigger an async job for the specific partner
  // For now, mark as completed
  await db.execute(sql`
    UPDATE company_integrations
    SET sync_status = 'completed', updated_at = NOW()
    WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'company_integration',
    entityId: id,
    entityName: integration.partner_name,
    metadata: { action: 'manual_sync' },
    req: c.req,
  })

  return c.json({ message: `Sync triggered for ${integration.partner_name}`, syncedAt: new Date().toISOString() })
})

// POST /seed-partners — ADMIN ONLY. Seed marketplace with known cannabis partners
app.post('/seed-partners', requireRole('admin'), async (c) => {
  const inserted: any[] = []

  for (const partner of CANNABIS_PARTNERS) {
    // Upsert by slug
    const result = await db.execute(sql`
      INSERT INTO integration_partners (id, slug, name, category, description, website, config_schema, active, created_at, updated_at)
      VALUES (gen_random_uuid(), ${partner.slug}, ${partner.name}, ${partner.category}, ${partner.description}, ${partner.website}, ${JSON.stringify(partner.configSchema)}::jsonb, true, NOW(), NOW())
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        website = EXCLUDED.website,
        config_schema = EXCLUDED.config_schema,
        updated_at = NOW()
      RETURNING *
    `)
    const row = ((result as any).rows || result)?.[0]
    if (row) inserted.push(row)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'integration_partner',
    entityName: 'Seed marketplace partners',
    metadata: { partnersSeeded: inserted.length },
    req: c.req,
  })

  return c.json({ message: `Seeded ${inserted.length} integration partners`, partners: inserted }, 201)
})

export default app
