// Google Business Profile -- reviews inbox. Logic lives in the vendored
// shared package; this wires tenant auth + the factory-key'd token drop.
import { Hono } from 'hono'
import { createGbpAdminRoutes, createGbpInternalRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { gbpConnection } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

export const gbpInternal = new Hono()
gbpInternal.use('*', async (c, next) => {
  const expected = process.env.FACTORY_SYNC_KEY || ''
  const got = c.req.header('X-Factory-Key') || ''
  if (!expected || got !== expected) return c.json({ error: 'Unauthorized' }, 401)
  return next()
})
gbpInternal.route('/', createGbpInternalRoutes({ db, gbpConnectionTable: gbpConnection }))

const app = new Hono()
app.use('*', authenticate, requireAdmin)
app.route('/', createGbpAdminRoutes({ db, gbpConnectionTable: gbpConnection }))
export default app
