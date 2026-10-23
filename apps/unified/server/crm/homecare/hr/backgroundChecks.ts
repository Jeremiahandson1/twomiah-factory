// Background checks — a caregiver's criminal-history record, so the whole router is the office's (care-hr; the
// template's authenticate + requireAdmin on every route, reads included). Moved from
// templates/crm-homecare/backend/src/routes/backgroundChecks.ts, mounted at /api/background-checks. The encrypted SSN /
// licence columns never leave the server.
//
// Wisconsin agencies also get the automated half: WORCS checks submitted from the onboarding packet, the 30-minute
// poll (core.worcsPoll, also triggerable here) and the eligibility engine against the Wisconsin bar list.
//
// Changes: the company's checks and caregivers only (a document is reached through its check, which is the company's);
// "Poll WORCS Now" polls this company's checks; lists are { data, pagination }; the compliance report's keys are
// camelCase (passedChecks, failedChecks, pendingChecks); the document delete answers { success, message }.
import { Hono } from 'hono'
import { and, asc, desc, eq } from 'drizzle-orm'
import { backgroundChecks, backgroundCheckDocuments, user } from '../../../db/schema/index.ts'
import { backgroundCheckCompliance, checkDocumentCount, expiresWithin, expiresWithin30 } from '../../../data/homecareHrRoutes.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { all, body, companyOf, me, personInCompany } from './shared.ts'

// Result letters: PDF or image, 7 MB file → ~9.5 MB as a base64 data URI.
export const DOCUMENT_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
export const DOCUMENT_MAX_DATA_URI_LENGTH = 9_500_000

export const CHECK_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'expired', 'error']

const safeColumns = {
  id: backgroundChecks.id,
  caregiverId: backgroundChecks.caregiverId,
  checkType: backgroundChecks.checkType,
  provider: backgroundChecks.provider,
  cost: backgroundChecks.cost,
  status: backgroundChecks.status,
  result: backgroundChecks.result,
  initiatedDate: backgroundChecks.initiatedDate,
  completedDate: backgroundChecks.completedDate,
  expirationDate: backgroundChecks.expirationDate,
  worcsReferenceNumber: backgroundChecks.worcsReferenceNumber,
  worcsStatus: backgroundChecks.worcsStatus,
  driversLicenseState: backgroundChecks.driversLicenseState,
  referenceNumber: backgroundChecks.referenceNumber,
  findings: backgroundChecks.findings,
  notes: backgroundChecks.notes,
  createdById: backgroundChecks.createdById,
  createdAt: backgroundChecks.createdAt,
  updatedAt: backgroundChecks.updatedAt,
}

const blankToNull = (v: unknown) => (v === '' || v === undefined ? null : v)
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(new Date(v).getTime())

const parseDataUri = (uri: unknown) => {
  const m = /^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(uri || ''))
  return m ? { mime: m[1].toLowerCase(), base64: m[2] } : null
}
const safeFileName = (name: unknown) => String(name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200) || 'file'

export function createBackgroundChecksRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const read = requirePermission('care-hr:read')
  const ours = (companyId: string, id: string) => and(eq(backgroundChecks.id, id), eq(backgroundChecks.companyId, companyId))
  /** The check, when it is this company's. */
  const checkOf = async (companyId: string, id: string) => {
    const [row] = await d.db.select({ id: backgroundChecks.id }).from(backgroundChecks).where(ours(companyId, id))
    return row?.id as string | undefined
  }

  // GET /api/background-checks?status=&type=&caregiverId=
  app.get('/', read, async (c) => {
    const status = c.req.query('status')
    const type = c.req.query('type')
    const caregiverId = c.req.query('caregiverId')
    const rows = await d.db.select({
      ...safeColumns,
      caregiverFirst: user.firstName,
      caregiverLast: user.lastName,
      documentCount: checkDocumentCount,
    })
      .from(backgroundChecks)
      .innerJoin(user, eq(backgroundChecks.caregiverId, user.id))
      .where(and(
        eq(backgroundChecks.companyId, companyOf(c)),
        status ? eq(backgroundChecks.status, status) : undefined,
        type ? eq(backgroundChecks.checkType, type) : undefined,
        caregiverId ? eq(backgroundChecks.caregiverId, caregiverId) : undefined,
      ))
      .orderBy(desc(backgroundChecks.createdAt))
    return all(c, rows)
  })

  // GET /api/background-checks/reports/expiring?days=30 — cleared checks expiring within N days
  app.get('/reports/expiring', read, async (c) => {
    const days = Number(c.req.query('days') ?? 30)
    if (!Number.isInteger(days) || days < 0 || days > 3650) return fail(c, 400, 'days must be a whole number of days')
    const rows = await d.db.select({
      ...safeColumns,
      firstName: user.firstName, lastName: user.lastName, phone: user.phone, email: user.email,
    })
      .from(backgroundChecks)
      .innerJoin(user, eq(backgroundChecks.caregiverId, user.id))
      .where(and(
        eq(backgroundChecks.companyId, companyOf(c)),
        expiresWithin(backgroundChecks.expirationDate, days, await core.time.today(companyOf(c))),
        eq(backgroundChecks.status, 'completed'),
        eq(backgroundChecks.result, 'clear'),
      ))
      .orderBy(asc(backgroundChecks.expirationDate))
    return all(c, rows)
  })

  // The template's earlier path for the same list, kept for any screen still calling it.
  app.get('/overview/expiring', read, async (c) => {
    const rows = await d.db.select({ ...safeColumns, caregiverFirstName: user.firstName, caregiverLastName: user.lastName })
      .from(backgroundChecks)
      .leftJoin(user, eq(backgroundChecks.caregiverId, user.id))
      .where(and(eq(backgroundChecks.companyId, companyOf(c)), expiresWithin30(backgroundChecks.expirationDate, await core.time.today(companyOf(c)))))
    return all(c, rows)
  })

  // GET /api/background-checks/reports/compliance — per active caregiver: passed / failed / pending types
  app.get('/reports/compliance', read, async (c) => all(c, await backgroundCheckCompliance(d.db, companyOf(c))))

  // GET /api/background-checks/caregiver/:id
  app.get('/caregiver/:id', read, async (c) => {
    const rows = await d.db.select(safeColumns).from(backgroundChecks)
      .where(and(eq(backgroundChecks.companyId, companyOf(c)), eq(backgroundChecks.caregiverId, c.req.param('id'))))
      .orderBy(desc(backgroundChecks.createdAt))
    return all(c, rows)
  })

  // GET /api/background-checks/caregiver/:id/eligibility — the engine's reading of the latest WORCS check. Not
  // persisted: the admin makes the hiring decision.
  app.get('/caregiver/:id/eligibility', read, async (c) =>
    one(c, await core.eligibility.runEligibilityForCaregiver(companyOf(c), c.req.param('id'))))

  // POST /api/background-checks/poll-now — "Poll WORCS Now", without waiting for the 30-minute cycle (this company's).
  app.post('/poll-now', requirePermission('care-hr:update'), async (c) => {
    const summary = await core.worcsPoll.runPollCycle(companyOf(c))
    return one(c, { success: true, ...summary })
  })

  // POST /api/background-checks
  app.post('/', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const b = await body(c)
    if (!b.caregiverId) return fail(c, 400, 'Caregiver is required')
    if (!b.checkType || typeof b.checkType !== 'string') return fail(c, 400, 'Check type is required')
    let cost: string | null = null
    if (blankToNull(b.cost) !== null) {
      const n = Number(b.cost)
      if (!Number.isFinite(n) || n < 0) return fail(c, 400, 'Cost must be a number of zero or more')
      cost = n.toFixed(2)
    }
    const status = blankToNull(b.status) ?? 'pending'
    if (!CHECK_STATUSES.includes(String(status))) return fail(c, 400, 'Unknown status')
    for (const k of ['initiatedDate', 'expirationDate', 'completedDate']) {
      if (blankToNull(b[k]) !== null && !isDate(b[k])) return fail(c, 400, 'One of the dates is not a valid date.')
    }
    const caregiverId = await personInCompany(d, companyId, String(b.caregiverId))
    if (!caregiverId) return fail(c, 404, 'Caregiver not found')
    const [row] = await d.db.insert(backgroundChecks).values({
      companyId,
      caregiverId,
      checkType: b.checkType,
      provider: blankToNull(b.provider) as string | null,
      cost,
      status: String(status),
      initiatedDate: (blankToNull(b.initiatedDate) as string | null) ?? undefined,
      expirationDate: blankToNull(b.expirationDate) as string | null,
      completedDate: blankToNull(b.completedDate) as string | null,
      referenceNumber: blankToNull(b.referenceNumber) as string | null,
      notes: blankToNull(b.notes) as string | null,
      createdById: me(c)?.userId || null,
    }).returning(safeColumns)
    return one(c, row, 201)
  })

  // PUT /api/background-checks/:id — a blank/absent field keeps its value
  app.put('/:id', requirePermission('care-hr:update'), async (c) => {
    const b = await body(c)
    const set: Record<string, unknown> = {}
    if (blankToNull(b.status) !== null) {
      if (!CHECK_STATUSES.includes(String(b.status))) return fail(c, 400, 'Unknown status')
      set.status = String(b.status)
    }
    if (blankToNull(b.result) !== null) set.result = String(b.result)
    for (const k of ['completedDate', 'expirationDate'] as const) {
      if (blankToNull(b[k]) !== null) {
        if (!isDate(b[k])) return fail(c, 400, 'One of the dates is not a valid date.')
        set[k] = String(b[k]).slice(0, 10)
      }
    }
    for (const k of ['referenceNumber', 'findings', 'notes']) {
      if (blankToNull(b[k]) !== null) set[k] = String(b[k])
    }
    const [row] = await d.db.update(backgroundChecks).set({ ...set, updatedAt: new Date() })
      .where(ours(companyOf(c), c.req.param('id'))).returning(safeColumns)
    if (!row) return fail(c, 404, 'Background check not found')
    return one(c, row)
  })

  // DELETE /api/background-checks/:id
  app.delete('/:id', requirePermission('care-hr:delete'), async (c) => {
    const [row] = await d.db.delete(backgroundChecks).where(ours(companyOf(c), c.req.param('id'))).returning({ id: backgroundChecks.id })
    if (!row) return fail(c, 404, 'Background check not found')
    return done(c)
  })

  // ── Documents: the result letters ──────────────────────────────────────────────
  const docOf = (companyId: string, checkId: string, docId: string) => and(
    eq(backgroundCheckDocuments.id, docId),
    eq(backgroundCheckDocuments.backgroundCheckId, checkId),
    eq(backgroundCheckDocuments.companyId, companyId),
  )

  app.get('/:id/documents', read, async (c) => {
    const rows = await d.db.select({
      id: backgroundCheckDocuments.id,
      fileName: backgroundCheckDocuments.fileName,
      mimeType: backgroundCheckDocuments.mimeType,
      fileSize: backgroundCheckDocuments.fileSize,
      createdAt: backgroundCheckDocuments.createdAt,
      uploadedByFirst: user.firstName,
      uploadedByLast: user.lastName,
    })
      .from(backgroundCheckDocuments)
      .leftJoin(user, eq(user.id, backgroundCheckDocuments.uploadedById))
      .where(and(eq(backgroundCheckDocuments.companyId, companyOf(c)), eq(backgroundCheckDocuments.backgroundCheckId, c.req.param('id'))))
      .orderBy(asc(backgroundCheckDocuments.createdAt))
    return all(c, rows)
  })

  app.get('/:id/documents/:docId', read, async (c) => {
    const [doc] = await d.db.select().from(backgroundCheckDocuments).where(docOf(companyOf(c), c.req.param('id'), c.req.param('docId')))
    if (!doc) return fail(c, 404, 'Document not found')
    const parsed = parseDataUri(doc.fileData)
    if (!parsed) return fail(c, 500, 'Stored file is unreadable')
    return c.body(Buffer.from(parsed.base64, 'base64'), 200, {
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${safeFileName(doc.fileName)}"`,
    })
  })

  app.post('/:id/documents', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const { fileName, dataUri } = await body(c)
    if (!fileName || !String(fileName).trim()) return fail(c, 400, 'File name is required')
    const parsed = parseDataUri(dataUri)
    if (!parsed) return fail(c, 400, 'The file could not be read')
    if (!DOCUMENT_ALLOWED_MIME.includes(parsed.mime)) return fail(c, 400, 'Only PDF and image files can be uploaded')
    if (String(dataUri).length > DOCUMENT_MAX_DATA_URI_LENGTH) return fail(c, 400, 'File is too large (7 MB max)')
    const checkId = await checkOf(companyId, c.req.param('id'))
    if (!checkId) return fail(c, 404, 'Background check not found')
    const [doc] = await d.db.insert(backgroundCheckDocuments).values({
      companyId,
      backgroundCheckId: checkId,
      fileName: safeFileName(fileName),
      mimeType: parsed.mime,
      fileSize: Math.floor(parsed.base64.length * 3 / 4),
      fileData: String(dataUri),
      uploadedById: me(c)?.userId || null,
    }).returning({
      id: backgroundCheckDocuments.id, backgroundCheckId: backgroundCheckDocuments.backgroundCheckId,
      fileName: backgroundCheckDocuments.fileName, mimeType: backgroundCheckDocuments.mimeType,
      fileSize: backgroundCheckDocuments.fileSize, createdAt: backgroundCheckDocuments.createdAt,
    })
    await d.audit.log({ action: 'create', entity: 'background_check_documents', entityId: doc.id, entityName: doc.fileName, changes: { backgroundCheckId: checkId }, req: c })
    return one(c, doc, 201)
  })

  app.delete('/:id/documents/:docId', requirePermission('care-hr:delete'), async (c) => {
    const [doc] = await d.db.delete(backgroundCheckDocuments).where(docOf(companyOf(c), c.req.param('id'), c.req.param('docId')))
      .returning({ id: backgroundCheckDocuments.id, fileName: backgroundCheckDocuments.fileName })
    if (!doc) return fail(c, 404, 'Document not found')
    await d.audit.log({ action: 'delete', entity: 'background_check_documents', entityId: doc.id, entityName: doc.fileName, req: c })
    return done(c, 'Document deleted')
  })

  return app
}
