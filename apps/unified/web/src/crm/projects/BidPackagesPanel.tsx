// Bid packages on a project (parity tier 3, contractor; server crm/projects/bidPackages.ts, /api/bid-packages; feature
// bid_packages, not ready): a scope of work sent to subs to price in their vendor portal, the bids side by side, and the winner
// turned into a purchase order.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gavel, Plus, Trash2 } from 'lucide-react'
import { money } from '@twomiah/tenant-ui/src/money'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Line { id: string; description: string; quantity: number; unit: string | null }
interface Bid { id: string; vendor: string; status: string; total?: number | null; prices?: Array<{ lineId: string; unitPrice: number }>; notes: string | null; declinedReason: string | null }
interface Pkg { id: string; title: string; scope: string | null; dueDate: string | null; status: string; lines: Line[]; bids: Bid[]; purchaseOrderId: string | null; awardedInviteId: string | null }
interface Sub { id: string; name: string; company?: string | null }

const STATUS: Record<string, string> = { invited: 'Asked', viewed: 'Seen', submitted: 'Bid in', declined: 'Declined', awarded: 'Awarded', lost: 'Not chosen' }
const PKG: Record<string, string> = { draft: 'Not sent yet', open: 'Out for bids', awarded: 'Awarded', closed: 'Closed' }
const input = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const btn = 'rounded-lg bg-orange-700 px-3 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60 dark:hover:bg-orange-600'
const blank = () => ({ title: '', scope: '', dueDate: '', lines: [{ description: '', quantity: '1', unit: '' }], vendorIds: [] as string[] })

export function BidPackagesPanel({ projectId }: { projectId: string }) {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('projects:update')
  const [list, setList] = useState<Pkg[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  const [making, setMaking] = useState(false)
  const [form, setForm] = useState(blank())
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/api/bid-packages', { projectId }).then((r: any) => setList(r?.data || [])).catch(() => setList([]))
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!making || subs.length) return
    Promise.all(['subcontractor', 'vendor'].map((type) => api.get('/api/contacts', { type, limit: 200 }).then((r: any) => r?.data || []).catch(() => [])))
      .then(([a, b]) => setSubs([...a, ...b].map((x: any) => ({ id: x.id, name: x.name, company: x.company }))))
  }, [making]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (what: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await what(); toast.success(ok); await load() } catch (e: any) { toast.error(e?.message || 'That did not work.') } finally { setBusy(false) }
  }
  const create = () => run(async () => {
    await api.post('/api/bid-packages', {
      projectId, title: form.title, scope: form.scope || null, dueDate: form.dueDate || null, vendorIds: form.vendorIds,
      lines: form.lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity) || 1, unit: l.unit.trim() || null })),
    })
    setMaking(false); setForm(blank())
  }, 'Bid package saved — send it when ready')

  return (
    <section className="rounded-lg border bg-white p-4 dark:bg-slate-900 dark:border-slate-700" aria-label="Bid packages">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-100"><Gavel className="h-5 w-5 text-orange-600 dark:text-orange-300" aria-hidden="true" />Bid packages</h2>
        {mayEdit && !making && <button type="button" onClick={() => setMaking(true)} className="text-sm font-medium text-orange-700 hover:underline dark:text-orange-300">New bid package</button>}
      </div>
      {list.length === 0 && !making && <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Send a scope of work to your subs to price in their portal.</p>}

      {making && (
        <div className="mt-3 space-y-2">
          <input aria-label="Package name" className={`${input} w-full`} placeholder="e.g. Framing" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea aria-label="Scope of work" className={`${input} w-full`} rows={3} placeholder="Scope of work" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-200">Bids due <input type="date" className={input} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
          <p className="text-xs font-medium text-gray-700 dark:text-slate-200">Items to price</p>
          {form.lines.map((l, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input aria-label={`Item ${i + 1}`} className={`${input} min-w-[12rem] flex-1`} value={l.description} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
              <input aria-label={`Item ${i + 1} quantity`} className={`${input} w-20`} inputMode="decimal" value={l.quantity} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) })} />
              <input aria-label={`Item ${i + 1} unit`} className={`${input} w-20`} placeholder="unit" value={l.unit} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })} />
              {form.lines.length > 1 && <button type="button" aria-label={`Remove item ${i + 1}`} className="p-1 text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
          <button type="button" className="inline-flex items-center gap-1 text-sm text-orange-700 hover:underline dark:text-orange-300" onClick={() => setForm({ ...form, lines: [...form.lines, { description: '', quantity: '1', unit: '' }] })}><Plus className="h-4 w-4" />Add an item</button>
          <fieldset>
            <legend className="text-xs font-medium text-gray-700 dark:text-slate-200">Invite</legend>
            {subs.length === 0 ? <p className="text-xs text-gray-600 dark:text-slate-300">No subcontractors or vendors in your contacts yet.</p> : (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{subs.map((s) => (
                <label key={s.id} className="text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" checked={form.vendorIds.includes(s.id)} onChange={(e) => setForm({ ...form, vendorIds: e.target.checked ? [...form.vendorIds, s.id] : form.vendorIds.filter((x) => x !== s.id) })} /> {s.company || s.name}</label>
              ))}</div>
            )}
          </fieldset>
          <div className="flex gap-3"><button type="button" className={btn} disabled={busy || !form.title.trim() || !form.vendorIds.length} onClick={create}>Save</button><button type="button" className="text-sm text-gray-700 hover:underline dark:text-slate-300" onClick={() => setMaking(false)}>Cancel</button></div>
        </div>
      )}

      {list.map((p) => {
        const totals = p.bids.filter((b) => b.status === 'submitted' || b.status === 'awarded' || b.status === 'lost')
        return (
          <div key={p.id} className="mt-4 border-t border-gray-200 pt-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-gray-900 dark:text-slate-100">{p.title} <span className="text-xs font-normal text-gray-600 dark:text-slate-400">· {PKG[p.status] || p.status}{p.dueDate ? ` · due ${p.dueDate}` : ''}</span></p>
              {mayEdit && p.status === 'draft' && <button type="button" className={btn} disabled={busy} onClick={() => run(() => api.post(`/api/bid-packages/${p.id}/send`, {}), 'Sent to your subs')}>Send to subs</button>}
              {p.purchaseOrderId && <Link to="/crm/purchase-orders" className="text-sm text-orange-700 underline dark:text-orange-300">Purchase order made</Link>}
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="text-gray-600 dark:text-slate-300"><th className="py-1 pr-3 font-medium">Item</th>{p.bids.map((b) => <th key={b.id} className="py-1 pr-3 font-medium">{b.vendor}<span className="block font-normal">{STATUS[b.status] || b.status}</span></th>)}</tr></thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {p.lines.map((l) => (
                    <tr key={l.id} className="text-gray-900 dark:text-slate-100">
                      <td className="py-1 pr-3">{l.description} <span className="text-gray-600 dark:text-slate-400">× {l.quantity}{l.unit ? ` ${l.unit}` : ''}</span></td>
                      {p.bids.map((b) => { const pr = b.prices?.find((x) => x.lineId === l.id); return <td key={b.id} className="py-1 pr-3">{pr ? money(pr.unitPrice * l.quantity) : '—'}</td> })}
                    </tr>
                  ))}
                  {totals.length > 0 && (
                    <tr className="font-semibold text-gray-900 dark:text-slate-100">
                      <td className="py-1 pr-3">Total</td>
                      {p.bids.map((b) => (
                        <td key={b.id} className="py-1 pr-3">{b.total != null ? money(b.total) : '—'}
                          {mayEdit && p.status === 'open' && b.status === 'submitted' && <button type="button" disabled={busy} className="ml-2 font-medium text-orange-700 hover:underline dark:text-orange-300" onClick={() => run(() => api.post(`/api/bid-packages/${p.id}/award`, { inviteId: b.id }), `Awarded to ${b.vendor} — purchase order drafted`)}>Award</button>}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </section>
  )
}
