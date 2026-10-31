// A roofing job's work orders (GET /api/work-orders?jobId=, the roof_work_orders feature — server/crm/roof/workOrders.ts):
// what the crew or sub was asked to do, whether they have said yes, and a New work order form. Making, changing, sending
// and cancelling ask jobs:dispatch, which is what the server asks; a seat that cannot dispatch reads the list only, and
// never sees the link (the server withholds it). The crew's own page is ./CrewLinkPage (/w/<token>).
import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Copy, Plus, Send, Trash2, X } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useConfirm, useMayWrite, usePermissions, useToast } from '../../../../shared'
import { money } from '@twomiah/tenant-ui/src/invoicing/ui'
import { formatDate } from '../../../date'
import { listOf } from './http'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

interface Line { description: string; qty: number | string; unit: string }
interface WorkOrder {
  id: string; title: string; status: string; scope?: string | null; address?: string | null; startDate?: string | null
  recipientName: string; recipientPhone: string; crewId?: string | null; materialLines: Line[]; photoIds: string[]
  respondedByName?: string | null; rejectReason?: string | null; completedAt?: string | null; completionNote?: string | null
  /** The crew's lump-sum price for the job — only for a seat that reads what the shop pays (margin:read). */
  price?: number | null
  completionPhotoIds: string[]; linkUrl?: string; linkExpired?: boolean; sentAt?: string | null
}
interface CrewRow { id: string; name: string; foremanName?: string | null; foremanPhone?: string | null }
interface OrderRow { id: string; supplier?: string | null; lineItems?: unknown[] }
interface PhotoRow { id: string; url?: string | null; thumbnailUrl?: string | null; caption?: string | null; photoType?: string | null }

const CHIP: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300', sent: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  accepted: 'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300', rejected: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300', cancelled: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400',
}

export default function JobWorkOrders({ jobId, jobAddress }: { jobId: string; jobAddress?: string | null }) {
  const toast = useToast()
  const confirm = useConfirm()
  const mayDispatch = useMayWrite('jobs:dispatch')
  const mayDelete = useMayWrite('jobs:delete')
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [editing, setEditing] = useState<WorkOrder | 'new' | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setOrders(listOf<WorkOrder>(await api.get('/api/work-orders', { jobId }))) } catch { setOrders([]) }
  }, [jobId])
  useEffect(() => { load() }, [load])

  const act = async (id: string, what: 'send' | 'cancel') => {
    setBusy(id + what)
    try {
      const r: any = await api.post(`/api/work-orders/${id}/${what}`, {})
      if (what === 'send') {
        if (r?.texted) toast.success('Texted to the crew')
        else toast.error(r?.notice || 'It could not be texted. Copy the link and send it yourself.')
      } else toast.success('Work order cancelled')
      await load()
    } catch (err) { toast.error(errorText(err, `Could not ${what} the work order`)) } finally { setBusy('') }
  }
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success('Link copied') } catch { toast.error('Could not copy. Select the link and copy it.') }
  }
  const remove = async (o: WorkOrder) => {
    if (!(await confirm(`Remove work order "${o.title}"?`, { title: 'Remove work order', confirmText: 'Remove' }))) return
    try { await api.delete(`/api/work-orders/${encodeURIComponent(o.id)}`); await load() } catch (err) { toast.error(errorText(err, 'Could not remove it')) }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900" data-testid="job-work-orders">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-100"><ClipboardList className="w-4 h-4 text-gray-400" /> Work orders</h2>
        {mayDispatch && (
          <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300"><Plus className="w-4 h-4" /> New work order</button>
        )}
      </div>
      {orders.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No work orders</p> : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="text-sm border-b last:border-0 pb-3 dark:border-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900 dark:text-slate-100">{o.title}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${CHIP[o.status] || CHIP.draft}`}>{codeLabel(o.status)}</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-slate-400">
                {o.recipientName} · {o.recipientPhone}{o.startDate ? ` · Starts ${formatDate(o.startDate)}` : ''}{o.price != null ? ` · Price ${money(o.price)}` : ''}
              </p>
              {o.status === 'accepted' && <p className="text-xs text-gray-600 dark:text-slate-400">Accepted by {o.respondedByName}</p>}
              {o.status === 'rejected' && <p className="text-xs text-red-700 dark:text-red-300">Rejected by {o.respondedByName}: {o.rejectReason}</p>}
              {o.status === 'completed' && <p className="text-xs text-gray-600 dark:text-slate-400">Done{o.completedAt ? ` ${formatDate(o.completedAt)}` : ''} · {o.completionPhotoIds.length} photo{o.completionPhotoIds.length === 1 ? '' : 's'}{o.completionNote ? ` · ${o.completionNote}` : ''}</p>}
              {o.linkExpired && <p className="text-xs text-amber-700 dark:text-amber-300">The link has run out — send it again for a new one.</p>}
              {mayDispatch && !['completed', 'cancelled'].includes(o.status) && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button type="button" disabled={!!busy} onClick={() => act(o.id, 'send')} className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:underline disabled:opacity-50 dark:text-orange-300"><Send className="w-3 h-3" /> {o.status === 'draft' ? 'Text to crew' : 'Text again'}</button>
                  {o.linkUrl && <button type="button" onClick={() => copy(o.linkUrl!)} className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:underline dark:text-slate-300"><Copy className="w-3 h-3" /> Copy link</button>}
                  {o.status !== 'accepted' && <button type="button" onClick={() => setEditing(o)} className="text-xs font-medium text-gray-700 hover:underline dark:text-slate-300">Edit</button>}
                  <button type="button" disabled={!!busy} onClick={() => act(o.id, 'cancel')} className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"><X className="w-3 h-3" /> Cancel</button>
                </div>
              )}
              {mayDelete && ['draft', 'cancelled'].includes(o.status) && (
                <button type="button" onClick={() => remove(o)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:underline dark:text-slate-400"><Trash2 className="w-3 h-3" /> Remove</button>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <WorkOrderForm jobId={jobId} jobAddress={jobAddress} existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  )
}

function WorkOrderForm({ jobId, jobAddress, existing, onClose, onSaved }: { jobId: string; jobAddress?: string | null; existing: WorkOrder | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const { can } = usePermissions()
  // What the crew is paid is the shop's cost: asked for, and sent, only by a seat that reads it (the server asks the same).
  const mayPrice = can('margin:read')
  const [crews, setCrews] = useState<CrewRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [form, setForm] = useState({
    crewId: existing?.crewId || '', recipientName: existing?.recipientName || '', recipientPhone: existing?.recipientPhone || '',
    title: existing?.title || '', scope: existing?.scope || '', address: existing?.address || jobAddress || '',
    startDate: existing?.startDate ? existing.startDate.slice(0, 10) : '', materialOrderId: '', price: existing?.price != null ? String(existing.price) : '',
  })
  const [lines, setLines] = useState<Line[]>(existing?.materialLines || [])
  const [shared, setShared] = useState<string[]>(existing?.photoIds || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/api/crews', { limit: 100 }).then((r) => setCrews(listOf<CrewRow>(r))).catch(() => setCrews([]))
    api.get('/api/materials', { jobId, limit: 50 }).then((r) => setOrders(listOf<OrderRow>(r))).catch(() => setOrders([]))
    api.get(`/api/jobs/${jobId}/photos`).then((r) => setPhotos(listOf<PhotoRow>(r))).catch(() => setPhotos([]))
  }, [jobId])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const pickCrew = (id: string) => {
    const c = crews.find((x) => x.id === id)
    setForm((f) => ({ ...f, crewId: id, recipientName: c?.foremanName || f.recipientName, recipientPhone: c?.foremanPhone || f.recipientPhone }))
  }
  const setLine = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const filled = lines.filter((l) => l.description.trim())
  const problem = !form.title.trim() ? 'Give the work order a title.' : !(form.recipientName.trim() && form.recipientPhone.trim()) ? 'Choose a crew, or enter a name and a phone number.'
    : filled.some((l) => !(Number(l.qty) > 0)) ? 'Every material line needs a quantity.' : ''

  const save = async () => {
    if (problem) { setError(problem); return }
    setSaving(true); setError('')
    const body: Record<string, unknown> = {
      title: form.title.trim(), scope: form.scope.trim(), address: form.address.trim(), recipientName: form.recipientName.trim(), recipientPhone: form.recipientPhone.trim(),
      ...(form.crewId ? { crewId: form.crewId } : {}), ...(form.startDate ? { startDate: form.startDate } : {}),
      materialLines: filled.map((l) => ({ description: l.description.trim(), qty: Number(l.qty), unit: l.unit.trim() || 'ea' })), photoIds: shared,
      ...(form.materialOrderId ? { materialOrderId: form.materialOrderId } : {}),
      ...(mayPrice ? { price: form.price.trim() === '' ? null : Number(form.price) } : {}),
    }
    try {
      if (existing) await api.put(`/api/work-orders/${encodeURIComponent(existing.id)}`, body)
      else await api.post('/api/work-orders', { jobId, ...body })
      toast.success(existing ? 'Work order saved' : 'Work order made — text it to the crew when you are ready')
      onSaved(); onClose()
    } catch (err) { setError(errorText(err, 'Could not save the work order')) } finally { setSaving(false) }
  }

  const input = 'w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-900 dark:border-slate-700'
  const lab = 'text-xs text-gray-600 block mb-1 dark:text-slate-400'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-label={existing ? 'Edit work order' : 'New work order'} className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2 dark:text-slate-100"><ClipboardList className="w-5 h-5 text-orange-600" /> {existing ? 'Edit work order' : 'New work order'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><label htmlFor="wo-title" className={lab}>Title *</label><input id="wo-title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Tear off and re-roof" className={input} /></div>
          <div className="sm:col-span-2"><label htmlFor="wo-crew" className={lab}>Crew or sub</label>
            <select id="wo-crew" value={form.crewId} onChange={(e) => pickCrew(e.target.value)} className={input}>
              <option value="">Someone else — enter below</option>
              {crews.map((c) => <option key={c.id} value={c.id}>{c.name}{c.foremanName ? ` — ${c.foremanName}` : ''}</option>)}
            </select></div>
          <div><label htmlFor="wo-name" className={lab}>Texted to *</label><input id="wo-name" value={form.recipientName} onChange={(e) => set('recipientName', e.target.value)} className={input} /></div>
          <div><label htmlFor="wo-phone" className={lab}>Phone *</label><input id="wo-phone" type="tel" value={form.recipientPhone} onChange={(e) => set('recipientPhone', e.target.value)} className={input} /></div>
          <div><label htmlFor="wo-start" className={lab}>Start date</label><input id="wo-start" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={input} /></div>
          <div><label htmlFor="wo-address" className={lab}>Address</label><input id="wo-address" value={form.address} onChange={(e) => set('address', e.target.value)} className={input} /></div>
          {mayPrice && (
            <div className="sm:col-span-2"><label htmlFor="wo-price" className={lab}>Price for the whole job ($)</label>
              <input id="wo-price" type="number" min={0} step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="What the crew is paid, as one lump sum" className={input} />
              <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">The crew never sees it. Once the work order is sent it counts as the job&rsquo;s crew labour in job costing, in place of pay by the square.</p></div>
          )}
          <div className="sm:col-span-2"><label htmlFor="wo-scope" className={lab}>Scope of work</label><textarea id="wo-scope" rows={4} value={form.scope} onChange={(e) => set('scope', e.target.value)} placeholder="What to do, what to watch for, where to park…" className={input} /></div>
        </div>

        <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-1 dark:text-slate-100">Materials (the crew sees no prices)</h3>
        {orders.length > 0 && (
          <div className="mb-2"><label htmlFor="wo-order" className={lab}>Copy the lines of a material order</label>
            <select id="wo-order" value={form.materialOrderId} onChange={(e) => set('materialOrderId', e.target.value)} className={input}>
              <option value="">None</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.supplier || 'Order'} — {(o.lineItems || []).length} lines</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Its lines are added to the ones below.</p></div>
        )}
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-7"><input aria-label={`Material ${i + 1}`} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="e.g. Ridge cap" className={input} /></div>
              <div className="col-span-2"><input aria-label={`Quantity ${i + 1}`} type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} className={input} /></div>
              <div className="col-span-2"><input aria-label={`Unit ${i + 1}`} value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} className={input} /></div>
              <div className="col-span-1 flex justify-end"><button type="button" aria-label={`Remove material ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"><Trash2 className="w-4 h-4" /></button></div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setLines((ls) => [...ls, { description: '', qty: '', unit: 'ea' }])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300"><Plus className="w-4 h-4" /> Add a line</button>

        {photos.length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-2 dark:text-slate-100">Photos to share with the crew</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((p) => (
                <label key={p.id} className="relative block cursor-pointer">
                  <img src={p.thumbnailUrl || p.url || ''} alt={p.caption || `${p.photoType || 'Job'} photo`} className="rounded-lg w-full h-20 object-cover" />
                  <input type="checkbox" aria-label={`Share ${p.caption || `${p.photoType || 'job'} photo`}`} checked={shared.includes(p.id)} onChange={(e) => setShared((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} className="absolute top-1 left-1" />
                </label>
              ))}
            </div>
          </>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save work order'}</button>
        </div>
      </div>
    </div>
  )
}
