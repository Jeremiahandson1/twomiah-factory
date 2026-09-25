// Permissions context — shared implementation (packages/tenant-ui/src/auth/PermissionsContext.tsx),
// vendored as ../shared. This file only re-exports, so the rest of the app keeps importing from here.
//
// It used to hold a hand-written copy of the backend role -> permission matrix, and so did the seven
// other CRMs. All eight had drifted: none knew about tasks:*, settings:*, payments:*, pricebook:* or
// reports:read, none knew about the per-user grants an owner hands out in Settings > Users, and
// canManageFinancials asked for invoices:delete while the server answered invoices:create. The list now
// comes from /api/auth/me, so there is one matrix and it is the one the guards use. (T30 M-R1)
export { PermissionsProvider, usePermissions, Can, RequireRole } from '../shared';
