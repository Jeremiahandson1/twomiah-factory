// The agency's own facts — name, state, contact — read from the agencies row, never hard-coded.
//
// A homecare tenant has exactly one agencies row (see routes/auth.ts, which reads the first one), so
// these helpers do the same. State-specific behaviour (Wisconsin's WORCS background checks and its
// statutory caregiver bar list) keys off agencies.state.
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'
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

export async function getAgencyProfile(): Promise<AgencyProfile> {
  const [a] = await db.select().from(agencies).limit(1)
  return {
    id: a?.id ?? null,
    name: a?.name || 'Our agency',
    legalName: a?.legalName ?? null,
    state: a?.state ? String(a.state).trim().toUpperCase() : null,
    email: a?.email ?? null,
    phone: a?.phone ?? null,
    // The day boundaries a pay period is cut on: the agency's one clock (services/agencyTime.ts).
    timezone: resolveTimezone(a || null),
  }
}

/** Wisconsin's caregiver law (WORCS checks, the DHS 12 bar list) applies to an agency in WI only. */
export const isWisconsin = (p: Pick<AgencyProfile, 'state'>) => p.state === 'WI'
