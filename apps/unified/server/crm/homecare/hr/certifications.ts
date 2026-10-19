// Certification records and training records: the office records and removes them (care-hr); a caregiver reads their
// own. Moved from templates/crm-homecare/backend/src/routes/{certifications,trainingRecords}.ts, mounted at
// /api/certifications and /api/training-records.
//
// Changes: the company's rows only; lists are { data, pagination }; a caregiver reads only their own training records —
// the template's GET /api/training-records and /api/training-records/:id had no narrowing at all, so any caregiver could
// read every colleague's training (now the same rule as certifications: core/selfService.ts).
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { certificationRecords, trainingRecords, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { requireAdminOrSelf, selfSubject } from '../core/selfService.ts'
import { all, body, companyOf, me, personInCompany, idOf } from './shared.ts'

export function createCertificationsRoutes(_core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions

  // GET /api/certifications?caregiverId= — the office: anyone's (or all); a caregiver: their own
  app.get('/', async (c) => {
    const companyId = companyOf(c)
    const who = selfSubject(c, c.req.query('caregiverId'))
    if ('refusal' in who) return who.refusal
    const caregiverId = who.office ? c.req.query('caregiverId') : who.id
    const rows = caregiverId
      ? await d.db.select().from(certificationRecords)
        .where(and(eq(certificationRecords.companyId, companyId), eq(certificationRecords.caregiverId, caregiverId)))
        .orderBy(desc(certificationRecords.createdAt))
      : await d.db.select().from(certificationRecords)
        .where(eq(certificationRecords.companyId, companyId))
        .orderBy(desc(certificationRecords.createdAt)).limit(500)
    return all(c, rows)
  })

  // GET /api/certifications/caregiver/:id
  app.get('/caregiver/:id', requireAdminOrSelf('id'), async (c) => {
    const rows = await d.db.select().from(certificationRecords)
      .where(and(eq(certificationRecords.companyId, companyOf(c)), eq(certificationRecords.caregiverId, idOf(c))))
      .orderBy(desc(certificationRecords.createdAt))
    return all(c, rows)
  })

  // POST /api/certifications
  app.post('/', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const b = await body(c)
    if (!b.caregiverId || !b.certificationType) return fail(c, 400, 'caregiverId and certificationType are required')
    const caregiverId = await personInCompany(d, companyId, String(b.caregiverId))
    if (!caregiverId) return fail(c, 404, 'Caregiver not found')
    const [row] = await d.db.insert(certificationRecords).values({
      companyId,
      caregiverId,
      certificationType: b.certificationType,
      issuingBody: b.issuingBody,
      issueDate: b.issueDate,
      expiryDate: b.expiryDate,
      documentUrl: b.documentUrl,
      status: b.status || 'active',
    }).returning()
    return one(c, row, 201)
  })

  // DELETE /api/certifications/:id
  app.delete('/:id', requirePermission('care-hr:delete'), async (c) => {
    const [row] = await d.db.delete(certificationRecords)
      .where(and(eq(certificationRecords.id, idOf(c)), eq(certificationRecords.companyId, companyOf(c))))
      .returning({ id: certificationRecords.id })
    if (!row) return fail(c, 404, 'Certification not found')
    return done(c)
  })

  return app
}

const trainingColumns = {
  id: trainingRecords.id,
  caregiverId: trainingRecords.caregiverId,
  trainingName: trainingRecords.trainingName,
  provider: trainingRecords.provider,
  completedDate: trainingRecords.completedDate,
  expiryDate: trainingRecords.expiryDate,
  hoursCompleted: trainingRecords.hoursCompleted,
  certificateUrl: trainingRecords.certificateUrl,
  status: trainingRecords.status,
  createdAt: trainingRecords.createdAt,
  caregiverFirstName: user.firstName,
  caregiverLastName: user.lastName,
}

export function createTrainingRecordsRoutes(_core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const query = (companyId: string, caregiverId?: string | null) => d.db.select(trainingColumns)
    .from(trainingRecords)
    .leftJoin(user, eq(trainingRecords.caregiverId, user.id))
    .where(and(eq(trainingRecords.companyId, companyId), caregiverId ? eq(trainingRecords.caregiverId, caregiverId) : undefined))
    .orderBy(desc(trainingRecords.createdAt))

  // GET /api/training-records?caregiverId= — the office: anyone's (or all); a caregiver: their own
  app.get('/', async (c) => {
    const who = selfSubject(c, c.req.query('caregiverId'))
    if ('refusal' in who) return who.refusal
    return all(c, await query(companyOf(c), who.office ? c.req.query('caregiverId') : who.id))
  })

  // GET /api/training-records/:id — one caregiver's records (the office's, or the caregiver's own)
  app.get('/:id', requireAdminOrSelf('id'), async (c) => all(c, await query(companyOf(c), idOf(c))))

  // POST /api/training-records — the office records training
  app.post('/', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const b = await body(c)
    if (!b.caregiverId || !b.trainingName) return fail(c, 400, 'caregiverId and trainingName are required')
    const caregiverId = await personInCompany(d, companyId, String(b.caregiverId))
    if (!caregiverId) return fail(c, 404, 'Caregiver not found')
    const [row] = await d.db.insert(trainingRecords).values({
      companyId,
      caregiverId,
      trainingName: b.trainingName,
      provider: b.provider || null,
      completedDate: b.completedDate || null,
      expiryDate: b.expiryDate || null,
      hoursCompleted: b.hoursCompleted === '' || b.hoursCompleted == null ? null : String(b.hoursCompleted),
      certificateUrl: b.certificateUrl || null,
      certificationNumber: b.certificationNumber || null,
      status: b.status || 'completed',
      recordedById: me(c)?.userId || null,
    }).returning()
    return one(c, row, 201)
  })

  // DELETE /api/training-records/:id
  app.delete('/:id', requirePermission('care-hr:delete'), async (c) => {
    const [row] = await d.db.delete(trainingRecords)
      .where(and(eq(trainingRecords.id, idOf(c)), eq(trainingRecords.companyId, companyOf(c))))
      .returning({ id: trainingRecords.id })
    if (!row) return fail(c, 404, 'Training record not found')
    return done(c)
  })

  return app
}
