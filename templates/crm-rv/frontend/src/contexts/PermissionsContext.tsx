import React from 'react';
import { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';
import type { PermissionsValue } from '../types';

const PermissionsContext = createContext<PermissionsValue | null>(null);

// Role hierarchy (lowest to highest)
const ROLE_HIERARCHY = ['viewer', 'field', 'manager', 'admin', 'owner'];

// Define permissions per role (mirrors backend)
const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],

  admin: [
    'contacts:*', 'units:*', 'sales-leads:*', 'repair-orders:*', 'parts:*',
    'fi:*', 'invoices:*', 'documents:*', 'reports:*', 'marketing:*',
    'team:*', 'company:read', 'company:update', 'dashboard:*',
  ],

  manager: [
    'contacts:*', 'units:*', 'sales-leads:*', 'repair-orders:*', 'parts:*',
    'fi:read', 'invoices:read', 'invoices:create', 'invoices:update',
    'documents:*', 'reports:read', 'marketing:read',
    'team:read', 'company:read', 'dashboard:*',
  ],

  // Sales / service staff
  field: [
    'contacts:read', 'units:read', 'sales-leads:read', 'sales-leads:create', 'sales-leads:update',
    'repair-orders:read', 'repair-orders:create', 'repair-orders:update',
    'parts:read', 'documents:read', 'documents:create',
    'company:read', 'dashboard:read',
  ],

  viewer: [
    'contacts:read', 'units:read', 'sales-leads:read', 'repair-orders:read',
    'parts:read', 'invoices:read', 'documents:read', 'reports:read',
    'team:read', 'company:read', 'dashboard:read',
  ],

  // Legacy role mapping
  user: [], // Treated as 'field'
};

// Map legacy roles
const normalizeRole = (role: string | undefined | null): string => {
  if (role === 'user') return 'field';
  return role || 'viewer';
};

// Check if role has permission
const checkPermission = (role: string, permission: string): boolean => {
  const normalizedRole = normalizeRole(role);
  const permissions = ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.viewer;

  // Owner has all permissions
  if (permissions.includes('*')) return true;

  // Exact match
  if (permissions.includes(permission)) return true;

  // Wildcard match (e.g., 'contacts:*' matches 'contacts:read')
  const [resource] = permission.split(':');
  if (permissions.includes(`${resource}:*`)) return true;

  return false;
};

// Check if role meets minimum level
const meetsRoleLevel = (userRole: string, minRole: string): boolean => {
  const userLevel = ROLE_HIERARCHY.indexOf(normalizeRole(userRole));
  const requiredLevel = ROLE_HIERARCHY.indexOf(minRole);
  return userLevel >= requiredLevel;
};

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const value = useMemo((): PermissionsValue => {
    const role = normalizeRole(user?.role);
    const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer;

    return {
      role,
      roleLevel: ROLE_HIERARCHY.indexOf(role),
      permissions,
      can: (permission: string) => checkPermission(role, permission),
      canAny: (perms: string[]) => perms.some(p => checkPermission(role, p)),
      canAll: (perms: string[]) => perms.every(p => checkPermission(role, p)),
      isAtLeast: (minRole: string) => meetsRoleLevel(role, minRole),
      isOwner: role === 'owner',
      isAdmin: meetsRoleLevel(role, 'admin'),
      isManager: meetsRoleLevel(role, 'manager'),
      isField: role === 'field',
      isViewer: role === 'viewer',
      canManageTeam: checkPermission(role, 'team:create'),
      canManageFinancials: checkPermission(role, 'invoices:delete'),
      canApproveTime: checkPermission(role, 'time:approve'),
      canCreateQuotes: checkPermission(role, 'quotes:create'),
      canDeleteAnything: role === 'owner' || role === 'admin',
    };
  }, [user?.role]);

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

// Hook to use permissions
export function usePermissions(): PermissionsValue {
  const context = useContext(PermissionsContext);
  if (!context) {
    // Return safe defaults if used outside provider
    return {
      role: 'viewer',
      roleLevel: 0,
      permissions: [],
      can: () => false,
      canAny: () => false,
      canAll: () => false,
      isAtLeast: () => false,
      isOwner: false,
      isAdmin: false,
      isManager: false,
      isField: false,
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
export function Can({ permission, permissions, any = false, fallback = null, children }: {
  permission?: string;
  permissions?: string[];
  any?: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { can, canAny, canAll } = usePermissions();

  let allowed = false;

  if (permission) {
    allowed = can(permission);
  } else if (permissions) {
    allowed = any ? canAny(permissions) : canAll(permissions);
  }

  return allowed ? <>{children}</> : <>{fallback}</>;
}

// Component that only renders for specific role or higher
export function RequireRole({ role, fallback = null, children }: {
  role: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { isAtLeast } = usePermissions();
  return isAtLeast(role) ? <>{children}</> : <>{fallback}</>;
}

export default PermissionsContext;
