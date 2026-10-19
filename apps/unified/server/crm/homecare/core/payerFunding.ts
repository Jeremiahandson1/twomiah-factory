// Who is PRIVATE PAY — the one rule for "does EVV / an authorization apply to this client?". Moved from
// templates/crm-homecare/backend/src/helpers/payerFunding.ts. Pure; the same rule as SQL (privatePaySql) is in
// server/data/homecareCore.ts.
//
// EVV is required, and an authorization is needed, only for services a payer (Medicaid, an MCO, the VA, insurance)
// funds. A private-pay client needs neither. The rule reads the client's payer by its TYPE, never by its name:
//
//   private pay  ⇔  the client is flagged private pay (clients.is_private_pay)
//                   OR the client's payer (clients.referred_by_id) has payer_type 'private_pay'
//   payer-funded ⇔  not private pay
//
// A client with NO payer on file is not private pay by this rule: the office has not said who pays, and the safe side
// for EVV and authorization advice is to show them.
//
// One change: the client and payer are read in camelCase (isPrivatePay, payerType), as the unified reads return them.
import { PRIVATE_PAY_PAYER_TYPE } from '../../../data/homecareCore.ts'

export { PRIVATE_PAY_PAYER_TYPE }

export function isPrivatePay(client: { isPrivatePay?: boolean | null } | null | undefined,
  payer: { payerType?: string | null } | null | undefined): boolean {
  if (client?.isPrivatePay === true) return true
  return String(payer?.payerType ?? '').trim().toLowerCase() === PRIVATE_PAY_PAYER_TYPE
}
