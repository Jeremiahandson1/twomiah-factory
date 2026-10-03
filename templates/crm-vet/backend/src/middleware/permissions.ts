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
  // Clinical staff (technician/receptionist) must be able to record care and bill for it.
  // Vet patients/visits/vaccinations/appointments/wellness all gate on contacts:*. (R2-02)
  // sms:send — clinical staff already speak to the owner directly (contacts and invoices above), and
  // "your pet is out of surgery" is their message to send, not a manager's. (T30 L-RB)
  //
  /**
   * T41 ASKED ABOUT THIS AND THE ANSWER IS "INTENDED". Not changed.
   *
   * The report lists, as a medium: "Staff sees practice-wide totals via /api/invoices/stats and
   * dashboard visit revenue (judgement call for the receptionist role)" — and marks it a judgement
   * call rather than a defect, correctly.
   *
   * The judgement is already made, here, and the same report's brief depends on it: step 6 is
   * "Staff invoices a visit" and it PASSED — "INV-00066 $22.00; staff also recorded payment". A
   * practice receptionist raises the bill and takes the card. A seat that may create, read and
   * update invoices can obviously see what the invoices add up to; withholding the total from the
   * person who collects it would be a refusal with nothing behind it.
   *
   * `/api/invoices/stats` is gated on `invoices:read` in the shared invoicing module and always
   * has been — so there is nothing unguarded here. This grant is the whole reason the vet's field
   * seat passes that gate, and removing it would break billing on the vertical to hide a figure
   * from the person billing. Fleet-wide, `field` does NOT hold invoices:read; this vertical is the
   * deliberate exception, which is why the finding appears on the vet and nowhere else.
   */
  extraRolePermissions: { field: ['contacts:create', 'contacts:update', 'invoices:read', 'invoices:create', 'invoices:update', 'sms:send'] },
  roleMapping: { staff: 'field' },
})
