// An order made for a customer at /crm/orders/new (2026-10-24, the store upgrade) — Shopify's draft order: choose the
// customer and the items; the server prices them at the customer's group prices (a wholesale customer pays wholesale),
// works out shipping (or none, for pickup) and tax, and emails the customer a link to pay. POST /api/admin/draft-orders
// is orders:create (server/crm/store/orders/draftOrders.ts), the manager's and the owner's; the Orders page offers this
// only to them.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useMayWrite, useToast } from '../../../../shared'
import { cents, listOf } from './lib'

interface Customer { id: string; name: string; email: string | null }
interface Option { sku: string; label: string; priceCents: number }
interface Line { sku: string; quantity: string }

export default function NewOrderPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const mayCreate = useMayWrite('orders:create')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [options, setOptions] = useState<Option[]>([])
  const [pickup, setPickup] = useState(false)
  const [contactId, setContactId] = useState('')
  const [lines, setLines] = useState<Line[]>([{ sku: '', quantity: '1' }])
  const [delivery, setDelivery] = useState<'ship' | 'pickup'>('ship')
  const [country, setCountry] = useState('US')
  const [state, setState] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/api/admin/orders/customers', { limit: '500' }).then((r) => setCustomers(listOf<Customer>(r))).catch(() => setCustomers([]))
    api.get('/api/admin/products').then((r) => setOptions(listOf<any>(r).filter((p) => p.status === 'active').flatMap((p: any) => (p.variants || []).map((v: any) => ({
      sku: v.sku, label: `${p.name}${v.name && v.name !== p.name && v.name !== 'Default' ? ' — ' + v.name : ''} (${v.sku})`, priceCents: v.priceCents,
    }))))).catch(() => setOptions([]))
    api.get('/api/admin/settings').then((s: any) => setPickup(!!s?.pickupEnabled)).catch(() => setPickup(false))
  }, [])

  const chosen = customers.find((c) => c.id === contactId) || null
  const listTotal = useMemo(() => lines.reduce((a, l) => a + (options.find((o) => o.sku === l.sku)?.priceCents || 0) * (Number(l.quantity) || 0), 0), [lines, options])
  const setLine = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))

  const submit = async () => {
    setError(null)
    if (!chosen) { setError('Choose the customer.'); return }
    if (!chosen.email) { setError(`${chosen.name} has no email address to send the order to.`); return }
    const items = lines.filter((l) => l.sku).map((l) => ({ sku: l.sku, quantity: Number(l.quantity) }))
    if (!items.length) { setError('Add at least one item.'); return }
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1)) { setError('Each quantity is a whole number, 1 or more.'); return }
    setSaving(true)
    try {
      const r = await api.post('/api/admin/draft-orders', {
        contactId: chosen.id, items, delivery, note: note.trim() || null,
        ...(delivery === 'ship' && (country.trim() || state.trim()) ? { shipTo: { country: country.trim().toUpperCase(), state: state.trim().toUpperCase() } } : {}),
      }) as { order: { id: string; totalCents: number; currency: string }; sent: boolean; group: { name: string } | null }
      toast.success(`Order made${r.group ? ` at ${r.group.name} prices` : ''} — ${cents(r.order.totalCents, r.order.currency)}${r.sent ? `, link to pay emailed to ${chosen.email}` : ''}`)
      navigate(`/crm/orders/${r.order.id}`)
    } catch (e) { setError(errorText(e, 'Could not make the order')) } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Link to="/crm/orders" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"><ArrowLeft className="h-4 w-4" /> Orders</Link>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">New order for a customer</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400">Priced at the customer's group prices when they are in one (Customer groups). They are emailed a link to pay.</p>
      </div>
      {!mayCreate ? <p className="text-sm text-gray-600 dark:text-slate-400">Making an order for a customer is for a manager or the owner.</p> : (
        <div className="card p-5 space-y-4">
          <div>
            <label className="label" htmlFor="no-cust">Customer</label>
            <select id="no-cust" className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Choose a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ' (no email)'}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <span className="label">Items</span>
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-center">
                <select className="input flex-1 min-w-[12rem]" aria-label={`Item ${i + 1}`} value={l.sku} onChange={(e) => setLine(i, 'sku', e.target.value)}>
                  <option value="">Choose a product…</option>
                  {options.map((o) => <option key={o.sku} value={o.sku}>{o.label} — {cents(o.priceCents)}</option>)}
                </select>
                <input className="input w-20" inputMode="numeric" aria-label={`Quantity of item ${i + 1}`} value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
                {lines.length > 1 && <button type="button" className="p-2 text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200" aria-label={`Remove item ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
              </div>
            ))}
            <button type="button" className="btn btn-secondary text-sm px-3 py-1.5" onClick={() => setLines([...lines, { sku: '', quantity: '1' }])}>Add item</button>
            <p className="text-xs text-gray-600 dark:text-slate-400">At the shop's prices: {cents(listTotal)}. The customer's group prices, shipping and tax are worked out when the order is made.</p>
          </div>
          {pickup && (
            <fieldset className="space-y-1">
              <legend className="label">Delivery</legend>
              <label className="mr-4 text-sm text-gray-800 dark:text-slate-200"><input type="radio" name="no-del" checked={delivery === 'ship'} onChange={() => setDelivery('ship')} /> Ship it</label>
              <label className="text-sm text-gray-800 dark:text-slate-200"><input type="radio" name="no-del" checked={delivery === 'pickup'} onChange={() => setDelivery('pickup')} /> Pickup</label>
            </fieldset>
          )}
          {delivery === 'ship' && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="no-c">Ship to country</label><input id="no-c" className="input" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} /></div>
              <div><label className="label" htmlFor="no-s">State</label><input id="no-s" className="input" maxLength={16} value={state} onChange={(e) => setState(e.target.value)} placeholder="WI" /></div>
            </div>
          )}
          <div><label className="label" htmlFor="no-note">Internal note</label><textarea id="no-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <PageError message={error} />
          <button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? 'Making the order…' : 'Make order and email the link to pay'}</button>
        </div>
      )}
    </div>
  )
}
