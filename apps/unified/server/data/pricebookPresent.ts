// The pricebook presenter's query that orders by a CASE (RULEBOOK §2). Moved from
// templates/crm/backend/src/routes/pricebookPresent.ts, where it was a raw SELECT *.
import { eq, sql } from 'drizzle-orm'
import { pricebookGoodBetterBest } from '../db/schema/index.ts'

/** An item's Good/Better/Best tiers, best first (best, better, good, then anything else). camelCase. */
export async function presentationTiers(db: any, itemId: string): Promise<Record<string, any>[]> {
  return db.select().from(pricebookGoodBetterBest)
    .where(eq(pricebookGoodBetterBest.pricebookItemId, itemId))
    .orderBy(sql`CASE ${pricebookGoodBetterBest.tier} WHEN 'best' THEN 1 WHEN 'better' THEN 2 WHEN 'good' THEN 3 ELSE 4 END`)
}
