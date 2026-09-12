import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit, Trash2, Send, Check, X, FileText, Download, Briefcase, Wrench, MapPinned } from 'lucide-react'
import type { InvoicingPageProps } from './types'
import { resolveConfig } from './types'
import { Button, ConfirmModal, NavLink, StatusBadge, dateOnly, dateTime, downloadFile, errMsg, isPastDay, money } from './ui'

type Q = Record<string, any>
const EDITABLE = ['draft', 'sent']

export function QuoteDetailPage({ api, toast, config }: InvoicingPageProps) {
  const cfg = resolveConfig(config)
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [quote, setQuote] = useState<Q | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setQuote(await api.get(`/api/quotes/${id}`)) } catch (e) { setError(errMsg(e, 'Could not load this quote')) } finally { setLoading(false) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-8 text-gray-500 dark:text-slate-400">Loading…</div>
  if (error || !quote) return <div className="p-8 text-center"><p className="text-red-600 mb-3">{error || 'Quote not found'}</p><Button variant="secondary" onClick={load}>Retry</Button></div>

  const act = async (path: string, ok: string) => { setBusy(true); try { const r = await api.post(path, {}); toast.success(ok); await load(); return r } catch (e) { toast.error(errMsg(e, 'That did not work')) } finally { setBusy(false) } }
  const handleDelete = async () => { try { await api.delete('/api/quotes', id); toast.success('Quote deleted'); navigate('/crm/quotes') } catch (e) { toast.error(errMsg(e, 'Could not delete')) } }
  const handlePdf = async () => { try { await downloadFile(`/api/quotes/${id}/pdf`, `quote-${quote.number}.pdf`) } catch (e) { toast.error(errMsg(e, 'Could not download the PDF')) } }
  const editable = EDITABLE.includes(quote.status)
  const expired = !!quote.expiryDate && isPastDay(quote.expiryDate) && editable
  const secondary = 'px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600'
  const timeline: Array<[string, string, any]> = [['Created', 'bg-gray-400', quote.createdAt], ['Sent', 'bg-blue-500', quote.sentAt], ['Viewed', 'bg-purple-500', quote.viewedAt], ['Approved', 'bg-green-500', quote.approvedAt], [cfg.quoteDecline ? 'Declined' : 'Rejected', 'bg-red-500', quote.declinedAt]]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/crm/quotes')} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800" aria-label="Back to quotes"><ArrowLeft className="w-5 h-5" /></button>
          <div>
            <p className="text-sm font-mono text-gray-500 dark:text-slate-400">{quote.number}</p>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{quote.name}</h1>
            <div className="flex items-center gap-2"><StatusBadge status={quote.status} />{expired && <span className="text-xs text-red-600 dark:text-red-300">expired {dateOnly(quote.expiryDate)}</span>}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && <Button variant="secondary" onClick={() => act(`/api/quotes/${id}/send`, 'Quote sent')} disabled={busy}><Send className="w-4 h-4" /> {quote.sentAt ? 'Send again' : 'Send'}</Button>}
          {editable && <Button variant="success" onClick={() => act(`/api/quotes/${id}/approve`, 'Quote approved')} disabled={busy}><Check className="w-4 h-4" /> Mark approved</Button>}
          {editable && <Button variant="secondary" onClick={() => act(`/api/quotes/${id}/${cfg.quoteDecline ? 'decline' : 'reject'}`, cfg.quoteDecline ? 'Quote declined' : 'Quote rejected')} disabled={busy}><X className="w-4 h-4" /> {cfg.quoteDecline ? 'Mark declined' : 'Mark rejected'}</Button>}
          {quote.status === 'approved' && cfg.jobs && !quote.convertedToJobId && <Button variant="success" onClick={async () => { const job = await act(`/api/quotes/${id}/convert-to-job`, 'Job created from quote'); if (job?.id) navigate(cfg.jobPath(job.id)) }} disabled={busy}><Briefcase className="w-4 h-4" /> Convert to Job</Button>}
          {quote.status === 'approved' && <Button onClick={async () => { const inv = await act(`/api/quotes/${id}/convert-to-invoice`, 'Invoice created'); if (inv?.id) navigate(`/crm/invoices/${inv.id}`) }} disabled={busy}><FileText className="w-4 h-4" /> Create Invoice</Button>}
          <Button variant="secondary" onClick={handlePdf}><Download className="w-4 h-4" /> PDF</Button>
          {editable && <NavLink to={`/crm/quotes?edit=${id}`} className={secondary}><Edit className="w-4 h-4" /> Edit</NavLink>}
          {quote.status === 'draft' && <Button variant="danger" onClick={() => setDeleteOpen(true)} aria-label="Delete quote"><Trash2 className="w-4 h-4" /></Button>}
        </div>
      </div>

      {quote.convertedToJobId && cfg.jobs && (
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-center justify-between text-green-800 dark:text-green-200">
          <p>This quote has been converted to a job.</p>
          <NavLink to={cfg.jobPath(quote.convertedToJobId)} className="font-medium hover:underline inline-flex items-center gap-1"><Briefcase className="w-4 h-4" /> View job</NavLink>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-slate-800"><h2 className="font-semibold text-gray-900 dark:text-white">Line Items</h2></div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/60"><tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Description</th><th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Qty</th><th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Price</th><th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800 text-gray-900 dark:text-slate-100">
                {(quote.lineItems || []).map((li: any, i: number) => <tr key={i}><td className="px-4 py-3">{li.description}</td><td className="px-4 py-3 text-right">{Number(li.quantity)}</td><td className="px-4 py-3 text-right">{money(li.unitPrice)}</td><td className="px-4 py-3 text-right font-medium">{money(li.total)}</td></tr>)}
                {(quote.lineItems || []).length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No line items</td></tr>}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-slate-800/60 text-gray-900 dark:text-slate-100">
                <tr><td colSpan={3} className="px-4 py-2 text-right text-sm">Subtotal</td><td className="px-4 py-2 text-right">{money(quote.subtotal)}</td></tr>
                {Number(quote.discount) > 0 && <tr><td colSpan={3} className="px-4 py-2 text-right text-sm">Discount</td><td className="px-4 py-2 text-right text-green-700 dark:text-green-300">-{money(quote.discount)}</td></tr>}
                {Number(quote.taxAmount) > 0 && <tr><td colSpan={3} className="px-4 py-2 text-right text-sm">Tax ({Number(quote.taxRate)}%)</td><td className="px-4 py-2 text-right">{money(quote.taxAmount)}</td></tr>}
                <tr className="font-bold text-base"><td colSpan={3} className="px-4 py-3 text-right">Total</td><td className="px-4 py-3 text-right">{money(quote.total)}</td></tr>
              </tfoot>
            </table>
          </div>

          {cfg.quoteCustomerMessage && quote.customerMessage && <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6"><h2 className="font-semibold mb-2 text-gray-900 dark:text-white">Customer Message</h2><p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-slate-300">{quote.customerMessage}</p></div>}
          {quote.notes && <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6"><h2 className="font-semibold mb-2 text-gray-900 dark:text-white">{cfg.quoteCustomerMessage ? 'Internal Notes' : 'Notes'}</h2><p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-slate-300">{quote.notes}</p></div>}

          {quote.signature && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6">
              <h2 className="font-semibold mb-3 text-gray-900 dark:text-white">Signed Acceptance</h2>
              <div className="border border-green-200 dark:border-green-800 rounded-lg bg-green-50 dark:bg-green-900/20 p-4">
                <img src={quote.signature} alt="Customer signature" className="max-h-24 bg-white rounded" />
                <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-700 dark:text-slate-200">
                  <div><span className="text-gray-500 dark:text-slate-400">Signed by</span><p className="font-medium">{quote.signedBy || '-'}</p></div>
                  <div><span className="text-gray-500 dark:text-slate-400">Signed at</span><p className="font-medium">{dateTime(quote.signedAt)}</p></div>
                  <div><span className="text-gray-500 dark:text-slate-400">IP address</span><p className="font-mono text-xs">{quote.signedIp || '-'}</p></div>
                  <div><span className="text-gray-500 dark:text-slate-400">Consent</span><p className="font-medium">{quote.consentAt ? 'Agreed to sign electronically' : '-'}</p></div>
                </div>
                {quote.signatureHash && <p className="mt-3 text-xs text-gray-500 dark:text-slate-400 break-all"><span className="text-gray-400">Document fingerprint (SHA-256): </span><span className="font-mono">{quote.signatureHash}</span></p>}
                {quote.signedUserAgent && <p className="mt-1 text-xs text-gray-400 break-all">{quote.signedUserAgent}</p>}
              </div>
            </div>
          )}
          {quote.terms && <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6"><h2 className="font-semibold mb-2 text-gray-900 dark:text-white">Terms &amp; Conditions</h2><p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-slate-300">{quote.terms}</p></div>}

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6">
            <h2 className="font-semibold mb-4 text-gray-900 dark:text-white">Timeline</h2>
            <div className="space-y-3">
              {timeline.filter(([, , at]) => !!at).map(([label, dot, at]) => <div key={label} className="flex items-center gap-3 text-sm"><div className={`w-2 h-2 rounded-full ${dot}`} /><span className="text-gray-500 dark:text-slate-400 w-20">{label}</span><span className="text-gray-900 dark:text-slate-100">{dateTime(at)}</span></div>)}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 text-sm text-gray-900 dark:text-slate-100">
            <h2 className="font-semibold mb-4">Details</h2>
            <div className="space-y-3">
              {quote.contact && <div><p className="text-gray-500 dark:text-slate-400">{cfg.clientLabel}</p><NavLink to={cfg.clientPath(quote.contact.id)} className="text-orange-600 dark:text-orange-300 hover:underline">{quote.contact.name}</NavLink></div>}
              {cfg.projects && quote.project && <div><p className="text-gray-500 dark:text-slate-400">Project</p><NavLink to={`/crm/projects/${quote.project.id}`} className="text-orange-600 dark:text-orange-300 hover:underline">{quote.project.name}</NavLink></div>}
              {cfg.quoteEquipment && quote.equipment && <div><p className="text-gray-500 dark:text-slate-400 flex items-center gap-1"><Wrench className="w-3 h-3" /> Equipment</p><p>{quote.equipment.name}{quote.equipment.manufacturer ? ` — ${quote.equipment.manufacturer}` : ''}{quote.equipment.model ? ` ${quote.equipment.model}` : ''}</p></div>}
              {cfg.quoteSites && quote.site && <div><p className="text-gray-500 dark:text-slate-400 flex items-center gap-1"><MapPinned className="w-3 h-3" /> Location</p><p>{quote.site.name}{quote.site.address ? ` — ${quote.site.address}` : ''}</p></div>}
              <div><p className="text-gray-500 dark:text-slate-400">Valid Until</p><p className={expired ? 'text-red-600 dark:text-red-300' : ''}>{quote.expiryDate ? dateOnly(quote.expiryDate) : 'No expiry'}</p></div>
              <div><p className="text-gray-500 dark:text-slate-400">Created</p><p>{dateTime(quote.createdAt)}</p></div>
            </div>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/30 rounded-xl p-6 text-center text-orange-700 dark:text-orange-200"><p className="text-3xl font-bold">{money(quote.total)}</p><p className="text-sm opacity-80">Quote Total</p></div>
        </div>
      </div>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete quote" message={`Delete ${quote.number}? This cannot be undone.`} confirmText="Delete" />
    </div>
  )
}
