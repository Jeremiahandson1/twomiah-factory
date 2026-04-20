import { Hono } from 'hono'
import type { EmailDomainDeps } from './types'

// Phase 0.5 stub — full implementation lands in Phase 3.
// GET /status: current SendGrid Domain Auth state + DNS records to display.
// POST /verify: re-poll SendGrid domain-auth status.

export function createEmailDomainRoutes(_deps: EmailDomainDeps): Hono {
  const app = new Hono()
  app.all('*', c => c.json({ error: 'Not implemented yet (Phase 3)' }, 501))
  return app
}
