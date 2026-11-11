// The roofer's balance of roof reports — ONE balance for everything that measures a roof from the air, because each of
// them costs Twomiah the same Google call: the draw-it-yourself roof report (roofReports.ts, when its aerial picture
// loads) and the website's instant estimator (estimator.ts, when a house is measured for a visitor). Bought in packs,
// never a monthly charge (owner, 2026-11-10: "that's what costs us so that's what costs them"; 2026-11-11: no add-on
// for the estimator — "pass these things on as close to our cost as possible").
//
// Spending tells the people who can buy more when the balance gets low, by email, once on the way down: at
// REPORT_PACK_LOW_AT left, and again at none — when the estimator also comes off the website (estimator.ts), so no
// visitor meets a tool that cannot answer.
import { and, eq, inArray } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { company, reminderLog, user } from '../../../db/schema/index.ts'
import { addReportCredits, reportCreditsLeft, spendReportCredit } from '../../../data/roofReports.ts'
import type { CrmDeps } from '../../deps.ts'
import { shopClock } from '../../lowStockDigest.ts'

/** Roof reports are bought in packs and spent one a roof: $15 buys 100. */
export const REPORT_PACK = { roofs: 100, priceCents: 1500 }
/** At or under this many left, the screen says to top up; at exactly this many, and at none, an email says so. */
export const REPORT_PACK_LOW_AT = 10

export function createRoofCredits(d: Pick<CrmDeps, 'db' | 'logger' | 'services' | 'features'>) {
  const { db, logger } = d

  /** Tell the owners and admins the balance is low (or gone). Never throws; one email per level per day. */
  async function remind(companyId: string, left: number) {
    try {
      const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
      if (!co) return
      const people = await db.select({ email: user.email }).from(user)
        .where(and(eq(user.companyId, companyId), eq(user.isActive, true), inArray(user.role, ['owner', 'admin'])))
      const to = [...new Set([...people.map((p: any) => String(p.email || '').trim()), ...(people.length ? [] : [String(co.email || '').trim()])].filter(Boolean))]
      if (!to.length) return
      // The claim (reminder_log's unique index, by the business's own day): two spends landing together send one email
      // between them.
      const step = `${left === 0 ? 'out' : 'low'}:${shopClock(companyRowTimeZone(co), new Date()).day}`
      const claimed = await db.insert(reminderLog).values({ companyId, kind: 'roof_reports_low', subjectId: companyId, step, status: 'sending', sentTo: to.join(', ') })
        .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
      if (!claimed.length) return
      // Only a roofer whose estimator is on their website needs to hear it has come off.
      const estimatorOn = !!co.estimatorEnabled && await d.features.isFeatureEnabled(companyId, 'instant_estimator')
      const data = { left, pack: REPORT_PACK, estimatorOn }
      for (const address of to) await d.services.emailService.send(address, 'roofReportsLow', data)
      await db.update(reminderLog).set({ status: 'sent', detail: `${left} left`, updatedAt: new Date() }).where(eq(reminderLog.id, claimed[0].id))
    } catch (err: any) {
      logger.warn('Roof reports: the low-balance email was not sent', { companyId, error: err?.message })
    }
  }

  return {
    left: (companyId: string) => reportCreditsLeft(db, companyId),
    /** Take one roof report. False when none is left (nothing is taken). */
    async spend(companyId: string): Promise<boolean> {
      if (!(await spendReportCredit(db, companyId))) return false
      const left = await reportCreditsLeft(db, companyId)
      if (left === REPORT_PACK_LOW_AT || left === 0) await remind(companyId, left)
      return true
    },
    /** Give one back — the call it was spent on never cost anything (no picture came). */
    async giveBack(companyId: string) {
      await addReportCredits(db, companyId, 1).catch((e: any) => logger.error('Roof reports: the one spent could not be given back', { companyId, error: e?.message }))
    },
  }
}
