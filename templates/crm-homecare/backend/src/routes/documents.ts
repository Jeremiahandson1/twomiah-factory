// The document store — files kept against a client, a caregiver, or the company — and
// e-signature on them (a caregiver signs an I-9, a policy, an agreement from their phone).
//
//   GET    /api/documents                         office list (?entityType&entityId&category)
//   GET    /api/documents/reports/expiring        expiring in the next ?days (office)
//   GET    /api/documents/unsigned/:userId        what this caregiver still has to sign (them, or the office)
//   POST   /api/documents   (or /upload)          upload, multipart "file" (office)
//   GET    /api/documents/:id/download            the file
//   POST   /api/documents/:id/sign                draw-and-type signature; IP + device recorded
//   GET    /api/documents/:id/signatures          every signature on it
//   DELETE /api/documents/:id                     (office)
//   GET    /api/documents/:entityType/:entityId   one person's documents
//
// The file is kept in the row (base64), not on the server's disk — a Render disk is wiped on every
// deploy. The latest signature is on the row for a quick read; every signature is kept in
// document_signatures (a document can need more than one signer).
//
// A COMPANY document (a policy) is signed by each caregiver separately: it stays in a caregiver's
// "to sign" list until THEY have signed it, not until anyone has.
//
// Client documents the CLIENT signs in their portal are a different thing — see clientDocuments.ts.
import { Hono } from 'hono'
import path from 'path'
import fs from 'fs'
import { sql, eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { documents, documentSignatures, clients, users } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { uploadedForm } from '../utils/upload.ts'
import { isOffice, userIdOf, writeCareAudit, rowsOf } from '../helpers/careAudit.ts'

const app = new Hono()
app.use('*', authenticate)

const ENTITY_TYPES = ['client', 'caregiver', 'company']
export const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.txt']
const MAX_SIGNATURE_CHARS = 2_000_000
const maxFileBytes = () => (parseInt(process.env.MAX_FILE_SIZE_MB || '10') || 10) * 1024 * 1024

const LIST_SELECT = sql`d.id, d.entity_type, d.entity_id, d.document_type, d.document_type AS category,
  d.name, d.name AS document_name, d.description, d.file_name, d.file_type, d.file_size,
  d.requires_signature, d.expiration_date, d.is_confidential, d.uploaded_by_id,
  d.signed_at, d.signed_by_id, d.signature_typed_name, d.created_at, d.created_at AS uploaded_at, d.updated_at,
  u.first_name AS uploaded_by_first, u.last_name AS uploaded_by_last,
  CASE d.entity_type
    WHEN 'caregiver' THEN (SELECT e.first_name FROM users e WHERE e.id = d.entity_id)
    WHEN 'client'    THEN (SELECT cl.first_name FROM clients cl WHERE cl.id = d.entity_id)
  END AS entity_first_name,
  CASE d.entity_type
    WHEN 'caregiver' THEN (SELECT e.last_name FROM users e WHERE e.id = d.entity_id)
    WHEN 'client'    THEN (SELECT cl.last_name FROM clients cl WHERE cl.id = d.entity_id)
  END AS entity_last_name,
  CASE d.entity_type
    WHEN 'caregiver' THEN (SELECT e.first_name || ' ' || e.last_name FROM users e WHERE e.id = d.entity_id)
    WHEN 'client'    THEN (SELECT cl.first_name || ' ' || cl.last_name FROM clients cl WHERE cl.id = d.entity_id)
    ELSE 'Company'
  END AS entity_name`

/** May this user see / sign this document? The office: any. A caregiver: their own, and company ones. */
const mayUse = (user: any, d: { entityType: string; entityId: string | null }) =>
  isOffice(user) || d.entityType === 'company' || (d.entityType === 'caregiver' && d.entityId === userIdOf(user))

app.get('/', requireAdmin, async (c) => {
  const { entityType, entityId, documentType, category } = c.req.query()
  const type = documentType || category
  const rows = rowsOf(await db.execute(sql`
    SELECT ${LIST_SELECT} FROM documents d LEFT JOIN users u ON d.uploaded_by_id = u.id
     WHERE true
       ${entityType ? sql`AND d.entity_type = ${entityType}` : sql``}
       ${entityId ? sql`AND d.entity_id = ${entityId}` : sql``}
       ${type ? sql`AND d.document_type = ${type}` : sql``}
     ORDER BY d.created_at DESC`))
  return c.json(rows)
})

app.get('/reports/expiring', requireAdmin, async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30') || 30, 0), 3650)
  const rows = rowsOf(await db.execute(sql`
    SELECT ${LIST_SELECT} FROM documents d LEFT JOIN users u ON d.uploaded_by_id = u.id
     WHERE d.expiration_date IS NOT NULL
       AND d.expiration_date <= CURRENT_DATE + ${days}::int
       AND d.expiration_date >= CURRENT_DATE
     ORDER BY d.expiration_date ASC`))
  return c.json(rows)
})

app.get('/unsigned/:userId', async (c) => {
  const user = c.get('user' as any)
  const who = c.req.param('userId')
  if (!isOffice(user) && userIdOf(user) !== who) return c.json({ error: 'Not allowed' }, 403)
  const rows = rowsOf(await db.execute(sql`
    SELECT ${LIST_SELECT} FROM documents d LEFT JOIN users u ON d.uploaded_by_id = u.id
     WHERE d.requires_signature = true
       AND (
         (d.entity_type = 'company'
            AND NOT EXISTS (SELECT 1 FROM document_signatures ds WHERE ds.document_id = d.id AND ds.signed_by_id = ${who}))
         OR (d.entity_type = 'caregiver' AND d.entity_id = ${who} AND d.signed_at IS NULL)
       )
     ORDER BY d.created_at DESC`))
  return c.json(rows)
})

// ── upload ───────────────────────────────────────────────────────────────────
const upload = async (c: any) => {
  const user = c.get('user' as any)
  const form = await uploadedForm(c)
  const file = form.get('file') as File | null
  if (!file || typeof (file as any).arrayBuffer !== 'function') return c.json({ error: 'No file uploaded' }, 400)
  const ext = path.extname(file.name || '').toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext)) return c.json({ error: `That file type is not accepted. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}` }, 400)
  if (file.size > maxFileBytes()) return c.json({ error: 'File too large' }, 400)

  const entityType = String(form.get('entityType') || '')
  const entityId = String(form.get('entityId') || '') || null
  if (!ENTITY_TYPES.includes(entityType)) return c.json({ error: 'entityType must be client, caregiver or company' }, 400)
  if (entityType !== 'company') {
    if (!entityId) return c.json({ error: `Please select a ${entityType}` }, 400)
    const found = entityType === 'client'
      ? (await db.select({ id: clients.id }).from(clients).where(eq(clients.id, entityId)).limit(1))[0]
      : (await db.select({ id: users.id }).from(users).where(eq(users.id, entityId)).limit(1))[0]
    if (!found) return c.json({ error: `${entityType === 'client' ? 'Client' : 'Caregiver'} not found` }, 404)
  }
  const expirationDate = String(form.get('expirationDate') || '') || null
  if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) return c.json({ error: 'expirationDate must be a date (YYYY-MM-DD)' }, 400)
  const truthy = (k: string) => ['true', 'on', '1'].includes(String(form.get(k) || '').toLowerCase())

  const bytes = Buffer.from(await file.arrayBuffer())
  const [row] = await db.insert(documents).values({
    entityType,
    entityId: entityType === 'company' ? null : entityId,
    documentType: String(form.get('documentType') || form.get('category') || 'other'),
    name: String(form.get('name') || form.get('documentName') || file.name),
    description: String(form.get('description') || form.get('notes') || '') || null,
    fileName: file.name,
    fileType: ext.slice(1),
    fileSize: file.size,
    fileData: bytes.toString('base64'),
    requiresSignature: truthy('requiresSignature'),
    expirationDate,
    isConfidential: truthy('isConfidential'),
    uploadedById: userIdOf(user),
  }).returning({ id: documents.id, name: documents.name, entityType: documents.entityType, entityId: documents.entityId, requiresSignature: documents.requiresSignature })
  await writeCareAudit(user, 'CREATE', 'documents', row.id, row)
  return c.json(row, 201)
}
app.post('/', requireAdmin, upload)
app.post('/upload', requireAdmin, upload)

const loadDoc = async (id: string) =>
  (await db.select().from(documents).where(eq(documents.id, id)).limit(1))[0]

app.get('/:id/download', async (c) => {
  const user = c.get('user' as any)
  const d = await loadDoc(c.req.param('id'))
  if (!d) return c.json({ error: 'Document not found' }, 404)
  if (!mayUse(user, d)) return c.json({ error: 'Not allowed' }, 403)
  if (!d.fileData) return c.json({ error: 'This document has no file' }, 404)
  const MIME: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return new Response(Buffer.from(d.fileData, 'base64'), {
    headers: {
      'Content-Type': MIME[d.fileType || ''] || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${String(d.fileName || 'document').replace(/[^A-Za-z0-9._ -]/g, '_')}"`,
    },
  })
})

// ── e-signature ──────────────────────────────────────────────────────────────
// Body: { signatureImageBase64 (data:image/… URI), typedName, signerRole? }
app.post('/:id/sign', async (c) => {
  const user = c.get('user' as any)
  const b = await c.req.json().catch(() => ({}))
  const image = b?.signatureImageBase64
  if (!image || typeof image !== 'string' || !image.startsWith('data:image')) {
    return c.json({ error: 'signatureImageBase64 (data URI) is required' }, 400)
  }
  if (image.length > MAX_SIGNATURE_CHARS) return c.json({ error: 'Signature image too large (max ~1.5MB)' }, 400)
  const d = await loadDoc(c.req.param('id'))
  if (!d) return c.json({ error: 'Document not found' }, 404)
  if (!mayUse(user, d) || (d.entityType === 'client' && !isOffice(user))) return c.json({ error: 'Not allowed to sign this document' }, 403)

  const ip = (c.req.header('x-forwarded-for')?.split(',')[0] || c.req.header('cf-connecting-ip') || '').trim().slice(0, 45) || null
  const ua = (c.req.header('user-agent') || '').slice(0, 300) || null
  const typedName = b.typedName ? String(b.typedName).trim().slice(0, 200) : null
  const signedById = userIdOf(user)
  const now = new Date()
  const [updated] = await db.transaction(async (tx) => {
    const res = await tx.update(documents).set({
      signedAt: now, signedById, signatureImage: image, signatureIp: ip, signatureUserAgent: ua,
      signatureTypedName: typedName, updatedAt: now,
    }).where(eq(documents.id, d.id)).returning({ id: documents.id, signedAt: documents.signedAt, signedById: documents.signedById, signatureTypedName: documents.signatureTypedName })
    await tx.insert(documentSignatures).values({
      documentId: d.id, signedById, signerRole: b.signerRole ? String(b.signerRole).slice(0, 40) : (isOffice(user) ? 'office' : 'caregiver'),
      signerTypedName: typedName, signatureImage: image, signedAt: now, ipAddress: ip, userAgent: ua,
    })
    return res
  })
  await writeCareAudit(user, 'SIGN', 'documents', d.id, { signedById, typedName, ip })
  return c.json({ success: true, document: updated })
})

app.get('/:id/signatures', async (c) => {
  const user = c.get('user' as any)
  const d = await loadDoc(c.req.param('id'))
  if (!d) return c.json({ error: 'Document not found' }, 404)
  if (!mayUse(user, d)) return c.json({ error: 'Not allowed' }, 403)
  const rows = rowsOf(await db.execute(sql`
    SELECT ds.id, ds.signer_role, ds.signer_typed_name, ds.signed_at, ds.ip_address, ds.signed_by_id,
           u.first_name, u.last_name, u.email
      FROM document_signatures ds LEFT JOIN users u ON ds.signed_by_id = u.id
     WHERE ds.document_id = ${d.id}
       ${isOffice(user) ? sql`` : sql`AND ds.signed_by_id = ${userIdOf(user)}`}
     ORDER BY ds.signed_at DESC`))
  return c.json(rows)
})

app.delete('/:id', requireAdmin, async (c) => {
  const [row] = await db.delete(documents).where(eq(documents.id, c.req.param('id'))).returning({ id: documents.id, name: documents.name })
  if (!row) return c.json({ error: 'Document not found' }, 404)
  await writeCareAudit(c.get('user' as any), 'DELETE', 'documents', row.id, null, row)
  return c.json({ success: true })
})

// ── one person's documents ───────────────────────────────────────────────────
// The office reads anyone's; a caregiver reads their own and the company's. A client's documents
// are not shown to caregivers here (the client portal has its own door).
app.get('/:entityType/:entityId', async (c) => {
  const user = c.get('user' as any)
  const { entityType, entityId } = c.req.param()
  if (!ENTITY_TYPES.includes(entityType)) return c.json({ error: 'Not found' }, 404)
  if (!isOffice(user)) {
    if (entityType === 'caregiver' && entityId !== userIdOf(user)) return c.json({ error: 'Not allowed' }, 403)
    if (entityType === 'client') return c.json({ error: 'Not allowed' }, 403)
  }
  const { documentType } = c.req.query()
  const rows = rowsOf(await db.execute(sql`
    SELECT ${LIST_SELECT} FROM documents d LEFT JOIN users u ON d.uploaded_by_id = u.id
     WHERE d.entity_type = ${entityType}
       ${entityType === 'company' ? sql`` : sql`AND d.entity_id = ${entityId}`}
       ${documentType ? sql`AND d.document_type = ${documentType}` : sql``}
     ORDER BY d.created_at DESC`))
  return c.json(rows)
})

// Legacy: POST /:entityType/:entityId/upload wrote a file to the server's disk and returned its
// path, with no record. Kept for anything still calling it; new uploads go to POST /.
const uploadsDir = process.env.UPLOAD_DIR || './uploads'
app.post('/:entityType/:entityId/upload', requireAdmin, async (c) => {
  const entityType = c.req.param('entityType')
  const dir = path.join(uploadsDir, entityType.replace(/[^a-z0-9_-]/gi, '') || 'misc')
  const formData = await uploadedForm(c)
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file uploaded' }, 400)
  if (file.size > maxFileBytes()) return c.json({ error: 'File too large' }, 400)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const safe = file.name.replace(/[^a-z0-9.\-_]/gi, '_')
  const filename = `${Date.now()}-${safe}`
  fs.writeFileSync(path.join(dir, filename), Buffer.from(await file.arrayBuffer()))
  return c.json({ filename, originalName: file.name, size: file.size, path: `/uploads/${entityType}/${filename}` })
})

export default app
