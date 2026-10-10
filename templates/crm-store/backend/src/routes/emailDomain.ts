// Branded sending domain — status and re-verify. Thin wrapper over the shared tenant-backend proxy (the
// SendGrid work lives in the Factory, authenticated by this store's sync key), same as every other CRM.
//
// The store's Settings › Email Domain page shipped calling /api/email-domain/* with nothing mounted there,
// so it could not load for anybody. Store configuration, like the branded addresses beside it
// (routes/emailAliases.ts): settings:update — the owner's.
import { Hono } from 'hono'
import { createEmailDomainRoutes, createFactoryApiClient } from '../shared/index.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate, requirePermission('settings:update'))
app.route('/', createEmailDomainRoutes({ factoryApiClient: createFactoryApiClient() }))
export default app
