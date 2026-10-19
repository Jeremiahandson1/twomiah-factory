// Lab results: a test, its status, its values and an attached file, on the patient. Moved from
// templates/crm-vet/backend/src/routes/labResults.ts. The registry signs the person in and applies the
// 'patient_records' gate: the template mounted it ungated, and results are recorded on the patient's chart, whose menu
// item is 'patient_records'.
import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { labResult } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'

/**
 * The file URL is free text: any explicit scheme other than http/https (javascript:, data:, vbscript:, file:…) is
 * dropped so a stored URL can't execute when rendered as a link. Relative paths and http(s) pass.
 */
function sanitizeFileUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u.trim()) return null
  const s = u.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:/i.test(s)) return null
  return s
}

/** A result is pending, normal, abnormal, critical or final — it was free text, so "saffron" saved. (Vet T12 L1) */
const LAB_STATUSES = ['pending', 'normal', 'abnormal', 'critical', 'final'] as const
function statusError(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'string' && (LAB_STATUSES as readonly string[]).includes(v.trim().toLowerCase())) return null
  return `Invalid lab status. Expected one of: ${LAB_STATUSES.join(', ')}`
}

export function createLabResultRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const { emitToCompany, EVENTS } = d.realtime
  const app = new Hono<AppEnv>()

  // GET /lab-results — ?patientId=. A list reply (the template: { data } alone).
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const patientId = c.req.query('patientId')
    const conditions = [eq(labResult.companyId, currentUser.companyId)]
    if (patientId) conditions.push(eq(labResult.patientId, patientId))
    const data = await db.select().from(labResult).where(and(...conditions)).orderBy(desc(labResult.resultDate))
    return list(c, data, { page: 1, limit: data.length, total: data.length })
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = await c.req.json()

    const bad = statusError(body.status)
    if (bad) return fail(c, 400, bad)

    const [created] = await db.insert(labResult).values({
      id: createId(),
      patientId: body.patientId,
      visitId: body.visitId || null,
      testName: body.testName,
      category: body.category || null,
      resultDate: body.resultDate || null,
      status: String(body.status || 'final').trim().toLowerCase(),
      results: body.results || {},
      summary: body.summary || null,
      fileUrl: sanitizeFileUrl(body.fileUrl),
      notes: body.notes || null,
      companyId: currentUser.companyId,
    }).returning()

    await audit.log({ action: 'create', entity: 'lab_result', entityId: created.id, metadata: created, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'lab_result' })
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db.select().from(labResult)
      .where(and(eq(labResult.id, id), eq(labResult.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Lab result not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['patientId', 'visitId', 'testName', 'category', 'resultDate', 'status', 'results', 'summary', 'fileUrl', 'notes'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    if ('fileUrl' in updates) updates.fileUrl = sanitizeFileUrl(updates.fileUrl)
    if ('status' in updates) {
      const bad = statusError(updates.status)
      if (bad) return fail(c, 400, bad)
      updates.status = String(updates.status).trim().toLowerCase()
    }

    const [updated] = await db.update(labResult).set(updates).where(eq(labResult.id, id)).returning()
    await audit.log({ action: 'update', entity: 'lab_result', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'lab_result' })
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(labResult)
      .where(and(eq(labResult.id, id), eq(labResult.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Lab result not found')

    await db.delete(labResult).where(eq(labResult.id, id))
    await audit.log({ action: 'delete', entity: 'lab_result', entityId: id, metadata: existing, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'lab_result' })
    return done(c)
  })

  return app
}
