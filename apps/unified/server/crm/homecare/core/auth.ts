// Home care's sign-in pieces. Moved from templates/crm-homecare/backend/src/middleware/auth.ts.
//
// · authenticate: home care's own JWT check is replaced by the app's sign-in (d.authenticate, the shared
//   auth/middleware.ts), which sets the same { userId, companyId, email, role } on the request and refuses a locked
//   company's requests. Home care's check also refused a token issued before the person's last logout
//   (core/tokenRevocation.ts); the app's sign-in does not consult that (reported: the sign-in step decides).
// · requireAdmin: unchanged rule — admin or owner — the same rule the app's CRM uses (server/modules/crm.ts isAdmin);
//   only the words differ, and home care's are kept.
// · logAuthEvent: the login-activity row (login_activity), now in the person's company.
import type { Context, Next } from 'hono'
import { loginActivity } from '../../../db/schema/index.ts'
import { fail } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'

export function createHomecareAuth(d: CrmDeps) {
  const requireAdmin = async (c: Context, next: Next) => {
    const user = c.get('user' as never) as any
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) return fail(c, 403, 'Admin access required')
    await next()
  }

  /** One sign-in attempt, kept for the login-activity screen. Never fails the request it describes. */
  const logAuthEvent = async (data: {
    companyId: string
    email: string
    userId?: string
    success: boolean
    ipAddress?: string
    userAgent?: string
    failReason?: string
  }) => {
    try {
      await d.db.insert(loginActivity).values({
        companyId: data.companyId,
        email: data.email,
        userId: data.userId,
        success: data.success,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        failReason: data.failReason,
      })
    } catch {
      // Don't fail the request if logging fails
    }
  }

  return { authenticate: d.authenticate, requireAdmin, logAuthEvent }
}
