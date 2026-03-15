import type { Context, Next } from 'hono'

const ROLE_HIERARCHY: Record<string, number> = {
  driver: 1,
  budtender: 2,
  manager: 3,
  owner: 4,
  admin: 4,
}

export function requireRole(minRole: string) {
  return async (c: Context, next: Next) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const userLevel = ROLE_HIERARCHY[user.role] || 0
    const requiredLevel = ROLE_HIERARCHY[minRole] || 0

    if (userLevel < requiredLevel) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    await next()
  }
}
