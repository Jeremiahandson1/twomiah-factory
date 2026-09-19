// The equivalency rules a till has to read before it can enforce a flower-equivalent purchase limit.
//
// The rules themselves are a compliance setting the operator owns (Equivalency page → equivalency_rules).
// They existed and were seedable, but nothing on the selling side ever read them, so the limit counted raw
// mass: 25 g of concentrate — 62.5 g of flower equivalent — passed a 1 oz cap. (Dispensary T20 H5)
//
// The defaults live here rather than in the route, so the page that seeds them and the till that enforces
// them cannot describe the same state differently.
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import type { EquivalencyFactors } from '../utils/cannabis.ts'

export interface DefaultRule { category: string; equivalencyFactor: number; unitOfMeasure: string; description: string }

const STANDARD: DefaultRule[] = [
  { category: 'flower', equivalencyFactor: 1, unitOfMeasure: 'g', description: '1g flower = 1g flower equivalent' },
  { category: 'concentrate', equivalencyFactor: 2.5, unitOfMeasure: 'g', description: '1g concentrate = 2.5g flower equivalent' },
  { category: 'edible', equivalencyFactor: 0.1, unitOfMeasure: 'mg_thc', description: '10mg THC = 1g flower equivalent' },
  { category: 'tincture', equivalencyFactor: 0.1, unitOfMeasure: 'mg_thc', description: '10mg THC = 1g flower equivalent' },
  { category: 'pre_roll', equivalencyFactor: 1, unitOfMeasure: 'g', description: '1g pre-roll = 1g flower equivalent' },
  { category: 'vape', equivalencyFactor: 2.5, unitOfMeasure: 'g', description: '1g vape = 2.5g flower equivalent' },
  { category: 'topical', equivalencyFactor: 0, unitOfMeasure: 'g', description: 'Topicals not counted toward purchase limit' },
]

/** Seedable defaults per state. Both states ship the standard table; an operator edits from there. */
export const DEFAULT_RULES: Record<string, DefaultRule[]> = { MI: STANDARD, CO: STANDARD }

/**
 * The company's ACTIVE rules, as category → { factor, unit }.
 *
 * Empty when the tenant has configured none: the till then falls back to counting the product's own weight,
 * which is what it did before this was read at all, so nobody is worse off for not having set them up.
 */
export async function loadEquivalencyFactors(companyId: string): Promise<EquivalencyFactors> {
  const factors: EquivalencyFactors = new Map()
  try {
    const r: any = await db.execute(sql`
      SELECT category, equivalency_factor, unit_of_measure
      FROM equivalency_rules
      WHERE company_id = ${companyId} AND is_active IS NOT FALSE
    `)
    for (const row of ((r as any).rows || r) as any[]) {
      const factor = Number(row.equivalency_factor)
      if (!Number.isFinite(factor) || factor < 0) continue
      factors.set(String(row.category || '').toLowerCase(), { factor, unit: String(row.unit_of_measure || 'g') })
    }
  } catch {
    // A tenant whose migrations have not reached this table must still be able to sell.
  }
  return factors
}
