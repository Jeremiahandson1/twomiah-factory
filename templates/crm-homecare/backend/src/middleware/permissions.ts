/**
 * Permissions middleware stub for crm-homecare.
 * The homecare CRM uses authenticate + authorizeAdmin for access control.
 * This stub allows route files imported from the contractor CRM to work
 * without modification — requirePermission passes through to next().
 */
import type { Context, Next } from 'hono'

export function requirePermission(_permission: string) {
  return async (_c: Context, next: Next) => {
    await next()
  }
}

export function requireRole(_role: string) {
  return async (_c: Context, next: Next) => {
    await next()
  }
}
