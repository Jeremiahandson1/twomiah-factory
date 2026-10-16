// Printable care documents: a care plan, and any form submission laid out by its template.
// pdfkit, collected into a Buffer so the route can answer JSON on a lookup error before any
// bytes are written. No "generated on" stamp and no user email — printouts carry the record's
// own dates only.
import PDFDocument from 'pdfkit'

export function renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try { build(doc); doc.end() } catch (e) { reject(e) }
  })
}

/** 'YYYY-MM-DD' (or a timestamp) as m/d/yyyy, never shifted by a time zone. */
export const ymdToUs = (v: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''))
  if (!m) return ''
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`
}

export const pdfFileName = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_')

const CARE_PLAN_SERVICE_LABELS: Record<string, string> = {
  personal_care: 'Personal Care', medication_management: 'Medication Management', companionship: 'Companionship',
  respite_care: 'Respite Care', mobility_assistance: 'Mobility Assistance', meal_prep: 'Meal Preparation',
  transportation: 'Transportation', other: 'Other',
}
// Same categories as the Care Tasks screen, in print order.
export const CARE_TASK_CATEGORY_LABELS = new Map<string, string>([
  ['adl', 'Personal Care (ADL)'], ['iadl', 'Homemaking (IADL)'], ['medication', 'Medication Reminders'],
  ['companion', 'Companion / Social'], ['safety', 'Safety Checks'], ['other', 'Other'],
])

const signatureLines = (doc: PDFKit.PDFDocument) => {
  doc.moveDown(2)
  doc.fillColor('#6B7280').fontSize(9)
  const y1 = doc.y
  doc.text('_________________________________', 54, y1)
  doc.text('_________________________________', 320, y1)
  doc.moveDown(0.3)
  doc.text('Client / Authorized Rep', 54, doc.y)
  doc.text('Date', 320, doc.y - 12)
  doc.moveDown(2)
  const y2 = doc.y
  doc.text('_________________________________', 54, y2)
  doc.text('_________________________________', 320, y2)
  doc.moveDown(0.3)
  doc.text('Agency Representative', 54, doc.y)
  doc.text('Date', 320, doc.y - 12)
}

export type CarePlanPdfInput = {
  agencyName: string
  plan: any
  client: { firstName: string; lastName: string; dateOfBirth?: string | null; phone?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null }
  author?: { firstName: string; lastName: string } | null
  /** the plan's creation date on the agency's calendar, m/d/yyyy */
  createdOn: string
  emergencyContact?: { name: string; phone: string } | null
  // times_per_week / minutes_per_week: services/careTaskMinutes.ts (the screens' numbers)
  tasks: { task_name: string; category: string; weekly_frequency: number; allotted_minutes: number; assessment_source: string | null; times_per_week?: number; minutes_per_week?: number }[]
  isAssessmentSource: (s: string | null) => boolean
}

/** The care plan's "Care Tasks" section text, grouped by category with minutes per week. */
export function careTasksSection(tasks: CarePlanPdfInput['tasks'], fromAssessment: boolean): string {
  if (!tasks.length) return ''
  const times = (t: any) => t.times_per_week ?? (t.weekly_frequency || 1)
  const mins = (t: any) => t.minutes_per_week ?? Math.round(times(t) * (t.allotted_minutes || 0))
  const lines: string[] = []
  for (const [cat, label] of CARE_TASK_CATEGORY_LABELS) {
    const group = tasks.filter((t) => (CARE_TASK_CATEGORY_LABELS.has(t.category) ? t.category : 'other') === cat)
    if (!group.length) continue
    if (lines.length) lines.push('')
    lines.push(`${label} — ${group.reduce((a, t) => a + mins(t), 0)} min/week`)
    group.forEach((t) => lines.push(`   •  ${t.task_name}: ${times(t)}x/week × ${t.allotted_minutes || 0} min = ${mins(t)} min/week`))
  }
  const total = tasks.reduce((a, t) => a + mins(t), 0)
  lines.push('', `Total: ${total} min/week (${(total / 60).toFixed(2)} hours)`)
  if (fromAssessment) lines.push('Tasks imported from the insurer assessment.')
  return lines.join('\n')
}

export function carePlanPdf(i: CarePlanPdfInput): Promise<Buffer> {
  const p = i.plan
  return renderPdf((doc) => {
    const section = (title: string, body: unknown) => {
      if (!body || !String(body).trim()) return
      doc.moveDown(0.6).fillColor('#1E3A8A').font('Helvetica-Bold').fontSize(11).text(title.toUpperCase())
      doc.moveTo(54, doc.y + 2).lineTo(558, doc.y + 2).strokeColor('#BFDBFE').stroke()
      doc.moveDown(0.3).fillColor('#111827').font('Helvetica').fontSize(10).text(String(body), { lineGap: 2 })
    }

    doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(20).text('Care Plan')
    doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text(i.agencyName)
    doc.moveDown(0.5)

    const c = i.client
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(13).text(`${c.firstName} ${c.lastName}`)
    const small: string[] = []
    if (c.dateOfBirth) small.push(`DOB: ${ymdToUs(c.dateOfBirth)}`)
    if (c.phone) small.push(`Phone: ${c.phone}`)
    if (c.address) small.push(`${c.address}${c.city ? `, ${c.city}` : ''}${c.state ? `, ${c.state}` : ''} ${c.zip || ''}`)
    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text(small.join('  ·  '))

    doc.moveDown(0.5)
    doc.font('Helvetica').fontSize(9).fillColor('#374151')
    doc.text(`Plan ID: ${p.id}`)
    doc.text(`Service Type: ${CARE_PLAN_SERVICE_LABELS[p.serviceType] || p.serviceType || '—'}     Frequency: ${p.frequency || '—'}`)
    doc.text(`Start: ${p.startDate ? ymdToUs(p.startDate) : '—'}    End: ${p.endDate ? ymdToUs(p.endDate) : 'Ongoing'}`)
    if (i.author) doc.text(`Created by: ${i.author.firstName} ${i.author.lastName}   on ${i.createdOn}`)

    if (p.visitSchedule) section(`Visit Schedule (as of ${ymdToUs(p.visitScheduleAsOf)})`, p.visitSchedule)
    section('Service Description', p.serviceDescription)
    section('Care Goals', p.careGoals)
    section('Special Instructions', p.specialInstructions)
    section('Precautions', p.precautions)
    section('Medication Notes', p.medicationNotes)
    section('Mobility Notes', p.mobilityNotes)
    section('Dietary Notes', p.dietaryNotes)
    section('Communication Notes', p.communicationNotes)
    if (i.emergencyContact) section('Emergency Contact', `${i.emergencyContact.name || ''}   ${i.emergencyContact.phone || ''}`.trim())

    // The client's care task checklist as it stands on the day the PDF is printed.
    section('Care Tasks', careTasksSection(i.tasks, i.tasks.some((t) => i.isAssessmentSource(t.assessment_source))))

    if (doc.y > 600) doc.addPage()
    signatureLines(doc)
    doc.moveDown(2)
    doc.fontSize(7).fillColor('#9CA3AF').text('This document contains Protected Health Information — handle per HIPAA.', 54, 720, { width: 504, align: 'center' })
  })
}

/** How one answer prints: arrays (multi-select) joined, booleans Yes/No, blanks as a dash. */
export const renderAnswer = (v: unknown): string => {
  if (v == null || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

export type FormPdfInput = {
  agencyName: string
  templateName: string
  description?: string | null
  fields: any[]
  data: Record<string, unknown>
  entityLine?: string | null
  submissionId: string
  submittedBy: string
  submittedAt: string
  status: string
  requiresSignature: boolean
  signedAt?: string | null
  hasSignature: boolean
}

export function formSubmissionPdf(i: FormPdfInput): Promise<Buffer> {
  return renderPdf((doc) => {
    doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(18).text(i.templateName || 'Form')
    if (i.description) doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text(i.description)
    doc.fillColor('#6B7280').font('Helvetica').fontSize(8).text(i.agencyName)
    doc.moveDown(0.4)
    if (i.entityLine) { doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(i.entityLine); doc.moveDown(0.3) }
    doc.fillColor('#6B7280').font('Helvetica').fontSize(8)
    doc.text(`Submission: ${i.submissionId}`)
    doc.text(`Submitted by ${i.submittedBy} on ${i.submittedAt}`)
    doc.text(`Status: ${i.status || 'submitted'}`)
    doc.moveDown(0.6)

    for (const f of i.fields) {
      if (f.type === 'section') {
        doc.moveDown(0.5)
        doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(12).text(f.label || '', 54)
        doc.moveTo(54, doc.y + 1).lineTo(558, doc.y + 1).strokeColor('#BFDBFE').stroke()
        doc.moveDown(0.4)
        continue
      }
      doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9).text(f.label || f.id, { continued: false })
      doc.fillColor('#111827').font('Helvetica').fontSize(10).text(renderAnswer(i.data[f.id]), { indent: 16, paragraphGap: 2 })
      doc.moveDown(0.25)
    }

    if (i.requiresSignature) {
      if (doc.y > 560) doc.addPage() // keep both signature lines on one page, clear of the footer
      signatureLines(doc)
      if (i.hasSignature) {
        doc.moveDown(1)
        doc.fillColor('#6B7280').fontSize(8).text(`Electronic signature on file (captured ${i.signedAt || 'at submission'}).`)
      }
    }
    if (doc.y > 705) doc.addPage()
    doc.fontSize(7).fillColor('#9CA3AF').text('Contains Protected Health Information — handle per HIPAA.', 54, 720, { width: 504, align: 'center' })
  })
}
