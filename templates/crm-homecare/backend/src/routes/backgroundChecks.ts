// Background checks (ported from CVHC routes/backgroundChecksRoutes.js).
//
// A background check is a caregiver's criminal-history record, so this whole router is the office's:
// authenticate + requireAdmin on every route, reads included (the template's own
// /api/caregivers/:id/background-checks was already admin-only). The encrypted SSN / licence
// columns never leave the server.
//
// Wisconsin agencies also get the automated half: WORCS checks submitted from the onboarding
// packet, the 30-minute poll (jobs/worcsPoll.ts, also triggerable here) and the eligibility engine
// against the Wisconsin statutory bar list.
import { Hono } from 'hono'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { backgroundChecks, backgroundCheckDocuments, users } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { runEligibilityForCaregiver } from '../services/eligibilityEngine.ts'
import { runPollCycle } from '../jobs/worcsPoll.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

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

// GET /api/background-checks?status=&type=&caregiverId=
app.get('/', async (c) => {
  const status = c.req.query('status')
  const type = c.req.query('type')
  const caregiverId = c.req.query('caregiverId')
  const conds = [
    status ? eq(backgroundChecks.status, status) : undefined,
    type ? eq(backgroundChecks.checkType, type) : undefined,
    caregiverId ? eq(backgroundChecks.caregiverId, caregiverId) : undefined,
  ].filter(Boolean) as any[]
  const rows = await db.select({
    ...safeColumns,
    caregiverFirst: users.firstName,
    caregiverLast: users.lastName,
    // Qualified by hand: drizzle drops the table name from a column in a single-table select.
    documentCount: sql<number>`(SELECT COUNT(*)::int FROM background_check_documents d WHERE d.background_check_id = "background_checks"."id")`,
  })
    .from(backgroundChecks)
    .innerJoin(users, eq(backgroundChecks.caregiverId, users.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(backgroundChecks.createdAt))
  return c.json(rows)
})

// GET /api/background-checks/reports/expiring?days=30 — cleared checks expiring within N days
app.get('/reports/expiring', async (c) => {
  const days = Number(c.req.query('days') ?? 30)
  if (!Number.isInteger(days) || days < 0 || days > 3650) return c.json({ error: 'days must be a whole number of days' }, 400)
  const rows = await db.select({
    ...safeColumns,
    firstName: users.firstName, lastName: users.lastName, phone: users.phone, email: users.email,
  })
    .from(backgroundChecks)
    .innerJoin(users, eq(backgroundChecks.caregiverId, users.id))
    .where(and(
      sql`${backgroundChecks.expirationDate} IS NOT NULL`,
      sql`${backgroundChecks.expirationDate} <= CURRENT_DATE + ${days}::integer`,
      eq(backgroundChecks.status, 'completed'),
      eq(backgroundChecks.result, 'clear'),
    ))
    .orderBy(backgroundChecks.expirationDate)
  return c.json(rows)
})
// The template's earlier path for the same list, kept for any screen still calling it.
app.get('/overview/expiring', async (c) => {
  const rows = await db.select({ ...safeColumns, caregiverFirstName: users.firstName, caregiverLastName: users.lastName })
    .from(backgroundChecks)
    .leftJoin(users, eq(backgroundChecks.caregiverId, users.id))
    .where(sql`${backgroundChecks.expirationDate} <= CURRENT_DATE + 30`)
  return c.json(rows)
})

// GET /api/background-checks/reports/compliance — per active caregiver: passed / failed / pending types
app.get('/reports/compliance', async (c) => {
  const rows = await db.execute(sql`
    SELECT u.id, u.first_name, u.last_name,
      COALESCE(ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.status = 'completed' AND bc.result = 'clear' AND (bc.expiration_date IS NULL OR bc.expiration_date > CURRENT_DATE)), '{}') AS passed_checks,
      COALESCE(ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.result = 'disqualifying'), '{}') AS failed_checks,
      COALESCE(ARRAY_AGG(DISTINCT bc.check_type) FILTER (WHERE bc.status = 'pending' OR bc.status = 'in_progress'), '{}') AS pending_checks
    FROM users u
    LEFT JOIN background_checks bc ON bc.caregiver_id = u.id
    WHERE u.role = 'caregiver' AND u.is_active = true
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY u.last_name
  `)
  return c.json((rows as any).rows ?? rows)
})

// GET /api/background-checks/caregiver/:id
app.get('/caregiver/:id', async (c) => {
  const rows = await db.select(safeColumns).from(backgroundChecks)
    .where(eq(backgroundChecks.caregiverId, c.req.param('id')))
    .orderBy(desc(backgroundChecks.createdAt))
  return c.json(rows)
})

// GET /api/background-checks/caregiver/:id/eligibility — the engine's reading of the latest WORCS
// check. Not persisted: the admin makes the hiring decision.
app.get('/caregiver/:id/eligibility', async (c) => {
  return c.json(await runEligibilityForCaregiver(c.req.param('id')))
})

// POST /api/background-checks/poll-now — "Poll WORCS Now", without waiting for the 30-minute cycle
app.post('/poll-now', async (c) => {
  const summary = await runPollCycle()
  return c.json({ success: true, ...summary })
})

// POST /api/background-checks
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  if (!body.caregiverId) return c.json({ error: 'Caregiver is required' }, 400)
  if (!body.checkType || typeof body.checkType !== 'string') return c.json({ error: 'Check type is required' }, 400)
  let cost: string | null = null
  if (blankToNull(body.cost) !== null) {
    const n = Number(body.cost)
    if (!Number.isFinite(n) || n < 0) return c.json({ error: 'Cost must be a number of zero or more' }, 400)
    cost = n.toFixed(2)
  }
  const status = blankToNull(body.status) ?? 'pending'
  if (!CHECK_STATUSES.includes(String(status))) return c.json({ error: 'Unknown status' }, 400)
  for (const k of ['initiatedDate', 'expirationDate', 'completedDate']) {
    if (blankToNull(body[k]) !== null && !isDate(body[k])) return c.json({ error: 'One of the dates is not a valid date.' }, 400)
  }
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, String(body.caregiverId)))
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)
  const user = c.get('user') as any
  const [row] = await db.insert(backgroundChecks).values({
    caregiverId: cg.id,
    checkType: body.checkType,
    provider: blankToNull(body.provider) as string | null,
    cost,
    status: String(status),
    initiatedDate: (blankToNull(body.initiatedDate) as string | null) ?? undefined,
    expirationDate: blankToNull(body.expirationDate) as string | null,
    completedDate: blankToNull(body.completedDate) as string | null,
    referenceNumber: blankToNull(body.referenceNumber) as string | null,
    notes: blankToNull(body.notes) as string | null,
    createdById: user?.userId || null,
  }).returning(safeColumns)
  return c.json(row, 201)
})

// PUT /api/background-checks/:id — a blank/absent field keeps its value (CVHC's COALESCE update)
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as any
  const set: Record<string, unknown> = {}
  if (blankToNull(body.status) !== null) {
    if (!CHECK_STATUSES.includes(String(body.status))) return c.json({ error: 'Unknown status' }, 400)
    set.status = String(body.status)
  }
  if (blankToNull(body.result) !== null) set.result = String(body.result)
  for (const [k, col] of [['completedDate', 'completedDate'], ['expirationDate', 'expirationDate']] as const) {
    if (blankToNull(body[k]) !== null) {
      if (!isDate(body[k])) return c.json({ error: 'One of the dates is not a valid date.' }, 400)
      set[col] = String(body[k]).slice(0, 10)
    }
  }
  for (const k of ['referenceNumber', 'findings', 'notes']) {
    if (blankToNull(body[k]) !== null) set[k] = String(body[k])
  }
  const [row] = await db.update(backgroundChecks).set({ ...set, updatedAt: new Date() })
    .where(eq(backgroundChecks.id, id)).returning(safeColumns)
  if (!row) return c.json({ error: 'Background check not found' }, 404)
  return c.json(row)
})

// DELETE /api/background-checks/:id
app.delete('/:id', async (c) => {
  const [row] = await db.delete(backgroundChecks).where(eq(backgroundChecks.id, c.req.param('id'))).returning({ id: backgroundChecks.id })
  if (!row) return c.json({ error: 'Background check not found' }, 404)
  return c.json({ success: true })
})

// ── Documents: the result letters ──────────────────────────────────────────────
const parseDataUri = (uri: unknown) => {
  const m = /^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(uri || ''))
  return m ? { mime: m[1].toLowerCase(), base64: m[2] } : null
}
const safeFileName = (name: unknown) => String(name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200) || 'file'

app.get('/:id/documents', async (c) => {
  const rows = await db.select({
    id: backgroundCheckDocuments.id,
    fileName: backgroundCheckDocuments.fileName,
    mimeType: backgroundCheckDocuments.mimeType,
    fileSize: backgroundCheckDocuments.fileSize,
    createdAt: backgroundCheckDocuments.createdAt,
    uploadedByFirst: users.firstName,
    uploadedByLast: users.lastName,
  })
    .from(backgroundCheckDocuments)
    .leftJoin(users, eq(users.id, backgroundCheckDocuments.uploadedById))
    .where(eq(backgroundCheckDocuments.backgroundCheckId, c.req.param('id')))
    .orderBy(backgroundCheckDocuments.createdAt)
  return c.json(rows)
})

app.get('/:id/documents/:docId', async (c) => {
  const [doc] = await db.select().from(backgroundCheckDocuments).where(and(
    eq(backgroundCheckDocuments.id, c.req.param('docId')),
    eq(backgroundCheckDocuments.backgroundCheckId, c.req.param('id')),
  ))
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const parsed = parseDataUri(doc.fileData)
  if (!parsed) return c.json({ error: 'Stored file is unreadable' }, 500)
  return c.body(Buffer.from(parsed.base64, 'base64'), 200, {
    'Content-Type': doc.mimeType,
    'Content-Disposition': `inline; filename="${safeFileName(doc.fileName)}"`,
  })
})

app.post('/:id/documents', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const { fileName, dataUri } = body || {}
  if (!fileName || !String(fileName).trim()) return c.json({ error: 'File name is required' }, 400)
  const parsed = parseDataUri(dataUri)
  if (!parsed) return c.json({ error: 'The file could not be read' }, 400)
  if (!DOCUMENT_ALLOWED_MIME.includes(parsed.mime)) return c.json({ error: 'Only PDF and image files can be uploaded' }, 400)
  if (String(dataUri).length > DOCUMENT_MAX_DATA_URI_LENGTH) return c.json({ error: 'File is too large (7 MB max)' }, 400)
  const checkId = c.req.param('id')
  const [check] = await db.select({ id: backgroundChecks.id }).from(backgroundChecks).where(eq(backgroundChecks.id, checkId))
  if (!check) return c.json({ error: 'Background check not found' }, 404)
  const user = c.get('user') as any
  const [doc] = await db.insert(backgroundCheckDocuments).values({
    backgroundCheckId: checkId,
    fileName: safeFileName(fileName),
    mimeType: parsed.mime,
    fileSize: Math.floor(parsed.base64.length * 3 / 4),
    fileData: String(dataUri),
    uploadedById: user?.userId || null,
  }).returning({
    id: backgroundCheckDocuments.id, backgroundCheckId: backgroundCheckDocuments.backgroundCheckId,
    fileName: backgroundCheckDocuments.fileName, mimeType: backgroundCheckDocuments.mimeType,
    fileSize: backgroundCheckDocuments.fileSize, createdAt: backgroundCheckDocuments.createdAt,
  })
  await audit.log({ action: 'create', entity: 'background_check_documents', entityId: doc.id, entityName: doc.fileName, changes: { backgroundCheckId: checkId }, req: { user } })
  return c.json(doc, 201)
})

app.delete('/:id/documents/:docId', async (c) => {
  const [doc] = await db.delete(backgroundCheckDocuments).where(and(
    eq(backgroundCheckDocuments.id, c.req.param('docId')),
    eq(backgroundCheckDocuments.backgroundCheckId, c.req.param('id')),
  )).returning({ id: backgroundCheckDocuments.id, fileName: backgroundCheckDocuments.fileName })
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const user = c.get('user') as any
  await audit.log({ action: 'delete', entity: 'background_check_documents', entityId: doc.id, entityName: doc.fileName, req: { user } })
  return c.json({ message: 'Document deleted' })
})

export default app
