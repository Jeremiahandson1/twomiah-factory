// Thin wrapper -- CRUD logic lives in the vendored shared package. Extended
// with reply-from-branded-address: replies send AS the alias the customer
// wrote to (support@tenantdomain), through this template's own email service
// (authenticated tenant domain).
import { Hono } from 'hono'
import { createInboundMessagesRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { inboundMessage } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { send, templates } from '../services/email.ts'

// Register a minimal passthrough template once so the shared reply route can
// send arbitrary subject/text without touching the per-vertical template map.
if (!(templates as any).raw) {
  ;(templates as any).raw = (d: any) => ({
    subject: d.subject,
    html: d.html || '<pre style="font-family:inherit;white-space:pre-wrap;margin:0">' + String(d.text || '').replace(/</g, '&lt;') + '</pre>',
    text: d.text,
  })
}

// Post-generation this default carries the real tenant domain.
const TENANT_DOMAIN = (process.env.FROM_EMAIL || 'noreply@{{COMPANY_DOMAIN}}').split('@')[1]

const app = new Hono()
app.use('*', authenticate, requireAdmin)
app.route('/', createInboundMessagesRoutes({
  db,
  inboundMessageTable: inboundMessage,
  sendReply: async ({ fromLocalPart, to, subject, text }) => {
    const address = fromLocalPart + '@' + TENANT_DOMAIN
    const r: any = await send(to, 'raw', { subject, text }, { from: { name: address, address } })
    return { success: !!r?.success }
  },
}))
export default app
