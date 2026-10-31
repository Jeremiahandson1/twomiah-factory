// Assisted migration (row 10, docs/parity/homecare-import.md, care_migration): AxisCare, WellSky and Birdie load an
// agency's old data for it. The tooling for Twomiah to do the same, as a product feature rather than a promise:
//   · the agency sends its old system's export through the app (a request with files, kept in the tenant's own database)
//   · Twomiah staff, from the Factory (apps/api/src/unified/migration.ts → this tenant's /api/internal/care-migration), run
//     the SAME importer the agency has (core/csvImport.ts, core/importAttach.ts) for it, kind by kind, dry run first
//   · a record-count comparison, old system vs this one, from the counts the agency typed in and what is here now
//   · a sign-off checklist (who ticked what, when) both sides can see
// Staffing it is the owner's decision; nothing here needs a person until a request arrives.
import { and, desc, eq, inArray } from 'drizzle-orm'
import { migrationRequest, migrationFile, importBatch } from '../../../db/schema/index.ts'
import { countOwned } from '../../../data/homecareImport.ts'
import type { CrmDeps } from '../../deps.ts'
import type { CsvImport, ImportInput } from './csvImport.ts'
import type { ImportAttach, AttachKind } from './importAttach.ts'
import { ATTACH_KINDS, ATTACH_LABEL } from './importAttach.ts'
import { IMPORT_KINDS, KIND_LABEL, type ImportKind } from './importRows.ts'

export const MIGRATION_FEATURE = 'care_migration'
export const MAX_MIGRATION_FILES = 10
export const MAX_MIGRATION_FILE_BYTES = 20 * 1024 * 1024
export const MIGRATION_STATUSES = ['sent', 'in_progress', 'done', 'cancelled'] as const
export type MigrationStatus = (typeof MIGRATION_STATUSES)[number]
export const MIGRATION_STATUS_LABEL: Record<MigrationStatus, string> = { sent: 'Sent to Twomiah', in_progress: 'Being loaded', done: 'Done', cancelled: 'Cancelled' }

/** The sign-off checklist (AxisCare's advice: named owners sign off billing, scheduling and HR data), as a tool. */
export const SIGNOFF_ITEMS: ReadonlyArray<{ id: string; label: string; who: 'agency' | 'staff' | 'either' }> = [
  { id: 'files', label: 'Every export file the agency has was received', who: 'staff' },
  { id: 'dry_run', label: 'Every file was dry-run and the problem rows were fixed or explained', who: 'staff' },
  { id: 'clients', label: 'Clients checked (names, dates of birth, addresses read right)', who: 'agency' },
  { id: 'caregivers', label: 'Caregivers checked, and each can sign in after Reset password', who: 'agency' },
  { id: 'schedules', label: 'Recurring shifts checked against the old schedule', who: 'agency' },
  { id: 'billing', label: 'Billing checked: payers, authorizations, past invoices', who: 'agency' },
  { id: 'hr', label: 'HR checked: certifications, training, leave, pay rates', who: 'agency' },
  { id: 'dates', label: 'Dates read the right way round (month/day vs day/month)', who: 'either' },
  { id: 'counts', label: 'Record counts match the old system (or every difference is explained)', who: 'either' },
  { id: 'go_live', label: 'The agency signs off: ready to go live', who: 'agency' },
]

/** Which records each count compares: the import kinds and the two attach kinds. */
const COUNTED: Array<{ kind: string; label: string; table: string; where?: { column: string; value: string }; roles?: string[] }> = [
  { kind: 'clients', label: KIND_LABEL.clients, table: 'clients' },
  { kind: 'caregivers', label: KIND_LABEL.caregivers, table: 'user', roles: ['caregiver', 'field'] },
  { kind: 'schedules', label: KIND_LABEL.schedules, table: 'schedules', where: { column: 'schedule_type', value: 'recurring' } },
  { kind: 'authorizations', label: KIND_LABEL.authorizations, table: 'authorizations' },
  { kind: 'certifications', label: KIND_LABEL.certifications, table: 'certification_records' },
  { kind: 'clientCredentials', label: KIND_LABEL.clientCredentials, table: 'client_credential' },
  { kind: 'medications', label: KIND_LABEL.medications, table: 'medications' },
  { kind: 'payRates', label: KIND_LABEL.payRates, table: 'caregiver_rates' },
  { kind: 'payers', label: KIND_LABEL.payers, table: 'referral_sources' },
  { kind: 'contacts', label: KIND_LABEL.contacts, table: 'client_emergency_contacts' },
  { kind: 'billingHistory', label: KIND_LABEL.billingHistory, table: 'invoices' },
  { kind: 'training', label: KIND_LABEL.training, table: 'training_records' },
  { kind: 'leave', label: KIND_LABEL.leave, table: 'caregiver_time_off' },
  { kind: 'journals', label: KIND_LABEL.journals, table: 'client_visit_notes' },
  { kind: 'reviews', label: KIND_LABEL.reviews, table: 'performance_ratings' },
  { kind: 'expenses', label: KIND_LABEL.expenses, table: 'expenses' },
  { kind: 'documents', label: ATTACH_LABEL.documents, table: 'documents', where: { column: 'entity_type', value: 'client' } },
  { kind: 'qualifications', label: ATTACH_LABEL.qualifications, table: 'documents', where: { column: 'entity_type', value: 'caregiver' } },
]
export const COUNTED_KINDS = COUNTED.map((c) => ({ kind: c.kind, label: c.label }))

export interface MigrationFileIn { name: string; data: Buffer }

export function createMigration(d: CrmDeps, deps: { csvImport: CsvImport; importAttach: ImportAttach }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, MIGRATION_FEATURE)
  const fileMeta = { id: migrationFile.id, requestId: migrationFile.requestId, name: migrationFile.name, size: migrationFile.size, uploadedAt: migrationFile.uploadedAt }

  async function create(companyId: string, userId: string, a: { fromSystem?: string | null; note?: string | null; files: MigrationFileIn[] }) {
    if (!a.files?.length) return { problem: 'Attach at least one export file.', code: 'empty_file' }
    if (a.files.length > MAX_MIGRATION_FILES) return { problem: `Send at most ${MAX_MIGRATION_FILES} files in one request.`, code: 'too_many_files' }
    const big = a.files.find((f) => f.data.length > MAX_MIGRATION_FILE_BYTES)
    if (big) return { problem: `"${big.name}" is bigger than 20 MB. Zip it, or split it.`, code: 'file_too_big' }
    const empty = a.files.find((f) => !f.data.length)
    if (empty) return { problem: `"${empty.name}" is empty.`, code: 'empty_file' }
    return d.db.transaction(async (tx: any) => {
      const [req] = await tx.insert(migrationRequest).values({ companyId, fromSystem: a.fromSystem ? String(a.fromSystem).slice(0, 120) : null, note: a.note ? String(a.note).slice(0, 4000) : null, createdBy: userId } as any).returning()
      for (const f of a.files) await tx.insert(migrationFile).values({ companyId, requestId: req.id, name: String(f.name).slice(0, 200), size: f.data.length, data: f.data.toString('base64') } as any)
      return get(companyId, req.id, tx)
    })
  }

  async function list(companyId: string) {
    const reqs = await d.db.select().from(migrationRequest).where(eq(migrationRequest.companyId, companyId)).orderBy(desc(migrationRequest.createdAt)).limit(50)
    if (!reqs.length) return []
    const files = await d.db.select(fileMeta).from(migrationFile).where(inArray(migrationFile.requestId, reqs.map((r: any) => r.id)))
    return reqs.map((r: any) => ({ ...r, statusLabel: MIGRATION_STATUS_LABEL[r.status as MigrationStatus] ?? r.status, files: files.filter((f: any) => f.requestId === r.id) }))
  }

  async function get(companyId: string, id: string, q: any = d.db) {
    const [req] = await q.select().from(migrationRequest).where(and(eq(migrationRequest.id, id), eq(migrationRequest.companyId, companyId))).limit(1)
    if (!req) return null
    const files = await q.select(fileMeta).from(migrationFile).where(eq(migrationFile.requestId, id))
    const ids = (req.batchIds as string[]) || []
    const batches = ids.length ? await q.select().from(importBatch).where(and(eq(importBatch.companyId, companyId), inArray(importBatch.id, ids))).orderBy(desc(importBatch.createdAt)) : []
    return { ...req, statusLabel: MIGRATION_STATUS_LABEL[req.status as MigrationStatus] ?? req.status, files, batches, checklist: SIGNOFF_ITEMS.map((i) => ({ ...i, signoff: (req.signoffs as any)?.[i.id] ?? null })) }
  }

  async function file(companyId: string, fileId: string): Promise<{ id: string; requestId: string; name: string; data: Buffer } | null> {
    const [f] = await d.db.select().from(migrationFile).where(and(eq(migrationFile.id, fileId), eq(migrationFile.companyId, companyId))).limit(1)
    return f ? { id: f.id, requestId: f.requestId, name: f.name, data: Buffer.from(f.data, 'base64') } : null
  }

  async function setOldCounts(companyId: string, id: string, counts: unknown) {
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return { problem: 'counts must be an object of kind → number.', code: 'invalid' }
    const clean: Record<string, number> = {}
    for (const [k, v] of Object.entries(counts as Record<string, unknown>)) {
      if (!COUNTED.some((c) => c.kind === k)) return { problem: `"${k}" is not a record kind we count.`, code: 'invalid' }
      if (v === null || v === '') continue
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0) return { problem: `${k}: "${v}" is not a count.`, code: 'invalid' }
      clean[k] = n
    }
    const [req] = await d.db.update(migrationRequest).set({ oldCounts: clean, updatedAt: new Date() } as any).where(and(eq(migrationRequest.id, id), eq(migrationRequest.companyId, companyId))).returning()
    return req ? get(companyId, id) : null
  }

  /** Old system vs here, per kind: what the agency said it had, what is here now, and the difference. */
  async function comparison(companyId: string, id: string) {
    const [req] = await d.db.select().from(migrationRequest).where(and(eq(migrationRequest.id, id), eq(migrationRequest.companyId, companyId))).limit(1)
    if (!req) return null
    const old = (req.oldCounts as Record<string, number>) || {}
    const rows = []
    for (const c of COUNTED) {
      let now = 0
      if (c.roles) for (const role of c.roles) now += await countOwned(d.db, c.table, companyId, { column: 'role', value: role })
      else now = await countOwned(d.db, c.table, companyId, c.where)
      const was = old[c.kind]
      rows.push({ kind: c.kind, label: c.label, old: was ?? null, now, difference: was === undefined ? null : now - was })
    }
    return rows
  }

  async function signoff(companyId: string, id: string, a: { item: string; done: boolean; by: string; side: 'agency' | 'staff' }) {
    const item = SIGNOFF_ITEMS.find((i) => i.id === a.item)
    if (!item) return { problem: 'That is not an item on the checklist.', code: 'invalid' }
    if (item.who !== 'either' && item.who !== a.side) return { problem: `"${item.label}" is for ${item.who === 'agency' ? 'the agency' : 'Twomiah staff'} to sign off.`, code: 'forbidden' }
    const [req] = await d.db.select().from(migrationRequest).where(and(eq(migrationRequest.id, id), eq(migrationRequest.companyId, companyId))).limit(1)
    if (!req) return null
    const signoffs = { ...((req.signoffs as Record<string, any>) || {}) }
    if (a.done) signoffs[a.item] = { by: String(a.by).slice(0, 120), side: a.side, at: new Date().toISOString() }
    else delete signoffs[a.item]
    await d.db.update(migrationRequest).set({ signoffs, updatedAt: new Date() } as any).where(eq(migrationRequest.id, id))
    return get(companyId, id)
  }

  async function setStatus(companyId: string, id: string, status: string, staffNote?: unknown) {
    if (!(MIGRATION_STATUSES as readonly string[]).includes(status)) return { problem: 'status must be sent, in_progress, done or cancelled.', code: 'invalid' }
    const set: any = { status, updatedAt: new Date() }
    if (staffNote !== undefined) set.staffNote = staffNote === null ? null : String(staffNote).slice(0, 4000)
    const [req] = await d.db.update(migrationRequest).set(set).where(and(eq(migrationRequest.id, id), eq(migrationRequest.companyId, companyId))).returning()
    return req ? get(companyId, id) : null
  }

  async function remember(companyId: string, id: string, batchId: string | null) {
    if (!batchId) return
    const [req] = await d.db.select({ batchIds: migrationRequest.batchIds }).from(migrationRequest).where(and(eq(migrationRequest.id, id), eq(migrationRequest.companyId, companyId))).limit(1)
    if (!req) return
    await d.db.update(migrationRequest).set({ batchIds: [...((req.batchIds as string[]) || []), batchId], status: 'in_progress', updatedAt: new Date() } as any).where(eq(migrationRequest.id, id))
  }

  /** Run the importer on one of the request's files (the same code the agency's screen runs), as Twomiah staff. */
  async function runImport(companyId: string, id: string, a: { fileId: string; kind: ImportKind; by: string; mapping?: Record<string, string | null>; sheet?: string; dateFormat?: ImportInput['dateFormat']; updateMatches?: boolean; edits?: ImportInput['edits']; dryRun?: boolean }) {
    if (!IMPORT_KINDS.includes(a.kind)) return { problem: 'kind is not one we import.', code: 'bad_kind' }
    const f = await file(companyId, a.fileId)
    if (!f || f.requestId !== id) return { problem: 'That file is not on this request.', code: 'not_found' }
    const isXlsx = /\.xlsx$/i.test(f.name)
    const input: ImportInput = { kind: a.kind, ...(isXlsx ? { xlsx: f.data.toString('base64'), sheet: a.sheet } : { csv: f.data.toString('utf8') }), mapping: a.mapping, dateFormat: a.dateFormat, updateMatches: a.updateMatches, edits: a.edits, fileName: f.name, source: 'factory' }
    if (a.dryRun) return deps.csvImport.analyze(companyId, input)
    const out = await deps.csvImport.commit(companyId, `factory:${a.by}`, input)
    if (!('problem' in out)) await remember(companyId, id, out.batchId)
    return out
  }

  /** Attach a zip on the request to clients (documents) or caregivers (qualifications), as Twomiah staff. */
  async function runAttach(companyId: string, id: string, a: { fileId: string; kind: AttachKind; by: string; dryRun?: boolean; dateFormat?: ImportInput['dateFormat'] }) {
    if (!ATTACH_KINDS.includes(a.kind)) return { problem: 'kind must be documents or qualifications.', code: 'bad_kind' }
    const f = await file(companyId, a.fileId)
    if (!f || f.requestId !== id) return { problem: 'That file is not on this request.', code: 'not_found' }
    const out = await deps.importAttach.attach(companyId, `factory:${a.by}`, { kind: a.kind, zip: f.data, fileName: f.name, dryRun: a.dryRun, dateFormat: a.dateFormat, source: 'factory' })
    if (!('problem' in out) && !a.dryRun) await remember(companyId, id, out.batchId)
    return out
  }

  return { enabled, create, list, get, file, setOldCounts, comparison, signoff, setStatus, runImport, runAttach }
}
export type Migration = ReturnType<typeof createMigration>
