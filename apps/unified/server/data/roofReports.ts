// Roofing's measurement credits (RULEBOOK §2: raw SQL lives here). From templates/crm-roof/backend/src/routes/
// measurements.ts, which read the balance, inserted the report and then subtracted — so two orders at one credit both
// passed the check and the balance went to -1. Spending is one statement now: it takes a credit only where one is left.
import { and, eq, gt, sql } from 'drizzle-orm'
import { auditLog, company } from '../db/schema/index.ts'

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

/** The audit rows that record a paid pack of roof reports: one per Stripe Checkout session. */
export const REPORT_PACK_ENTITY = 'roof_report_pack'

/**
 * A paid pack of roof reports added to the company's balance — ONCE per Stripe Checkout session, however often the
 * roofer's browser comes back from Stripe or two tabs confirm at the same moment. The company's row is locked, the
 * session is looked for in the audit log (where the purchase is recorded), and only a session not seen before adds.
 */
export async function grantReportPack(db: any, o: { companyId: string; sessionId: string; roofs: number; paid: string; userId?: string | null; userEmail?: string | null }): Promise<{ credits: number; added: boolean }> {
  return db.transaction(async (tx: any) => {
    const [locked] = await tx.select({ credits: company.reportCredits }).from(company).where(eq(company.id, o.companyId)).for('update')
    if (!locked) throw new Error('Company not found')
    const [seen] = await tx.select({ id: auditLog.id }).from(auditLog)
      .where(and(eq(auditLog.companyId, o.companyId), eq(auditLog.entity, REPORT_PACK_ENTITY), eq(auditLog.entityId, o.sessionId))).limit(1)
    if (seen) return { credits: Number(locked.credits), added: false }
    await tx.insert(auditLog).values({
      companyId: o.companyId, action: 'create', entity: REPORT_PACK_ENTITY, entityId: o.sessionId,
      entityName: `${o.roofs} roof reports bought for $${o.paid}`, metadata: { roofs: o.roofs, paid: o.paid },
      userId: o.userId || null, userEmail: o.userEmail || null,
    } as any)
    return { credits: await addReportCredits(tx, o.companyId, o.roofs), added: true }
  })
}

/** How many roof reports the company has left. */
export async function reportCreditsLeft(db: any, companyId: string): Promise<number> {
  const [row] = await db.select({ credits: company.reportCredits }).from(company).where(eq(company.id, companyId)).limit(1)
  return Number(row?.credits ?? 0)
}
