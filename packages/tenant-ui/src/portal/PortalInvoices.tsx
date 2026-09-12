// Portal invoices: list (unpaid first) + detail with PDF download, payment history and card payment.
import React, { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Receipt, Download, AlertCircle, CheckCircle, Clock, CreditCard } from 'lucide-react'
import { usePortal } from './PortalContext'
import { PortalPaymentModal } from './PaymentForm'
import { PLink, Spinner, PageTitle, Empty, Section, card, pill, btnSecondary, formatDate, moneyShort } from './common'

const STATUS_STYLES: Record<string, string> = { sent: 'bg-blue-100 text-blue-700', open: 'bg-blue-100 text-blue-700', viewed: 'bg-blue-100 text-blue-700', partial: 'bg-yellow-100 text-yellow-700', paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700' }
const UNPAID = ['sent', 'open', 'viewed', 'partial', 'overdue']

export interface PortalInvoiceData {
  id: string; number: string; status: string; total: string | number; balance: string | number; subtotal?: string | number
  taxAmount?: string | number; taxRate?: string | number; discount?: string | number; amountPaid?: string | number; amountRefunded?: string | number
  dueDate?: string | null; notes?: string | null
  lineItems?: Array<{ description: string; quantity: string | number; unitPrice: string | number; total: string | number }>
  payments?: Array<{ id?: string; paidAt: string; method: string; amount: string | number }>
  project?: { name: string } | null
  company?: { email?: string | null; phone?: string | null } | null
  [key: string]: unknown
}

const isOverdue = (inv: PortalInvoiceData) => inv.status === 'overdue' || (UNPAID.includes(inv.status) && !!inv.dueDate && new Date(inv.dueDate) < new Date())

export function PortalInvoices() {
  const { token, fetch: portalFetch } = usePortal()
  const [invoices, setInvoices] = useState<PortalInvoiceData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    portalFetch('/invoices').then((d) => setInvoices(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false))
  }, [portalFetch])

  if (loading) return <Spinner />
  const unpaid = invoices.filter((i) => UNPAID.includes(i.status) && Number(i.balance) > 0)
  const paid = invoices.filter((i) => !unpaid.includes(i))
  const totalOutstanding = unpaid.reduce((sum, i) => sum + Number(i.balance), 0)

  return (
    <div>
      <PageTitle title="Invoices" subtitle="View, download and pay your invoices." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {totalOutstanding > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 dark:bg-orange-950/20 dark:border-orange-900">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3"><AlertCircle className="w-6 h-6 text-orange-500" /><div><p className="font-medium text-gray-900 dark:text-slate-100">Outstanding Balance</p><p className="text-sm text-gray-600 dark:text-slate-400">{unpaid.length} unpaid invoice(s)</p></div></div>
            <p className="text-2xl font-bold text-orange-600">{moneyShort(totalOutstanding)}</p>
          </div>
        </div>
      )}
      {invoices.length === 0 ? <Empty icon={Receipt} text="No invoices yet." /> : (
        <div className="space-y-6">
          {unpaid.length > 0 && <Section title={<><Clock className="w-5 h-5 text-orange-500" /> Unpaid ({unpaid.length})</>}>{unpaid.map((inv) => <InvoiceCard key={inv.id} invoice={inv} token={token} />)}</Section>}
          {paid.length > 0 && <Section title={<><CheckCircle className="w-5 h-5 text-green-500" /> Paid ({paid.length})</>}>{paid.map((inv) => <InvoiceCard key={inv.id} invoice={inv} token={token} />)}</Section>}
        </div>
      )}
    </div>
  )
}

function InvoiceCard({ invoice, token }: { invoice: PortalInvoiceData; token?: string }) {
  const overdue = isOverdue(invoice)
  return (
    <PLink to={`/portal/${token}/invoices/${invoice.id}`} className={`block bg-white rounded-xl border p-4 hover:shadow-md transition-all dark:bg-slate-900 ${overdue ? 'border-red-200 dark:border-red-900' : 'border-gray-200 dark:border-slate-700'}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-lg shrink-0 ${overdue ? 'bg-red-100' : 'bg-green-100'}`}><Receipt className={`w-5 h-5 ${overdue ? 'text-red-600' : 'text-green-600'}`} /></div>
          <div className="min-w-0"><p className="font-medium text-gray-900 dark:text-slate-100">{invoice.number}</p><p className="text-sm text-gray-500 dark:text-slate-400">{invoice.dueDate ? `Due ${formatDate(invoice.dueDate)}` : 'No due date'}</p></div>
        </div>
        <div className="text-right shrink-0">
          {Number(invoice.balance) > 0 ? <><p className="text-lg font-bold text-gray-900 dark:text-slate-100">{moneyShort(invoice.balance)}</p><p className="text-xs text-gray-500 dark:text-slate-400">of {moneyShort(invoice.total)}</p></> : <p className="text-lg font-bold text-green-600">Paid</p>}
          <span className={`${pill(STATUS_STYLES[invoice.status] || 'bg-gray-100 text-gray-700')} mt-1`}>{invoice.status}</span>
        </div>
      </div>
    </PLink>
  )
}

export function PortalInvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>()
  const { token, fetch: portalFetch, url, company } = usePortal()
  const [invoice, setInvoice] = useState<PortalInvoiceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showPayment, setShowPayment] = useState(false)

  const load = useCallback(() => portalFetch(`/invoices/${invoiceId}`).then(setInvoice).catch((e) => setError((e as Error).message)), [portalFetch, invoiceId])
  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  if (loading) return <Spinner />
  if (!invoice) return <div className="text-center py-12 text-gray-500 dark:text-slate-400">{error || 'Invoice not found.'}</div>
  const overdue = isOverdue(invoice)
  const hasBalance = Number(invoice.balance) > 0 && UNPAID.includes(invoice.status)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <PLink to={`/portal/${token}/invoices`} className="text-orange-600 hover:underline text-sm">{'<-'} Back to Invoices</PLink>
        <a href={url(`/invoices/${invoiceId}/pdf`)} target="_blank" rel="noreferrer" className={btnSecondary}><Download className="w-4 h-4" /> Download PDF</a>
      </div>
      <div className={`${card} overflow-hidden`}>
        <div className="p-6 border-b dark:border-slate-700">
          <div className="flex items-start justify-between gap-4">
            <div><h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Invoice {invoice.number}</h1>{invoice.project && <p className="text-gray-500 dark:text-slate-400">Project: {invoice.project.name}</p>}</div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[invoice.status] || 'bg-gray-100 text-gray-700'}`}>{invoice.status}</span>
          </div>
          {invoice.dueDate && <p className={`mt-2 ${overdue ? 'text-red-600 font-medium' : 'text-gray-500 dark:text-slate-400'}`}>{overdue ? 'OVERDUE - ' : ''}Due {formatDate(invoice.dueDate)}</p>}
        </div>
        <div className="p-6 border-b overflow-x-auto dark:border-slate-700">
          <table className="w-full">
            <thead><tr className="text-left text-sm text-gray-500 border-b dark:text-slate-400 dark:border-slate-700"><th className="pb-2">Description</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Price</th><th className="pb-2 text-right">Total</th></tr></thead>
            <tbody>{invoice.lineItems?.map((item, i) => <tr key={i} className="border-b last:border-0 dark:border-slate-800"><td className="py-3 text-gray-900 dark:text-slate-100">{item.description}</td><td className="py-3 text-right text-gray-900 dark:text-slate-100">{item.quantity}</td><td className="py-3 text-right text-gray-900 dark:text-slate-100">{moneyShort(item.unitPrice)}</td><td className="py-3 text-right font-medium text-gray-900 dark:text-slate-100">{moneyShort(item.total)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="p-6 bg-gray-50 border-b dark:bg-slate-800/60 dark:border-slate-700">
          <div className="max-w-xs ml-auto space-y-2 text-gray-900 dark:text-slate-100">
            <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Subtotal</span><span>{moneyShort(invoice.subtotal)}</span></div>
            {Number(invoice.taxAmount || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Tax ({invoice.taxRate}%)</span><span>{moneyShort(invoice.taxAmount)}</span></div>}
            {Number(invoice.discount || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Discount</span><span>-{moneyShort(invoice.discount)}</span></div>}
            <div className="flex justify-between font-medium border-t pt-2 dark:border-slate-700"><span>Total</span><span>{moneyShort(invoice.total)}</span></div>
            {Number(invoice.amountPaid || 0) > 0 && <div className="flex justify-between text-sm text-green-600"><span>Paid</span><span>-{moneyShort(invoice.amountPaid)}</span></div>}
            {Number(invoice.amountRefunded || 0) > 0 && <div className="flex justify-between text-sm text-amber-700"><span>Refunded</span><span>{moneyShort(invoice.amountRefunded)}</span></div>}
            <div className="flex justify-between text-lg font-bold border-t pt-2 dark:border-slate-700"><span>Balance Due</span><span className={Number(invoice.balance) > 0 ? 'text-orange-600' : 'text-green-600'}>{moneyShort(invoice.balance)}</span></div>
          </div>
        </div>
        {hasBalance && (
          <div className="p-6 bg-orange-50 border-t dark:bg-orange-950/20 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><p className="font-medium text-gray-900 dark:text-slate-100">Ready to pay?</p><p className="text-sm text-gray-600 dark:text-slate-400">Secure payment by card</p></div>
              <button onClick={() => setShowPayment(true)} className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"><CreditCard className="w-5 h-5" /> Pay {moneyShort(invoice.balance)}</button>
            </div>
          </div>
        )}
        {(invoice.payments?.length ?? 0) > 0 && (
          <div className="p-6 border-t dark:border-slate-700">
            <h3 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">Payment History</h3>
            <div className="space-y-2">{invoice.payments!.map((p, i) => <div key={p.id || i} className="flex justify-between text-sm py-2 border-b last:border-0 dark:border-slate-800"><div><span className="text-gray-900 dark:text-slate-100">{formatDate(p.paidAt)}</span><span className="text-gray-500 ml-2 dark:text-slate-400">via {p.method}</span></div><span className="font-medium text-green-600">{moneyShort(p.amount)}</span></div>)}</div>
          </div>
        )}
        <div className="p-6 bg-gray-100 border-t dark:bg-slate-800 dark:border-slate-700"><p className="text-sm text-gray-600 dark:text-slate-400">Questions about this invoice? Contact {invoice.company?.email || invoice.company?.phone}</p></div>
      </div>
      {token && <PortalPaymentModal isOpen={showPayment} onClose={() => setShowPayment(false)} invoiceId={invoice.id} amount={Number(invoice.balance)} portalToken={token} primaryColor={company?.primaryColor || undefined} onSuccess={() => { setShowPayment(false); load() }} />}
    </div>
  )
}
