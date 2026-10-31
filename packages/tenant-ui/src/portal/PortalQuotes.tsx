// Portal quotes: list (awaiting response first) + detail with sign-to-approve / decline.
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, CheckCircle, XCircle, Clock, Download, PenTool } from 'lucide-react'
import { usePortal } from './PortalContext'
import { SignatureModal, SignatureDisplay, type SignatureData } from './SignaturePad'
import { PLink, Spinner, PageTitle, Empty, Section, card, pill, btnSuccess, btnSecondary, formatDate, formatWhen, moneyShort, PortalModal, inputCls, labelCls } from './common'
import { codeLabel } from '../labels/codes'
import { SectionedRows } from '../invoicing/sections'

const STATUS_STYLES: Record<string, string> = { sent: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40', viewed: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40', approved: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40', rejected: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40', declined: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40', expired: 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800' }
const RESPONDABLE = ['sent', 'viewed']

export interface PortalQuoteData {
  id: string; number: string; name?: string | null; status: string; total: string | number; subtotal?: string | number
  taxAmount?: string | number; taxRate?: string | number; discount?: string | number; terms?: string | null
  expiryDate?: string | null; approvedAt?: string | null; signature?: string | null; signedBy?: string | null; approvedBy?: string | null
  lineItems?: Array<{ id?: string; description: string; quantity: string | number; unitPrice: string | number; total: string | number; optional?: boolean; selected?: boolean; section?: string | null; allowance?: boolean }>
  /** The deposit asked on approval, and — once approved — its invoice (tenant-backend portal.ts customerQuote). */
  depositAmount?: string
  deposit?: { number: string; total: string; balance: number; path: string | null; payOnline: boolean } | null
  /** A quote with options the customer chooses between (tenant-backend portal.ts customerQuote); absent on any other quote. */
  proposal?: { chosenOptionId: string | null; needsChoice: boolean; options: ProposalOption[] }
  project?: { name: string; number?: string } | null
  [key: string]: unknown
}

export interface ProposalOption {
  id: string; name: string; tier?: string | null; brand?: string | null; warranty?: string | null; description?: string | null
  photos?: string[]; recommended?: boolean; chosen?: boolean; price: string
  /** The deposit asked on approval if this option is chosen ('0.00' when the quote asks none). */
  deposit?: string
  /** What this option's own discount takes off ('0.00' when none). */
  discount?: string
  lines?: Array<{ id?: string; description: string; quantity: string | number; unitPrice: string | number; total: string | number }>
  /** Add-ons that belong to this option alone: offered once it is chosen, ticked one by one. */
  upgrades?: Array<{ id?: string; description: string; quantity: string | number; unitPrice: string | number; total: string | number; selected?: boolean }>
}

/** The options of a quote, side by side: photos, brand, warranty, what is in each, the whole job's price — and the choice. */
function ProposalOptions({ proposal, canRespond, busy, onChoose, onUpgrade }: { proposal: NonNullable<PortalQuoteData['proposal']>; canRespond: boolean; busy: boolean; onChoose: (id: string) => void; onUpgrade: (lineItemId: string, selected: boolean) => void }) {
  const options = proposal.options
  return (
    <div className="p-6 border-b dark:border-slate-700" data-testid="quote-options">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{canRespond ? 'Choose your option' : 'Your option'}</h2>
      {canRespond && <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">Each price is for the whole job. Pick the one you want, then sign.</p>}
      <div className={`grid gap-4 ${options.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {options.map((op) => {
          const shown = canRespond || op.chosen
          if (!shown) return null
          return (
            <div key={op.id} data-testid="quote-option" aria-current={op.chosen ? 'true' : undefined}
              className={`relative flex flex-col rounded-xl border p-4 ${op.chosen ? 'border-green-600 ring-2 ring-green-200 dark:ring-green-900/50' : 'border-gray-200 dark:border-slate-700'} bg-white dark:bg-slate-900`}>
              {op.recommended && <span className="absolute -top-3 left-4 rounded-full bg-orange-600 px-3 py-0.5 text-xs font-semibold text-white">Recommended</span>}
              {op.photos && op.photos.length > 0 && (
                <div className="mb-3">
                  <img src={op.photos[0]} alt={`${op.name}`} loading="lazy" className="h-40 w-full rounded-lg object-cover bg-gray-100 dark:bg-slate-800" />
                  {op.photos.length > 1 && <div className="mt-1 flex gap-1">{op.photos.slice(1, 4).map((src, i) => <img key={i} src={src} alt={`${op.name}, photo ${i + 2}`} loading="lazy" className="h-12 w-1/3 rounded object-cover bg-gray-100 dark:bg-slate-800" />)}</div>}
                </div>
              )}
              <h3 className="text-xl font-bold text-gray-900 dark:text-slate-100">{op.name}</h3>
              {op.brand && <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{op.brand}</p>}
              {op.warranty && <p className="mt-1 text-sm text-gray-700 dark:text-slate-300"><span className="font-medium">Warranty:</span> {op.warranty}</p>}
              {op.description && <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap dark:text-slate-400">{op.description}</p>}
              {op.lines && op.lines.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 dark:text-slate-300">{op.lines.map((l, i) => <li key={l.id || i}>{l.description}</li>)}</ul>}
              {Number(op.discount || 0) > 0 && <p className="mt-2 text-sm font-medium text-green-800 dark:text-green-300" data-testid="option-discount">Includes a {moneyShort(op.discount)} discount</p>}
              {/* The customer chooses the option first; its upgrades are offered after that, and are ticked one by one. */}
              {op.upgrades && op.upgrades.length > 0 && (
                <div className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60" data-testid="option-upgrades">
                  <p className="text-sm font-medium text-gray-900 dark:text-slate-100">Upgrades for {op.name}</p>
                  {op.chosen && canRespond
                    ? <ul className="mt-1 space-y-1">{op.upgrades.map((u, i) => <li key={u.id || i}><label className="flex items-start gap-2 text-sm text-gray-800 dark:text-slate-200"><input type="checkbox" className="mt-1" checked={!!u.selected} disabled={busy || !u.id} onChange={(e) => u.id && onUpgrade(u.id, e.target.checked)} aria-label={`Add ${u.description}`} /><span className="flex-1">{u.description}</span><span>{moneyShort(u.total)}</span></label></li>)}</ul>
                    : op.chosen
                      ? <ul className="mt-1 text-sm text-gray-800 dark:text-slate-200">{op.upgrades.filter((u) => u.selected).map((u, i) => <li key={u.id || i} className="flex justify-between"><span>{u.description}</span><span>{moneyShort(u.total)}</span></li>)}</ul>
                      : <>
                        <ul className="mt-1 list-disc pl-5 text-sm text-gray-700 dark:text-slate-300">{op.upgrades.map((u, i) => <li key={u.id || i}>{u.description} ({moneyShort(u.total)})</li>)}</ul>
                        <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">Choose this option first; you pick its upgrades after.</p>
                      </>}
                </div>
              )}
              <div className="mt-auto pt-4">
                <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{moneyShort(op.price)}</p>
                {Number(op.deposit || 0) > 0 && <p className="text-sm text-gray-600 dark:text-slate-400">Deposit on approval: {moneyShort(op.deposit)}</p>}
                {canRespond
                  ? <button type="button" disabled={busy} onClick={() => onChoose(op.id)} aria-pressed={!!op.chosen} className={op.chosen ? `${btnSuccess} mt-2 w-full justify-center` : `${btnSecondary} mt-2 w-full justify-center`}>{op.chosen ? <><CheckCircle className="w-4 h-4" /> Your choice</> : 'Choose this option'}</button>
                  : <p className="mt-1 text-sm font-medium text-green-800 dark:text-green-300">You chose this option</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PortalQuotes() {
  const { token, fetch: portalFetch, config } = usePortal()
  const [quotes, setQuotes] = useState<PortalQuoteData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    portalFetch('/quotes').then((d) => setQuotes(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false))
  }, [portalFetch])

  if (loading) return <Spinner />
  const pending = quotes.filter((q) => RESPONDABLE.includes(q.status))
  const others = quotes.filter((q) => !RESPONDABLE.includes(q.status))
  return (
    <div>
      <PageTitle title="Quotes" subtitle={`Review and approve quotes from your ${config.providerNoun}.`} />
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {quotes.length === 0 ? <Empty icon={FileText} text="No quotes yet." /> : (
        <div className="space-y-6">
          {pending.length > 0 && <Section title={<><Clock className="w-5 h-5 text-orange-500 dark:text-orange-200" /> Awaiting Your Response ({pending.length})</>}>{pending.map((q) => <QuoteCard key={q.id} quote={q} token={token} highlight />)}</Section>}
          {others.length > 0 && <Section title="All Quotes">{others.map((q) => <QuoteCard key={q.id} quote={q} token={token} />)}</Section>}
        </div>
      )}
    </div>
  )
}

function QuoteCard({ quote, token, highlight }: { quote: PortalQuoteData; token?: string; highlight?: boolean }) {
  return (
    <PLink to={`/portal/${token}/quotes/${quote.id}`} className={`block bg-white rounded-xl border p-4 hover:shadow-md transition-all dark:bg-slate-900 ${highlight ? 'border-orange-300 ring-2 ring-orange-100 dark:ring-orange-900/40' : 'border-gray-200 dark:border-slate-700'}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-blue-100 rounded-lg shrink-0 dark:bg-blue-950/40"><FileText className="w-5 h-5 text-blue-600 dark:text-blue-300" /></div>
          <div className="min-w-0"><p className="font-medium text-gray-900 truncate dark:text-slate-100">{quote.name || quote.number}</p><p className="text-sm text-gray-500 dark:text-slate-400">{quote.number}</p></div>
        </div>
        <div className="text-right shrink-0"><p className="text-lg font-bold text-gray-900 dark:text-slate-100">{moneyShort(quote.total)}</p><span className={pill(STATUS_STYLES[quote.status] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800')}>{codeLabel(quote.status)}</span></div>
      </div>
      {quote.expiryDate && <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Valid until {formatDate(quote.expiryDate)}</p>}
    </PLink>
  )
}

/**
 * One quote, with Sign & Approve and Decline while it is open. Shown in the portal (the id from the route) and on the
 * quote's own link (/d/<token>, the id given — PortalDocumentLink), where there is no list to go back to. (2026-10-22)
 */
export function PortalQuoteDetail({ quoteId: givenId }: { quoteId?: string } = {}) {
  const { quoteId: routeId } = useParams<{ quoteId: string }>()
  const quoteId = givenId || routeId
  const { token, fetch: portalFetch, contact, url, link, company } = usePortal()
  const [quote, setQuote] = useState<PortalQuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showSign, setShowSign] = useState(false)
  const [showDecline, setShowDecline] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    portalFetch(`/quotes/${quoteId}`).then(setQuote).catch((e) => setError((e as Error).message)).finally(() => setLoading(false))
  }, [portalFetch, quoteId])

  const approve = async (sig: SignatureData) => {
    setBusy(true); setShowSign(false); setError('')
    try {
      const res = await portalFetch(`/quotes/${quoteId}/approve`, { method: 'POST', body: JSON.stringify({ signature: sig.signature, signedBy: sig.signedBy, consent: sig.consent }) })
      setQuote((q) => ({ ...(q as PortalQuoteData), ...(res?.quote || { status: 'approved', signature: sig.signature, signedBy: sig.signedBy, approvedAt: sig.signedAt }), ...(res?.deposit !== undefined ? { deposit: res.deposit } : {}) }))
    } catch (e) { setError('Failed to approve quote: ' + (e as Error).message) } finally { setBusy(false) }
  }
  // Tick or untick an optional line before approving: the server works the total out again and answers the quote.
  const choose = async (lineItemId: string, selected: boolean) => {
    setBusy(true); setError('')
    try { const res = await portalFetch(`/quotes/${quoteId}/options`, { method: 'POST', body: JSON.stringify({ lineItemId, selected }) }); setQuote((q) => ({ ...(q as PortalQuoteData), ...res })) }
    catch (e) { setError('Could not change that line: ' + (e as Error).message) } finally { setBusy(false) }
  }
  // Choose one of the quote's options before signing: the server answers the quote with its total for that option.
  const chooseOption = async (optionId: string) => {
    setBusy(true); setError('')
    try { const res = await portalFetch(`/quotes/${quoteId}/choose-option`, { method: 'POST', body: JSON.stringify({ optionId }) }); setQuote((q) => ({ ...(q as PortalQuoteData), ...res })) }
    catch (e) { setError('Could not choose that option: ' + (e as Error).message) } finally { setBusy(false) }
  }
  // Tick or untick an upgrade of the option already chosen: the server answers the quote with its new total.
  const chooseUpgrade = async (lineItemId: string, selected: boolean) => {
    setBusy(true); setError('')
    try { const res = await portalFetch(`/quotes/${quoteId}/choose-upgrade`, { method: 'POST', body: JSON.stringify({ lineItemId, selected }) }); setQuote((q) => ({ ...(q as PortalQuoteData), ...res })) }
    catch (e) { setError('Could not change that upgrade: ' + (e as Error).message) } finally { setBusy(false) }
  }
  const decline = async () => {
    setBusy(true); setError('')
    try { await portalFetch(`/quotes/${quoteId}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason || null }) }); setQuote((q) => ({ ...(q as PortalQuoteData), status: 'rejected' })); setShowDecline(false) }
    catch (e) { setError('Failed to decline quote: ' + (e as Error).message) } finally { setBusy(false) }
  }

  if (loading) return <Spinner />
  if (!quote) return <div className="text-center py-12 text-gray-500 dark:text-slate-400">{error || 'Quote not found.'}</div>
  const canRespond = RESPONDABLE.includes(quote.status)
  const business = (quote.company as { name?: string | null } | undefined)?.name || 'us'
  const hasOptional = (quote.lineItems || []).some((li) => li.optional)
  const proposal = quote.proposal
  const mustChoose = !!proposal && proposal.needsChoice && canRespond
  const reach = [(quote.company as any)?.phone, (quote.company as any)?.email].filter(Boolean).join(' or ')

  return (
    <div>
      <div className={`flex items-center mb-4 ${link ? 'justify-end' : 'justify-between'}`}>
        {!link && <PLink to={`/portal/${token}/quotes`} className="text-orange-600 hover:underline text-sm dark:text-orange-200">{'<-'} Back to Quotes</PLink>}
        <a href={url(`/quotes/${quoteId}/pdf`)} target="_blank" rel="noreferrer" className={btnSecondary}><Download className="w-4 h-4" /> Download PDF</a>
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className={`${card} overflow-hidden`}>
        <div className="p-6 border-b dark:border-slate-700">
          <div className="flex items-start justify-between gap-4">
            <div><h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{quote.name || quote.number}</h1><p className="text-gray-500 dark:text-slate-400">{quote.number}{quote.project ? ` · ${quote.project.name}` : ''}</p></div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[quote.status] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'} dark:text-slate-200`}>{codeLabel(quote.status)}</span>
          </div>
          {quote.expiryDate && <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Valid until {formatDate(quote.expiryDate)}</p>}
        </div>
        {proposal && <ProposalOptions proposal={proposal} canRespond={canRespond} busy={busy} onChoose={chooseOption} onUpgrade={chooseUpgrade} />}
        <div className="p-6 border-b overflow-x-auto dark:border-slate-700">
          {proposal && quote.lineItems && quote.lineItems.length > 0 && <h3 className="font-medium text-gray-900 mb-2 dark:text-slate-100">{canRespond ? 'Included with every option' : 'Included'}</h3>}
          <table className="w-full">
            <thead><tr className="text-left text-sm text-gray-500 border-b dark:text-slate-400 dark:border-slate-700"><th className="pb-2">Description</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Price</th><th className="pb-2 text-right">Total</th></tr></thead>
            <tbody><SectionedRows lines={quote.lineItems || []} colSpan={4} pad="py-2" row={(item, i) => <tr key={i} className="border-b last:border-0 dark:border-slate-800"><td className="py-3 text-gray-900 whitespace-pre-line dark:text-slate-100">{item.allowance && <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">Allowance</span>}{item.optional && canRespond && item.id
              ? <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={!!item.selected} disabled={busy} onChange={(e) => choose(item.id!, e.target.checked)} aria-label={`Add ${item.description}`} /><span>{item.description} <span className="text-xs text-gray-600 dark:text-slate-400">(optional)</span></span></label>
              : <>{item.description}{item.optional && <span className="text-xs text-gray-600 dark:text-slate-400">{` (optional${item.selected ? ', included' : ', not included'})`}</span>}</>}</td><td className="py-3 text-right text-gray-900 dark:text-slate-100">{item.quantity}</td><td className="py-3 text-right text-gray-900 dark:text-slate-100">{moneyShort(item.unitPrice)}</td><td className="py-3 text-right font-medium text-gray-900 dark:text-slate-100">{moneyShort(item.total)}</td></tr>} /></tbody>
          </table>
        </div>
        <div className="p-6 bg-gray-50 dark:bg-slate-800/60">
          <div className="max-w-xs ml-auto space-y-2 text-gray-900 dark:text-slate-100">
            <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Subtotal</span><span>{moneyShort(quote.subtotal)}</span></div>
            {Number(quote.taxAmount || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Tax ({quote.taxRate}%)</span><span>{moneyShort(quote.taxAmount)}</span></div>}
            {Number(quote.discount || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Discount</span><span>-{moneyShort(quote.discount)}</span></div>}
            {mustChoose
              ? <p className="border-t pt-2 text-sm font-medium dark:border-slate-700" data-testid="quote-choose-first">Choose an option above to see your total.</p>
              : <div className="flex justify-between text-lg font-bold border-t pt-2 dark:border-slate-700"><span>Total</span><span>{moneyShort(quote.total)}</span></div>}
            {hasOptional && canRespond && <p className="text-xs text-gray-600 dark:text-slate-400">Optional items count once you tick them.</p>}
            {Number(quote.depositAmount || 0) > 0 && <div className="flex justify-between text-sm" data-testid="quote-deposit"><span className="text-gray-600 dark:text-slate-400">{canRespond ? 'Deposit due on approval' : 'Deposit'}</span><span>{moneyShort(quote.depositAmount)}</span></div>}
          </div>
        </div>
        {quote.terms && <div className="p-6 border-t dark:border-slate-700"><h3 className="font-medium text-gray-900 mb-1 dark:text-slate-100">Terms</h3><p className="text-sm text-gray-700 whitespace-pre-wrap dark:text-slate-300">{quote.terms}</p></div>}
        {canRespond && (
          <div className="p-6 bg-orange-50 border-t dark:bg-orange-950/20 dark:border-slate-700">
            <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">{mustChoose ? 'Choose one of the options above, then sign to approve.' : 'Please review this quote and provide your signature to approve.'}</p>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setShowSign(true)} disabled={busy || mustChoose} title={mustChoose ? 'Choose an option first' : undefined} className={btnSuccess}><PenTool className="w-4 h-4" /> Sign & Approve</button>
              <button onClick={() => setShowDecline(true)} disabled={busy} className={btnSecondary}><XCircle className="w-4 h-4" /> Decline</button>
            </div>
          </div>
        )}
        {quote.status === 'approved' && (
          <div className="p-6 bg-green-50 border-t dark:bg-green-950/20 dark:border-slate-700">
            <div className="flex items-start gap-4">
              <CheckCircle className="w-6 h-6 text-green-700 shrink-0 mt-1 dark:text-green-300" />
              <div className="flex-1"><p className="font-medium text-green-800 dark:text-green-300">Quote approved{quote.approvedAt ? ` on ${formatWhen(quote.approvedAt, company?.timeZone)}` : ''}</p>
                {/* The deposit is its own invoice: paid on its page by card where the business takes cards, else how to pay. */}
                {quote.deposit && Number(quote.deposit.balance) > 0 && (
                  <div className="mt-3 rounded-lg border border-green-200 bg-white p-3 text-sm text-gray-800 dark:border-green-900 dark:bg-slate-900 dark:text-slate-200" data-testid="quote-deposit-due">
                    <p className="font-medium">Deposit due: {moneyShort(quote.deposit.balance)} ({quote.deposit.number})</p>
                    {quote.deposit.payOnline && quote.deposit.path
                      ? <a href={quote.deposit.path} className={`${btnSuccess} mt-2`}>Pay the deposit</a>
                      : <p className="mt-1 text-gray-700 dark:text-slate-300">{business} does not take card payments online. To pay the deposit, please contact them{reach ? ` at ${reach}` : ''}.</p>}
                  </div>
                )}
                {quote.deposit && Number(quote.deposit.balance) <= 0 && <p className="mt-2 text-sm text-green-800 dark:text-green-300">Deposit paid ({quote.deposit.number}). Thank you.</p>}{quote.signature && <SignatureDisplay className="mt-3" signature={quote.signature} signedBy={(quote.signedBy || quote.approvedBy) ?? undefined} signedAt={quote.approvedAt ?? undefined} timeZone={company?.timeZone} />}</div>
            </div>
          </div>
        )}
        {/* Past its valid-until day: no buttons, and who to ask instead (the server refuses an answer too). */}
        {quote.status === 'expired' && <div className="p-6 bg-gray-50 border-t text-gray-700 flex items-center gap-2 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700"><Clock className="w-5 h-5 shrink-0" /><span>This quote expired{quote.expiryDate ? ` on ${formatDate(quote.expiryDate)}` : ''}. Please contact {business} for an updated quote.</span></div>}
        {(quote.status === 'rejected' || quote.status === 'declined') && <div className="p-6 bg-red-50 border-t text-red-700 flex items-center gap-2 dark:bg-red-950/20 dark:text-red-300 dark:border-slate-700"><XCircle className="w-5 h-5" /><span className="font-medium">Declined</span></div>}
      </div>
      <SignatureModal isOpen={showSign} onClose={() => setShowSign(false)} onSave={approve} title="Approve Quote" signerName={contact?.name || ''} />
      {showDecline && (
        <PortalModal title="Decline this quote?" subtitle={`${quote.number} · ${moneyShort(quote.total)}`} onClose={() => setShowDecline(false)}>
          <label className={labelCls} htmlFor="decline-reason">Reason (optional)</label>
          <textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} placeholder="Let us know what didn't work" />
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setShowDecline(false)} disabled={busy} className={btnSecondary}>Cancel</button>
            <button onClick={decline} disabled={busy} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">{busy ? 'Declining…' : 'Decline Quote'}</button>
          </div>
        </PortalModal>
      )}
    </div>
  )
}
