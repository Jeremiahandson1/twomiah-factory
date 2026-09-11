import { Hono } from 'hono'
import { createMessagingBillingRoutes } from '../shared/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

// Texting / AI usage wallet — read-only mirror of the Factory (see shared/messagingBilling.ts).
// Any signed-in user may read /status (the send screens warn on an empty wallet before sending);
// only an admin/owner can mint the billing-portal link.
const app = new Hono()
app.use('*', authenticate)
app.use('/portal-link', requireAdmin)
app.route('/', createMessagingBillingRoutes())
export default app
