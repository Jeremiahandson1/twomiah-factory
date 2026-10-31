// The pages of a proposal around its Good / Better / Best options (Roofr's proposal builder; docs/parity/roof-gbb-proposals.md #5,
// #15, #16). One row per quote (quote_proposal_document, migration 0062):
//   · a COVER PAGE (title, subtitle, a photo) and ABOUT US, printed first;
//   · SECTIONS placed in line — a block of the roofer's own words at the top, before the options, after them, or before the terms;
//   · files attached to the whole proposal (and, per option, on the option: a manufacturer's brochure);
//   · the TERMS split into clauses the customer INITIALS before they sign — each initial is a record (quote_proposal_mark);
//   · a COSIGNER (the insurance carrier, a spouse): the customer signs first, the cosigner is sent a private link (/c/<token>),
//     and the quote is approved when the last required signature is in — not before.
// Nothing here runs on a template whose tables have none of this, and every rule is asked of both sides (office and customer).
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import crypto from 'crypto'
import { isPhotoAddress } from './quoteOptions'
import { newDocumentToken } from '../portal/documentLinks'
import { sniffType } from '../files/storage'

export const SECTION_PLACEMENTS = ['top', 'before_options', 'after_options', 'before_terms'] as const
export const MAX_SECTIONS = 12
export const MAX_CLAUSES = 20
export const MAX_ATTACHMENTS = 8
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export const hasDocumentTables = (t: { quoteProposalDocument?: any; quoteProposalMark?: any }): boolean => !!t?.quoteProposalDocument && !!t?.quoteProposalMark

export type Attachment = { name: string; url: string }
export type Section = { id: string; title: string; body: string; placement: (typeof SECTION_PLACEMENTS)[number] }
export type Clause = { id: string; text: string }

/** A file address a customer's page may link: the business's own /media files, or an https address. */
export const isFileAddress = isPhotoAddress

const attachmentSchema = z.object({ name: z.string().trim().min(1, 'Name each attached file.').max(120), url: z.string().refine(isFileAddress, 'An attached file is one of your own uploads or an https address.') })
export const attachmentsSchema = z.array(attachmentSchema).max(MAX_ATTACHMENTS, `At most ${MAX_ATTACHMENTS} files can be attached.`).default([])

export const documentSchema = z.object({
  coverTitle: z.string().trim().max(160).nullable().optional(),
  coverSubtitle: z.string().trim().max(300).nullable().optional(),
  coverPhoto: z.string().nullable().optional().refine((v) => v == null || v === '' || isFileAddress(v), 'The cover photo is one of your own uploads or an https address.'),
  aboutUs: z.string().trim().max(5000).nullable().optional(),
  sections: z.array(z.object({
    title: z.string().trim().min(1, 'Name each section.').max(120),
    body: z.string().trim().min(1, 'Write something in each section.').max(5000),
    placement: z.enum(SECTION_PLACEMENTS).default('before_options'),
  })).max(MAX_SECTIONS, `A proposal has at most ${MAX_SECTIONS} sections.`).default([]),
  termsClauses: z.array(z.object({ text: z.string().trim().min(1, 'Write each term the customer initials.').max(1500) })).max(MAX_CLAUSES, `At most ${MAX_CLAUSES} terms can be initialed.`).default([]),
  attachments: attachmentsSchema,
  cosigner: z.object({
    name: z.string().trim().min(1, 'Name the cosigner.').max(120),
    email: z.string().trim().toLowerCase().email('Enter the cosigner\'s email address.').max(200),
    role: z.string().trim().max(80).nullable().optional(),
  }).nullable().optional(),
})
export type DocumentInput = z.infer<typeof documentSchema>

const cleanOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : [])

export async function loadDocument(db: any, t: { quoteProposalDocument?: any }, quoteId: string): Promise<any | null> {
  if (!t.quoteProposalDocument) return null
  const [row] = await db.select().from(t.quoteProposalDocument).where(eq(t.quoteProposalDocument.quoteId, quoteId)).limit(1)
  return row ?? null
}

/** Save the proposal's pages (replacing the earlier ones). A new cosigner address gets a new private link; the old one stops working. */
export async function saveDocument(db: any, t: { quoteProposalDocument?: any }, companyId: string, quoteId: string, input: DocumentInput) {
  const existing = await loadDocument(db, t, quoteId)
  const sections: Section[] = input.sections.map((s, i) => ({ id: existing && asArray(existing.sections)[i]?.id || crypto.randomUUID().replace(/-/g, '').slice(0, 12), title: s.title, body: s.body, placement: s.placement }))
  const clauses: Clause[] = input.termsClauses.map((c, i) => ({ id: existing && asArray(existing.termsClauses)[i]?.id || crypto.randomUUID().replace(/-/g, '').slice(0, 12), text: c.text }))
  const cos = input.cosigner
  const sameCosigner = !!cos && existing?.cosignerEmail === cos.email && !!existing?.cosignerToken
  const values: Record<string, unknown> = {
    coverTitle: cleanOrNull(input.coverTitle), coverSubtitle: cleanOrNull(input.coverSubtitle), coverPhoto: cleanOrNull(input.coverPhoto), aboutUs: cleanOrNull(input.aboutUs),
    sections, termsClauses: clauses, attachments: input.attachments,
    cosignerName: cos?.name ?? null, cosignerEmail: cos?.email ?? null, cosignerRole: cleanOrNull(cos?.role),
    cosignerToken: cos ? (sameCosigner ? existing.cosignerToken : newDocumentToken()) : null,
    cosignerRequestedAt: cos && sameCosigner ? existing.cosignerRequestedAt : null,
    updatedAt: new Date(),
  }
  if (existing) {
    const [row] = await db.update(t.quoteProposalDocument).set(values).where(and(eq(t.quoteProposalDocument.id, existing.id), eq(t.quoteProposalDocument.companyId, companyId))).returning()
    return row
  }
  const [row] = await db.insert(t.quoteProposalDocument).values({ ...values, companyId, quoteId }).returning()
  return row
}

export type Marks = { initials: Array<{ clauseId: string | null; initials: string | null; signedAt: Date }>; customer: any | null; cosigner: any | null }
export async function loadMarks(db: any, t: { quoteProposalMark?: any }, quoteId: string): Promise<Marks> {
  if (!t.quoteProposalMark) return { initials: [], customer: null, cosigner: null }
  const rows: any[] = await db.select().from(t.quoteProposalMark).where(eq(t.quoteProposalMark.quoteId, quoteId)).orderBy(asc(t.quoteProposalMark.signedAt), asc(t.quoteProposalMark.id))
  return {
    initials: rows.filter((r) => r.kind === 'initials'),
    customer: rows.filter((r) => r.kind === 'customer_signature').at(-1) ?? null,
    cosigner: rows.filter((r) => r.kind === 'cosigner_signature').at(-1) ?? null,
  }
}

/** Does this proposal ask a cosigner to sign before it is approved? */
export const cosignerRequired = (doc: any): boolean => !!doc?.cosignerToken && !!doc?.cosignerEmail && !!doc?.cosignerName

/** What the office reads: the whole row, the cosigner's address included, and where the cosigner stands. */
export function documentForOffice(doc: any, marks: Marks) {
  if (!doc) return null
  return {
    coverTitle: doc.coverTitle ?? null, coverSubtitle: doc.coverSubtitle ?? null, coverPhoto: doc.coverPhoto ?? null, aboutUs: doc.aboutUs ?? null,
    sections: asArray(doc.sections), termsClauses: asArray(doc.termsClauses), attachments: asArray(doc.attachments),
    cosigner: cosignerRequired(doc) ? { name: doc.cosignerName, email: doc.cosignerEmail, role: doc.cosignerRole ?? null, requestedAt: doc.cosignerRequestedAt ?? null, path: `/c/${doc.cosignerToken}`, status: cosignStatus(doc, marks) } : null,
    initialed: marks.initials.length,
  }
}

/** 'waiting_for_customer' (nobody has signed), 'waiting' (the customer has, the cosigner has not) or 'signed'. */
export const cosignStatus = (doc: any, marks: Marks): 'waiting_for_customer' | 'waiting' | 'signed' | null =>
  !cosignerRequired(doc) ? null : marks.cosigner ? 'signed' : marks.customer ? 'waiting' : 'waiting_for_customer'

/** What the customer's page shows: no address, no link, no token of the cosigner — only who they are and whether they have signed. */
export function documentForCustomer(doc: any, marks: Marks) {
  if (!doc) return null
  const initialed = new Map(marks.initials.map((m) => [m.clauseId, m.initials]))
  return {
    coverTitle: doc.coverTitle ?? null, coverSubtitle: doc.coverSubtitle ?? null, coverPhoto: doc.coverPhoto ?? null, aboutUs: doc.aboutUs ?? null,
    sections: asArray(doc.sections).map((s) => ({ id: s.id, title: s.title, body: s.body, placement: s.placement })),
    termsClauses: asArray(doc.termsClauses).map((c) => ({ id: c.id, text: c.text, initials: initialed.get(c.id) ?? null })),
    attachments: asArray(doc.attachments),
    cosigner: cosignerRequired(doc) ? { name: doc.cosignerName, role: doc.cosignerRole ?? null, status: cosignStatus(doc, marks) } : null,
  }
}

/** The initials the customer typed for each clause: all of them, each one a few letters. Null clauses = nothing to initial. */
export function checkInitials(clauses: Clause[], given: unknown): { ok: true; initials: Map<string, string> } | { ok: false; error: string; fields: Record<string, string> } {
  const out = new Map<string, string>()
  const fields: Record<string, string> = {}
  const raw = given && typeof given === 'object' ? (given as Record<string, unknown>) : {}
  for (const c of clauses) {
    const v = typeof raw[c.id] === 'string' ? (raw[c.id] as string).trim() : ''
    if (!v) fields[c.id] = 'Initial this term.'
    else if (v.length > 8 || !/\p{L}/u.test(v)) fields[c.id] = 'Initials are a few letters.'
    else out.set(c.id, v.toUpperCase())
  }
  if (Object.keys(fields).length) return { ok: false, error: clauses.length === 1 ? 'Initial the term before you sign.' : `Initial each of the ${clauses.length} terms before you sign.`, fields }
  return { ok: true, initials: out }
}

export const INITIAL_FIRST_CODE = 'initials_required'

const FILE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }
/** Keep an uploaded picture or PDF for a proposal; its kind is read from its bytes. Returns the address it is served at, or why not. */
export async function storeProposalFile(storage: any, companyId: string, quoteId: string, file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }):
  Promise<{ error: string; status: 400 | 503 } | { url: string; name: string; contentType: string; size: number }> {
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: 'That file is over 10 MB.', status: 400 }
  const buffer = Buffer.from(await file.arrayBuffer())
  const type = sniffType(buffer) || ''
  if (!FILE_EXT[type]) return { error: 'Attach a PDF or a picture (JPEG, PNG, GIF or WebP).', status: 400 }
  if (!storage?.put) return { error: 'File storage is not set up yet.', status: 503 }
  if (storage.storageConfigured && !storage.storageConfigured()) return { error: 'File storage is not set up yet.', status: 503 }
  const key = `photos/${companyId}/proposal/${quoteId}/${crypto.randomUUID().replace(/-/g, '')}.${FILE_EXT[type]}`
  await storage.put(key, buffer, type)
  return { url: `/media/${key}`, name: String(file.name || 'file').replace(/[\\/]/g, '_').slice(0, 120), contentType: type, size: buffer.length }
}

/** The bytes of the PDFs attached to a proposal (its own, then the chosen option's — or every option's before a choice), for the PDF to carry. */
export async function attachedPdfBytes(storage: any, items: Attachment[]): Promise<Buffer[]> {
  const out: Buffer[] = []
  for (const a of items) {
    if (!a.url.startsWith('/media/') || !a.url.toLowerCase().endsWith('.pdf') || !storage?.getObject) continue
    try {
      const obj = await storage.getObject(a.url.slice('/media/'.length))
      if (obj && sniffType(Buffer.from(obj.body)) === 'application/pdf') out.push(Buffer.from(obj.body))
    } catch { /* an attachment that cannot be read is left out of the file; the page still links it */ }
  }
  return out
}

/**
 * What the quote's PDF carries beyond its lines: the cover, About Us, sections, the terms with the customer's initials, both
 * signatures, and the bytes of the PDFs attached (the proposal's, then the chosen option's — or every option's while the customer has
 * yet to choose). `options` are the quote's options as proposalView made them.
 */
export async function pdfExtras(db: any, t: { quoteProposalDocument?: any; quoteProposalMark?: any }, storage: any, quoteId: string, options: Array<{ chosen?: boolean; attachments?: Attachment[] }> | null, needsChoice: boolean) {
  if (!hasDocumentTables(t)) return {}
  const doc = await loadDocument(db, t, quoteId)
  const marks = await loadMarks(db, t, quoteId)
  const optionFiles = (options || []).filter((o) => needsChoice || o.chosen).flatMap((o) => o.attachments || [])
  const files = [...asArray(doc?.attachments), ...optionFiles] as Attachment[]
  const attachmentFiles = files.length ? await attachedPdfBytes(storage, files) : []
  // The cover photo, read from the store so the PDF can print it (a picture at an https address is on the page, not in the file).
  let coverPhoto: Buffer | null = null
  if (doc?.coverPhoto && String(doc.coverPhoto).startsWith('/media/') && storage?.getObject) {
    try {
      const obj = await storage.getObject(String(doc.coverPhoto).slice('/media/'.length))
      const bytes = obj ? Buffer.from(obj.body) : null
      const type = bytes ? sniffType(bytes) : null
      if (bytes && (type === 'image/png' || type === 'image/jpeg')) coverPhoto = bytes
    } catch { /* the page still shows it */ }
  }
  if (!doc && !marks.cosigner) return attachmentFiles.length ? { attachmentFiles } : {}
  const initialed = new Map(marks.initials.map((m) => [m.clauseId, m.initials]))
  return {
    proposalDocument: doc ? {
      coverTitle: doc.coverTitle ?? null, coverSubtitle: doc.coverSubtitle ?? null, aboutUs: doc.aboutUs ?? null,
      sections: asArray(doc.sections), attachmentNames: files.map((a) => a.name),
      clauses: asArray(doc.termsClauses).map((c) => ({ id: c.id, text: c.text, initials: initialed.get(c.id) ?? null })),
      cosigner: cosignerRequired(doc) ? { name: doc.cosignerName, role: doc.cosignerRole ?? null } : null,
    } : null,
    ...(coverPhoto ? { coverPhoto } : {}),
    cosignature: marks.cosigner ? { name: marks.cosigner.name, signature: marks.cosigner.signature, signedAt: marks.cosigner.signedAt } : null,
    ...(attachmentFiles.length ? { attachmentFiles } : {}),
  }
}
