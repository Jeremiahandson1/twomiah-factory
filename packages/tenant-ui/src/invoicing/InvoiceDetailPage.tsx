import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit, Trash2, Send, DollarSign, Download, Ban, RotateCcw, RefreshCw } from 'lucide-react'
import type { InvoicingPageProps } from './types'
import { resolveConfig } from './types'
import { Button, ConfirmModal, NavLink, Field, Modal, PAYMENT_METHODS, StatusBadge, dateOnly, dateTime, downloadFile, errMsg, inputCls, isPastDay, money } from './ui'

type Inv = Record<string, any>

export function InvoiceDetailPage({ api, toast, config }: InvoicingPageProps) {
  const cfg = resolveConfig(config)
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [invoice, setInvoice] = useState<Inv | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [payment, setPayment] = useState({ amount: '', method: 'card', reference: '', notes: '', tipAmount: '' })
  const [refundOpen, setRefundOpen] = useState(false)
  const [refund, setRefund] = useState({ amount: '', method: '', reference: '', notes: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setInvoice(await api.get(`/api/invoices/${id}`)) } catch (e) { setError(errMsg(e, 'Could not load this invoice')) } finally { setLoading(false) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-8 text-gray-500 dark:text-slate-400">Loading…</div>
  if (error || !invoice) return <div className="p-8 text-center"><p className="text-red-600 mb-3">{error || 'Invoice not found'}</p><Button variant="secondary" onClick={load}>Retry</Button></div>

  const netPaid = Number(invoice.amountPaid || 0) - Number(invoice.amountRefunded || 0)
  const closed = invoice.status === 'void' || invoice.status === 'refunded'
  const balance = closed ? 0 : Math.max(0, Number(invoice.total) - Number(invoice.amountPaid || 0))
  const credit = closed ? 0 : Math.max(0, Number(invoice.amountPaid || 0) - Number(invoice.total))
  const overdue = balance > 0 && !!invoice.dueDate && isPastDay(invoice.dueDate) && !['draft'].includes(invoice.status)

  const run = async (fn: () => Promise<unknown>, ok: string, fail: string) => { setBusy(true); try { await fn(); toast.success(ok); await load(); return true } catch (e) { toast.error(errMsg(e, fail)); return false } finally { setBusy(false) } }
  const handleSend = () => run(() => api.post(`/api/invoices/${id}/send`, {}), 'Invoice sent', 'Could not send')
  const handleDelete = async () => { try { await api.delete('/api/invoices', id); toast.success('Invoice deleted'); navigate('/crm/invoices') } catch (e) { toast.error(errMsg(e, 'Could not delete')) } }
  const handleVoid = async () => { if (await run(() => api.post(`/api/invoices/${id}/void`, {}), 'Invoice voided', 'Could not void')) setVoidOpen(false) }
  const handlePayment = async () => {
    if (!(Number(payment.amount) > 0)) { toast.error('Enter a valid amount'); return }
    const body: any = { amount: Number(payment.amount), method: payment.method, reference: payment.reference || undefined, notes: payment.notes || undefined }
    if (cfg.tips && Number(payment.tipAmount) > 0) body.tipAmount = Number(payment.tipAmount)
    if (await run(() => api.post(`/api/invoices/${id}/payments`, body), 'Payment recorded', 'Could not record the payment')) setPaymentOpen(false)
  }
  const handleRefund = async () => {
    if (!(Number(refund.amount) > 0)) { toast.error('Enter a valid amount'); return }
    const body: any = { amount: Number(refund.amount), reference: refund.reference || undefined, notes: refund.notes || undefined }
    if (refund.method) body.method = refund.method
    if (await run(() => api.post(`/api/invoices/${id}/refund`, body), 'Refund recorded', 'Could not record the refund')) setRefundOpen(false)
  }
  const handlePdf = async () => { try { await downloadFile(`/api/invoices/${id}/pdf`, `invoice-${invoice.number}.pdf`) } catch (e) { toast.error(errMsg(e, 'Could not download the PDF')) } }
  const handleQuickBooks = () => run(() => api.post(`/api/quickbooks/sync/invoice/${id}`, {}), 'Synced to QuickBooks', 'QuickBooks sync failed')

  const bigLabel = balance > 0 ? 'Balance Due' : credit > 0 ? 'Credit Balance' : invoice.status === 'refunded' ? 'Refunded' : invoice.status === 'void' ? 'Void' : Number(invoice.amountRefunded || 0) > 0 ? `Paid in Full · ${money(invoice.amountRefunded)} refunded` : Number(invoice.amountPaid || 0) > 0 ? 'Paid in Full' : 'Nothing collected yet'
  const bigAmount = balance > 0 ? balance : credit > 0 ? credit : closed ? 0 : Number(invoice.total)
  const bigTone = balance > 0 ? (overdue ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200' : 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200') : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/crm/invoices')} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800" aria-label="Back to invoices"><ArrowLeft className="w-5 h-5" /></button>
          <div>
            <p className="text-sm font-mono text-gray-500 dark:text-slate-400">{invoice.number}</p>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Invoice</h1>
            <StatusBadge status={invoice.status} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!closed && <Button variant="secondary" onClick={handleSend} disabled={busy}><Send className="w-4 h-4" /> {invoice.sentAt ? 'Send again' : 'Send'}</Button>}
          {!closed && balance > 0.005 && <Button variant="success" onClick={() => { setPayment({ amount: balance.toFixed(2), method: 'card', reference: '', notes: '', tipAmount: '' }); setPaymentOpen(true) }}><DollarSign className="w-4 h-4" /> Record Payment</Button>}
          {invoice.status !== 'void' && netPaid > 0.005 && <Button variant="warn" onClick={() => { setRefund({ amount: netPaid.toFixed(2), method: '', reference: '', notes: '' }); setRefundOpen(true) }}><RotateCcw className="w-4 h-4" /> Refund</Button>}
          {invoice.status !== 'void' && netPaid <= 0.005 && <Button variant="secondary" onClick={() => setVoidOpen(true)}><Ban className="w-4 h-4" /> Void</Button>}
          <Button variant="secondary" onClick={handlePdf}><Download className="w-4 h-4" /> PDF</Button>
          {cfg.quickbooks && <Button variant="secondary" onClick={handleQuickBooks} disabled={busy}><RefreshCw className="w-4 h-4" /> {invoice.syncedAt ? 'Re-sync QuickBooks' : 'Sync to QuickBooks'}</Button>}
          {!closed && <NavLink to={`/crm/invoices?edit=${id}`} className="px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"><Edit className="w-4 h-4" /> Edit</NavLink>}
          {Number(invoice.amountPaid || 0) <= 0 && invoice.status !== 'paid' && <Button variant="danger" onClick={() => setDeleteOpen(true)} aria-label="Delete invoice"><Trash2 className="w-4 h-4" /></Button>}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-slate-800"><h2 className="font-semibold text-gray-900 dark:text-white">Line Items</h2></div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/60"><tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Description</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Price</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800 text-gray-900 dark:text-slate-100">
                {(invoice.lineItems || []).map((li: any, i: number) => (
                  <tr key={i}><td className="px-4 py-3">{li.description}</td><td className="px-4 py-3 text-right">{Number(li.quantity)}</td><td className="px-4 py-3 text-right">{money(li.unitPrice)}</td><td className="px-4 py-3 text-right font-medium">{money(li.total)}</td></tr>
                ))}
                {(invoice.lineItems || []).length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No line items</td></tr>}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-slate-800/60 text-gray-900 dark:text-slate-100">
                <tr><td colSpan={3} className="px-4 py-2 text-right text-sm">Subtotal</td><td className="px-4 py-2 text-right">{money(invoice.subtotal)}</td></tr>
                {Number(invoice.discount) > 0 && <tr><td colSpan={3} className="px-4 py-2 text-right text-sm">Discount</td><td className="px-4 py-2 text-right text-green-700 dark:text-green-300">-{money(invoice.discount)}</td></tr>}
                {Number(invoice.taxAmount) > 0 && <tr><td colSpan={3} className="px-4 py-2 text-right text-sm">Tax ({Number(invoice.taxRate)}%)</td><td className="px-4 py-2 text-right">{money(invoice.taxAmount)}</td></tr>}
                <tr className="font-bold"><td colSpan={3} className="px-4 py-2 text-right">Total</td><td className="px-4 py-2 text-right">{money(invoice.total)}</td></tr>
                {Number(invoice.amountPaid) > 0 && <tr><td colSpan={3} className="px-4 py-2 text-right text-sm">Paid</td><td className="px-4 py-2 text-right text-green-700 dark:text-green-300">-{money(invoice.amountPaid)}</td></tr>}
                {Number(invoice.amountRefunded || 0) > 0 && <tr><td colSpan={3} className="px-4 py-2 text-right text-sm">Refunded</td><td className="px-4 py-2 text-right text-amber-700 dark:text-amber-300">{money(invoice.amountRefunded)}</td></tr>}
                <tr className="font-bold text-base"><td colSpan={3} className="px-4 py-3 text-right">Balance Due</td><td className={`px-4 py-3 text-right ${balance > 0 ? 'text-red-600 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>{money(balance)}</td></tr>
              </tfoot>
            </table>
          </div>

          {(invoice.payments || []).length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-slate-800"><h2 className="font-semibold text-gray-900 dark:text-white">Payments</h2></div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/60"><tr>
                  <th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-slate-400">Date</th><th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-slate-400">Method</th><th className="px-4 py-2 text-left text-xs text-gray-500 dark:text-slate-400">Reference</th>{cfg.tips && <th className="px-4 py-2 text-right text-xs text-gray-500 dark:text-slate-400">Tip</th>}<th className="px-4 py-2 text-right text-xs text-gray-500 dark:text-slate-400">Amount</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800 text-gray-900 dark:text-slate-100">
                  {invoice.payments.map((p: any, i: number) => (
                    <tr key={i}>
                      <td className="px-4 py-2">{dateTime(p.paidAt)}</td><td className="px-4 py-2 capitalize">{String(p.method || '').replace('_', ' ')}</td><td className="px-4 py-2">{p.reference || p.notes || '-'}</td>
                      {cfg.tips && <td className="px-4 py-2 text-right">{Number(p.tipAmount) > 0 ? money(p.tipAmount) : '-'}</td>}
                      <td className={`px-4 py-2 text-right font-medium ${Number(p.amount) < 0 ? 'text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}`}>{Number(p.amount) < 0 ? `${money(Math.abs(Number(p.amount)))} refund` : money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {invoice.notes && <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6"><h2 className="font-semibold mb-2 text-gray-900 dark:text-white">Notes</h2><p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-slate-300">{invoice.notes}</p></div>}
        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 text-sm text-gray-900 dark:text-slate-100">
            <h2 className="font-semibold mb-4">Details</h2>
            <div className="space-y-3">
              {invoice.contact && <div><p className="text-gray-500 dark:text-slate-400">{cfg.clientLabel}</p><NavLink to={cfg.clientPath(invoice.contact.id)} className="text-orange-600 dark:text-orange-300 hover:underline">{invoice.contact.name}</NavLink></div>}
              {cfg.projects && invoice.project && <div><p className="text-gray-500 dark:text-slate-400">Project</p><NavLink to={`/crm/projects/${invoice.project.id}`} className="text-orange-600 dark:text-orange-300 hover:underline">{invoice.project.name}</NavLink></div>}
              {invoice.quote && <div><p className="text-gray-500 dark:text-slate-400">From quote</p><NavLink to={`/crm/quotes/${invoice.quote.id}`} className="text-orange-600 dark:text-orange-300 hover:underline">{invoice.quote.number}</NavLink></div>}
              <div><p className="text-gray-500 dark:text-slate-400">Due Date</p><p className={overdue ? 'text-red-600 dark:text-red-300 font-medium' : ''}>{invoice.dueDate ? dateOnly(invoice.dueDate) : 'Upon receipt'}{overdue ? ' · overdue' : ''}</p></div>
              {invoice.sentAt && <div><p className="text-gray-500 dark:text-slate-400">Sent</p><p>{dateTime(invoice.sentAt)}</p></div>}
              {invoice.paidAt && <div><p className="text-gray-500 dark:text-slate-400">Paid</p><p>{dateTime(invoice.paidAt)}</p></div>}
              <div><p className="text-gray-500 dark:text-slate-400">Created</p><p>{dateTime(invoice.createdAt)}</p></div>
              {cfg.quickbooks && <div><p className="text-gray-500 dark:text-slate-400">QuickBooks</p><p>{invoice.syncedAt ? `Synced ${dateTime(invoice.syncedAt)}` : 'Not synced'}</p></div>}
            </div>
          </div>
          <div className={`rounded-xl p-6 text-center ${bigTone}`}>
            <p className="text-3xl font-bold">{money(bigAmount)}</p>
            <p className="text-sm opacity-80">{bigLabel}</p>
          </div>
        </div>
      </div>

      <Modal isOpen={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record Payment" size="sm">
        <div className="space-y-4">
          <Field label="Amount *" hint={`${money(balance)} remaining`}><input type="number" step="0.01" min="0.01" value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} className={inputCls} /></Field>
          {cfg.tips && <Field label="Tip (optional)" hint="Gratuity for the stylist. Recorded with the payment, never counted toward the invoice."><input type="number" step="0.01" min="0" value={payment.tipAmount} onChange={e => setPayment({ ...payment, tipAmount: e.target.value })} className={inputCls} placeholder="0.00" /></Field>}
          <Field label="Method"><select value={payment.method} onChange={e => setPayment({ ...payment, method: e.target.value })} className={inputCls}>{PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
          <Field label="Reference"><input value={payment.reference} onChange={e => setPayment({ ...payment, reference: e.target.value })} className={inputCls} placeholder="Check #, transaction ID…" /></Field>
          <Field label="Notes"><textarea value={payment.notes} onChange={e => setPayment({ ...payment, notes: e.target.value })} rows={2} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button variant="success" onClick={handlePayment} disabled={busy}>{busy ? 'Recording…' : 'Record Payment'}</Button></div>
      </Modal>

      <Modal isOpen={refundOpen} onClose={() => setRefundOpen(false)} title="Record Refund" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-slate-400">The sale stays paid; the refund is recorded on its own line and never reopens a balance. Card refunds are issued in your payment processor.</p>
          <Field label="Amount *" hint={`${money(netPaid)} refundable`}><input type="number" step="0.01" min="0.01" value={refund.amount} onChange={e => setRefund({ ...refund, amount: e.target.value })} className={inputCls} /></Field>
          <Field label="Method" hint="Leave as-is to refund the way the money came in."><select value={refund.method} onChange={e => setRefund({ ...refund, method: e.target.value })} className={inputCls}><option value="">Same as payment</option>{PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
          <Field label="Reference"><input value={refund.reference} onChange={e => setRefund({ ...refund, reference: e.target.value })} className={inputCls} /></Field>
          <Field label="Reason"><input value={refund.notes} onChange={e => setRefund({ ...refund, notes: e.target.value })} className={inputCls} placeholder="Why the money went back" /></Field>
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setRefundOpen(false)}>Cancel</Button><Button variant="warn" onClick={handleRefund} disabled={busy}>{busy ? 'Recording…' : 'Record Refund'}</Button></div>
      </Modal>

      <ConfirmModal isOpen={voidOpen} onClose={() => setVoidOpen(false)} onConfirm={handleVoid} title="Void invoice" message={`Void ${invoice.number}? It stays on record but no longer counts as owed.`} confirmText="Void" />
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete invoice" message={`Delete ${invoice.number}? This cannot be undone.`} confirmText="Delete" />
    </div>
  )
}
