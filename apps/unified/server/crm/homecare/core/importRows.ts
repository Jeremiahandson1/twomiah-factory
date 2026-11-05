// CSV import (item 1, docs/parity/homecare-import.md): the pure half. Which column is which field (with how sure we are),
// and turning one row's cells into clean values or plain-English problems. No database here; the lookups for duplicates
// are core/csvImport.ts's. Pure.
//
// Parity rows 8 and 9 (10/31): every record kind (importKinds.ts holds the child kinds' layouts; the field lists are here),
// a date-format choice (month/day/year, day/month/year or year-month-day), pasted tab-separated data, cells fixed on the
// preview (`edits`), "custom:" columns kept as custom fields, and money read as integer cents.
import { parse } from 'csv-parse/sync'

/** The three kinds of item 1, plus row 8's: each a file of one record kind. */
export type ImportKind =
  | 'clients' | 'caregivers' | 'schedules'
  | 'authorizations' | 'certifications' | 'clientCredentials' | 'medications' | 'payRates' | 'payers' | 'contacts'
  | 'billingHistory' | 'training' | 'leave' | 'journals' | 'reviews' | 'expenses'
export const IMPORT_KINDS: readonly ImportKind[] = [
  'clients', 'caregivers', 'schedules',
  'authorizations', 'certifications', 'clientCredentials', 'medications', 'payRates', 'payers', 'contacts',
  'billingHistory', 'training', 'leave', 'journals', 'reviews', 'expenses',
]
/** Item 1's three; everything else is row 8 (care_import_all). */
export const BASE_KINDS: readonly ImportKind[] = ['clients', 'caregivers', 'schedules']
export const MAX_IMPORT_ROWS = 2000
export const MAX_IMPORT_BYTES = 2_000_000

export type DateFormat = 'mdy' | 'dmy' | 'ymd'
export const DATE_FORMATS: readonly DateFormat[] = ['mdy', 'dmy', 'ymd']
export const DATE_FORMAT_LABEL: Record<DateFormat, string> = { mdy: 'month/day/year (US)', dmy: 'day/month/year', ymd: 'year-month-day' }

export interface FieldDef { key: string; label: string; required?: boolean; synonyms: string[]; example?: string; choices?: Record<string, string> }

const f = (key: string, label: string, synonyms: string[], required = false, example = ''): FieldDef => ({ key, label, required, synonyms, example })
/** A field whose value is one of a list: stored code → the label the screen shows. Either is accepted in the file. */
const choice = (key: string, label: string, synonyms: string[], choices: Record<string, string>, required = false, example = ''): FieldDef => ({ key, label, required, synonyms, example, choices })

/** "Client (name, ID or reference code)" — how a child row names its client. */
const CLIENT_REF = f('clientRef', 'Client (name, ID or reference code)', ['client', 'client name', 'patient', 'patient name', 'client id', 'client ref', 'client reference'], true, 'Maria Lopez')
const CAREGIVER_REF = f('caregiverRef', 'Caregiver (name, email, ID or reference code)', ['caregiver', 'caregiver name', 'caregiver email', 'employee', 'employee name', 'staff', 'carer', 'caregiver id', 'employee id'], true, 'sam.reed@example.com')
const EXTERNAL_ID = f('externalId', 'Reference code (ID in your old system)', ['id', 'ref', 'reference', 'reference code', 'external id', 'client id', 'caregiver id', 'employee id', 'record id', 'old id', 'uuid'], false, 'C-1001')

export const STATUS_CHOICES = { active: 'Active', expired: 'Expired', pending: 'Pending', inactive: 'Inactive' }

export const FIELDS: Record<ImportKind, FieldDef[]> = {
  clients: [
    f('firstName', 'First name', ['first', 'first name', 'given name', 'client first name'], true, 'Maria'),
    f('lastName', 'Last name', ['last', 'last name', 'surname', 'family name', 'client last name'], true, 'Lopez'),
    f('fullName', 'Full name (split into first and last)', ['name', 'full name', 'client', 'client name', 'patient name']),
    f('dateOfBirth', 'Date of birth', ['dob', 'birth date', 'birthdate', 'date of birth', 'birthday'], false, '1948-03-15'),
    f('gender', 'Gender', ['sex', 'gender'], false, 'Female'),
    f('phone', 'Phone', ['phone', 'phone number', 'mobile', 'cell', 'telephone', 'home phone'], false, '(715) 555-0100'),
    f('email', 'Email', ['email', 'e-mail', 'email address'], false, 'maria@example.com'),
    f('address', 'Street address', ['address', 'street', 'street address', 'address 1', 'address line 1'], false, '12 Oak St'),
    f('city', 'City', ['city', 'town'], false, 'Eau Claire'),
    f('state', 'State', ['state', 'province'], false, 'WI'),
    f('zip', 'Zip', ['zip', 'zip code', 'postal code', 'postcode'], false, '54701'),
    f('startDate', 'Start of care', ['start date', 'start of care', 'soc', 'service start', 'admission date'], false, '2026-01-05'),
    f('serviceType', 'Service type', ['service', 'service type', 'type of care'], false, 'Personal care'),
    f('medicaidId', 'Medicaid ID', ['medicaid', 'medicaid id', 'medicaid number', 'member id']),
    f('isPrivatePay', 'Private pay (yes/no)', ['private pay', 'self pay', 'private'], false, 'no'),
    f('privatePayRate', 'Private pay rate per hour', ['rate', 'bill rate', 'hourly rate', 'private pay rate']),
    f('payers', 'Payers (several, separated by ;)', ['payers', 'payer', 'contracts', 'funding', 'funder', 'funders', 'insurance'], false, ''),
    EXTERNAL_ID,
    f('notes', 'Notes', ['notes', 'comments', 'note']),
  ],
  caregivers: [
    f('firstName', 'First name', ['first', 'first name', 'given name'], true, 'Sam'),
    f('lastName', 'Last name', ['last', 'last name', 'surname', 'family name'], true, 'Reed'),
    f('fullName', 'Full name (split into first and last)', ['name', 'full name', 'caregiver', 'caregiver name', 'employee', 'employee name']),
    f('email', 'Email', ['email', 'e-mail', 'email address', 'work email'], true, 'sam.reed@example.com'),
    f('phone', 'Phone', ['phone', 'phone number', 'mobile', 'cell', 'telephone'], false, '(715) 555-0111'),
    f('hireDate', 'Hire date', ['hire date', 'hired', 'start date', 'date hired'], false, '2025-06-01'),
    f('defaultPayRate', 'Pay rate per hour', ['pay rate', 'hourly rate', 'rate', 'wage', 'hourly wage'], false, '18.50'),
    f('address', 'Street address', ['address', 'street', 'street address'], false, '12 Oak St'),
    f('city', 'City', ['city', 'town'], false, 'Eau Claire'),
    f('state', 'State', ['state', 'province'], false, 'WI'),
    f('zip', 'Zip', ['zip', 'zip code', 'postal code', 'postcode'], false, '54701'),
    EXTERNAL_ID,
  ],
  schedules: [
    f('clientName', 'Client name', ['client', 'client name', 'patient', 'patient name'], true, 'Maria Lopez'),
    f('caregiverRef', 'Caregiver (name or email)', ['caregiver', 'caregiver name', 'caregiver email', 'employee', 'employee name', 'staff'], true, 'sam.reed@example.com'),
    f('dayOfWeek', 'Weekday', ['day', 'day of week', 'weekday'], true, 'Monday'),
    f('startTime', 'Start time', ['start', 'start time', 'from', 'time in'], true, '9:00 AM'),
    f('endTime', 'End time', ['end', 'end time', 'to', 'time out'], true, '1:00 PM'),
    f('frequency', 'Repeats', ['frequency', 'repeats', 'repeat', 'every'], false, 'weekly'),
    f('startDate', 'Starts on', ['start date', 'effective date', 'starts', 'effective']),
    f('endDate', 'Ends on', ['end date', 'ends', 'last day']),
    f('notes', 'Notes', ['notes', 'comments']),
  ],
  // ---- row 8: every other record kind ----
  authorizations: [
    CLIENT_REF,
    f('payerName', 'Payer', ['payer', 'payer name', 'insurer', 'funder', 'insurance', 'referral source'], false, 'Medicaid'),
    f('authNumber', 'Authorization number', ['auth number', 'auth #', 'authorization number', 'authorization #', 'auth', 'prior auth', 'pa number'], false, 'A-4471'),
    f('procedureCode', 'Procedure code', ['procedure code', 'procedure', 'service code', 'code', 'hcpcs', 'cpt'], false, 'T1019'),
    f('modifier', 'Modifier', ['modifier', 'mod']),
    f('authorizedUnits', 'Authorized units', ['authorized units', 'units', 'units authorized', 'authorized', 'total units'], true, '480'),
    choice('unitType', 'Unit type', ['unit type', 'unit', 'units of'], { '15min': '15 minutes', hour: 'Hour', visit: 'Visit', day: 'Day' }, false, '15 minutes'),
    f('usedUnits', 'Units already used', ['used units', 'units used', 'used'], false, '0'),
    f('startDate', 'Starts on', ['start date', 'start', 'from', 'effective date', 'begin date'], true, '2026-01-01'),
    f('endDate', 'Ends on', ['end date', 'end', 'to', 'through', 'expiration date', 'expires'], true, '2026-12-31'),
    choice('status', 'Status', ['status'], { active: 'Active', expired: 'Expired', exhausted: 'Exhausted', pending: 'Pending' }, false, 'Active'),
    f('notes', 'Notes', ['notes', 'comments', 'note']),
  ],
  certifications: [
    CAREGIVER_REF,
    f('certificationType', 'Certification', ['certification', 'certification type', 'type', 'credential', 'credential type', 'license', 'licence', 'name'], true, 'CPR'),
    f('issuingBody', 'Issued by', ['issued by', 'issuing body', 'issuer', 'authority', 'provider'], false, 'American Red Cross'),
    f('issueDate', 'Issued on', ['issue date', 'issued', 'issued on', 'date issued', 'obtained'], false, '2025-03-01'),
    f('expiryDate', 'Expires on', ['expiry date', 'expiration date', 'expires', 'expiry', 'expiration', 'valid until', 'renewal date'], false, '2027-03-01'),
    f('certificationNumber', 'Certificate number', ['certificate number', 'certification number', 'number', 'license number', 'cert #', 'id number']),
    choice('status', 'Status', ['status'], STATUS_CHOICES, false, 'Active'),
  ],
  clientCredentials: [
    CLIENT_REF,
    f('credentialType', 'Credential', ['credential', 'credential type', 'certification', 'type', 'document', 'name'], true, 'Physician order'),
    f('issuingBody', 'Issued by', ['issued by', 'issuing body', 'issuer', 'authority', 'physician', 'provider']),
    f('issueDate', 'Issued on', ['issue date', 'issued', 'issued on', 'date issued'], false, '2026-01-10'),
    f('expiryDate', 'Expires on', ['expiry date', 'expiration date', 'expires', 'expiry', 'expiration', 'valid until'], false, '2027-01-10'),
    choice('status', 'Status', ['status'], STATUS_CHOICES, false, 'Active'),
  ],
  medications: [
    CLIENT_REF,
    f('name', 'Medicine', ['medication', 'medicine', 'name', 'drug', 'medication name', 'drug name'], true, 'Metformin'),
    f('dosage', 'Dose', ['dosage', 'dose', 'strength'], false, '500 mg'),
    f('frequency', 'How often', ['frequency', 'how often', 'sig', 'schedule'], false, 'Twice daily'),
    f('route', 'Route', ['route', 'how taken'], false, 'Oral'),
    f('indication', 'For', ['indication', 'for', 'reason', 'condition']),
    f('prescribedBy', 'Prescribed by', ['prescribed by', 'prescriber', 'doctor', 'physician']),
    f('pharmacy', 'Pharmacy', ['pharmacy']),
    f('rxNumber', 'Rx number', ['rx number', 'rx', 'rx #', 'prescription number']),
    f('instructions', 'Instructions', ['instructions', 'directions']),
    f('isPrn', 'As needed (yes/no)', ['prn', 'as needed', 'is prn'], false, 'no'),
    f('doseTimes', 'Dose times (separated by ;)', ['dose times', 'times', 'time of day', 'times of day', 'administration times'], false, '8:00 AM; 8:00 PM'),
    f('startDate', 'Started on', ['start date', 'started', 'start'], false, '2026-01-01'),
    f('endDate', 'Ends on', ['end date', 'stop date', 'ends', 'end']),
    choice('status', 'Status', ['status'], { active: 'Active', discontinued: 'Discontinued', completed: 'Completed' }, false, 'Active'),
    f('notes', 'Notes', ['notes', 'comments', 'note']),
  ],
  payRates: [
    CAREGIVER_REF,
    choice('rateType', 'Rate type', ['rate type', 'type', 'kind'], { base: 'Base', overtime: 'Overtime', premium: 'Premium' }, false, 'Base'),
    f('hourlyRate', 'Hourly rate', ['hourly rate', 'rate', 'pay rate', 'wage', 'amount', 'hourly'], true, '18.50'),
    f('effectiveDate', 'Effective from', ['effective date', 'effective', 'start date', 'from', 'starts'], true, '2026-01-01'),
    f('endDate', 'Ends on', ['end date', 'ends', 'to', 'through']),
    f('notes', 'Notes', ['notes', 'comments', 'note']),
  ],
  payers: [
    f('name', 'Payer name', ['name', 'payer', 'payer name', 'insurer', 'funder', 'organization', 'company'], true, 'Wisconsin Medicaid'),
    choice('payerType', 'Payer type', ['payer type', 'type', 'kind', 'category'], { medicaid: 'Medicaid', medicare: 'Medicare', private_insurance: 'Private insurance', ltc_insurance: 'Long-term care insurance', va: 'VA', private_pay: 'Private pay', other: 'Other' }, false, 'Medicaid'),
    f('payerIdNumber', 'Payer ID', ['payer id', 'payer id number', 'id number', 'payer number', 'edi payer id'], false, 'WI-MCD'),
    f('npi', 'NPI', ['npi']),
    f('contactName', 'Contact name', ['contact', 'contact name', 'representative'], false, 'Pat Rivera'),
    f('email', 'Email', ['email', 'e-mail', 'email address', 'contact email'], false, 'claims@example.com'),
    f('phone', 'Phone', ['phone', 'phone number', 'telephone', 'contact phone'], false, '(608) 555-0100'),
    f('address', 'Street address', ['address', 'street', 'street address', 'address 1']),
    f('city', 'City', ['city', 'town']),
    f('state', 'State', ['state', 'province']),
    f('zip', 'Zip', ['zip', 'zip code', 'postal code', 'postcode']),
    f('expectedPayDays', 'Expected days to pay', ['expected pay days', 'pay days', 'days to pay', 'net days', 'terms'], false, '30'),
    f('billingContactName', 'Billing contact name', ['billing contact', 'billing contact name', 'billing name']),
    f('billingContactEmail', 'Billing contact email', ['billing email', 'billing contact email']),
    f('billingContactPhone', 'Billing contact phone', ['billing phone', 'billing contact phone']),
    EXTERNAL_ID,
    f('notes', 'Notes', ['notes', 'comments', 'note']),
  ],
  contacts: [
    CLIENT_REF,
    f('name', 'Contact name', ['name', 'contact', 'contact name', 'full name'], true, 'Rosa Lopez'),
    f('relationship', 'Relationship', ['relationship', 'relation', 'role'], false, 'Daughter'),
    f('phone', 'Phone', ['phone', 'phone number', 'mobile', 'cell', 'telephone'], true, '(715) 555-0122'),
    f('email', 'Email', ['email', 'e-mail', 'email address'], false, 'rosa@example.com'),
    f('isPrimary', 'Primary contact (yes/no)', ['primary', 'is primary', 'main contact', 'primary contact'], false, 'yes'),
  ],
  billingHistory: [
    CLIENT_REF,
    f('invoiceNumber', 'Invoice number', ['invoice number', 'invoice #', 'invoice', 'number', 'invoice no', 'reference'], true, 'INV-2025-0412'),
    f('periodStart', 'Period from', ['period start', 'period from', 'from', 'start date', 'service from', 'billing period start'], true, '2025-11-01'),
    f('periodEnd', 'Period to', ['period end', 'period to', 'to', 'end date', 'service to', 'billing period end'], true, '2025-11-30'),
    f('total', 'Total', ['total', 'amount', 'invoice total', 'invoice amount', 'balance'], true, '1250.00'),
    f('tax', 'Tax', ['tax', 'sales tax'], false, '0'),
    f('amountPaid', 'Amount paid', ['amount paid', 'paid', 'payments', 'paid amount'], false, '1250.00'),
    choice('paymentStatus', 'Payment status', ['payment status', 'status', 'paid status'], { pending: 'Unpaid', partial: 'Partly paid', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled', written_off: 'Written off' }, false, 'Paid'),
    f('dueDate', 'Due on', ['due date', 'due', 'due on', 'payment due'], false, '2025-12-30'),
    f('paidDate', 'Paid on', ['paid date', 'paid on', 'payment date', 'date paid'], false, '2025-12-15'),
    f('payerName', 'Billed to (payer; blank = the family)', ['payer', 'payer name', 'billed to', 'bill to', 'insurer', 'funder'], false, ''),
    f('notes', 'Notes', ['notes', 'comments', 'note', 'memo']),
  ],
  training: [
    CAREGIVER_REF,
    f('trainingName', 'Training', ['training', 'training name', 'course', 'course name', 'name', 'topic', 'module'], true, 'Dementia care basics'),
    f('provider', 'Provider', ['provider', 'trainer', 'issued by', 'organization'], false, 'Relias'),
    f('completedDate', 'Completed on', ['completed date', 'completed', 'completion date', 'date completed', 'date'], false, '2026-02-10'),
    f('expiryDate', 'Expires on', ['expiry date', 'expiration date', 'expires', 'expiry', 'renewal date', 'valid until'], false, '2027-02-10'),
    f('hoursCompleted', 'Hours', ['hours', 'hours completed', 'credit hours', 'ceu', 'duration'], false, '2.5'),
    f('certificationNumber', 'Certificate number', ['certificate number', 'certification number', 'number', 'cert #']),
    choice('status', 'Status', ['status'], { completed: 'Completed', in_progress: 'In progress', expired: 'Expired', scheduled: 'Scheduled' }, false, 'Completed'),
  ],
  leave: [
    CAREGIVER_REF,
    f('startDate', 'From', ['start date', 'from', 'start', 'first day', 'begins'], true, '2026-07-01'),
    f('endDate', 'To', ['end date', 'to', 'end', 'last day', 'ends'], true, '2026-07-05'),
    choice('type', 'Type', ['type', 'leave type', 'kind', 'category'], { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', unpaid: 'Unpaid', bereavement: 'Bereavement', other: 'Other' }, true, 'Vacation'),
    f('reason', 'Reason', ['reason', 'notes', 'comments', 'note']),
    choice('status', 'Status', ['status'], { pending: 'Pending', approved: 'Approved', denied: 'Denied' }, false, 'Approved'),
  ],
  journals: [
    CLIENT_REF,
    f('date', 'Date', ['date', 'entry date', 'when', 'created', 'note date'], true, '2026-03-02'),
    f('note', 'Note', ['note', 'notes', 'entry', 'journal', 'journal entry', 'text', 'comments', 'comment'], true, 'Enjoyed a walk in the garden.'),
    f('caregiverRef', 'Written by (caregiver name or email)', ['caregiver', 'caregiver name', 'caregiver email', 'author', 'written by', 'by', 'staff', 'employee'], false, 'sam.reed@example.com'),
  ],
  reviews: [
    CAREGIVER_REF,
    CLIENT_REF,
    f('ratingDate', 'Date', ['date', 'rating date', 'review date', 'when'], true, '2026-03-31'),
    f('satisfactionScore', 'Satisfaction (1-5)', ['satisfaction', 'satisfaction score', 'overall', 'rating', 'score'], false, '5'),
    f('punctualityScore', 'Punctuality (1-5)', ['punctuality', 'punctuality score', 'on time'], false, '4'),
    f('professionalismScore', 'Professionalism (1-5)', ['professionalism', 'professionalism score'], false, '5'),
    f('careQualityScore', 'Care quality (1-5)', ['care quality', 'care quality score', 'quality'], false, '5'),
    f('comments', 'Comments', ['comments', 'comment', 'notes', 'review', 'feedback'], false, 'Always on time and kind.'),
  ],
  expenses: [
    CAREGIVER_REF,
    f('date', 'Date', ['date', 'expense date', 'when', 'incurred'], true, '2026-03-04'),
    f('description', 'Description', ['description', 'what', 'item', 'details', 'expense'], true, 'Groceries for client'),
    f('amount', 'Amount', ['amount', 'total', 'cost', 'value'], true, '42.17'),
    f('category', 'Category', ['category', 'type', 'kind'], false, 'Supplies'),
    f('vendor', 'Vendor', ['vendor', 'store', 'merchant', 'supplier', 'paid to']),
    f('paymentMethod', 'Paid with', ['payment method', 'paid with', 'method', 'paid by']),
    choice('status', 'Status', ['status'], { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', reimbursed: 'Reimbursed' }, false, 'Reimbursed'),
    f('reimbursable', 'Reimbursable (yes/no)', ['reimbursable', 'reimburse', 'to reimburse'], false, 'yes'),
    f('taxDeductible', 'Tax deductible (yes/no)', ['tax deductible', 'deductible'], false, 'no'),
    f('notes', 'Notes', ['notes', 'comments', 'note', 'memo']),
  ],
}

export const KIND_LABEL: Record<ImportKind, string> = {
  clients: 'Clients', caregivers: 'Caregivers', schedules: 'Recurring shifts',
  authorizations: 'Authorizations', certifications: 'Caregiver certifications', clientCredentials: 'Client credentials',
  medications: 'Medicine lists', payRates: 'Pay rates', payers: 'Payers', contacts: 'Important contacts',
  billingHistory: 'Billing history (past invoices)', training: 'Training and compliance records', leave: 'Leave and time off',
  journals: 'Client journal entries', reviews: 'Caregiver reviews', expenses: 'Expenses',
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** A "custom:" column (row 9): kept as a custom field named by the rest of the heading. */
export const CUSTOM_PREFIX = /^\s*custom\s*[:_-]\s*/i
export const isCustomHeader = (header: string) => CUSTOM_PREFIX.test(header) && header.replace(CUSTOM_PREFIX, '').trim().length > 0
export const customFieldName = (header: string) => header.replace(CUSTOM_PREFIX, '').trim().slice(0, 80)
export const customKey = (header: string) => `custom:${customFieldName(header)}`
/** Which kinds keep custom fields (the ones that are a person or an organisation with a record of their own). */
export const CUSTOM_FIELD_KINDS: readonly ImportKind[] = ['clients', 'caregivers', 'payers']

export interface MappingGuess { header: string; field: string | null; confidence: 'exact' | 'likely' | 'none' }

/** Which field each header most likely is. Exact = the header is the field's name; likely = a known synonym. A field is used once. */
export function guessMapping(kind: ImportKind, headers: string[]): MappingGuess[] {
  const defs = FIELDS[kind]
  const taken = new Set<string>()
  const out: MappingGuess[] = headers.map((header) => ({ header, field: null, confidence: 'none' as const }))
  if (CUSTOM_FIELD_KINDS.includes(kind)) out.forEach((g) => { if (isCustomHeader(g.header)) { g.field = customKey(g.header); g.confidence = 'exact' } })
  // exact first, so a synonym never steals a field another column names outright
  for (const pass of ['exact', 'likely'] as const) {
    out.forEach((g, i) => {
      if (g.field) return
      const h = norm(headers[i])
      const hit = defs.find((d) => !taken.has(d.key) && (pass === 'exact' ? norm(d.key.replace(/([A-Z])/g, ' $1')) === h || norm(d.label) === h : d.synonyms.includes(h)))
      if (hit) { g.field = hit.key; g.confidence = pass; taken.add(hit.key) }
    })
  }
  return out
}

/** The delimiter a pasted or saved sheet uses: a tab when the header line has tabs and no commas (pasted from Excel), else a comma. */
export function detectDelimiter(text: string): ',' | '\t' | ';' {
  const first = text.split(/\r?\n/).find((l) => l.trim().length) ?? ''
  const tabs = (first.match(/\t/g) || []).length, commas = (first.match(/,/g) || []).length, semis = (first.match(/;/g) || []).length
  if (tabs && tabs >= commas) return '\t'
  if (semis && !commas) return ';'
  return ','
}

/** The file's header row and its rows as arrays, or a plain-English problem. Reads CSV, and tab-separated text pasted from a sheet. */
export function readCsv(text: string): { headers: string[]; rows: string[][] } | { problem: string; code: string } {
  if (typeof text !== 'string' || !text.trim()) return { problem: 'The file is empty.', code: 'empty_file' }
  if (text.length > MAX_IMPORT_BYTES) return { problem: 'The file is too big. Split it into files under 2 MB.', code: 'file_too_big' }
  let records: string[][]
  try {
    records = parse(text.replace(/^﻿/, ''), { skip_empty_lines: true, relax_column_count: true, trim: true, delimiter: detectDelimiter(text), relax_quotes: true }) as string[][]
  } catch {
    return { problem: 'That does not look like a CSV file. Save the sheet as CSV and try again.', code: 'bad_csv' }
  }
  return fromRecords(records)
}

/** A header row and data rows (from a CSV or a sheet) checked for the limits. */
export function fromRecords(records: string[][]): { headers: string[]; rows: string[][] } | { problem: string; code: string } {
  if (records.length < 2) return { problem: 'The file needs a header row and at least one row of data.', code: 'empty_file' }
  const [headers, ...rows] = records
  if (rows.length > MAX_IMPORT_ROWS) return { problem: `The file has ${rows.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`, code: 'too_many_rows' }
  return { headers: headers.map((h) => String(h ?? '').trim()), rows: rows.map((r) => r.map((c) => String(c ?? ''))) }
}

/** A cell fixed on the preview (row 9): the spreadsheet row (header = 1), the column heading and the new text. */
export interface CellEdit { line: number; header: string; value: string }

/** The rows with the person's fixes put in (the server re-reads the file and applies them; nothing edited is trusted as clean). */
export function applyEdits(headers: string[], rows: string[][], edits: CellEdit[] | undefined): string[][] {
  if (!edits?.length) return rows
  const out = rows.map((r) => [...r])
  for (const e of edits) {
    const i = Number(e.line) - 2
    const col = headers.indexOf(String(e.header))
    if (!Number.isInteger(i) || i < 0 || i >= out.length || col < 0) continue
    while (out[i].length <= col) out[i].push('')
    out[i][col] = String(e.value ?? '')
  }
  return out
}

// ---- cell cleaners: each returns { value } or { problem } ----
type Cleaned = { value: any } | { problem: string }
const empty = (s: string | undefined) => s === undefined || s.trim() === ''

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * A date, read in the format the person chose (row 9): year-month-day is always accepted; a slashed, dashed or dotted
 * date with three parts is read as month/day/year (the default, US), day/month/year or year/month/day. "15 Mar 2026" and
 * "March 15, 2026" are read whatever the choice. A two-digit year is this century until it would be in the future.
 */
export function cleanDate(raw: string, fmt: DateFormat = 'mdy'): Cleaned {
  const s = raw.trim()
  let y: number, m: number, d: number
  let hit = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  const words = s.match(/^(\d{1,2})[ -]([a-z]{3})[a-z]*[ -,]*(\d{2,4})$/i) || s.match(/^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{2,4})$/i)
  if (hit) { y = +hit[1]; m = +hit[2]; d = +hit[3] } else if (words) {
    const dayFirst = /^\d/.test(s)
    const mon = MONTHS.indexOf((dayFirst ? words[2] : words[1]).toLowerCase())
    if (mon < 0) return { problem: `"${s}" is not a date.` }
    m = mon + 1; d = +(dayFirst ? words[1] : words[2]); y = +words[3]
    if (words[3].length === 2) y += 2000
  } else {
    hit = s.match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/)
    const how = { mdy: 'month/day/year (3/15/2026)', dmy: 'day/month/year (15/3/2026)', ymd: 'year/month/day (2026/3/15)' }[fmt]
    if (!hit) return { problem: `"${s}" is not a date. Use year-month-day (2026-03-15) or ${how}.` }
    const a = hit[1], b = hit[2], c = hit[3]
    if (fmt === 'ymd' || a.length === 4) { y = +a; m = +b; d = +c; if (fmt !== 'ymd' && a.length !== 4) return { problem: `"${s}" is not a date.` } }
    else if (fmt === 'dmy') { d = +a; m = +b; y = +c }
    else { m = +a; d = +b; y = +c }
    if (String(y).length <= 2 && c.length === 2) y += y > (new Date().getUTCFullYear() % 100) ? 1900 : 2000
  }
  const real = new Date(Date.UTC(y, m - 1, d))
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) {
    const swap = fmt === 'mdy' && d >= 1 && d <= 12 && m > 12 ? ' (it reads as month/day/year; choose day/month/year if your file is written that way)' : ''
    return { problem: `"${s}" is not a real date${swap}.` }
  }
  return { value: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

export function cleanPhone(raw: string): Cleaned {
  const digits = raw.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length !== 10) return { problem: `"${raw.trim()}" is not a 10-digit phone number.` }
  return { value: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` }
}

export function cleanEmail(raw: string): Cleaned {
  const s = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s } : { problem: `"${raw.trim()}" is not an email address.` }
}

/** An hourly rate, kept as the decimal string the rate columns hold (dollars with two places). */
export function cleanMoney(raw: string): Cleaned {
  const n = Number(raw.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 && n < 10_000 ? { value: n.toFixed(2) } : { problem: `"${raw.trim()}" is not an hourly rate.` }
}

/** An amount of money as integer cents (row 8: invoices, expenses, pay rates). "$1,250.00", "(42.17)" and "-42.17" are read. */
export function cleanCents(raw: string): Cleaned {
  const s = raw.trim()
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-')
  const n = Number(s.replace(/[()$,\s-]/g, ''))
  if (!Number.isFinite(n) || n > 10_000_000) return { problem: `"${s}" is not an amount of money.` }
  return { value: Math.round(n * 100) * (neg ? -1 : 1) }
}
export const centsToDecimal = (cents: number) => (cents / 100).toFixed(2)

export function cleanYesNo(raw: string): Cleaned {
  const s = raw.trim().toLowerCase()
  if (['y', 'yes', 'true', '1', 'x', 'on'].includes(s)) return { value: true }
  if (['n', 'no', 'false', '0', 'off'].includes(s)) return { value: false }
  return { problem: `"${raw.trim()}" should be yes or no.` }
}

/** A number of units or hours (up to one decimal place kept as given). */
export function cleanNumber(raw: string, what = 'a number'): Cleaned {
  const n = Number(raw.replace(/[,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? { value: n } : { problem: `"${raw.trim()}" is not ${what}.` }
}

/** A whole number from 1 to 5. */
export function cleanScore(raw: string): Cleaned {
  const n = Number(raw.trim())
  return Number.isInteger(n) && n >= 1 && n <= 5 ? { value: n } : { problem: `"${raw.trim()}" is not a score from 1 to 5.` }
}

export function cleanWholeNumber(raw: string, what = 'a whole number'): Cleaned {
  const n = Number(raw.replace(/[,\s]/g, ''))
  return Number.isInteger(n) && n >= 0 && n < 1_000_000 ? { value: n } : { problem: `"${raw.trim()}" is not ${what}.` }
}

/** One of a field's choices, by its stored code or the label the screen shows (either way, any case). */
export function cleanChoice(raw: string, choices: Record<string, string>): Cleaned {
  const s = norm(raw)
  for (const [code, label] of Object.entries(choices)) if (norm(code) === s || norm(label) === s) return { value: code }
  return { problem: `"${raw.trim()}" is not one of: ${Object.values(choices).join(', ')}.` }
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
export function cleanWeekday(raw: string): Cleaned {
  const s = raw.trim().toLowerCase()
  const byName = DAYS.findIndex((d) => d === s || (s.length >= 3 && d.startsWith(s)))
  if (byName >= 0) return { value: byName }
  if (/^[0-6]$/.test(s)) return { value: Number(s) }
  return { problem: `"${raw.trim()}" is not a weekday. Use Monday, Tue, or 0 (Sunday) to 6 (Saturday).` }
}

export function cleanTime(raw: string): Cleaned {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/)
  if (!m) return { problem: `"${raw.trim()}" is not a time. Use 9:00 AM or 14:30.` }
  let h = +m[1]
  const mi = m[2] ? +m[2] : 0
  if (m[3]) { if (h < 1 || h > 12) return { problem: `"${raw.trim()}" is not a time.` }; h = (h % 12) + (m[3].startsWith('p') ? 12 : 0) }
  if (h > 23 || mi > 59) return { problem: `"${raw.trim()}" is not a time.` }
  return { value: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` }
}

/** Several times in one cell ("8:00 AM; 8pm"), each a time. */
export function cleanTimes(raw: string): Cleaned {
  const parts = raw.split(/[;,/|]/).map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return { value: [] }
  const out: string[] = []
  for (const p of parts) { const t = cleanTime(p); if ('problem' in t) return t; out.push(t.value) }
  return { value: [...new Set(out)].sort() }
}

/** Several names in one cell ("Medicaid; Private pay"), trimmed, empties dropped, no repeats. */
export function splitList(raw: string): string[] {
  return [...new Set(raw.split(/[;|]/).map((p) => p.trim()).filter(Boolean))]
}

/** "Maria Lopez" or "Lopez, Maria" → first and last. */
export function splitName(raw: string): { first: string; last: string } | null {
  const s = raw.trim().replace(/\s+/g, ' ')
  if (!s) return null
  if (s.includes(',')) { const [last, first] = s.split(',').map((p) => p.trim()); return first && last ? { first, last } : null }
  const parts = s.split(' ')
  if (parts.length < 2) return null
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

/** Which cleaner a field key gets, by kind (a key means the same thing wherever it appears, with two exceptions noted). */
const DATE_KEYS = new Set(['dateOfBirth', 'startDate', 'endDate', 'hireDate', 'issueDate', 'expiryDate', 'effectiveDate', 'completedDate', 'periodStart', 'periodEnd', 'dueDate', 'paidDate', 'date', 'ratingDate'])
const CENTS_KEYS = new Set(['total', 'tax', 'amountPaid', 'amount'])
const YESNO_KEYS = new Set(['isPrivatePay', 'isPrn', 'isPrimary', 'reimbursable', 'taxDeductible'])
const SCORE_KEYS = new Set(['satisfactionScore', 'punctualityScore', 'professionalismScore', 'careQualityScore'])
const NUMBER_KEYS = new Set(['authorizedUnits', 'usedUnits', 'hoursCompleted'])

function cleanerFor(kind: ImportKind, key: string, def: FieldDef | undefined, fmt: DateFormat): ((raw: string) => Cleaned) | null {
  if (def?.choices) { const ch = def.choices; return (raw) => cleanChoice(raw, ch) }
  if (DATE_KEYS.has(key)) return (raw) => cleanDate(raw, fmt)
  if (key === 'phone' || key === 'billingContactPhone') return cleanPhone
  if (key === 'email' || key === 'billingContactEmail') return cleanEmail
  if (key === 'privatePayRate' || key === 'defaultPayRate') return cleanMoney
  if (key === 'hourlyRate') return (raw) => cleanCents(raw)
  if (CENTS_KEYS.has(key)) return cleanCents
  if (YESNO_KEYS.has(key)) return cleanYesNo
  if (SCORE_KEYS.has(key)) return cleanScore
  if (NUMBER_KEYS.has(key)) return (raw) => cleanNumber(raw, key === 'hoursCompleted' ? 'a number of hours' : 'a number of units')
  if (key === 'expectedPayDays') return (raw) => cleanWholeNumber(raw, 'a number of days')
  if (key === 'dayOfWeek') return cleanWeekday
  if (key === 'startTime' || key === 'endTime') return cleanTime
  if (key === 'doseTimes') return cleanTimes
  if (key === 'payers') return (raw) => ({ value: splitList(raw) })
  return null
}

export interface CleanRow { line: number; values: Record<string, any>; problems: Array<{ field: string; message: string }>; custom: Record<string, string> }

/**
 * One file row's cells (by the chosen mapping) as clean values, or the problems with them. `line` is the row's number in the
 * spreadsheet (the header is line 1). Cross-checks that need the database (duplicates, who a name is) are done afterwards.
 * `custom` holds the "custom:" columns' values by field name.
 */
export function cleanRow(kind: ImportKind, mapping: Record<string, string | null>, headers: string[], cells: string[], line: number, fmt: DateFormat = 'mdy'): CleanRow {
  const values: Record<string, any> = {}
  const custom: Record<string, string> = {}
  const problems: CleanRow['problems'] = []
  const defs = FIELDS[kind]
  const label = (key: string) => defs.find((d) => d.key === key)?.label ?? key
  headers.forEach((h, i) => {
    const key = mapping[h]
    if (!key || empty(cells[i])) return
    const raw = String(cells[i])
    if (key.startsWith('custom:')) { custom[key.slice(7)] = raw.trim().slice(0, 2000); return }
    const clean = cleanerFor(kind, key, defs.find((d) => d.key === key), fmt)
    if (!clean) { values[key] = raw.trim(); return }
    const r = clean(raw)
    if ('problem' in r) problems.push({ field: key, message: `${label(key)}: ${r.problem}` })
    else values[key] = r.value
  })
  if (values.fullName !== undefined) {
    const parts = splitName(String(values.fullName))
    if (parts) { values.firstName ??= parts.first; values.lastName ??= parts.last }
    else problems.push({ field: 'fullName', message: 'Name: could not tell the first name from the last. Use "First Last" or "Last, First".' })
    delete values.fullName
  }
  for (const d of defs) {
    if (d.required && d.key !== 'firstName' && d.key !== 'lastName' && values[d.key] === undefined && !problems.some((p) => p.field === d.key)) problems.push({ field: d.key, message: `${d.label} is empty.` })
  }
  if (kind === 'clients' || kind === 'caregivers') {
    for (const k of ['firstName', 'lastName'] as const) if (!values[k] && !problems.some((p) => p.field === 'fullName')) problems.push({ field: k, message: `${k === 'firstName' ? 'First' : 'Last'} name is empty.` })
  }
  if (kind === 'schedules' && values.startTime && values.endTime && values.startTime === values.endTime) problems.push({ field: 'endTime', message: 'Start and end time cannot be the same.' })
  if ((kind === 'authorizations' || kind === 'leave' || kind === 'payRates') && values.startDate && values.endDate && values.endDate < values.startDate) problems.push({ field: 'endDate', message: `${label('endDate')} is before ${label('startDate').toLowerCase()}.` })
  if (kind === 'billingHistory' && values.periodStart && values.periodEnd && values.periodEnd < values.periodStart) problems.push({ field: 'periodEnd', message: 'Period to is before period from.' })
  if (kind === 'payRates' && values.hourlyRate !== undefined && (values.hourlyRate <= 0 || values.hourlyRate > 1_000_00)) problems.push({ field: 'hourlyRate', message: 'Hourly rate: must be more than $0 and under $1,000.' })
  if (kind === 'expenses' && values.amount !== undefined && values.amount < 0) problems.push({ field: 'amount', message: 'Amount: cannot be negative.' })
  if (kind === 'billingHistory' && values.total !== undefined && values.total < 0) problems.push({ field: 'total', message: 'Total: cannot be negative.' })
  return { line, values, problems, custom }
}

/** Fields that must be mapped to a column before anything can be read (a name may come from first+last or from one full-name column). */
export function unmappedRequired(kind: ImportKind, mapping: Record<string, string | null>): string[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean) as string[])
  const out: string[] = []
  for (const d of FIELDS[kind]) {
    if (!d.required) continue
    if ((d.key === 'firstName' || d.key === 'lastName') && mapped.has('fullName')) continue
    if (!mapped.has(d.key)) out.push(d.label)
  }
  return out
}

/** The blank template of a kind: its header row and one example row, as CSV. */
export function templateCsv(kind: ImportKind): { headers: string[]; csv: string } {
  const defs = FIELDS[kind].filter((d) => d.key !== 'fullName')
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return { headers: defs.map((d) => d.label), csv: `${defs.map((d) => q(d.label)).join(',')}\n${defs.map((d) => q(d.example ?? '')).join(',')}\n` }
}
