// Two-factor enrolment — shared implementation (packages/tenant-backend/src/auth/mfaRoutes.ts),
// vendored into this tenant as ../shared. This file only wires the template's db and middleware in.
//
// WHY THIS WAS LAST. The dispensary is where two-factor was BUILT: mfa_devices and mfa_challenges
// have been in this schema since before the engine was shared, /login asks the gate, and /pin-login
// opens the same challenge. The one thing it never had was the enrolment half — those routes were
// written here, moved into shared auth, mounted in crm, and never mounted back. So a dispensary
// owner could be challenged for a code they had no way to set up. (T37)
//
// Unlike the other verticals this template renders its OWN SettingsPage, so it did not even show the
// Two-Factor card the shared page carries — the fault was invisible from both ends at once.
import { createMfaRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { authenticate } from '../middleware/auth.ts'
import audit from '../services/audit.ts'

export default createMfaRoutes({
  db,
  authenticate,
  // Turning two-factor on or off goes in the audit log. Nothing recorded it before. (T41)
  audit,
  // What the authenticator app lists the entry under. The company's own name would be better, but it
  // is per-tenant data and this is a module-level route factory — the vertical's name is honest and
  // stable, and the entry also carries the person's email.
  issuer: 'Twomiah Dispensary',
})
