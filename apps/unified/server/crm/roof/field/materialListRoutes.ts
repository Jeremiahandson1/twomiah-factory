// The material list at /api/material-list (feature roof_material_list — not ready, hidden): a roof's squares → what to
// order, then "create material order" from the list the roofer has edited (docs/parity/roof-material-list.md).
//
//   GET  /assumptions            the numbers a list is worked from, with their words                   (any signed-in seat)
//   POST /calculate              a list for squares (and lengths) the caller sends — nothing stored     jobs:read
//   GET  /jobs/:jobId            a list for the job: its squares (entered on the job, else its newest   jobs:read
//                                measurement report's), ?wastePercent= and the other assumptions, ?templateId= a saved template
//   POST /jobs/:jobId/order      the edited list → a material order on the job                          inventory:create
//   GET/POST/PUT/DELETE /api/material-list/templates   saved assumption sets with standing extra lines (./materialListTemplates.ts,
//                                mounted beside this router in ./index.ts)
//   GET  /orders/:id/pdf         the material order as a printable PDF (prices only for a seat with margin:read)  any signed-in seat
//   GET  /jobs/:jobId/quote-lines  the material lines of the job's signed (approved) quotes, newest first     jobs:read
//   POST /jobs/:jobId/provider-report   an EagleView / HOVER / GAF report keyed in from its PDF: its squares and   measurements:create
//                                       lengths become the job's measurement, and the list is worked from them
//
// The arithmetic is materialList.ts. The order it makes is a plain material order (field/materials.ts): the same table,
// the same Materials screen, the same cost rule (no price is stored — the supplier's quote is the price — so there is
// nothing to withhold). A Field login reaches only the jobs it is on (seatJob.ts).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { job, material, materialListTemplate, measurementReport, quote, quoteLineItem } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { normaliseLineItems } from '../validation.ts'
import { orderReference } from './materials.ts'
import { PROVIDERS, PROVIDER_LABELS, listLengths, reportChoicesFor, type ReportChoice } from '../reportLengths.ts'
import { ASSUMPTION_LABELS, DEFAULT_ASSUMPTIONS, buildMaterialList, type Lengths } from '../materialList.ts'
import { createSeatJob } from './seatJob.ts'
import { shapeTemplate } from './materialListTemplates.ts'
import { buildOrderDocument, orderFileName, renderOrderPdf } from './materialOrderDocument.ts'
import { materialStatusLabel } from '../materialStatus.ts'

const num = z.coerce.number().finite().nonnegative()
const lengthsSchema = z.object({ eaveFt: num.optional(), rakeFt: num.optional(), ridgeFt: num.optional(), valleyFt: num.optional() })
/** The assumptions the caller may change: any subset, each a number (ventType a word). Unknown keys are ignored by the maths. */
const assumptionsSchema = z.record(z.string(), z.union([z.string(), z.number()])).optional()

const calculateSchema = z.object({
  squares: num,
  lengths: lengthsSchema.optional(),
  assumptions: assumptionsSchema,
})

const providerReportSchema = z.object({
  provider: z.enum(PROVIDERS),
  /** The provider's own report or order number, to find it again. */
  reportNumber: z.string().trim().max(60).optional(),
  squares: z.coerce.number().finite().positive('Enter the roof squares from the report.'),
  areaSqft: num.optional(),
  eaveFt: num.default(0), rakeFt: num.default(0), ridgeFt: num.default(0), hipFt: num.default(0), valleyFt: num.default(0),
}).refine((v) => v.eaveFt + v.rakeFt + v.ridgeFt + v.hipFt + v.valleyFt > 0, { message: 'Enter at least one length from the report (eave, rake, ridge, hip or valley).', path: ['eaveFt'] })

const orderSchema = z.object({
  supplier: z.string().trim().min(1, 'Enter the supplier.'),
  /** The list as the roofer left it (edited quantities, lines added or removed). */
  lines: z.array(z.object({
    description: z.string().trim().min(1),
    qty: z.coerce.number().finite().positive('Each line needs a quantity above 0.'),
    unit: z.string().trim().optional(),
    code: z.string().optional(),
  })).min(1, 'The list is empty.'),
  /** What it was worked from, kept in the order's notes so the order can be read back. */
  squares: num.optional(),
  wastePercent: num.optional(),
  deliveryAddress: z.string().trim().optional(),
  deliveryDate: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Where the list came from when it was not worked from the squares ("Material list from signed quote Q-0012."). */
  sourceNote: z.string().trim().max(200).optional(),
  poNumber: z.string().trim().max(60).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  contactEmail: z.union([z.literal(''), z.string().trim().email('contactEmail: Enter a valid email address.')]).optional(),
})

export function createMaterialListRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const seatJob = createSeatJob(d)
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  app.get('/assumptions', (c) => one(c, { defaults: DEFAULT_ASSUMPTIONS, labels: ASSUMPTION_LABELS }))

  app.post('/calculate', requirePermission('jobs:read'), async (c) => {
    const parsed = calculateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    return one(c, buildMaterialList(parsed.data.squares, parsed.data.lengths as Lengths, parsed.data.assumptions))
  })

  /** The squares a job is worked from: its own total, else its measurement report's. */
  async function squaresOf(companyId: string, row: any): Promise<{ squares: number | null; source: 'job' | 'measurement' | null; reportId?: string }> {
    const own = Number(row.totalSquares)
    if (Number.isFinite(own) && own > 0) return { squares: own, source: 'job' }
    const reports = await db.select().from(measurementReport)
      .where(and(eq(measurementReport.companyId, companyId), eq(measurementReport.jobId, row.id)))
      .orderBy(desc(measurementReport.createdAt)).limit(10)
    // The report the job points at first, else the newest that has a figure.
    const ordered = [...reports].sort((a: any, b: any) => Number(b.id === row.measurementReportId) - Number(a.id === row.measurementReportId))
    const hit = ordered.find((r: any) => Number(r.totalSquares) > 0)
    return hit ? { squares: Number(hit.totalSquares), source: 'measurement', reportId: hit.id } : { squares: null, source: null }
  }

  app.get('/jobs/:jobId', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const row = await seatJob(c, c.req.param('jobId'))
    if (!row) return fail(c, 404, 'Job not found')
    const found = await squaresOf(me.companyId, row)
    // The caller can type squares of their own (a re-measure on the roof) and the lengths they took.
    const q = c.req.query()
    const typed = q.squares !== undefined && q.squares !== '' ? Number(q.squares) : undefined
    // The reports that carry real lengths for THIS job (its homeowner's, at its address, or a provider's keyed in on it).
    const choices = await reportChoicesFor(db, me.companyId, row)
    let chosen: ReportChoice | null = choices[0] ?? null
    if (q.reportId) {
      chosen = choices.find((r) => r.id === q.reportId) ?? null
      if (!chosen) return fail(c, 404, 'That report is not one this job can be worked from.')
    } else if (q.reportId === '' || q.lengthsFrom === 'none') chosen = null
    // Squares: typed, else the job's, else its measurement report's, else (a job with none of those) the report the lengths come from.
    let squares = typed !== undefined && Number.isFinite(typed) && typed > 0 ? typed : found.squares
    let squaresSource: string | null = typed !== undefined && squares === typed ? 'typed' : found.source
    if (squares == null && chosen?.squares) { squares = chosen.squares; squaresSource = chosen.kind }
    const lengths: Lengths = {}
    const lengthSources: Record<string, string> = {}
    const fromReport = chosen ? listLengths(chosen.lengths) : null
    for (const k of ['eaveFt', 'rakeFt', 'ridgeFt', 'valleyFt'] as const) {
      if (q[k] !== undefined && q[k] !== '' && Number.isFinite(Number(q[k]))) { lengths[k] = Number(q[k]); lengthSources[k] = 'typed' }
      else if (fromReport) { lengths[k] = fromReport[k]; lengthSources[k] = chosen!.kind }
      else lengthSources[k] = k === 'valleyFt' ? 'none' : 'estimated'
    }
    // A saved template's assumptions, with anything typed here laid over them; its standing extra lines go after the worked ones.
    let template: any = null
    if (q.templateId) {
      template = (await db.select().from(materialListTemplate).where(and(eq(materialListTemplate.id, q.templateId), eq(materialListTemplate.companyId, me.companyId))).limit(1))[0]
      if (!template) return fail(c, 404, 'Template not found')
    }
    const over: Record<string, unknown> = { ...(template?.assumptions ?? {}) }
    for (const k of Object.keys(DEFAULT_ASSUMPTIONS)) if (q[k] !== undefined && q[k] !== '') over[k] = q[k]
    const list = buildMaterialList(squares ?? 0, lengths, over as any)
    if (template && list.lines.length) {
      ;((template.extraLines ?? []) as Array<{ description: string; qty: number; unit?: string }>).forEach((l, i) =>
        list.lines.push({ code: `template-${i + 1}`, description: l.description, qty: l.qty, unit: l.unit || 'ea', basis: `From the template "${template.name}"` }))
    }
    return one(c, {
      template: template ? shapeTemplate(template) : null,
      jobId: row.id, jobNumber: row.number, address: row.address ?? row.propertyAddress ?? null,
      squaresSource,
      lengthSources,
      lengthsReport: chosen ? { id: chosen.id, kind: chosen.kind, label: chosen.label, provider: chosen.provider ?? null, createdAt: chosen.createdAt } : null,
      reportChoices: choices.map((r) => ({ id: r.id, kind: r.kind, label: r.label, provider: r.provider ?? null, createdAt: r.createdAt })),
      ...list,
    })
  })

  // The order as a document to print or keep (Roofr: download the order). Anyone who can read the Materials list can print an
  // order, as the list is not scoped to a seat's own jobs; what the business paid is in it only for a seat that may see it.
  app.get('/orders/:id/pdf', async (c) => {
    const me = c.get('user')
    const [order] = await db.select().from(material).where(and(eq(material.id, c.req.param('id')), eq(material.companyId, me.companyId))).limit(1)
    if (!order) return fail(c, 404, 'Material order not found')
    let showPrices = false
    try { showPrices = !!(await canSee(me.role, 'margin:read', me.userId)) } catch { showPrices = false }
    const doc = await buildOrderDocument(db, me.companyId, order, { showPrices })
    const pdf = await renderOrderPdf(doc, materialStatusLabel(doc.status))
    return c.body(new Uint8Array(pdf), 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${orderFileName(doc)}"`, 'Cache-Control': 'no-store' })
  })

  // The material lines of the job's signed quotes (Roofr: an order from the signed proposal). A quote is "signed" here when it is
  // approved — the customer's signature, or the office approving it; `signedAt` says which. Only lines the customer is paying for
  // count (a line of a Good / Better / Best option the customer did not choose, or an add-on left unticked, is not selected).
  // What a line sells for is never sent: the order is for the supplier's prices, not the customer's.
  app.get('/jobs/:jobId/quote-lines', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const row = await seatJob(c, c.req.param('jobId'))
    if (!row) return fail(c, 404, 'Job not found')
    const quotes = await db.select().from(quote)
      .where(and(eq(quote.companyId, me.companyId), eq(quote.jobId, row.id), eq(quote.status, 'approved')))
      .orderBy(desc(quote.approvedAt), desc(quote.createdAt)).limit(10)
    const lines = quotes.length
      ? await db.select().from(quoteLineItem)
        .where(and(inArray(quoteLineItem.quoteId, quotes.map((q: any) => q.id)), inArray(quoteLineItem.type, ['material', 'part']), eq(quoteLineItem.selected, true)))
        .orderBy(asc(quoteLineItem.sortOrder), asc(quoteLineItem.id))
      : []
    return one(c, {
      quotes: quotes.map((q: any) => ({
        id: q.id, number: q.number, name: q.name, signed: !!q.signedAt, signedBy: q.signedBy ?? null,
        signedAt: q.signedAt ? new Date(q.signedAt).toISOString() : null, approvedAt: q.approvedAt ? new Date(q.approvedAt).toISOString() : null,
        lines: lines.filter((l: any) => l.quoteId === q.id).map((l: any, i: number) => ({
          code: `quote-${l.id}`, description: l.description, qty: Number(l.quantity), unit: 'ea',
          basis: `Quote ${q.number}, material line ${i + 1}${l.section ? ` (${l.section})` : ''}`,
        })).filter((l: any) => l.qty > 0),
      })),
    })
  })

  // A provider's report keyed in from its PDF. The provider's own API (ordering a report, receiving it by webhook) needs the
  // roofer's provider account and developer credentials and is not built (docs/integration-eagleview-hover.md).
  app.post('/jobs/:jobId/provider-report', requirePermission('measurements:create'), async (c) => {
    const me = c.get('user')
    const row = await seatJob(c, c.req.param('jobId'))
    if (!row) return fail(c, 404, 'Job not found')
    const parsed = providerReportSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const v = parsed.data
    const lengths = { eaveFt: v.eaveFt, rakeFt: v.rakeFt, ridgeFt: v.ridgeFt, hipFt: v.hipFt, valleyFt: v.valleyFt }
    const created = await db.transaction(async (tx: any) => {
      const [made] = await tx.insert(measurementReport).values({
        companyId: me.companyId, jobId: row.id,
        address: row.address ?? '', city: row.city ?? '', state: row.state ?? '', zip: row.zip ?? '',
        provider: v.provider, status: 'complete', totalSquares: String(v.squares), totalArea: String(v.areaSqft ?? Math.round(v.squares * 100)),
        cost: '0.00', externalProvider: v.provider, externalOrderId: v.reportNumber || null, externalStatus: 'keyed_in',
        rawData: { keyedIn: true, importedFrom: PROVIDER_LABELS[v.provider], importedById: me.userId, lengths },
      } as any).returning()
      // The job points at the newest measurement; its squares are filled in only where the roofer has not entered their own.
      await tx.update(job).set({
        measurementReportId: made.id, ...(Number(row.totalSquares) > 0 ? {} : { totalSquares: String(v.squares) }), updatedAt: new Date(),
      } as any).where(and(eq(job.id, row.id), eq(job.companyId, me.companyId)))
      return made
    })
    return one(c, { id: created.id, provider: v.provider, label: `${PROVIDER_LABELS[v.provider]} report${v.reportNumber ? ` ${v.reportNumber}` : ''}`, squares: v.squares, lengths }, 201)
  })

  app.post('/jobs/:jobId/order', requirePermission('inventory:create'), async (c) => {
    const me = c.get('user')
    // A material order is the Materials feature's; with it off there is nowhere for the order to live.
    if (!(await d.features.isFeatureEnabled(me.companyId, 'materials'))) return fail(c, 403, 'Materials is not switched on for this account.', 'feature_disabled')
    const row = await seatJob(c, c.req.param('jobId'))
    if (!row) return fail(c, 404, 'Job not found')
    const parsed = orderSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    let deliveryDate: Date | null = null
    if (data.deliveryDate) {
      deliveryDate = new Date(data.deliveryDate)
      if (Number.isNaN(deliveryDate.getTime())) return fail(c, 400, 'deliveryDate: Enter a valid date.')
    }
    const { lineItems, total } = normaliseLineItems(data.lines.map((l) => ({ description: l.description, qty: l.qty, unit: l.unit || 'ea', ...(l.code ? { code: l.code } : {}) })) as any)
    const from = data.sourceNote ? data.sourceNote : data.squares ? `Material list for ${data.squares} squares${data.wastePercent !== undefined ? ` with ${data.wastePercent}% waste` : ''}.` : 'Material list.'
    const [created] = await db.insert(material).values({
      companyId: me.companyId, jobId: row.id, supplier: data.supplier, orderStatus: 'not_ordered',
      deliveryDate, lineItems, totalCost: total.toFixed(2),
      deliveryAddress: data.deliveryAddress || [row.address, row.city, row.state, row.zip].filter(Boolean).join(', ') || null,
      notes: [from, data.notes].filter(Boolean).join(' '),
      ...orderReference(data),
    } as any).returning()
    return one(c, created, 201)
  })

  return app
}
