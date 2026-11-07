// Beside an invoice (roofing parity row 17; JobNimbus "text payment request", Leap scheduled requests; invoice_text_requests, not
// ready): Text this invoice — its pay link to the homeowner now or at a time on the business's clock, and again every few days until
// it is paid — and the texts it has had. Server: crm/roof/invoiceRequests.ts. Unsent ones are cancelled once it is paid.
import { useCallback, useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { api } from '../../../api'
import { useAuth, useMayWrite, useToast } from '../../../shared'
import { companyFromLocalInput, whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'

interface Req { id: string; sendAt: string; status: string; sentAt: string | null; error: string | null }
const STATUS: Record<string, string> = { scheduled: 'waiting', sending: 'sending', sent: 'sent', failed: 'not sent', cancelled: 'cancelled' }
const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
const OPEN = ['sent', 'viewed', 'partial', 'overdue']

export function InvoiceTextPanel({ invoiceId, status }: { invoiceId: string; status: string }) {
  const toast = useToast()
  const on = useAuth().hasFeature('invoice_text_requests')
  const mayUpdate = useMayWrite('invoices:update')
  const mayTextSms = useMayWrite('sms:send')
  const mayText = mayUpdate && mayTextSms
  const [rows, setRows] = useState<Req[] | null>(null)
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState('')
  const [repeat, setRepeat] = useState(false)
  const [every, setEvery] = useState('3')
  const [times, setTimes] = useState('3')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const r: any = await api.get(`/api/invoice-requests/${invoiceId}`); setRows(Array.isArray(r?.data) ? r.data : []) } catch { setRows(null) }
  }, [invoiceId])
  useEffect(() => { if (on) load() }, [on, load])
  if (!on || rows === null) return null
  const open = OPEN.includes(status)
  const send = async () => {
    if (when === 'later' && !at) { toast.error('Pick when to send it.'); return }
    setBusy(true)
    try {
      const body: Record<string, unknown> = {}
      if (when === 'later') body.at = companyFromLocalInput(at).toISOString()
      if (repeat) { body.everyDays = Number(every); body.times = Number(times) }
      const out: any = await api.post(`/api/invoice-requests/${invoiceId}`, body)
      const n = out?.texts?.length ?? 1
      toast.success(n > 1 ? `${n} texts set — they stop once the invoice is paid` : 'Text set to go out (texts go 8 am – 8 pm)')
      await load()
    } catch (e) { toast.error(errorText(e, 'Could not text the invoice')) }
    finally { setBusy(false) }
  }
  const cancel = async (id: string) => {
    try { await api.delete(`/api/invoice-requests/texts/${id}`); toast.success('Text cancelled'); await load() }
    catch (e) { toast.error(errorText(e, 'Could not cancel it')) }
  }
  if (!open && !rows.length) return null
  return (
    <section aria-label="Text this invoice" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid="invoice-text-panel">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100"><MessageSquare className="h-4 w-4 text-orange-600 dark:text-orange-300" aria-hidden="true" />Text this invoice</h2>
      {open && mayText && (
        <div className="mt-2 space-y-2 text-sm text-gray-800 dark:text-slate-200">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1"><input type="radio" name={`when-${invoiceId}`} checked={when === 'now'} onChange={() => setWhen('now')} /> Now</label>
            <label className="flex items-center gap-1"><input type="radio" name={`when-${invoiceId}`} checked={when === 'later'} onChange={() => setWhen('later')} /> At</label>
            {when === 'later' && <input type="datetime-local" className="input w-auto" aria-label="Send at" value={at} onChange={(e) => setAt(e.target.value)} />}
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Send again until it is paid</label>
          {repeat && (
            <div className="flex flex-wrap items-center gap-2">
              every <input type="number" min={1} max={30} className="input w-16" aria-label="Every how many days" value={every} onChange={(e) => setEvery(e.target.value)} /> days,
              <input type="number" min={1} max={6} className="input w-16" aria-label="How many texts in all" value={times} onChange={(e) => setTimes(e.target.value)} /> texts in all
            </div>
          )}
          <button className="btn-primary" disabled={busy} onClick={send}>{when === 'now' && !repeat ? 'Text it now' : 'Set the texts'}</button>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-gray-700 dark:text-slate-200">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{whenDateTime(r.status === 'sent' && r.sentAt ? r.sentAt : r.sendAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} — {STATUS[r.status] || 'waiting'}{r.status === 'failed' && r.error ? `: ${r.error}` : ''}</span>
              {r.status === 'scheduled' && mayText && <button className="text-xs text-red-700 hover:underline dark:text-red-300" onClick={() => cancel(r.id)}>Cancel</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
