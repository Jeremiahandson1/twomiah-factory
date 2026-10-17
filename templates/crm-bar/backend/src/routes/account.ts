import { Hono } from 'hono'
import { createAccountRoutes, createFactoryApiClient } from '../shared/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)
app.route('/', createAccountRoutes({ factoryApiClient: createFactoryApiClient() }))
export default app
