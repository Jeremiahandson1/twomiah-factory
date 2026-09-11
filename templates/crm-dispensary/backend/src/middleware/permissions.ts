import { Context, Next } from 'hono'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

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

// Per-user grants the OWNER hands out on top of the role (Settings › Users), e.g. users:read.
// Read from the user row and cached 15s per user so every guarded request does not pay a query.
const GRANT_CACHE = new Map<string, { at: number; list: string[] }>()
export async function getExtraPermissions(userId: string | undefined): Promise<string[]> {
  if (!userId) return []
  const hit = GRANT_CACHE.get(userId)
  if (hit && Date.now() - hit.at < 15_000) return hit.list
  let list: string[] = []
  try {
    const [row] = await db.select({ extra: (user as any).extraPermissions }).from(user).where(eq(user.id, userId)).limit(1)
    list = Array.isArray(row?.extra) ? (row!.extra as string[]).filter((x) => typeof x === 'string') : []
  } catch { list = [] }
  GRANT_CACHE.set(userId, { at: Date.now(), list })
  return list
}
export function invalidateExtraPermissions(userId: string) { GRANT_CACHE.delete(userId) }

export function hasPermission(role: string, permission: string, extra: string[] = []): boolean {
  // Per-user grants (extra_permissions) sit on top of the role.
  if (extra.includes('*') || extra.includes(permission)) return true
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
    const extra = await getExtraPermissions((c.get('user') as any)?.userId)
    if (!hasPermission(userRole, permission, extra)) {
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
    const extra = await getExtraPermissions((c.get('user') as any)?.userId)
    if (!permissions.some(p => hasPermission(userRole, p, extra))) {
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
