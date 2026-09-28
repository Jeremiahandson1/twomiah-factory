// Is this shop actually connected to a state traceability system?
//
// Run T45 BL2: "Report to Metrc" set metrc_reported = true with a timestamp, and a compliance
// report's "Submit" set status = 'submitted' with a timestamp, while Metrc and BioTrack were not
// configured at all. Nothing was ever sent anywhere. The records are the problem: an inspector
// reading this database would see a shop claiming it had notified the state.
//
// A button that records a submission nobody made is worse than a button that refuses, because the
// refusal is visible the day it happens and the false record is only discovered during an audit.
// So both actions ask this first, and both fail closed.
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'

export interface TraceabilityStatus {
  connected: boolean
  /** 'metrc' | 'biotrack' | null */
  system: string | null
  /** Ready to put in front of a person, naming what to do about it. */
  reason: string | null
}

const NOT_CONNECTED = (what: string): TraceabilityStatus => ({
  connected: false,
  system: null,
  reason: `This shop is not connected to a state traceability system, so ${what} cannot be reported to the state. Connect Metrc under Compliance → Metrc (or BioTrack) first. Nothing has been recorded as submitted.`,
})

/**
 * Connected means credentials are actually stored — not that the module is switched on in Features.
 * A feature flag says the shop BOUGHT the module; only a key says the state can hear from it.
 *
 * Never throws: a missing table on an older tenant reads as "not connected", which is the safe
 * direction. The alternative — treating a query failure as connected — is the bug this file exists
 * to prevent.
 */
export async function traceabilityStatus(companyId: string, what = 'this'): Promise<TraceabilityStatus> {
  try {
    const metrc: any = await db.execute(sql`
      SELECT api_key, user_key FROM metrc_config WHERE company_id = ${companyId} LIMIT 1
    `)
    const m = ((metrc as any).rows || metrc)?.[0]
    if (m && String(m.api_key || '').trim() && String(m.user_key || '').trim()) {
      return { connected: true, system: 'metrc', reason: null }
    }
  } catch { /* table absent on an older tenant — not connected */ }

  try {
    const bio: any = await db.execute(sql`
      SELECT username, password FROM biotrack_config WHERE company_id = ${companyId} LIMIT 1
    `)
    const b = ((bio as any).rows || bio)?.[0]
    if (b && String(b.username || '').trim() && String(b.password || '').trim()) {
      return { connected: true, system: 'biotrack', reason: null }
    }
  } catch { /* same */ }

  return NOT_CONNECTED(what)
}
