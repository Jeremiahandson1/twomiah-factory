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
import { CustomerPicker, type PickedCustomer } from './CustomerPicker'
import { ShipToFields, EMPTY_SHIP_TO, shipToProblem, type ShipToForm } from './ShipToFields'

interface Option { sku: string; label: string; priceCents: number }
interface Line { sku: string; quantity: string }

export default function NewOrderPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const mayCreate = useMayWrite('orders:create')
  const [options, setOptions] = useState<Option[]>([])
  const [pickup, setPickup] = useState(false)
  const [chosen, setChosen] = useState<PickedCustomer | null>(null)
  const [lines, setLines] = useState<Line[]>([{ sku: '', quantity: '1' }])
  const [delivery, setDelivery] = useState<'ship' | 'pickup'>('ship')
  // Where it goes (live test 11/11: a phone order had no address, so no label): the customer's saved one, changeable.
  const [shipTo, setShipTo] = useState<ShipToForm>(EMPTY_SHIP_TO)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // How it is paid: a link emailed to pay online, or paid already in person (store live test 11/10 — Shopify's "Mark as paid").
  const [paidBy, setPaidBy] = useState<'link' | 'cash' | 'check' | 'card' | 'other'>('link')

  useEffect(() => {
    api.get('/api/admin/products').then((r) => setOptions(listOf<any>(r).filter((p) => p.status === 'active').flatMap((p: any) => (p.variants || []).map((v: any) => ({
      sku: v.sku, label: `${p.name}${v.name && v.name !== p.name && v.name !== 'Default' ? ' — ' + v.name : ''} (${v.sku})`, priceCents: v.priceCents,
    }))))).catch(() => setOptions([]))
    api.get('/api/admin/settings').then((s: any) => setPickup(!!s?.pickupEnabled)).catch(() => setPickup(false))
  }, [])

  // Picking the customer fills the address from their record (what they had typed is kept when they have none).
  useEffect(() => {
    if (!chosen) return
    let live = true
    api.get(`/api/contacts/${encodeURIComponent(chosen.id)}`).then((c: any) => {
      if (!live || !c?.address) return
      setShipTo({ name: c.name || '', line1: c.address || '', line2: '', city: c.city || '', state: c.state || '', postalCode: c.zip || '', country: 'US', phone: c.phone || '' })
    }).catch(() => {})
    return () => { live = false }
  }, [chosen])

  const listTotal = useMemo(() => lines.reduce((a, l) => a + (options.find((o) => o.sku === l.sku)?.priceCents || 0) * (Number(l.quantity) || 0), 0), [lines, options])
  const setLine = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))

  const submit = async () => {
    setError(null)
    if (!chosen) { setError('Choose the customer.'); return }
    if (!chosen.email && paidBy === 'link') { setError(`${chosen.name} has no email address to send the link to pay to.`); return }
    const items = lines.filter((l) => l.sku).map((l) => ({ sku: l.sku, quantity: Number(l.quantity) }))
    if (!items.length) { setError('Add at least one item.'); return }
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1)) { setError('Each quantity is a whole number, 1 or more.'); return }
    // Paid in person and shipped: the address is needed now (no payment page will ask for it). A link to pay may leave it
    // for the customer to give.
    const typed = delivery === 'ship' && Object.entries(shipTo).some(([k, v]) => k !== 'country' && String(v).trim())
    if (delivery === 'ship' && (typed || paidBy !== 'link')) { const p = shipToProblem(shipTo); if (p) { setError(p); return } }
    setSaving(true)
    try {
      const r = await api.post('/api/admin/draft-orders', {
        contactId: chosen.id, items, delivery, note: note.trim() || null, ...(paidBy !== 'link' ? { paidInPerson: paidBy } : {}),
        ...(delivery === 'ship' && !shipToProblem(shipTo) ? { shippingAddress: { ...shipTo, state: shipTo.state.trim().toUpperCase(), country: shipTo.country.trim().toUpperCase() || 'US' } } : {}),
      }) as { order: { id: string; totalCents: number; currency: string }; sent: boolean; group: { name: string } | null }
      toast.success(`Order made${r.group ? ` at ${r.group.name} prices` : ''} — ${cents(r.order.totalCents, r.order.currency)}${paidBy !== 'link' ? ', paid' : r.sent ? `, link to pay emailed to ${chosen.email}` : ''}`)
      navigate(`/crm/orders/${r.order.id}`)
    } catch (e) { setError(errorText(e, 'Could not make the order')) } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Link to="/crm/orders" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"><ArrowLeft className="h-4 w-4" /> Orders</Link>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">New order for a customer</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400">Priced at the customer's group prices when they are in one (Customer groups). They are emailed a link to pay, or it is marked paid when they paid in person.</p>
      </div>
      {!mayCreate ? <p className="text-sm text-gray-600 dark:text-slate-400">Making an order for a customer is for a manager or the owner.</p> : (
        <div className="card p-5 space-y-4">
          <div>
            <label className="label" htmlFor="no-cust">Customer</label>
            <CustomerPicker id="no-cust" label="Customer" value={chosen} onPick={setChosen} />
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
            <fieldset className="space-y-2">
              <legend className="label">Ship to</legend>
              <ShipToFields idPrefix="no" value={shipTo} onChange={setShipTo} />
              <p className="text-xs text-gray-600 dark:text-slate-400">{paidBy === 'link' ? 'Optional with a link to pay — the customer can give it when they pay.' : 'Needed to buy a shipping label.'}</p>
            </fieldset>
          )}
          <fieldset className="space-y-1">
            <legend className="label">Payment</legend>
            <label className="block text-sm text-gray-800 dark:text-slate-200"><input type="radio" name="no-pay" checked={paidBy === 'link'} onChange={() => setPaidBy('link')} /> Email them a link to pay online</label>
            <label className="block text-sm text-gray-800 dark:text-slate-200"><input type="radio" name="no-pay" checked={paidBy !== 'link'} onChange={() => setPaidBy('cash')} /> Already paid in person</label>
            {paidBy !== 'link' && (
              <select className="input w-auto" aria-label="How they paid" value={paidBy} onChange={(e) => setPaidBy(e.target.value as typeof paidBy)}>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="card">Card on our own terminal</option>
                <option value="other">Other</option>
              </select>
            )}
          </fieldset>
          <div><label className="label" htmlFor="no-note">Internal note</label><textarea id="no-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <PageError message={error} />
          <button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? 'Making the order…' : paidBy === 'link' ? 'Make order and email the link to pay' : 'Make order — paid'}</button>
        </div>
      )}
    </div>
  )
}
