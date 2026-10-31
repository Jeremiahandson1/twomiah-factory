// A job's profit as the roofer's QuickBooks books show it (GET /api/job-books/:jobId, server/crm/roof/jobBooks.ts; roofing parity row 5).
// Read-only: the figures come from QuickBooks' Profit and Loss for the job's customer, beside this app's own for the same job, and the
// difference. The owner/admin (reports:update) can choose which QuickBooks customer the job's books are kept under. QuickBooks being
// off, not connected or refusing is said in words; no figure is drawn then.
import { useCallback, useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useMayWrite, useToast } from '../../../../shared'
import { money } from '@twomiah/tenant-ui/src/invoicing/ui'
import { formatDate } from '../../../date'
import { listOf } from '../field/http'

interface Books {
  state: 'ok' | 'off' | 'not_connected' | 'no_customer' | 'error'
  message?: string
  scope?: 'job' | 'customer'
  otherJobs?: number
  customer?: { id: string; name: string | null }
  from?: string; to?: string
  income?: number; costOfGoods?: number; expenses?: number; otherNet?: number; cost?: number; profit?: number; margin?: number | null
  app?: { revenue: number; cost: number; profit: number } | null
  difference?: number | null
}
interface Found { id: string; name: string }

export default function JobBooks({ jobId }: { jobId: string }) {
  const toast = useToast()
  const mayChoose = useMayWrite('reports:update')
  const [books, setBooks] = useState<Books | null>(null)
  const [failed, setFailed] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setBooks((await api.get(`/api/job-books/${jobId}`)) as Books); setFailed('') } catch (e) { setFailed(errorText(e, 'The books could not be read')) }
  }, [jobId])
  useEffect(() => { load() }, [load])

  const search = async () => {
    setBusy(true)
    try { setFound(listOf<Found>(await api.get('/api/job-books/customers', { q }))) } catch (e) { toast.error(errorText(e, 'QuickBooks could not be searched')); setFound(null) } finally { setBusy(false) }
  }
  const choose = async (id: string | null) => {
    setBusy(true)
    try {
      await api.put(`/api/job-books/${jobId}/customer`, { qbCustomerId: id })
      setChoosing(false); setFound(null); setQ('')
      toast.success(id ? 'QuickBooks customer chosen' : 'Back to the contact’s own QuickBooks customer')
      await load()
    } catch (e) { toast.error(errorText(e, 'The QuickBooks customer could not be chosen')) } finally { setBusy(false) }
  }

  const row = (label: string, value: number | undefined, strong = false) => (
    <div className={`flex justify-between text-sm ${strong ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-700 dark:text-slate-300'}`}><span>{label}</span><span>{money(value ?? 0)}</span></div>
  )
  const b = books
  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900" data-card="job-books">
      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-1 dark:text-slate-100">
        <BookOpen className="w-4 h-4 text-gray-400" /> Profit in QuickBooks
      </h2>
      {failed && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{failed}</p>}
      {!failed && !b && <p className="text-sm text-gray-500 dark:text-slate-400">Reading the books…</p>}
      {b && b.state !== 'ok' && <p className="text-sm text-gray-600 dark:text-slate-300">{b.message}</p>}
      {b && b.state === 'ok' && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 mb-2 dark:text-slate-400">
            {b.customer?.name ?? 'QuickBooks customer'} · {b.from ? formatDate(b.from) : ''} to {b.to ? formatDate(b.to) : ''}
          </p>
          {b.scope === 'customer' && (b.otherJobs ?? 0) > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1 mb-2 dark:bg-amber-900/30 dark:text-amber-200" role="note">
              These are the customer’s books: {b.otherJobs} other job{b.otherJobs === 1 ? '' : 's'} for this contact share them. Choose this job’s own QuickBooks customer for its figures alone.
            </p>
          )}
          {row('Income', b.income)}
          {row('Cost of goods', b.costOfGoods)}
          {row('Expenses', b.expenses)}
          {(b.otherNet ?? 0) !== 0 && row('Other income and expense', b.otherNet)}
          {row(`Profit${b.margin != null ? ` (${b.margin}%)` : ''}`, b.profit, true)}
          {b.app && (
            <div className="mt-3 pt-3 border-t text-sm text-gray-600 dark:text-slate-400 dark:border-slate-700">
              <div className="flex justify-between"><span>Profit in this app, before commissions</span><span>{money(b.app.profit)}</span></div>
              <div className="flex justify-between"><span>The books show</span><span>{money(b.difference ?? 0)} {(b.difference ?? 0) < 0 ? 'less' : (b.difference ?? 0) > 0 ? 'more' : '(the same)'}</span></div>
            </div>
          )}
        </div>
      )}
      {mayChoose && b && (b.state === 'ok' || b.state === 'no_customer' || b.state === 'error') && !choosing && (
        <button type="button" onClick={() => setChoosing(true)} className="mt-3 text-sm text-orange-700 underline dark:text-orange-300">Choose the QuickBooks customer</button>
      )}
      {choosing && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input aria-label="Search QuickBooks customers" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name" className="flex-1 text-sm border rounded-lg px-3 py-2" />
            <button type="button" disabled={busy || q.trim().length < 2} onClick={search} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50">Search</button>
          </div>
          {found && found.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">QuickBooks has no customer by that name.</p>}
          {found?.map((f) => (
            <button key={f.id} type="button" disabled={busy} onClick={() => choose(f.id)} className="block w-full text-left text-sm px-3 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">{f.name}</button>
          ))}
          <div className="flex justify-between">
            <button type="button" onClick={() => choose(null)} disabled={busy} className="text-sm text-gray-600 underline dark:text-slate-300">Use the contact’s own</button>
            <button type="button" onClick={() => { setChoosing(false); setFound(null) }} className="text-sm text-gray-600 underline dark:text-slate-300">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
