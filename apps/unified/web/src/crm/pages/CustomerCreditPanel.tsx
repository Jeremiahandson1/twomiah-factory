// Customer credit on a customer's page (credit memos, parity tier 2; server crm/billing/creditMemos.ts, /api/customer-credit;
// feature credit_memos, not ready). What the business owes this customer, and its history; an owner or admin issues a credit
// with a reason. It is spent from an invoice: Record payment › "Account balance".
import { useEffect, useState } from 'react'
import { Loader2, Wallet } from 'lucide-react'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'
import { money } from '@twomiah/tenant-ui/src/money'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Entry { id: string; amount: number; source: string; reason: string | null; createdAt: string; invoiceNumber: string | null }
const SOURCE: Record<string, string> = { credit_memo: 'Credit issued', spend: 'Used on an invoice', refund_to_account: 'Refund kept as credit', manual: 'Adjusted', payout: 'Paid out' }

export function CustomerCreditPanel({ contactId }: { contactId: string }) {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayIssue = !known || can('payments:delete')
  const [data, setData] = useState<{ credit: number; entries: Entry[] } | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => api.get(`/api/customer-credit/${encodeURIComponent(contactId)}`).then(setData).catch((e: Error) => setError(e.message || 'Customer credit could not be loaded.'))
  useEffect(() => { load() }, [contactId]) // eslint-disable-line react-hooks/exhaustive-deps

  const issue = async () => {
    setSaving(true)
    try {
      await api.post(`/api/customer-credit/${encodeURIComponent(contactId)}`, { amount: Number(amount), reason })
      toast.success('Credit saved')
      setOpen(false); setAmount(''); setReason('')
      await load()
    } catch (e: any) { toast.error(e?.message || 'The credit could not be saved.') } finally { setSaving(false) }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-label="Customer credit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-100"><Wallet className="h-5 w-5 text-orange-600 dark:text-orange-300" aria-hidden="true" />Customer credit</h2>
        {data && <span className="text-lg font-semibold text-gray-900 dark:text-slate-100">{money(data.credit)}</span>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {!data && !error && <Loader2 className="mt-2 h-5 w-5 animate-spin text-gray-500 dark:text-slate-300" />}
      {data && (
        <>
          <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">Money you owe this customer. Use it to pay any of their invoices: Record payment › Account balance. A refund can also be kept here as credit.</p>
          {data.entries.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-200 text-sm dark:divide-slate-700">
              {data.entries.slice(0, 20).map((e) => (
                <li key={e.id} className="flex justify-between gap-3 py-1.5 text-gray-900 dark:text-slate-100">
                  <span>{SOURCE[e.source] || 'Adjusted'}{e.invoiceNumber ? ` · ${e.invoiceNumber}` : ''}{e.reason ? <span className="block text-xs text-gray-600 dark:text-slate-400">{e.reason}</span> : null}</span>
                  <span className="whitespace-nowrap text-right">{e.amount > 0 ? '+' : ''}{money(e.amount)}<span className="block text-xs text-gray-600 dark:text-slate-400">{momentDate(e.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })}</span></span>
                </li>
              ))}
            </ul>
          )}
          {mayIssue && !open && <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300">Issue a credit</button>}
          {mayIssue && open && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <label htmlFor="cc-amount" className="sr-only">Amount</label>
                <input id="cc-amount" type="number" step="0.01" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                <label htmlFor="cc-reason" className="sr-only">Why</label>
                <input id="cc-reason" maxLength={500} placeholder="Why (e.g. late finish, price adjustment)" value={reason} onChange={(e) => setReason(e.target.value)} className="min-w-[14rem] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <p className="text-xs text-gray-600 dark:text-slate-300">A negative amount takes credit off.</p>
              <div className="flex gap-3">
                <button type="button" disabled={saving || !amount || !reason.trim()} onClick={issue} className="rounded-lg bg-orange-700 px-3 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60 dark:hover:bg-orange-600">{saving ? 'Saving…' : 'Save credit'}</button>
                <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-700 hover:underline dark:text-slate-300">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
