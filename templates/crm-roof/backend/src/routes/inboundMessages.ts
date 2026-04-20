import { Hono } from 'hono'
import { createInboundMessagesRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { inboundMessage } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)
app.route('/', createInboundMessagesRoutes({ db, inboundMessageTable: inboundMessage }))
export default app
