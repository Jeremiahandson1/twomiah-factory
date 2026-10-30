// The material list at /api/material-list (feature roof_material_list — not ready, hidden): a roof's squares → what to
// order, then "create material order" from the list the roofer has edited (docs/parity/roof-material-list.md).
//
//   GET  /assumptions            the numbers a list is worked from, with their words                   (any signed-in seat)
//   POST /calculate              a list for squares (and lengths) the caller sends — nothing stored     jobs:read
//   GET  /jobs/:jobId            a list for the job: its squares (entered on the job, else its newest   jobs:read
//                                measurement report's), ?wastePercent= and the other assumptions
//   POST /jobs/:jobId/order      the edited list → a material order on the job                          inventory:create
//
// The arithmetic is materialList.ts. The order it makes is a plain material order (field/materials.ts): the same table,
// the same Materials screen, the same cost rule (no price is stored — the supplier's quote is the price — so there is
// nothing to withhold). A Field login reaches only the jobs it is on (seatJob.ts).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { job, material, measurementReport } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { normaliseLineItems } from '../validation.ts'
import { ASSUMPTION_LABELS, DEFAULT_ASSUMPTIONS, buildMaterialList, type Lengths } from '../materialList.ts'
import { createSeatJob } from './seatJob.ts'

const num = z.coerce.number().finite().nonnegative()
const lengthsSchema = z.object({ eaveFt: num.optional(), rakeFt: num.optional(), ridgeFt: num.optional(), valleyFt: num.optional() })
/** The assumptions the caller may change: any subset, each a number (ventType a word). Unknown keys are ignored by the maths. */
const assumptionsSchema = z.record(z.string(), z.union([z.string(), z.number()])).optional()

const calculateSchema = z.object({
  squares: num,
  lengths: lengthsSchema.optional(),
  assumptions: assumptionsSchema,
})

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
})

export function createMaterialListRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const seatJob = createSeatJob(d)
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
    const squares = typed !== undefined && Number.isFinite(typed) && typed > 0 ? typed : found.squares
    const lengths: Lengths = {}
    for (const k of ['eaveFt', 'rakeFt', 'ridgeFt', 'valleyFt'] as const) if (q[k] !== undefined && q[k] !== '' && Number.isFinite(Number(q[k]))) lengths[k] = Number(q[k])
    const over: Record<string, string> = {}
    for (const k of Object.keys(DEFAULT_ASSUMPTIONS)) if (q[k] !== undefined && q[k] !== '') over[k] = q[k]
    const list = buildMaterialList(squares ?? 0, lengths, over)
    return one(c, {
      jobId: row.id, jobNumber: row.number, address: row.address ?? row.propertyAddress ?? null,
      squaresSource: typed !== undefined && squares === typed ? 'typed' : found.source,
      ...list,
    })
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
    const from = data.squares ? `Material list for ${data.squares} squares${data.wastePercent !== undefined ? ` with ${data.wastePercent}% waste` : ''}.` : 'Material list.'
    const [created] = await db.insert(material).values({
      companyId: me.companyId, jobId: row.id, supplier: data.supplier, orderStatus: 'not_ordered',
      deliveryDate, lineItems, totalCost: total.toFixed(2),
      deliveryAddress: data.deliveryAddress || [row.address, row.city, row.state, row.zip].filter(Boolean).join(', ') || null,
      notes: [from, data.notes].filter(Boolean).join(' '),
    } as any).returning()
    return one(c, created, 201)
  })

  return app
}
