/** The phone's rules for customer financing, free of React Native so a plain test can run them (./financing.ts opens the page). */
export type FinancingKind = 'quote' | 'invoice'

/** The server's door for opening (or reusing) the application on one quote or invoice. */
export const financingPath = (kind: FinancingKind, id: string) => `/api/financing/${kind === 'quote' ? 'quotes' : 'invoices'}/${encodeURIComponent(id)}/applications`

/** Who may: the seat that opens applications (financing:create), with the business's switch on and the document still open. */
export const mayOfferFinancing = (can: (p: string) => boolean, hasFeature: (f: string) => boolean, open: boolean) =>
  open && hasFeature('consumer_financing') && can('financing:create')

/** The page to open from the server's answer: the lender's https address, or null (never anything else). */
export function lenderPage(body: unknown): string | null {
  const url = String((body as { applicationUrl?: unknown; applyUrl?: unknown } | null)?.applicationUrl ?? (body as any)?.applyUrl ?? '').trim()
  try { return new URL(url).protocol === 'https:' ? url : null } catch { return null }
}

