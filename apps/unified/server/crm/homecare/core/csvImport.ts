// CSV import of clients, caregivers and recurring shifts (item 1, docs/parity/homecare-import.md). One file, one kind.
//   analyze  reads the file, matches columns to fields, checks every row and finds the ones already in the agency. Writes nothing:
//            this IS the preview and the dry run.
//   commit   creates the rows that are fine, skips duplicates and bad rows (and says why), and keeps a batch so it can be undone.
//   undo     removes what the batch created, except anything that has since been used (visits, invoices, pay...); those are
//            kept and listed. A row that matched an existing record is never changed by an import, so there is nothing of that to undo.
// A caregiver gets a login, so it takes a seat like any other (the same rule as adding one by hand) and has a random
// password nobody knows: the office sets one with Reset password. Only for an agency with care_import (not ready).
import { and, desc, eq, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { normaliseZip } from '@twomiah/tenant-backend'
import {
  clients, clientOnboarding, user, caregiverProfiles, caregiverAvailability, notificationPreferences, importBatch, importBatchRecord,
} from '../../../db/schema/index.ts'
import {
  existingClients, existingEmails, caregiverDirectory, existingRecurringKeys, firstUse, deleteChildren, deleteOwned,
} from '../../../data/homecareImport.ts'
import { insertSchedule } from '../../../data/homecareScheduling.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import { insertSeatedUser } from '../hr/shared.ts'
import { schedTs, hms } from './scheduleOccurrences.ts'
import { alignRepeatAnchor, everyNWeeks, isNewRepeat } from './repeats.ts'
import { SHIFT_REPEAT_FEATURE } from '../scheduling/repeatInput.ts'
import {
  FIELDS, IMPORT_KINDS, guessMapping, readCsv, cleanRow, unmappedRequired, splitName, type ImportKind,
} from './importRows.ts'

export const IMPORT_FEATURE = 'care_import'
/** Logs of what people did. They name a person but nothing depends on them, so they never stop an undo (a failed sign-in attempt is not use). */
const HISTORY_ONLY = ['audit_log', 'audit_logs']
export { IMPORT_KINDS }
export type { ImportKind }

/** What a person needs to hold to import / undo each kind: the same permission as adding one by hand. */
export const IMPORT_PERMISSION: Record<ImportKind, { create: string; delete: string }> = {
  clients: { create: 'care-clients:create', delete: 'care-clients:delete' },
  caregivers: { create: 'care-hr:create', delete: 'care-hr:delete' },
  schedules: { create: 'care-schedule:create', delete: 'care-schedule:delete' },
}

export interface RowResult {
  line: number
  status: 'ok' | 'duplicate' | 'error'
  label: string
  problems: string[]
  duplicateOf?: string
  /** What the commit will write (never sent back to a screen as editable; the server re-reads the file). */
  values: Record<string, any>
}

export interface Analysis {
  kind: ImportKind
  headers: string[]
  mapping: Array<{ header: string; field: string | null; confidence: 'exact' | 'likely' | 'none' }>
  fields: Array<{ key: string; label: string; required: boolean }>
  missingRequired: string[]
  rows: RowResult[]
  counts: { rows: number; ok: number; duplicates: number; errors: number }
  ready: boolean
}

const key2 = (a: string, b: string) => `${a.trim().toLowerCase()}|${b.trim().toLowerCase()}`
const clip = (rows: RowResult[]) => rows

export function createCsvImport(d: CrmDeps, deps: { time: AgencyTime }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, IMPORT_FEATURE)

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

  async function analyze(companyId: string, a: { kind: ImportKind; csv: string; mapping?: Record<string, string | null> }): Promise<Analysis | { problem: string; code: string }> {
    const read = readCsv(a.csv)
    if ('problem' in read) return read
    const guessed = guessMapping(a.kind, read.headers)
    const chosen: Record<string, string | null> = {}
    const validKeys = new Set(FIELDS[a.kind].map((f) => f.key))
    for (const g of guessed) {
      const asked = a.mapping && Object.prototype.hasOwnProperty.call(a.mapping, g.header) ? a.mapping[g.header] : undefined
      if (asked === undefined) chosen[g.header] = g.field
      else if (asked === null || asked === '') chosen[g.header] = null
      else if (validKeys.has(asked)) chosen[g.header] = asked
      else return { problem: `"${asked}" is not a field you can import into.`, code: 'bad_mapping' }
    }
    const used = Object.values(chosen).filter(Boolean) as string[]
    if (new Set(used).size !== used.length) return { problem: 'Two columns are set to the same field. Each field can come from one column.', code: 'bad_mapping' }
    const mappingOut = guessed.map((g) => ({ header: g.header, field: chosen[g.header], confidence: (a.mapping && g.header in a.mapping ? (chosen[g.header] ? 'exact' : 'none') : g.confidence) as 'exact' | 'likely' | 'none' }))
    const base = {
      kind: a.kind, headers: read.headers, mapping: mappingOut,
      fields: FIELDS[a.kind].map((f) => ({ key: f.key, label: f.label, required: !!f.required })),
    }
    const missing = unmappedRequired(a.kind, chosen)
    if (missing.length) return { ...base, missingRequired: missing, rows: [], counts: { rows: read.rows.length, ok: 0, duplicates: 0, errors: 0 }, ready: false }

    const cleaned = read.rows.map((cells, i) => cleanRow(a.kind, chosen, read.headers, cells, i + 2))
    const results: RowResult[] = []
    if (a.kind === 'clients') {
      const have = await existingClients(d.db, companyId)
      const seen = new Map<string, string | null>()
      for (const r of cleaned) {
        const problems = r.problems.map((p) => p.message)
        const v = r.values
        if (v.zip !== undefined) { const z = normaliseZip(v.zip); if (z === null) problems.push(`Zip: "${v.zip}" is not a zip code.`); else v.zip = z }
        const label = `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim() || '(no name)'
        let dup: string | undefined
        if (!problems.length) {
          const k = key2(v.firstName, v.lastName)
          const same = have.find((c) => `${c.first}|${c.last}` === k && (!v.dateOfBirth || !c.dob || c.dob === v.dateOfBirth))
          if (same) dup = 'Already a client with this name'
          else if (seen.has(k) && (!v.dateOfBirth || !seen.get(k) || seen.get(k) === v.dateOfBirth)) dup = 'Same client appears earlier in this file'
          seen.set(k, v.dateOfBirth ?? seen.get(k) ?? null)
        }
        results.push({ line: r.line, status: problems.length ? 'error' : dup ? 'duplicate' : 'ok', label, problems, duplicateOf: dup, values: v })
      }
    } else if (a.kind === 'caregivers') {
      const emails = await existingEmails(d.db, companyId)
      for (const r of cleaned) {
        const problems = r.problems.map((p) => p.message)
        const v = r.values
        if (v.zip !== undefined) { const z = normaliseZip(v.zip); if (z === null) problems.push(`Zip: "${v.zip}" is not a zip code.`); else v.zip = z }
        const label = `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim() || '(no name)'
        let dup: string | undefined
        if (!problems.length) {
          if (emails.has(v.email)) dup = 'A login with this email already exists'
          emails.add(v.email)
        }
        results.push({ line: r.line, status: problems.length ? 'error' : dup ? 'duplicate' : 'ok', label, problems, duplicateOf: dup, values: v })
      }
    } else {
      const [people, kids, keys] = await Promise.all([caregiverDirectory(d.db, companyId), existingClients(d.db, companyId), existingRecurringKeys(d.db, companyId)])
      for (const r of cleaned) {
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
        results.push({ line: r.line, status: problems.length ? 'error' : dup ? 'duplicate' : 'ok', label, problems, duplicateOf: dup, values: v })
      }
    }
    const count = (s: RowResult['status']) => results.filter((r) => r.status === s).length
    return { ...base, missingRequired: [], rows: clip(results), counts: { rows: results.length, ok: count('ok'), duplicates: count('duplicate'), errors: count('error') }, ready: true }
  }

  // ---- creating one row ----
  async function createClient(companyId: string, v: Record<string, any>): Promise<string> {
    const values: any = { companyId }
    for (const k of ['firstName', 'lastName', 'dateOfBirth', 'gender', 'phone', 'email', 'address', 'city', 'state', 'zip', 'startDate', 'serviceType', 'medicaidId', 'notes']) if (v[k] !== undefined) values[k] = v[k]
    if (v.isPrivatePay !== undefined) values.isPrivatePay = v.isPrivatePay
    if (v.privatePayRate !== undefined) { values.privatePayRate = v.privatePayRate; values.privatePayRateType = 'hourly'; if (v.isPrivatePay === undefined) values.isPrivatePay = true }
    return d.db.transaction(async (tx: any) => {
      const [client] = await tx.insert(clients).values(values).returning()
      await tx.insert(clientOnboarding).values({ companyId, clientId: client.id })
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

  async function commit(companyId: string, userId: string, a: { kind: ImportKind; csv: string; mapping?: Record<string, string | null>; fileName?: string | null }) {
    const analysis = await analyze(companyId, a)
    if ('problem' in analysis) return analysis
    if (!analysis.ready) return { problem: `Match a column to: ${analysis.missingRequired.join(', ')}.`, code: 'missing_fields' }
    const today = await deps.time.today(companyId)
    const batchId = createId()
    const made: Array<{ id: string; line: number }> = []
    const failures: Array<{ line: number; label: string; message: string }> = []
    for (const r of analysis.rows) {
      if (r.status !== 'ok') continue
      try {
        if (a.kind === 'clients') made.push({ id: await createClient(companyId, r.values), line: r.line })
        else if (a.kind === 'schedules') made.push({ id: await createSchedule(companyId, r.values, today), line: r.line })
        else {
          const out = await createCaregiver(companyId, r.values)
          if ('refusal' in out) failures.push({ line: r.line, label: r.label, message: out.refusal }); else made.push({ id: out.id, line: r.line })
        }
      } catch (e: any) {
        const dup = e?.code === '23505' || /unique|duplicate key/i.test(e?.message || '')
        failures.push({ line: r.line, label: r.label, message: dup ? 'Already exists (matched while importing).' : 'Could not be saved.' })
      }
    }
    // a run that created nothing leaves no batch behind (there is nothing to undo, and it would only clutter the list)
    if (made.length) {
      await d.db.insert(importBatch).values({
        id: batchId, companyId, kind: a.kind, fileName: a.fileName ? String(a.fileName).slice(0, 200) : null, rowsInFile: analysis.counts.rows, createdBy: userId,
        created: made.length, skippedDuplicates: analysis.counts.duplicates, failed: analysis.counts.errors + failures.length,
      } as any)
      await d.db.insert(importBatchRecord).values(made.map((m) => ({ companyId, batchId, recordId: m.id, line: m.line })) as any)
    }
    return {
      batchId: made.length ? batchId : null, kind: a.kind, created: made.length, skippedDuplicates: analysis.counts.duplicates,
      skippedBadRows: analysis.counts.errors, failures,
      skipped: analysis.rows.filter((r) => r.status !== 'ok').map((r) => ({ line: r.line, label: r.label, status: r.status, why: r.status === 'duplicate' ? r.duplicateOf : r.problems.join(' ') })),
    }
  }

  async function undo(companyId: string, userId: string, batchId: string) {
    const [batch] = await d.db.select().from(importBatch).where(and(eq(importBatch.id, batchId), eq(importBatch.companyId, companyId))).limit(1)
    if (!batch) return { notFound: true as const }
    if (batch.status === 'undone') return { problem: 'This import has already been undone.', code: 'already_undone' }
    const recs = await d.db.select().from(importBatchRecord).where(and(eq(importBatchRecord.batchId, batchId), eq(importBatchRecord.undone, false)))
    const kept: Array<{ line: number | null; reason: string }> = []
    let removed = 0
    for (const rec of recs) {
      try {
        const gone = await d.db.transaction(async (tx: any) => {
          if (batch.kind === 'clients') {
            const used = await firstUse(tx, 'client_id', rec.recordId, ['client_onboarding', 'client_emergency_contacts'])
            if (used) return used
            await deleteChildren(tx, 'client_onboarding', 'client_id', rec.recordId)
            await deleteChildren(tx, 'client_emergency_contacts', 'client_id', rec.recordId)
            await deleteOwned(tx, 'clients', companyId, rec.recordId)
          } else if (batch.kind === 'caregivers') {
            const used = (await firstUse(tx, 'caregiver_id', rec.recordId, ['caregiver_profiles', 'caregiver_availability'])) ?? (await firstUse(tx, 'user_id', rec.recordId, ['notification_preferences', ...HISTORY_ONLY]))
            if (used) return used
            await deleteChildren(tx, 'caregiver_profiles', 'caregiver_id', rec.recordId)
            await deleteChildren(tx, 'caregiver_availability', 'caregiver_id', rec.recordId)
            await deleteChildren(tx, 'notification_preferences', 'user_id', rec.recordId)
            await deleteOwned(tx, 'user', companyId, rec.recordId)
          } else {
            const used = await firstUse(tx, 'schedule_id', rec.recordId, [])
            if (used) return used
            await deleteOwned(tx, 'schedules', companyId, rec.recordId)
          }
          return null
        })
        if (gone) kept.push({ line: rec.line, reason: `Already in use (${String(gone).replace(/_/g, ' ')}), so it was kept.` })
        else { removed++; await d.db.update(importBatchRecord).set({ undone: true } as any).where(eq(importBatchRecord.id, rec.id)) }
      } catch {
        kept.push({ line: rec.line, reason: 'Other records depend on it, so it was kept.' })
      }
    }
    const allGone = kept.length === 0
    if (allGone) await d.db.update(importBatch).set({ status: 'undone', undoneAt: new Date(), undoneBy: userId } as any).where(eq(importBatch.id, batchId))
    return { removed, kept, undone: allGone }
  }

  async function batches(companyId: string, kinds: ImportKind[]) {
    if (!kinds.length) return []
    return d.db.select().from(importBatch).where(and(eq(importBatch.companyId, companyId), inArray(importBatch.kind, kinds))).orderBy(desc(importBatch.createdAt)).limit(50)
  }

  async function batchKind(companyId: string, batchId: string): Promise<ImportKind | null> {
    const [b] = await d.db.select({ kind: importBatch.kind }).from(importBatch).where(and(eq(importBatch.id, batchId), eq(importBatch.companyId, companyId))).limit(1)
    return (b?.kind as ImportKind) ?? null
  }

  return { enabled, analyze, commit, undo, batches, batchKind }
}
export type CsvImport = ReturnType<typeof createCsvImport>
