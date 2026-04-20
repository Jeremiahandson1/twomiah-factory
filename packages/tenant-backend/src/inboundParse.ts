import { Hono } from 'hono'
import type { InboundParseDeps } from './types'

// Phase 0.5 stub — full implementation lands in Phase 3.
// SendGrid Inbound Parse webhook receiver. Routes messages addressed to a
// crm-mode alias into the tenant's conversation threads by matching sender
// email to contacts.email.

export function createInboundParseRoute(_deps: InboundParseDeps): Hono {
  const app = new Hono()
  app.post('/', c => c.json({ error: 'Not implemented yet (Phase 3)' }, 501))
  return app
}
