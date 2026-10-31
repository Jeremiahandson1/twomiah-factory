// The supplier ordering APIs — ABC Supply, QXO (Beacon) and SRS — as far as they can be built before the partner step
// (docs/parity/roof-material-list.md #11). Each of the three gives ordering and live prices only to a roofing company or software
// vendor that has signed with it and been issued credentials; none of that exists for this product, so no request is written here
// and nothing is pretended to be connected. What is here is the honest part: which suppliers have such an API, what each would
// give us, and exactly what is missing — so a supplier's order screen can say "emailing instead" and the owner has the list.
// Until a supplier's API is connected, the order goes by email (orderSend.ts).
import { supplierKey } from './supplierPricing.ts'

export type SupplierApiCapability = 'live_prices' | 'place_order' | 'order_status'
export const CAPABILITY_LABELS: Record<SupplierApiCapability, string> = {
  live_prices: 'The supplier’s live prices on the order',
  place_order: 'Placing the order with the supplier from inside the software',
  order_status: 'The supplier’s confirmation and delivery status coming back onto the order',
}

export interface SupplierApiInfo {
  /** The key supplierKey() gives every spelling of the supplier. */
  key: 'abc' | 'qxo' | 'srs'
  label: string
  /** What the integration would give, once connected (what Roofr says its direct ordering integrations do). */
  wouldGive: SupplierApiCapability[]
  /** What has to happen first, and who does it. Nothing on this list is something the software can do on its own. */
  steps: Array<{ who: 'owner' | 'supplier'; step: string }>
}

const STEPS = (label: string): SupplierApiInfo['steps'] => [
  { who: 'owner', step: `Apply to ${label} for access to its ordering API as a software partner (a partner agreement with ${label}).` },
  { who: 'supplier', step: `${label} issues the partner credentials and the API documentation.` },
  { who: 'owner', step: `Each roofing company links its own ${label} account (account number and sign-in) so orders and prices are its own.` },
  { who: 'owner', step: `Build and test the connection against ${label}’s test environment before any real order is placed.` },
]

export const SUPPLIER_APIS: SupplierApiInfo[] = [
  { key: 'abc', label: 'ABC Supply', wouldGive: ['live_prices', 'place_order', 'order_status'], steps: STEPS('ABC Supply') },
  { key: 'qxo', label: 'QXO (formerly Beacon)', wouldGive: ['live_prices', 'place_order', 'order_status'], steps: STEPS('QXO') },
  { key: 'srs', label: 'SRS Distribution', wouldGive: ['live_prices', 'place_order', 'order_status'], steps: STEPS('SRS') },
]

/** The API a supplier has, by any spelling of its name, or null for a supply house with none. */
export const supplierApiFor = (supplier: unknown): SupplierApiInfo | null => SUPPLIER_APIS.find((a) => a.key === supplierKey(supplier)) ?? null

/** Whether a company's connection to the supplier's API is live. Always false until the partner step is done and a connection is built:
 *  there is no stored credential to read, and a screen must not say "connected" on a hope. */
export const supplierApiConnected = (_companyId: string, _key: SupplierApiInfo['key']): boolean => false

export function describeSupplierApi(info: SupplierApiInfo, companyId: string) {
  return {
    key: info.key, label: info.label, connected: supplierApiConnected(companyId, info.key),
    wouldGive: info.wouldGive.map((c) => CAPABILITY_LABELS[c]), steps: info.steps,
    sendsBy: 'email' as const,
  }
}
