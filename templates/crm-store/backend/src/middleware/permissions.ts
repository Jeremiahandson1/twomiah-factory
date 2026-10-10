// Role → permission matrix + guards — shared implementation (packages/tenant-backend/src/auth/permissions.ts),
// vendored into this tenant as ../shared at generation. This file only wires the template's db + user table in.
//
// The store's three seats (owner's decision, 2026-10-10):
//   owner    everything — payments, settings, logins and the integrations stay here
//   manager  runs the shop: refunds and cancellations, discount codes, the carrier account, deleting
//            from the catalogue, the loyalty programme
//   staff    does the work: packs and ships orders, adds and edits products and stock, answers reviews
//
// The store stores its floor role as `staff`; the hierarchy calls that rung `field`.
import { createPermissions } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { users } from '../../db/schema.ts'

export const {
  ROLE_HIERARCHY, ROLE_PERMISSIONS, normalizeRole, roleLabel,
  getExtraPermissions, invalidateExtraPermissions,
  hasPermission, getPermissions,
  requirePermission, requireAnyPermission, requireRole, requireOwnership,
} = createPermissions({
  db,
  tables: { user: users },
  roleMapping: { staff: 'field' },
  extraRolePermissions: {
    field: [
      // Fulfilment: read an order, write tracking and a note, move it on to fulfilled / shipped /
      // delivered, and buy the label it ships with. Cancelling, refunding and anything else that
      // changes whether it was paid is orders:refund, which this seat does not hold.
      'orders:read', 'orders:update', 'shipping:read', 'shipping:label',
      // The catalogue, short of removing anything from sale — deleting a product or a variant is the manager's.
      'products:read', 'products:create', 'products:update',
      // Sees the codes so they can answer a shopper; writing one is giving money away.
      'discounts:read',
      // Publishes or rejects a review; deleting one for good is the manager's.
      'reviews:read', 'reviews:update',
    ],
    // The fleet's manager runs a loyalty programme day to day but does not write the reward list
    // (loyalty:configure is admin). A shop has no admin seat, so that would leave the reward list to
    // the owner alone — and running the programme is one of the four things this seat exists for.
    manager: ['loyalty:configure'],
  },
  roleLabels: { field: 'Staff' },
})
