// Bulk attach (row 9, docs/parity/homecare-import.md, care_import_wizard): a zip of files attached to clients as documents,
// or to caregivers as qualifications (a certification record with its certificate), with its own attached / skipped /
// failed summary and an undo of its own. Who a file belongs to comes from the zip itself:
//   · a folder per person:          Maria Lopez/care plan.pdf      C-1001/consent.pdf      sam.reed@example.com/CPR.pdf
//   · or the name before " - " / "__": Maria Lopez - care plan.pdf   C-1001__consent.pdf
//   · or an index.csv at the root naming each file: file, person, name, type, expires, issued, number
// A person is found the same way an import row finds one (csvImport.ts resolveRef): reference code, our id, email (a
// caregiver), or name. A file already attached to that person under the same file name is skipped.
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { documents, certificationRecords, importBatch, importBatchRecord } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { CsvImport } from './csvImport.ts'
import { readZip, type ZipEntry } from './importZip.ts'
import { readCsv, cleanDate, type DateFormat } from './importRows.ts'

export type AttachKind = 'documents' | 'qualifications'
export const ATTACH_KINDS: readonly AttachKind[] = ['documents', 'qualifications']
export const ATTACH_PERMISSION: Record<AttachKind, { create: string; delete: string }> = {
  documents: { create: 'care-clients:create', delete: 'care-clients:delete' },
  qualifications: { create: 'care-hr:create', delete: 'care-hr:delete' },
}
export const ATTACH_LABEL: Record<AttachKind, string> = { documents: 'Client documents (zip)', qualifications: 'Caregiver qualifications (zip)' }
/** The same file types the Documents screen takes. */
const ALLOWED = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.txt']
export const MAX_ZIP_BYTES = 50 * 1024 * 1024
const maxFileBytes = () => (parseInt(process.env.MAX_FILE_SIZE_MB || '10') || 10) * 1024 * 1024
const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export interface AttachItem {
  file: string
  person: string
  /** The document's name (a file's stem unless the index says otherwise); for a qualification, the certification type. */
  name: string
  type?: string
  expires?: string
  issued?: string
  number?: string
}
export interface AttachPlan { items: AttachItem[]; problems: Array<{ file: string; why: string }> }

const lower = (s: string) => s.trim().toLowerCase()
const stem = (file: string) => path.basename(file).replace(/\.[^.]+$/, '')

/** Who each file is for and what it is, from the zip's folders and names, and index.csv when there is one. */
export function planFromZip(entries: ZipEntry[], dateFormat: DateFormat = 'mdy'): AttachPlan {
  const files = entries.filter((e) => !e.isDirectory && !e.name.startsWith('__MACOSX/') && !path.basename(e.name).startsWith('.'))
  const problems: AttachPlan['problems'] = []
  const index = files.find((e) => lower(e.name) === 'index.csv' || lower(e.name).endsWith('/index.csv'))
  const items: AttachItem[] = []
  const named = new Map<string, AttachItem>()
  if (index) {
    const read = readCsv(index.data().toString('utf8'))
    if ('problem' in read) problems.push({ file: index.name, why: `index.csv: ${read.problem}` })
    else {
      const col = (names: string[]) => read.headers.findIndex((h) => names.includes(lower(h)))
      const iFile = col(['file', 'file name', 'filename', 'path']), iPerson = col(['person', 'client', 'caregiver', 'who', 'for', 'name of person', 'client name', 'caregiver name', 'reference', 'reference code', 'id'])
      const iName = col(['name', 'document', 'document name', 'title', 'certification', 'certification type', 'type of certification', 'qualification'])
      const iType = col(['type', 'category', 'document type']), iExp = col(['expires', 'expiry', 'expiry date', 'expiration', 'expiration date', 'valid until'])
      const iIss = col(['issued', 'issue date', 'issued on']), iNum = col(['number', 'certificate number', 'certification number', 'cert #'])
      if (iFile < 0 || iPerson < 0) problems.push({ file: index.name, why: 'index.csv needs a "file" column and a "person" column (client or caregiver).' })
      else {
        read.rows.forEach((r, i) => {
          const file = String(r[iFile] ?? '').trim(), person = String(r[iPerson] ?? '').trim()
          if (!file) return
          if (!person) { problems.push({ file, why: `index.csv row ${i + 2}: no person.` }); return }
          const item: AttachItem = { file, person, name: (iName >= 0 && String(r[iName] ?? '').trim()) || stem(file), type: iType >= 0 ? String(r[iType] ?? '').trim() || undefined : undefined, number: iNum >= 0 ? String(r[iNum] ?? '').trim() || undefined : undefined }
          for (const [key, idx] of [['expires', iExp], ['issued', iIss]] as const) {
            const raw = idx >= 0 ? String(r[idx] ?? '').trim() : ''
            if (!raw) continue
            const dt = cleanDate(raw, dateFormat)
            if ('problem' in dt) problems.push({ file, why: `index.csv row ${i + 2}, ${key}: ${dt.problem}` }); else item[key] = dt.value
          }
          named.set(lower(file), item); named.set(lower(path.basename(file)), item)
        })
      }
    }
  }
  for (const e of files) {
    if (e === index) continue
    const ext = path.extname(e.name).toLowerCase()
    if (!ALLOWED.includes(ext)) { problems.push({ file: e.name, why: `${ext || 'no extension'}: not a file type we keep (PDF, Word, Excel, images, text).` }); continue }
    const fromIndex = named.get(lower(e.name)) ?? named.get(lower(path.basename(e.name)))
    if (fromIndex) { items.push({ ...fromIndex, file: e.name }); continue }
    const parts = e.name.split('/').filter(Boolean)
    const base = parts[parts.length - 1]
    if (parts.length >= 2) { items.push({ file: e.name, person: parts[parts.length - 2], name: stem(base) }); continue }
    const m = base.match(/^(.+?)\s*(?: - |__)\s*(.+)$/)
    if (m) { items.push({ file: e.name, person: m[1].trim(), name: stem(m[2]) }); continue }
    problems.push({ file: e.name, why: 'Could not tell who it is for: put it in a folder named after the person, name it "Person - document.pdf", or list it in index.csv.' })
  }
  return { items, problems }
}

export function createImportAttach(d: CrmDeps, deps: { csvImport: CsvImport }) {
  async function attach(companyId: string, userId: string, a: { kind: AttachKind; zip: Buffer; fileName?: string | null; dryRun?: boolean; dateFormat?: DateFormat; source?: 'office' | 'factory' }) {
    if (!ATTACH_KINDS.includes(a.kind)) return { problem: 'kind must be documents or qualifications.', code: 'bad_kind' }
    if (!a.zip?.length) return { problem: 'Choose a zip file.', code: 'empty_file' }
    if (a.zip.length > MAX_ZIP_BYTES) return { problem: 'The zip is too big. Send at most 50 MB at a time.', code: 'file_too_big' }
    const entries = readZip(a.zip)
    if ('problem' in entries) return entries
    const plan = planFromZip(entries, a.dateFormat)
    const entity = a.kind === 'documents' ? 'client' : 'caregiver'
    const dir = await deps.csvImport.directory(companyId, [entity])
    const limit = maxFileBytes()
    const attached: Array<{ file: string; person: string; name: string }> = []
    const skipped: Array<{ file: string; why: string }> = plan.problems.map((p) => ({ file: p.file, why: p.why }))
    const failed: Array<{ file: string; why: string }> = []
    const made: Array<{ documentId: string; certificationIds: string[]; file: string }> = []
    const already = await d.db.select({ entityId: documents.entityId, fileName: documents.fileName }).from(documents).where(and(eq(documents.companyId, companyId), eq(documents.entityType, entity)))
    const have = new Set(already.map((r: any) => `${r.entityId}|${lower(String(r.fileName ?? ''))}`))
    const batchId = createId()
    for (const item of plan.items) {
      const who = deps.csvImport.resolveRef(dir, entity, item.person, entity === 'client' ? 'Client' : 'Caregiver')
      if ('problem' in who) { skipped.push({ file: item.file, why: who.problem }); continue }
      const entry = entries.find((e) => e.name === item.file)!
      const baseName = path.basename(item.file)
      if (entry.size > limit) { skipped.push({ file: item.file, why: `Bigger than ${Math.round(limit / 1024 / 1024)} MB.` }); continue }
      const key = `${who.id}|${lower(baseName)}`
      if (have.has(key)) { skipped.push({ file: item.file, why: 'Already attached to them (same file name).' }); continue }
      have.add(key)
      if (a.dryRun) { attached.push({ file: item.file, person: item.person, name: item.name }); continue }
      try {
        const ext = path.extname(baseName).slice(1).toLowerCase()
        const bytes = entry.data()
        const out = await d.db.transaction(async (tx: any) => {
          const [doc] = await tx.insert(documents).values({
            companyId, entityType: entity, entityId: who.id, documentType: a.kind === 'qualifications' ? 'certification' : (item.type || 'other').toLowerCase().slice(0, 60), name: item.name.slice(0, 200),
            fileName: baseName, fileType: MIME[ext] ?? 'application/octet-stream', fileSize: bytes.length, fileData: bytes.toString('base64'), expirationDate: item.expires ?? null, uploadedById: userId,
          } as any).returning({ id: documents.id })
          const certificationIds: string[] = []
          if (a.kind === 'qualifications') {
            const url = `/api/documents/${doc.id}/download`
            const [same] = await tx.select({ id: certificationRecords.id, documentUrl: certificationRecords.documentUrl }).from(certificationRecords)
              .where(and(eq(certificationRecords.companyId, companyId), eq(certificationRecords.caregiverId, who.id), eq(certificationRecords.certificationType, item.name))).limit(1)
            if (same) { if (!same.documentUrl) await tx.update(certificationRecords).set({ documentUrl: url } as any).where(eq(certificationRecords.id, same.id)) }
            else {
              const [cert] = await tx.insert(certificationRecords).values({ companyId, caregiverId: who.id, certificationType: item.name.slice(0, 200), issueDate: item.issued ?? null, expiryDate: item.expires ?? null, certificationNumber: item.number ?? null, documentUrl: url, status: 'active' } as any).returning({ id: certificationRecords.id })
              certificationIds.push(cert.id)
            }
          }
          return { documentId: doc.id as string, certificationIds }
        })
        made.push({ ...out, file: item.file })
        attached.push({ file: item.file, person: item.person, name: item.name })
      } catch {
        failed.push({ file: item.file, why: 'Could not be saved.' })
      }
    }
    if (!a.dryRun && made.length) {
      await d.db.insert(importBatch).values({
        id: batchId, companyId, kind: a.kind, fileName: a.fileName ? String(a.fileName).slice(0, 200) : null, rowsInFile: plan.items.length + plan.problems.length, createdBy: userId,
        created: 0, attached: made.length, skippedDuplicates: skipped.length, failed: failed.length, source: a.source === 'factory' ? 'factory' : 'office',
      } as any)
      await d.db.insert(importBatchRecord).values(made.map((m, i) => ({ companyId, batchId, recordId: m.documentId, line: i + 1, tableName: 'documents', action: 'attached', extra: { certificationIds: m.certificationIds, file: m.file } })) as any)
    }
    return { batchId: !a.dryRun && made.length ? batchId : null, kind: a.kind, dryRun: !!a.dryRun, attached: attached.length, skipped: skipped.length, failed: failed.length, attachedFiles: attached, skippedFiles: skipped, failedFiles: failed }
  }

  return { attach }
}
export type ImportAttach = ReturnType<typeof createImportAttach>
