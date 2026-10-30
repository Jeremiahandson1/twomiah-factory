// Intake and consent forms (salon gap #6; feature `intake_forms`). The salon builds forms — questions of its own, or an agreement the
// client ticks and signs by typing their name — and a client booking online is offered the ones that apply on their booking's page.
// The answers are kept as asked (so a later change to a form never rewrites what a client said) and show on the client's chart.
import { Hono } from 'hono'
import { and, asc, desc, eq } from 'drizzle-orm'
import { intakeForm, intakeResponse } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export const QUESTION_TYPES = ['text', 'longtext', 'yesno', 'choice', 'consent'] as const
export const FORM_KINDS = ['intake', 'consent'] as const
type Q = { id: string; label: string; type: (typeof QUESTION_TYPES)[number]; required: boolean; options?: string[] }
type FormRow = typeof intakeForm.$inferSelect

/** The questions as saved, or the sentence saying what is wrong with them. */
export function questionsFrom(raw: unknown, kind: string): { questions: Q[] } | { problem: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { problem: 'A form needs at least one question.' }
  if (raw.length > 30) return { problem: 'A form can have at most 30 questions.' }
  const out: Q[] = []
  for (const [i, r] of raw.entries()) {
    const n = i + 1
    const label = String(r?.label || '').trim()
    if (!label) return { problem: `Question ${n} needs its words.` }
    if (label.length > 300) return { problem: `Question ${n} is too long (300 characters at most).` }
    const type = String(r?.type || 'text') as Q['type']
    if (!QUESTION_TYPES.includes(type)) return { problem: `Question ${n}: pick a kind of answer (${QUESTION_TYPES.join(', ')}).` }
    const q: Q = { id: /^[A-Za-z0-9_-]{1,40}$/.test(String(r?.id || '')) ? String(r.id) : `q${n}`, label, type, required: type === 'consent' ? true : !!r?.required }
    if (type === 'choice') {
      const options = (Array.isArray(r?.options) ? r.options : []).map((o: unknown) => String(o || '').trim()).filter(Boolean)
      if (options.length < 2 || options.length > 12) return { problem: `Question ${n}: give 2 to 12 choices.` }
      if (options.some((o: string) => o.length > 80)) return { problem: `Question ${n}: a choice is too long (80 characters at most).` }
      q.options = options
    }
    out.push(q)
  }
  if (new Set(out.map((q) => q.id)).size !== out.length) out.forEach((q, i) => { q.id = `q${i + 1}` })
  if (kind === 'consent' && !out.some((q) => q.type === 'consent')) return { problem: 'A consent form needs an agreement to tick.' }
  return { questions: out }
}

/** The client's answers checked against the form's questions: the record to keep, or the sentence saying what to fix. */
export function answersFor(form: Pick<FormRow, 'kind' | 'questions'>, given: Record<string, unknown>, signedName: string): { answers: Array<{ label: string; type: string; answer: string }>; signed: string | null } | { problem: string } {
  const answers: Array<{ label: string; type: string; answer: string }> = []
  for (const q of form.questions as Q[]) {
    const raw = given[q.id]
    let a = typeof raw === 'string' ? raw.trim().slice(0, q.type === 'longtext' ? 2000 : 300) : ''
    if (q.type === 'consent') a = raw === '1' || raw === 'on' || raw === 'yes' || raw === true ? 'Agreed' : ''
    if (q.type === 'yesno' && a && a !== 'yes' && a !== 'no') return { problem: `Please answer “${q.label}” with yes or no.` }
    if (q.type === 'choice' && a && !(q.options || []).includes(a)) return { problem: `Please pick one of the choices for “${q.label}”.` }
    if (q.required && !a) return { problem: q.type === 'consent' ? `Please tick “${q.label}” to continue.` : `Please answer “${q.label}”.` }
    if (a) answers.push({ label: q.label, type: q.type, answer: q.type === 'yesno' ? (a === 'yes' ? 'Yes' : 'No') : a })
  }
  const signed = String(signedName || '').trim().slice(0, 120)
  if (form.kind === 'consent' && signed.length < 2) return { problem: 'Please type your full name to sign.' }
  return { answers, signed: signed || null }
}

/** What a salon's online booking offers a client: the active forms that apply to this service and that this client has not answered yet. */
export function createIntakeForms(d: { db: any }) {
  const { db } = d

  async function pending(companyId: string, contactId: string, serviceMenuId: string | null) {
    const forms: FormRow[] = await db.select().from(intakeForm).where(and(eq(intakeForm.companyId, companyId), eq(intakeForm.active, true))).orderBy(asc(intakeForm.createdAt))
    const mine = forms.filter((f) => !(f.serviceIds as string[]).length || (!!serviceMenuId && (f.serviceIds as string[]).includes(serviceMenuId)))
    if (!mine.length) return []
    const done: Array<{ formId: string | null }> = await db.select({ formId: intakeResponse.formId }).from(intakeResponse).where(and(eq(intakeResponse.companyId, companyId), eq(intakeResponse.contactId, contactId)))
    const answered = new Set(done.map((r) => r.formId))
    return mine.filter((f) => !answered.has(f.id))
  }

  async function submit(a: { companyId: string; contactId: string; serviceMenuId: string | null; token: string }, formId: string, given: Record<string, unknown>, signedName: string): Promise<string | null> {
    const form = (await pending(a.companyId, a.contactId, a.serviceMenuId)).find((f) => f.id === formId)
    if (!form) return 'This form is not needed for this booking, or you have already filled it in.'
    const got = answersFor(form, given, signedName)
    if ('problem' in got) return got.problem
    try {
      await db.insert(intakeResponse).values({
        companyId: a.companyId, formId: form.id, formName: form.name, formKind: form.kind, contactId: a.contactId, bookingToken: a.token,
        answers: got.answers, signedName: got.signed,
      } as any)
    } catch { /* answered twice at once: the first stands */ }
    return null
  }

  return { pending, submit }
}
export type IntakeForms = ReturnType<typeof createIntakeForms>

export function createIntakeFormRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const parse = (body: any, existing?: FormRow) => {
    const name = String(body.name ?? existing?.name ?? '').trim()
    if (!name) return { problem: 'Give the form a name.', field: 'name' }
    if (name.length > 120) return { problem: 'The name is too long (120 characters at most).', field: 'name' }
    const kind = String(body.kind ?? existing?.kind ?? 'intake')
    if (!FORM_KINDS.includes(kind as any)) return { problem: 'A form is an intake form or a consent form.', field: 'kind' }
    const qs = questionsFrom(body.questions ?? existing?.questions, kind)
    if ('problem' in qs) return { problem: qs.problem, field: 'questions' }
    const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds.map(String) : (existing?.serviceIds as string[] | undefined) ?? []
    return { value: { name, kind, intro: String(body.intro ?? existing?.intro ?? '').trim().slice(0, 1000) || null, questions: qs.questions, serviceIds, active: body.active === undefined ? existing?.active ?? true : !!body.active } }
  }

  app.get('/', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    return listAll(c, await db.select().from(intakeForm).where(eq(intakeForm.companyId, u.companyId)).orderBy(asc(intakeForm.createdAt)))
  })
  app.post('/', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const got = parse((await c.req.json().catch(() => null)) ?? {})
    if ('problem' in got) return fail(c, 400, got.problem as string, 'BAD_FORM', { [got.field ?? 'name']: got.problem as string })
    const [row] = await db.insert(intakeForm).values({ ...got.value, companyId: u.companyId } as any).returning()
    await audit.log({ action: 'create', entity: 'intake_form', entityId: row.id, entityName: row.name, req: { user: u } })
    return one(c, row, 201)
  })
  app.put('/:id', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.select().from(intakeForm).where(and(eq(intakeForm.id, c.req.param('id')), eq(intakeForm.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Form not found')
    const got = parse((await c.req.json().catch(() => null)) ?? {}, row)
    if ('problem' in got) return fail(c, 400, got.problem as string, 'BAD_FORM', { [got.field ?? 'name']: got.problem as string })
    const [updated] = await db.update(intakeForm).set({ ...got.value, updatedAt: new Date() } as any).where(eq(intakeForm.id, row.id)).returning()
    await audit.log({ action: 'update', entity: 'intake_form', entityId: row.id, changes: audit.diff(row, updated), req: { user: u } })
    return one(c, updated)
  })
  app.delete('/:id', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.select().from(intakeForm).where(and(eq(intakeForm.id, c.req.param('id')), eq(intakeForm.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Form not found')
    await db.delete(intakeForm).where(eq(intakeForm.id, row.id))      // answers already given stay on the chart, as asked
    await audit.log({ action: 'delete', entity: 'intake_form', entityId: row.id, entityName: row.name, req: { user: u } })
    return one(c, { success: true })
  })

  // A client's answers, newest first (their chart).
  app.get('/responses', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const contactId = c.req.query('contactId')
    if (!contactId) return fail(c, 400, 'Say which client.', 'BAD_REQUEST')
    return listAll(c, await db.select().from(intakeResponse).where(and(eq(intakeResponse.companyId, u.companyId), eq(intakeResponse.contactId, contactId))).orderBy(desc(intakeResponse.createdAt)))
  })

  return app
}
