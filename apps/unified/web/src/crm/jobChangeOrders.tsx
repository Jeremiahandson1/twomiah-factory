// A job's change orders, beside the job (parity tier 2 #4, 11/10 — ServiceTitan's change orders on a service call; feature
// job_change_orders, not ready). Raised by the office (change-orders:create), sent to the customer to sign in their portal
// (change-orders:update — the same /submit a project's uses, which emails them the link), or approved here when they agreed in
// person. An approved one is billed as its own line on the job's invoice, once (tenant-backend jobs.ts POST /:id/invoice) — the
// row then says which invoice. Nothing is asked of the server unless the switch is on.
import { useCallback, useEffect, useState } from 'react'
import { FilePlus2, Loader2 } from 'lucide-react'
import { api } from '../api'
import { useAuth, useToast, usePermissions } from '../shared'

interface CO { id: string; number: string; title: string; description?: string | null; amount: string; status: string; invoiceId?: string | null }

const card = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900'
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800'
const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const STATUS: Record<string, string> = { draft: 'Draft', submitted: 'Sent to the customer', pending: 'Sent to the customer', approved: 'Approved', rejected: 'Declined' }
const said = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export function JobChangeOrdersPanel({ job }: { job: Record<string, any> }) {
  const { hasFeature } = useAuth()
  const { can, known } = usePermissions()
  const toast = useToast()
  const on = hasFeature('job_change_orders') && (!known || can('change-orders:read'))
  const mayCreate = !known || can('change-orders:create')
  const mayUpdate = !known || can('change-orders:update')
  const [rows, setRows] = useState<CO[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    api.get('/api/change-orders', { jobId: job.id, limit: 100 }).then((r: any) => setRows(Array.isArray(r?.data) ? r.data : [])).catch(() => setRows([]))
  }, [job.id])
  useEffect(() => { if (on && job?.id) load() }, [on, job?.id, load])
  if (!on) return null

  const add = async () => {
    const value = Number(amount)
    if (!title.trim() || !Number.isFinite(value) || value === 0) { toast.error('Give it a title and an amount (a minus sign for a credit).'); return }
    setBusy('new')
    try {
      await api.post('/api/change-orders', { jobId: job.id, title: title.trim(), description: description.trim() || undefined, amount: Math.round(value * 100) / 100 })
      toast.success('Change order added'); setTitle(''); setDescription(''); setAmount(''); setAdding(false); load()
    } catch (e) { toast.error(said(e, 'The change order could not be added')) } finally { setBusy('') }
  }
  const act = async (co: CO, step: 'submit' | 'approve' | 'reject') => {
    setBusy(co.id)
    try {
      const r: any = await api.post(`/api/change-orders/${co.id}/${step}`, {})
      toast.success(step === 'submit' ? (r?.told === 'email' ? `${co.number} sent — the customer was emailed a link to sign it` : `${co.number} marked sent — their portal is off or has no email, so tell them another way`) : step === 'approve' ? `${co.number} approved — it goes on the job's invoice` : `${co.number} declined`)
      load()
    } catch (e) { toast.error(said(e, 'That could not be done')) } finally { setBusy('') }
  }

  return (
    <section className={card} aria-label="Change orders on this job">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Change orders</h2>
        {mayCreate && !adding && <button type="button" className={ghost} onClick={() => setAdding(true)}><FilePlus2 className="h-4 w-4" aria-hidden />New change order</button>}
      </div>
      {adding && (
        <div className="mb-3 grid gap-2">
          <input className={input} aria-label="What changed" placeholder="What changed, e.g. Add a humidifier" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={input} aria-label="Details" placeholder="Details for the customer (optional)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          <input className={input} aria-label="Amount" inputMode="decimal" placeholder="Amount, e.g. 450 (a credit: -100)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="flex gap-2"><button type="button" className={ghost} onClick={() => setAdding(false)}>Cancel</button><button type="button" className={ghost} disabled={busy === 'new'} onClick={() => void add()}>{busy === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Add</button></div>
        </div>
      )}
      {rows === null ? <p className="text-sm text-gray-600 dark:text-slate-400">Loading…</p>
        : !rows.length ? <p className="text-sm text-gray-600 dark:text-slate-400">No change orders. Add one when the work or its price changes; the customer signs it, and it is billed on this job's invoice.</p>
        : <ul className="grid gap-2 text-sm text-gray-900 dark:text-slate-100">
            {rows.map((co) => (
              <li key={co.id} className="flex flex-wrap items-center justify-between gap-2">
                <span><strong>{co.number}</strong> {co.title} · {money(co.amount)} <span className="text-gray-600 dark:text-slate-400">· {co.invoiceId ? 'Billed on the invoice' : STATUS[co.status] ?? co.status}</span></span>
                {mayUpdate && !co.invoiceId && (
                  <span className="flex gap-2">
                    {co.status === 'draft' && <button type="button" className={ghost} disabled={busy === co.id} onClick={() => void act(co, 'submit')}>Send to the customer</button>}
                    {(co.status === 'submitted' || co.status === 'pending') && <button type="button" className={ghost} disabled={busy === co.id} onClick={() => void act(co, 'approve')}>They agreed</button>}
                    {(co.status === 'submitted' || co.status === 'pending') && <button type="button" className={ghost} disabled={busy === co.id} onClick={() => void act(co, 'reject')}>They declined</button>}
                  </span>
                )}
              </li>
            ))}
          </ul>}
    </section>
  )
}
