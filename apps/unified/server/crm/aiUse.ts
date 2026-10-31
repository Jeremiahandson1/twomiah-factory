// A ceiling on how often a company may ask an AI drafting tool (the store's product writer today): each request costs money
// on the platform's AI key, and a script or a stuck button could spend a month's worth in a minute. The count is per
// company and per tool over a sliding hour, kept in the database (ai_draft_uses) so a restart or a second server cannot
// reset it. A request past the cap gets a plain sentence and makes NO model call.
//
// The request is counted BEFORE the model is asked, with the company's row locked while it is, so two requests arriving
// together cannot both slip under the cap. A request that fails at the model still counts: the cap bounds what we ask.
import { and, eq, gt, lt, asc, count } from 'drizzle-orm'
import { aiDraftUse, company } from '../db/schema/index.ts'

/** Requests a company may make to one tool in an hour. */
export const AI_DRAFTS_PER_HOUR = 30
const HOUR = 60 * 60 * 1000

export type Claim = { ok: true } | { ok: false; minutes: number; sentence: string }

export function createAiUse(db: any, opts: { max?: number; now?: () => number } = {}) {
  const max = opts.max ?? AI_DRAFTS_PER_HOUR
  const now = opts.now ?? Date.now

  /** Count one request for `companyId` and `feature`, or say how long until the hour has room again. */
  async function claim(companyId: string, feature: string, label: string): Promise<Claim> {
    const at = new Date(now())
    const since = new Date(at.getTime() - HOUR)
    // One request at a time per company: the company's row is locked while the hour is counted and the new request written,
    // so requests arriving together are counted one after another and exactly `max` get in.
    const got = await db.transaction(async (tx: any) => {
      await tx.select({ id: company.id }).from(company).where(eq(company.id, companyId)).for('update')
      // Housekeeping: nothing older than a day is read again.
      await tx.delete(aiDraftUse).where(and(eq(aiDraftUse.companyId, companyId), lt(aiDraftUse.createdAt, new Date(at.getTime() - 24 * HOUR))))
      const inHour = and(eq(aiDraftUse.companyId, companyId), eq(aiDraftUse.feature, feature), gt(aiDraftUse.createdAt, since))
      const [{ n }] = await tx.select({ n: count() }).from(aiDraftUse).where(inHour)
      if (Number(n) < max) { await tx.insert(aiDraftUse).values({ companyId, feature, createdAt: at }); return { ok: true as const } }
      // Full: the oldest request still in the hour decides when a place opens.
      const [oldest] = await tx.select({ at: aiDraftUse.createdAt }).from(aiDraftUse).where(inHour).orderBy(asc(aiDraftUse.createdAt)).limit(1)
      return { ok: false as const, from: oldest?.at ? new Date(oldest.at).getTime() : at.getTime() }
    })
    if (got.ok) return got
    const minutes = Math.max(1, Math.ceil((got.from + HOUR - at.getTime()) / 60000))
    return { ok: false, minutes, sentence: `You’ve asked the ${label} ${max} times in the last hour, which is as many as we allow. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.` }
  }
  return { claim, max }
}
export type AiUse = ReturnType<typeof createAiUse>
