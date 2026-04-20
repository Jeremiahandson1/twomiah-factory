import { Hono } from 'hono'
import type { InboundParseDeps } from './types'

// Read-only viewer endpoints for inbound_message rows. The ingestion side
// (createInboundParseRoute) is write-only and uses X-Factory-Key auth. This
// viewer is user-facing: the consumer template guards it with authenticate
// middleware.

export function createInboundMessagesRoutes(deps: InboundParseDeps): Hono {
  const app = new Hono()
  const { db, inboundMessageTable } = deps

  app.get('/', async (c) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)))
      const { desc } = await import('drizzle-orm')
      const rows = await db
        .select()
        .from(inboundMessageTable)
        .orderBy(desc(inboundMessageTable.receivedAt))
        .limit(limit)
      return c.json({ messages: rows })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.get('/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const { eq } = await import('drizzle-orm')
      const [row] = await db
        .select()
        .from(inboundMessageTable)
        .where(eq(inboundMessageTable.id, id))
        .limit(1)
      if (!row) return c.json({ error: 'Not found' }, 404)
      return c.json({ message: row })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  return app
}
