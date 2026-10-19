// The agency's own facts — name, state, contact — read from its `company` row, never hard-coded. Moved from
// templates/crm-homecare/backend/src/services/agencyProfile.ts (which read the database's only `agencies` row; the
// agency is now the signed-in person's company, so every read takes the company's id). State-specific behaviour
// (Wisconsin's WORCS background checks and its statutory caregiver bar list) keys off company.state.
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { resolveTimezone } from './agencyTime.ts'

export type AgencyProfile = {
  id: string | null
  name: string
  legalName: string | null
  state: string | null
  email: string | null
  phone: string | null
  timezone: string
}

/** Wisconsin's caregiver law (WORCS checks, the DHS 12 bar list) applies to an agency in WI only. */
export const isWisconsin = (p: Pick<AgencyProfile, 'state'>) => p.state === 'WI'

export function createAgencyProfile(d: CrmDeps) {
  async function getAgencyProfile(companyId: string): Promise<AgencyProfile> {
    const [a] = await d.db.select({
      id: company.id, name: company.name, legalName: company.legalName, state: company.state,
      email: company.email, phone: company.phone, timezone: company.timezone,
    }).from(company).where(eq(company.id, companyId)).limit(1)
    return {
      id: a?.id ?? null,
      name: a?.name || 'Our agency',
      legalName: a?.legalName ?? null,
      state: a?.state ? String(a.state).trim().toUpperCase() : null,
      email: a?.email ?? null,
      phone: a?.phone ?? null,
      // The day boundaries a pay period is cut on: the agency's one clock (core/agencyTime.ts).
      timezone: resolveTimezone(a || null),
    }
  }

  /** Short prefix for a text, from the company record (never a hard-coded business name). '' when unknown. */
  async function agencyShortName(companyId: string): Promise<string> {
    try {
      const [a] = await d.db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
      return a?.name || ''
    } catch { return '' }
  }

  return { getAgencyProfile, agencyShortName, isWisconsin }
}

export type AgencyProfiles = ReturnType<typeof createAgencyProfile>
