import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { labResult } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// The File URL is free text. Reject any explicit scheme that isn't http/https
// (javascript:, data:, vbscript:, file:, …) so a stored URL can't execute when
// rendered as a link. Relative paths (no scheme) and http(s) are allowed through.
function sanitizeFileUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u.trim()) return null
  const s = u.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:/i.test(s)) return null
  return s
}

// GET /lab-results — ?patientId=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const patientId = c.req.query('patientId')

  const conditions = [eq(labResult.companyId, currentUser.companyId)]
  if (patientId) conditions.push(eq(labResult.patientId, patientId))

  const data = await db.select().from(labResult)
    .where(and(...conditions))
    .orderBy(desc(labResult.resultDate))

  return c.json({ data })
})

// POST /lab-results
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const [created] = await db.insert(labResult).values({
    id: createId(),
    patientId: body.patientId,
    visitId: body.visitId || null,
    testName: body.testName,
    category: body.category || null,
    resultDate: body.resultDate || null,
    status: body.status || 'final',
    results: body.results || {},
    summary: body.summary || null,
    fileUrl: sanitizeFileUrl(body.fileUrl),
    notes: body.notes || null,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'lab_result', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'lab_result' })
  return c.json(created, 201)
})

// PUT /lab-results/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(labResult)
    .where(and(eq(labResult.id, id), eq(labResult.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Lab result not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['patientId', 'visitId', 'testName', 'category', 'resultDate', 'status', 'results', 'summary', 'fileUrl', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if ('fileUrl' in updates) updates.fileUrl = sanitizeFileUrl(updates.fileUrl)

  const [updated] = await db.update(labResult).set(updates).where(eq(labResult.id, id)).returning()
  await audit.log({ action: 'update', entity: 'lab_result', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'lab_result' })
  return c.json(updated)
})

// DELETE /lab-results/:id
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(labResult)
    .where(and(eq(labResult.id, id), eq(labResult.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Lab result not found' }, 404)

  await db.delete(labResult).where(eq(labResult.id, id))
  await audit.log({ action: 'delete', entity: 'lab_result', entityId: id, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'lab_result' })
  return c.json({ success: true })
})

export default app
