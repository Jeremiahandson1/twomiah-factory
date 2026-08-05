// Inbound email viewer + reply. Replies send AS the alias the customer wrote
// to, on the store's domain (from storefrontOrigin). Deliverability requires
// the domain to be authenticated with the email provider -- failures surface
// in the UI rather than silently dropping.
import { Hono } from 'hono'
import { createInboundMessagesRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { inboundMessage, storeSettings } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { send } from '../services/email.ts'

const app = new Hono()
app.use('*', authenticate)
app.route('/', createInboundMessagesRoutes({
  db,
  inboundMessageTable: inboundMessage,
  sendReply: async ({ fromLocalPart, to, subject, text }) => {
    const [s] = await db.select().from(storeSettings).limit(1)
    let domain = ''
    try { if (s?.storefrontOrigin) domain = new URL(s.storefrontOrigin).hostname } catch { /* fall through */ }
    if (!domain) return { success: false }
    const html = '<pre style="font-family:inherit;white-space:pre-wrap;margin:0">' + String(text).replace(/</g, '&lt;') + '</pre>'
    const ok = await send({ from: fromLocalPart + '@' + domain, to, subject, html })
    return { success: ok }
  },
}))
export default app
