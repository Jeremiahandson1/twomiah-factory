// Internal ingestion -- the factory forwards parsed inbound mail here.
// Authenticated via X-Factory-Key (shared secret set at deploy).
import { Hono } from 'hono'
import { createInboundParseRoute } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { inboundMessage } from '../../db/schema.ts'

const app = new Hono()
app.use('*', async (c, next) => {
  const expected = process.env.FACTORY_SYNC_KEY || ''
  const got = c.req.header('X-Factory-Key') || ''
  if (!expected || got !== expected) return c.json({ error: 'Unauthorized' }, 401)
  return next()
})
app.route('/', createInboundParseRoute({ db, inboundMessageTable: inboundMessage }))
export default app
