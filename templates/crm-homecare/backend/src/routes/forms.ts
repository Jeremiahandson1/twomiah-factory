// Form Builder: form templates (a library of built-ins plus the agency's own) and the filled-in
// submissions, each printable as a PDF laid out by its template.
//
// Field types: text, textarea, select, radio, number, date, checkbox, and section (a heading that
// collects nothing). A checkbox WITH options is multi-select — its answer is the array of picked
// options; without options it is a single Yes box.
//
// A template carrying a `state` (a state Medicaid form) is offered only to an agency in that state.
import { Hono } from 'hono'
import { eq, and, desc, asc, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { formTemplates, formSubmissions, users, clients, agencies } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { agencyState, agencyTimeZone, formatInZone } from '../utils/agencyTimezone.ts'
import { formSubmissionPdf, pdfFileName, ymdToUs } from '../services/carePdf.ts'
import { isOffice, userIdOf, rowsOf } from '../helpers/careAudit.ts'

const app = new Hono()
app.use('*', authenticate)

export const FIELD_TYPES = ['text', 'textarea', 'select', 'radio', 'number', 'date', 'checkbox', 'section']
export const CATEGORIES = ['assessment', 'incident', 'physician_order', 'consent', 'intake', 'hr', 'general']

export const isMultiCheck = (f: any) => f?.type === 'checkbox' && Array.isArray(f.options) && f.options.length > 0
export const isEmptyAnswer = (f: any, v: unknown) => isMultiCheck(f)
  ? !(Array.isArray(v) && v.length)
  : (f?.type === 'checkbox' ? !v : (v == null || String(v).trim() === ''))

const parseFields = (raw: unknown): any[] => {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] } }
  return []
}

// A template's own state, or none. Templates for another state are not offered.
const offeredHere = (state: string | null) => state
  ? sql`(${formTemplates.state} IS NULL OR upper(${formTemplates.state}) = ${state})`
  : sql`${formTemplates.state} IS NULL`

app.get('/templates', async (c) => {
  const { category, active = 'true' } = c.req.query()
  const state = await agencyState()
  const conditions: any[] = [offeredHere(state)]
  if (active !== 'all') conditions.push(eq(formTemplates.isActive, active === 'true'))
  if (category) conditions.push(eq(formTemplates.category, category))
  const rows = await db.select({
    tpl: formTemplates,
    createdByFirst: users.firstName,
    createdByLast: users.lastName,
    submissionCount: sql<number>`(SELECT COUNT(*)::int FROM form_submissions fs WHERE fs.template_id = ${formTemplates.id})`,
  })
    .from(formTemplates)
    .leftJoin(users, eq(formTemplates.createdById, users.id))
    .where(and(...conditions))
    .orderBy(asc(formTemplates.category), asc(formTemplates.name))
  return c.json(rows.map((r) => ({
    ...r.tpl,
    createdByName: r.createdByFirst ? `${r.createdByFirst} ${r.createdByLast || ''}`.trim() : null,
    submissionCount: Number(r.submissionCount || 0),
  })))
})

app.get('/templates/:id', async (c) => {
  const [tpl] = await db.select().from(formTemplates).where(eq(formTemplates.id, c.req.param('id'))).limit(1)
  if (!tpl) return c.json({ error: 'Not found' }, 404)
  return c.json(tpl)
})

function templateValues(b: any, creating: boolean): { values: Record<string, unknown>; error?: string } {
  const values: Record<string, unknown> = {}
  if (creating || 'name' in b) {
    if (!b.name || !String(b.name).trim()) return { values, error: 'name required' }
    values.name = String(b.name).trim()
  }
  if ('description' in b) values.description = b.description || null
  if (creating || 'category' in b) {
    const cat = b.category || 'general'
    if (!CATEGORIES.includes(cat)) return { values, error: 'category is not valid' }
    values.category = cat
  }
  if (creating || 'fields' in b) {
    const fields = b.fields ?? []
    if (!Array.isArray(fields)) return { values, error: 'fields must be a list' }
    for (const f of fields) {
      if (!f || !f.id || !FIELD_TYPES.includes(f.type)) return { values, error: `Every field needs an id and one of: ${FIELD_TYPES.join(', ')}` }
    }
    values.fields = fields
  }
  if ('requiresSignature' in b) values.requiresSignature = !!b.requiresSignature
  if ('autoAttachTo' in b) values.autoAttachTo = b.autoAttachTo || null
  if ('isActive' in b && b.isActive !== null && b.isActive !== undefined) values.isActive = !!b.isActive
  return { values }
}

app.post('/templates', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({}))
  const { values, error } = templateValues(b, true)
  if (error) return c.json({ error }, 400)
  const [template] = await db.insert(formTemplates).values({ ...values, isBuiltIn: false, createdById: userIdOf(user) } as any).returning()
  return c.json(template, 201)
})

app.put('/templates/:id', requireAdmin, async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const { values, error } = templateValues(b, false)
  if (error) return c.json({ error }, 400)
  const [template] = await db.update(formTemplates).set({ ...values, updatedAt: new Date() } as any).where(eq(formTemplates.id, c.req.param('id'))).returning()
  if (!template) return c.json({ error: 'Not found' }, 404)
  return c.json(template)
})

// Deactivate (submissions keep pointing at it).
app.delete('/templates/:id', requireAdmin, async (c) => {
  const [row] = await db.update(formTemplates).set({ isActive: false, updatedAt: new Date() })
    .where(eq(formTemplates.id, c.req.param('id'))).returning({ id: formTemplates.id })
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ message: 'Deactivated' })
})

// ── submissions ──────────────────────────────────────────────────────────────
const SUBMISSION_SELECT = sql`fs.*, COALESCE(fs.template_name, ft.name) AS template_name, ft.category,
  COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), fs.submitted_by_name) AS submitted_by_name,
  CASE fs.entity_type
    WHEN 'client'    THEN (SELECT cl.first_name || ' ' || cl.last_name FROM clients cl WHERE cl.id = fs.entity_id)
    WHEN 'caregiver' THEN (SELECT e.first_name || ' ' || e.last_name FROM users e WHERE e.id = fs.entity_id)
  END AS entity_name`

app.get('/submissions', async (c) => {
  const { entityType, entityId, templateId, status, limit = '50' } = c.req.query()
  const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 500)
  const rows = rowsOf(await db.execute(sql`
    SELECT ${SUBMISSION_SELECT}
      FROM form_submissions fs
      LEFT JOIN form_templates ft ON fs.template_id = ft.id
      LEFT JOIN users u ON fs.submitted_by_id = u.id
     WHERE true
       ${entityType ? sql`AND fs.entity_type = ${entityType}` : sql``}
       ${entityId ? sql`AND fs.entity_id = ${entityId}` : sql``}
       ${templateId ? sql`AND fs.template_id = ${templateId}` : sql``}
       ${status ? sql`AND fs.status = ${status}` : sql``}
     ORDER BY fs.created_at DESC
     LIMIT ${lim}`))
  return c.json(rows.map((r: any) => ({
    ...r,
    category: r.category || 'general',
    template: r.template_name ? { name: r.template_name, category: r.category || 'general' } : null,
  })))
})

const loadSubmission = async (id: string) => rowsOf(await db.execute(sql`
  SELECT ${SUBMISSION_SELECT}, ft.fields AS template_fields, ft.description, ft.requires_signature
    FROM form_submissions fs
    LEFT JOIN form_templates ft ON fs.template_id = ft.id
    LEFT JOIN users u ON fs.submitted_by_id = u.id
   WHERE fs.id = ${id}`))[0]

// The office, or the person who filled it in.
const maySee = (user: any, s: any) => isOffice(user) || s.submitted_by_id === userIdOf(user)

app.get('/submissions/:id', async (c) => {
  const s = await loadSubmission(c.req.param('id'))
  if (!s) return c.json({ error: 'Not found' }, 404)
  if (!maySee(c.get('user'), s)) return c.json({ error: 'Not allowed' }, 403)
  return c.json(s)
})

app.get('/submissions/:id/pdf', async (c) => {
  const s = await loadSubmission(c.req.param('id'))
  if (!s) return c.json({ error: 'Submission not found' }, 404)
  if (!maySee(c.get('user'), s)) return c.json({ error: 'Not allowed' }, 403)
  const fields = parseFields(s.template_fields)
  const data = typeof s.data === 'string' ? JSON.parse(s.data) : (s.data || {})
  let entityLine: string | null = null
  if (s.entity_type === 'client' && s.entity_id) {
    const [cl] = await db.select({ firstName: clients.firstName, lastName: clients.lastName, dateOfBirth: clients.dateOfBirth })
      .from(clients).where(eq(clients.id, s.entity_id)).limit(1)
    if (cl) entityLine = `${cl.firstName} ${cl.lastName}` + (cl.dateOfBirth ? ` · DOB ${ymdToUs(cl.dateOfBirth)}` : '')
  } else if (s.entity_name) {
    entityLine = s.entity_name
  }
  const [agency] = await db.select({ name: agencies.name }).from(agencies).limit(1)
  const tz = await agencyTimeZone()
  const pdf = await formSubmissionPdf({
    agencyName: agency?.name || '',
    templateName: s.template_name || 'Form',
    description: s.description,
    fields,
    data,
    entityLine,
    submissionId: s.id,
    submittedBy: s.submitted_by_name || 'unknown',
    submittedAt: formatInZone(s.created_at, tz),
    status: s.status,
    requiresSignature: !!s.requires_signature,
    signedAt: s.signed_at ? formatInZone(s.signed_at, tz) : null,
    hasSignature: !!s.signature,
  })
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFileName(`${s.template_name || 'form'}-${String(s.id).slice(0, 8)}.pdf`)}"`,
    },
  })
})

app.post('/submissions', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  if (!body.templateId) return c.json({ error: 'A form template is required' }, 400)
  const [tpl] = await db.select().from(formTemplates).where(eq(formTemplates.id, body.templateId)).limit(1)
  if (!tpl) return c.json({ error: 'Form template not found' }, 404)

  // A submission is about someone: a client, or a caregiver (HR forms).
  const entityType = body.entityType === 'caregiver' ? 'caregiver' : 'client'
  const entityId = body.entityId || (entityType === 'client' ? body.clientId : null)
  if (!entityId) return c.json({ error: `Please select a ${entityType} for this form` }, 400)
  if (entityType === 'client') {
    const [cl] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, entityId)).limit(1)
    if (!cl) return c.json({ error: 'Client not found' }, 404)
  } else {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, entityId)).limit(1)
    if (!u) return c.json({ error: 'Caregiver not found' }, 404)
  }

  const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {}
  const status = ['draft', 'submitted', 'signed'].includes(body.status) ? body.status : 'submitted'
  if (status !== 'draft') {
    const missing = parseFields(tpl.fields).filter((f) => f.required && f.type !== 'section' && isEmptyAnswer(f, data[f.id])).map((f) => f.label)
    if (missing.length) return c.json({ error: `Please answer: ${missing.join(' · ')}` }, 400)
    if (tpl.requiresSignature && !body.signature) return c.json({ error: 'This form needs a signature' }, 400)
  }

  const [submitter] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, userIdOf(user))).limit(1)
  const submittedByName = submitter ? `${submitter.firstName} ${submitter.lastName}` : `${user.firstName || ''} ${user.lastName || ''}`.trim() || null
  const [submission] = await db.insert(formSubmissions).values({
    templateId: tpl.id,
    templateName: tpl.name,
    entityType,
    entityId,
    clientId: entityType === 'client' ? entityId : null,
    submittedById: userIdOf(user),
    submittedByName,
    data,
    signature: body.signature || null,
    signedAt: body.signature ? new Date() : null,
    status: body.signature && status === 'submitted' ? 'signed' : status,
  }).returning()
  return c.json(submission, 201)
})

app.put('/submissions/:id', async (c) => {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({}))
  const [existing] = await db.select({ id: formSubmissions.id, submittedById: formSubmissions.submittedById })
    .from(formSubmissions).where(eq(formSubmissions.id, c.req.param('id'))).limit(1)
  if (!existing) return c.json({ error: 'Submission not found' }, 404)
  if (!isOffice(user) && existing.submittedById !== userIdOf(user)) return c.json({ error: 'Not allowed' }, 403)
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) set.data = b.data
  if (b.status) {
    if (!['draft', 'submitted', 'signed', 'archived'].includes(b.status)) return c.json({ error: 'status is not valid' }, 400)
    set.status = b.status
  }
  if (b.signature) { set.signature = b.signature; set.signedAt = new Date() }
  const [row] = await db.update(formSubmissions).set(set).where(eq(formSubmissions.id, existing.id)).returning()
  return c.json(row)
})

// DELETE /api/forms/submissions/:id
app.delete('/submissions/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select({ id: formSubmissions.id }).from(formSubmissions).where(eq(formSubmissions.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Submission not found' }, 404)
  await db.delete(formSubmissions).where(eq(formSubmissions.id, id))
  return c.json({ message: 'Submission deleted' })
})

export default app
