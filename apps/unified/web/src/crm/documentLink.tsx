// A quote's or an invoice's own page (/d/<token>), the link every quote and invoice email carries (2026-10-22). Loaded
// on its own like the portal (crm/portal.tsx): an invoice page pays cards through Stripe, kept out of the admin's bundle.
import { PortalDocumentLink } from '@twomiah/tenant-ui/src/portal'
import { FinancingOffer } from './financingOffer'

export default function DocumentLinkApp() {
  // Under the document: the lender's estimate and Apply, when the business offers financing (crm/financingOffer.tsx).
  return <PortalDocumentLink below={({ token }) => <FinancingOffer token={token} />} />
}
