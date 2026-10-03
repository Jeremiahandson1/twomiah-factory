import React from 'react';
import { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';

const PermissionsContext = createContext<any>(null);

/**
 * THE LADDER IS THE SERVER'S. (T41)
 *
 * This said ['viewer', 'field', 'manager', 'admin', 'owner'] — the contractor's ladder, which has
 * no budtender and no driver. backend/src/middleware/permissions.ts says
 * ['viewer', 'driver', 'budtender', 'manager', 'admin', 'owner'], and the dispensary's routes gate
 * on exactly those words: requireRole('budtender') to take a sale, requireRole('driver') to move a
 * delivery, requireRole('manager') to refund one.
 *
 * Asking the old ladder `isAtLeast('budtender')` returned TRUE FOR EVERYONE, viewer included:
 * indexOf('budtender') is -1 on a list that does not contain it, and every real role's index is
 * >= -1. So the one helper a screen would reach for to hide a till button answered yes to the one
 * seat it exists to stop. A wrong answer that reads as a working check.
 */
const ROLE_HIERARCHY = ['viewer', 'driver', 'budtender', 'manager', 'admin', 'owner'];
/** The server's own mapping (ROLE_MAPPING in middleware/permissions.ts): both legacy names are budtenders. */
const ROLE_MAPPING: Record<string, string> = { user: 'budtender', field: 'budtender' };

/**
 * THIS MAP IS A CONTRACTOR'S, AND IT IS NO LONGER WHAT `can` ASKS. (T41)
 *
 * Read it: projects, rfis, change-orders, punch-lists, daily-logs, inspections, bids. Not one
 * dispensary resource — no products, no orders, no inventory, no till, no METRC. It was copied from
 * the base CRM when this template was cloned and never corrected, and it says it "mirrors backend",
 * which it has not for a long time.
 *
 * What that cost, in both directions:
 *   · every dispensary permission answered FALSE for every role but owner (owner holds '*'), so the
 *     two screens that did gate — Customers and Marketing — hid their write buttons from the admin
 *     and the manager who hold those rights on the server. A correct gate, reading a wrong map.
 *   · and no other screen could be gated at all without hiding it from the people allowed to use
 *     it, which is why 54 of this template's 57 write screens were never gated. That is the
 *     "viewer sees write buttons" the report found.
 *
 * The server already answers the question properly: /api/auth/login and /api/auth/me both return
 * the effective permission list, including the per-person grants an owner adds in Settings, and
 * AuthContext already keeps it. So `can` now asks THAT, exactly as AuthContext's own `can` does,
 * and this table survives only as the shape of the ladder for isAtLeast.
 *
 * Kept, deliberately: false while the list is still loading. A control that appears and is then
 * taken away is worse than one that appears a moment late. (T42 L1-L3)
 */
const LEGACY_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  
  admin: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*', 'invoices:*',
    'time:*', 'expenses:*', 'documents:*', 'rfis:*', 'change-orders:*',
    'punch-lists:*', 'daily-logs:*', 'inspections:*', 'bids:*',
    'team:*', 'company:read', 'company:update', 'dashboard:*', 'schedule:*',
  ],
  
  manager: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*',
    'invoices:read', 'invoices:create', 'invoices:update',
    'time:*', 'expenses:*', 'documents:*', 'rfis:*', 'change-orders:*',
    'punch-lists:*', 'daily-logs:*', 'inspections:*', 'bids:read',
    'team:read', 'company:read', 'dashboard:*', 'schedule:*',
  ],
  
  field: [
    'contacts:read', 'projects:read', 'jobs:read', 'jobs:update',
    'time:read', 'time:create', 'time:update',
    'expenses:read', 'expenses:create',
    'documents:read', 'documents:create',
    'rfis:read', 'rfis:create',
    'punch-lists:read', 'punch-lists:update',
    'daily-logs:read', 'daily-logs:create',
    'inspections:read', 'company:read', 'dashboard:read', 'schedule:read',
  ],
  
  viewer: [
    'contacts:read', 'projects:read', 'jobs:read', 'quotes:read',
    'invoices:read', 'time:read', 'expenses:read', 'documents:read',
    'rfis:read', 'change-orders:read', 'punch-lists:read', 'daily-logs:read',
    'inspections:read', 'bids:read', 'team:read', 'company:read',
    'dashboard:read', 'schedule:read',
  ],
  
  // Legacy role mapping
  user: [], // Treated as 'field'
};

// Map legacy roles
const normalizeRole = (role) => ROLE_MAPPING[role] || role || 'viewer';

/**
 * A rank this ladder does not know is a question nobody can answer, so it is a NO. (T41)
 *
 * The old version compared indexOf values and `-1 >= -1` made an unknown rank true for everybody.
 * Refusing instead means a typo in a minRole hides a control rather than offering it to a viewer.
 */
const meetsRank = (userRole, minRole) => {
  const want = ROLE_HIERARCHY.indexOf(String(minRole || ''));
  if (want < 0) return false;
  const have = ROLE_HIERARCHY.indexOf(normalizeRole(userRole));
  return have >= 0 && have >= want;
};

/** Does this effective permission list allow `permission`? The same rule the server's hasPermission uses. */
const allows = (list: string[] | null | undefined, permission: string): boolean => {
  if (!permission || !Array.isArray(list)) return false;
  if (list.includes('*') || list.includes(permission)) return true;
  const [resource] = String(permission).split(':');
  return list.includes(`${resource}:*`);
};

// The legacy table, for the one case the server's list cannot cover: a build where /me has not
// answered and never will (no session). It is the contractor's vocabulary, so it can only ever say
// no to a dispensary permission — which is the safe direction for a question asked with no session.
const checkPermission = (role, permission) => allows(
  LEGACY_ROLE_PERMISSIONS[normalizeRole(role)] || LEGACY_ROLE_PERMISSIONS.viewer,
  permission,
);

const meetsRoleLevel = meetsRank;

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  // `permissions` is the EFFECTIVE list from the server — the role's rights plus whatever an owner
  // granted this one person in Settings — which AuthContext keeps from /login and /me. (T41)
  const { user, permissions: fromServer } = useAuth() as any;

  const value = useMemo(() => {
    const role = normalizeRole(user?.role);
    const served = Array.isArray(fromServer) && fromServer.length > 0 ? (fromServer as string[]) : null;
    const permissions = served || (LEGACY_ROLE_PERMISSIONS[role] || LEGACY_ROLE_PERMISSIONS.viewer);
    // The server's answer where there is one; the legacy table only with no session at all.
    const ask = (permission: string) => (served ? allows(served, permission) : checkPermission(role, permission));

    return {
      role,
      roleLevel: ROLE_HIERARCHY.indexOf(role),
      permissions,
      /** True once the server has told us; a screen that needs to distinguish "no" from "not yet". */
      permissionsKnown: !!served,

      // Check specific permission
      can: (permission) => ask(permission),

      // Check multiple permissions (any)
      canAny: (perms) => perms.some(p => ask(p)),

      // Check multiple permissions (all)
      canAll: (perms) => perms.every(p => ask(p)),

      // Check minimum role level
      isAtLeast: (minRole) => meetsRoleLevel(role, minRole),
      
      // Convenience checks
      isOwner: role === 'owner',
      isAdmin: meetsRoleLevel(role, 'admin'),
      isManager: meetsRoleLevel(role, 'manager'),
      // `field` is normalised to `budtender` above, which is what the server calls this seat, so
      // isField kept answering false for the very people it describes.
      isField: role === 'budtender',
      isBudtender: role === 'budtender',
      isDriver: role === 'driver',
      isViewer: role === 'viewer',
      
      // Common permission shortcuts — through `ask`, so they read the server's list too.
      canManageTeam: ask('team:create'),
      canManageFinancials: ask('invoices:delete'),
      canApproveTime: ask('time:approve'),
      canCreateQuotes: ask('quotes:create'),
      canDeleteAnything: role === 'owner' || role === 'admin',
    };
    // The permission list is a dependency: it arrives after /me answers, and a memo keyed on the
    // role alone would hand every screen the pre-login answer for the rest of the session.
  }, [user?.role, fromServer]);
  
  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

// Hook to use permissions
export function usePermissions() {
  const context = useContext(PermissionsContext);
  if (!context) {
    // Return safe defaults if used outside provider
    return {
      role: 'viewer',
      roleLevel: 0,
      permissions: [],
      permissionsKnown: false,
      can: () => false,
      canAny: () => false,
      canAll: () => false,
      isAtLeast: () => false,
      isOwner: false,
      isAdmin: false,
      isManager: false,
      isField: false,
      isBudtender: false,
      isDriver: false,
      isViewer: true,
      canManageTeam: false,
      canManageFinancials: false,
      canApproveTime: false,
      canCreateQuotes: false,
      canDeleteAnything: false,
    };
  }
  return context;
}

// Component that only renders children if user has permission
export function Can({ permission, permissions, any = false, fallback = null, children }: any) {
  const { can, canAny, canAll } = usePermissions();
  
  let allowed = false;
  
  if (permission) {
    allowed = can(permission);
  } else if (permissions) {
    allowed = any ? canAny(permissions) : canAll(permissions);
  }
  
  return allowed ? children : fallback;
}

// Component that only renders for specific role or higher
export function RequireRole({ role, fallback = null, children }: any) {
  const { isAtLeast } = usePermissions();
  return isAtLeast(role) ? children : fallback;
}

export default PermissionsContext;
