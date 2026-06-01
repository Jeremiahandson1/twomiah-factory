/**
 * Brief Builder route — dry-run only.
 *
 * POST /api/v1/brief   { Intake }  → { decision, config, validation }
 *   Returns a verified-safe GenerateConfig for human review. It deliberately
 *   does NOT generate/deploy — that stays a separate, explicit step
 *   (POST /api/v1/factory/generate) so a person always approves the call.
 *
 * GET  /api/v1/brief/policy  → the allowlist (for the wizard UI).
 *
 * Purely additive: new Hono router, mounted in index.ts. Nothing else changed.
 */
import { Hono } from 'hono'
import { authenticate, requireRole } from '../middleware/auth'
import {
  buildBrief, type Intake,
  KNOWN_INDUSTRIES, THEME_ALLOW, ALL_WEBSITE_FEATURES, ALLOWED_PRODUCTS,
} from '../services/briefBuilder'

const brief = new Hono()

brief.use('*', async (c, next) => {
  if (c.req.path.endsWith('/policy')) return next() // read-only allowlist is public
  return authenticate(c, next)
})

brief.get('/policy', (c) =>
  c.json({
    industries: KNOWN_INDUSTRIES,
    themesByTemplate: THEME_ALLOW,
    websiteFeatures: ALL_WEBSITE_FEATURES,
    products: ALLOWED_PRODUCTS,
  }))

brief.post('/', requireRole('owner', 'admin', 'editor'), async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid or missing JSON body' }, 400)
  }
  if (!body || typeof body !== 'object') return c.json({ error: 'Body must be a JSON object' }, 400)
  if (!body.businessName || !body.businessType) {
    return c.json({ error: 'businessName and businessType are required' }, 400)
  }

  const result = buildBrief(body as Intake)

  // Never hand back a config that fails the allowlist.
  if (!result.ok) {
    return c.json(
      { ok: false, error: 'Generated config failed safety validation', validation: result.validation, decision: result.decision },
      422,
    )
  }

  return c.json({
    ok: true,
    decision: result.decision,
    config: result.config,
    validation: result.validation,
    nextStep: 'Review, then POST the `config` to /api/v1/factory/generate to build.',
  })
})

export default brief
