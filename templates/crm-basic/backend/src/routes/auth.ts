// Auth routes — shared implementation (packages/tenant-backend/src/auth/auth.ts), vendored into this tenant
// as ../shared at generation. This file only wires the template's tables, middleware and services in.
// Per-route rate limits (/login, /register, /forgot-password) are applied in index.ts.
import { createAuthRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { getPermissions, normalizeRole, hasPermission, roleLabel, ROLE_HIERARCHY, getExtraPermissions } from '../middleware/permissions.ts'
import emailService from '../services/email.ts'
import logger from '../services/logger.ts'
import audit from '../services/audit.ts'

export default createAuthRoutes({
  db,
  tables: { user, company },
  authenticate,
  // roleLabel: this vertical's word for a rung, so nothing a person reads says "field" in a salon.
  // getExtraPermissions: so /me answers what this person may actually do — the role plus the grants
  // the owner gave them by name — and not merely what the role allows. (T30 M-R1)
  permissions: { getPermissions, normalizeRole, hasPermission, roleLabel, ROLE_HIERARCHY, getExtraPermissions },
  emailService,
  logger,
  // Sign-ins, failed sign-ins, sign-outs and password changes go in the audit log. An audit log
  // with no sign-ins cannot answer when an account was last used, or from where. (T41)
  audit,
  options: {
    /**
     * 'showcase', not 'fieldservice'. (T38)
     *
     * This template was cloned from crm-fieldservice and kept its label, so a gym, a hotel, a
     * wedding venue or a food truck signed in and told the client it was a field-service business.
     * Every other template names itself correctly, which is how it stood out.
     *
     * It is not cosmetic: the mobile app reads company.vertical to choose its screens and vocabulary
     * (apps/mobile/src/vertical/VerticalContext.tsx), and WrongAppGate uses it to tell somebody they
     * have signed in to the wrong Twomiah app — so a gym owner was being told their company "is set
     * up for Twomiah Field Service".
     *
     * NOTE: apps/mobile's detectVertical() only accepts contractor | fieldservice | homecare |
     * roofing | landscaping | dispensary, so 'showcase' — like the existing 'restaurant', 'rv',
     * 'salon' and 'vet' — falls through to its feature-signal inference. That gap is recorded in the
     * round notes rather than fixed here: changing which verticals the mobile app recognises is a
     * decision about that app, not about this template's name.
     */
    vertical: 'showcase',
  },
})
