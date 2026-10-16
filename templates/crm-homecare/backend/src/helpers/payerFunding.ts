// Who is PRIVATE PAY — the one rule for "does EVV / an authorization apply to this client?".
//
// EVV is required, and an authorization is needed, only for services a payer (Medicaid, an MCO,
// the VA, insurance) funds. A private-pay client needs neither. The rule reads the client's payer
// by its TYPE, never by its name:
//
//   private pay  ⇔  the client is flagged private pay (clients.is_private_pay)
//                   OR the client's payer (clients.referred_by_id) has payer_type 'private_pay'
//   payer-funded ⇔  not private pay
//
// The seeded "Private Pay" payer has payer_type 'private_pay', so a client whose payer is that row
// is private pay even when the client's own Private Pay box was left unticked.
//
// A client with NO payer on file is not private pay by this rule: the office has not said who pays,
// and the safe side for EVV and authorization advice is to show them (a missing payer on a Medicaid
// client must not silently drop the visit out of EVV).
//
// Used by: the EVV record builder and the EVV dashboard (services/evvVisits.ts, routes/evv.ts) and
// the scheduler's authorization advice (helpers/authorizationCheck.ts).
import { sql, type SQL } from 'drizzle-orm'

export const PRIVATE_PAY_PAYER_TYPE = 'private_pay'

export function isPrivatePay(client: { is_private_pay?: boolean | null } | null | undefined,
  payer: { payer_type?: string | null } | null | undefined): boolean {
  if (client?.is_private_pay === true) return true
  return String(payer?.payer_type ?? '').trim().toLowerCase() === PRIVATE_PAY_PAYER_TYPE
}

/** The same rule as SQL: TRUE when the client is private pay. `c` = a clients alias. */
export function privatePaySql(c = 'c'): SQL {
  return sql.raw(`(COALESCE(${c}.is_private_pay, false) = true OR EXISTS (
      SELECT 1 FROM referral_sources pp_rs WHERE pp_rs.id = ${c}.referred_by_id
         AND LOWER(TRIM(COALESCE(pp_rs.payer_type, ''))) = '${PRIVATE_PAY_PAYER_TYPE}'))`)
}
