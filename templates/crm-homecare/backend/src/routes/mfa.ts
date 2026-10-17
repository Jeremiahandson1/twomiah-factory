// Two-factor enrolment — shared implementation (packages/tenant-backend/src/auth/mfaRoutes.ts), vendored into this
// tenant as ../shared. This file only wires home care's db, middleware, audit service and scope in.
//
// Home care forks its sign-in (routes/auth.ts), so the gate is not asked for free as it is on the contractor lineage:
// /login asks mfaGateFor and /mfa finishes the sign-in, both with the same MFA_SCOPE (helpers/mfaScope.ts).
//
// View As cannot reach in here to enrol or remove a factor on somebody else's account: every write made with a View As
// token is refused before any route runs (middleware/viewAsReadOnly.ts, mounted on /api/*).
import { createMfaRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { authenticate } from '../middleware/auth.ts'
import audit from '../services/audit.ts'
import { MFA_SCOPE } from '../helpers/mfaScope.ts'

export default createMfaRoutes({
  db,
  authenticate,
  /**
   * Turning two-factor on or off goes in the audit log. The shared routes pass the Hono context as `req`; this
   * template's log() reads an Express-shaped `{ user, ip, headers }`, so it is translated here — handed the context
   * as-is, every row would have been written with no user and no address.
   */
  audit: {
    ...audit,
    log: (entry: any) => {
      const c = entry?.req
      const header = (name: string) => { try { return c?.req?.header?.(name) ?? undefined } catch { return undefined } }
      return audit.log({
        ...entry,
        req: {
          user: typeof c?.get === 'function' ? c.get('user') : undefined,
          headers: { 'x-forwarded-for': header('x-forwarded-for'), 'user-agent': header('user-agent') },
        },
      })
    },
  },
  // What the authenticator app lists the entry under, beside the person's email.
  issuer: 'Twomiah Home Care',
  scope: MFA_SCOPE,
})
