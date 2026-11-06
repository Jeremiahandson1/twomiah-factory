// Service codes: the billing codes (with modifiers, unit type and rate) a visit is billed under. Moved from
// templates/crm-homecare/backend/src/routes/serviceCodes.ts.
//
// Permissions: every signed-in person of the agency reads the active codes (care-clients:read, as the template let
// anyone signed in); adding and editing a code is billing (care-billing:create / update; it was admin-only).
//
// Fixed in the move: the template wrote the request body straight into the row (POST values(body), PUT set(body)), so
// a body could set any column — id, is_active, and here company_id; and an edit of a code that does not exist answered
// 200 with nothing. Only the code's own fields are taken now, and a missing code is a 404.
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { serviceCodes } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { body, who, whole } from './shared.ts'

// revenueCode, requiresAuth and notes are the Payers & Codes form's (migration 0011; the template's form sent them and no
// column kept them).
const FIELDS = ['code', 'modifier1', 'modifier2', 'description', 'serviceCategory', 'payerType', 'unitType', 'ratePerUnit', 'requiresEvv', 'isActive', 'revenueCode', 'requiresAuth', 'notes'] as const

function codeValues(b: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of FIELDS) if (b?.[k] !== undefined) out[k] = b[k]
  return out
}

/**
 * Row 24 (care_supervisory_visits): days between supervisory visits for a client authorised for this code — blank for the
 * agency's rule, else a whole number from 1 to 365. Written only when sent; undefined = not sent, a string = the problem.
 */
function supervisoryDays(b: any): { value?: number | null; problem?: string } {
  const raw = b?.supervisoryIntervalDays
  if (raw === undefined) return {}
  if (raw === null || raw === '') return { value: null }
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 365 ? { value: n } : { problem: 'Days between supervisory visits must be a whole number from 1 to 365, or blank for the agency’s rule.' }
}

export function createServiceCodeRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d

  app.get('/', requirePermission('care-clients:read'), async (c) => {
    const { companyId } = who(c)
    return whole(c, await db.select().from(serviceCodes)
      .where(and(eq(serviceCodes.companyId, companyId), eq(serviceCodes.isActive, true))).orderBy(asc(serviceCodes.code)))
  })

  app.post('/', requirePermission('care-billing:create'), async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const days = supervisoryDays(b)
    if (days.problem) return fail(c, 400, days.problem, 'validation_failed', { supervisoryIntervalDays: days.problem })
    const [code] = await db.insert(serviceCodes).values({ ...codeValues(b), ...(days.value !== undefined ? { supervisoryIntervalDays: days.value } : {}), companyId } as any).returning()
    return one(c, code, 201)
  })

  app.put('/:id', requirePermission('care-billing:update'), async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const days = supervisoryDays(b)
    if (days.problem) return fail(c, 400, days.problem, 'validation_failed', { supervisoryIntervalDays: days.problem })
    const values = { ...codeValues(b), ...(days.value !== undefined ? { supervisoryIntervalDays: days.value } : {}) }
    const scope = and(eq(serviceCodes.id, c.req.param('id')), eq(serviceCodes.companyId, companyId))
    const [code] = Object.keys(values).length
      ? await db.update(serviceCodes).set(values).where(scope).returning()
      : await db.select().from(serviceCodes).where(scope).limit(1)
    return code ? one(c, code) : fail(c, 404, 'Service code not found', 'not_found')
  })

  return app
}
