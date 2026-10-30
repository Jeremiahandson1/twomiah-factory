// Bill the route's completed visits: pick the service days, preview what would be billed (and what is left out, and why),
// make one DRAFT invoice per customer, and undo the whole run while its invoices are still drafts. The pros' way — Yardbook's
// auto-generate for a date range, Jobber's batch create. Gated both sides: preview asks invoices:read, making the drafts
// invoices:create, undo invoices:delete (the server asks the same).
import { useEffect, useState } from 'react'
import { FileText, Loader2, Undo2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useConfirm, useMayWrite } from '../../../shared'
import { money } from '@twomiah/tenant-ui/src/money'

interface PreviewVisit { jobId: string; title: string; scheduledDate: string; siteName: string | null; amount: number }
interface PreviewCustomer { contactId: string; name: string; subtotal: number; visits: PreviewVisit[] }
interface Preview {
  customers: PreviewCustomer[]
  totals: { invoices: number; visits: number; subtotal: number }
  skipped: { alreadyBilled: number; noRoute: number; notMonthly: number; noCustomer: number; noPrice: number }
  leftOutRoutes: Array<{ routeId: string; name: string; mode: string; visits: number }>
}
interface Batch { id: string; fromDate: string; toDate: string; groupBy: string; invoiceCount: number; visitCount: number; invoicesLeft: number; draftsLeft: number; undoneAt: string | null }

const MODE_WORDS: Record<string, string> = { per_visit: 'billed per visit', monthly: 'billed monthly', elsewhere: 'billed elsewhere' }
const serverMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Last month, first to last day: what a monthly run bills by default. */
const lastMonth = () => {
  const now = new Date()
  return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) }
}
const dayWords = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

export default function RouteBillingPanel() {
  const toast = useToast()
  const confirm = useConfirm()
  const maySee = useMayWrite('invoices:read')
  const mayBill = useMayWrite('invoices:create')
  const mayUndo = useMayWrite('invoices:delete')
  const [range, setRange] = useState(lastMonth)
  const [byProperty, setByProperty] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [busy, setBusy] = useState(false)

  const loadBatches = async () => {
    try { const res = await api.get('/api/recurring-routes/billing/batches') as { data?: Batch[] }; setBatches(Array.isArray(res?.data) ? res.data : []) }
    catch { setBatches([]) }
  }
  useEffect(() => { if (maySee) loadBatches() }, [maySee])
  if (!maySee) return null

  const params = { from: range.from, to: range.to, groupBy: byProperty ? 'property' : 'none' }

  const runPreview = async () => {
    setBusy(true)
    try { setPreview(await api.get('/api/recurring-routes/billing/preview', params) as Preview) }
    catch (error) { toast.error(serverMessage(error, 'Could not preview the bills')); setPreview(null) }
    finally { setBusy(false) }
  }

  const makeDrafts = async () => {
    setBusy(true)
    try {
      const res = await api.post('/api/recurring-routes/billing/batches', params) as { message?: string }
      toast.success(res?.message || 'Draft invoices made')
      setPreview(null); await loadBatches()
    } catch (error) { toast.error(serverMessage(error, 'Could not make the invoices')) }
    finally { setBusy(false) }
  }

  const undo = async (b: Batch) => {
    if (!(await confirm('Draft invoices from this run that nobody has sent are deleted, and their visits can be billed again. Anything already sent or paid stays.', { title: 'Undo this billing run?', confirmText: 'Undo run' }))) return
    try {
      const res = await api.post(`/api/recurring-routes/billing/batches/${b.id}/undo`) as { message?: string }
      toast.success(res?.message || 'Run undone'); await loadBatches()
    } catch (error) { toast.error(serverMessage(error, 'Could not undo the run')) }
  }

  const s = preview?.skipped
  const leftOut = s ? [
    s.alreadyBilled ? `${s.alreadyBilled} already billed` : '',
    s.notMonthly ? `${s.notMonthly} on routes not billed monthly${preview!.leftOutRoutes.length ? ` (${preview!.leftOutRoutes.map((r) => `${r.name}: ${MODE_WORDS[r.mode] || r.mode}`).join('; ')})` : ''}` : '',
    s.noPrice ? `${s.noPrice} with no price on the stop` : '',
    s.noCustomer ? `${s.noCustomer} with no customer` : '',
    s.noRoute ? `${s.noRoute} whose stop was removed from its route (bill those one at a time)` : '',
  ].filter(Boolean) : []

  return (
    <div className="bg-white border dark:border-slate-700 rounded-lg p-5 mt-6 dark:bg-slate-900">
      <h2 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> Bill completed visits</h2>
      <p className="text-xs text-gray-500 mb-3 dark:text-slate-400">One draft invoice per customer for the visits finished in these days. Look first, make the drafts, review them on Invoices, then send.</p>

      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-xs text-gray-600 dark:text-slate-400">From
          <input className="input mt-1" aria-label="Bill visits from" type="date" value={range.from} onChange={(e) => { setRange({ ...range, from: e.target.value }); setPreview(null) }} />
        </label>
        <label className="text-xs text-gray-600 dark:text-slate-400">To
          <input className="input mt-1" aria-label="Bill visits to" type="date" value={range.to} onChange={(e) => { setRange({ ...range, to: e.target.value }); setPreview(null) }} />
        </label>
        <label className="text-sm flex items-center gap-2 pb-2"><input type="checkbox" checked={byProperty} onChange={(e) => { setByProperty(e.target.checked); setPreview(null) }} /> Group lines by property</label>
        <button onClick={runPreview} disabled={busy} className="btn-secondary flex items-center gap-2 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Preview</button>
      </div>

      {preview && (
        <div className="mt-4">
          {preview.customers.length === 0
            ? <p className="text-sm text-gray-600 dark:text-slate-300">Nothing to bill in those days.</p>
            : (
              <>
                <p className="text-sm font-medium">{preview.totals.invoices} {preview.totals.invoices === 1 ? 'invoice' : 'invoices'} · {preview.totals.visits} {preview.totals.visits === 1 ? 'visit' : 'visits'} · {money(preview.totals.subtotal)} before tax</p>
                <div className="mt-2 space-y-3">
                  {preview.customers.map((c) => (
                    <div key={c.contactId} className="border dark:border-slate-700 rounded p-3">
                      <div className="flex justify-between text-sm font-medium"><span>{c.name}</span><span>{money(c.subtotal)}</span></div>
                      <div className="mt-1 space-y-0.5">
                        {c.visits.map((v) => (
                          <div key={v.jobId} className="flex justify-between text-xs text-gray-600 dark:text-slate-300">
                            <span>{byProperty ? `${v.siteName || 'Property'} · ` : ''}{v.title} · {dayWords(v.scheduledDate)}</span><span>{money(v.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {mayBill && <button onClick={makeDrafts} disabled={busy} className="btn-primary mt-3 disabled:opacity-50">Make {preview.totals.invoices} draft {preview.totals.invoices === 1 ? 'invoice' : 'invoices'}</button>}
              </>
            )}
          {leftOut.length > 0 && <p className="text-xs text-gray-500 mt-3 dark:text-slate-400">Left out: {leftOut.join(' · ')}.</p>}
        </div>
      )}

      {batches.length > 0 && (
        <div className="mt-5 border-t dark:border-slate-700 pt-3">
          <h3 className="text-sm font-medium mb-1">Recent runs</h3>
          {batches.map((b) => (
            <div key={b.id} className="flex justify-between items-center text-sm border-b dark:border-slate-700 py-1.5">
              <span>{dayWords(b.fromDate)} – {dayWords(b.toDate)} · {b.invoiceCount} {b.invoiceCount === 1 ? 'invoice' : 'invoices'}, {b.visitCount} {b.visitCount === 1 ? 'visit' : 'visits'}
                <span className="text-xs text-gray-500 ml-2 dark:text-slate-400">{b.undoneAt ? 'undone' : `${b.draftsLeft} still draft`}</span></span>
              {mayUndo && !b.undoneAt && b.draftsLeft > 0 && <button onClick={() => undo(b)} className="text-red-600 flex items-center gap-1 text-xs dark:text-red-400"><Undo2 className="w-3 h-3" /> Undo run</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
