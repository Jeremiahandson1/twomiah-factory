import { Context, Next } from 'hono'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  admin: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*', 'invoices:*', 'time:*',
    'expenses:*', 'documents:*', 'rfis:*', 'change-orders:*', 'punch-lists:*',
    'daily-logs:*', 'inspections:*', 'bids:*', 'team:*', 'company:read',
    'company:update', 'dashboard:*', 'schedule:*', 'pricebook:*',
  ],
  manager: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*', 'invoices:read',
    'invoices:create', 'invoices:update', 'time:*', 'expenses:*', 'documents:*',
    'rfis:*', 'change-orders:*', 'punch-lists:*', 'daily-logs:*', 'inspections:*',
    'bids:read', 'team:read', 'company:read', 'dashboard:*', 'schedule:*', 'pricebook:*',
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
