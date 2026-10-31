/**
 * Customer financing on the phone (consumer_financing, not ready): the phone does ONE thing — it asks the server for the
 * application at the lender and opens the lender's own page in the browser. It shows no loan terms at all (those are the
 * lender's trigger terms and need its full disclosure, which the desktop screens carry), takes no card, and
 * records nothing: the lender reports back to the server by webhook (server/crm/financing).
 */
import { Linking } from 'react-native'
import { post } from '../api/client'

import { financingPath, lenderPage, type FinancingKind } from './financingRules'

export { financingPath, lenderPage, mayOfferFinancing, type FinancingKind } from './financingRules'

/** Open the lender's page for this document. Returns a sentence when it could not, else null. */
export async function openLenderPage(kind: FinancingKind, id: string): Promise<string | null> {
  const res = await post(financingPath(kind, id), {})
  if (!res.ok) return res.error || 'The lender page could not be opened.'
  const url = lenderPage(res.data)
  if (!url) return 'The lender did not give a page to open.'
  await Linking.openURL(url)
  return null
}
