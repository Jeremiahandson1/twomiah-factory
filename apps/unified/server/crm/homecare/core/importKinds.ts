// Row 8 (docs/parity/homecare-import.md, care_import_all): every other record kind an agency brings from its old system —
// authorizations, certifications and client credentials, medicine lists, pay rates, payers, important contacts, billing
// history, training, leave, journal entries, reviews and expenses. Each is a layout (importRows.ts FIELDS), a parent it
// hangs off (a client, a caregiver, a payer — named by name, email, our id or the old system's reference code), a
// duplicate rule (which columns make two rows the same record) and the row it writes. core/csvImport.ts runs them all the
// same way: preview, dry run, commit, update-in-place and undo. Pure except for the schema tables it names.
import { zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import {
  authorizations, certificationRecords, clientCredential, medications, caregiverRates, referralSources, clientEmergencyContacts,
  invoices, trainingRecords, caregiverTimeOff, clientVisitNotes, performanceRatings, expenses,
} from '../../../db/schema/index.ts'
import { centsToDecimal, type ImportKind } from './importRows.ts'

export type ParentEntity = 'client' | 'caregiver' | 'payer'

/** What a child row's references resolved to (set by csvImport.ts before the key and the row are built). */
export interface RowContext { clientId?: string | null; caregiverId?: string | null; payerId?: string | null; tz: string; today: string; userId: string }

export interface ChildKindSpec {
  kind: ImportKind
  /** The drizzle table and its SQL name. */
  table: any
  tableName: string
  /** The permission to import / undo it: the same as adding one by hand in that area. */
  permission: { create: string; delete: string }
  /** The reference field(s) a row must resolve: the first is required unless `optional`. */
  refs: Array<{ field: string; entity: ParentEntity; optional?: boolean }>
  /** The columns (camelCase) whose values make two rows the same record, and the key from a cleaned row. */
  keyColumns: string[]
  keyOf: (v: Record<string, any>, ctx: RowContext) => string | null
  /** The row to insert (camelCase, without companyId). */
  rowOf: (v: Record<string, any>, ctx: RowContext) => Record<string, any>
  /** field key → column (camelCase) the owner may let a re-import overwrite. */
  columns: Record<string, string>
  /** Columns in OTHER tables that point at this record: a record anything points at is kept on undo. */
  usedBy?: string[]
  label: (v: Record<string, any>) => string
}

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
/** A key from the parts, the way the data layer builds it from existing rows (every part as text, lower-cased). */
export const joinKey = (...parts: unknown[]) => parts.map((p) => (p === null || p === undefined ? '' : lower(p))).join('|')
const dec = (n: number | undefined) => (n === undefined ? undefined : centsToDecimal(n))
const noonOf = (ymd: string, tz: string) => zonedWallTimeToUtc(ymd, '12:00', tz)

export const CHILD_KINDS: ChildKindSpec[] = [
  {
    kind: 'authorizations', table: authorizations, tableName: 'authorizations',
    permission: { create: 'care-billing:create', delete: 'care-billing:delete' },
    refs: [{ field: 'clientRef', entity: 'client' }, { field: 'payerName', entity: 'payer', optional: true }],
    keyColumns: ['clientId', 'authNumber', 'procedureCode', 'startDate'],
    keyOf: (v, c) => joinKey(c.clientId, v.authNumber, v.procedureCode, v.startDate),
    rowOf: (v, c) => ({
      clientId: c.clientId, payerId: c.payerId ?? null, authNumber: v.authNumber ?? null, procedureCode: v.procedureCode ?? null, modifier: v.modifier ?? null,
      authorizedUnits: String(v.authorizedUnits), unitType: v.unitType ?? '15min', usedUnits: String(v.usedUnits ?? 0), startDate: v.startDate, endDate: v.endDate,
      status: v.status ?? 'active', notes: v.notes ?? null, importedFrom: 'import', createdById: c.userId,
    }),
    columns: { payerName: 'payerId', authNumber: 'authNumber', procedureCode: 'procedureCode', modifier: 'modifier', authorizedUnits: 'authorizedUnits', unitType: 'unitType', usedUnits: 'usedUnits', startDate: 'startDate', endDate: 'endDate', status: 'status', notes: 'notes' },
    usedBy: ['authorization_id'],
    label: (v) => `${v.clientRef ?? '?'} — ${v.authNumber || v.procedureCode || 'authorization'}`,
  },
  {
    kind: 'certifications', table: certificationRecords, tableName: 'certification_records',
    permission: { create: 'care-hr:create', delete: 'care-hr:delete' },
    refs: [{ field: 'caregiverRef', entity: 'caregiver' }],
    keyColumns: ['caregiverId', 'certificationType', 'expiryDate'],
    keyOf: (v, c) => joinKey(c.caregiverId, v.certificationType, v.expiryDate),
    rowOf: (v, c) => ({
      caregiverId: c.caregiverId, certificationType: v.certificationType, issuingBody: v.issuingBody ?? null, issueDate: v.issueDate ?? null, expiryDate: v.expiryDate ?? null,
      certificationNumber: v.certificationNumber ?? null, status: v.status ?? 'active',
    }),
    columns: { issuingBody: 'issuingBody', issueDate: 'issueDate', expiryDate: 'expiryDate', certificationNumber: 'certificationNumber', status: 'status' },
    usedBy: ['certification_record_id', 'certification_id'],
    label: (v) => `${v.caregiverRef ?? '?'} — ${v.certificationType ?? 'certification'}`,
  },
  {
    kind: 'clientCredentials', table: clientCredential, tableName: 'client_credential',
    permission: { create: 'care-clients:create', delete: 'care-clients:delete' },
    refs: [{ field: 'clientRef', entity: 'client' }],
    keyColumns: ['clientId', 'credentialType', 'expiryDate'],
    keyOf: (v, c) => joinKey(c.clientId, v.credentialType, v.expiryDate),
    rowOf: (v, c) => ({ clientId: c.clientId, credentialType: v.credentialType, issuingBody: v.issuingBody ?? null, issueDate: v.issueDate ?? null, expiryDate: v.expiryDate ?? null, status: v.status ?? 'active' }),
    columns: { issuingBody: 'issuingBody', issueDate: 'issueDate', expiryDate: 'expiryDate', status: 'status' },
    usedBy: ['client_credential_id'],
    label: (v) => `${v.clientRef ?? '?'} — ${v.credentialType ?? 'credential'}`,
  },
  {
    kind: 'medications', table: medications, tableName: 'medications',
    permission: { create: 'care-clients:create', delete: 'care-clients:delete' },
    refs: [{ field: 'clientRef', entity: 'client' }],
    keyColumns: ['clientId', 'name', 'dosage'],
    keyOf: (v, c) => joinKey(c.clientId, v.name, v.dosage),
    rowOf: (v, c) => ({
      clientId: c.clientId, name: v.name, dosage: v.dosage ?? null, frequency: v.frequency ?? null, route: v.route ?? null, indication: v.indication ?? null,
      prescribedBy: v.prescribedBy ?? null, pharmacy: v.pharmacy ?? null, rxNumber: v.rxNumber ?? null, instructions: v.instructions ?? null, isPrn: v.isPrn ?? false,
      doseTimes: v.doseTimes?.length ? v.doseTimes : null, startDate: v.startDate ?? null, endDate: v.endDate ?? null, status: v.status ?? 'active', notes: v.notes ?? null,
    }),
    columns: { frequency: 'frequency', route: 'route', indication: 'indication', prescribedBy: 'prescribedBy', pharmacy: 'pharmacy', rxNumber: 'rxNumber', instructions: 'instructions', isPrn: 'isPrn', doseTimes: 'doseTimes', startDate: 'startDate', endDate: 'endDate', status: 'status', notes: 'notes' },
    usedBy: ['medication_id'],
    label: (v) => `${v.clientRef ?? '?'} — ${v.name ?? 'medicine'}${v.dosage ? ` ${v.dosage}` : ''}`,
  },
  {
    kind: 'payRates', table: caregiverRates, tableName: 'caregiver_rates',
    permission: { create: 'care-payroll:create', delete: 'care-payroll:delete' },
    refs: [{ field: 'caregiverRef', entity: 'caregiver' }],
    keyColumns: ['caregiverId', 'rateType', 'effectiveDate'],
    keyOf: (v, c) => joinKey(c.caregiverId, v.rateType ?? 'base', v.effectiveDate),
    rowOf: (v, c) => ({ caregiverId: c.caregiverId, rateType: v.rateType ?? 'base', hourlyRate: dec(v.hourlyRate), effectiveDate: v.effectiveDate, endDate: v.endDate ?? null, notes: v.notes ?? null, createdById: c.userId }),
    columns: { hourlyRate: 'hourlyRate', endDate: 'endDate', notes: 'notes' },
    label: (v) => `${v.caregiverRef ?? '?'} — ${v.rateType ?? 'base'} from ${v.effectiveDate ?? '?'}`,
  },
  {
    kind: 'payers', table: referralSources, tableName: 'referral_sources',
    permission: { create: 'care-billing:create', delete: 'care-billing:delete' },
    refs: [],
    keyColumns: ['name'],
    keyOf: (v) => joinKey(v.name),
    rowOf: (v) => ({
      name: v.name, type: v.payerType ?? 'other', payerType: v.payerType ?? 'other', payerIdNumber: v.payerIdNumber ?? null, npi: v.npi ?? null, contactName: v.contactName ?? null,
      email: v.email ?? null, phone: v.phone ?? null, address: v.address ?? null, city: v.city ?? null, state: v.state ?? null, zip: v.zip ?? null,
      expectedPayDays: v.expectedPayDays ?? 30, isActivePayer: true, billingContactName: v.billingContactName ?? null, billingContactEmail: v.billingContactEmail ?? null,
      billingContactPhone: v.billingContactPhone ?? null, notes: v.notes ?? null,
    }),
    columns: { payerType: 'payerType', payerIdNumber: 'payerIdNumber', npi: 'npi', contactName: 'contactName', email: 'email', phone: 'phone', address: 'address', city: 'city', state: 'state', zip: 'zip', expectedPayDays: 'expectedPayDays', billingContactName: 'billingContactName', billingContactEmail: 'billingContactEmail', billingContactPhone: 'billingContactPhone', notes: 'notes' },
    usedBy: ['payer_id', 'referral_source_id', 'referred_by_id'],
    label: (v) => String(v.name ?? '(no name)'),
  },
  {
    kind: 'contacts', table: clientEmergencyContacts, tableName: 'client_emergency_contacts',
    permission: { create: 'care-clients:create', delete: 'care-clients:delete' },
    refs: [{ field: 'clientRef', entity: 'client' }],
    keyColumns: ['clientId', 'name', 'phone'],
    keyOf: (v, c) => joinKey(c.clientId, v.name, v.phone),
    rowOf: (v, c) => ({ clientId: c.clientId, name: v.name, relationship: v.relationship ?? null, phone: v.phone, email: v.email ?? null, isPrimary: v.isPrimary ?? false }),
    columns: { relationship: 'relationship', email: 'email', isPrimary: 'isPrimary' },
    label: (v) => `${v.clientRef ?? '?'} — ${v.name ?? 'contact'}`,
  },
  {
    kind: 'billingHistory', table: invoices, tableName: 'invoices',
    permission: { create: 'care-billing:create', delete: 'care-billing:delete' },
    refs: [{ field: 'clientRef', entity: 'client' }, { field: 'payerName', entity: 'payer', optional: true }],
    keyColumns: ['invoiceNumber'],
    keyOf: (v) => joinKey(v.invoiceNumber),
    rowOf: (v, c) => {
      const total = v.total as number, tax = (v.tax as number | undefined) ?? 0, paid = v.amountPaid as number | undefined
      const status = v.paymentStatus ?? (paid !== undefined && paid >= total && total > 0 ? 'paid' : paid ? 'partial' : v.dueDate && v.dueDate < c.today ? 'overdue' : 'pending')
      return {
        invoiceNumber: v.invoiceNumber, clientId: c.clientId, billingPeriodStart: v.periodStart, billingPeriodEnd: v.periodEnd,
        subtotal: centsToDecimal(total - tax), tax: centsToDecimal(tax), total: centsToDecimal(total), paymentStatus: status,
        paymentDueDate: v.dueDate ?? null, paymentDate: v.paidDate ?? null, amountPaid: dec(paid) ?? null, paidAt: status === 'paid' && v.paidDate ? noonOf(v.paidDate, c.tz) : null,
        referralSourceId: c.payerId ?? null, billTo: c.payerId ? 'payer' : 'family', invoiceType: 'imported', notes: v.notes ?? null, sentAt: noonOf(v.periodEnd, c.tz),
      }
    },
    columns: { total: 'total', tax: 'tax', amountPaid: 'amountPaid', paymentStatus: 'paymentStatus', dueDate: 'paymentDueDate', paidDate: 'paymentDate', notes: 'notes' },
    usedBy: ['invoice_id'],
    label: (v) => `${v.clientRef ?? '?'} — ${v.invoiceNumber ?? 'invoice'}`,
  },
  {
    kind: 'training', table: trainingRecords, tableName: 'training_records',
    permission: { create: 'care-hr:create', delete: 'care-hr:delete' },
    refs: [{ field: 'caregiverRef', entity: 'caregiver' }],
    keyColumns: ['caregiverId', 'trainingName', 'completedDate'],
    keyOf: (v, c) => joinKey(c.caregiverId, v.trainingName, v.completedDate),
    rowOf: (v, c) => ({
      caregiverId: c.caregiverId, trainingName: v.trainingName, provider: v.provider ?? null, completedDate: v.completedDate ?? null, expiryDate: v.expiryDate ?? null,
      hoursCompleted: v.hoursCompleted !== undefined ? String(v.hoursCompleted) : null, certificationNumber: v.certificationNumber ?? null, status: v.status ?? 'completed', recordedById: c.userId,
    }),
    columns: { provider: 'provider', expiryDate: 'expiryDate', hoursCompleted: 'hoursCompleted', certificationNumber: 'certificationNumber', status: 'status' },
    usedBy: ['training_record_id', 'training_id'],
    label: (v) => `${v.caregiverRef ?? '?'} — ${v.trainingName ?? 'training'}`,
  },
  {
    kind: 'leave', table: caregiverTimeOff, tableName: 'caregiver_time_off',
    permission: { create: 'care-hr:create', delete: 'care-hr:delete' },
    refs: [{ field: 'caregiverRef', entity: 'caregiver' }],
    keyColumns: ['caregiverId', 'startDate', 'endDate'],
    keyOf: (v, c) => joinKey(c.caregiverId, v.startDate, v.endDate),
    rowOf: (v, c) => ({ caregiverId: c.caregiverId, startDate: v.startDate, endDate: v.endDate, type: v.type, reason: v.reason ?? null, status: v.status ?? 'approved', approvedById: (v.status ?? 'approved') === 'approved' ? c.userId : null }),
    columns: { type: 'type', reason: 'reason', status: 'status' },
    usedBy: ['time_off_id'],
    label: (v) => `${v.caregiverRef ?? '?'} — ${v.startDate ?? '?'} to ${v.endDate ?? '?'}`,
  },
  {
    kind: 'journals', table: clientVisitNotes, tableName: 'client_visit_notes',
    permission: { create: 'care-clients:create', delete: 'care-clients:delete' },
    refs: [{ field: 'clientRef', entity: 'client' }, { field: 'caregiverRef', entity: 'caregiver', optional: true }],
    keyColumns: ['clientId', 'note', 'createdAt:day'],
    keyOf: (v, c) => joinKey(c.clientId, v.note, v.date),
    rowOf: (v, c) => ({ clientId: c.clientId, caregiverId: c.caregiverId ?? null, note: v.note, createdAt: noonOf(v.date, c.tz), updatedAt: noonOf(v.date, c.tz) }),
    columns: { note: 'note' },
    label: (v) => `${v.clientRef ?? '?'} — ${v.date ?? '?'}`,
  },
  {
    kind: 'reviews', table: performanceRatings, tableName: 'performance_ratings',
    permission: { create: 'care-hr:create', delete: 'care-hr:delete' },
    refs: [{ field: 'caregiverRef', entity: 'caregiver' }, { field: 'clientRef', entity: 'client' }],
    keyColumns: ['caregiverId', 'clientId', 'ratingDate'],
    keyOf: (v, c) => joinKey(c.caregiverId, c.clientId, v.ratingDate),
    rowOf: (v, c) => ({
      caregiverId: c.caregiverId, clientId: c.clientId, ratingDate: v.ratingDate, satisfactionScore: v.satisfactionScore ?? null, punctualityScore: v.punctualityScore ?? null,
      professionalismScore: v.professionalismScore ?? null, careQualityScore: v.careQualityScore ?? null, comments: v.comments ?? null,
    }),
    columns: { satisfactionScore: 'satisfactionScore', punctualityScore: 'punctualityScore', professionalismScore: 'professionalismScore', careQualityScore: 'careQualityScore', comments: 'comments' },
    label: (v) => `${v.caregiverRef ?? '?'} by ${v.clientRef ?? '?'} — ${v.ratingDate ?? '?'}`,
  },
  {
    kind: 'expenses', table: expenses, tableName: 'expenses',
    permission: { create: 'care-payroll:create', delete: 'care-payroll:delete' },
    refs: [{ field: 'caregiverRef', entity: 'caregiver' }],
    keyColumns: ['userId', 'date', 'description', 'amount'],
    keyOf: (v, c) => joinKey(c.caregiverId, v.date, v.description, centsToDecimal(v.amount ?? 0)),
    rowOf: (v, c) => ({
      userId: c.caregiverId, date: v.date, description: v.description, amount: centsToDecimal(v.amount), category: v.category ?? null, vendor: v.vendor ?? null,
      paymentMethod: v.paymentMethod ?? null, status: v.status ?? 'pending', reimbursable: v.reimbursable ?? false, taxDeductible: v.taxDeductible ?? false, notes: v.notes ?? null,
    }),
    columns: { category: 'category', vendor: 'vendor', paymentMethod: 'paymentMethod', status: 'status', reimbursable: 'reimbursable', taxDeductible: 'taxDeductible', notes: 'notes' },
    usedBy: ['expense_id'],
    label: (v) => `${v.caregiverRef ?? '?'} — ${v.description ?? 'expense'}`,
  },
]

export const childSpec = (kind: ImportKind): ChildKindSpec | null => CHILD_KINDS.find((s) => s.kind === kind) ?? null
export const CHILD_KIND_IDS: readonly ImportKind[] = CHILD_KINDS.map((s) => s.kind)
