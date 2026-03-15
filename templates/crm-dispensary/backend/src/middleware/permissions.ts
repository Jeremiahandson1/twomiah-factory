import { Context, Next } from 'hono'

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  admin: [
    'contacts:*', 'products:*', 'orders:*', 'loyalty:*', 'delivery:*',
    'cash:*', 'analytics:*', 'audit:*', 'team:*', 'documents:*',
    'settings:*', 'merch:*', 'company:read', 'company:update',
    'dashboard:*', 'inventory:*', 'leads:*', 'support:*', 'marketing:*',
  ],
  manager: [
    'contacts:*', 'products:*', 'orders:*', 'loyalty:*', 'delivery:*',
    'cash:*', 'analytics:read', 'audit:read', 'team:read', 'documents:*',
    'merch:*', 'company:read', 'dashboard:*', 'inventory:*',
    'leads:*', 'support:*', 'marketing:read',
  ],
  budtender: [
    'contacts:read', 'contacts:create', 'contacts:update',
    'products:read', 'orders:read', 'orders:create', 'orders:update',
    'loyalty:read', 'loyalty:create', 'cash:read', 'cash:create', 'cash:update',
    'documents:read', 'company:read', 'dashboard:read', 'inventory:read',
    'leads:read', 'leads:create', 'support:read',
  ],
  driver: [
    'contacts:read', 'orders:read', 'orders:update', 'delivery:read', 'delivery:update',
    'company:read', 'dashboard:read',
  ],
  viewer: [
    'contacts:read', 'products:read', 'orders:read', 'loyalty:read',
    'delivery:read', 'cash:read', 'analytics:read', 'audit:read',
    'team:read', 'documents:read', 'company:read', 'dashboard:read',
    'inventory:read', 'leads:read', 'support:read',
  ],
  user: [],
}

const ROLE_MAPPING: Record<string, string> = { user: 'budtender', field: 'budtender' }
export const ROLE_HIERARCHY = ['viewer', 'driver', 'budtender', 'manager', 'admin', 'owner']

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
