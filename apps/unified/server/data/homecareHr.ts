// Home care's hiring SQL (moved from templates/crm-homecare/backend/src/services/applicationIntake.ts and
// jobs/worcsPoll.ts, which ran these inline). Raw SQL lives here (RULEBOOK §2); each is scoped to the company.
import { sql } from 'drizzle-orm'
import { rowsOf } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/** One more application on a posting of this company. */
export async function bumpPostingApplications(q: Q, companyId: string, postingId: string): Promise<void> {
  await q.execute(sql`UPDATE job_postings SET applications_count = applications_count + 1
    WHERE id = ${postingId} AND company_id = ${companyId}`)
}

/**
 * Claim one background check for a poll: only the process whose update matches the updated_at it read gets it.
 * Compared at millisecond precision — Postgres keeps microseconds, a JS Date does not, so plain equality would never
 * match a row stamped by now(). True when this caller holds the claim.
 */
export async function claimBackgroundCheck(q: Q, companyId: string, id: string, readUpdatedAt: Date): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`UPDATE background_checks SET updated_at = ${new Date().toISOString()}::timestamp
    WHERE id = ${id} AND company_id = ${companyId}
      AND date_trunc('milliseconds', updated_at) = ${readUpdatedAt.toISOString()}::timestamp
    RETURNING id`))
  return r.length > 0
}
