/**
 * Role-Based Access Control (RBAC) Middleware
 * 
 * Roles (highest to lowest):
 * - owner: Full access, can delete company, manage billing
 * - admin: Full access except company deletion
 * - manager: Manage team, approve time/expenses, view financials
 * - field: View assigned jobs, log time, update job status
 * - viewer: Read-only access
 */

// Define what each role can do
// Format: 'resource:action' or 'resource:*' for all actions
const ROLE_PERMISSIONS = {
  owner: ['*'], // Everything
  
  admin: [
    'contacts:*',
    'projects:*',
    'jobs:*',
    'quotes:*',
    'invoices:*',
    'time:*',
    'expenses:*',
    'documents:*',
    'rfis:*',
    'change-orders:*',
    'punch-lists:*',
    'daily-logs:*',
    'inspections:*',
    'bids:*',
    'team:*',
    'company:read',
    'company:update',
    'dashboard:*',
    'schedule:*',
  ],
  
  manager: [
    'contacts:*',
    'projects:*',
    'jobs:*',
    'quotes:*',
    'invoices:read',
    'invoices:create',
    'invoices:update',
    'time:*',
    'expenses:*',
    'documents:*',
    'rfis:*',
    'change-orders:*',
    'punch-lists:*',
    'daily-logs:*',
    'inspections:*',
    'bids:read',
    'team:read',
    'company:read',
    'dashboard:*',
    'schedule:*',
  ],
  
  field: [
    'contacts:read',
    'projects:read',
    'jobs:read',
    'jobs:update', // Update status on assigned jobs
    'time:read',
    'time:create',
    'time:update', // Own entries only (enforced in route)
    'expenses:read',
    'expenses:create', // Own expenses only
    'documents:read',
    'documents:create', // Upload photos
    'rfis:read',
    'rfis:create',
    'punch-lists:read',
    'punch-lists:update',
    'daily-logs:read',
    'daily-logs:create',
    'inspections:read',
    'company:read',
    'dashboard:read',
    'schedule:read',
  ],
  
  viewer: [
    'contacts:read',
    'projects:read',
    'jobs:read',
    'quotes:read',
    'invoices:read',
    'time:read',
    'expenses:read',
    'documents:read',
    'rfis:read',
    'change-orders:read',
    'punch-lists:read',
    'daily-logs:read',
    'inspections:read',
    'bids:read',
    'team:read',
    'company:read',
    'dashboard:read',
    'schedule:read',
  ],
  
  // Legacy role mapping
  user: [], // Will be treated as 'field'
};

// Map legacy roles to new roles
const ROLE_MAPPING = {
  user: 'field',
  // Add any other legacy mappings here
};

/**
 * Normalize role name (handle legacy roles)
 */
function normalizeRole(role) {
  return ROLE_MAPPING[role] || role || 'viewer';
}

/**
 * Check if a role has a specific permission
 */
function hasPermission(role, permission) {
  const normalizedRole = normalizeRole(role);
  const permissions = ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.viewer;
  
  // Owner has all permissions
  if (permissions.includes('*')) {
    return true;
  }
  
  // Check exact match
  if (permissions.includes(permission)) {
    return true;
  }
  
  // Check wildcard (e.g., 'contacts:*' matches 'contacts:read')
  const [resource, action] = permission.split(':');
  if (permissions.includes(`${resource}:*`)) {
    return true;
  }
  
  return false;
}

/**
 * Get all permissions for a role
 */
function getPermissions(role) {
  const normalizedRole = normalizeRole(role);
  return ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.viewer;
}

/**
 * Middleware factory: Require specific permission
 * 
 * Usage:
 *   router.post('/', authenticate, requirePermission('contacts:create'), handler)
 */
function requirePermission(permission) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    
    if (!userRole) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!hasPermission(userRole, permission)) {
      return res.status(403).json({ 
        error: 'Permission denied',
        required: permission,
        yourRole: normalizeRole(userRole),
      });
    }
    
    next();
  };
}

/**
 * Middleware factory: Require any of the specified permissions
 * 
 * Usage:
 *   router.get('/', authenticate, requireAnyPermission(['invoices:read', 'invoices:create']), handler)
 */
function requireAnyPermission(permissions) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    
    if (!userRole) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const hasAny = permissions.some(p => hasPermission(userRole, p));
    
    if (!hasAny) {
      return res.status(403).json({ 
        error: 'Permission denied',
        requiredAny: permissions,
        yourRole: normalizeRole(userRole),
      });
    }
    
    next();
  };
}

/**
 * Middleware factory: Require specific role or higher
 * 
 * Usage:
 *   router.delete('/', authenticate, requireRole('admin'), handler)
 */
const ROLE_HIERARCHY = ['viewer', 'field', 'manager', 'admin', 'owner'];

function requireRole(minRole) {
  return (req, res, next) => {
    const userRole = normalizeRole(req.user?.role);
    
    if (!userRole) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userLevel = ROLE_HIERARCHY.indexOf(userRole);
    const requiredLevel = ROLE_HIERARCHY.indexOf(minRole);
    
    if (userLevel < requiredLevel) {
      return res.status(403).json({ 
        error: 'Insufficient role',
        required: minRole,
        yourRole: userRole,
      });
    }
    
    next();
  };
}

/**
 * Check if user is owner of a resource (for field workers editing own entries)
 */
function requireOwnership(getOwnerId) {
  return async (req, res, next) => {
    const userRole = normalizeRole(req.user?.role);
    
    // Managers and above can edit anyone's
    if (ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf('manager')) {
      return next();
    }
    
    // Field workers can only edit their own
    try {
      const ownerId = await getOwnerId(req);
      if (ownerId !== req.user.userId) {
        return res.status(403).json({ 
          error: 'You can only modify your own entries',
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export {
  hasPermission,
  getPermissions,
  requirePermission,
  requireAnyPermission,
  requireRole,
  requireOwnership,
  normalizeRole,
  ROLE_PERMISSIONS,
  ROLE_HIERARCHY,
};
