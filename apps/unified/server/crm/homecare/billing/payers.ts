// Payers: a payer is a referral_sources row. Billing, claims, EVV and the punch rules classify it by payerType
// (claimsEngine, payerRouter.PAYER_ROUTES, timeTracking.isPrivate, reports) — never by `type`, which is the
// referral-source kind. Moved from templates/crm-homecare/backend/src/routes/payers.ts. The Payers screen and this route
// share PAYER_FIELDS; only those fields are written (E2E Run 3, 10/16).
//
// Who: the list was open to anyone signed in (a caregiver's client screens read it), so it is care-clients:read — which
// the caregiver holds — or care-billing:read. Adding and editing a payer was requireAdmin: care-billing:create / :update.
//
// Changes from the template: the company's payers only; the list is { data, pagination }.
import { Hono } from 'hono'
import { and, eq, desc, asc } from 'drizzle-orm'
import { referralSources } from '../../../db/schema/index.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import { who } from './shared.ts'

export const PAYER_TYPES = [
  'MCO', 'IRIS', 'medicaid', 'HMO', 'medicare', 'va', 'managed_care', 'private_pay', 'other',
  // Accepted for rows that already carry them (seed / imports); the screen offers the list above.
  'mco_family_care', 'FFS',
] as const
export const PAYER_FIELDS = [
  'name', 'payerType', 'contactName', 'email', 'phone', 'address', 'city', 'state', 'zip',
  'payerIdNumber', 'npi', 'isActivePayer', 'notes', 'expectedPayDays', 'submissionMethod',
  'sandataEvvRequired', 'sandataPayerId', 'sandataPayerProgram',
] as const
const BOOLEANS = new Set(['isActivePayer', 'sandataEvvRequired'])

/** The writable payer fields of a body, trimmed (blank → null), or the reason it is refused. */
export function payerData(b: any): { data: Record<string, any>; error?: string } {
  const data: Record<string, any> = {}
  if (!b || typeof b !== 'object') return { data, error: 'Expected a JSON object' }
  for (const k of PAYER_FIELDS) {
    if (b[k] === undefined) continue
    const v = b[k]
    if (BOOLEANS.has(k)) data[k] = v === true
    else if (k === 'expectedPayDays') {
      if (v === null || v === '') continue
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0 || n > 365) return { data, error: 'Expected pay days must be a whole number of days (0–365)' }
      data[k] = n
    } else data[k] = v === null ? null : String(v).trim() || null
  }
  if (data.name === null) return { data, error: 'Name is required' }
  if (data.payerType !== undefined && !(PAYER_TYPES as readonly string[]).includes(data.payerType)) {
    return { data, error: `Unknown payer type "${data.payerType}"` }
  }
  return { data }
}

export function createPayerRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission, requireAnyPermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET / — the company's active referral sources, payers first. A list reply.
  app.get('/', requireAnyPermission(['care-clients:read', 'care-billing:read']), async (c) => {
    const rows = await db.select().from(referralSources)
      .where(and(eq(referralSources.companyId, who(c).companyId), eq(referralSources.isActive, true)))
      .orderBy(desc(referralSources.isActivePayer), asc(referralSources.name))
    return listAll(c, rows)
  })

  // POST /
  app.post('/', requirePermission('care-billing:create'), async (c) => {
    const { data, error } = payerData(await c.req.json().catch(() => null))
    if (error) return fail(c, 400, error)
    if (!data.name) return fail(c, 400, 'Name is required')
    data.payerType = data.payerType || 'other'
    // The referral-source kind, as the seed sets it for payers.
    data.type = data.payerType === 'private_pay' ? 'private_pay' : 'insurance'
    const [payer] = await db.insert(referralSources).values({ ...(data as any), companyId: who(c).companyId }).returning()
    return one(c, payer, 201)
  })

  // PUT /:id
  app.put('/:id', requirePermission('care-billing:update'), async (c) => {
    const { data, error } = payerData(await c.req.json().catch(() => null))
    if (error) return fail(c, 400, error)
    const [payer] = await db.update(referralSources).set({ ...data, updatedAt: new Date() })
      .where(and(eq(referralSources.id, c.req.param('id')), eq(referralSources.companyId, who(c).companyId))).returning()
    if (!payer) return fail(c, 404, 'Payer not found')
    return one(c, payer)
  })

  return app
}
