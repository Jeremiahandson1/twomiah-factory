import { Hono } from 'hono'
import { createMessagingBillingRoutes } from '../shared/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { hasPermission, getExtraPermissions } from '../middleware/permissions.ts'

// Texting / AI usage wallet — read-only mirror of the Factory (see shared/messagingBilling.ts).
// Any signed-in user may read /status (the send screens warn on an empty wallet before sending);
// only an admin/owner can mint the billing-portal link.
const app = new Hono()
app.use('*', authenticate)
app.use('/portal-link', requireAdmin)
// The balance and ledger go to whoever settles the bill (company:update); a send screen gets walletEmpty. (T63)
app.route('/', createMessagingBillingRoutes({
  mayReadWallet: async (c: any) => { const u = c.get('user') as any; return hasPermission(u?.role, 'company:update', await getExtraPermissions(u?.userId)) },
}))
export default app
