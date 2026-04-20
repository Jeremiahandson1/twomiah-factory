import { Hono } from 'hono'
import type { EmailAliasesDeps } from './types'

// Phase 0.5 stub — full implementation lands in Phase 3.
// CRUD for the tenant's email_aliases table. On every write, also calls
// factoryApiClient.syncEmailAlias so Cloudflare Email Routing reflects
// the current state (forward ↔ route-into-CRM per alias).

export function createEmailAliasesRoutes(_deps: EmailAliasesDeps): Hono {
  const app = new Hono()
  app.all('*', c => c.json({ error: 'Not implemented yet (Phase 3)' }, 501))
  return app
}
