import { Hono } from 'hono'
import type { EmailDomainDeps } from './types'

// Thin proxy layer — the actual SendGrid interaction lives in the factory.
// Tenant frontends hit these endpoints on their own backend so we don't
// need to ship SendGrid credentials to every tenant.

export function createEmailDomainRoutes(deps: EmailDomainDeps): Hono {
  const app = new Hono()
  const { factoryApiClient } = deps

  // A missing/unconfigured domain is a client-state condition, not a server fault — e.g.
  // "No SendGrid domain auth to verify" when the tenant has no branded domain set up. Return
  // 4xx for those (and honour any 4xx the factory propagated) rather than a blanket 500.
  const errStatus = (err: any): 400 | 404 | 500 => {
    const s = Number(err?.status || err?.statusCode)
    if (s >= 400 && s < 500) return s === 404 ? 404 : 400
    const m = String(err?.message || '')
    if (/\bno\b.*\b(domain|sendgrid|auth)\b|not configured|nothing to verify|no .* to verify|not set up|not found/i.test(m)) return 400
    return 500
  }

  app.get('/status', async (c) => {
    try {
      const result = await factoryApiClient.getEmailDomainStatus()
      return c.json(result)
    } catch (err: any) {
      return c.json({ error: err.message }, errStatus(err))
    }
  })

  app.post('/verify', async (c) => {
    try {
      const result = await factoryApiClient.verifyEmailDomain()
      return c.json(result)
    } catch (err: any) {
      return c.json({ error: err.message }, errStatus(err))
    }
  })

  return app
}
