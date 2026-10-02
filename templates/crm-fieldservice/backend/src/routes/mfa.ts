// Two-factor enrolment — shared implementation (packages/tenant-backend/src/auth/mfaRoutes.ts),
// vendored into this tenant as ../shared. This file only wires the template's db and middleware in.
//
// The sign-in half needs no wiring: shared auth's /login asks the gate on every vertical, and answers
// "no second factor" where the mfa_devices table is absent. This template added it in the mfa migration.
//
// This existed in crm only, while the Two-Factor card on Settings → Security is rendered by the
// SHARED SettingsPage that this template also uses — so the card was offered here and every enrolment
// request 404'd. (T37)
import { createMfaRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { authenticate } from '../middleware/auth.ts'

export default createMfaRoutes({
  db,
  authenticate,
  // What the authenticator app lists the entry under. The company's own name would be better, but it
  // is per-tenant data and this is a module-level route factory — the vertical's name is honest and
  // stable, and the entry also carries the person's email.
  issuer: 'Twomiah Field Service',
})
