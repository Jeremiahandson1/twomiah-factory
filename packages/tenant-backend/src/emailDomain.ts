import { Hono } from 'hono'
import type { EmailDomainDeps } from './types'

// Thin proxy layer — the actual SendGrid interaction lives in the factory.
// Tenant frontends hit these endpoints on their own backend so we don't
// need to ship SendGrid credentials to every tenant.

export function createEmailDomainRoutes(deps: EmailDomainDeps): Hono {
  const app = new Hono()
  const { factoryApiClient } = deps

  app.get('/status', async (c) => {
    try {
      const result = await factoryApiClient.getEmailDomainStatus()
      return c.json(result)
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.post('/verify', async (c) => {
    try {
      const result = await factoryApiClient.verifyEmailDomain()
      return c.json(result)
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  return app
}
