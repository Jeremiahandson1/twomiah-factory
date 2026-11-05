// Saved starting points for inspection reports (docs/parity/roof-inspection-report.md #14), at /api/inspection-reports/templates:
//   GET    /          the company's templates                                           jobs:read
//   POST   /          { name, intro, sections, layout }  or  { name, fromReportId }      jobs:update
//   PUT    /:id       change one                                                         jobs:update
//   DELETE /:id                                                                          jobs:delete
// A template is the company's own (not a job's): its sections are titles and notes, each with the KIND of job photo that fills
// it ('damage', 'before' ...), plus an introduction and a layout. Building a report from one is POST /api/inspection-reports
// with { templateId } (./routes.ts), which fills each section from the job's own photos.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { inspectionReport, inspectionReportTemplate, jobPhoto } from '../../../db/schema/index.ts'
import { cleanLines, cleanText } from '../../../core/sanitize.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { createSeatJob } from '../seatJob.ts'
import { JOB_PHOTO_TYPES } from '../validation.ts'
import { layoutBody, layoutOf } from './layout.ts'
import { sectionsOf } from './view.ts'

export const MAX_TEMPLATE_SECTIONS = 20

export const templateSection = z.object({
  title: cleanText(1).pipe(z.string().max(80, 'A section title is 80 characters at most')),
  notes: cleanLines().pipe(z.string().max(2000, 'Section notes are 2000 characters at most')).default(''),
  photoType: z.enum(JOB_PHOTO_TYPES).nullable().default(null),
})
const templateBody = z.object({
  name: cleanText(1).pipe(z.string().max(80, 'A template name is 80 characters at most')),
  intro: cleanLines().pipe(z.string().max(4000, 'The introduction is 4000 characters at most')).default(''),
  sections: z.array(templateSection).max(MAX_TEMPLATE_SECTIONS, `A template holds ${MAX_TEMPLATE_SECTIONS} sections at most`),
  layout: layoutBody.optional(),
})

export type TemplateSection = z.infer<typeof templateSection>
/** The sections a template row holds, whatever shape an old or hand-edited row has. */
export function templateSectionsOf(raw: unknown): TemplateSection[] {
  if (!Array.isArray(raw)) return []
  return raw.map((s: any) => ({
    title: String(s?.title ?? '').slice(0, 80), notes: String(s?.notes ?? ''),
    photoType: (JOB_PHOTO_TYPES as readonly string[]).includes(s?.photoType) ? s.photoType : null,
  }))
}

export const templateView = (r: any) => ({
  id: r.id, name: r.name, intro: r.intro || '', sections: templateSectionsOf(r.sections), layout: layoutOf(r.layout), updatedAt: new Date(r.updatedAt).toISOString(),
})

/** Adds the template doors to the office router (before its /:id doors, so "templates" is never read as a report's id). */
export function addTemplateRoutes(app: Hono<AppEnv>, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const jobFor = createSeatJob(d)
  const taken = (c: any) => fail(c, 409, 'A template with that name already exists.', 'duplicate', { name: 'Choose another name' })
  const nameTaken = async (companyId: string, name: string, exceptId?: string) =>
    (await db.select({ id: inspectionReportTemplate.id }).from(inspectionReportTemplate).where(and(eq(inspectionReportTemplate.companyId, companyId), eq(inspectionReportTemplate.name, name)))).some((r: any) => r.id !== exceptId)

  app.get('/templates', requirePermission('jobs:read'), async (c) => {
    const rows = await db.select().from(inspectionReportTemplate).where(eq(inspectionReportTemplate.companyId, c.get('user').companyId)).orderBy(asc(inspectionReportTemplate.name))
    return listAll(c, rows.map(templateView))
  })

  app.post('/templates', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const raw: any = (await c.req.json().catch(() => null)) ?? {}
    // "Save this report as a template": its titles, notes, introduction and layout; each section takes the one kind of photo
    // it holds (none when they are mixed or general), so the next report fills itself from that kind.
    if (typeof raw.fromReportId === 'string') {
      const name = cleanText(1).pipe(z.string().max(80)).safeParse(raw.name)
      if (!name.success) return invalid(c, name.error)
      const [r] = await db.select().from(inspectionReport).where(and(eq(inspectionReport.id, raw.fromReportId), eq(inspectionReport.companyId, me.companyId))).limit(1)
      if (!r || !(await jobFor(c, r.jobId))) return fail(c, 404, 'Report not found')
      if (await nameTaken(me.companyId, name.data)) return taken(c)
      const secs = sectionsOf(r.sections)
      const ids = [...new Set(secs.flatMap((s) => s.photoIds))]
      const types = new Map<string, string>(ids.length
        ? (await db.select({ id: jobPhoto.id, photoType: jobPhoto.photoType }).from(jobPhoto).where(and(inArray(jobPhoto.id, ids), eq(jobPhoto.jobId, r.jobId), eq(jobPhoto.companyId, me.companyId)))).map((p: any) => [p.id, p.photoType] as [string, string])
        : [])
      const sections = secs.map((s) => {
        const kinds = [...new Set(s.photoIds.map((id) => types.get(id)).filter(Boolean))] as string[]
        return { title: s.title, notes: s.notes, photoType: kinds.length === 1 && kinds[0] !== 'general' ? kinds[0] : null }
      })
      const [made] = await db.insert(inspectionReportTemplate).values({ companyId: me.companyId, name: name.data, intro: r.intro || null, sections, layout: layoutOf(r.layout), createdById: me.userId } as any).returning()
      return one(c, templateView(made), 201)
    }
    const parsed = templateBody.safeParse(raw)
    if (!parsed.success) return invalid(c, parsed.error)
    if (await nameTaken(me.companyId, parsed.data.name)) return taken(c)
    const [made] = await db.insert(inspectionReportTemplate).values({
      companyId: me.companyId, name: parsed.data.name, intro: parsed.data.intro || null, sections: parsed.data.sections, layout: layoutOf(parsed.data.layout), createdById: me.userId,
    } as any).returning()
    return one(c, templateView(made), 201)
  })

  app.put('/templates/:id', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const [t] = await db.select().from(inspectionReportTemplate).where(and(eq(inspectionReportTemplate.id, c.req.param('id')), eq(inspectionReportTemplate.companyId, me.companyId))).limit(1)
    if (!t) return fail(c, 404, 'Template not found')
    const raw: any = (await c.req.json().catch(() => null)) ?? {}
    const parsed = templateBody.safeParse({ name: raw.name ?? t.name, intro: raw.intro ?? t.intro ?? '', sections: raw.sections ?? templateSectionsOf(t.sections), layout: raw.layout ?? layoutOf(t.layout) })
    if (!parsed.success) return invalid(c, parsed.error)
    if (await nameTaken(me.companyId, parsed.data.name, t.id)) return taken(c)
    const [saved] = await db.update(inspectionReportTemplate).set({ name: parsed.data.name, intro: parsed.data.intro || null, sections: parsed.data.sections, layout: layoutOf(parsed.data.layout), updatedAt: new Date() } as any)
      .where(and(eq(inspectionReportTemplate.id, t.id), eq(inspectionReportTemplate.companyId, me.companyId))).returning()
    return one(c, templateView(saved))
  })

  app.delete('/templates/:id', requirePermission('jobs:delete'), async (c) => {
    const me = c.get('user')
    const gone = await db.delete(inspectionReportTemplate).where(and(eq(inspectionReportTemplate.id, c.req.param('id')), eq(inspectionReportTemplate.companyId, me.companyId))).returning({ id: inspectionReportTemplate.id })
    return gone.length ? c.body(null, 204) : fail(c, 404, 'Template not found')
  })

}
