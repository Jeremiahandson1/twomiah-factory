import { Hono } from 'hono'
import { eq, and, desc, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { formTemplates, formSubmissions, users } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

app.get('/templates', async (c) => {
  const templates = await db.select()
    .from(formTemplates)
    .where(eq(formTemplates.isActive, true))
    .orderBy(asc(formTemplates.category), asc(formTemplates.name))
  return c.json(templates)
})

app.post('/templates', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const [template] = await db.insert(formTemplates).values({ ...body, createdById: user.userId }).returning()
  return c.json(template, 201)
})

app.put('/templates/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [template] = await db.update(formTemplates).set({ ...body, updatedAt: new Date() }).where(eq(formTemplates.id, id)).returning()
  return c.json(template)
})

app.get('/submissions', async (c) => {
  const { entityType, entityId, templateId } = c.req.query()
  const conditions: any[] = []
  if (entityType) conditions.push(eq(formSubmissions.entityType, entityType))
  if (entityId) conditions.push(eq(formSubmissions.entityId, entityId))
  if (templateId) conditions.push(eq(formSubmissions.templateId, templateId))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db.select({
    id: formSubmissions.id,
    templateId: formSubmissions.templateId,
    templateName: formSubmissions.templateName,
    entityType: formSubmissions.entityType,
    entityId: formSubmissions.entityId,
    clientId: formSubmissions.clientId,
    submittedById: formSubmissions.submittedById,
    submittedByName: formSubmissions.submittedByName,
    data: formSubmissions.data,
    signature: formSubmissions.signature,
    signedAt: formSubmissions.signedAt,
    status: formSubmissions.status,
    createdAt: formSubmissions.createdAt,
    updatedAt: formSubmissions.updatedAt,
    tplName: formTemplates.name,
    tplCategory: formTemplates.category,
    submitterFirstName: users.firstName,
    submitterLastName: users.lastName,
  })
    .from(formSubmissions)
    .leftJoin(formTemplates, eq(formSubmissions.templateId, formTemplates.id))
    .leftJoin(users, eq(formSubmissions.submittedById, users.id))
    .where(where)
    .orderBy(desc(formSubmissions.createdAt))

  const formatted = rows.map(({ tplName, tplCategory, submitterFirstName, submitterLastName, ...rest }) => ({
    ...rest,
    // Flat aliases so the submissions table shows the real form name/category
    // instead of a blank name and a "general" fallback (L-07).
    templateName: rest.templateName || tplName || null,
    category: tplCategory || 'general',
    template: tplName ? { name: tplName, category: tplCategory } : null,
    submittedBy: submitterFirstName ? { firstName: submitterFirstName, lastName: submitterLastName } : null,
  }))

  return c.json(formatted)
})

app.post('/submissions', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()

  // A submission must be attached to someone and a template — the form let you
  // submit empty with no client, storing an orphaned row (clientId: null).
  if (!body.templateId) return c.json({ error: 'A form template is required' }, 400)
  const clientId = body.clientId ?? (body.entityType === 'client' ? body.entityId : null)
  if (!clientId) return c.json({ error: 'Please select a client for this form' }, 400)

  // Backfill templateName/category from the template so rows don't render blank.
  let templateName = body.templateName
  if (!templateName) {
    const [tpl] = await db.select({ name: formTemplates.name }).from(formTemplates).where(eq(formTemplates.id, body.templateId)).limit(1)
    templateName = tpl?.name || null
  }

  const [submission] = await db.insert(formSubmissions).values({
    ...body,
    clientId,
    templateName,
    entityType: body.entityType || 'client',
    entityId: body.entityId || clientId,
    submittedById: user.userId,
    submittedByName: `${user.firstName} ${user.lastName}`,
    status: body.signature ? 'signed' : 'submitted',
    signedAt: body.signature ? new Date() : null,
  }).returning()
  return c.json(submission, 201)
})

// DELETE /api/forms/submissions/:id
app.delete('/submissions/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select({ id: formSubmissions.id }).from(formSubmissions).where(eq(formSubmissions.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Submission not found' }, 404)
  await db.delete(formSubmissions).where(eq(formSubmissions.id, id))
  return c.json({ message: 'Submission deleted' })
})

export default app
