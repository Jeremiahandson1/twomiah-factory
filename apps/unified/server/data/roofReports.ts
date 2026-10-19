// Roofing's measurement credits (RULEBOOK §2: raw SQL lives here). From templates/crm-roof/backend/src/routes/
// measurements.ts, which read the balance, inserted the report and then subtracted — so two orders at one credit both
// passed the check and the balance went to -1. Spending is one statement now: it takes a credit only where one is left.
import { and, eq, gt, sql } from 'drizzle-orm'
import { company } from '../db/schema/index.ts'

const rowsOf = (r: any): any[] => ((r as any)?.rows || r) as any[]

/** Take one measurement credit from the company. False when it has none left (nothing is taken). */
export async function spendReportCredit(db: any, companyId: string): Promise<boolean> {
  const rows = await db.update(company)
    .set({ reportCredits: sql`${company.reportCredits} - 1`, updatedAt: new Date() })
    .where(and(eq(company.id, companyId), gt(company.reportCredits, 0)))
    .returning({ credits: company.reportCredits })
  return rowsOf(rows).length > 0
}

/** Add measurement credits to the company; its balance afterwards. */
export async function addReportCredits(db: any, companyId: string, quantity: number): Promise<number> {
  const rows = await db.update(company)
    .set({ reportCredits: sql`${company.reportCredits} + ${quantity}`, updatedAt: new Date() })
    .where(eq(company.id, companyId))
    .returning({ credits: company.reportCredits })
  return Number(rowsOf(rows)[0]?.credits ?? 0)
}
