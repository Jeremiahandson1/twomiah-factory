// Care plan templates: the starter library (built-in) plus the agency's own. A template is the shape of a care plan;
// "Use Template" (POST /api/care-plans/from-template/:id) makes a draft plan from one. Office only. Moved from
// templates/crm-homecare/backend/src/routes/carePlanTemplates.ts.
//
// The built-ins were seeded once into the one agency's database by 0017_care.sql; a template row belongs to a company
// here, so each company's six are written the first time it reads its library (never again once any built-in exists,
// as the migration's guard had it — a switched-off built-in stays off).
//
// Permissions: care-clients:update to read the library (it was admin-only), :create to add, :delete to remove.
import { Hono } from 'hono'
import { and, asc, desc, eq } from 'drizzle-orm'
import { carePlanTemplates } from '../../../db/schema/index.ts'
import { lockFor } from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { BUILT_IN_CARE_PLAN_TEMPLATES } from './builtIns.ts'
import { body, who, whole } from './shared.ts'

const TEXT_FIELDS = ['templateDescription', 'category', 'serviceType', 'serviceDescription', 'frequency', 'careGoals',
  'specialInstructions', 'precautions', 'medicationNotes', 'mobilityNotes', 'dietaryNotes', 'communicationNotes'] as const

export function createCarePlanTemplateRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d

  /** The company's starter library, written on its first read. */
  async function ensureBuiltIns(companyId: string) {
    await db.transaction(async (tx: any) => {
      await lockFor(tx, `care_plan_templates:${companyId}`)
      const [any] = await tx.select({ id: carePlanTemplates.id }).from(carePlanTemplates)
        .where(and(eq(carePlanTemplates.companyId, companyId), eq(carePlanTemplates.isBuiltIn, true))).limit(1)
      if (any) return
      await tx.insert(carePlanTemplates).values(BUILT_IN_CARE_PLAN_TEMPLATES.map((t) => ({ ...t, companyId, isBuiltIn: true })))
    })
  }

  app.get('/', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    await ensureBuiltIns(companyId)
    const rows = await db.select().from(carePlanTemplates)
      .where(and(eq(carePlanTemplates.companyId, companyId), eq(carePlanTemplates.isActive, true)))
      .orderBy(desc(carePlanTemplates.isBuiltIn), asc(carePlanTemplates.templateName))
    return whole(c, rows)
  })

  app.post('/', requirePermission('care-clients:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    if (!b.templateName || !String(b.templateName).trim()) return fail(c, 400, 'templateName is required')
    const values: Record<string, unknown> = { templateName: String(b.templateName).trim(), isBuiltIn: false, createdById: me }
    for (const k of TEXT_FIELDS) values[k] = b[k] === '' || b[k] === undefined ? null : b[k]
    const [row] = await db.insert(carePlanTemplates).values({ ...values, companyId } as any).returning()
    await core.careAudit.writeCareAudit(user, 'CREATE', 'care_plan_templates', row.id, row)
    return one(c, row, 201)
  })

  // A built-in is switched off, never deleted; an agency's own template is deleted.
  app.delete('/:id', requirePermission('care-clients:delete'), async (c) => {
    const { companyId } = who(c)
    const scope = and(eq(carePlanTemplates.id, c.req.param('id')), eq(carePlanTemplates.companyId, companyId))
    const [existing] = await db.select({ isBuiltIn: carePlanTemplates.isBuiltIn }).from(carePlanTemplates).where(scope).limit(1)
    if (!existing) return fail(c, 404, 'Template not found')
    if (existing.isBuiltIn) {
      await db.update(carePlanTemplates).set({ isActive: false, updatedAt: new Date() }).where(scope)
      return done(c, 'Built-in template deactivated')
    }
    await db.delete(carePlanTemplates).where(scope)
    return done(c, 'Template deleted')
  })

  return app
}
