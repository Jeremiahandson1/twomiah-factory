// The document store — files kept against a client, a caregiver, or the company — and e-signature on them (a caregiver
// signs an I-9, a policy, an agreement from their phone). Moved from templates/crm-homecare/backend/src/routes/documents.ts.
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
// The file is kept in the row (base64). A COMPANY document (a policy) is signed by each caregiver separately: it stays
// on a caregiver's "to sign" list until THEY have signed it. Client documents the CLIENT signs in their portal are
// /api/client-documents.
//
// Home care's documents are their own records (documents, document_signatures: entity, e-signature queue), not the
// CRM's shared document module (document, document_version); the home-care vertical mounts this one at /api/documents
// in its place (server/modules/crm.ts).
//
// Permissions: the office's list, the expiring report, uploading and deleting were admin-only: care-clients:update /
// create / delete. Reading your own documents, your to-sign list, downloading and signing are care-clients:read, held by
// a caregiver and narrowed as the template narrowed them: their own and the company's, never a client's.
// Replies: lists are { data, pagination } in camelCase (documentName, fileName, uploadedAt, signerTypedName … were
// snake_case).
//
// Not moved: POST /:entityType/:entityId/upload, the legacy upload that wrote the file to the server's disk and kept no
// record (no screen calls it; a disk file is gone on the next deploy).
import { Hono } from 'hono'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { documents, documentSignatures } from '../../../db/schema/index.ts'
import { documentRows, documentSignatureRows } from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { uploadedForm } from '../core/upload.ts'
import { actsForAnyone } from '../core/caregiverAccess.ts'
import { body, who, whole, type ClientAccess } from './shared.ts'

const ENTITY_TYPES = ['client', 'caregiver', 'company']
export const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.txt']
const MAX_SIGNATURE_CHARS = 2_000_000
const maxFileBytes = () => (parseInt(process.env.MAX_FILE_SIZE_MB || '10') || 10) * 1024 * 1024
const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function createDocumentRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  const read = requirePermission('care-clients:read')

  /** May this person see / sign this document? The office: any. Anyone else: their own, and the company's. */
  const mayUse = (user: any, me: string, doc: { entityType: string; entityId: string | null }) =>
    access.office(user) || doc.entityType === 'company' || (doc.entityType === 'caregiver' && doc.entityId === me)

  const loadDoc = async (companyId: string, id: string) =>
    (await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.companyId, companyId))).limit(1))[0]

  app.get('/', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const { entityType, entityId, documentType, category } = c.req.query()
    return whole(c, await documentRows(db, companyId, {
      entityType: entityType || undefined, entityId: entityId || undefined, documentType: documentType || category || undefined,
    }))
  })

  app.get('/reports/expiring', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const days = Math.min(Math.max(parseInt(c.req.query('days') || '30') || 30, 0), 3650)
    return whole(c, await documentRows(db, companyId, { expiringDays: days }))
  })

  app.get('/unsigned/:userId', read, async (c) => {
    const { user, companyId, me } = who(c)
    const whom = c.req.param('userId')
    if (!access.office(user) && me !== whom) return fail(c, 403, 'Not allowed')
    return whole(c, await documentRows(db, companyId, { unsignedFor: whom }))
  })

  // ── upload ──
  const upload = async (c: any) => {
    const { user, companyId, me } = who(c)
    const form = await uploadedForm(c)
    const file = form.get('file') as File | null
    if (!file || typeof (file as any).arrayBuffer !== 'function') return fail(c, 400, 'No file uploaded')
    const ext = path.extname(file.name || '').toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) return fail(c, 400, `That file type is not accepted. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`)
    if (file.size > maxFileBytes()) return fail(c, 400, 'File too large')
    const entityType = String(form.get('entityType') || '')
    const entityId = String(form.get('entityId') || '') || null
    if (!ENTITY_TYPES.includes(entityType)) return fail(c, 400, 'entityType must be client, caregiver or company')
    if (entityType !== 'company') {
      if (!entityId) return fail(c, 400, `Please select a ${entityType}`)
      const found = entityType === 'client' ? await access.clientInCompany(companyId, entityId) : !!(await access.personInCompany(companyId, entityId))
      if (!found) return fail(c, 404, `${entityType === 'client' ? 'Client' : 'Caregiver'} not found`)
    }
    const expirationDate = String(form.get('expirationDate') || '') || null
    if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) return fail(c, 400, 'expirationDate must be a date (YYYY-MM-DD)')
    const truthy = (k: string) => ['true', 'on', '1'].includes(String(form.get(k) || '').toLowerCase())
    const bytes = Buffer.from(await file.arrayBuffer())
    const [row] = await db.insert(documents).values({
      companyId,
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
      // Shown to the client's family in their portal (care_family_content): only a client's own, never a confidential one.
      shareWithFamily: entityType === 'client' && !truthy('isConfidential') && truthy('shareWithFamily'),
      uploadedById: me,
    }).returning({ id: documents.id, name: documents.name, entityType: documents.entityType, entityId: documents.entityId, requiresSignature: documents.requiresSignature })
    await core.careAudit.writeCareAudit(user, 'CREATE', 'documents', row.id, row)
    return one(c, row, 201)
  }
  app.post('/', requirePermission('care-clients:create'), upload)
  app.post('/upload', requirePermission('care-clients:create'), upload)

  // Share a client's document with their family, or stop (care_family_content). Office only.
  app.put('/:id/sharing', requirePermission('care-clients:update'), async (c) => {
    const { user, companyId } = who(c)
    const b = await body(c)
    if (typeof b.shareWithFamily !== 'boolean') return fail(c, 400, 'Say whether to share this document with the family: on or off.', 'bad_share', { shareWithFamily: 'On or off' })
    if (!(await core.familyContent.enabled(companyId))) return fail(c, 404, 'Not found')
    const r = await core.familyContent.setSharing(companyId, c.req.param('id'), b.shareWithFamily)
    if (r === 'missing') return fail(c, 404, 'Document not found')
    if (r === 'not_client') return fail(c, 400, 'Only a client\'s documents can be shared with their family.', 'not_client_document')
    if (r === 'confidential') return fail(c, 400, 'A confidential document cannot be shared with the family. Untick confidential first.', 'confidential_document')
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'documents', c.req.param('id'), { shareWithFamily: b.shareWithFamily })
    return one(c, { id: c.req.param('id'), shareWithFamily: b.shareWithFamily })
  })

  app.get('/:id/download', read, async (c) => {
    const { user, companyId, me } = who(c)
    const doc = await loadDoc(companyId, c.req.param('id'))
    if (!doc) return fail(c, 404, 'Document not found')
    if (!mayUse(user, me, doc)) return fail(c, 403, 'Not allowed')
    if (!doc.fileData) return fail(c, 404, 'This document has no file')
    return new Response(new Uint8Array(Buffer.from(doc.fileData, 'base64')), {
      headers: {
        'Content-Type': MIME[doc.fileType || ''] || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${String(doc.fileName || 'document').replace(/[^A-Za-z0-9._ -]/g, '_')}"`,
      },
    })
  })

  // ── e-signature ── Body: { signatureImageBase64 (data:image/… URI), typedName, signerRole? }
  app.post('/:id/sign', read, async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    const image = b?.signatureImageBase64
    if (!image || typeof image !== 'string' || !image.startsWith('data:image')) return fail(c, 400, 'signatureImageBase64 (data URI) is required')
    if (image.length > MAX_SIGNATURE_CHARS) return fail(c, 400, 'Signature image too large (max ~1.5MB)')
    const doc = await loadDoc(companyId, c.req.param('id'))
    if (!doc) return fail(c, 404, 'Document not found')
    // Signing is a write: anyone may sign the company's documents and their own; another person's or a client's needs
    // care-clients:update (it was "not a caregiver" — a read-only seat could sign any of them, 2026-10-19).
    const mine = doc.entityType === 'company' || (doc.entityType === 'caregiver' && doc.entityId === me)
    if (!mine && !(await actsForAnyone(d, user, 'care-clients:update'))) return fail(c, 403, 'Not allowed to sign this document')
    const ip = (c.req.header('x-forwarded-for')?.split(',')[0] || c.req.header('cf-connecting-ip') || '').trim().slice(0, 45) || null
    const ua = (c.req.header('user-agent') || '').slice(0, 300) || null
    const typedName = b.typedName ? String(b.typedName).trim().slice(0, 200) : null
    const now = new Date()
    const updated = await db.transaction(async (tx: any) => {
      const [res] = await tx.update(documents).set({
        signedAt: now, signedById: me, signatureImage: image, signatureIp: ip, signatureUserAgent: ua, signatureTypedName: typedName, updatedAt: now,
      }).where(and(eq(documents.id, doc.id), eq(documents.companyId, companyId)))
        .returning({ id: documents.id, signedAt: documents.signedAt, signedById: documents.signedById, signatureTypedName: documents.signatureTypedName })
      await tx.insert(documentSignatures).values({
        companyId, documentId: doc.id, signedById: me,
        signerRole: b.signerRole ? String(b.signerRole).slice(0, 40) : (access.office(user) ? 'office' : 'caregiver'),
        signerTypedName: typedName, signatureImage: image, signedAt: now, ipAddress: ip, userAgent: ua,
      })
      return res
    })
    await core.careAudit.writeCareAudit(user, 'SIGN', 'documents', doc.id, { signedById: me, typedName, ip })
    return one(c, { success: true, document: updated })
  })

  app.get('/:id/signatures', read, async (c) => {
    const { user, companyId, me } = who(c)
    const doc = await loadDoc(companyId, c.req.param('id'))
    if (!doc) return fail(c, 404, 'Document not found')
    if (!mayUse(user, me, doc)) return fail(c, 403, 'Not allowed')
    return whole(c, await documentSignatureRows(db, companyId, doc.id, access.office(user) ? null : me))
  })

  app.delete('/:id', requirePermission('care-clients:delete'), async (c) => {
    const { user, companyId } = who(c)
    const [row] = await db.delete(documents).where(and(eq(documents.id, c.req.param('id')), eq(documents.companyId, companyId)))
      .returning({ id: documents.id, name: documents.name })
    if (!row) return fail(c, 404, 'Document not found')
    await core.careAudit.writeCareAudit(user, 'DELETE', 'documents', row.id, null, row)
    return done(c)
  })

  // ── one person's documents ── the office reads anyone's; a caregiver their own and the company's. A client's are not
  // shown to caregivers here (the client portal has its own door).
  app.get('/:entityType/:entityId', read, async (c) => {
    const { user, companyId, me } = who(c)
    const { entityType, entityId } = c.req.param()
    if (!ENTITY_TYPES.includes(entityType)) return fail(c, 404, 'Not found')
    if (!access.office(user)) {
      if (entityType === 'caregiver' && entityId !== me) return fail(c, 403, 'Not allowed')
      if (entityType === 'client') return fail(c, 403, 'Not allowed')
    }
    return whole(c, await documentRows(db, companyId, {
      entityType, entityId: entityType === 'company' ? undefined : entityId, documentType: c.req.query('documentType') || undefined,
    }))
  })

  return app
}
