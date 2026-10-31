// A saved segment as a campaign audience (the shared Email Marketing module's audienceFilters / audienceOptions hooks).
// Behind the hidden feature store_segments: with it off a campaign that names a segment reaches NOBODY, and the picker
// offers none. A segment that was deleted (or never existed) matches nobody — never "everyone".
import { and, asc, eq } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import { storeSegment } from '../../../db/schema/store.ts'
import { segmentCondition } from '../../../data/storeSegments.ts'

type Enabled = (companyId: string, feature: string | string[]) => Promise<boolean>

export function segmentAudience(db: any, isFeatureEnabled: Enabled) {
  return {
    /** The condition for `{ segmentId }` in a campaign's audience filter. */
    async filter(value: unknown, companyId: string): Promise<SQL | undefined> {
      if (typeof value !== 'string' || !value) return undefined
      if (!(await isFeatureEnabled(companyId, 'store_segments'))) return undefined
      const [row] = await db.select().from(storeSegment).where(and(eq(storeSegment.id, value), eq(storeSegment.companyId, companyId))).limit(1)
      if (!row) return undefined
      const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
      return segmentCondition(companyId, row.definition, companyRowTimeZone(co))
    },
    /** The saved segments the audience picker offers. */
    async options(companyId: string): Promise<Array<{ id: string; name: string }>> {
      if (!(await isFeatureEnabled(companyId, 'store_segments'))) return []
      return db.select({ id: storeSegment.id, name: storeSegment.name }).from(storeSegment).where(eq(storeSegment.companyId, companyId)).orderBy(asc(storeSegment.name))
    },
  }
}
