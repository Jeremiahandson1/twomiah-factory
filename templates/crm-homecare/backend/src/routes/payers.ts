import { Hono } from 'hono'
import { eq, desc, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { referralSources } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// A payer is a referral_sources row. Billing, claims, EVV and the punch rules classify it by payer_type
// (claimsEngine, payerRouter.PAYER_ROUTES, timeTracking.isPrivate, reports) — never by `type`, which is the
// referral-source kind. Until E2E Run 3 (10/16) the Payers screen wrote `type` and left payer_type at
// 'other', and sent contactEmail / contactPhone / payerId, which are not columns, so they were dropped.
// The screen and this route now share these names, and only these fields are written.
export const PAYER_TYPES = [
  'MCO', 'IRIS', 'medicaid', 'HMO', 'medicare', 'va', 'managed_care', 'private_pay', 'other',
  // Accepted for rows that already carry them (seed / imports); the screen offers the list above.
  'mco_family_care', 'FFS',
] as const
const PAYER_FIELDS = [
  'name', 'payerType', 'contactName', 'email', 'phone', 'address', 'city', 'state', 'zip',
  'payerIdNumber', 'npi', 'isActivePayer', 'notes', 'expectedPayDays', 'submissionMethod',
  'sandataEvvRequired', 'sandataPayerId', 'sandataPayerProgram',
] as const
const BOOLEANS = new Set(['isActivePayer', 'sandataEvvRequired'])

function payerData(body: any): { data: Record<string, any>; error?: string } {
  const data: Record<string, any> = {}
  if (!body || typeof body !== 'object') return { data, error: 'Expected a JSON object' }
  for (const k of PAYER_FIELDS) {
    if (body[k] === undefined) continue
    const v = body[k]
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

// GET /
app.get('/', async (c) => {
  const payers = await db
    .select()
    .from(referralSources)
    .where(eq(referralSources.isActive, true))
    .orderBy(desc(referralSources.isActivePayer), asc(referralSources.name))
  return c.json(payers)
})

// POST /
app.post('/', requireAdmin, async (c) => {
  const { data, error } = payerData(await c.req.json().catch(() => null))
  if (error) return c.json({ error }, 400)
  if (!data.name) return c.json({ error: 'Name is required' }, 400)
  data.payerType = data.payerType || 'other'
  // The referral-source kind, as the seed sets it for payers.
  data.type = data.payerType === 'private_pay' ? 'private_pay' : 'insurance'
  const [payer] = await db.insert(referralSources).values(data as any).returning()
  return c.json(payer, 201)
})

// PUT /:id
app.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const { data, error } = payerData(await c.req.json().catch(() => null))
  if (error) return c.json({ error }, 400)
  const [payer] = await db.update(referralSources).set({ ...data, updatedAt: new Date() }).where(eq(referralSources.id, id)).returning()
  if (!payer) return c.json({ error: 'Payer not found' }, 404)
  return c.json(payer)
})

export default app
