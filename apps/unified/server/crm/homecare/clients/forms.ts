// Form Builder: form templates (a library of built-ins plus the agency's own) and the filled-in submissions, each
// printable as a PDF laid out by its template. Moved from templates/crm-homecare/backend/src/routes/forms.ts.
//
// Field types: text, textarea, select, radio, number, date, checkbox, and section (a heading that collects nothing). A
// checkbox WITH options is multi-select — its answer is the array of picked options; without options it is a single
// Yes box. A template carrying a `state` (a state Medicaid form) is offered only to an agency in that state.
//
// The built-ins were seeded once into the one agency's database (0017_care.sql); a template belongs to a company here,
// so each company's library is written on its first read (never again once any built-in exists).
//
// Permissions: the library and the submissions are read with care-clients:read (a caregiver sees only the submissions
// they filled in); filling in a form is evv:create and editing your own submission evv:update (a caregiver: a client
// form for a client they serve, an HR form only about themselves); changing the library is care-clients:create /
// update / delete, deleting a submission care-clients:delete. Replies: lists are { data, pagination }; submissions are
// camelCase (templateName, entityName, submittedByName … were snake_case).
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { formTemplates, formSubmissions, clients, company, user as users } from '../../../db/schema/index.ts'
import { formTemplateRows, formSubmissionRows, formSubmissionOne, lockFor } from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { formatInZone } from '../core/agencyTime.ts'
import { formSubmissionPdf, pdfFileName, ymdToUs } from '../core/carePdf.ts'
import { BUILT_IN_FORM_TEMPLATES } from './builtIns.ts'
import { body, who, whole, type ClientAccess } from './shared.ts'

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

export function createFormRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  const read = requirePermission('care-clients:read')

  /** The company's built-in forms, written on its first read of the library. */
  async function ensureBuiltIns(companyId: string) {
    await db.transaction(async (tx: any) => {
      await lockFor(tx, `form_templates:${companyId}`)
      const [any] = await tx.select({ id: formTemplates.id }).from(formTemplates)
        .where(and(eq(formTemplates.companyId, companyId), eq(formTemplates.isBuiltIn, true))).limit(1)
      if (any) return
      await tx.insert(formTemplates).values(BUILT_IN_FORM_TEMPLATES.map((t) => ({ ...t, companyId, isActive: true, isBuiltIn: true })))
    })
  }

  // The office, or the person who filled it in.
  const maySee = (user: any, me: string, s: any) => access.office(user) || s.submittedById === me

  app.get('/templates', read, async (c) => {
    const { companyId } = who(c)
    const { category, active = 'true' } = c.req.query()
    await ensureBuiltIns(companyId)
    const rows = await formTemplateRows(db, companyId, {
      state: await core.time.state(companyId),
      active: active === 'all' ? 'all' : active === 'true' ? 'true' : 'false',
      category: category || undefined,
    })
    return whole(c, rows.map(({ createdByFirst, createdByLast, submissionCount, ...t }) => ({
      ...t,
      createdByName: createdByFirst ? `${createdByFirst} ${createdByLast || ''}`.trim() : null,
      submissionCount: Number(submissionCount || 0),
    })))
  })

  app.get('/templates/:id', read, async (c) => {
    const { companyId } = who(c)
    const [tpl] = await db.select().from(formTemplates).where(and(eq(formTemplates.id, c.req.param('id')), eq(formTemplates.companyId, companyId))).limit(1)
    return tpl ? one(c, tpl) : fail(c, 404, 'Not found')
  })

  app.post('/templates', requirePermission('care-clients:create'), async (c) => {
    const { companyId, me } = who(c)
    const { values, error } = templateValues(await body(c), true)
    if (error) return fail(c, 400, error)
    const [template] = await db.insert(formTemplates).values({ ...values, companyId, isBuiltIn: false, createdById: me } as any).returning()
    return one(c, template, 201)
  })

  app.put('/templates/:id', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const { values, error } = templateValues(await body(c), false)
    if (error) return fail(c, 400, error)
    const [template] = await db.update(formTemplates).set({ ...values, updatedAt: new Date() } as any)
      .where(and(eq(formTemplates.id, c.req.param('id')), eq(formTemplates.companyId, companyId))).returning()
    return template ? one(c, template) : fail(c, 404, 'Not found')
  })

  // Deactivate (submissions keep pointing at it).
  app.delete('/templates/:id', requirePermission('care-clients:delete'), async (c) => {
    const { companyId } = who(c)
    const [row] = await db.update(formTemplates).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(formTemplates.id, c.req.param('id')), eq(formTemplates.companyId, companyId))).returning({ id: formTemplates.id })
    return row ? done(c, 'Deactivated') : fail(c, 404, 'Not found')
  })

  // ── submissions ──
  // The office lists every submission; anyone else only the ones they filled in (the same rule as opening one).
  app.get('/submissions', read, async (c) => {
    const { user, companyId, me } = who(c)
    const { entityType, entityId, templateId, status, limit = '50' } = c.req.query()
    const rows = await formSubmissionRows(db, companyId, {
      submittedBy: access.office(user) ? null : me,
      entityType: entityType || undefined, entityId: entityId || undefined, templateId: templateId || undefined, status: status || undefined,
      limit: Math.min(Math.max(parseInt(limit) || 50, 1), 500),
    })
    return whole(c, rows.map((r: any) => ({
      ...r,
      category: r.category || 'general',
      template: r.templateName ? { name: r.templateName, category: r.category || 'general' } : null,
    })))
  })

  app.get('/submissions/:id', read, async (c) => {
    const { user, companyId, me } = who(c)
    const s = await formSubmissionOne(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Not found')
    if (!maySee(user, me, s)) return fail(c, 403, 'Not allowed')
    return one(c, s)
  })

  app.get('/submissions/:id/pdf', read, async (c) => {
    const { user, companyId, me } = who(c)
    const s = await formSubmissionOne(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Submission not found')
    if (!maySee(user, me, s)) return fail(c, 403, 'Not allowed')
    const fields = parseFields(s.templateFields)
    const data = typeof s.data === 'string' ? JSON.parse(s.data) : (s.data || {})
    let entityLine: string | null = null
    if (s.entityType === 'client' && s.entityId) {
      const [cl] = await db.select({ firstName: clients.firstName, lastName: clients.lastName, dateOfBirth: clients.dateOfBirth })
        .from(clients).where(and(eq(clients.id, s.entityId), eq(clients.companyId, companyId))).limit(1)
      if (cl) entityLine = `${cl.firstName} ${cl.lastName}` + (cl.dateOfBirth ? ` · DOB ${ymdToUs(cl.dateOfBirth)}` : '')
    } else if (s.entityName) {
      entityLine = s.entityName
    }
    const [agency] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const tz = await core.time.timezone(companyId)
    const pdf = await formSubmissionPdf({
      agencyName: agency?.name || '',
      templateName: s.templateName || 'Form',
      description: s.description,
      fields,
      data,
      entityLine,
      submissionId: s.id,
      submittedBy: s.submittedByName || 'unknown',
      submittedAt: formatInZone(s.createdAt, tz),
      status: s.status,
      requiresSignature: !!s.requiresSignature,
      signedAt: s.signedAt ? formatInZone(s.signedAt, tz) : null,
      hasSignature: !!s.signature,
    })
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfFileName(`${s.templateName || 'form'}-${String(s.id).slice(0, 8)}.pdf`)}"`,
      },
    })
  })

  app.post('/submissions', requirePermission('evv:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    if (!b.templateId) return fail(c, 400, 'A form template is required')
    const [tpl] = await db.select().from(formTemplates).where(and(eq(formTemplates.id, b.templateId), eq(formTemplates.companyId, companyId))).limit(1)
    if (!tpl) return fail(c, 404, 'Form template not found')
    // A submission is about someone: a client, or a caregiver (HR forms).
    const entityType = b.entityType === 'caregiver' ? 'caregiver' : 'client'
    const entityId = b.entityId || (entityType === 'client' ? b.clientId : null)
    if (!entityId) return fail(c, 400, `Please select a ${entityType} for this form`)
    // A caregiver files a client's form only for a client they serve, and an HR form only about themselves.
    if (entityType === 'client') {
      if (access.office(user) && !(await access.clientInCompany(companyId, entityId))) return fail(c, 404, 'Client not found')
      const refused = await access.careWriteRefusal(c, entityId)
      if (refused) return refused
    } else {
      if (!access.office(user) && entityId !== me) return fail(c, 403, 'You can only file an HR form about yourself.')
      if (!(await access.personInCompany(companyId, entityId))) return fail(c, 404, 'Caregiver not found')
    }
    const data = b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : {}
    const status = ['draft', 'submitted', 'signed'].includes(b.status) ? b.status : 'submitted'
    if (status !== 'draft') {
      const missing = parseFields(tpl.fields).filter((f) => f.required && f.type !== 'section' && isEmptyAnswer(f, data[f.id])).map((f) => f.label)
      if (missing.length) return fail(c, 400, `Please answer: ${missing.join(' · ')}`)
      if (tpl.requiresSignature && !b.signature) return fail(c, 400, 'This form needs a signature')
    }
    const [submitter] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, me)).limit(1)
    const submittedByName = submitter ? `${submitter.firstName} ${submitter.lastName}` : null
    const [submission] = await db.insert(formSubmissions).values({
      companyId,
      templateId: tpl.id,
      templateName: tpl.name,
      entityType,
      entityId,
      clientId: entityType === 'client' ? entityId : null,
      submittedById: me,
      submittedByName,
      data,
      signature: b.signature || null,
      signedAt: b.signature ? new Date() : null,
      status: b.signature && status === 'submitted' ? 'signed' : status,
    }).returning()
    return one(c, submission, 201)
  })

  app.put('/submissions/:id', requirePermission('evv:update'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    const scope = and(eq(formSubmissions.id, c.req.param('id')), eq(formSubmissions.companyId, companyId))
    const [existing] = await db.select({ id: formSubmissions.id, submittedById: formSubmissions.submittedById }).from(formSubmissions).where(scope).limit(1)
    if (!existing) return fail(c, 404, 'Submission not found')
    if (!access.office(user) && existing.submittedById !== me) return fail(c, 403, 'Not allowed')
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) set.data = b.data
    if (b.status) {
      if (!['draft', 'submitted', 'signed', 'archived'].includes(b.status)) return fail(c, 400, 'status is not valid')
      set.status = b.status
    }
    if (b.signature) { set.signature = b.signature; set.signedAt = new Date() }
    const [row] = await db.update(formSubmissions).set(set).where(scope).returning()
    return one(c, row)
  })

  app.delete('/submissions/:id', requirePermission('care-clients:delete'), async (c) => {
    const { companyId } = who(c)
    const [row] = await db.delete(formSubmissions)
      .where(and(eq(formSubmissions.id, c.req.param('id')), eq(formSubmissions.companyId, companyId))).returning({ id: formSubmissions.id })
    return row ? done(c, 'Submission deleted') : fail(c, 404, 'Submission not found')
  })

  return app
}
