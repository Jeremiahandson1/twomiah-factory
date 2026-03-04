import { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';

const PermissionsContext = createContext(null);

// Role hierarchy (lowest to highest)
const ROLE_HIERARCHY = ['viewer', 'field', 'manager', 'admin', 'owner'];

// Define permissions per role (mirrors backend)
const ROLE_PERMISSIONS = {
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
const normalizeRole = (role) => {
  if (role === 'user') return 'field';
  return role || 'viewer';
};

// Check if role has permission
const checkPermission = (role, permission) => {
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
const meetsRoleLevel = (userRole, minRole) => {
  const userLevel = ROLE_HIERARCHY.indexOf(normalizeRole(userRole));
  const requiredLevel = ROLE_HIERARCHY.indexOf(minRole);
  return userLevel >= requiredLevel;
};

export function PermissionsProvider({ children }) {
  const { user } = useAuth();
  
  const value = useMemo(() => {
    const role = normalizeRole(user?.role);
    const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer;
    
    return {
      role,
      roleLevel: ROLE_HIERARCHY.indexOf(role),
      permissions,
      
      // Check specific permission
      can: (permission) => checkPermission(role, permission),
      
      // Check multiple permissions (any)
      canAny: (perms) => perms.some(p => checkPermission(role, p)),
      
      // Check multiple permissions (all)
      canAll: (perms) => perms.every(p => checkPermission(role, p)),
      
      // Check minimum role level
      isAtLeast: (minRole) => meetsRoleLevel(role, minRole),
      
      // Convenience checks
      isOwner: role === 'owner',
      isAdmin: meetsRoleLevel(role, 'admin'),
      isManager: meetsRoleLevel(role, 'manager'),
      isField: role === 'field',
      isViewer: role === 'viewer',
      
      // Common permission shortcuts
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
export function usePermissions() {
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
export function Can({ permission, permissions, any = false, fallback = null, children }) {
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
export function RequireRole({ role, fallback = null, children }) {
  const { isAtLeast } = usePermissions();
  return isAtLeast(role) ? children : fallback;
}

export default PermissionsContext;
