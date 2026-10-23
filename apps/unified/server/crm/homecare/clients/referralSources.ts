// Referral sources: who refers clients (a hospital, a case manager, a payer). Moved from
// templates/crm-homecare/backend/src/routes/referralSources.ts. The same rows are the payers; their billing and Sandata
// settings belong to /api/payers, so this screen writes only the referral fields — never payer_type, the Sandata
// codes, is_active or the id.
//
// Permissions: every signed-in person of the agency reads the active list (care-clients:read, as the template let
// anyone signed in); adding, editing and deleting are the office's (care-clients:create / update / delete).
import { Hono } from 'hono'
import { normaliseZip, ZIP_ERROR } from '@twomiah/tenant-backend'
import { and, asc, eq } from 'drizzle-orm'
import { referralSources } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { who, whole } from './shared.ts'

const REFERRAL_FIELDS = ['name', 'type', 'contactName', 'email', 'phone', 'address', 'city', 'state', 'zip', 'notes'] as const
function referralData(b: any): Record<string, any> {
  const data: Record<string, any> = {}
  for (const k of REFERRAL_FIELDS) if (b?.[k] !== undefined) data[k] = b[k] === null ? null : String(b[k]).trim() || null
  return data
}

export function createReferralSourceRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d

  app.get('/', requirePermission('care-clients:read'), async (c) => {
    const { companyId } = who(c)
    const type = c.req.query('type')
    return whole(c, await db.select().from(referralSources)
      .where(and(eq(referralSources.companyId, companyId), eq(referralSources.isActive, true), type ? eq(referralSources.type, type) : undefined))
      .orderBy(asc(referralSources.name)))
  })

  app.post('/', requirePermission('care-clients:create'), async (c) => {
    const { companyId } = who(c)
    const data = referralData(await c.req.json().catch(() => null))
    if (!data.name) return fail(c, 400, 'Name is required')
    if (data.zip && normaliseZip(data.zip) === null) return fail(c, 400, ZIP_ERROR)
    const [row] = await db.insert(referralSources).values({ ...data, companyId } as any).returning()
    return one(c, row, 201)
  })

  app.put('/:id', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const data = referralData(await c.req.json().catch(() => null))
    if (data.name === null) return fail(c, 400, 'Name is required')
    if (data.zip && normaliseZip(data.zip) === null) return fail(c, 400, ZIP_ERROR)
    const [row] = await db.update(referralSources).set({ ...data, updatedAt: new Date() })
      .where(and(eq(referralSources.id, c.req.param('id')), eq(referralSources.companyId, companyId))).returning()
    return row ? one(c, row) : fail(c, 404, 'Not found')
  })

  app.delete('/:id', requirePermission('care-clients:delete'), async (c) => {
    const { companyId } = who(c)
    const [row] = await db.delete(referralSources)
      .where(and(eq(referralSources.id, c.req.param('id')), eq(referralSources.companyId, companyId))).returning({ id: referralSources.id })
    return row ? done(c) : fail(c, 404, 'Not found')
  })

  return app
}
