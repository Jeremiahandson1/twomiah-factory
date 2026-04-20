import { Hono } from 'hono'
import { createEmailDomainRoutes, createFactoryApiClient } from '../shared/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)
app.route('/', createEmailDomainRoutes({ factoryApiClient: createFactoryApiClient() }))
export default app
