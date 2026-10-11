/**
 * WHAT PROVES A SIGNATURE, AND WHO GETS IT. (T43 viewer round)
 *
 *   "Contractor: the viewer gets customers' signing evidence. The change order detail and quote detail endpoints
 *    return the signature image, the signer's IP, their browser string and the signature hash."
 *
 * A signed quote or change order carries two kinds of fact. THAT it was signed, by whom and when, is part of the
 * document — anyone who may read the document may know it. The rest is evidence about a person: an image of their
 * handwriting, the address they signed from, the browser they used, the fingerprint of what they saw, the moment
 * they agreed to sign electronically. The people who need that are the ones who administer the agreement — the
 * seat that may update it (quotes:update, change-orders:update) — which is the rule the project view has followed
 * since T42 (templates/crm/backend/src/routes/projects.ts).
 *
 * One list, for both documents, so the quote and the change order cannot disagree about what counts.
 */
export const SIGNING_EVIDENCE = ['signature', 'signedIp', 'signedUserAgent', 'signatureHash', 'consentAt'] as const

/** The row without the evidence. signedBy and signedAt stay: that it was signed, by whom, and when. */
export const withoutSigningEvidence = <T extends Record<string, any> | null | undefined>(row: T): T => {
  if (!row) return row
  const out: Record<string, any> = { ...row }
  for (const k of SIGNING_EVIDENCE) delete out[k]
  return out as T
}
