// The report builder, the dashboards, the daily manager report, the workforce analytics and the caregiver performance report
// (row 12, care_report_builder, not ready until the owner has tried it; docs/parity/homecare-margin-turnover.md).
//
//   · REPORT BUILDER: a custom report over the VISIT fields (FIELDS — one row per visit worked, data/homecareReportBuilder.ts
//     visitRows): the office picks columns, filters (field · rule · value), a sort and a grouping; saves it, copies it, copies one
//     of the standard library (LIBRARY) and edits the copy; runs it on screen or downloads it. Pay-related fields are shown only to
//     someone who may read payroll. The filter engine is pure (applyDefinition) and tested alone.
//   · DASHBOARDS: three fixed ones (financial, authorization utilisation, caregiver) and custom ones built from a catalogue of
//     tiles (TILES), each tile a figure or a chart the fixed dashboards also draw — profit margin by branch and by referral source
//     among them.
//   · DAILY MANAGER REPORT: one agency day — what was scheduled, done, missed, cancelled, late, unfilled, open — and the day's money.
//   · WORKFORCE: workload per caregiver against the hours they want and the most they will do, who is underused, cancellations by week.
//   · CAREGIVER PERFORMANCE: late clock-ins and clock-outs, visits completed / missed / cancelled, ADL (task) and form completion,
//     client ratings, per caregiver.
// Money in integer cents; days on the agency's clock.
import { and, desc, eq } from 'drizzle-orm'
import { dashboardLayout, reportDefinition } from '../../../db/schema/index.ts'
import {
  visitRows, cancelledVisits, missedVisits, scheduledByCaregiver, caregiverCapacity, clockedHoursByCaregiverWeek, authorizationUtilisation,
  dayCounts, dayUnclocked, moneyByMonth, receivablesNow,
} from '../../../data/homecareReportBuilder.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, type AgencyTime } from './agencyTime.ts'
import { CANCEL_REASONS } from './cancelReasons.ts'
import type { Margin } from './margin.ts'
import { ON_TIME_GRACE_MINUTES } from './punchRules.ts'
import { reasonLabel as signatureReasonLabel } from './visitSignature.ts'

export const REPORT_BUILDER_FEATURE = 'care_report_builder'
export const MAX_WINDOW_DAYS = 400

/** What every screen calls a payroll review status — never the stored code. */
export const PAYROLL_STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for review', verified: 'Verified', approved: 'Approved', flagged: 'Flagged', missing_punch: 'Missing punch', excused: 'Excused', manual_entry: 'Entered by hand',
}
const APPROVAL_LABELS: Record<string, string> = {
  unscheduled: 'Not on the schedule', variance: 'Clock time differs from the schedule', zero_duration: 'Clocked in and out at once', too_long: 'Unusually long', offline: 'Punched offline', forced_clock_out: 'Clocked out by the office',
}
const approvalLabel = (v: string | null) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean).map((s) => APPROVAL_LABELS[s] ?? s.replace(/_/g, ' ')).join(', ') : null)

export type FieldType = 'text' | 'number' | 'date' | 'time' | 'bool' | 'cents' | 'minutes'
export interface Field { key: string; label: string; type: FieldType; group: string; payroll?: boolean }

/** The visit fields a report can show, filter on, sort by and group by. */
export const FIELDS: Field[] = [
  { key: 'date', label: 'Date', type: 'date', group: 'Visit' },
  { key: 'clientName', label: 'Client', type: 'text', group: 'Client' },
  { key: 'branchName', label: 'Client branch', type: 'text', group: 'Client' },
  { key: 'careTypeName', label: 'Care type (department)', type: 'text', group: 'Client' },
  { key: 'referralSourceName', label: 'Referral source', type: 'text', group: 'Client' },
  { key: 'payerName', label: 'Payer', type: 'text', group: 'Client' },
  { key: 'caregiverName', label: 'Caregiver', type: 'text', group: 'Caregiver' },
  { key: 'caregiverBranchName', label: 'Caregiver branch', type: 'text', group: 'Caregiver' },
  { key: 'team', label: 'Team', type: 'text', group: 'Caregiver' },
  { key: 'caregiverDepartment', label: 'Caregiver department', type: 'text', group: 'Caregiver' },
  { key: 'scheduledStart', label: 'Scheduled start', type: 'time', group: 'Schedule' },
  { key: 'scheduledEnd', label: 'Scheduled end', type: 'time', group: 'Schedule' },
  { key: 'scheduledMinutes', label: 'Scheduled minutes', type: 'minutes', group: 'Schedule' },
  { key: 'isTraining', label: 'Training visit', type: 'bool', group: 'Schedule' },
  { key: 'clockIn', label: 'Clock in', type: 'time', group: 'Clock' },
  { key: 'clockOut', label: 'Clock out', type: 'time', group: 'Clock' },
  { key: 'clockedMinutes', label: 'Clocked minutes', type: 'minutes', group: 'Clock' },
  { key: 'minutesLateIn', label: 'Minutes late clocking in', type: 'number', group: 'Clock' },
  { key: 'minutesLateOut', label: 'Minutes late clocking out', type: 'number', group: 'Clock' },
  { key: 'onTime', label: 'On time', type: 'bool', group: 'Clock' },
  { key: 'needsApproval', label: 'Needs approval', type: 'bool', group: 'Clock' },
  { key: 'approvalReason', label: 'Why it needs approval', type: 'text', group: 'Clock' },
  { key: 'payableMinutes', label: 'Payable minutes', type: 'minutes', group: 'Payroll', payroll: true },
  { key: 'payrollStatus', label: 'Payroll status', type: 'text', group: 'Payroll', payroll: true },
  { key: 'billedCents', label: 'Invoiced amount', type: 'cents', group: 'Billing' },
  { key: 'billedHours', label: 'Invoiced hours', type: 'number', group: 'Billing' },
  { key: 'signed', label: 'Client signed', type: 'bool', group: 'Care' },
  { key: 'unsignedReason', label: 'Why not signed', type: 'text', group: 'Care' },
  { key: 'tasksDone', label: 'Tasks done', type: 'number', group: 'Care' },
  { key: 'tasksSkipped', label: 'Tasks skipped', type: 'number', group: 'Care' },
  { key: 'formsDone', label: 'Forms completed', type: 'number', group: 'Care' },
  { key: 'formsMissed', label: 'Forms not completed', type: 'number', group: 'Care' },
  { key: 'adlsRecorded', label: 'ADLs recorded', type: 'number', group: 'Care' },
  { key: 'clientRating', label: 'Client rating', type: 'number', group: 'Care' },
  { key: 'visitNote', label: 'Visit note', type: 'text', group: 'Care' },
]
const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]))
export const fieldLabel = (key: string) => FIELD_BY_KEY.get(key)?.label ?? key

export type FilterOp = 'is' | 'is_not' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'not_empty' | 'one_of'
export const FILTER_OPS: { op: FilterOp; label: string; types: FieldType[]; needsValue: boolean }[] = [
  { op: 'is', label: 'is', types: ['text', 'number', 'date', 'time', 'bool', 'cents', 'minutes'], needsValue: true },
  { op: 'is_not', label: 'is not', types: ['text', 'number', 'date', 'time', 'bool', 'cents', 'minutes'], needsValue: true },
  { op: 'contains', label: 'contains', types: ['text'], needsValue: true },
  { op: 'gt', label: 'is more than', types: ['number', 'date', 'time', 'cents', 'minutes'], needsValue: true },
  { op: 'gte', label: 'is at least', types: ['number', 'date', 'time', 'cents', 'minutes'], needsValue: true },
  { op: 'lt', label: 'is less than', types: ['number', 'date', 'time', 'cents', 'minutes'], needsValue: true },
  { op: 'lte', label: 'is at most', types: ['number', 'date', 'time', 'cents', 'minutes'], needsValue: true },
  { op: 'empty', label: 'is empty', types: ['text', 'number', 'date', 'time', 'cents', 'minutes'], needsValue: false },
  { op: 'not_empty', label: 'is not empty', types: ['text', 'number', 'date', 'time', 'cents', 'minutes'], needsValue: false },
  { op: 'one_of', label: 'is one of (comma list)', types: ['text'], needsValue: true },
]
export interface Filter { field: string; op: FilterOp; value?: string | number | boolean | null }
export interface Definition { name: string; description?: string | null; columns: string[]; filters: Filter[]; sortBy?: string | null; sortDir?: 'asc' | 'desc' | null; groupBy?: string | null }

/** The standard library: reports the office copies and edits. Keys are stable (copiedFromId). */
export const LIBRARY: (Definition & { key: string })[] = [
  { key: 'late_clock_ins', name: 'Late clock-ins', description: `Visits clocked in more than ${ON_TIME_GRACE_MINUTES} minutes after the scheduled start`, columns: ['date', 'caregiverName', 'clientName', 'scheduledStart', 'clockIn', 'minutesLateIn'], filters: [{ field: 'minutesLateIn', op: 'gt', value: ON_TIME_GRACE_MINUTES }], sortBy: 'minutesLateIn', sortDir: 'desc' },
  { key: 'unsigned_visits', name: 'Visits without a client signature', description: 'Visits the client did not sign, with the reason', columns: ['date', 'clientName', 'caregiverName', 'unsignedReason'], filters: [{ field: 'signed', op: 'is', value: false }], sortBy: 'date', sortDir: 'desc' },
  { key: 'tasks_skipped', name: 'Skipped tasks', description: 'Visits where a task was skipped or refused', columns: ['date', 'clientName', 'caregiverName', 'tasksDone', 'tasksSkipped'], filters: [{ field: 'tasksSkipped', op: 'gt', value: 0 }], sortBy: 'tasksSkipped', sortDir: 'desc' },
  { key: 'forms_missed', name: 'Forms not completed', description: 'Visits with a required form left undone', columns: ['date', 'clientName', 'caregiverName', 'formsDone', 'formsMissed'], filters: [{ field: 'formsMissed', op: 'gt', value: 0 }], sortBy: 'date', sortDir: 'desc' },
  { key: 'hours_by_payer', name: 'Visits by payer', description: 'Every visit grouped by the client\'s payer, with clocked and payable minutes', columns: ['payerName', 'clientName', 'date', 'clockedMinutes', 'payableMinutes'], filters: [], groupBy: 'payerName', sortBy: 'date' },
  { key: 'hours_by_branch', name: 'Visits by branch', description: 'Every visit grouped by the client\'s branch', columns: ['branchName', 'clientName', 'caregiverName', 'date', 'clockedMinutes'], filters: [], groupBy: 'branchName', sortBy: 'date' },
  { key: 'needs_approval', name: 'Punches awaiting approval', description: 'Visits the office still has to approve, and why', columns: ['date', 'caregiverName', 'clientName', 'clockIn', 'clockOut', 'approvalReason'], filters: [{ field: 'needsApproval', op: 'is', value: true }], sortBy: 'date' },
  { key: 'low_ratings', name: 'Low client ratings', description: 'Visits the client rated 3 or less', columns: ['date', 'clientName', 'caregiverName', 'clientRating', 'visitNote'], filters: [{ field: 'clientRating', op: 'lte', value: 3 }], sortBy: 'clientRating' },
  { key: 'invoiced_visits', name: 'Invoiced visits', description: 'Every visit an invoice line carries, with the amount', columns: ['date', 'clientName', 'payerName', 'billedHours', 'billedCents'], filters: [{ field: 'billedCents', op: 'not_empty' }], sortBy: 'date' },
]

/** A raw visit row (camelCase from SQL) as the report sees it: labels for codes, cents for money, an on-time flag. */
export function shapeRow(r: any, grace = ON_TIME_GRACE_MINUTES) {
  const late = r.minutesLateIn === null || r.minutesLateIn === undefined ? null : Number(r.minutesLateIn)
  return {
    visitId: String(r.visitId), date: String(r.date).slice(0, 10),
    clientId: String(r.clientId), clientName: `${r.clientFirst ?? ''} ${r.clientLast ?? ''}`.trim(),
    caregiverId: String(r.caregiverId), caregiverName: `${r.caregiverFirst ?? ''} ${r.caregiverLast ?? ''}`.trim(),
    branchName: r.branchName ?? null, caregiverBranchName: r.caregiverBranchName ?? null, team: r.team ?? null, caregiverDepartment: r.caregiverDepartment ?? null,
    careTypeName: r.careTypeName ?? null, referralSourceName: r.referralSourceName ?? null, payerName: r.payerName ?? null,
    scheduledStart: r.scheduledStart ?? null, scheduledEnd: r.scheduledEnd ?? null, scheduledMinutes: r.scheduledMinutes === null || r.scheduledMinutes === undefined ? null : Number(r.scheduledMinutes),
    isTraining: !!r.isTraining, clockIn: r.clockIn ?? null, clockOut: r.clockOut ?? null, clockedMinutes: r.clockedMinutes === null || r.clockedMinutes === undefined ? null : Number(r.clockedMinutes),
    minutesLateIn: late, minutesLateOut: r.minutesLateOut === null || r.minutesLateOut === undefined ? null : Number(r.minutesLateOut),
    onTime: late === null ? null : Math.abs(late) <= grace,
    needsApproval: !!r.needsApproval, approvalReason: approvalLabel(r.approvalReason ?? null),
    payableMinutes: r.payableMinutes === null || r.payableMinutes === undefined ? null : Number(r.payableMinutes),
    payrollStatus: r.payrollStatus ? (PAYROLL_STATUS_LABELS[r.payrollStatus] ?? r.payrollStatus) : null,
    billedCents: r.billedAmount === null || r.billedAmount === undefined ? null : Math.round(Number(r.billedAmount) * 100),
    billedHours: r.billedHours === null || r.billedHours === undefined ? null : Number(r.billedHours),
    signed: !!r.signed, unsignedReason: r.signed ? null : (r.unsignedReason ? signatureReasonLabel(r.unsignedReason) : null),
    tasksDone: Number(r.tasksDone) || 0, tasksSkipped: Number(r.tasksSkipped) || 0, formsDone: Number(r.formsDone) || 0, formsMissed: Number(r.formsMissed) || 0, adlsRecorded: Number(r.adlsRecorded) || 0,
    clientRating: r.clientRating === null || r.clientRating === undefined ? null : Number(r.clientRating),
    visitNote: r.visitNote ?? null,
  }
}
export type VisitRow = ReturnType<typeof shapeRow>

const empty = (v: unknown) => v === null || v === undefined || v === ''
const asNumber = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
/** A filter's value as the field's type reads it (money typed in dollars becomes cents). */
function typed(field: Field | undefined, v: unknown): unknown {
  if (!field) return v
  if (field.type === 'bool') return v === true || v === 'true' || v === 'yes' || v === 1 || v === '1'
  if (field.type === 'cents') { const n = asNumber(v); return n === null ? null : Math.round(n * 100) }
  if (field.type === 'number' || field.type === 'minutes') return asNumber(v)
  return v === null || v === undefined ? null : String(v)
}
const compare = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}
/** Does one row pass one filter? */
export function passes(row: Record<string, unknown>, f: Filter): boolean {
  const field = FIELD_BY_KEY.get(f.field)
  const v = row[f.field]
  switch (f.op) {
    case 'empty': return empty(v)
    case 'not_empty': return !empty(v)
    case 'is': return field?.type === 'bool' ? !!v === typed(field, f.value) : !empty(v) && compare(v, typed(field, f.value)) === 0
    case 'is_not': return field?.type === 'bool' ? !!v !== typed(field, f.value) : empty(v) || compare(v, typed(field, f.value)) !== 0
    case 'contains': return !empty(v) && String(v).toLowerCase().includes(String(f.value ?? '').toLowerCase())
    case 'gt': return !empty(v) && compare(v, typed(field, f.value)) > 0
    case 'gte': return !empty(v) && compare(v, typed(field, f.value)) >= 0
    case 'lt': return !empty(v) && compare(v, typed(field, f.value)) < 0
    case 'lte': return !empty(v) && compare(v, typed(field, f.value)) <= 0
    case 'one_of': return !empty(v) && String(f.value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(String(v).toLowerCase())
    default: return true
  }
}

/** A definition checked: known fields, known rules, a value where the rule needs one. A problem names the box. */
export function checkDefinition(raw: any): { def: Definition } | { problem: string; fields?: Record<string, string> } {
  const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 120) : ''
  if (!name) return { problem: 'Give the report a name.', fields: { name: 'Name the report' } }
  const columns = Array.isArray(raw.columns) ? raw.columns.map(String).filter((k: string) => FIELD_BY_KEY.has(k)) : []
  if (!columns.length) return { problem: 'Pick at least one column.', fields: { columns: 'Pick a column' } }
  const filters: Filter[] = []
  for (const f of Array.isArray(raw.filters) ? raw.filters : []) {
    const field = FIELD_BY_KEY.get(String(f?.field))
    const rule = FILTER_OPS.find((o) => o.op === f?.op)
    if (!field || !rule) return { problem: 'A filter names a field or a rule that does not exist.', fields: { filters: 'Check the filters' } }
    if (!rule.types.includes(field.type)) return { problem: `"${rule.label}" does not apply to ${field.label}.`, fields: { filters: `${field.label}: pick another rule` } }
    if (rule.needsValue && empty(f.value)) return { problem: `The filter on ${field.label} needs a value.`, fields: { filters: `${field.label}: enter a value` } }
    filters.push({ field: field.key, op: rule.op, value: rule.needsValue ? f.value : null })
  }
  const sortBy = raw.sortBy && FIELD_BY_KEY.has(String(raw.sortBy)) ? String(raw.sortBy) : null
  const groupBy = raw.groupBy && FIELD_BY_KEY.has(String(raw.groupBy)) ? String(raw.groupBy) : null
  return { def: { name, description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 500) || null : null, columns, filters, sortBy, sortDir: raw.sortDir === 'desc' ? 'desc' : 'asc', groupBy } }
}

/** Run a definition over rows (pure): filter, sort, group; numeric columns are summed per group and in total. */
export function applyDefinition(rows: VisitRow[], def: Definition) {
  let out = rows.filter((r) => def.filters.every((f) => passes(r as any, f)))
  if (def.sortBy) {
    const k = def.sortBy, dir = def.sortDir === 'desc' ? -1 : 1
    out = [...out].sort((a: any, b: any) => (empty(a[k]) ? 1 : empty(b[k]) ? -1 : compare(a[k], b[k]) * dir))
  }
  const numeric = def.columns.filter((k) => ['number', 'cents', 'minutes'].includes(FIELD_BY_KEY.get(k)?.type ?? ''))
  const sums = (list: any[]) => Object.fromEntries(numeric.map((k) => [k, list.reduce((t, r) => t + (Number(r[k]) || 0), 0)]))
  const groups = def.groupBy ? (() => {
    const m = new Map<string, any[]>()
    for (const r of out) { const k = empty((r as any)[def.groupBy!]) ? '' : String((r as any)[def.groupBy!]); m.set(k, [...(m.get(k) ?? []), r]) }
    return [...m].map(([key, list]) => ({ key: key || null, label: key || `No ${fieldLabel(def.groupBy!).toLowerCase()}`, rows: list.length, sums: sums(list) })).sort((a, b) => b.rows - a.rows)
  })() : null
  return { rows: out.map((r: any) => Object.fromEntries(['visitId', ...def.columns].map((k) => [k, r[k] ?? null]))), count: out.length, sums: sums(out), groups, columns: def.columns.map((k) => ({ key: k, label: fieldLabel(k), type: FIELD_BY_KEY.get(k)?.type ?? 'text' })) }
}

export interface Tile { kind: string; title?: string; days?: number; by?: 'week' | 'month' }
/** The tiles a custom dashboard can carry — each a figure or a chart the fixed dashboards also draw. */
export const TILES: { kind: string; label: string; needs: 'billing' | 'hr' | 'both' }[] = [
  { kind: 'margin_total', label: 'Profit margin (billed, cost, margin)', needs: 'both' },
  { kind: 'margin_by_branch', label: 'Profit margin by branch (location)', needs: 'both' },
  { kind: 'margin_by_referral_source', label: 'Profit margin by referral source', needs: 'both' },
  { kind: 'margin_by_payer', label: 'Profit margin by payer', needs: 'both' },
  { kind: 'margin_trend', label: 'Margin trend', needs: 'both' },
  { kind: 'invoiced_by_month', label: 'Invoiced, collected and payroll by month', needs: 'billing' },
  { kind: 'receivables', label: 'Receivables (owed now)', needs: 'billing' },
  { kind: 'authorization_summary', label: 'Authorization utilisation', needs: 'billing' },
  { kind: 'turnover', label: 'Caregiver turnover', needs: 'hr' },
  { kind: 'workforce', label: 'Workload and underused staff', needs: 'hr' },
  { kind: 'cancellation_trend', label: 'Cancellations by week', needs: 'hr' },
  { kind: 'performance_summary', label: 'Caregiver performance (on time, missed, forms)', needs: 'hr' },
  { kind: 'daily_manager', label: 'Today at a glance', needs: 'billing' },
  { kind: 'retention', label: 'Retention: satisfaction and at-risk caregivers', needs: 'hr' },
]

/** A custom dashboard's tiles, checked: known kinds only, at most 12, a window of at most 400 days. */
export function checkTiles(raw: any): { tiles: Tile[] } | { problem: string } {
  const list = Array.isArray(raw) ? raw : []
  if (!list.length) return { problem: 'Add at least one tile.' }
  if (list.length > 12) return { problem: 'A dashboard holds at most 12 tiles.' }
  const tiles: Tile[] = []
  for (const t of list) {
    if (!TILES.some((x) => x.kind === t?.kind)) return { problem: 'A tile is of a kind that does not exist.' }
    tiles.push({ kind: String(t.kind), title: typeof t.title === 'string' && t.title.trim() ? t.title.trim().slice(0, 80) : undefined, days: Number.isFinite(Number(t.days)) && Number(t.days) > 0 ? Math.min(MAX_WINDOW_DAYS, Math.round(Number(t.days))) : undefined, by: t.by === 'month' ? 'month' : t.by === 'week' ? 'week' : undefined })
  }
  return { tiles }
}

export function createReportBuilder(d: CrmDeps, deps: { time: AgencyTime; margin: Margin; retention?: { dashboardTile: (companyId: string, today: string) => Promise<any> } }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, REPORT_BUILDER_FEATURE)

  // ── the builder ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function rowsFor(companyId: string, start: string, end: string): Promise<VisitRow[]> {
    const tz = await deps.time.timezone(companyId)
    return (await visitRows(d.db, companyId, start, end, tz)).map((r) => shapeRow(r))
  }
  /** Run a definition over the window. `payroll` false strips the pay fields (for a reader without care-payroll:read). */
  async function run(companyId: string, def: Definition, start: string, end: string, payroll: boolean) {
    const use = payroll ? def : { ...def, columns: def.columns.filter((k) => !FIELD_BY_KEY.get(k)?.payroll), filters: def.filters.filter((f) => !FIELD_BY_KEY.get(f.field)?.payroll) }
    return { period: { start, end }, ...applyDefinition(await rowsFor(companyId, start, end), use) }
  }
  const mine = (companyId: string, id: string) => and(eq(reportDefinition.companyId, companyId), eq(reportDefinition.id, id))
  const list = (companyId: string) => d.db.select().from(reportDefinition).where(eq(reportDefinition.companyId, companyId)).orderBy(reportDefinition.name)
  const get = async (companyId: string, id: string) => (await d.db.select().from(reportDefinition).where(mine(companyId, id)).limit(1))[0] ?? null
  async function save(companyId: string, by: string, def: Definition, copiedFromId: string | null = null) {
    const [row] = await d.db.insert(reportDefinition).values({ companyId, createdById: by, name: def.name, description: def.description ?? null, columns: def.columns, filters: def.filters, sortBy: def.sortBy ?? null, sortDir: def.sortDir ?? 'asc', groupBy: def.groupBy ?? null, copiedFromId }).returning()
    return row
  }
  async function update(companyId: string, id: string, def: Definition) {
    const [row] = await d.db.update(reportDefinition).set({ name: def.name, description: def.description ?? null, columns: def.columns, filters: def.filters, sortBy: def.sortBy ?? null, sortDir: def.sortDir ?? 'asc', groupBy: def.groupBy ?? null, updatedAt: new Date() }).where(mine(companyId, id)).returning()
    return row ?? null
  }
  const remove = (companyId: string, id: string) => d.db.delete(reportDefinition).where(mine(companyId, id))
  /** A copy of a saved report, or of a library report, under a new name ("… (copy)"). */
  async function copy(companyId: string, by: string, from: { id?: string; libraryKey?: string }) {
    if (from.libraryKey) {
      const lib = LIBRARY.find((l) => l.key === from.libraryKey)
      if (!lib) return null
      return save(companyId, by, { ...lib, name: lib.name }, lib.key)
    }
    const src = from.id ? await get(companyId, from.id) : null
    if (!src) return null
    return save(companyId, by, { name: `${src.name} (copy)`, description: src.description, columns: src.columns as string[], filters: src.filters as Filter[], sortBy: src.sortBy, sortDir: (src.sortDir as any) ?? 'asc', groupBy: src.groupBy }, src.id)
  }
  const asDefinition = (row: any): Definition => ({ name: row.name, description: row.description, columns: row.columns as string[], filters: (row.filters ?? []) as Filter[], sortBy: row.sortBy, sortDir: row.sortDir ?? 'asc', groupBy: row.groupBy })

  // ── workforce, performance, daily manager ─────────────────────────────────────────────────────────────────────────────────
  /** Workload per caregiver against what they want and will do; who is underused; cancellations by week and by reason. */
  async function workforce(companyId: string, start: string, end: string) {
    const tz = await deps.time.timezone(companyId)
    const [people, weeks, sched, cancels, missed] = await Promise.all([
      caregiverCapacity(d.db, companyId), clockedHoursByCaregiverWeek(d.db, companyId, start, end, tz), scheduledByCaregiver(d.db, companyId, start, end), cancelledVisits(d.db, companyId, start, end), missedVisits(d.db, companyId, start, end),
    ])
    const spanWeeks = Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1) / 7)
    const byCg = new Map<string, { hours: number; visits: number }>()
    for (const w of weeks) { const k = String(w.caregiverId); const cur = byCg.get(k) ?? { hours: 0, visits: 0 }; byCg.set(k, { hours: cur.hours + Number(w.hours), visits: cur.visits + Number(w.visits) }) }
    const schedBy = new Map(sched.map((s: any) => [String(s.caregiverId), { visits: Number(s.visits), hours: Number(s.hours) }]))
    const callouts = new Map<string, number>()
    for (const c of cancels) if (c.cancelReason === 'caregiver_callout' && c.caregiverId) callouts.set(String(c.caregiverId), (callouts.get(String(c.caregiverId)) ?? 0) + 1)
    const missedBy = new Map(missed.map((m: any) => [String(m.caregiverId), Number(m.missed)]))
    const caregivers = people.map((p: any) => {
      const id = String(p.id), worked = byCg.get(id) ?? { hours: 0, visits: 0 }
      const perWeek = Math.round((worked.hours / spanWeeks) * 10) / 10
      const wanted = p.hoursWanted === null || p.hoursWanted === undefined ? null : Number(p.hoursWanted)
      const max = p.maxHoursPerWeek === null || p.maxHoursPerWeek === undefined ? null : Number(p.maxHoursPerWeek)
      // Underused: a quarter or more under the hours they asked for (or under half the most they will do, when they named no wish).
      const underused = wanted !== null && wanted > 0 ? perWeek < wanted * 0.75 : max !== null && max > 0 ? perWeek < max * 0.5 : false
      const overloaded = max !== null && max > 0 && perWeek > max
      return {
        caregiverId: id, name: `${p.firstName} ${p.lastName}`.trim(), branchName: p.branchName ?? null, team: p.team ?? null, managerName: p.managerFirst ? `${p.managerFirst} ${p.managerLast ?? ''}`.trim() : null,
        hoursWorked: Math.round(worked.hours * 100) / 100, hoursPerWeek: perWeek, hoursWanted: wanted, maxHoursPerWeek: max, visitsWorked: worked.visits,
        visitsScheduled: schedBy.get(id)?.visits ?? 0, hoursScheduled: schedBy.get(id)?.hours ?? 0,
        utilisationPercent: max ? Math.round((perWeek / max) * 1000) / 10 : null, underused, overloaded,
        callouts: callouts.get(id) ?? 0, missedVisits: missedBy.get(id) ?? 0,
        status: overloaded ? 'Over their most hours' : underused ? 'Underused' : wanted === null && max === null ? 'No hours set' : 'As wanted',
      }
    }).sort((a, b) => Number(b.underused) - Number(a.underused) || a.hoursPerWeek - b.hoursPerWeek)
    const weekKeys = [...new Set(cancels.map((c: any) => { const dt = String(c.date); const dow = new Date(`${dt}T12:00:00Z`).getUTCDay(); return addDays(dt, -dow) }))].sort()
    const cancellationTrend = weekKeys.map((week) => {
      const inWeek = cancels.filter((c: any) => { const dt = String(c.date); return addDays(dt, -new Date(`${dt}T12:00:00Z`).getUTCDay()) === week })
      const byReason: Record<string, number> = {}
      for (const c of inWeek) { const l = CANCEL_REASONS[c.cancelReason] ?? 'Not given'; byReason[l] = (byReason[l] ?? 0) + 1 }
      return { week, cancelled: inWeek.length, byCaregiver: inWeek.filter((c: any) => c.cancelReason === 'caregiver_callout').length, byClient: inWeek.filter((c: any) => c.cancelReason && c.cancelReason.startsWith('client_')).length, byReason }
    })
    return {
      period: { start, end }, weeks: spanWeeks, caregivers,
      summary: {
        caregivers: caregivers.length, underused: caregivers.filter((c) => c.underused).length, overloaded: caregivers.filter((c) => c.overloaded).length,
        hoursWorked: Math.round(caregivers.reduce((t, c) => t + c.hoursWorked, 0) * 100) / 100, hoursWanted: caregivers.reduce((t, c) => t + (c.hoursWanted ?? 0), 0) * spanWeeks,
        cancelled: cancels.length, cancelledByCaregiver: cancels.filter((c: any) => c.cancelReason === 'caregiver_callout').length,
      },
      cancellationTrend,
    }
  }

  /** Per caregiver: late clock-ins and clock-outs, visits completed / missed / cancelled, task (ADL) and form completion, client ratings. */
  async function performance(companyId: string, start: string, end: string, filters: { caregiverId?: string | null } = {}) {
    const [rows, cancels, missed, sched] = await Promise.all([rowsFor(companyId, start, end), cancelledVisits(d.db, companyId, start, end), missedVisits(d.db, companyId, start, end), scheduledByCaregiver(d.db, companyId, start, end)])
    const ids = new Set<string>([...rows.map((r) => r.caregiverId), ...missed.map((m: any) => String(m.caregiverId)), ...cancels.filter((c: any) => c.cancelReason === 'caregiver_callout' && c.caregiverId).map((c: any) => String(c.caregiverId))])
    const names = new Map<string, string>()
    for (const r of rows) names.set(r.caregiverId, r.caregiverName)
    for (const c of cancels) if (c.caregiverId && !names.has(String(c.caregiverId))) names.set(String(c.caregiverId), `${c.caregiverFirst ?? ''} ${c.caregiverLast ?? ''}`.trim())
    const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : null)
    const out = [...ids].filter((id) => !filters.caregiverId || id === filters.caregiverId).map((id) => {
      const mine = rows.filter((r) => r.caregiverId === id)
      const matched = mine.filter((r) => r.minutesLateIn !== null)
      const lateIn = matched.filter((r) => (r.minutesLateIn as number) > ON_TIME_GRACE_MINUTES).length
      const lateOut = mine.filter((r) => r.minutesLateOut !== null && (r.minutesLateOut as number) > ON_TIME_GRACE_MINUTES).length
      const onTime = matched.filter((r) => r.onTime).length
      const tasks = mine.reduce((t, r) => t + r.tasksDone + r.tasksSkipped, 0), tasksDone = mine.reduce((t, r) => t + r.tasksDone, 0)
      const forms = mine.reduce((t, r) => t + r.formsDone + r.formsMissed, 0), formsDone = mine.reduce((t, r) => t + r.formsDone, 0)
      const rated = mine.filter((r) => r.clientRating !== null)
      const cancelled = cancels.filter((c: any) => String(c.caregiverId) === id && c.cancelReason === 'caregiver_callout').length
      const missedN = Number(missed.find((m: any) => String(m.caregiverId) === id)?.missed ?? 0)
      const s = sched.find((x: any) => String(x.caregiverId) === id)
      return {
        caregiverId: id, name: names.get(id) ?? 'Caregiver',
        visitsScheduled: s ? Number(s.visits) : 0, visitsCompleted: mine.length, visitsMissed: missedN, visitsCancelled: cancelled,
        lateClockIns: lateIn, lateClockOuts: lateOut, onTimePercent: pct(onTime, matched.length), unscheduledVisits: mine.length - matched.length,
        signedPercent: pct(mine.filter((r) => r.signed).length, mine.length),
        tasksDone, tasksSkipped: tasks - tasksDone, adlCompletionPercent: pct(tasksDone, tasks),
        formsDone, formsMissed: forms - formsDone, formCompletionPercent: pct(formsDone, forms),
        adlsRecorded: mine.reduce((t, r) => t + r.adlsRecorded, 0),
        averageRating: rated.length ? Math.round((rated.reduce((t, r) => t + (r.clientRating as number), 0) / rated.length) * 10) / 10 : null, ratings: rated.length,
        hoursWorked: Math.round(mine.reduce((t, r) => t + (r.clockedMinutes ?? 0), 0) / 60 * 100) / 100,
      }
    }).sort((a, b) => (a.onTimePercent ?? 101) - (b.onTimePercent ?? 101) || b.visitsMissed - a.visitsMissed)
    return { period: { start, end }, graceMinutes: ON_TIME_GRACE_MINUTES, caregivers: out, totals: { visitsCompleted: rows.length, visitsMissed: out.reduce((t, c) => t + c.visitsMissed, 0), visitsCancelled: out.reduce((t, c) => t + c.visitsCancelled, 0), lateClockIns: out.reduce((t, c) => t + c.lateClockIns, 0) } }
  }

  /** The daily manager report for one agency day (today unless asked): the day's counts, the visits never clocked, the day's money. */
  async function dailyManager(companyId: string, date: string, opts: { money: boolean }) {
    const tz = await deps.time.timezone(companyId)
    const [counts, unclocked] = await Promise.all([dayCounts(d.db, companyId, date, tz, ON_TIME_GRACE_MINUTES), dayUnclocked(d.db, companyId, date, tz)])
    const n = (k: string) => Number((counts as any)[k]) || 0
    const money = opts.money ? await deps.margin.visitMargin(companyId, date, date) : null
    return {
      date,
      visits: { scheduled: n('scheduled'), scheduledHours: n('scheduledHours'), unassigned: n('unassigned'), completed: n('completed'), inProgress: n('inProgress'), clockedHours: n('clockedHours'), lateClockIns: n('lateClockIns'), missed: n('missed'), missedStillOpen: n('missedOpen'), cancelled: n('cancelled'), caregiverCallouts: n('caregiverCallouts'), notClocked: unclocked.length },
      attention: { openShiftsUnfilled: n('openShiftsUnfilled'), incidents: n('incidents'), newApplicants: n('newApplicants'), familyRequestsOpen: n('familyRequestsOpen'), punchesAwaitingApproval: n('punchesAwaitingApproval'), authorizationsEndingIn14Days: n('authorizationsEndingIn14Days'), credentialsExpiringIn14Days: n('credentialsExpiringIn14Days') },
      notClocked: unclocked.map((u: any) => ({ scheduleId: String(u.scheduleId), start: u.start, end: u.end, caregiverName: u.caregiverFirst ? `${u.caregiverFirst} ${u.caregiverLast ?? ''}`.trim() : 'Nobody assigned', clientName: `${u.clientFirst ?? ''} ${u.clientLast ?? ''}`.trim() })),
      money: money ? { visits: money.totals.visits, hours: money.totals.hours, billedCents: money.totals.billedCents, payCents: money.totals.payCents, marginCents: money.totals.marginCents, visitsWithoutRate: money.totals.visitsWithoutRate } : null,
    }
  }

  // ── dashboards ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function authorizationDashboard(companyId: string, today: string) {
    const rows = (await authorizationUtilisation(d.db, companyId, today)).map((a: any) => {
      const authorized = Number(a.authorizedUnits) || 0
      const unit = String(a.unitType || '15min').toLowerCase()
      const perHour = ['15min', '15-min', '15_min', 'unit', 'units', 'quarter_hour'].includes(unit) ? 4 : ['hours', 'hour', 'hourly', 'hr', 'hrs'].includes(unit) ? 1 : null
      const fromVisits = perHour ? Math.round((Number(a.payableMinutesInWindow) / 60) * perHour * 100) / 100 : null
      const used = Math.max(Number(a.usedUnits) || 0, fromVisits ?? 0)
      const daysIn = Math.max(0, Number(a.daysIn)), daysLeft = Number(a.daysLeft)
      const total = daysIn + Math.max(daysLeft, 0)
      const expectedPercent = total > 0 ? Math.round((daysIn / total) * 1000) / 10 : null
      const usedPercent = authorized > 0 ? Math.round((used / authorized) * 1000) / 10 : null
      return {
        id: String(a.id), clientId: String(a.clientId), clientName: `${a.clientFirst} ${a.clientLast}`.trim(), payerName: a.payerName ?? null, authNumber: a.authNumber ?? null, procedureCode: a.procedureCode ?? null,
        authorizedUnits: authorized, usedUnits: used, unitType: a.unitType, remainingUnits: Math.max(0, Math.round((authorized - used) * 100) / 100), usedPercent, expectedPercent,
        startDate: a.startDate, endDate: a.endDate, daysLeft,
        pace: usedPercent === null || expectedPercent === null ? 'Unknown' : usedPercent > expectedPercent + 10 ? 'Running out early' : usedPercent < expectedPercent - 10 ? 'Under-used' : 'On pace',
      }
    })
    return {
      authorizations: rows,
      summary: {
        active: rows.length, runningOutEarly: rows.filter((r) => r.pace === 'Running out early').length, underUsed: rows.filter((r) => r.pace === 'Under-used').length,
        endingIn30Days: rows.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 30).length, over80Percent: rows.filter((r) => (r.usedPercent ?? 0) >= 80).length,
        unitsAuthorized: rows.reduce((t, r) => t + r.authorizedUnits, 0), unitsUsed: Math.round(rows.reduce((t, r) => t + r.usedUnits, 0) * 100) / 100,
      },
    }
  }
  async function financialDashboard(companyId: string, today: string, days = 30) {
    const start = addDays(today, -(days - 1))
    const sixMonthsAgo = `${addDays(today, -150).slice(0, 7)}-01`
    const [margin, trend, months, receivables] = await Promise.all([deps.margin.clientMargin(companyId, start, today), deps.margin.trend(companyId, addDays(today, -83), today, 'week'), moneyByMonth(d.db, companyId, sixMonthsAgo, today), receivablesNow(d.db, companyId, today)])
    return {
      period: { start, end: today }, totals: margin.totals, byBranch: margin.byBranch, byReferralSource: margin.byReferralSource, byPayer: margin.byPayer, byDepartment: margin.byDepartment,
      trend: trend.points, months: months.map((m: any) => ({ month: m.month, invoicedCents: Number(m.invoicedCents), collectedCents: Number(m.collectedCents), payrollCents: Number(m.payrollCents) })),
      receivables: { currentCents: Number((receivables as any).currentCents) || 0, overCents: Number((receivables as any).overCents) || 0, over30Cents: Number((receivables as any).over30Cents) || 0, openInvoices: Number((receivables as any).openInvoices) || 0 },
    }
  }
  async function caregiverDashboard(companyId: string, today: string, days = 30) {
    const start = addDays(today, -(days - 1))
    const [turnover, wf, perf, retention] = await Promise.all([deps.margin.turnover(companyId, addDays(today, -89), today, today), workforce(companyId, start, today), performance(companyId, start, today), deps.retention ? deps.retention.dashboardTile(companyId, today) : Promise.resolve(null)])
    const onTime = perf.caregivers.filter((c) => c.onTimePercent !== null)
    return {
      period: { start, end: today },
      headcount: turnover.headcountEnd, turnover90Days: { hires: turnover.hires, departures: turnover.departures, turnoverPercent: turnover.turnoverPercent, retentionPercent: turnover.retentionPercent, ninetyDayRetentionPercent: turnover.ninetyDayRetentionPercent },
      workforce: wf.summary, underused: wf.caregivers.filter((c) => c.underused).slice(0, 10), cancellationTrend: wf.cancellationTrend,
      performance: { ...perf.totals, averageOnTimePercent: onTime.length ? Math.round((onTime.reduce((t, c) => t + (c.onTimePercent as number), 0) / onTime.length) * 10) / 10 : null, lowestOnTime: perf.caregivers.slice(0, 5) },
      retention,
    }
  }
  /** One custom tile's data. `may` says what the reader holds, so a tile they may not see answers withheld, never an error. */
  async function tile(companyId: string, today: string, t: Tile, may: { billing: boolean; hr: boolean; payroll: boolean }) {
    const spec = TILES.find((x) => x.kind === t.kind)
    if (!spec) return { kind: t.kind, title: t.title ?? t.kind, withheld: 'unknown' }
    const allowed = spec.needs === 'both' ? may.billing && may.payroll : spec.needs === 'billing' ? may.billing : may.hr
    const title = t.title ?? spec.label
    if (!allowed) return { kind: t.kind, title, withheld: 'permission' }
    const days = Math.min(MAX_WINDOW_DAYS, Math.max(1, Number(t.days) || 30))
    const start = addDays(today, -(days - 1))
    switch (t.kind) {
      case 'margin_total': { const m = await deps.margin.clientMargin(companyId, start, today); return { kind: t.kind, title, period: m.period, totals: m.totals } }
      case 'margin_by_branch': { const m = await deps.margin.clientMargin(companyId, start, today); return { kind: t.kind, title, period: m.period, groups: m.byBranch } }
      case 'margin_by_referral_source': { const m = await deps.margin.clientMargin(companyId, start, today); return { kind: t.kind, title, period: m.period, groups: m.byReferralSource } }
      case 'margin_by_payer': { const m = await deps.margin.clientMargin(companyId, start, today); return { kind: t.kind, title, period: m.period, groups: m.byPayer } }
      case 'margin_trend': { const tr = await deps.margin.trend(companyId, start, today, t.by === 'month' ? 'month' : 'week'); return { kind: t.kind, title, period: tr.period, by: tr.by, points: tr.points } }
      case 'invoiced_by_month': { const f = await financialDashboard(companyId, today, days); return { kind: t.kind, title, months: f.months } }
      case 'receivables': { const f = await financialDashboard(companyId, today, 1); return { kind: t.kind, title, receivables: f.receivables } }
      case 'authorization_summary': { const a = await authorizationDashboard(companyId, today); return { kind: t.kind, title, summary: a.summary, authorizations: a.authorizations.filter((x) => x.pace !== 'On pace').slice(0, 10) } }
      case 'turnover': { const tv = await deps.margin.turnover(companyId, start, today, today); return { kind: t.kind, title, period: tv.period, headcountEnd: tv.headcountEnd, hires: tv.hires, departures: tv.departures, turnoverPercent: tv.turnoverPercent, retentionPercent: tv.retentionPercent, ninetyDayRetentionPercent: tv.ninetyDayRetentionPercent } }
      case 'workforce': { const w = await workforce(companyId, start, today); return { kind: t.kind, title, period: w.period, summary: w.summary, underused: w.caregivers.filter((c) => c.underused).slice(0, 10) } }
      case 'cancellation_trend': { const w = await workforce(companyId, start, today); return { kind: t.kind, title, period: w.period, points: w.cancellationTrend } }
      case 'performance_summary': { const p = await performance(companyId, start, today); return { kind: t.kind, title, period: p.period, totals: p.totals, caregivers: p.caregivers.slice(0, 10) } }
      case 'daily_manager': { const dm = await dailyManager(companyId, today, { money: may.billing && may.payroll }); return { kind: t.kind, title, ...dm } }
      case 'retention': return { kind: t.kind, title, ...(deps.retention ? await deps.retention.dashboardTile(companyId, today) : { withheld: 'feature' }) }
      default: return { kind: t.kind, title, withheld: 'unknown' }
    }
  }
  const dashMine = (companyId: string, id: string) => and(eq(dashboardLayout.companyId, companyId), eq(dashboardLayout.id, id))
  const dashboards = (companyId: string) => d.db.select().from(dashboardLayout).where(eq(dashboardLayout.companyId, companyId)).orderBy(desc(dashboardLayout.updatedAt))
  const dashboard = async (companyId: string, id: string) => (await d.db.select().from(dashboardLayout).where(dashMine(companyId, id)).limit(1))[0] ?? null
  async function saveDashboard(companyId: string, by: string, name: string, tiles: Tile[], id?: string) {
    if (id) { const [row] = await d.db.update(dashboardLayout).set({ name, tiles, updatedAt: new Date() }).where(dashMine(companyId, id)).returning(); return row ?? null }
    const [row] = await d.db.insert(dashboardLayout).values({ companyId, createdById: by, name, tiles }).returning()
    return row
  }
  const removeDashboard = (companyId: string, id: string) => d.db.delete(dashboardLayout).where(dashMine(companyId, id))

  return {
    enabled, rowsFor, run, list, get, save, update, remove, copy, asDefinition,
    workforce, performance, dailyManager, authorizationDashboard, financialDashboard, caregiverDashboard, tile,
    checkTiles, dashboards, dashboard, saveDashboard, removeDashboard,
  }
}
export type ReportBuilder = ReturnType<typeof createReportBuilder>
