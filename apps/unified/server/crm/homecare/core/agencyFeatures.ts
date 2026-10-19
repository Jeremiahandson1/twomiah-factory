// The ONE writer of an agency's feature list from home care's own code (the in-CRM subscription service, Settings ›
// Features). Moved from templates/crm-homecare/backend/src/services/agencyFeatures.ts.
//
// The template kept the list in two places (agencies.enabled_features and settings.enabledFeatures) because its
// writers disagreed. In the unified app the list is company.enabled_features alone — the app's feature gate
// (d.features) reads that column and the Factory's sync writes it — so this writes the column and drops the gate's
// cache, so a switch takes effect on the next request. settings.enabledFeatures is no longer written: nothing in the
// unified app reads it.
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

export function createAgencyFeatures(d: CrmDeps) {
  /**
   * Write `features` to one company, with any other column changes in `extra`. Returns the updated row, or null when
   * there is no such company.
   */
  async function setAgencyFeatures(companyId: string, features: string[], extra: Record<string, unknown> = {}) {
    const [row] = await d.db.select({ id: company.id }).from(company).where(eq(company.id, companyId)).limit(1)
    if (!row) return null
    const list = [...new Set((features || []).filter((f): f is string => typeof f === 'string'))]
    const [updated] = await d.db.update(company)
      .set({ ...extra, enabledFeatures: list, updatedAt: new Date() } as any)
      .where(eq(company.id, row.id))
      .returning()
    // The gate built in app.ts (createEnabledFeatureGate) has forgetFeatures; CrmDeps' type names only the readers.
    ;(d.features as { forgetFeatures?: (id?: string) => void }).forgetFeatures?.(row.id)
    return updated
  }

  return { setAgencyFeatures }
}
