// Moved unchanged from templates/crm-homecare/backend/src/config/incidentOptions.ts. Pure.
// Incident case-file option lists (migration 0019). One place for the stored values and their
// labels — used by routes/incidents.ts validation and the incident PDFs.
// Mirrors frontend/src/utils/incidentOptions.ts; keep the two identical.

export const INCIDENT_TYPES: Record<string, string> = {
  accident: 'Accident',
  fall: 'Fall',
  medication_error: 'Medication Error',
  missing_medication: 'Missing / Misappropriated Medication',
  behavioral: 'Behavioral Issue',
  injury: 'Injury',
  property_damage: 'Property Damage',
  health_emergency: 'Health Emergency',
  other: 'Other',
}

export const SEVERITIES: Record<string, string> = { minor: 'Minor', moderate: 'Moderate', severe: 'Severe', critical: 'Critical' }

export const INCIDENT_STATUSES: Record<string, string> = { open: 'Open', investigating: 'Investigating', closed: 'Closed' }

export const DISPOSITIONS: Record<string, string> = {
  substantiated: 'Substantiated',
  unsubstantiated: 'Unsubstantiated',
  inconclusive: 'Inconclusive',
}

export const MANDATORY_REPORT_STATUSES: Record<string, string> = {
  not_required: 'Not required',
  pending: 'Decision pending',
  reported: 'Reported',
}

export const ENTRY_TYPES: Record<string, string> = {
  call: 'Phone call',
  interview: 'Interview',
  document: 'Document reviewed',
  action: 'Action taken',
  schedule: 'Schedule change',
  note: 'Note',
}

export const ATTACHMENT_CATEGORIES: Record<string, string> = {
  payer_notice: 'Payer / MCO notice',
  statement: 'Signed statement',
  background_check: 'Background check',
  training: 'Training record',
  signed_response: 'Signed response',
  photo: 'Photo',
  other: 'Other',
}

export const TRAINING_ACK_METHODS: Record<string, string> = { in_person: 'In person', phone: 'Phone', video: 'Video' }

// training_records rows written when the acknowledgement is signed. The template's training records
// are keyed by name (training_records.training_name), so these are the names ComplianceTracking lists.
export const TRAINING_ACK_TRAINING_NAMES = [
  'Medication Reminders & Handling (PCW)',
  'Client Funds, Property & Misappropriation Policy',
]

// The packet's training section cares about these (matched on training_name).
export const RELEVANT_TRAINING_RE = /medication|misappropriation/i

// Attachments: data URI stored in TEXT. base64 inflates ~4/3, so the raw file cap is 7 MB.
export const ATTACHMENT_MAX_DATA_URI_LENGTH = 9_500_000
export const ATTACHMENT_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
