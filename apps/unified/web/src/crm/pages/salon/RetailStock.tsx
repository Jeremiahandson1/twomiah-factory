// Retail stock management (server crm/salon/retailStock.ts, /api/salon-retail-stock; hidden feature `salon_retail`): purchase orders drafted from low
// stock, emailed to the supplier and received line by line; suppliers; places and transfers between them; a stock count driven by a barcode scanner.
// A USB / keyboard scanner types the code into the focused box and presses Enter, so every scan box here is a plain input that reacts to Enter.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, ScanLine } from 'lucide-react'
import { api, useToast, useConfirm, usePermissions, money } from '../../../shared'
import { Button, Field, Modal, inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const cents = (c: number) => money(c / 100)
const toCents = (v: string) => Math.round(Number(v) * 100)
const alertCls = 'rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'

interface Supplier { id: string; name: string; contactName: string | null; email: string | null; phone: string | null; notes: string | null; active: boolean }
interface Place { id: string; name: string; active: boolean; first: boolean }
interface Line { id: string; productId: string; name: string; sku: string | null; quantity: number; received: number; unitCostCents: number | null }
interface Order { id: string; number: string; status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'; note: string | null; sentAt: string | null; sentTo: string | null; supplier: { id: string; name: string; email: string | null } | null; lines: Line[]; totalCents: number }
interface Product { id: string; name: string; brand: string | null; sku: string | null; barcode: string | null; onHand: number; active: boolean }
const STATUS_WORDS: Record<Order['status'], string> = { draft: 'Draft', sent: 'Sent — waiting for stock', partial: 'Part received', received: 'Received', cancelled: 'Cancelled' }
const productName = (p: { brand?: string | null; name: string }) => [p.brand, p.name].filter(Boolean).join(' ')

export default function RetailStockPage() {
  const { can, known } = usePermissions()
  const [tab, setTab] = useState<'orders' | 'suppliers' | 'places' | 'count'>('orders')
  const mayChange = known && can('inventory:update')
  const tabs: Array<[typeof tab, string]> = [['orders', 'Purchase orders'], ['suppliers', 'Suppliers'], ['places', 'Places and transfers'], ['count', 'Count stock']]
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Retail stock</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">Order from your suppliers, receive what arrives, move stock between places and count the shelf. <Link to="/crm/retail" className="font-medium text-teal-800 underline dark:text-teal-200">Back to products</Link></p>
      </div>
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={'rounded-lg border px-3 py-1.5 text-sm font-medium ' + (tab === id ? 'border-teal-700 bg-teal-50 text-teal-900 dark:border-teal-400 dark:bg-teal-950/40 dark:text-teal-100' : 'border-gray-300 text-gray-800 dark:border-slate-600 dark:text-slate-200')}>{label}</button>)}
      </div>
      {tab === 'orders' && <Orders mayChange={mayChange} />}
      {tab === 'suppliers' && <Suppliers mayChange={mayChange} />}
      {tab === 'places' && <Places mayChange={mayChange} />}
      {tab === 'count' && <Count mayChange={mayChange} />}
    </div>
  )
}

function Orders({ mayChange }: { mayChange: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [low, setLow] = useState<Array<{ id: string; name: string; onHand: number }>>([])
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [receiving, setReceiving] = useState<Order | null>(null)
  const [editing, setEditing] = useState<Order | null>(null)
  const load = useCallback(() => {
    api.get('/api/salon-retail-stock/orders').then((r: { orders: Order[] }) => { setOrders(r.orders); setProblem('') }).catch((e: Error) => setProblem(e.message || 'The orders could not be loaded.'))
    api.get('/api/salon-retail-stock/low').then((r: { products: Array<{ id: string; name: string; onHand: number }> }) => setLow(r.products)).catch(() => setLow([]))
  }, [])
  useEffect(load, [load])
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setProblem(''); setNote(''); try { await fn(); toast.success(ok); load() } catch (e: any) { setProblem(e?.message || 'That did not work.') } finally { setBusy(false) } }
  const draft = async () => {
    setBusy(true); setProblem(''); setNote('')
    try {
      const r = await api.post('/api/salon-retail-stock/orders/from-low', {})
      const parts = [`${r.orders.length} draft order${r.orders.length === 1 ? '' : 's'} ready.`]
      if (r.unassigned?.length) parts.push(`No supplier on: ${r.unassigned.join(', ')}.`)
      if (r.alreadyOrdered?.length) parts.push(`Already on an order: ${r.alreadyOrdered.join(', ')}.`)
      setNote(parts.join(' ')); load()
    } catch (e: any) { setProblem(e?.message || 'No order could be drafted.') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <section className={box}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-800 dark:text-slate-200" data-testid="low-count">{low.length ? `${low.length} product${low.length === 1 ? ' is' : 's are'} at or below the reorder level: ${low.map((p) => `${p.name} (${p.onHand})`).join(', ')}.` : 'Nothing is at or below its reorder level.'}</p>
          {mayChange && <Button onClick={draft} disabled={busy || !low.length}>Draft orders from low stock</Button>}
        </div>
        {note && <p role="status" className="mt-2 text-sm text-gray-700 dark:text-slate-300">{note}</p>}
      </section>
      {problem && <div role="alert" className={alertCls}>{problem}</div>}
      {!orders && !problem && <Loader2 className="h-6 w-6 animate-spin text-gray-500" />}
      {orders && orders.length === 0 && <p className="text-gray-600 dark:text-slate-300">No purchase orders yet.</p>}
      {orders?.map((o) => (
        <section key={o.id} className={box} aria-label={o.number}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 className="font-semibold text-gray-900 dark:text-white">{o.number} · {o.supplier?.name}</h2><p className="text-sm text-gray-700 dark:text-slate-300">{STATUS_WORDS[o.status]}{o.sentAt ? ` · emailed ${momentDate(o.sentAt)} to ${o.sentTo}` : ''}{o.totalCents ? ` · ${cents(o.totalCents)}` : ''}</p></div>
            {mayChange && (
              <div className="flex flex-wrap gap-2">
                {o.status === 'draft' && <><Button variant="secondary" onClick={() => setEditing(o)} disabled={busy}>Edit</Button><Button onClick={() => run(() => api.post(`/api/salon-retail-stock/orders/${o.id}/send`, {}), 'Order emailed')} disabled={busy}>Email to supplier</Button></>}
                {(o.status === 'sent' || o.status === 'partial') && <Button onClick={() => setReceiving(o)} disabled={busy}>Receive stock</Button>}
                {(o.status === 'draft' || o.status === 'sent') && <Button variant="secondary" disabled={busy} onClick={async () => { if (await confirm(`Cancel ${o.number}?`, { title: 'Cancel order', confirmText: 'Cancel order' })) await run(() => api.post(`/api/salon-retail-stock/orders/${o.id}/cancel`, {}), 'Order cancelled') }}>Cancel</Button>}
              </div>
            )}
          </div>
          <ul className="mt-2 divide-y divide-gray-100 text-sm text-gray-900 dark:divide-slate-800 dark:text-slate-100">
            {o.lines.map((l) => <li key={l.id} className="flex justify-between gap-3 py-1.5"><span>{l.name}{l.sku ? ` (${l.sku})` : ''}</span><span>{l.received}/{l.quantity} received{l.unitCostCents != null ? ` · ${cents(l.unitCostCents)} each` : ''}</span></li>)}
          </ul>
          {o.note && <p className="mt-2 text-sm italic text-gray-700 dark:text-slate-300">{o.note}</p>}
        </section>
      ))}
      {receiving && <ReceiveModal order={receiving} onClose={() => setReceiving(null)} onDone={load} />}
      {editing && <EditOrderModal order={editing} onClose={() => setEditing(null)} onDone={load} />}
    </div>
  )
}

function ReceiveModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [qty, setQty] = useState<Record<string, string>>({})
  const [cost, setCost] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const open = order.lines.filter((l) => l.quantity > l.received)
  const save = async () => {
    const lines = open.filter((l) => Number(qty[l.id]) > 0).map((l) => ({ lineId: l.id, quantity: Number(qty[l.id]), ...(cost[l.id] ? { unitCostCents: toCents(cost[l.id]) } : {}) }))
    if (!lines.length) { setProblem('Say how many arrived on at least one line.'); return }
    setBusy(true); setProblem('')
    try { await api.post(`/api/salon-retail-stock/orders/${order.id}/receive`, { lines }); toast.success('Stock received'); onDone(); onClose() }
    catch (e: any) { setProblem(e?.message || 'That did not save.') } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={`Receive ${order.number}`} size="lg">
      <div className="space-y-3 text-gray-900 dark:text-slate-100">
        {problem && <div role="alert" className={alertCls}>{problem}</div>}
        <p className="text-sm text-gray-700 dark:text-slate-300">Enter what arrived on each line. A part delivery is fine; the rest stays on the order. A cost you enter becomes the product's cost.</p>
        {open.map((l) => (
          <div key={l.id} className="flex flex-wrap items-end gap-2">
            <span className="min-w-[10rem] flex-1 text-sm">{l.name}<span className="block text-xs text-gray-600 dark:text-slate-400">{l.quantity - l.received} still expected</span></span>
            <label className="w-24 text-xs">Arrived<input inputMode="numeric" value={qty[l.id] || ''} onChange={(e) => setQty((p) => ({ ...p, [l.id]: e.target.value }))} className={inputCls} aria-label={`Arrived: ${l.name}`} /></label>
            <label className="w-28 text-xs">Cost each ($)<input inputMode="decimal" value={cost[l.id] || ''} onChange={(e) => setCost((p) => ({ ...p, [l.id]: e.target.value }))} className={inputCls} aria-label={`Cost each: ${l.name}`} /></label>
          </div>
        ))}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Receive'}</Button></div>
      </div>
    </Modal>
  )
}

function EditOrderModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(order.lines.map((l) => [l.productId, String(l.quantity)])))
  const [cost, setCost] = useState<Record<string, string>>(Object.fromEntries(order.lines.map((l) => [l.productId, l.unitCostCents != null ? (l.unitCostCents / 100).toFixed(2) : ''])))
  const [note, setNote] = useState(order.note || '')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true); setProblem('')
    try {
      await api.patch(`/api/salon-retail-stock/orders/${order.id}`, { note, lines: order.lines.map((l) => ({ productId: l.productId, quantity: Number(qty[l.productId]) || 0, ...(cost[l.productId] ? { unitCostCents: toCents(cost[l.productId]) } : {}) })) })
      toast.success('Order saved'); onDone(); onClose()
    } catch (e: any) { setProblem(e?.message || 'That did not save.') } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={`Edit ${order.number}`} size="lg" dirty>
      <div className="space-y-3 text-gray-900 dark:text-slate-100">
        {problem && <div role="alert" className={alertCls}>{problem}</div>}
        <p className="text-sm text-gray-700 dark:text-slate-300">Set a quantity to 0 to take a product off the order.</p>
        {order.lines.map((l) => (
          <div key={l.id} className="flex flex-wrap items-end gap-2">
            <span className="min-w-[10rem] flex-1 text-sm">{l.name}</span>
            <label className="w-24 text-xs">Quantity<input inputMode="numeric" value={qty[l.productId]} onChange={(e) => setQty((p) => ({ ...p, [l.productId]: e.target.value }))} className={inputCls} aria-label={`Quantity: ${l.name}`} /></label>
            <label className="w-28 text-xs">Cost each ($)<input inputMode="decimal" value={cost[l.productId]} onChange={(e) => setCost((p) => ({ ...p, [l.productId]: e.target.value }))} className={inputCls} aria-label={`Cost each: ${l.name}`} /></label>
          </div>
        ))}
        <Field label="Note to the supplier (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} maxLength={500} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
      </div>
    </Modal>
  )
}

function Suppliers({ mayChange }: { mayChange: boolean }) {
  const [list, setList] = useState<Supplier[] | null>(null)
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const [problem, setProblem] = useState('')
  const load = useCallback(() => { api.get('/api/salon-retail-stock/suppliers').then((r: { suppliers: Supplier[] }) => setList(r.suppliers)).catch((e: Error) => setProblem(e.message || 'The suppliers could not be loaded.')) }, [])
  useEffect(load, [load])
  return (
    <div className="space-y-3">
      {mayChange && <div className="flex justify-end"><Button onClick={() => setEditing('new')}>Add a supplier</Button></div>}
      {problem && <div role="alert" className={alertCls}>{problem}</div>}
      {list && list.length === 0 && <p className="text-gray-600 dark:text-slate-300">No suppliers yet. Add one, then choose it on each product so orders can be drafted.</p>}
      {list?.map((s) => (
        <section key={s.id} className={box + (s.active ? '' : ' opacity-60')}>
          <div className="flex justify-between gap-3"><div><h2 className="font-semibold text-gray-900 dark:text-white">{s.name}{!s.active && ' (not in use)'}</h2><p className="text-sm text-gray-700 dark:text-slate-300">{[s.contactName, s.email, s.phone].filter(Boolean).join(' · ') || 'No contact details'}</p>{s.notes && <p className="text-sm italic text-gray-700 dark:text-slate-300">{s.notes}</p>}</div>
            {mayChange && <button className="self-start font-medium text-teal-800 underline dark:text-teal-200" onClick={() => setEditing(s)}>Edit</button>}</div>
        </section>
      ))}
      {editing && <SupplierModal supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  )
}

function SupplierModal({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ name: supplier?.name || '', contactName: supplier?.contactName || '', email: supplier?.email || '', phone: supplier?.phone || '', notes: supplier?.notes || '', active: supplier?.active ?? true })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }))
  const save = async () => {
    setBusy(true); setErrors({}); setProblem('')
    try { if (supplier) await api.patch(`/api/salon-retail-stock/suppliers/${supplier.id}`, f); else await api.post('/api/salon-retail-stock/suppliers', f); toast.success('Saved'); onSaved(); onClose() }
    catch (e: any) { setErrors(e?.data?.fields || {}); setProblem(e?.message || 'That did not save.') } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={supplier ? 'Edit supplier' : 'Add a supplier'} size="md" dirty>
      <div className="space-y-3">
        {problem && <div role="alert" className={alertCls}>{problem}</div>}
        <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} aria-invalid={!!errors.name} /></Field>
        <Field label="Contact person (optional)"><input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} className={inputCls} /></Field>
        <Field label="Email" hint="Purchase orders are emailed here."><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} className={inputCls} aria-invalid={!!errors.email} /></Field>
        <Field label="Phone (optional)"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} /></Field>
        <Field label="Notes (optional)"><input value={f.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} maxLength={500} /></Field>
        {supplier && <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />In use</label>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
      </div>
    </Modal>
  )
}

function Places({ mayChange }: { mayChange: boolean }) {
  const toast = useToast()
  const [places, setPlaces] = useState<Place[]>([])
  const [stock, setStock] = useState<Record<string, Array<{ locationId: string; name: string; onHand: number }>>>({})
  const [products, setProducts] = useState<Product[]>([])
  const [name, setName] = useState('')
  const [t, setT] = useState({ productId: '', from: '', to: '', qty: '', note: '' })
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    api.get('/api/salon-retail-stock/by-place').then((r: { places: Place[]; stock: typeof stock }) => { setPlaces(r.places); setStock(r.stock) }).catch((e: Error) => setProblem(e.message))
    api.get('/api/salon-retail/manage').then((r: { products: Product[] }) => setProducts(r.products.filter((p) => p.active))).catch(() => setProducts([]))
  }, [])
  useEffect(load, [load])
  const addPlace = async () => { setBusy(true); setProblem(''); try { await api.post('/api/salon-retail-stock/locations', { name }); setName(''); load() } catch (e: any) { setProblem(e?.message || 'That did not save.') } finally { setBusy(false) } }
  const move = async () => {
    setBusy(true); setProblem('')
    try { await api.post('/api/salon-retail-stock/transfers', { productId: t.productId, fromLocationId: t.from, toLocationId: t.to, quantity: Number(t.qty), note: t.note }); toast.success('Stock moved'); setT({ ...t, qty: '', note: '' }); load() }
    catch (e: any) { setProblem(e?.message || 'That did not move.') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      {problem && <div role="alert" className={alertCls}>{problem}</div>}
      <section className={box}>
        <h2 className="font-semibold text-gray-900 dark:text-white">Places</h2>
        <p className="text-sm text-gray-700 dark:text-slate-300">Where you keep stock. Sales and deliveries name the place they come off or go into; the first place is the default.</p>
        <ul className="mt-2 text-sm text-gray-900 dark:text-slate-100">{places.map((p) => <li key={p.id}>{p.name}{p.first ? ' (default)' : ''}</li>)}</ul>
        {mayChange && <div className="mt-3 flex gap-2"><input aria-label="New place" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of a new place" className={inputCls} /><Button variant="secondary" onClick={addPlace} disabled={busy || !name.trim()}>Add</Button></div>}
      </section>
      {mayChange && places.length > 1 && (
        <section className={box}>
          <h2 className="font-semibold text-gray-900 dark:text-white">Move stock between places</h2>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Product"><select value={t.productId} onChange={(e) => setT({ ...t, productId: e.target.value })} className={inputCls}><option value="">Choose…</option>{products.map((p) => <option key={p.id} value={p.id}>{productName(p)}</option>)}</select></Field>
            <Field label="How many"><input inputMode="numeric" value={t.qty} onChange={(e) => setT({ ...t, qty: e.target.value })} className={inputCls} /></Field>
            <Field label="From"><select value={t.from} onChange={(e) => setT({ ...t, from: e.target.value })} className={inputCls}><option value="">Choose…</option>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="To"><select value={t.to} onChange={(e) => setT({ ...t, to: e.target.value })} className={inputCls}><option value="">Choose…</option>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          </div>
          <div className="mt-3 flex justify-end"><Button onClick={move} disabled={busy || !t.productId || !t.from || !t.to || !t.qty}>Move</Button></div>
        </section>
      )}
      <section className={box}>
        <h2 className="font-semibold text-gray-900 dark:text-white">Where the stock is</h2>
        <ul className="mt-2 divide-y divide-gray-100 text-sm text-gray-900 dark:divide-slate-800 dark:text-slate-100">
          {products.filter((p) => stock[p.id]?.length).map((p) => <li key={p.id} className="flex justify-between gap-3 py-1.5"><span>{productName(p)}</span><span>{stock[p.id].map((s) => `${s.name}: ${s.onHand}`).join(' · ')}</span></li>)}
        </ul>
      </section>
    </div>
  )
}

function Count({ mayChange }: { mayChange: boolean }) {
  const toast = useToast()
  const [places, setPlaces] = useState<Place[]>([])
  const [placeId, setPlaceId] = useState('')
  const [rows, setRows] = useState<Array<{ id: string; label: string; system: number | null; counted: string }>>([])
  const [code, setCode] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const box1 = useRef<HTMLInputElement>(null)
  useEffect(() => { api.get('/api/salon-retail-stock/locations').then((r: { locations: Place[] }) => { setPlaces(r.locations); setPlaceId(r.locations[0]?.id || '') }).catch(() => setPlaces([])) }, [])
  // A scan adds the product to the count (or adds one to it if it is already there).
  const scan = async () => {
    const c = code.trim(); if (!c) return
    setProblem(''); setDone('')
    try {
      const { product } = await api.get(`/api/salon-retail-stock/scan?code=${encodeURIComponent(c)}`) as { product: Product }
      setRows((prev) => prev.some((r) => r.id === product.id) ? prev.map((r) => r.id === product.id ? { ...r, counted: String((Number(r.counted) || 0) + 1) } : r) : [...prev, { id: product.id, label: productName(product), system: null, counted: '1' }])
    } catch (e: any) { setProblem(e?.message || 'No product has that barcode.') }
    setCode(''); box1.current?.focus()
  }
  const submit = async () => {
    setBusy(true); setProblem('')
    try {
      const r = await api.post('/api/salon-retail-stock/count', { locationId: placeId, counts: rows.map((x) => ({ productId: x.id, counted: Number(x.counted) || 0 })) })
      setDone(r.changed.length ? `Counted ${r.counted}. ${r.changed.length} count${r.changed.length === 1 ? '' : 's'} corrected.` : `Counted ${r.counted}. Every count matched.`); setRows([]); toast.success('Count saved')
    } catch (e: any) { setProblem(e?.message || 'The count did not save.') } finally { setBusy(false) }
  }
  if (!mayChange) return <p className="text-gray-600 dark:text-slate-300">Counting stock needs the right to change inventory.</p>
  return (
    <section className={box + ' space-y-3'}>
      <p className="text-sm text-gray-700 dark:text-slate-300">Scan each product as you count (a scanner types the code and presses Enter), or type the code. Each scan adds one. Change a number if you counted a pile by hand.</p>
      {places.length > 1 && <Field label="Place being counted"><select value={placeId} onChange={(e) => setPlaceId(e.target.value)} className={inputCls}>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      <div className="flex gap-2"><div className="relative flex-1"><ScanLine className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" aria-hidden="true" /><input ref={box1} autoFocus aria-label="Scan a barcode" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scan() } }} placeholder="Scan or type a barcode, then Enter" className={inputCls + ' pl-9'} /></div><Button variant="secondary" onClick={scan} disabled={!code.trim()}>Add</Button></div>
      {problem && <div role="alert" className={alertCls}>{problem}</div>}
      {done && <p role="status" className="text-sm text-green-800 dark:text-green-300">{done}</p>}
      {rows.length > 0 && (
        <>
          <ul className="divide-y divide-gray-100 text-sm text-gray-900 dark:divide-slate-800 dark:text-slate-100">
            {rows.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-1.5"><span>{r.label}</span><span className="flex items-center gap-2"><input inputMode="numeric" aria-label={`Counted: ${r.label}`} value={r.counted} onChange={(e) => setRows((p) => p.map((x) => x.id === r.id ? { ...x, counted: e.target.value } : x))} className={inputCls + ' w-20'} /><button className="text-gray-600 underline dark:text-slate-300" onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))}>Remove</button></span></li>)}
          </ul>
          <div className="flex justify-end"><Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save the count'}</Button></div>
        </>
      )}
    </section>
  )
}
