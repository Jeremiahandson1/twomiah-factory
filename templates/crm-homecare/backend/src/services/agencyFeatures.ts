// The ONE writer of an agency's feature list. (10/16)
//
// Home care keeps the list in two places: the agencies.enabled_features column and settings.enabledFeatures. Its
// writers disagreed — the Factory's sync-features wrote only the settings blob, Settings › Features wrote both, the
// in-CRM subscription service (services/billing.ts) wrote only the column — so which features an agency "had"
// depended on which field you read. Every writer comes here now and both fields get the same list, and the API
// feature gate's cache (middleware/enabledFeature.ts) is dropped so a switch takes effect on the next request.
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { forgetFeatures } from '../middleware/enabledFeature.ts'

const settingsOf = (row: any): Record<string, unknown> => {
  let s = row?.settings || {}
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } }
  return s && typeof s === 'object' && !Array.isArray(s) ? { ...s } : {}
}

/**
 * Write `features` to both fields of one agency (the given id, or the tenant's only agency), with any other column
 * changes in `extra`. Returns the updated row, or null when there is no agency.
 */
export async function setAgencyFeatures(agencyId: string | null | undefined, features: string[], extra: Record<string, unknown> = {}) {
  const [row] = agencyId
    ? await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1)
    : await db.select().from(agencies).limit(1)
  if (!row) return null
  const list = [...new Set((features || []).filter((f): f is string => typeof f === 'string'))]
  const [updated] = await db.update(agencies)
    .set({ ...extra, enabledFeatures: list, settings: { ...settingsOf(row), enabledFeatures: list }, updatedAt: new Date() } as any)
    .where(eq(agencies.id, row.id))
    .returning()
  forgetFeatures(row.id)
  return updated
}
