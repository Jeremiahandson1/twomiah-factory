// Import from a spreadsheet (item 1 and parity rows 8–9, docs/parity/homecare-import.md). One file, one kind.
//   analyze  reads the file (CSV, pasted tab-separated text or an Excel workbook), matches columns to fields (or reuses a
//            mapping the agency saved for these headers), checks every row and finds the ones already in the agency. Writes
//            nothing: this IS the preview and the dry run. Cells the person fixed on the preview (`edits`) are put in first.
//   commit   creates the rows that are fine, UPDATES the matched ones when asked to and the owner has said which fields a
//            re-import may overwrite (keeping what they were), skips the rest (and says why), and keeps a batch so it can be undone.
//   undo     removes what the batch created and puts back what it updated, except anything created that has since been used
//            (visits, invoices, pay...); those are kept and listed.
// A caregiver gets a login, so it takes a seat like any other (the same rule as adding one by hand; the preview counts the
// seats left so the dry run predicts a full plan) and has a random password nobody knows: the office sets one with Reset
// password. Features: care_import (item 1's three kinds), care_import_all (row 8's kinds), care_import_wizard (row 9's
// Excel, pasted data, saved mappings, date format, inline fixes, update-in-place, reference codes, custom fields, payers
// in one cell) — all hidden (not ready).
import { and, desc, eq, inArray, count } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { normaliseZip, seatLimitOf } from '@twomiah/tenant-backend'
import {
  company, clients, clientOnboarding, user, caregiverProfiles, caregiverAvailability, notificationPreferences, importBatch, importBatchRecord,
  importMapping, importExternalId, customFieldValue, clientBillingSplits, documents,
} from '../../../db/schema/index.ts'
import {
  existingClients, existingEmails, caregiverDirectory, payerDirectory, externalIdMap, existingRecurringKeys, existingChildKeys,
  firstUse, deleteChildren, deleteOwned, recordColumns, setRecordColumns,
} from '../../../data/homecareImport.ts'
import { insertSchedule } from '../../../data/homecareScheduling.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import { insertSeatedUser } from '../hr/shared.ts'
import { schedTs, hms } from './scheduleOccurrences.ts'
import { alignRepeatAnchor, everyNWeeks, isNewRepeat } from './repeats.ts'
import { SHIFT_REPEAT_FEATURE } from '../scheduling/repeatInput.ts'
import {
  FIELDS, IMPORT_KINDS, BASE_KINDS, KIND_LABEL, DATE_FORMATS, CUSTOM_FIELD_KINDS, guessMapping, readCsv, fromRecords, applyEdits, cleanRow,
  unmappedRequired, splitName, isCustomHeader, customKey, type ImportKind, type DateFormat, type CellEdit,
} from './importRows.ts'
import { readXlsx } from './importXlsx.ts'
import { CHILD_KINDS, childSpec, type ChildKindSpec, type ParentEntity, type RowContext } from './importKinds.ts'

export const IMPORT_FEATURE = 'care_import'
export const IMPORT_ALL_FEATURE = 'care_import_all'
export const IMPORT_WIZARD_FEATURE = 'care_import_wizard'
/** Logs of what people did. They name a person but nothing depends on them, so they never stop an undo (a failed sign-in attempt is not use). */
const HISTORY_ONLY = ['audit_log', 'audit_logs']
/** Tables the import itself fills in beside a record; never "use". */
const IMPORT_OWN = ['import_external_id', 'custom_field_value', 'import_batch_record', 'client_billing_splits']
export { IMPORT_KINDS, BASE_KINDS, KIND_LABEL }
export type { ImportKind }

/** What a person needs to hold to import / undo each kind: the same permission as adding one by hand. */
export const IMPORT_PERMISSION: Record<ImportKind, { create: string; delete: string }> = {
  ...(Object.fromEntries(CHILD_KINDS.map((s) => [s.kind, s.permission])) as Record<ImportKind, { create: string; delete: string }>),
  clients: { create: 'care-clients:create', delete: 'care-clients:delete' },
  caregivers: { create: 'care-hr:create', delete: 'care-hr:delete' },
  schedules: { create: 'care-schedule:create', delete: 'care-schedule:delete' },
}

/** The fields a re-import MAY overwrite, per kind, from which the owner picks (never a name or a reference: those find the record). */
export const UPDATABLE_FIELDS: Record<ImportKind, string[]> = {
  ...(Object.fromEntries(CHILD_KINDS.map((s) => [s.kind, Object.keys(s.columns)])) as Record<ImportKind, string[]>),
  clients: ['dateOfBirth', 'gender', 'phone', 'email', 'address', 'city', 'state', 'zip', 'startDate', 'serviceType', 'medicaidId', 'isPrivatePay', 'privatePayRate', 'notes'],
  caregivers: ['phone', 'hireDate', 'defaultPayRate', 'address', 'city', 'state', 'zip'],
  schedules: [],
}

export type RowStatus = 'ok' | 'duplicate' | 'update' | 'error'
export interface RowResult {
  line: number
  status: RowStatus
  label: string
  problems: string[]
  duplicateOf?: string
  /** The fields an update would change (their labels), for a row that matched an existing record. */
  changes?: string[]
  /** The row's cells by heading, sent back only for a row with a problem so the preview can offer to fix it in place. */
  cells?: Record<string, string>
  /** What the commit will write (never sent back to a screen as editable; the server re-reads the file). */
  values: Record<string, any>
}

export interface Analysis {
  kind: ImportKind
  headers: string[]
  sheets?: string[]
  sheet?: string
  mapping: Array<{ header: string; field: string | null; confidence: 'exact' | 'likely' | 'none' }>
  fields: Array<{ key: string; label: string; required: boolean }>
  savedMapping?: { id: string; name: string } | null
  dateFormat: DateFormat
  overwritable: string[]
  missingRequired: string[]
  rows: RowResult[]
  counts: { rows: number; ok: number; duplicates: number; updates: number; errors: number }
  ready: boolean
}

export interface ImportInput {
  kind: ImportKind
  csv?: string
  /** An Excel workbook, base64 (row 9). */
  xlsx?: string
  sheet?: string
  mapping?: Record<string, string | null>
  dateFormat?: DateFormat
  edits?: CellEdit[]
  /** Update the records that matched (the owner's overwritable fields only). */
  updateMatches?: boolean
  fileName?: string | null
  /** Who ran it: the agency's office, or Twomiah staff through the assisted migration (row 10). */
  source?: 'office' | 'factory'
}

const key2 = (a: string, b: string) => `${a.trim().toLowerCase()}|${b.trim().toLowerCase()}`
const sameHeaders = (a: string[], b: string[]) => a.length === b.length && a.every((h, i) => h.trim().toLowerCase() === String(b[i] ?? '').trim().toLowerCase())
/** The usual row count of the status (what the screen and the batch count). */
const countOf = (rows: RowResult[], s: RowStatus) => rows.filter((r) => r.status === s).length
const fieldLabel = (kind: ImportKind, key: string) => FIELDS[kind].find((f) => f.key === key)?.label ?? key

export function createCsvImport(d: CrmDeps, deps: { time: AgencyTime }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, IMPORT_FEATURE)
  const enabledAll = (companyId: string) => d.features.isFeatureEnabled(companyId, IMPORT_ALL_FEATURE)
  const enabledWizard = (companyId: string) => d.features.isFeatureEnabled(companyId, IMPORT_WIZARD_FEATURE)

  /** "weekly" / "every other week" / "every 3 weeks" / "monthly" → the stored frequency, or a problem. */
  async function frequencyOf(companyId: string, raw: string | undefined): Promise<{ value: string } | { problem: string }> {
    const s = String(raw ?? '').trim().toLowerCase()
    if (!s || s === 'weekly' || s === 'every week' || s === 'week') return { value: 'weekly' }
    if (['biweekly', 'bi-weekly', 'every other week', 'every 2 weeks', 'fortnightly'].includes(s)) return { value: 'biweekly' }
    let stored: string | null = null
    if (s === 'monthly' || s === 'every month') stored = 'monthly'
    else { const m = s.match(/^every (\d{1,2}) weeks?$/); if (m) stored = everyNWeeks(Number(m[1])) }
    if (!stored) return { problem: `Repeats: "${raw}" is not one we can run. Use weekly, every other week, every 3 weeks (up to 12), or monthly.` }
    if (isNewRepeat(stored) && !(await d.features.isFeatureEnabled(companyId, SHIFT_REPEAT_FEATURE))) return { problem: `Repeats: "${raw}" needs monthly and every-N-week repeats, which this agency has not turned on.` }
    return { value: stored }
  }

  // ---- the owner's overwritable fields (company.settings.importOverwrite[kind]) ----
  async function settingsOf(companyId: string): Promise<Record<string, any>> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return (row?.settings as Record<string, any>) || {}
  }
  async function overwritable(companyId: string, kind: ImportKind): Promise<string[]> {
    const list = (await settingsOf(companyId)).importOverwrite?.[kind]
    return Array.isArray(list) ? list.filter((f: unknown) => UPDATABLE_FIELDS[kind].includes(String(f))) : []
  }
  async function setOverwritable(companyId: string, kind: ImportKind, fields: unknown): Promise<string[] | { problem: string }> {
    if (!Array.isArray(fields)) return { problem: 'fields must be a list of field names.' }
    const bad = fields.find((f) => !UPDATABLE_FIELDS[kind].includes(String(f)))
    if (bad !== undefined) return { problem: `"${bad}" is not a field a re-import may overwrite for ${KIND_LABEL[kind].toLowerCase()}.` }
    const s = await settingsOf(companyId)
    const next = { ...s, importOverwrite: { ...(s.importOverwrite || {}), [kind]: [...new Set(fields.map(String))] } }
    await d.db.update(company).set({ settings: next, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return next.importOverwrite[kind]
  }

  // ---- saved mappings (row 9) ----
  async function savedMappings(companyId: string, kind: ImportKind) {
    return d.db.select().from(importMapping).where(and(eq(importMapping.companyId, companyId), eq(importMapping.kind, kind))).orderBy(desc(importMapping.lastUsedAt), desc(importMapping.createdAt))
  }
  async function saveMapping(companyId: string, userId: string, a: { kind: ImportKind; name: string; headers: string[]; mapping: Record<string, string | null> }): Promise<{ problem: string; code: string } | { id: string; name: string; replaced: boolean }> {
    const name = String(a.name ?? '').trim().slice(0, 80)
    if (!name) return { problem: 'Give the mapping a name.', code: 'invalid' }
    if (!Array.isArray(a.headers) || !a.headers.length || !a.mapping || typeof a.mapping !== 'object') return { problem: 'A mapping needs the file\'s headings and which field each goes into.', code: 'invalid' }
    const valid = new Set(FIELDS[a.kind].map((f) => f.key))
    const mapping: Record<string, string | null> = {}
    for (const h of a.headers) {
      const f = a.mapping[h]
      mapping[h] = !f ? null : valid.has(f) || (CUSTOM_FIELD_KINDS.includes(a.kind) && String(f).startsWith('custom:')) ? f : null
    }
    const [existing] = await d.db.select().from(importMapping).where(and(eq(importMapping.companyId, companyId), eq(importMapping.kind, a.kind), eq(importMapping.name, name))).limit(1)
    if (existing) {
      await d.db.update(importMapping).set({ headers: a.headers, mapping, lastUsedAt: new Date() } as any).where(eq(importMapping.id, existing.id))
      return { id: existing.id as string, name, replaced: true }
    }
    const [row] = await d.db.insert(importMapping).values({ companyId, kind: a.kind, name, headers: a.headers, mapping, createdBy: userId } as any).returning()
    return { id: row.id as string, name, replaced: false }
  }
  async function deleteMapping(companyId: string, id: string): Promise<boolean> {
    const gone = await d.db.delete(importMapping).where(and(eq(importMapping.id, id), eq(importMapping.companyId, companyId))).returning({ id: importMapping.id })
    return gone.length > 0
  }
  /** The saved mapping whose headings are this file's (the last used first), or null. */
  async function matchingMapping(companyId: string, kind: ImportKind, headers: string[]) {
    for (const m of await savedMappings(companyId, kind)) if (sameHeaders(m.headers as string[], headers)) return m
    return null
  }

  // ---- reading the source ----
  function readSource(a: ImportInput): { headers: string[]; rows: string[][]; sheets?: string[]; sheet?: string } | { problem: string; code: string } {
    if (a.xlsx) {
      let buf: Buffer
      try { buf = Buffer.from(String(a.xlsx), 'base64') } catch { return { problem: 'The workbook could not be read.', code: 'bad_xlsx' } }
      if (buf.length > 2_000_000 * 4) return { problem: 'The workbook is too big. Split it into files under 2 MB of data.', code: 'file_too_big' }
      const wb = readXlsx(buf)
      if ('problem' in wb) return wb
      const sheets = wb.sheets.map((s) => s.name)
      const chosen = a.sheet ? wb.sheets.find((s) => s.name === a.sheet) : wb.sheets.find((s) => s.rows.length >= 2) ?? wb.sheets[0]
      if (!chosen) return { problem: `There is no sheet named "${a.sheet}".`, code: 'bad_sheet' }
      const read = fromRecords(chosen.rows)
      return 'problem' in read ? read : { ...read, sheets, sheet: chosen.name }
    }
    return readCsv(String(a.csv ?? ''))
  }

  // ---- finding a row's client / caregiver / payer (row 8: by name, email, our id or the old system's reference code) ----
  type Directory = {
    clients: Awaited<ReturnType<typeof existingClients>>; caregivers: Awaited<ReturnType<typeof caregiverDirectory>>; payers: Awaited<ReturnType<typeof payerDirectory>>
    ext: Record<ParentEntity, Map<string, string>>
  }
  async function directory(companyId: string, need: ParentEntity[]): Promise<Directory> {
    const want = new Set(need)
    const [cl, cg, py, ec, eg, ep] = await Promise.all([
      want.has('client') ? existingClients(d.db, companyId) : [], want.has('caregiver') ? caregiverDirectory(d.db, companyId) : [], want.has('payer') ? payerDirectory(d.db, companyId) : [],
      want.has('client') ? externalIdMap(d.db, companyId, 'client') : new Map(), want.has('caregiver') ? externalIdMap(d.db, companyId, 'caregiver') : new Map(), want.has('payer') ? externalIdMap(d.db, companyId, 'payer') : new Map(),
    ])
    return { clients: cl, caregivers: cg, payers: py, ext: { client: ec, caregiver: eg, payer: ep } }
  }
  const WORD: Record<ParentEntity, string> = { client: 'Client', caregiver: 'Caregiver', payer: 'Payer' }
  function resolveRef(dir: Directory, entity: ParentEntity, raw: string, fieldLabel: string): { id: string } | { problem: string } {
    const ref = raw.trim(), low = ref.toLowerCase()
    if (!ref) return { problem: `${fieldLabel} is empty.` }
    const byExt = dir.ext[entity].get(low)
    if (byExt) return { id: byExt }
    const list: Array<{ id: string; first?: string; last?: string; email?: string; name?: string; isActive?: boolean }> = entity === 'client' ? dir.clients : entity === 'caregiver' ? dir.caregivers : dir.payers
    const byId = list.find((p) => p.id === ref)
    if (byId) return { id: byId.id }
    if (entity === 'payer') {
      const hit = dir.payers.filter((p) => p.name === low)
      if (hit.length === 1) return { id: hit[0].id }
      return { problem: hit.length > 1 ? `${fieldLabel}: more than one payer is named "${ref}".` : `${fieldLabel}: no payer named "${ref}". The name must match the payer exactly; import the payers first.` }
    }
    if (entity === 'caregiver' && low.includes('@')) {
      const hit = dir.caregivers.filter((p) => p.email === low)
      if (hit.length === 1) return { id: hit[0].id }
      return { problem: `${fieldLabel}: nobody with the email "${ref}". Import the caregivers first.` }
    }
    const n = splitName(ref)
    const hit = n ? list.filter((p) => `${p.first}|${p.last}` === key2(n.first, n.last)) : []
    if (hit.length === 1) return { id: hit[0].id }
    const who = WORD[entity].toLowerCase()
    if (hit.length > 1) return { problem: `${fieldLabel}: more than one ${who} is named "${ref}"; the row cannot tell which. Use their ${entity === 'caregiver' ? 'email, ' : ''}ID or reference code.` }
    return { problem: `${fieldLabel}: no ${who} named "${ref}". Import the ${who}s first.` }
  }

  // ---- the preview ----
  async function analyze(companyId: string, a: ImportInput): Promise<Analysis | { problem: string; code: string }> {
    if (!IMPORT_KINDS.includes(a.kind)) return { problem: 'kind is not one we import.', code: 'bad_kind' }
    const fmt: DateFormat = a.dateFormat && DATE_FORMATS.includes(a.dateFormat) ? a.dateFormat : 'mdy'
    const read = readSource(a)
    if ('problem' in read) return read
    const rowsIn = applyEdits(read.headers, read.rows, a.edits)
    const guessed = guessMapping(a.kind, read.headers)
    let saved: { id: string; name: string } | null = null
    let asked = a.mapping
    if (!asked) {
      const m = await matchingMapping(companyId, a.kind, read.headers)
      if (m) { asked = m.mapping as Record<string, string | null>; saved = { id: m.id, name: m.name } }
    }
    const chosen: Record<string, string | null> = {}
    const validKeys = new Set(FIELDS[a.kind].map((f) => f.key))
    for (const g of guessed) {
      const want = asked && Object.prototype.hasOwnProperty.call(asked, g.header) ? asked[g.header] : undefined
      if (want === undefined) chosen[g.header] = g.field
      else if (want === null || want === '') chosen[g.header] = null
      else if (validKeys.has(want)) chosen[g.header] = want
      else if (String(want).startsWith('custom:') && CUSTOM_FIELD_KINDS.includes(a.kind) && isCustomHeader(String(want).replace(/^custom:/, 'custom: '))) chosen[g.header] = customKey(String(want).replace(/^custom:/, 'custom: '))
      else return { problem: `"${want}" is not a field you can import into.`, code: 'bad_mapping' }
    }
    const used = Object.values(chosen).filter(Boolean) as string[]
    if (new Set(used).size !== used.length) return { problem: 'Two columns are set to the same field. Each field can come from one column.', code: 'bad_mapping' }
    const mappingOut = guessed.map((g) => ({ header: g.header, field: chosen[g.header], confidence: (asked && g.header in asked ? (chosen[g.header] ? 'exact' : 'none') : g.confidence) as 'exact' | 'likely' | 'none' }))
    const allowed = await overwritable(companyId, a.kind)
    const base = {
      kind: a.kind, headers: read.headers, sheets: read.sheets, sheet: read.sheet, mapping: mappingOut, savedMapping: saved, dateFormat: fmt, overwritable: allowed,
      fields: [...FIELDS[a.kind].map((f) => ({ key: f.key, label: f.label, required: !!f.required })), ...read.headers.filter((h) => CUSTOM_FIELD_KINDS.includes(a.kind) && isCustomHeader(h)).map((h) => ({ key: customKey(h), label: `Custom field: ${h.replace(/^\s*custom\s*[:_-]\s*/i, '')}`, required: false }))],
    }
    const missing = unmappedRequired(a.kind, chosen)
    if (missing.length) return { ...base, missingRequired: missing, rows: [], counts: { rows: rowsIn.length, ok: 0, duplicates: 0, updates: 0, errors: 0 }, ready: false }

    const cleaned = rowsIn.map((cells, i) => cleanRow(a.kind, chosen, read.headers, cells, i + 2, fmt))
    const cellsOf = (i: number) => Object.fromEntries(read.headers.map((h, j) => [h, rowsIn[i][j] ?? '']))
    /** The row's result; an update is offered when asked, the row matched an existing record, and a mapped overwritable field is present. */
    const finish = (r: (typeof cleaned)[number], label: string, problems: string[], dup: string | undefined, dupId: string | null | undefined, i: number): RowResult => {
      let status: RowStatus = problems.length ? 'error' : dup ? 'duplicate' : 'ok'
      let changes: string[] | undefined
      if (status === 'duplicate' && dupId && a.updateMatches) {
        const present = allowed.filter((f) => r.values[f] !== undefined)
        if (present.length) { status = 'update'; changes = present.map((f) => fieldLabel(a.kind, f)); r.values._updateId = dupId }
      }
      return { line: r.line, status, label, problems, duplicateOf: dup, changes, cells: status === 'error' ? cellsOf(i) : undefined, values: { ...r.values, _custom: r.custom } }
    }

    const results: RowResult[] = []
    if (a.kind === 'clients') {
      const dir = await directory(companyId, ['client', 'payer'])
      const have = dir.clients
      const seen = new Map<string, string | null>()
      const seenExt = new Set<string>()
      cleaned.forEach((r, i) => {
        const problems = r.problems.map((p) => p.message)
        const v = r.values
        if (v.zip !== undefined) { const z = normaliseZip(v.zip); if (z === null) problems.push(`Zip: "${v.zip}" is not a zip code.`); else v.zip = z }
        if (v.payers) {
          const ids: string[] = []
          for (const name of v.payers as string[]) {
            const hit = resolveRef(dir, 'payer', name, 'Payers')
            if ('problem' in hit) problems.push(hit.problem); else ids.push(hit.id)
          }
          v._payerIds = [...new Set(ids)]
        }
        const label = `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim() || '(no name)'
        let dup: string | undefined, dupId: string | null = null
        if (!problems.length) {
          const ext = v.externalId ? String(v.externalId).trim().toLowerCase() : ''
          const k = key2(v.firstName, v.lastName)
          const byExt = ext ? dir.ext.client.get(ext) : undefined
          if (byExt) { dup = 'Already a client with this reference code'; dupId = byExt }
          else if (ext && seenExt.has(ext)) dup = 'Same reference code appears earlier in this file'
          else {
            // name + postcode first (the surest), then name (and date of birth when both sides have one)
            const named = have.filter((c) => `${c.first}|${c.last}` === k)
            const byZip = v.zip ? named.filter((c) => c.zip && normaliseZip(c.zip) === v.zip) : []
            const same = byZip[0] ?? named.find((c) => (!v.dateOfBirth || !c.dob || c.dob === v.dateOfBirth))
            if (same) { dup = byZip.length ? 'Already a client with this name and zip' : 'Already a client with this name'; dupId = same.id }
            else if (seen.has(k) && (!v.dateOfBirth || !seen.get(k) || seen.get(k) === v.dateOfBirth)) dup = 'Same client appears earlier in this file'
          }
          seen.set(k, v.dateOfBirth ?? seen.get(k) ?? null)
          if (ext) seenExt.add(ext)
        }
        results.push(finish(r, label, problems, dup, dupId, i))
      })
    } else if (a.kind === 'caregivers') {
      const dir = await directory(companyId, ['caregiver'])
      const emails = await existingEmails(d.db, companyId)
      const byEmail = new Map(dir.caregivers.map((c) => [c.email, c.id]))
      const seenExt = new Set<string>()
      // the plan's seats (the same rule the real insert applies), so the dry run predicts a full plan
      const [co] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
      const limit = seatLimitOf(co ?? null)
      let free = Infinity
      if (limit) {
        const [{ n }] = await d.db.select({ n: count() }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true)))
        free = Math.max(0, limit - Number(n))
      }
      cleaned.forEach((r, i) => {
        const problems = r.problems.map((p) => p.message)
        const v = r.values
        if (v.zip !== undefined) { const z = normaliseZip(v.zip); if (z === null) problems.push(`Zip: "${v.zip}" is not a zip code.`); else v.zip = z }
        const label = `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim() || '(no name)'
        let dup: string | undefined, dupId: string | null = null
        if (!problems.length) {
          const ext = v.externalId ? String(v.externalId).trim().toLowerCase() : ''
          const byExt = ext ? dir.ext.caregiver.get(ext) : undefined
          if (byExt) { dup = 'Already a caregiver with this reference code'; dupId = byExt }
          else if (ext && seenExt.has(ext)) dup = 'Same reference code appears earlier in this file'
          else if (emails.has(v.email)) { dup = 'A login with this email already exists'; dupId = byEmail.get(v.email) ?? null }
          emails.add(v.email)
          if (ext) seenExt.add(ext)
          if (!dup) {
            if (free <= 0) problems.push(limit ? `No seat left on the plan: it includes ${limit} and all are in use. Deactivate someone or upgrade before importing more caregivers.` : 'No seat left on the plan.')
            else free--
          }
        }
        results.push(finish(r, label, problems, dup, dupId, i))
      })
    } else if (a.kind === 'schedules') {
      const [people, kids, keys] = await Promise.all([caregiverDirectory(d.db, companyId), existingClients(d.db, companyId), existingRecurringKeys(d.db, companyId)])
      for (const [i, r] of cleaned.entries()) {
        const problems = r.problems.map((p) => p.message)
        const v = r.values
        let clientId: string | null = null, caregiverId: string | null = null
        if (v.clientName) {
          const n = splitName(String(v.clientName))
          const hit = n ? kids.filter((c) => `${c.first}|${c.last}` === key2(n.first, n.last)) : []
          if (hit.length === 1) clientId = hit[0].id
          else problems.push(hit.length > 1 ? `Client: more than one client is named "${v.clientName}"; the shift cannot tell which.` : `Client: nobody named "${v.clientName}". Import the clients first.`)
        }
        if (v.caregiverRef) {
          const ref = String(v.caregiverRef).trim().toLowerCase()
          const n = ref.includes('@') ? null : splitName(ref)
          const hit = people.filter((p) => (ref.includes('@') ? p.email === ref : !!n && `${p.first}|${p.last}` === key2(n.first, n.last)))
          if (hit.length === 1) { caregiverId = hit[0].id; if (!hit[0].isActive) problems.push(`Caregiver: ${v.caregiverRef} is not active.`) }
          else problems.push(hit.length > 1 ? `Caregiver: more than one caregiver matches "${v.caregiverRef}". Use their email.` : `Caregiver: nobody matches "${v.caregiverRef}". Import the caregivers first.`)
        }
        if (v.startTime && v.endTime && v.startTime !== v.endTime && v.endTime < v.startTime) problems.push('End time is before the start time. Shifts that run past midnight cannot be imported; add them on the schedule.')
        const freq = await frequencyOf(companyId, v.frequency)
        if ('problem' in freq) problems.push(freq.problem); else v.frequency = freq.value
        if (v.endDate && v.startDate && v.endDate < v.startDate) problems.push('Ends on is before Starts on.')
        const label = `${v.clientName ?? '?'} with ${v.caregiverRef ?? '?'}`
        let dup: string | undefined
        if (!problems.length && clientId && caregiverId) {
          const k = `${caregiverId}|${clientId}|${v.dayOfWeek}|${v.startTime}|${v.endTime}`
          if (keys.has(k)) dup = 'This caregiver already has this shift (same client, day and time)'
          keys.add(k)
          v._clientId = clientId; v._caregiverId = caregiverId
        }
        results.push(finish(r, label, problems, dup, null, i))
      }
    } else {
      const spec = childSpec(a.kind)!
      const dir = await directory(companyId, [...spec.refs.map((r) => r.entity), ...(a.kind === 'payers' ? ['payer' as const] : [])])
      const keys = await existingChildKeys(d.db, companyId, spec.tableName, spec.keyColumns)
      const seen = new Set<string>()
      const tz = await deps.time.timezone(companyId)
      const today = await deps.time.today(companyId, tz)
      cleaned.forEach((r, i) => {
        const problems = r.problems.map((p) => p.message)
        const v = r.values
        const ctx: RowContext = { tz, today, userId: '' }
        for (const ref of spec.refs) {
          const raw = v[ref.field]
          if (raw === undefined || raw === '') { if (!ref.optional && !problems.some((p) => p.startsWith(fieldLabel(a.kind, ref.field)))) problems.push(`${fieldLabel(a.kind, ref.field)} is empty.`); continue }
          const hit = resolveRef(dir, ref.entity, String(raw), fieldLabel(a.kind, ref.field))
          if ('problem' in hit) problems.push(hit.problem)
          else if (ref.entity === 'client') ctx.clientId = hit.id
          else if (ref.entity === 'caregiver') ctx.caregiverId = hit.id
          else ctx.payerId = hit.id
        }
        if (a.kind === 'payers' && v.zip !== undefined) { const z = normaliseZip(v.zip); if (z === null) problems.push(`Zip: "${v.zip}" is not a zip code.`); else v.zip = z }
        const label = spec.label(v)
        let dup: string | undefined, dupId: string | null = null
        if (!problems.length) {
          if (a.kind === 'payers' && v.externalId) {
            const ext = String(v.externalId).trim().toLowerCase()
            const byExt = dir.ext.payer.get(ext)
            if (byExt) { dup = 'Already a payer with this reference code'; dupId = byExt }
          }
          const k = spec.keyOf(v, ctx)
          if (!dup && k) {
            const had = keys.get(k)
            if (had) { dup = `Already here (same ${spec.keyColumns.map((c) => c.split(':')[0].replace(/Id$/, '').replace(/([A-Z])/g, ' $1').toLowerCase().trim()).join(', ')})`; dupId = had }
            else if (seen.has(k)) dup = 'Same record appears earlier in this file'
            seen.add(k)
          }
          v._ctx = ctx
        }
        results.push(finish(r, label, problems, dup, dupId, i))
      })
    }
    return {
      ...base, missingRequired: [], rows: results, ready: true,
      counts: { rows: results.length, ok: countOf(results, 'ok'), duplicates: countOf(results, 'duplicate'), updates: countOf(results, 'update'), errors: countOf(results, 'error') },
    }
  }

  // ---- writing beside a record: the old system's reference code, custom fields, a client's payers ----
  async function keepExternalId(tx: any, companyId: string, entity: ParentEntity, recordId: string, externalId: unknown) {
    const ext = String(externalId ?? '').trim()
    if (!ext) return
    await tx.insert(importExternalId).values({ companyId, entity, externalId: ext, recordId } as any).onConflictDoNothing()
  }
  async function keepCustomFields(tx: any, companyId: string, entity: ParentEntity, recordId: string, custom: Record<string, string> | undefined) {
    for (const [name, value] of Object.entries(custom || {})) {
      if (!value) continue
      await tx.insert(customFieldValue).values({ companyId, entity, recordId, name, value } as any)
        .onConflictDoUpdate({ target: [customFieldValue.companyId, customFieldValue.entity, customFieldValue.recordId, customFieldValue.name], set: { value, updatedAt: new Date() } as any })
    }
  }
  /** The client's payers from one cell, in the order given: priority 1, 2, …, each 100% of what is left (the office sets the real split afterwards). */
  async function keepPayers(tx: any, companyId: string, clientId: string, payerIds: string[] | undefined) {
    if (!payerIds?.length) return
    const have = await tx.select({ payerId: clientBillingSplits.payerId, priority: clientBillingSplits.priority }).from(clientBillingSplits).where(eq(clientBillingSplits.clientId, clientId))
    let priority = have.reduce((m: number, r: any) => Math.max(m, r.priority), 0)
    for (const payerId of payerIds) {
      if (have.some((r: any) => r.payerId === payerId)) continue
      await tx.insert(clientBillingSplits).values({ companyId, clientId, payerId, priority: ++priority, kind: 'percent', value: '100.00' } as any)
    }
  }

  // ---- creating one row ----
  async function createClient(companyId: string, v: Record<string, any>): Promise<string> {
    const values: any = { companyId }
    for (const k of ['firstName', 'lastName', 'dateOfBirth', 'gender', 'phone', 'email', 'address', 'city', 'state', 'zip', 'startDate', 'serviceType', 'medicaidId', 'notes']) if (v[k] !== undefined) values[k] = v[k]
    if (v.isPrivatePay !== undefined) values.isPrivatePay = v.isPrivatePay
    if (v.privatePayRate !== undefined) { values.privatePayRate = v.privatePayRate; values.privatePayRateType = 'hourly'; if (v.isPrivatePay === undefined) values.isPrivatePay = true }
    if (v._payerIds?.length) values.referredById = v._payerIds[0]
    return d.db.transaction(async (tx: any) => {
      const [client] = await tx.insert(clients).values(values).returning()
      await tx.insert(clientOnboarding).values({ companyId, clientId: client.id })
      await keepExternalId(tx, companyId, 'client', client.id, v.externalId)
      await keepCustomFields(tx, companyId, 'client', client.id, v._custom)
      await keepPayers(tx, companyId, client.id, v._payerIds)
      return client.id as string
    })
  }

  async function createCaregiver(companyId: string, v: Record<string, any>): Promise<{ id: string } | { refusal: string }> {
    // nobody knows this password; the office sets a real one with Reset password
    const passwordHash = await Bun.password.hash(createId() + createId(), 'bcrypt')
    const data: Record<string, any> = { passwordHash, role: 'field' }
    for (const k of ['firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state', 'zip', 'hireDate', 'defaultPayRate']) if (v[k] !== undefined) data[k] = v[k]
    const seated = await insertSeatedUser(d, companyId, data)
    if ('refusal' in seated) return seated
    const id = seated.row.id as string
    await d.db.insert(caregiverProfiles).values({ caregiverId: id, companyId } as any)
    await d.db.insert(caregiverAvailability).values({ caregiverId: id, companyId } as any)
    await d.db.insert(notificationPreferences).values({ userId: id, companyId } as any)
    await keepExternalId(d.db, companyId, 'caregiver', id, v.externalId)
    await keepCustomFields(d.db, companyId, 'caregiver', id, v._custom)
    return { id }
  }

  async function createSchedule(companyId: string, v: Record<string, any>, today: string): Promise<string> {
    // never back-dated (it would back-bill and back-pay), the same rule as adding a pattern by hand
    const effective = v.startDate && v.startDate >= today ? v.startDate : today
    const frequency = v.frequency || 'weekly'
    const anchor = frequency === 'weekly' ? null : alignRepeatAnchor({ frequency, anchorDate: null, effectiveDate: effective, dayOfWeek: v.dayOfWeek })
    const start = hms(v.startTime)!, end = hms(v.endTime)!
    return insertSchedule(d.db, companyId, {
      caregiverId: v._caregiverId, clientId: v._clientId, scheduleType: 'recurring', dayOfWeek: v.dayOfWeek, date: null,
      startTs: schedTs(start, effective), endTs: schedTs(end, effective), notes: v.notes ?? null,
      frequency, effectiveDate: effective, anchorDate: anchor, split: null, isTraining: false, endDate: v.endDate ?? null,
    } as any)
  }

  async function createChild(companyId: string, spec: ChildKindSpec, v: Record<string, any>, userId: string): Promise<string> {
    const ctx: RowContext = { ...(v._ctx as RowContext), userId }
    const row = spec.rowOf(v, ctx)
    return d.db.transaction(async (tx: any) => {
      const [made] = await tx.insert(spec.table).values({ ...row, companyId }).returning({ id: spec.table.id })
      if (spec.kind === 'payers') {
        await keepExternalId(tx, companyId, 'payer', made.id, v.externalId)
        await keepCustomFields(tx, companyId, 'payer', made.id, v._custom)
      }
      return made.id as string
    })
  }

  /** The table and the column values (camelCase) a kind's row would write, for an update of the overwritable fields. */
  function updateValues(kind: ImportKind, v: Record<string, any>, allowed: string[], ctx: RowContext): { table: string; values: Record<string, any> } {
    const values: Record<string, any> = {}
    if (kind === 'clients' || kind === 'caregivers') {
      for (const f of allowed) if (v[f] !== undefined) values[f] = v[f]
      if (kind === 'clients' && values.privatePayRate !== undefined) values.privatePayRateType = 'hourly'
      return { table: kind === 'clients' ? 'clients' : 'user', values }
    }
    const spec = childSpec(kind)!
    const row = spec.rowOf(v, ctx)
    for (const f of allowed) { const col = spec.columns[f]; if (v[f] !== undefined && col && row[col] !== undefined) values[col] = row[col] }
    return { table: spec.tableName, values }
  }

  async function updateRecord(companyId: string, kind: ImportKind, v: Record<string, any>, allowed: string[], userId: string): Promise<{ table: string; previous: Record<string, any>; changed: boolean }> {
    const ctx: RowContext = { ...((v._ctx as RowContext) || { tz: 'UTC', today: '', userId }), userId }
    const { table, values } = updateValues(kind, v, allowed, ctx)
    const entity: ParentEntity | null = kind === 'clients' ? 'client' : kind === 'caregivers' ? 'caregiver' : kind === 'payers' ? 'payer' : null
    return d.db.transaction(async (tx: any) => {
      const previous = (await recordColumns(tx, table, companyId, v._updateId, Object.keys(values))) || {}
      const next: Record<string, any> = {}
      for (const [k, val] of Object.entries(values)) {
        const was = previous[k]
        const same = (was instanceof Date ? was.toISOString() : JSON.stringify(was ?? null)) === (val instanceof Date ? val.toISOString() : JSON.stringify(val ?? null))
        if (!same) next[k] = typeof val === 'object' && val !== null && !(val instanceof Date) ? JSON.stringify(val) : val
      }
      if (Object.keys(next).length) await setRecordColumns(tx, table, companyId, v._updateId, next)
      if (entity) {
        await keepExternalId(tx, companyId, entity, v._updateId, v.externalId)
        await keepCustomFields(tx, companyId, entity, v._updateId, v._custom)
        if (entity === 'client') await keepPayers(tx, companyId, v._updateId, v._payerIds)
      }
      const kept: Record<string, any> = {}
      for (const k of Object.keys(next)) kept[k] = previous[k] instanceof Date ? previous[k].toISOString() : (previous[k] ?? null)
      return { table, previous: kept, changed: Object.keys(next).length > 0 }
    })
  }

  async function commit(companyId: string, userId: string, a: ImportInput) {
    const analysis = await analyze(companyId, a)
    if ('problem' in analysis) return analysis
    if (!analysis.ready) return { problem: `Match a column to: ${analysis.missingRequired.join(', ')}.`, code: 'missing_fields' }
    const today = await deps.time.today(companyId)
    const batchId = createId()
    const spec = childSpec(a.kind)
    const made: Array<{ id: string; line: number; tableName: string | null; action: 'created' | 'updated'; previous?: Record<string, any> }> = []
    const failures: Array<{ line: number; label: string; message: string }> = []
    let updated = 0
    for (const r of analysis.rows) {
      if (r.status !== 'ok' && r.status !== 'update') continue
      try {
        if (r.status === 'update') {
          const out = await updateRecord(companyId, a.kind, r.values, analysis.overwritable, userId)
          if (out.changed) { updated++; made.push({ id: r.values._updateId, line: r.line, tableName: out.table, action: 'updated', previous: out.previous }) }
          continue
        }
        if (a.kind === 'clients') made.push({ id: await createClient(companyId, r.values), line: r.line, tableName: 'clients', action: 'created' })
        else if (a.kind === 'schedules') made.push({ id: await createSchedule(companyId, r.values, today), line: r.line, tableName: 'schedules', action: 'created' })
        else if (a.kind === 'caregivers') {
          const out = await createCaregiver(companyId, r.values)
          if ('refusal' in out) failures.push({ line: r.line, label: r.label, message: out.refusal }); else made.push({ id: out.id, line: r.line, tableName: 'user', action: 'created' })
        } else made.push({ id: await createChild(companyId, spec!, r.values, userId), line: r.line, tableName: spec!.tableName, action: 'created' })
      } catch (e: any) {
        const dup = e?.code === '23505' || /unique|duplicate key/i.test(e?.message || '')
        failures.push({ line: r.line, label: r.label, message: dup ? 'Already exists (matched while importing).' : 'Could not be saved.' })
      }
    }
    // a run that created nothing leaves no batch behind (there is nothing to undo, and it would only clutter the list)
    if (made.length) {
      await d.db.insert(importBatch).values({
        id: batchId, companyId, kind: a.kind, fileName: a.fileName ? String(a.fileName).slice(0, 200) : null, rowsInFile: analysis.counts.rows, createdBy: userId,
        created: made.filter((m) => m.action === 'created').length, updated, skippedDuplicates: analysis.counts.duplicates, failed: analysis.counts.errors + failures.length,
        source: a.source === 'factory' ? 'factory' : 'office', options: { dateFormat: analysis.dateFormat, updateMatches: !!a.updateMatches, sheet: analysis.sheet ?? null, savedMapping: analysis.savedMapping?.name ?? null },
      } as any)
      await d.db.insert(importBatchRecord).values(made.map((m) => ({ companyId, batchId, recordId: m.id, line: m.line, tableName: m.tableName, action: m.action, previous: m.previous ?? null })) as any)
    }
    return {
      batchId: made.length ? batchId : null, kind: a.kind, created: made.filter((m) => m.action === 'created').length, updated, skippedDuplicates: analysis.counts.duplicates,
      skippedBadRows: analysis.counts.errors, failures,
      skipped: analysis.rows.filter((r) => r.status !== 'ok' && r.status !== 'update').map((r) => ({ line: r.line, label: r.label, status: r.status, why: r.status === 'duplicate' ? r.duplicateOf : r.problems.join(' ') })),
    }
  }

  /** Remove a record the batch created, unless it has been used since. The name of what uses it, or null when it is gone. */
  async function removeCreated(tx: any, companyId: string, batchKind: ImportKind, tableName: string | null, recordId: string): Promise<string | null> {
    const table = tableName ?? (batchKind === 'clients' ? 'clients' : batchKind === 'caregivers' ? 'user' : batchKind === 'schedules' ? 'schedules' : childSpec(batchKind)?.tableName ?? null)
    if (!table) return 'unknown'
    if (table === 'clients') {
      const used = await firstUse(tx, 'client_id', recordId, ['client_onboarding', 'client_emergency_contacts', ...IMPORT_OWN])
      if (used) return used
      await deleteChildren(tx, 'client_onboarding', 'client_id', recordId)
      await deleteChildren(tx, 'client_emergency_contacts', 'client_id', recordId)
      await deleteChildren(tx, 'client_billing_splits', 'client_id', recordId)
    } else if (table === 'user') {
      const used = (await firstUse(tx, 'caregiver_id', recordId, ['caregiver_profiles', 'caregiver_availability', ...IMPORT_OWN])) ?? (await firstUse(tx, 'user_id', recordId, ['notification_preferences', ...HISTORY_ONLY, ...IMPORT_OWN]))
      if (used) return used
      await deleteChildren(tx, 'caregiver_profiles', 'caregiver_id', recordId)
      await deleteChildren(tx, 'caregiver_availability', 'caregiver_id', recordId)
      await deleteChildren(tx, 'notification_preferences', 'user_id', recordId)
    } else if (table === 'schedules') {
      const used = await firstUse(tx, 'schedule_id', recordId, [])
      if (used) return used
    } else if (table === 'documents') {
      const [doc] = await tx.select({ signedAt: documents.signedAt }).from(documents).where(eq(documents.id, recordId)).limit(1)
      if (doc?.signedAt) return 'a signature on it'
    } else {
      const spec = CHILD_KINDS.find((s) => s.tableName === table)
      for (const col of spec?.usedBy ?? []) { const used = await firstUse(tx, col, recordId, IMPORT_OWN); if (used) return used }
    }
    for (const own of ['import_external_id', 'custom_field_value']) await deleteChildren(tx, own, 'record_id', recordId)
    await deleteOwned(tx, table, companyId, recordId)
    return null
  }

  async function undo(companyId: string, userId: string, batchId: string) {
    const [batch] = await d.db.select().from(importBatch).where(and(eq(importBatch.id, batchId), eq(importBatch.companyId, companyId))).limit(1)
    if (!batch) return { notFound: true as const }
    if (batch.status === 'undone') return { problem: 'This import has already been undone.', code: 'already_undone' }
    const recs = await d.db.select().from(importBatchRecord).where(and(eq(importBatchRecord.batchId, batchId), eq(importBatchRecord.undone, false)))
    const kept: Array<{ line: number | null; reason: string }> = []
    let removed = 0, restored = 0
    // what was updated is put back first, then what was created is removed (an update may sit on a record created earlier in the same run)
    const ordered = [...recs].sort((x: any, y: any) => Number(y.action === 'updated') - Number(x.action === 'updated'))
    for (const rec of ordered) {
      try {
        const gone = await d.db.transaction(async (tx: any) => {
          if (rec.action === 'updated') {
            const prev = (rec.previous as Record<string, any>) || {}
            if (rec.tableName && Object.keys(prev).length) await setRecordColumns(tx, rec.tableName, companyId, rec.recordId, prev)
            return 'restored'
          }
          if (rec.action === 'attached') {
            for (const extraId of ((rec.extra as any)?.certificationIds as string[] | undefined) ?? []) await deleteOwned(tx, 'certification_records', companyId, extraId)
            return removeCreated(tx, companyId, batch.kind as ImportKind, 'documents', rec.recordId)
          }
          return removeCreated(tx, companyId, batch.kind as ImportKind, rec.tableName ?? null, rec.recordId)
        })
        if (gone === 'restored') { restored++; await d.db.update(importBatchRecord).set({ undone: true } as any).where(eq(importBatchRecord.id, rec.id)) }
        else if (gone) kept.push({ line: rec.line, reason: `Already in use (${String(gone).replace(/_/g, ' ')}), so it was kept.` })
        else { removed++; await d.db.update(importBatchRecord).set({ undone: true } as any).where(eq(importBatchRecord.id, rec.id)) }
      } catch {
        kept.push({ line: rec.line, reason: 'Other records depend on it, so it was kept.' })
      }
    }
    const allGone = kept.length === 0
    if (allGone) await d.db.update(importBatch).set({ status: 'undone', undoneAt: new Date(), undoneBy: userId } as any).where(eq(importBatch.id, batchId))
    return { removed, restored, kept, undone: allGone }
  }

  async function batches(companyId: string, kinds: string[]) {
    if (!kinds.length) return []
    return d.db.select().from(importBatch).where(and(eq(importBatch.companyId, companyId), inArray(importBatch.kind, kinds))).orderBy(desc(importBatch.createdAt)).limit(50)
  }

  async function batchKind(companyId: string, batchId: string): Promise<string | null> {
    const [b] = await d.db.select({ kind: importBatch.kind }).from(importBatch).where(and(eq(importBatch.id, batchId), eq(importBatch.companyId, companyId))).limit(1)
    return (b?.kind as string) ?? null
  }

  /** A record's custom fields (row 9), by name. */
  async function customFields(companyId: string, entity: ParentEntity, recordId: string): Promise<Array<{ name: string; value: string }>> {
    const rows = await d.db.select({ name: customFieldValue.name, value: customFieldValue.value }).from(customFieldValue)
      .where(and(eq(customFieldValue.companyId, companyId), eq(customFieldValue.entity, entity), eq(customFieldValue.recordId, recordId))).orderBy(customFieldValue.name)
    return rows as any
  }

  /** The record a batch record points at, for a batch kept beside something (the assisted migration lists them). */
  async function batchRecords(companyId: string, batchId: string) {
    return d.db.select().from(importBatchRecord).where(and(eq(importBatchRecord.batchId, batchId), eq(importBatchRecord.companyId, companyId)))
  }

  return { enabled, enabledAll, enabledWizard, analyze, commit, undo, batches, batchKind, batchRecords, overwritable, setOverwritable, savedMappings, saveMapping, deleteMapping, customFields, keepExternalId, resolveRef, directory }
}
export type CsvImport = ReturnType<typeof createCsvImport>
