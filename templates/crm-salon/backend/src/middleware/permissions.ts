// Role → permission matrix + guards — shared implementation (packages/tenant-backend/src/auth/permissions.ts),
// vendored into this tenant as ../shared at generation. This file only wires the template's db + user table in.
import { createPermissions } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'

export const {
  ROLE_HIERARCHY, ROLE_PERMISSIONS, normalizeRole, roleLabel,
  getExtraPermissions, invalidateExtraPermissions,
  hasPermission, getPermissions,
  requirePermission, requireAnyPermission, requireRole, requireOwnership,
} = createPermissions({
  db,
  tables: { user },
  // A stylist's day: take a booking, move it, check the client in, log the visit, add the client and
  // keep their card up to date. Salon passed nothing here, so staff inherited the CONTRACTOR field role
  // — jobs, RFIs, punch lists, time sheets, none of which exist in a salon — and were refused every one
  // of the six things they are actually employed to do. (Salon T28 M3)
  //
  // Not here, deliberately: pricebook:* (the Service Menu and membership plans are the price list) and
  // invoices:* / reports:* (the salon's money).
  extraRolePermissions: {
    field: ['contacts:create', 'contacts:update', 'schedule:create', 'schedule:update', 'sms:send'],
  },
  // The hierarchy's fifth rung is called "field" because it was built for crews on a job site. A salon
  // has stylists, and the 403 body was telling them "yourRole: field". (Salon T28 M3)
  roleLabels: { field: 'Stylist', viewer: 'Front Desk' },
})
