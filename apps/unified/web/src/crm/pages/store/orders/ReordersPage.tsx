// The store's "Draft a reorder" at /crm/reorders (parity row 4 against Shopify's purchase orders, 2026-10-31): what is running low,
// grouped by supplier with a suggested count and the supplier's cost; a draft purchase order per supplier that the owner edits and
// emails; and the counts that arrive booked in against it, which puts the units on the shelf. Three tabs: To order, Orders, Suppliers.
//
// /api/admin/reorders (server/crm/store/reorders/routes.ts) — behind the store_reorders feature and margin:read (costs are the
// shop's own), as this page's menu row is; changing anything is products:update (the page asks the same, the server refuses a seat
// without it).
//   · a failed read or save says so in words (the server's sentence) — never a list that looks empty;
//   · money is typed in dollars and sent as cents; the day is the shop's calendar day, typed as a date;
//   · cancelling asks twice on the page (no native dialog); an order is cancelled, never deleted.
import { useCallback, useEffect, useState } from 'react'
import { PackageCheck } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useMayWrite } from '../../../../shared'

interface SuggestLine { variantId: string; sku: string; productName: string; variantName: string; quantity: number; lowStockAt: number; onOrder: number; suggested: number; unitCostCents: number; hasCost: boolean }
interface Group { supplierId: string | null; supplierName: string | null; supplierEmail: string | null; lines: SuggestLine[]; totalCents: number }
interface Suggestions { groups: Group[]; coveredByOpenOrders: number; suppliers: { id: string; name: string }[]; currency: string }
interface Line { id: string; sku: string; name: string; quantity: number; unitCostCents: number; receivedQuantity: number }
interface Order { id: string; number: string; status: string; supplierId: string; supplierName: string | null; supplierEmail: string | null; notes: string | null; expectedOn: string | null; sentTo: string | null; totalCents: number; lines: Line[]; createdAt: string }
interface Supplier { id: string; name: string; email: string | null; phone: string | null; notes: string | null }

const STATUS: Record<string, string> = { draft: 'Draft', sent: 'Sent', partly_received: 'Part received', received: 'Received', cancelled: 'Cancelled' }
const money = (c: number, currency = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(c / 100)
const toCents = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN }
const toInt = (v: string) => { const n = Number(v.replace(/[^0-9]/g, '')); return Number.isFinite(n) ? Math.floor(n) : NaN }
const dollars = (c: number) => (c / 100).toFixed(2)
const lineName = (l: SuggestLine) => (l.variantName && l.variantName !== 'Default' ? `${l.productName} — ${l.variantName}` : l.productName)
const field = 'input mt-1 w-full'

function ToOrder({ data, mayWrite, onDrafted, onError }: { data: Suggestions; mayWrite: boolean; onDrafted: (id: string) => void; onError: (m: string) => void }) {
  const [pick, setPick] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const draft = async (key: string, supplierId: string, variantIds?: string[]) => {
    onError(''); setBusy(key)
    try { const po = (await api.post('/api/admin/reorders/draft', { supplierId, ...(variantIds ? { variantIds } : {}) })) as Order; onDrafted(po.id) }
    catch (e) { onError(errorText(e, "Couldn't draft the order")) } finally { setBusy('') }
  }
  if (!data.groups.length) return <p className="text-gray-500 dark:text-slate-400">Nothing needs ordering now.{data.coveredByOpenOrders > 0 ? ` ${data.coveredByOpenOrders} low ${data.coveredByOpenOrders === 1 ? 'option is' : 'options are'} already on an order.` : ' Set a “Tell me at” level on an option (Products) to see it here when it runs low.'}</p>
  return (
    <div className="space-y-4">
      {data.groups.map((g) => {
        const key = g.supplierId ?? 'none'
        return (
          <section key={key} className="card p-4 sm:p-5" aria-label={g.supplierName ?? 'No supplier chosen'}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{g.supplierName ?? 'No supplier chosen yet'}</h2>
              {g.supplierId && <p className="text-sm text-gray-700 dark:text-slate-300">{money(g.totalCents, data.currency)} to order</p>}
            </div>
            <div className="mt-2 overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-gray-600 dark:text-slate-400"><th className="py-1 pr-3">Option</th><th className="py-1 pr-3">Left</th><th className="py-1 pr-3">Tell me at</th><th className="py-1 pr-3">Already on order</th><th className="py-1 pr-3">Order</th><th className="py-1">Their cost</th></tr></thead>
              <tbody>{g.lines.map((l) => (
                <tr key={l.variantId} className="border-t border-gray-200 dark:border-slate-800 text-gray-900 dark:text-slate-100">
                  <td className="py-1 pr-3">{lineName(l)} <span className="text-gray-500 dark:text-slate-400">({l.sku})</span></td><td className="py-1 pr-3">{l.quantity}</td><td className="py-1 pr-3">{l.lowStockAt}</td><td className="py-1 pr-3">{l.onOrder}</td>
                  <td className="py-1 pr-3 font-medium">{l.suggested}</td><td className="py-1">{l.hasCost ? money(l.unitCostCents, data.currency) : 'No cost entered'}</td>
                </tr>))}</tbody>
            </table></div>
            {mayWrite && (g.supplierId ? (
              <div className="mt-3"><button type="button" className="btn-primary" disabled={busy === key} onClick={() => void draft(key, g.supplierId!)}>Draft the order for {g.supplierName}</button></div>
            ) : (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="text-sm text-gray-700 dark:text-slate-300">Order these from
                  <select className={field} value={pick[key] ?? ''} onChange={(e) => setPick({ ...pick, [key]: e.target.value })}>
                    <option value="">Choose a supplier</option>
                    {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></label>
                <button type="button" className="btn-primary" disabled={!pick[key] || busy === key} onClick={() => void draft(key, pick[key], g.lines.map((l) => l.variantId))}>Draft the order</button>
              </div>
            ))}
          </section>
        )
      })}
      {data.coveredByOpenOrders > 0 && <p className="text-sm text-gray-500 dark:text-slate-400">{data.coveredByOpenOrders} more low {data.coveredByOpenOrders === 1 ? 'option is' : 'options are'} already covered by an order that has not come in.</p>}
    </div>
  )
}

function OrderCard({ po, mayWrite, currency, open, onToggle, onChanged, onError }: { po: Order; mayWrite: boolean; currency: string; open: boolean; onToggle: () => void; onChanged: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(false)
  const [to, setTo] = useState('')
  const [notes, setNotes] = useState(po.notes ?? '')
  const [expectedOn, setExpectedOn] = useState(po.expectedOn ?? '')
  const [edits, setEdits] = useState<Record<string, { quantity: string; cost: string }>>({})
  const [got, setGot] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const lineEdit = (l: Line) => edits[l.id] ?? { quantity: String(l.quantity), cost: dollars(l.unitCostCents) }
  const run = async (what: () => Promise<unknown>, fallback: string, done?: string) => {
    onError(''); setNotice(''); setBusy(true)
    try { await what(); if (done) setNotice(done); onChanged() } catch (e) { onError(errorText(e, fallback)) } finally { setBusy(false) }
  }
  const save = () => {
    const lines = po.lines.map((l) => ({ id: l.id, quantity: toInt(lineEdit(l).quantity), unitCostCents: toCents(lineEdit(l).cost) }))
    if (lines.some((l) => Number.isNaN(l.quantity) || Number.isNaN(l.unitCostCents))) { onError('Counts are whole numbers and costs are amounts like 8.50.'); return }
    void run(() => api.put(`/api/admin/reorders/${po.id}`, { notes: notes.trim() || null, expectedOn: expectedOn || null, lines }), "Couldn't save the order", 'Saved.')
  }
  const receive = () => {
    const lines = po.lines.map((l) => ({ lineId: l.id, quantity: toInt(got[l.id] ?? '0') })).filter((l) => l.quantity !== 0)
    if (lines.some((l) => Number.isNaN(l.quantity))) { onError('Counts are whole numbers.'); return }
    void run(async () => { await api.post(`/api/admin/reorders/${po.id}/receive`, { lines }); setGot({}) }, "Couldn't book the delivery", 'Booked in: the stock is updated.')
  }
  const isDraft = po.status === 'draft'
  const canReceive = po.status === 'sent' || po.status === 'partly_received'
  return (
    <li className="card p-4 sm:p-5">
      <button type="button" className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left" aria-expanded={open} onClick={onToggle}>
        <span className="text-lg font-semibold text-gray-900 dark:text-slate-100">{po.number} · {po.supplierName ?? 'Supplier'}</span>
        <span className="text-sm text-gray-700 dark:text-slate-300">{STATUS[po.status] ?? po.status} · {money(po.totalCents, currency)}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-gray-600 dark:text-slate-400"><th className="py-1 pr-3">Item</th><th className="py-1 pr-3">Order</th><th className="py-1 pr-3">Unit cost</th><th className="py-1 pr-3">Came in</th>{canReceive && <th className="py-1">Book in now</th>}</tr></thead>
            <tbody>{po.lines.map((l) => (
              <tr key={l.id} className="border-t border-gray-200 dark:border-slate-800 text-gray-900 dark:text-slate-100">
                <td className="py-1 pr-3">{l.name} <span className="text-gray-500 dark:text-slate-400">({l.sku})</span></td>
                <td className="py-1 pr-3">{isDraft && mayWrite ? <input aria-label={`Count for ${l.name}`} className="input w-20 py-1" inputMode="numeric" value={lineEdit(l).quantity} onChange={(e) => setEdits({ ...edits, [l.id]: { ...lineEdit(l), quantity: e.target.value } })} /> : l.quantity}</td>
                <td className="py-1 pr-3">{isDraft && mayWrite ? <input aria-label={`Cost for ${l.name}`} className="input w-24 py-1" inputMode="decimal" value={lineEdit(l).cost} onChange={(e) => setEdits({ ...edits, [l.id]: { ...lineEdit(l), cost: e.target.value } })} /> : money(l.unitCostCents, currency)}</td>
                <td className="py-1 pr-3">{l.receivedQuantity} of {l.quantity}</td>
                {canReceive && <td className="py-1">{mayWrite && l.receivedQuantity < l.quantity ? <input aria-label={`Received of ${l.name}`} className="input w-20 py-1" inputMode="numeric" placeholder="0" value={got[l.id] ?? ''} onChange={(e) => setGot({ ...got, [l.id]: e.target.value })} /> : '—'}</td>}
              </tr>))}</tbody>
          </table></div>
          {isDraft && mayWrite && <p className="text-xs text-gray-500 dark:text-slate-400">A count of 0 takes the line off the order.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-gray-700 dark:text-slate-300">Wanted by
              <input type="date" className={field} value={expectedOn} disabled={!isDraft || !mayWrite} onChange={(e) => setExpectedOn(e.target.value)} /></label>
            <label className="text-sm text-gray-700 dark:text-slate-300">Note for the supplier
              <input className={field} value={notes} maxLength={2000} disabled={!isDraft || !mayWrite} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          {po.sentTo && <p className="text-sm text-gray-600 dark:text-slate-400">Emailed to {po.sentTo}.</p>}
          {isDraft && mayWrite && (
            <label className="block max-w-md text-sm text-gray-700 dark:text-slate-300">Send to {po.supplierEmail ? `(blank = ${po.supplierEmail})` : '(this supplier has no email address yet — type one)'}
              <input type="email" className={field} value={to} onChange={(e) => setTo(e.target.value)} placeholder={po.supplierEmail ?? 'orders@supplier.example'} /></label>
          )}
          {mayWrite && (
            <div className="flex flex-wrap items-center gap-2">
              {isDraft && <button type="button" className="btn-secondary" disabled={busy} onClick={save}>Save changes</button>}
              {isDraft && <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(() => api.post(`/api/admin/reorders/${po.id}/send`, to.trim() ? { to: to.trim() } : {}), "Couldn't send the order", 'Emailed to the supplier.')}>Email to the supplier</button>}
              {canReceive && <button type="button" className="btn-primary" disabled={busy} onClick={receive}>Book in what arrived</button>}
              {(isDraft || (po.status === 'sent' && po.lines.every((l) => l.receivedQuantity === 0))) && (sure
                ? <><button type="button" className="btn-secondary" disabled={busy} onClick={() => { setSure(false); void run(() => api.post(`/api/admin/reorders/${po.id}/cancel`, {}), "Couldn't cancel the order") }}>Yes, cancel {po.number}</button><button type="button" className="btn-secondary" onClick={() => setSure(false)}>Keep it</button></>
                : <button type="button" className="btn-secondary" onClick={() => setSure(true)}>Cancel this order</button>)}
            </div>
          )}
          {notice && <p role="status" className="text-sm text-green-700 dark:text-green-400">{notice}</p>}
        </div>
      )}
    </li>
  )
}

function Suppliers({ rows, mayWrite, onChanged, onError }: { rows: Supplier[]; mayWrite: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const blank = { name: '', email: '', phone: '', notes: '' }
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState('')
  const [sure, setSure] = useState('')
  const save = async () => {
    onError('')
    try {
      const body = { name: form.name, email: form.email.trim() || null, phone: form.phone.trim() || null, notes: form.notes.trim() || null }
      if (editing) await api.put(`/api/admin/reorders/suppliers/${editing}`, body)
      else await api.post('/api/admin/reorders/suppliers', body)
      setForm(blank); setEditing(''); onChanged()
    } catch (e) { onError(errorText(e, "Couldn't save the supplier")) }
  }
  const remove = async (s: Supplier) => {
    onError('')
    try { await api.delete('/api/admin/reorders/suppliers', s.id); setSure(''); onChanged() } catch (e) { onError(errorText(e, "Couldn't remove the supplier")); setSure('') }
  }
  return (
    <div className="space-y-4">
      {mayWrite && (
        <section className="card p-4 sm:p-5 space-y-3" aria-label={editing ? 'Change supplier' : 'New supplier'}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{editing ? 'Change this supplier' : 'New supplier'}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-gray-700 dark:text-slate-300">Name<input className={field} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="text-sm text-gray-700 dark:text-slate-300">Email for orders<input type="email" className={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="text-sm text-gray-700 dark:text-slate-300">Phone<input className={field} value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="text-sm text-gray-700 dark:text-slate-300">Notes<input className={field} value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={!form.name.trim()} onClick={() => void save()}>{editing ? 'Save changes' : 'Add supplier'}</button>
            {editing && <button type="button" className="btn-secondary" onClick={() => { setEditing(''); setForm(blank) }}>Cancel</button>}
          </div>
        </section>
      )}
      {rows.length === 0 ? <p className="text-gray-500 dark:text-slate-400">No suppliers yet. Add one, then choose it on an option (Products › the product › Buy it from).</p> : (
        <ul className="space-y-3">{rows.map((s) => (
          <li key={s.id} className="card p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{s.name}</h2>
            <p className="text-sm text-gray-600 dark:text-slate-400">{[s.email, s.phone].filter(Boolean).join(' · ') || 'No email or phone yet'}</p>
            {s.notes && <p className="text-sm text-gray-600 dark:text-slate-400">{s.notes}</p>}
            {mayWrite && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary text-sm" onClick={() => { setEditing(s.id); setForm({ name: s.name, email: s.email ?? '', phone: s.phone ?? '', notes: s.notes ?? '' }) }}>Change</button>
                {sure === s.id
                  ? <><button type="button" className="btn-secondary text-sm" onClick={() => void remove(s)}>Yes, remove {s.name}</button><button type="button" className="btn-secondary text-sm" onClick={() => setSure('')}>Keep it</button></>
                  : <button type="button" className="btn-secondary text-sm" onClick={() => setSure(s.id)}>Remove</button>}
              </div>
            )}
          </li>
        ))}</ul>
      )}
    </div>
  )
}

export default function ReordersPage() {
  const mayWrite = useMayWrite('products:update')
  const [tab, setTab] = useState<'order' | 'orders' | 'suppliers'>('order')
  const [suggest, setSuggest] = useState<Suggestions | null>(null)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null)
  const [open, setOpen] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    try {
      const [s, o, p] = await Promise.all([api.get('/api/admin/reorders/suggestions'), api.get('/api/admin/reorders'), api.get('/api/admin/reorders/suppliers')])
      setSuggest(s as Suggestions); setOrders((o as { data: Order[] }).data); setSuppliers((p as { data: Supplier[] }).data); setLoadError('')
    } catch (e) { setLoadError(errorText(e, "Couldn't load the reorders")) }
  }, [])
  useEffect(() => { void load() }, [load])
  const tabs = [['order', 'To order'], ['orders', 'Orders'], ['suppliers', 'Suppliers']] as const
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2"><PackageCheck className="h-6 w-6" aria-hidden="true" />Reorders</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">What is running low, ordered from your suppliers. Draft an order, change it, email it, and book in what arrives — the stock goes up with it.</p>
      </div>
      <div role="tablist" aria-label="Reorders" className="flex gap-2">
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => { setTab(k); setError('') }}>{label}</button>)}
      </div>
      {error && <PageError message={error} />}
      {loadError ? <PageError message={`${loadError} — refresh to try again.`} /> : !suggest || !orders || !suppliers ? <p className="text-gray-500 dark:text-slate-400">Loading…</p> : tab === 'order' ? (
        <ToOrder data={suggest} mayWrite={mayWrite} onError={setError} onDrafted={(id) => { setOpen(id); setTab('orders'); void load() }} />
      ) : tab === 'orders' ? (
        orders.length === 0 ? <p className="text-gray-500 dark:text-slate-400">No orders yet. Draft one from “To order”.</p> : (
          <ul className="space-y-3">{orders.map((po) => <OrderCard key={`${po.id}:${po.status}:${po.lines.map((l) => `${l.quantity}/${l.receivedQuantity}/${l.unitCostCents}`).join(',')}`} po={po} mayWrite={mayWrite} currency={suggest.currency} open={open === po.id} onToggle={() => setOpen(open === po.id ? '' : po.id)} onChanged={() => void load()} onError={setError} />)}</ul>
        )
      ) : (
        <Suppliers rows={suppliers} mayWrite={mayWrite} onChanged={() => void load()} onError={setError} />
      )}
    </div>
  )
}
