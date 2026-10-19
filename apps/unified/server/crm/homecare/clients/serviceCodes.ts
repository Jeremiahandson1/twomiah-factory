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

const FIELDS = ['code', 'modifier1', 'modifier2', 'description', 'serviceCategory', 'payerType', 'unitType', 'ratePerUnit', 'requiresEvv', 'isActive'] as const

function codeValues(b: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of FIELDS) if (b?.[k] !== undefined) out[k] = b[k]
  return out
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
    const [code] = await db.insert(serviceCodes).values({ ...codeValues(await body(c)), companyId } as any).returning()
    return one(c, code, 201)
  })

  app.put('/:id', requirePermission('care-billing:update'), async (c) => {
    const { companyId } = who(c)
    const values = codeValues(await body(c))
    const scope = and(eq(serviceCodes.id, c.req.param('id')), eq(serviceCodes.companyId, companyId))
    const [code] = Object.keys(values).length
      ? await db.update(serviceCodes).set(values).where(scope).returning()
      : await db.select().from(serviceCodes).where(scope).limit(1)
    return code ? one(c, code) : fail(c, 404, 'Service code not found')
  })

  return app
}
