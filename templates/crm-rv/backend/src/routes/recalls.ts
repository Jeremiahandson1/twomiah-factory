import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { unit } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

/**
 * Recall Lookup — open NHTSA safety recalls by make/model/year or VIN.
 *
 * Uses the free NHTSA Recalls API (api.nhtsa.gov/recalls/recallsByVehicle).
 * NHTSA covers on-road vehicles: motorhomes (chassis + coach) and towable
 * trailers, plus on-road motorcycles. Off-road powersports (ATV, side-by-side,
 * PWC, snowmobile) are regulated by the CPSC, not NHTSA, so we surface a clear
 * "not covered by NHTSA" note for those categories rather than a misleading
 * empty result.
 */

const app = new Hono()
app.use('*', authenticate)

// Categories NHTSA's recall database does not meaningfully cover.
const NON_NHTSA_CATEGORIES = new Set(['atv', 'utv', 'sxs', 'pwc', 'snowmobile'])

type RecallResult = {
  campaignNumber: string | null
  manufacturer: string | null
  component: string | null
  summary: string | null
  consequence: string | null
  remedy: string | null
  reportReceivedDate: string | null
  notes: string | null
}

async function fetchRecalls(make: string, model: string, year: number | string): Promise<{ count: number; recalls: RecallResult[] }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(String(year))}`
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) throw new Error('NHTSA recalls API error')
    const data = await res.json()
    const recalls: RecallResult[] = (data.results || []).map((r: any) => ({
      campaignNumber: r.NHTSACampaignNumber || null,
      manufacturer: r.Manufacturer || null,
      component: r.Component || null,
      summary: r.Summary || null,
      consequence: r.Consequence || null,
      remedy: r.Remedy || null,
      reportReceivedDate: r.ReportReceivedDate || null,
      notes: r.Notes || null,
    }))
    return { count: Number(data.Count ?? recalls.length), recalls }
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('NHTSA recalls API timeout')
    throw err
  }
}

async function decodeVin(vin: string): Promise<{ year: number | null; make: string | null; model: string | null }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`,
      { signal: controller.signal },
    )
    clearTimeout(timeout)
    if (!res.ok) throw new Error('NHTSA VIN API error')
    const data = await res.json()
    const getValue = (varId: number) => {
      const item = data.Results?.find((r: any) => r.VariableId === varId)
      return item?.Value && item.Value !== 'Not Applicable' ? item.Value : null
    }
    return {
      year: parseInt(getValue(29) || '0') || null,
      make: getValue(26),
      model: getValue(28),
    }
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('NHTSA VIN API timeout')
    throw err
  }
}

// GET /recalls/by-vehicle?make=&model=&year=
app.get('/by-vehicle', requirePermission('contacts:read'), async (c) => {
  const make = c.req.query('make')
  const model = c.req.query('model')
  const year = c.req.query('year')
  if (!make || !model || !year) {
    return c.json({ error: 'make, model and year are required' }, 400)
  }
  try {
    const result = await fetchRecalls(make, model, year)
    return c.json({ make, model, year: Number(year), ...result })
  } catch (err: any) {
    return c.json({ error: err.message || 'Recall lookup failed' }, 502)
  }
})

// POST /recalls/by-vin  { vin }
app.post('/by-vin', requirePermission('contacts:read'), async (c) => {
  const { vin } = await c.req.json()
  if (!vin || typeof vin !== 'string' || vin.length !== 17) {
    return c.json({ error: 'VIN must be exactly 17 characters' }, 400)
  }
  try {
    const decoded = await decodeVin(vin)
    if (!decoded.make || !decoded.model || !decoded.year) {
      return c.json({ vin, decoded, count: 0, recalls: [], note: 'Could not decode make/model/year from VIN; recall lookup requires all three.' })
    }
    const result = await fetchRecalls(decoded.make, decoded.model, decoded.year)
    return c.json({ vin, decoded, ...result })
  } catch (err: any) {
    return c.json({ error: err.message || 'Recall lookup failed' }, 502)
  }
})

// GET /recalls/unit/:id — recall check for an inventory unit
app.get('/unit/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [u] = await db.select().from(unit).where(and(eq(unit.id, id), eq(unit.companyId, currentUser.companyId))).limit(1)
  if (!u) return c.json({ error: 'Unit not found' }, 404)

  if (NON_NHTSA_CATEGORIES.has(u.category)) {
    return c.json({
      unitId: u.id,
      category: u.category,
      count: 0,
      recalls: [],
      note: 'Off-road powersports units are regulated by the CPSC, not NHTSA — check the OEM or cpsc.gov for recalls on this category.',
    })
  }
  if (!u.make || !u.modelName || !u.year) {
    return c.json({ unitId: u.id, count: 0, recalls: [], note: 'Unit is missing make, model, or year — needed for a recall lookup.' })
  }
  try {
    const result = await fetchRecalls(u.make, u.modelName, u.year)
    return c.json({ unitId: u.id, make: u.make, model: u.modelName, year: u.year, ...result })
  } catch (err: any) {
    return c.json({ error: err.message || 'Recall lookup failed' }, 502)
  }
})

export default app
