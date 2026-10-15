// Care plan templates: the starter library (built-in) plus the agency's own. A template is the
// shape of a care plan; "Use Template" (POST /api/care-plans/from-template/:id) makes a draft plan
// from one. Office only.
import { Hono } from 'hono'
import { eq, desc, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { carePlanTemplates } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { userIdOf, writeCareAudit } from '../helpers/careAudit.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

app.get('/', async (c) => {
  const rows = await db.select().from(carePlanTemplates)
    .where(eq(carePlanTemplates.isActive, true))
    .orderBy(desc(carePlanTemplates.isBuiltIn), asc(carePlanTemplates.templateName))
  return c.json(rows)
})

const TEXT_FIELDS = ['templateDescription', 'category', 'serviceType', 'serviceDescription', 'frequency', 'careGoals',
  'specialInstructions', 'precautions', 'medicationNotes', 'mobilityNotes', 'dietaryNotes', 'communicationNotes'] as const

app.post('/', async (c) => {
  const user = c.get('user' as any)
  const b = await c.req.json().catch(() => ({}))
  if (!b.templateName || !String(b.templateName).trim()) return c.json({ error: 'templateName is required' }, 400)
  const values: Record<string, unknown> = { templateName: String(b.templateName).trim(), isBuiltIn: false, createdById: userIdOf(user) }
  for (const k of TEXT_FIELDS) values[k] = b[k] === '' || b[k] === undefined ? null : b[k]
  const [row] = await db.insert(carePlanTemplates).values(values as any).returning()
  await writeCareAudit(user, 'CREATE', 'care_plan_templates', row.id, row)
  return c.json(row, 201)
})

// A built-in is switched off, never deleted; an agency's own template is deleted.
app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select({ isBuiltIn: carePlanTemplates.isBuiltIn }).from(carePlanTemplates).where(eq(carePlanTemplates.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Template not found' }, 404)
  if (existing.isBuiltIn) {
    await db.update(carePlanTemplates).set({ isActive: false, updatedAt: new Date() }).where(eq(carePlanTemplates.id, id))
    return c.json({ message: 'Built-in template deactivated' })
  }
  await db.delete(carePlanTemplates).where(eq(carePlanTemplates.id, id))
  return c.json({ message: 'Template deleted' })
})

export default app
