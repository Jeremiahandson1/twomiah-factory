import { Context, Next } from 'hono'

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  admin: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*', 'invoices:*', 'time:*',
    'expenses:*', 'documents:*', 'rfis:*', 'change-orders:*', 'punch-lists:*',
    'daily-logs:*', 'inspections:*', 'bids:*', 'team:*', 'company:read',
    'company:update', 'dashboard:*', 'schedule:*',
  ],
  manager: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*', 'invoices:read',
    'invoices:create', 'invoices:update', 'time:*', 'expenses:*', 'documents:*',
    'rfis:*', 'change-orders:*', 'punch-lists:*', 'daily-logs:*', 'inspections:*',
    'bids:read', 'team:read', 'company:read', 'dashboard:*', 'schedule:*',
  ],
  field: [
    'contacts:read', 'projects:read', 'jobs:read', 'jobs:update', 'time:read',
    'time:create', 'time:update', 'expenses:read', 'expenses:create', 'documents:read',
    'documents:create', 'rfis:read', 'rfis:create', 'punch-lists:read',
    'punch-lists:update', 'daily-logs:read', 'daily-logs:create', 'inspections:read',
    'company:read', 'dashboard:read', 'schedule:read',
  ],
  viewer: [
    'contacts:read', 'projects:read', 'jobs:read', 'quotes:read', 'invoices:read',
    'time:read', 'expenses:read', 'documents:read', 'rfis:read', 'change-orders:read',
    'punch-lists:read', 'daily-logs:read', 'inspections:read', 'bids:read',
    'team:read', 'company:read', 'dashboard:read', 'schedule:read',
  ],
  user: [],
}

const ROLE_MAPPING: Record<string, string> = { user: 'field' }
export const ROLE_HIERARCHY = ['viewer', 'field', 'manager', 'admin', 'owner']

function normalizeRole(role: string): string {
  return ROLE_MAPPING[role] || role || 'viewer'
}

export function hasPermission(role: string, permission: string): boolean {
  const normalizedRole = normalizeRole(role)
  const permissions = ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.viewer
  if (permissions.includes('*')) return true
  if (permissions.includes(permission)) return true
  const [resource] = permission.split(':')
  if (permissions.includes(`${resource}:*`)) return true
  return false
}

export function getPermissions(role: string): string[] {
  const normalizedRole = normalizeRole(role)
  return ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.viewer
}

export function requirePermission(permission: string) {
  return async (c: Context, next: Next) => {
    const userRole = (c.get('user') as any)?.role
    if (!userRole) return c.json({ error: 'Authentication required' }, 401)
    if (!hasPermission(userRole, permission)) {
      return c.json({
        error: 'Permission denied',
        required: permission,
        yourRole: normalizeRole(userRole),
      }, 403)
    }
    await next()
  }
}

export function requireAnyPermission(permissions: string[]) {
  return async (c: Context, next: Next) => {
    const userRole = (c.get('user') as any)?.role
    if (!userRole) return c.json({ error: 'Authentication required' }, 401)
    if (!permissions.some(p => hasPermission(userRole, p))) {
      return c.json({
        error: 'Permission denied',
        requiredAny: permissions,
        yourRole: normalizeRole(userRole),
      }, 403)
    }
    await next()
  }
}

export function requireRole(minRole: string) {
  return async (c: Context, next: Next) => {
    const userRole = normalizeRole((c.get('user') as any)?.role)
    if (!userRole) return c.json({ error: 'Authentication required' }, 401)
    const userLevel = ROLE_HIERARCHY.indexOf(userRole)
    const requiredLevel = ROLE_HIERARCHY.indexOf(minRole)
    if (userLevel < requiredLevel) {
      return c.json({
        error: 'Insufficient role',
        required: minRole,
        yourRole: userRole,
      }, 403)
    }
    await next()
  }
}

export function requireOwnership(getOwnerId: (c: Context) => Promise<string>) {
  return async (c: Context, next: Next) => {
    const userRole = normalizeRole((c.get('user') as any)?.role)
    if (ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf('manager')) {
      return next()
    }
    const ownerId = await getOwnerId(c)
    if (ownerId !== (c.get('user') as any).userId) {
      return c.json({ error: 'You can only modify your own entries' }, 403)
    }
    await next()
  }
}

export { normalizeRole, ROLE_PERMISSIONS }
