// Internal ingestion endpoint — factory forwards parsed SendGrid Inbound
// Parse messages here. Not user-facing; authenticated via X-Factory-Key
// matching process.env.FACTORY_SYNC_KEY (same shared-secret the factory
// gave us at deploy time).
import { Hono } from 'hono'
import { createInboundParseRoute } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { inboundMessage } from '../../db/schema.ts'

const app = new Hono()

// X-Factory-Key auth — matches the key the factory set on this tenant at deploy.
app.use('*', async (c, next) => {
  const expected = process.env.FACTORY_SYNC_KEY || ''
  const got = c.req.header('X-Factory-Key') || ''
  if (!expected || got !== expected) return c.json({ error: 'Unauthorized' }, 401)
  return next()
})

app.route('/', createInboundParseRoute({ db, inboundMessageTable: inboundMessage }))
export default app
