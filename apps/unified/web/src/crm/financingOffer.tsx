// The customer's side of consumer financing, under the quote or invoice on its own page (/d/<token>). The server answers
// an estimate only for a business with consumer_financing on (not ready: nobody), its lender connected, and a document
// in the lender's range; otherwise 404, and nothing about financing is shown.
import { useEffect, useState } from 'react'
import { money } from '@twomiah/tenant-ui/src/money'

interface Offer { lender: string; amount: number; asLowAs: number; apr: number; termMonths: number; disclosure: string }

export function FinancingOffer({ token }: { token: string }) {
  const [offer, setOffer] = useState<Offer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    fetch(`/api/financing-public/d/${encodeURIComponent(token)}`).then(async (r) => { if (live && r.ok) setOffer(await r.json()) }).catch(() => {})
    return () => { live = false }
  }, [token])
  if (!offer) return null
  const apply = async () => {
    setBusy(true); setError('')
    try {
      const r = await fetch(`/api/financing-public/d/${encodeURIComponent(token)}/apply`, { method: 'POST' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok || !body.url) throw new Error(body.error || 'The application could not be opened. Please contact the business.')
      window.location.href = body.url
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <section className="mt-6 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 text-gray-900 dark:text-slate-100" data-testid="financing-offer" aria-labelledby="financing-offer-title">
      <h2 id="financing-offer-title" className="text-lg font-semibold">Pay over time</h2>
      <p className="text-3xl font-bold mt-1">As low as {money(offer.asLowAs)}/mo*</p>
      <p className="text-gray-700 dark:text-slate-300 mt-1">Apply with {offer.lender}. Checking your options won't affect your credit score.</p>
      <button type="button" onClick={apply} disabled={busy} className="mt-4 w-full sm:w-auto px-5 py-3 rounded-lg bg-emerald-700 text-white font-semibold hover:bg-emerald-800 disabled:opacity-60">{busy ? 'Opening…' : 'Check my options'}</button>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <p className="text-xs text-gray-600 dark:text-slate-400 mt-4">*Estimate on {money(offer.amount)}: {money(offer.asLowAs)}/mo for {offer.termMonths} months at {offer.apr}% APR. {offer.disclosure}</p>
    </section>
  )
}

// ── Roofing parity row 30: financing beside each proposal option (proposal_financing, not ready) ─────────────────────
// Roofr and Leap show a monthly figure on each package. The server answers an estimate per pick-one option, on that
// option's whole price (/api/financing-public/d/<token>/options); 404 — nothing shown — when the switch is off, the lender
// is not connected, or no option is in the lender's range. Apply waits for the choice: an application is for one price.
export interface OptionOffer { asLowAs: number; apr: number; termMonths: number; amount: number }
export interface OptionOffers { lender: string; disclosure: string; needsChoice: boolean; options: Record<string, OptionOffer> }

export function useOptionOffers(token: string, rev: number): OptionOffers | null {
  const [offers, setOffers] = useState<OptionOffers | null>(null)
  useEffect(() => {
    if (!token) return
    let live = true
    fetch(`/api/financing-public/d/${encodeURIComponent(token)}/options`)
      .then(async (r) => { if (live) setOffers(r.ok ? await r.json() : null) })
      .catch(() => {})
    return () => { live = false }
  }, [token, rev])
  return offers
}

/** Under an option's price: its estimate, starred to the disclosure on the page. */
export function OptionFinancing({ offer }: { offer: OptionOffer }) {
  return <p className="mt-1 text-sm font-medium text-emerald-800 dark:text-emerald-300" data-testid="option-financing">or as low as {money(offer.asLowAs)}/mo*</p>
}

/** While the customer has not chosen: what the stars mean, and that Apply comes after the choice. */
export function OptionFinancingNote({ lender, disclosure }: { lender: string; disclosure: string }) {
  return (
    <section className="mt-6 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 text-gray-900 dark:text-slate-100" data-testid="option-financing-note" aria-labelledby="option-financing-title">
      <h2 id="option-financing-title" className="text-lg font-semibold">Pay over time</h2>
      <p className="text-gray-700 dark:text-slate-300 mt-1">Choose an option above, then check your options with {lender} here. Checking won't affect your credit score.</p>
      <p className="text-xs text-gray-600 dark:text-slate-400 mt-4">*Estimate on each option's price at the example terms below. {disclosure}</p>
    </section>
  )
}
