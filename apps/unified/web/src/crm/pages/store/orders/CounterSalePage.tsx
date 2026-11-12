// Sell at the counter (parity tier 2 #12, Shopify POS; server crm/store/orders/counterSales.ts, POST /api/admin/counter-sales;
// feature store_counter, not ready). Type or scan a product — a barcode scanner on the computer types the code and Enter, which
// adds the exact SKU or barcode at once — the server prices the sale (the store's prices and tax), and "Record sale" makes the
// order paid in person and handed over, with the stock off. Nothing is charged here: cash, or a card on the shop's own machine.
// "Sold by" credits the sale to someone (Shopify POS's attributed staff; Store › Sales › Sales by staff): the person ringing it up
// unless another is chosen, and a line can be credited to someone else.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Minus, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useAuth, useMayWrite, useToast } from '../../../../shared'
import { cents, listOf } from './lib'

interface Option { sku: string; barcode: string | null; label: string; priceCents: number; stock: number | null }
interface Line { sku: string; quantity: number; /** Credited to someone else than the sale's "Sold by"; '' = the same. */ soldBy?: string }
interface Preview { subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; currency: string }

export default function CounterSalePage() {
  const toast = useToast()
  const mayCreate = useMayWrite('orders:create')
  const [options, setOptions] = useState<Option[]>([])
  const [q, setQ] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [paidBy, setPaidBy] = useState<'cash' | 'card' | 'other'>('cash')
  const [email, setEmail] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Stock by location (store_locations): which location this counter is — the sale's units come off there. Remembered on this
  // device (the till stays where it is); a convenience only, so a blocked storage just asks again.
  const locationsOn = useAuth().hasFeature('store_locations')
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([])
  const [locationId, setLocationIdState] = useState(() => { try { return localStorage.getItem('counter-location') || '' } catch { return '' } })
  const setLocationId = (id: string) => { setLocationIdState(id); try { localStorage.setItem('counter-location', id) } catch { /* not kept */ } }
  useEffect(() => {
    if (!locationsOn) return
    api.get('/api/admin/stock-locations').then((r: any) => {
      const list = (r?.locations || []) as Array<{ id: string; name: string }>
      setLocations(list)
      if (list.length && !list.some((l) => l.id === locationId)) setLocationId(list[0].id)
    }).catch(() => setLocations([]))
  }, [locationsOn]) // eslint-disable-line react-hooks/exhaustive-deps
  const [done, setDone] = useState<{ number: string; total: string; receiptTo: string | null } | null>(null)
  // Who the sale is credited to: the team (GET /api/admin/counter-sales/staff), the person ringing it up first.
  const [staff, setStaff] = useState<Array<{ userId: string; name: string }>>([])
  const [soldBy, setSoldBy] = useState('')
  useEffect(() => {
    api.get('/api/admin/counter-sales/staff').then((r: any) => {
      setStaff(r?.data || [])
      setSoldBy((now) => now || r?.me || '')
    }).catch(() => setStaff([]))
  }, [])
  const picking = staff.length > 1

  useEffect(() => {
    api.get('/api/admin/products').then((r) => setOptions(listOf<any>(r).filter((p) => p.status === 'active').flatMap((p: any) => (p.variants || []).map((v: any) => ({
      sku: v.sku, barcode: v.gtin || null, priceCents: v.priceCents, stock: v.inventoryQty ?? null,
      label: `${p.name}${v.name && v.name !== p.name && v.name !== 'Default' ? ' — ' + v.name : ''}`,
    }))))).catch(() => setOptions([]))
  }, [])

  // The sale priced by the server (the store's tax), each time the items change.
  const items = useMemo(() => lines.filter((l) => l.quantity > 0).map((l) => ({ sku: l.sku, quantity: l.quantity })), [lines])
  useEffect(() => {
    if (!items.length) { setPreview(null); return }
    let live = true
    api.post('/api/admin/counter-sales', { items, paidBy, preview: true })
      .then((r: any) => { if (live) setPreview(r?.preview ?? null) })
      .catch((e) => { if (live) { setPreview(null); setError(errorText(e, 'The sale could not be priced')) } })
    return () => { live = false }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  const matches = q.trim() ? options.filter((o) => `${o.label} ${o.sku} ${o.barcode || ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []
  const add = (sku: string) => {
    setError(null)
    setLines((ls) => (ls.some((l) => l.sku === sku) ? ls.map((l) => (l.sku === sku ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { sku, quantity: 1 }]))
    setQ('')
  }
  // Enter: an exact SKU or barcode is added at once (what a scanner sends); else the one match, if there is only one.
  const onEnter = () => {
    const code = q.trim().toLowerCase()
    const exact = options.find((o) => o.sku.toLowerCase() === code || (o.barcode || '').toLowerCase() === code)
    if (exact) return add(exact.sku)
    if (matches.length === 1) return add(matches[0].sku)
    setError(matches.length ? 'More than one product matches. Pick one below.' : `Nothing matches "${q.trim()}".`)
  }
  const setQty = (sku: string, n: number) => setLines((ls) => ls.map((l) => (l.sku === sku ? { ...l, quantity: Math.max(0, n) } : l)).filter((l) => l.quantity > 0))

  const record = async () => {
    setError(null)
    if (!items.length) { setError('Add at least one item.'); return }
    setSaving(true)
    try {
      const sold = lines.filter((l) => l.quantity > 0).map((l) => ({ sku: l.sku, quantity: l.quantity, ...(picking && l.soldBy ? { soldBy: l.soldBy } : {}) }))
      const r = await api.post('/api/admin/counter-sales', { items: sold, paidBy, email: email.trim() || null, ...(picking && soldBy ? { soldBy } : {}), ...(locationsOn && locationId ? { locationId } : {}) }) as { order: { orderNumber: string; totalCents: number; currency: string }; receiptTo: string | null }
      setDone({ number: r.order.orderNumber, total: cents(r.order.totalCents, r.order.currency), receiptTo: r.receiptTo })
      toast.success(`Sale recorded — ${cents(r.order.totalCents, r.order.currency)}`)
      setLines([]); setEmail(''); setPreview(null)
    } catch (e) { setError(errorText(e, 'The sale could not be recorded')) } finally { setSaving(false) }
  }

  const byS = new Map(options.map((o) => [o.sku, o]))
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Link to="/crm/orders" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"><ArrowLeft className="h-4 w-4" /> Orders</Link>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Sell at the counter</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400">Ring up a sale in the shop. It is recorded as paid and handed over, and the stock comes off. Nothing is charged here: take cash, or the card on your own machine.</p>
      </div>
      {!mayCreate ? <p className="text-sm text-gray-600 dark:text-slate-400">Recording a sale is for a manager or the owner.</p> : (
        <div className="card p-5 space-y-4">
          {done && (
            <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
              Sale {done.number} recorded — {done.total}.{done.receiptTo ? ` Receipt emailed to ${done.receiptTo}.` : ''}
            </div>
          )}
          <div>
            <label className="label" htmlFor="cs-q">Add a product</label>
            <input id="cs-q" className="input" autoFocus placeholder="Name, SKU, or scan the barcode" value={q}
              onChange={(e) => { setQ(e.target.value); setDone(null) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }} />
            {matches.length > 0 && (
              <ul className="mt-1 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
                {matches.map((o) => (
                  <li key={o.sku}><button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800" onClick={() => add(o.sku)}>
                    <span>{o.label} <span className="text-gray-600 dark:text-slate-400">({o.sku})</span></span><span>{cents(o.priceCents)}{o.stock != null ? ` · ${o.stock} in stock` : ''}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </div>

          {lines.length > 0 && (
            <ul className="divide-y divide-gray-200 dark:divide-slate-700">
              {lines.map((l) => {
                const o = byS.get(l.sku)
                return (
                  <li key={l.sku} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm text-gray-900 dark:text-slate-100">
                    <span>{o?.label || l.sku}</span>
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {picking && (
                        <select aria-label={`Who sold ${o?.label || l.sku}`} className="input w-auto py-1 text-xs" value={l.soldBy || ''} onChange={(e) => setLines((ls) => ls.map((x) => (x.sku === l.sku ? { ...x, soldBy: e.target.value } : x)))}>
                          <option value="">Sold by: same</option>
                          {staff.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                        </select>
                      )}
                      <button type="button" className="rounded p-1 text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label={`One fewer ${o?.label || l.sku}`} onClick={() => setQty(l.sku, l.quantity - 1)}><Minus className="h-4 w-4" /></button>
                      <span aria-label="Quantity">{l.quantity}</span>
                      <button type="button" className="rounded p-1 text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label={`One more ${o?.label || l.sku}`} onClick={() => setQty(l.sku, l.quantity + 1)}><Plus className="h-4 w-4" /></button>
                      <span className="w-20 text-right">{o ? cents(o.priceCents * l.quantity) : ''}</span>
                      <button type="button" className="p-1 text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200" aria-label={`Remove ${o?.label || l.sku}`} onClick={() => setQty(l.sku, 0)}><Trash2 className="h-4 w-4" /></button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {preview && (
            <dl className="grid grid-cols-2 gap-1 text-sm text-gray-900 dark:text-slate-100">
              <dt>Subtotal</dt><dd className="text-right">{cents(preview.subtotalCents, preview.currency)}</dd>
              {preview.discountCents > 0 && <><dt>Discount</dt><dd className="text-right">−{cents(preview.discountCents, preview.currency)}</dd></>}
              <dt>Tax</dt><dd className="text-right">{cents(preview.taxCents, preview.currency)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{cents(preview.totalCents, preview.currency)}</dd>
            </dl>
          )}

          {locationsOn && locations.length > 1 && (
            <label className="block text-sm text-gray-800 dark:text-slate-200">Selling at{' '}
              <select className="input ml-1 w-auto" value={locationId} onChange={(e) => setLocationId(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </label>
          )}
          {picking && (
            <label className="block text-sm text-gray-800 dark:text-slate-200">Sold by{' '}
              <select className="input ml-1 w-auto" value={soldBy} onChange={(e) => setSoldBy(e.target.value)}>{staff.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</select>
            </label>
          )}
          <fieldset className="space-y-1">
            <legend className="label">Paid by</legend>
            {(['cash', 'card', 'other'] as const).map((p) => (
              <label key={p} className="mr-4 text-sm text-gray-800 dark:text-slate-200"><input type="radio" name="cs-pay" checked={paidBy === p} onChange={() => setPaidBy(p)} /> {p === 'cash' ? 'Cash' : p === 'card' ? 'Card on our own machine' : 'Other'}</label>
            ))}
          </fieldset>
          <div>
            <label className="label" htmlFor="cs-email">Email a receipt (optional)</label>
            <input id="cs-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <PageError message={error} />
          <button type="button" className="btn btn-primary" disabled={saving || !items.length} onClick={record}>{saving ? 'Recording…' : preview ? `Record sale — ${cents(preview.totalCents, preview.currency)}` : 'Record sale'}</button>
        </div>
      )}
    </div>
  )
}
