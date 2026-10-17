// Two-factor enrolment — shared implementation (packages/tenant-backend/src/auth/mfaRoutes.ts), vendored into this
// tenant as ../shared. This file only wires the store's db, middleware, audit service and scope in.
//
// The store forks its sign-in (routes/auth.ts), so unlike the contractor lineage the gate is not asked for free: /login
// asks mfaGateFor and /mfa finishes the sign-in, both with the same MFA_SCOPE (lib/mfaScope.ts).
import { createMfaRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { authenticate } from '../middleware/auth.ts'
import audit from '../services/audit.ts'
import { MFA_SCOPE } from '../lib/mfaScope.ts'

export default createMfaRoutes({
  db,
  authenticate,
  // Turning two-factor on or off goes in the audit log, as everywhere else in the fleet. The store's log reads the
  // signed-in person off the Hono context the shared routes pass as `req`.
  audit,
  // What the authenticator app lists the entry under, beside the person's email.
  issuer: 'Twomiah Store',
  scope: MFA_SCOPE,
})
