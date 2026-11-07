// Documents to e-sign in the client portal (contractor parity row 10c; docs/parity/contractor-portal.md item 7; Buildertrend's
// digital signatures; client_portal_plus, not ready).
//
// OFFICE  (inside /api/client-portal)
//   GET  /:projectId/sign-requests                 what was sent, its state, and the signing evidence           projects:read
//   POST /:projectId/sign-requests                 { documentId, title, message? } — a PDF on the project       projects:update
//   POST /sign-requests/:id/cancel                 while it is not signed                                       projects:update
// CLIENT (through the portal's projectExtras): the requests on their project page; the PDF to read; signing.
//
// SIGNING keeps the evidence quotes keep (ESIGN/UETA): the drawn signature, the name typed, that they agreed to sign
// electronically, when, from which address and browser — and a SHA-256 of exactly the bytes they were shown, read again at the
// moment of signing. The signed copy is the original PDF with a signature page added (pdf-lib), filed on the project as its own
// document and shown to the client. The original is never changed. An audit row records the signing as well.
import { createHash } from 'node:crypto'
import type { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { auditLog, document, project, projectSignRequest } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

const CONSENT = 'I agree that my electronic signature is the legal equivalent of my handwritten signature.'
const MAX_SIGNATURE = 400_000
const sendBody = z.object({ documentId: z.string().min(1, 'Pick the document'), title: z.string().trim().min(1, 'Give it a title').max(200), message: z.string().trim().max(2000).optional() })
const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null)
const bytesOf = async (body: any): Promise<Uint8Array> => {
  if (!body) return new Uint8Array()
  if (body instanceof Uint8Array) return body
  if (typeof body.arrayBuffer === 'function') return new Uint8Array(await body.arrayBuffer())
  if (typeof body.getReader === 'function') return new Uint8Array(await new Response(body).arrayBuffer())
  return new Uint8Array(body)
}

export function createSignRequests(d: CrmDeps, tellClient: (companyId: string, projectId: string, what: any, words: string, force?: boolean) => Promise<string>) {
  const { db } = d
  const storage = d.services.storage as any

  const pdfOf = async (companyId: string, documentId: string) => {
    const [x] = await db.select().from(document).where(and(eq(document.id, documentId), eq(document.companyId, companyId))).limit(1) as any[]
    if (!x || !x.path || String(x.path).includes('..') || !String(x.path).startsWith(`${companyId}/`)) return null
    const obj = await storage.getObject(String(x.path)).catch(() => null)
    if (!obj) return null
    return { doc: x, bytes: await bytesOf(obj.body) }
  }
  const forClient = (r: any) => ({ id: r.id, title: r.title, message: r.message || null, status: r.status, signedAt: iso(r.signedAt), signedName: r.signedName || null, signed: !!r.signedDocumentId })

  /** The requests on a project the client sees: not the cancelled ones. */
  async function listFor(companyId: string, projectId: string) {
    const rows = await db.select().from(projectSignRequest).where(and(eq(projectSignRequest.companyId, companyId), eq(projectSignRequest.projectId, projectId))).orderBy(desc(projectSignRequest.createdAt)) as any[]
    return rows.filter((r) => r.status !== 'cancelled').map(forClient)
  }

  /** The file the client opens: the PDF to sign while it is out, the signed copy once signed. */
  async function file(companyId: string, projectId: string, id: string) {
    const [r] = await db.select().from(projectSignRequest).where(and(eq(projectSignRequest.id, id), eq(projectSignRequest.projectId, projectId), eq(projectSignRequest.companyId, companyId))).limit(1) as any[]
    if (!r || r.status === 'cancelled') return null
    const got = await pdfOf(companyId, r.status === 'signed' && r.signedDocumentId ? r.signedDocumentId : r.documentId)
    if (!got) return null
    return { body: got.bytes, contentType: 'application/pdf', filename: `${r.title}${r.status === 'signed' ? ' (signed)' : ''}.pdf`, inline: true }
  }

  /** The client signs. Answers the request as the client sees it, a refusal in words, or null (not theirs / not there). */
  async function sign(cont: any, projectId: string, id: string, input: { signature?: unknown; signedBy?: unknown; consent?: unknown; ip: string | null; userAgent: string | null }) {
    const [r] = await db.select().from(projectSignRequest).where(and(eq(projectSignRequest.id, id), eq(projectSignRequest.projectId, projectId), eq(projectSignRequest.companyId, cont.companyId))).limit(1) as any[]
    if (!r || r.status === 'cancelled') return null
    if (r.status === 'signed') return { error: `This was signed on ${new Date(r.signedAt).toDateString()}.` }
    const signature = input.signature
    const name = typeof input.signedBy === 'string' ? input.signedBy.trim().slice(0, 120) : ''
    if (typeof signature !== 'string' || !/^data:image\/png;base64,/.test(signature)) return { error: 'A signature is required.' }
    if (signature.length > MAX_SIGNATURE) return { error: 'Signature image is too large.' }
    if (!name) return { error: 'Please type your full name to sign.' }
    if (input.consent !== true) return { error: 'You must agree to sign electronically before signing.' }
    const got = await pdfOf(cont.companyId, r.documentId)
    if (!got) return { error: 'The document is no longer there. Ask the office to send it again.' }
    const hash = createHash('sha256').update(got.bytes).digest('hex')
    const signedAt = new Date()

    // The signed copy: the original, untouched, with a signature page after it.
    let signedBytes: Uint8Array
    try {
      const pdf = await PDFDocument.load(got.bytes, { ignoreEncryption: true })
      const page = pdf.addPage([612, 792])
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
      const png = await pdf.embedPng(Buffer.from(signature.split(',')[1], 'base64'))
      const w = Math.min(300, png.width), hgt = (png.height * w) / png.width
      let y = 730
      const line = (text: string, f = font, size = 11) => { page.drawText(text.replace(/[^\x20-\x7e]/g, '?'), { x: 56, y, size, font: f, color: rgb(0.1, 0.1, 0.1) }); y -= size + 8 }
      line(`Signature page — ${r.title}`, bold, 14)
      line(`Signed by: ${name}`)
      line(`Signed at: ${signedAt.toISOString()}`)
      if (input.ip) line(`From address: ${input.ip}`)
      line(`Document SHA-256: ${hash.slice(0, 32)}`)
      line(`                  ${hash.slice(32)}`)
      line(`Consent: ${CONSENT}`, font, 9)
      page.drawImage(png, { x: 56, y: y - hgt - 10, width: w, height: hgt })
      signedBytes = await pdf.save()
    } catch {
      return { error: 'That document could not be signed here: it is not a PDF we can read. Ask the office for a PDF.' }
    }
    const stored = await storage.saveFile(new File([Buffer.from(signedBytes)], `${r.title} (signed).pdf`, { type: 'application/pdf' }), cont.companyId, 'documents')
    const [signedDoc] = await db.insert(document).values({
      companyId: cont.companyId, projectId, contactId: cont.id, name: `${r.title} (signed)`, type: 'contract',
      filename: String(stored.path).split('/').pop(), originalName: `${r.title} (signed).pdf`, mimeType: 'application/pdf', path: stored.path,
      url: storage.getFileUrl ? storage.getFileUrl(stored.path, cont.companyId) : stored.path, sharedWithCustomer: true,
    } as any).returning()
    // Only a request still out is signed: two signings at once leave the first.
    const [done] = await db.update(projectSignRequest).set({
      status: 'signed', signedName: name, signatureImage: signature, signedAt, signerIp: input.ip, signerUserAgent: input.userAgent, documentHash: hash, signedDocumentId: signedDoc.id,
    }).where(and(eq(projectSignRequest.id, r.id), eq(projectSignRequest.status, 'sent'))).returning()
    if (!done) { await db.delete(document).where(eq(document.id, signedDoc.id)); return { error: 'This was just signed.' } }
    try {
      await db.insert(auditLog).values({
        companyId: cont.companyId, action: 'sign_request.signed', entity: 'sign_request', entityId: r.id, entityName: r.title,
        ipAddress: input.ip, userAgent: input.userAgent, userName: name, userEmail: cont.email || null,
        metadata: { signedAt: signedAt.toISOString(), documentHash: hash, consent: true, consentText: CONSENT, method: 'customer-portal-drawn-signature', projectId, documentId: r.documentId, signedDocumentId: signedDoc.id },
      } as any)
    } catch { /* the signing stands; the request row holds the evidence too */ }
    return forClient(done)
  }

  function routes(app: Hono<AppEnv>) {
    const { requirePermission } = d.permissions
    app.get('/:projectId/sign-requests', requirePermission('projects:read'), async (c) => {
      const me = c.get('user') as any
      const rows = await db.select().from(projectSignRequest).where(and(eq(projectSignRequest.companyId, me.companyId), eq(projectSignRequest.projectId, c.req.param('projectId')))).orderBy(desc(projectSignRequest.createdAt)) as any[]
      // The office reads the evidence; never the drawn image in a list.
      return listAll(c, rows.map(({ signatureImage: _s, ...r }) => r))
    })
    app.post('/:projectId/sign-requests', requirePermission('projects:update'), async (c) => {
      const me = c.get('user') as any
      const projectId = c.req.param('projectId')
      const [p] = await db.select({ id: project.id, contactId: project.contactId }).from(project).where(and(eq(project.id, projectId), eq(project.companyId, me.companyId))).limit(1)
      if (!p) return fail(c, 404, 'Project not found')
      if (!p.contactId) return fail(c, 400, 'The project has no client to sign it.')
      const parsed = sendBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the request')
      const [x] = await db.select().from(document).where(and(eq(document.id, parsed.data.documentId), eq(document.companyId, me.companyId), eq(document.projectId, projectId))).limit(1) as any[]
      if (!x) return fail(c, 400, 'Pick a document on this project')
      if (!/pdf$/i.test(String(x.mimeType || '')) && !/\.pdf$/i.test(String(x.originalName || ''))) return fail(c, 400, 'Only a PDF can be sent to sign.')
      const [row] = await db.insert(projectSignRequest).values({ companyId: me.companyId, projectId, documentId: x.id, title: parsed.data.title, message: parsed.data.message || null, createdById: me.userId ?? null }).returning()
      // A document to sign is always worth an email where the client can be reached (Buildertrend sends one).
      const told = await tellClient(me.companyId, projectId, 'documents', `Please sign: ${parsed.data.title}`, true)
      return one(c, { ...row, told }, 201)
    })
    app.post('/sign-requests/:id/cancel', requirePermission('projects:update'), async (c) => {
      const me = c.get('user') as any
      const [r] = await db.select().from(projectSignRequest).where(and(eq(projectSignRequest.id, c.req.param('id')), eq(projectSignRequest.companyId, me.companyId))).limit(1) as any[]
      if (!r) return fail(c, 404, 'Not found')
      if (r.status === 'signed') return fail(c, 400, 'It is signed; a signed document stays on record.')
      await db.update(projectSignRequest).set({ status: 'cancelled' }).where(eq(projectSignRequest.id, r.id))
      return one(c, { id: r.id, status: 'cancelled' })
    })
  }

  return { listFor, file, sign, routes }
}
