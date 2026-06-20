import { Hono } from 'hono'
import { createAccountRoutes, createFactoryApiClient } from '../shared/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
// Only owner/admin can offboard — never a regular user. Matches the
// factory's requireRole('owner', 'admin') on the underlying endpoint.
app.use('*', authenticate, requireAdmin)
app.route('/', createAccountRoutes({ factoryApiClient: createFactoryApiClient() }))
export default app
