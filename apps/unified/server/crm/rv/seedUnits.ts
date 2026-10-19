// POST /api/internal/seed-units — the Factory copies a dealer's existing website inventory into their new CRM (the
// website→CRM "flip"). Only real unit columns are taken; one bad or duplicate row is skipped, not fatal. Moved from
// templates/crm-rv/backend/src/index.ts (where it checked X-Factory-Key itself; the registry's factory access does).
import { Hono } from 'hono'
import { asc } from 'drizzle-orm'
import { company, unit } from '../../db/schema/index.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

const ALLOWED = ['category', 'condition', 'stockNumber', 'vin', 'hin', 'year', 'make', 'modelName', 'trim', 'status', 'msrp', 'listedPrice', 'internetPrice', 'cost', 'photos', 'floorplanImg', 'description', 'features', 'exteriorColor', 'interiorColor', 'rvClass', 'towableType', 'lengthFt', 'sleeps', 'slideOuts', 'gvwr', 'dryWeight', 'hitchWeight', 'chassis', 'freshTankGal', 'greyTankGal', 'blackTankGal', 'generatorHours', 'awnings', 'fuelType', 'engine', 'engineCc', 'mileage', 'hours', 'transmission', 'drivetrain', 'beamFt', 'draftFt', 'hullMaterial', 'engineType', 'engineCount', 'engineHp', 'fuelCapacityGal', 'maxPersons', 'trailerIncluded']

export function createSeedUnitsRoute(d: CrmDeps) {
  const { db } = d
  return new Hono().post('/', async (c) => {
    const { units } = await c.req.json().catch(() => ({} as any))
    if (!Array.isArray(units)) return fail(c, 400, 'units must be an array')
    const [comp] = await db.select().from(company).orderBy(asc(company.createdAt)).limit(1)
    if (!comp) return fail(c, 404, 'No company found')
    let inserted = 0, skipped = 0
    for (const u of units) {
      if (!u || (!u.stockNumber && !u.vin)) { skipped++; continue }
      const row: any = { companyId: comp.id, category: u.category || 'motorhome' }
      for (const k of ALLOWED) if (u[k] != null && u[k] !== '') row[k] = u[k]
      try { await db.insert(unit).values(row); inserted++ } catch { skipped++ } // duplicate VIN or unparseable row
    }
    return one(c, { success: true, inserted, skipped, received: units.length })
  })
}
