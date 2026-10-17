// Two-factor enrolment — shared implementation (packages/tenant-backend/src/auth/mfaRoutes.ts),
// vendored into this tenant as ../shared. This file only wires the template's db and middleware in.
//
// The sign-in half is in this template's own routes/auth.ts (roof does not use shared auth's /login): it asks
// the shared gate after the password, and POST /api/auth/mfa finishes the sign-in. (Launch list, 10/17)
import { createMfaRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { authenticate } from '../middleware/auth.ts'
import audit from '../services/audit.ts'

export default createMfaRoutes({
  db,
  authenticate,
  audit,
  issuer: 'Twomiah Roofing',
})
