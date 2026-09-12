// Portal quotes: list (awaiting response first) + detail with sign-to-approve / decline.
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, CheckCircle, XCircle, Clock, Download, PenTool } from 'lucide-react'
import { usePortal } from './PortalContext'
import { SignatureModal, SignatureDisplay, type SignatureData } from './SignaturePad'
import { PLink, Spinner, PageTitle, Empty, Section, card, pill, btnSuccess, btnSecondary, formatDate, moneyShort, PortalModal, inputCls, labelCls } from './common'

const STATUS_STYLES: Record<string, string> = { sent: 'bg-blue-100 text-blue-700', viewed: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', declined: 'bg-red-100 text-red-700', expired: 'bg-gray-100 text-gray-500' }
const RESPONDABLE = ['sent', 'viewed']

export interface PortalQuoteData {
  id: string; number: string; name?: string | null; status: string; total: string | number; subtotal?: string | number
  taxAmount?: string | number; taxRate?: string | number; discount?: string | number; terms?: string | null
  expiryDate?: string | null; approvedAt?: string | null; signature?: string | null; signedBy?: string | null; approvedBy?: string | null
  lineItems?: Array<{ description: string; quantity: string | number; unitPrice: string | number; total: string | number }>
  project?: { name: string; number?: string } | null
  [key: string]: unknown
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
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {quotes.length === 0 ? <Empty icon={FileText} text="No quotes yet." /> : (
        <div className="space-y-6">
          {pending.length > 0 && <Section title={<><Clock className="w-5 h-5 text-orange-500" /> Awaiting Your Response ({pending.length})</>}>{pending.map((q) => <QuoteCard key={q.id} quote={q} token={token} highlight />)}</Section>}
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
          <div className="p-2 bg-blue-100 rounded-lg shrink-0"><FileText className="w-5 h-5 text-blue-600" /></div>
          <div className="min-w-0"><p className="font-medium text-gray-900 truncate dark:text-slate-100">{quote.name || quote.number}</p><p className="text-sm text-gray-500 dark:text-slate-400">{quote.number}</p></div>
        </div>
        <div className="text-right shrink-0"><p className="text-lg font-bold text-gray-900 dark:text-slate-100">{moneyShort(quote.total)}</p><span className={pill(STATUS_STYLES[quote.status] || 'bg-gray-100 text-gray-700')}>{quote.status}</span></div>
      </div>
      {quote.expiryDate && <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Valid until {formatDate(quote.expiryDate)}</p>}
    </PLink>
  )
}

export function PortalQuoteDetail() {
  const { quoteId } = useParams<{ quoteId: string }>()
  const { token, fetch: portalFetch, contact, url } = usePortal()
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
      setQuote((q) => ({ ...(q as PortalQuoteData), ...(res?.quote || { status: 'approved', signature: sig.signature, signedBy: sig.signedBy, approvedAt: sig.signedAt }) }))
    } catch (e) { setError('Failed to approve quote: ' + (e as Error).message) } finally { setBusy(false) }
  }
  const decline = async () => {
    setBusy(true); setError('')
    try { await portalFetch(`/quotes/${quoteId}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason || null }) }); setQuote((q) => ({ ...(q as PortalQuoteData), status: 'rejected' })); setShowDecline(false) }
    catch (e) { setError('Failed to decline quote: ' + (e as Error).message) } finally { setBusy(false) }
  }

  if (loading) return <Spinner />
  if (!quote) return <div className="text-center py-12 text-gray-500 dark:text-slate-400">{error || 'Quote not found.'}</div>
  const canRespond = RESPONDABLE.includes(quote.status)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <PLink to={`/portal/${token}/quotes`} className="text-orange-600 hover:underline text-sm">{'<-'} Back to Quotes</PLink>
        <a href={url(`/quotes/${quoteId}/pdf`)} target="_blank" rel="noreferrer" className={btnSecondary}><Download className="w-4 h-4" /> Download PDF</a>
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      <div className={`${card} overflow-hidden`}>
        <div className="p-6 border-b dark:border-slate-700">
          <div className="flex items-start justify-between gap-4">
            <div><h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{quote.name || quote.number}</h1><p className="text-gray-500 dark:text-slate-400">{quote.number}{quote.project ? ` · ${quote.project.name}` : ''}</p></div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[quote.status] || 'bg-gray-100 text-gray-700'}`}>{quote.status}</span>
          </div>
          {quote.expiryDate && <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Valid until {formatDate(quote.expiryDate)}</p>}
        </div>
        <div className="p-6 border-b overflow-x-auto dark:border-slate-700">
          <table className="w-full">
            <thead><tr className="text-left text-sm text-gray-500 border-b dark:text-slate-400 dark:border-slate-700"><th className="pb-2">Description</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Price</th><th className="pb-2 text-right">Total</th></tr></thead>
            <tbody>{quote.lineItems?.map((item, i) => <tr key={i} className="border-b last:border-0 dark:border-slate-800"><td className="py-3 text-gray-900 dark:text-slate-100">{item.description}</td><td className="py-3 text-right text-gray-900 dark:text-slate-100">{item.quantity}</td><td className="py-3 text-right text-gray-900 dark:text-slate-100">{moneyShort(item.unitPrice)}</td><td className="py-3 text-right font-medium text-gray-900 dark:text-slate-100">{moneyShort(item.total)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="p-6 bg-gray-50 dark:bg-slate-800/60">
          <div className="max-w-xs ml-auto space-y-2 text-gray-900 dark:text-slate-100">
            <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Subtotal</span><span>{moneyShort(quote.subtotal)}</span></div>
            {Number(quote.taxAmount || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Tax ({quote.taxRate}%)</span><span>{moneyShort(quote.taxAmount)}</span></div>}
            {Number(quote.discount || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Discount</span><span>-{moneyShort(quote.discount)}</span></div>}
            <div className="flex justify-between text-lg font-bold border-t pt-2 dark:border-slate-700"><span>Total</span><span>{moneyShort(quote.total)}</span></div>
          </div>
        </div>
        {quote.terms && <div className="p-6 border-t dark:border-slate-700"><h3 className="font-medium text-gray-900 mb-1 dark:text-slate-100">Terms</h3><p className="text-sm text-gray-700 whitespace-pre-wrap dark:text-slate-300">{quote.terms}</p></div>}
        {canRespond && (
          <div className="p-6 bg-orange-50 border-t dark:bg-orange-950/20 dark:border-slate-700">
            <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">Please review this quote and provide your signature to approve.</p>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setShowSign(true)} disabled={busy} className={btnSuccess}><PenTool className="w-4 h-4" /> Sign & Approve</button>
              <button onClick={() => setShowDecline(true)} disabled={busy} className={btnSecondary}><XCircle className="w-4 h-4" /> Decline</button>
            </div>
          </div>
        )}
        {quote.status === 'approved' && (
          <div className="p-6 bg-green-50 border-t dark:bg-green-950/20 dark:border-slate-700">
            <div className="flex items-start gap-4">
              <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" />
              <div className="flex-1"><p className="font-medium text-green-800 dark:text-green-300">Quote approved{quote.approvedAt ? ` on ${formatDate(quote.approvedAt)}` : ''}</p>{quote.signature && <SignatureDisplay className="mt-3" signature={quote.signature} signedBy={(quote.signedBy || quote.approvedBy) ?? undefined} signedAt={quote.approvedAt ?? undefined} />}</div>
            </div>
          </div>
        )}
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
