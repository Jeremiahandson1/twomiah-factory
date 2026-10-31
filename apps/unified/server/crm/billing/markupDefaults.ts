// /api/markup-defaults — the company's usual markup on our cost, by kind of line (feature markup_defaults, not ready):
//   GET  /   margin:read     { labor, material, part, service, other }: a percent each, or null for "none set"
//   PUT  /   company:update  change them — the owner and admins, as PUT /api/company
// A markup is cost-side (it tells the reader what the work costs us), so reading it asks margin:read, the permission the quote
// route strips line cost on. The quote form reads these and, on a line with a cost and a kind but no price typed, fills the
// markup and the price from them — visibly, in the line's own Markup column, where it can be changed. The server does not
// price a quote from them: a quote's lines are what the form sent, so a saved quote never changes when the defaults do.
// Nothing here moves money.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

export const LINE_KINDS = ['labor', 'material', 'part', 'service', 'other'] as const
export type MarkupDefaults = Record<typeof LINE_KINDS[number], number | null>

/** The company's markup defaults, every gap filled in as "none set". */
export function markupDefaultsOf(settings: unknown): MarkupDefaults {
  let s: any = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = null } }
  const m = s?.markupDefaults || {}
  const out = {} as MarkupDefaults
  for (const k of LINE_KINDS) {
    const v = m[k]
    out[k] = v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1000 ? null : Math.round(Number(v) * 10) / 10
  }
  return out
}

const pct = z.number({ error: 'Enter a percent, for example 25' }).min(0, 'A markup cannot be negative').max(1000, 'At most 1000%').nullable()
const schema = z.object({ labor: pct, material: pct, part: pct, service: pct, other: pct })

export function createMarkupDefaultsRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('margin:read'), async (c) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    return one(c, markupDefaultsOf(co?.settings))
  })

  app.put('/', requirePermission('company:update'), async (c) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = markupDefaultsOf(settings)
    const next = markupDefaultsOf({ markupDefaults: parsed.data })
    await db.update(company).set({ settings: { ...settings, markupDefaults: next }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { markupDefaults: { before, after: next } }, req: c })
    return one(c, next)
  })

  return app
}
