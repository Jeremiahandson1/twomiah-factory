// Role → permission matrix + the guards built on it — one implementation for every CRM.
// A template can widen a role (`extraRolePermissions`) or map its own role names onto the standard
// ones (`roleMapping`, e.g. vet's `staff` → `field`); the matrix itself is shared.
import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'

export const ROLE_HIERARCHY = ['viewer', 'field', 'manager', 'admin', 'owner']

export const BASE_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  admin: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*', 'invoices:*', 'time:*',
    'expenses:*', 'documents:*', 'rfis:*', 'change-orders:*', 'punch-lists:*',
    'daily-logs:*', 'inspections:*', 'bids:*', 'team:*', 'company:read',
    'company:update', 'dashboard:*', 'schedule:*', 'pricebook:*', 'marketing:*',
    'tasks:*',
    // operational modules (writes gated in their routes; reads are open)
    'equipment:*', 'fleet:*', 'warranties:*', 'inventory:*', 'agreements:*',
    'selections:*', 'takeoffs:*', 'calltracking:*', 'reports:*',
    // company config (geofencing, Stripe onboarding) + refunds — admin-tier, like company:update
    'settings:*', 'payments:*',
    // ads:read / ads:update (pause, dismiss, A/B tests) / ads:settings (profile, mode, platforms) / ads:spend (launch, resume, apply, AI preview)
    'ads:*',
  ],
  manager: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*', 'invoices:read',
    'invoices:create', 'invoices:update', 'time:*', 'expenses:*', 'documents:*',
    'rfis:*', 'change-orders:*', 'punch-lists:*', 'daily-logs:*', 'inspections:*',
    'bids:read', 'team:read', 'company:read', 'dashboard:*', 'schedule:*', 'pricebook:*',
    'marketing:read', 'marketing:create', 'marketing:update',
    'ads:read', 'ads:update',
    'tasks:*',
    // operational modules (writes gated in their routes; reads are open) + read-only reports
    'equipment:*', 'fleet:*', 'warranties:*', 'inventory:*', 'agreements:*',
    'selections:*', 'takeoffs:*', 'calltracking:*', 'reports:read',
  ],
  field: [
    'contacts:read', 'projects:read', 'jobs:read', 'jobs:update', 'time:read',
    'time:create', 'time:update', 'expenses:read', 'expenses:create', 'documents:read',
    'documents:create', 'rfis:read', 'rfis:create', 'punch-lists:read',
    'punch-lists:update', 'daily-logs:read', 'daily-logs:create', 'inspections:read',
    'company:read', 'dashboard:read', 'schedule:read',
    // create + read any; update/delete gated to own tasks (assignee or creator) in the routes
    'tasks:read', 'tasks:create', 'tasks:update',
  ],
  viewer: [
    'contacts:read', 'projects:read', 'jobs:read', 'quotes:read', 'invoices:read',
    'time:read', 'expenses:read', 'documents:read', 'rfis:read', 'change-orders:read',
    'punch-lists:read', 'daily-logs:read', 'inspections:read', 'bids:read',
    'team:read', 'company:read', 'dashboard:read', 'schedule:read',
    'tasks:read',
  ],
  user: [],
}

export interface PermissionsDeps {
  db: any
  tables: { user: any }
  /** Permissions appended to a role's base list, e.g. `{ field: ['contacts:create'] }`. */
  extraRolePermissions?: Record<string, string[]>
  /** Template role names mapped onto the standard hierarchy. `user → field` is always included. */
  roleMapping?: Record<string, string>
  /**
   * What this vertical CALLS each rung, for anything a person reads. The hierarchy is named for the
   * trades it was built for, so a salon stylist was told "yourRole: field" when refused. The names are
   * presentation only — every gate still works on the hierarchy id. (Salon T28 M3)
   */
  roleLabels?: Record<string, string>
}

/**
 * What the fleet calls each rung when nothing overrides it. Kept identical to ROLE_LABELS in
 * packages/tenant-ui/src/shell/types.ts so the server and the screen say the same word — before this,
 * an unconfigured vertical answered the raw id ("field") while its own Users table showed "Staff".
 */
const DEFAULT_ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', field: 'Staff', user: 'Staff', viewer: 'Viewer' }

export function createPermissions(deps: PermissionsDeps) {
  const { db, tables: { user } } = deps
  const ROLE_PERMISSIONS: Record<string, string[]> = {}
  for (const [role, list] of Object.entries(BASE_ROLE_PERMISSIONS)) {
    const extra = deps.extraRolePermissions?.[role] || []
    ROLE_PERMISSIONS[role] = Array.from(new Set([...list, ...extra]))
  }
  for (const [role, extra] of Object.entries(deps.extraRolePermissions || {})) {
    if (!ROLE_PERMISSIONS[role]) ROLE_PERMISSIONS[role] = Array.from(new Set(extra))
  }
  const ROLE_MAPPING: Record<string, string> = { user: 'field', ...(deps.roleMapping || {}) }

  function normalizeRole(role: string): string {
    return ROLE_MAPPING[role] || role || 'viewer'
  }

  /** The hierarchy id in this vertical's own words — for messages people read, never for a decision. */
  function roleLabel(role: string): string {
    const id = normalizeRole(role)
    return deps.roleLabels?.[id] || DEFAULT_ROLE_LABELS[id] || (id ? id[0].toUpperCase() + id.slice(1) : id)
  }

  // Per-user grants the OWNER hands out on top of the role (Settings › Users), e.g. users:read.
  // Read from the user row and cached 15s per user so every guarded request does not pay a query.
  const GRANT_CACHE = new Map<string, { at: number; list: string[] }>()
  async function getExtraPermissions(userId: string | undefined): Promise<string[]> {
    if (!userId) return []
    const hit = GRANT_CACHE.get(userId)
    if (hit && Date.now() - hit.at < 15_000) return hit.list
    let list: string[] = []
    try {
      const [row] = await db.select({ extra: user.extraPermissions }).from(user).where(eq(user.id, userId)).limit(1)
      list = Array.isArray(row?.extra) ? (row!.extra as string[]).filter((x) => typeof x === 'string') : []
    } catch { list = [] }
    GRANT_CACHE.set(userId, { at: Date.now(), list })
    return list
  }
  function invalidateExtraPermissions(userId: string) { GRANT_CACHE.delete(userId) }

  function hasPermission(role: string, permission: string, extra: string[] = []): boolean {
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

  function getPermissions(role: string): string[] {
    const normalizedRole = normalizeRole(role)
    return ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.viewer
  }

  function requirePermission(permission: string) {
    return async (c: Context, next: Next) => {
      const userRole = (c.get('user') as any)?.role
      if (!userRole) return c.json({ error: 'Authentication required' }, 401)
      const extra = await getExtraPermissions((c.get('user') as any)?.userId)
      if (!hasPermission(userRole, permission, extra)) {
        return c.json({ error: 'Permission denied', required: permission, yourRole: roleLabel(userRole) }, 403)
      }
      await next()
    }
  }

  function requireAnyPermission(permissions: string[]) {
    return async (c: Context, next: Next) => {
      const userRole = (c.get('user') as any)?.role
      if (!userRole) return c.json({ error: 'Authentication required' }, 401)
      const extra = await getExtraPermissions((c.get('user') as any)?.userId)
      if (!permissions.some(p => hasPermission(userRole, p, extra))) {
        return c.json({ error: 'Permission denied', requiredAny: permissions, yourRole: roleLabel(userRole) }, 403)
      }
      await next()
    }
  }

  /** Hierarchy gate: the user's role must be at least `minRole` (viewer < field < manager < admin < owner). */
  function requireRole(minRole: string) {
    return async (c: Context, next: Next) => {
      const userRole = normalizeRole((c.get('user') as any)?.role)
      if (!userRole) return c.json({ error: 'Authentication required' }, 401)
      const userLevel = ROLE_HIERARCHY.indexOf(userRole)
      const requiredLevel = ROLE_HIERARCHY.indexOf(minRole)
      if (userLevel < requiredLevel) {
        // the label, not the id — requirePermission's two refusals above already answer in the vertical's
        // own words, and this one sat three lines away still saying "field". (Salon T31)
        return c.json({ error: 'Insufficient role', required: minRole, yourRole: roleLabel(userRole) }, 403)
      }
      await next()
    }
  }

  function requireOwnership(getOwnerId: (c: Context) => Promise<string>) {
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

  return {
    ROLE_HIERARCHY, ROLE_PERMISSIONS, normalizeRole, roleLabel,
    getExtraPermissions, invalidateExtraPermissions,
    hasPermission, getPermissions,
    requirePermission, requireAnyPermission, requireRole, requireOwnership,
  }
}

export type Permissions = ReturnType<typeof createPermissions>
