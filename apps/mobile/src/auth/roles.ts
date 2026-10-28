/**
 * The seats, as the server has them (packages/tenant-backend/src/auth/permissions.ts ROLE_HIERARCHY):
 * viewer < field < manager < admin < owner. A caregiver, a technician or a crew member is the `field` seat
 * (apps/unified/server/crm/homecare/hr/caregivers.ts stores `field`); a record made before that may still say
 * `caregiver`, and sign-in answers the stored word while /api/auth/me answers the normalised one — so every screen
 * asks these, never compares a role string itself.
 */
const norm = (role: unknown) => String(role ?? '').toLowerCase()

/** The field seat, by the server's own mapping: `field`, and the older words it maps to `field` — `user` (every
 * vertical), `caregiver` (home care) and `staff` (store, vet) (permissions.ts ROLE_MAPPING + the verticals' roleMapping). */
export const isFieldRole = (role: unknown) => ['field', 'user', 'caregiver', 'staff'].includes(norm(role))

/** The office: a manager (office manager), an admin or the owner. */
export const isOfficeRole = (role: unknown) => ['manager', 'admin', 'owner'].includes(norm(role))

/**
 * Whether the permission list the server sent (sign-in and /api/auth/me `permissions`) grants `permission`: `*`, a resource's
 * `x:*`, or the exact `x:action` — the server's own rule (packages/tenant-backend auth/permissions.ts). An EMPTY list (a profile
 * saved before the app kept one) grants everything: hiding is a courtesy, the server is the gate. Pure, so a test runs the same
 * rule the screens do (AuthContext.can).
 */
export function permits(permissions: readonly string[], permission: string): boolean {
  if (!permissions.length) return true
  if (permissions.includes('*') || permissions.includes(permission)) return true
  return permissions.includes(permission.split(':')[0] + ':*')
}
