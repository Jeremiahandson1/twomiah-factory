// Where two-factor lives in this database — the scope shared auth's two-factor is given (packages/tenant-backend/src/
// auth/mfa.ts MfaScope). ONE value, imported by both halves: enrolment (routes/mfa.ts) and sign-in (routes/auth.ts).
// Enrolment writing rows under one company id and sign-in reading another would leave two-factor "on" on the
// Sign-in & Security page and never asked for at the door. Its own module because importing it from a route file would
// build that route's app.
import type { MfaScope } from '../shared/index.ts'

/**
 * `users`, not `user`; no company_id on a person — this database is one agency — so every mfa_* row carries the one
 * value 'agency' (not the agencies row id: tokens issued before that row existed carry none, and the rows must not
 * depend on which token enrolled them). No require-MFA policy exists in agencies.settings, so none is read.
 */
export const MFA_SCOPE: MfaScope = { usersTable: 'users', singleCompanyId: 'agency' }
