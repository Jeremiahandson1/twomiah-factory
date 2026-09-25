// What the signed-in person may do — read from the server's answer, never guessed.
//
// Every CRM shipped its own copy of this file, and each one carried a hand-written duplicate of the
// backend's role → permission matrix. Eight copies, all stale in different ways: none of them knew about
// `tasks:*`, `settings:*`, `payments:*`, `pricebook:*` or `reports:read`; none of them knew about the
// per-user grants an owner hands out in Settings › Users; and `canManageFinancials` asked for
// invoices:delete on the screen while the server's own /permissions answered invoices:create. Nothing
// consumed any of it, which is the only reason none of that drift ever showed up as a bug.
//
// It is now a reader, not a second opinion. /api/auth/me answers the effective list — the role's
// permissions plus that person's grants — and every question here is asked of that list with the server's
// own matching rule. A matrix that lives in one place cannot disagree with itself.
//
// The rank helpers (isAtLeast, RequireRole, isOwner…) stay, because a rank is a real and different
// question: "is this person senior enough", not "may they do this". Only the matrix is gone. (T30 M-R1)
import React, { createContext, useContext, useMemo } from 'react'
import { useAuth } from './AuthContext'
import { permissionAllows } from './types'

const PermissionsContext = createContext<any>(null)

/** Lowest first — the same order the server's ROLE_HIERARCHY uses. */
const ROLE_HIERARCHY = ['viewer', 'field', 'manager', 'admin', 'owner']
/** `user` and `staff` are what some templates store for the field rung. */
const ROLE_ALIASES: Record<string, string> = { user: 'field', staff: 'field' }
const normalizeRole = (role: string | undefined) => ROLE_ALIASES[String(role || '')] || String(role || '') || 'viewer'
const meetsRoleLevel = (userRole: string, minRole: string) =>
  ROLE_HIERARCHY.indexOf(normalizeRole(userRole)) >= ROLE_HIERARCHY.indexOf(minRole)

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { user, permissions } = useAuth()

  const value = useMemo(() => {
    const role = normalizeRole(user?.role)
    // `null` until /me lands. Answering an empty list is right for the UI — it shows a control a moment
    // late rather than offering one the API will refuse — but a ROUTE must never be decided on it. Gate
    // routes behind `company` being present, the way AppShell does. (roof M7)
    const list = permissions || []
    const can = (permission: string) => permissionAllows(permissions, permission)

    return {
      role,
      roleLevel: ROLE_HIERARCHY.indexOf(role),
      permissions: list,

      can,
      canAny: (perms: string[]) => perms.some(can),
      canAll: (perms: string[]) => perms.every(can),

      isAtLeast: (minRole: string) => meetsRoleLevel(role, minRole),
      isOwner: role === 'owner',
      isAdmin: meetsRoleLevel(role, 'admin'),
      isManager: meetsRoleLevel(role, 'manager'),
      isField: role === 'field',
      isViewer: role === 'viewer',

      canManageTeam: can('team:create'),
      // invoices:create, the same question the server's /api/auth/permissions answers. The old copy asked
      // for invoices:delete here, so a manager who can raise and edit invoices read as unable to.
      canManageFinancials: can('invoices:create'),
      canApproveTime: can('time:approve'),
      canCreateQuotes: can('quotes:create'),
      canDeleteAnything: role === 'owner' || role === 'admin',
    }
  }, [user?.role, permissions])

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

/** Safe defaults outside the provider: nothing is allowed, and nothing throws. */
export function usePermissions() {
  const context = useContext(PermissionsContext)
  if (!context) {
    return {
      role: 'viewer', roleLevel: 0, permissions: [] as string[],
      can: () => false, canAny: () => false, canAll: () => false,
      isAtLeast: () => false,
      isOwner: false, isAdmin: false, isManager: false, isField: false, isViewer: true,
      canManageTeam: false, canManageFinancials: false, canApproveTime: false,
      canCreateQuotes: false, canDeleteAnything: false,
    }
  }
  return context
}

/** Renders its children only if the person holds the permission (or any/all of a list). */
export function Can({ permission, permissions, any = false, fallback = null, children }: any) {
  const { can, canAny, canAll } = usePermissions()
  let allowed = false
  if (permission) allowed = can(permission)
  else if (permissions) allowed = any ? canAny(permissions) : canAll(permissions)
  return allowed ? children : fallback
}

/** Renders its children only for a role at or above `role`. */
export function RequireRole({ role, fallback = null, children }: any) {
  const { isAtLeast } = usePermissions()
  return isAtLeast(role) ? children : fallback
}

export default PermissionsContext
