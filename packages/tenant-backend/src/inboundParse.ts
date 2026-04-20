import { Hono } from 'hono'
import type { InboundParseDeps } from './types'

// Ingestion endpoint for inbound email routed from the factory.
// V1 is intentionally simple: append to inbound_message and 200. Later:
// match fromEmail to a contact and thread into conversations; handle
// attachments; reply-to tracking.
//
// Auth is handled by the caller's middleware (X-Factory-Key) — this route
// factory doesn't enforce it to stay schema-agnostic. The wrapper in each
// template applies the auth guard.

interface InboundPayload {
  toLocalPart: string
  fromEmail: string
  fromName?: string
  subject?: string
  textBody?: string
  htmlBody?: string
  spfVerdict?: string
  dkimVerdict?: string
  rawHeaders?: string
}

export function createInboundParseRoute(deps: InboundParseDeps): Hono {
  const app = new Hono()
  const { db, inboundMessageTable } = deps

  app.post('/', async (c) => {
    try {
      const body = await c.req.json() as InboundPayload
      if (!body.toLocalPart || !body.fromEmail) {
        return c.json({ error: 'Missing toLocalPart or fromEmail' }, 400)
      }
      const [row] = await db.insert(inboundMessageTable).values({
        toLocalPart: body.toLocalPart,
        fromEmail: body.fromEmail,
        fromName: body.fromName || null,
        subject: body.subject || null,
        textBody: body.textBody || null,
        htmlBody: body.htmlBody || null,
        spfVerdict: body.spfVerdict || null,
        dkimVerdict: body.dkimVerdict || null,
        rawHeaders: body.rawHeaders || null,
      }).returning()
      return c.json({ success: true, id: row?.id })
    } catch (err: any) {
      console.error('[InboundParse] insert failed:', err.message)
      return c.json({ error: err.message }, 500)
    }
  })

  return app
}
