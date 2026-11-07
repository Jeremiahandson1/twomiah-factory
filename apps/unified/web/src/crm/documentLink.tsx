// A quote's or an invoice's own page (/d/<token>), the link every quote and invoice email carries (2026-10-22). Loaded
// on its own like the portal (crm/portal.tsx): an invoice page pays cards through Stripe, kept out of the admin's bundle.
import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PortalDocumentLink, QuoteExtrasContext, type QuoteExtras } from '@twomiah/tenant-ui/src/portal'
import { FinancingOffer, OptionFinancing, OptionFinancingNote, useOptionOffers } from './financingOffer'

export default function DocumentLinkApp() {
  const { token = '' } = useParams<{ token: string }>()
  // Each change to the quote (a choice, an upgrade, a signature) reads the financing again: its price may have moved.
  const [rev, setRev] = useState(0)
  const [needsChoice, setNeedsChoice] = useState(false)
  const onChange = useCallback((q: { needsChoice: boolean }) => { setNeedsChoice(q.needsChoice); setRev((r) => r + 1) }, [])
  // Roofing parity row 30: each option's own estimate (proposal_financing; nothing when it is off or none fits).
  const offers = useOptionOffers(token, rev)
  const extras = useMemo<QuoteExtras>(() => ({
    onChange,
    optionFooter: (op) => (offers?.options[op.id] ? <OptionFinancing offer={offers.options[op.id]} /> : null),
  }), [onChange, offers])
  // Under the document: the lender's estimate and Apply, when the business offers financing (crm/financingOffer.tsx).
  return (
    <QuoteExtrasContext.Provider value={extras}>
      <PortalDocumentLink below={({ token: t }) => (
        <>
          {offers && needsChoice && <OptionFinancingNote lender={offers.lender} disclosure={offers.disclosure} />}
          <FinancingOffer key={rev} token={t} />
        </>
      )} />
    </QuoteExtrasContext.Provider>
  )
}
