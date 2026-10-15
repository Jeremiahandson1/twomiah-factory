import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import api, { Order, type RateQuote, type RefundQuote } from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { money, formatDate, statusColor } from '../lib/format'
import { usePermissions } from '../shared'

// The SERVER's table (backend routes/orders.ts NEXT_STATUS) — tests/store/qa-t1 holds the two equal. 'pending' was
// missing here, so an unpaid order offered nothing; marking it paid or cancelling it is the owner's and manager's.
const NEXT_STATUS: Record<string, string[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'shipped', 'cancelled', 'refunded'],
  fulfilled: ['shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
}

// The server's rule (backend routes/orders.ts isFulfilment), so the buttons offered are the ones it
// accepts: moving a PAID order along the floor is orders:update, which staff hold; anything that changes
// whether it was paid for — cancel, refund, shipping an unpaid order — is orders:refund.
const COUNTED = ['paid', 'fulfilled', 'shipped', 'delivered']
const FULFILMENT = ['fulfilled', 'shipped', 'delivered']
// Shipping is a move like any other: offered only where the table allows it (a cancelled or refunded order is closed).
const canShip = (from: string) => from === 'shipped' || (NEXT_STATUS[from] || []).includes('shipped')
// The server's hasParcel (backend routes/orders.ts): tracking belongs to an order going out or gone out — never to one
// pending, cancelled, or refunded before it left.
const hasParcel = (o: Order) => COUNTED.includes(o.status) || (o.status === 'refunded' && !!o.fulfilledAt)
// What the button does, in its own words: from a paid order, refunding and cancelling send money back.
const statusAction = (from: string, to: string, partlyRefunded = false) =>
  COUNTED.includes(from) && to === 'refunded' ? (partlyRefunded ? 'Refund the rest' : 'Refund everything') : COUNTED.includes(from) && to === 'cancelled' ? 'Cancel and refund' : `Mark ${to}`
const moveNeeds = (from: string, to: string) => (COUNTED.includes(from) && FULFILMENT.includes(to)) ? 'orders:update' : 'orders:refund'
/** Offer the control unless the permission list has arrived and says no. */
function useMay() {
  const { known, can } = usePermissions()
  return (permission: string) => !known || can(permission)
}

export default function OrderDetailPage() {
  const { id } = useParams()
  const { toast } = useToast()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const may = useMay()
  const [refunding, setRefunding] = useState(false)

  const load = () => api.getOrder(id!).then((o) => {
    setOrder(o); setCarrier(o.trackingCarrier || ''); setTracking(o.trackingNumber || ''); setNote(o.internalNote || '')
  }).catch(() => toast('Could not load order', 'error')).finally(() => setLoading(false))

  useEffect(() => { load() }, [id])

  // Someone else moved this order while it was open (409 order_changed): nothing of ours was applied, so show the
  // order as it now stands rather than the buttons for a status it has left.
  const failed = (e: any) => { toast(e?.message || 'Failed', 'error'); if (e?.code === 'order_changed' || e?.code === 'no_parcel' || e?.code === 'refund_failed') load() }
  const setStatus = async (status: string) => {
    // Refunding — or cancelling — a paid order sends the shopper's money back through the provider (Stripe), so it is
    // asked once, with the amount, the way any refund screen asks. (Owner's decision, 10/12)
    const paid = !!order && COUNTED.includes(order.status) && (status === 'refunded' || status === 'cancelled')
    if (paid && order) {
      // After part refunds, only what is left goes back (and only the units not refunded yet go back on the shelf).
      const amount = money(order.totalCents - (order.refundedCents || 0), order.currency)
      const ask = order.providerPaymentId
        ? `${status === 'refunded' ? 'Refund' : 'Cancel this order and refund'} ${amount} to the customer's card? The stock goes back on the shelf.`
        : `${status === 'refunded' ? 'Mark this order refunded' : 'Cancel this order'}? There is no card payment on record, so no money is sent back from here. The stock goes back on the shelf.`
      if (!confirm(ask)) return
    }
    try {
      const { order: o, refund } = await api.setOrderStatus(id!, status)
      setOrder((prev) => prev ? { ...prev, ...o } : prev)
      if (refund?.kind === 'refunded') toast(refund.alreadyRefunded ? `Marked ${status} — the payment had already been refunded` : `${status === 'refunded' ? 'Refunded' : 'Cancelled and refunded'} ${money(refund.amountCents ?? (order ? order.totalCents - (order.refundedCents || 0) : o.totalCents), o.currency)} to the customer's card`)
      else if (refund) toast(`Marked ${status}. ${refund.note}`, 'error')
      else toast(`Marked ${status}`)
      // The refund history gained a row: read the order whole.
      if (refund) load()
    } catch (e: any) { failed(e) }
  }
  const retryRefund = async () => {
    try {
      const { order: o } = await api.retryRefund(id!)
      setOrder((prev) => prev ? { ...prev, ...o } : prev)
      toast(o.refundPendingAt ? 'The refund is still under way' : `Refunded ${money(o.totalCents, o.currency)} to the customer's card`)
    } catch (e: any) { failed(e); load() }
  }
  const saveFulfillment = async (markShipped: boolean) => {
    try {
      // Only the boxes this person changed: one adding the tracking number while another wrote the note used to send
      // both, and the second save blanked the first one's.
      const body: { trackingCarrier?: string; trackingNumber?: string; internalNote?: string; markShipped?: boolean } = { markShipped }
      if (carrier !== (order?.trackingCarrier || '')) body.trackingCarrier = carrier
      if (tracking !== (order?.trackingNumber || '')) body.trackingNumber = tracking
      if (note !== (order?.internalNote || '')) body.internalNote = note
      const o = await api.setFulfillment(id!, body)
      setOrder((prev) => prev ? { ...prev, ...o } : prev)
      // The boxes now show the order as saved — the other person's fields included — so they are the next baseline.
      setCarrier(o.trackingCarrier || ''); setTracking(o.trackingNumber || ''); setNote(o.internalNote || '')
      toast(markShipped ? 'Marked shipped' : 'Saved')
    } catch (e: any) { failed(e) }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
  if (!order) return <p className="text-gray-500 dark:text-slate-400">Order not found.</p>

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/orders" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-slate-200"><ArrowLeft className="h-4 w-4" /> Orders</Link>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{order.orderNumber || 'Pending order'}</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">{formatDate(order.createdAt)} · {order.provider}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusColor(order.status)}`}>{order.status}</span>
      </div>

      {/* Where the shopper's money stands, once a refund has been asked for. */}
      {order.refundPendingAt && (
        <div className={`rounded-lg border p-4 text-sm ${order.refundError ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200'}`}>
          {order.refundError
            ? <>The refund has not gone through yet, so nothing has been restocked. {order.refundError}</>
            : <>A refund is being sent back to the customer's card. It finishes on its own if it was interrupted.</>}
          {order.refundError && may('orders:refund') && (
            <button onClick={retryRefund} className="btn-secondary text-xs ml-3">Try the refund again</button>
          )}
        </div>
      )}
      {!order.refundPendingAt && order.refundedAt && (
        <p className="text-sm text-gray-600 dark:text-slate-300">Money returned to the customer's card on {formatDate(order.refundedAt)}.</p>
      )}

      {/* Status actions — only the moves this person may make */}
      {(NEXT_STATUS[order.status] || []).some((s) => may(moveNeeds(order.status, s))) && (
        <div className="card p-4 flex flex-wrap gap-2">
          {NEXT_STATUS[order.status].filter((s) => may(moveNeeds(order.status, s))).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className="btn-secondary text-xs">{statusAction(order.status, s, (order.refundedCents || 0) > 0)}</button>
          ))}
          {/* Part of it: chosen units, the shipping, or an amount (RefundDialog). */}
          {COUNTED.includes(order.status) && !order.refundPendingAt && (order.refundedCents || 0) < order.totalCents && may('orders:refund') && (
            <button onClick={() => setRefunding(true)} className="btn-secondary text-xs">Refund items…</button>
          )}
        </div>
      )}

      {/* Items */}
      <div className="card">
        <h2 className="px-5 py-3 font-semibold text-gray-900 border-b dark:text-slate-100">Items</h2>
        <div className="divide-y">
          {order.items?.map((it) => (
            <div key={it.id} className="flex items-center gap-3 px-5 py-3">
              <div className="h-12 w-12 rounded bg-gray-100 overflow-hidden flex-shrink-0 dark:bg-slate-800 dark:text-slate-100">
                {it.imageUrl && <img src={it.imageUrl} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate dark:text-slate-100">{it.productName}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400">{it.variantName} · {it.sku} · × {it.quantity}{(it.refundedQuantity || 0) > 0 ? ` · ${it.refundedQuantity === it.quantity ? 'refunded' : `${it.refundedQuantity} refunded`}` : ''}</div>
              </div>
              <div className="text-sm font-medium">{money(it.lineTotalCents, order.currency)}</div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t space-y-1 text-sm">
          <Row label="Subtotal" value={money(order.subtotalCents, order.currency)} />
          <Row label="Shipping" value={money(order.shippingCents, order.currency)} />
          <Row label="Tax" value={money(order.taxCents, order.currency)} />
          {order.discountCents > 0 && <Row label="Discount" value={`−${money(order.discountCents, order.currency)}`} />}
          <Row label="Total" value={money(order.totalCents, order.currency)} bold />
          {(order.refundedCents || 0) > 0 && <Row label="Refunded" value={`−${money(order.refundedCents || 0, order.currency)}`} />}
          {(order.refundedCents || 0) > 0 && <Row label="Net" value={money(order.totalCents - (order.refundedCents || 0), order.currency)} bold />}
        </div>
      </div>

      <RefundHistory order={order} onChanged={(o) => setOrder(o)} />
      {refunding && <RefundDialog order={order} onClose={() => setRefunding(false)} onDone={(o) => { setRefunding(false); setOrder(o) }} />}

      {/* Customer */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-2 dark:text-slate-100">Customer</h2>
          <p className="text-sm text-gray-700 dark:text-slate-200">{order.customerName || '—'}</p>
          <p className="text-sm text-gray-500 dark:text-slate-400">{order.customerEmail}</p>
          {order.customerPhone && <p className="text-sm text-gray-500 dark:text-slate-400">{order.customerPhone}</p>}
        </div>
        {(order.supplierStatus || order.supplierOrderId) && (
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 mb-2 dark:text-slate-100">Supplier</h2>
            <div className="text-sm text-gray-600 space-y-1 dark:text-slate-300">
              <div>Status: <span className={"font-medium " + (order.supplierStatus === 'error' ? 'text-red-600 dark:text-red-400' : order.supplierStatus === 'placed' || order.supplierStatus === 'shipped' ? 'text-green-700 dark:text-green-300' : 'text-yellow-700 dark:text-yellow-300')}>{order.supplierStatus}</span></div>
              {order.supplierOrderId && <div>Supplier order: <span className="font-mono text-xs">{order.supplierOrderId}</span></div>}
              {order.supplierCostCents != null && <div>Supplier cost: ${(order.supplierCostCents / 100).toFixed(2)} <span className="text-gray-500 dark:text-slate-400">(margin ${((order.totalCents - order.supplierCostCents) / 100).toFixed(2)})</span></div>}
              {order.supplierError && <div className="text-red-600 text-xs dark:text-red-400">{order.supplierError}</div>}
            </div>
            {/* Forwarding and holding run on the supplier connection — the owner's (integrations:update). */}
            {!order.supplierOrderId && may('integrations:update') && (
              <div className="flex gap-2 mt-3">
                <button className="btn-primary text-xs" onClick={async () => { try { const r: any = await api.forwardOrderToSupplier(order.id); toast(r?.ok ? 'Sent to supplier' : (r?.note || 'Could not forward'), r?.ok ? undefined : 'error'); load() } catch (e: any) { toast(e?.message || 'Could not forward', 'error') } }}>Send to supplier now</button>
                {order.supplierStatus !== 'hold' && <button className="btn-secondary text-xs" onClick={async () => { await api.holdSupplierOrder(order.id); toast('Held — will not auto-forward'); load() }}>Hold</button>}
              </div>
            )}
          </div>
        )}

        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-2 dark:text-slate-100">Ship to</h2>
          {order.shippingAddress ? (
            <address className="not-italic text-sm text-gray-600 leading-relaxed dark:text-slate-300">
              {order.shippingAddress.line1}<br />
              {order.shippingAddress.line2 && <>{order.shippingAddress.line2}<br /></>}
              {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}<br />
              {order.shippingAddress.country}
            </address>
          ) : <p className="text-sm text-gray-500 dark:text-slate-400">No shipping address</p>}
        </div>
      </div>

      {/* Fulfillment */}
      <div className="card p-5 space-y-3">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Fulfillment</h2>
        {/* Tracking only where there is a parcel (hasParcel). An order that never went out shows the boxes only while
            they hold something, so a value saved before the rule can still be cleared. */}
        {hasParcel(order) || order.trackingCarrier || order.trackingNumber ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label">Carrier</label><input className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="USPS, UPS, FedEx…" /></div>
            <div><label className="label">Tracking number</label><input className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-slate-400">This order is {order.status} and never went out, so it has no tracking.</p>
        )}
        <div><label className="label">Internal note</label><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {may('orders:update') && (
          <div className="flex gap-2">
            <button onClick={() => saveFulfillment(false)} className="btn-secondary">Save</button>
            {canShip(order.status) && may(moveNeeds(order.status, 'shipped')) && (
              <button onClick={() => saveFulfillment(true)} className="btn-primary">Save & mark shipped</button>
            )}
          </div>
        )}
      </div>
      {/* Shipping label */}
      <LabelPanel orderId={id!} order={order} onBought={load} />
    </div>
  )
}

// Buy a carrier label for this order. Hidden entirely when no carrier account
// is connected — the manual tracking fields above still work on their own.
function LabelPanel({ orderId, order, onBought }: { orderId: string; order: Order; onBought: () => void }) {
  const { toast } = useToast()
  const [connected, setConnected] = useState<boolean | null>(null)
  const [rates, setRates] = useState<RateQuote[] | null>(null)
  const [busy, setBusy] = useState(false)
  const may = useMay()
  // Buying marks the order shipped, so it is the same move as "Mark shipped" (backend routes/shipping.ts).
  const mayBuy = may('shipping:label') && canShip(order.status) && may(moveNeeds(order.status, 'shipped'))

  useEffect(() => {
    api.shippingConfig().then((c) => setConnected(c.connected)).catch(() => setConnected(false))
  }, [])

  if (connected === false && !order.labelUrl) return null

  const loadRates = async () => {
    setBusy(true)
    try {
      setRates(await api.orderRates(orderId))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not get rates', 'error')
    } finally {
      setBusy(false)
    }
  }

  const buy = async (rateId?: string) => {
    // The print tab is opened NOW, inside the click: a browser lets a page open a tab only while the click is fresh,
    // and buying the label takes a few seconds — opened afterwards, it is blocked as a pop-up. It is pointed at the
    // label once there is one, and closed if the purchase fails. "Print label" below stays as the way back to it.
    const printTab = window.open('', '_blank')
    setBusy(true)
    try {
      const res = await api.buyLabel(orderId, { rateId, markShipped: true })
      // A note means the label was bought but the order was not marked shipped (someone cancelled or refunded it).
      if (res.note) toast(res.note, 'error')
      else toast('Label bought — customer emailed')
      if (printTab) printTab.location.href = res.label.labelUrl
      onBought()
    } catch (err: any) {
      printTab?.close()
      toast(err instanceof Error ? err.message : 'Could not buy label', 'error')
      // Refused because of where the order stands — a label already bought or being bought from another screen, or
      // the order moved: show it as it is now.
      if (err?.status >= 400 && err?.status < 500) onBought()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-semibold text-gray-900 dark:text-slate-100">Shipping label</h2>

      {order.labelUrl ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            {order.trackingCarrier} {order.trackingNumber}
            {order.labelCostCents != null && <span className="text-gray-500 dark:text-slate-400"> · ${(order.labelCostCents / 100).toFixed(2)}</span>}
          </p>
          <a href={order.labelUrl} target="_blank" rel="noreferrer" className="btn-secondary">Print label</a>
        </div>
      ) : !order.shippingAddress ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">This order has no shipping address, so a label cannot be bought.</p>
      ) : !canShip(order.status) ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">This order is {order.status}, so no label can be bought for it.</p>
      ) : !mayBuy ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">This order is not paid, so shipping it is for a manager or the owner.</p>
      ) : (
        <>
          {!rates ? (
            <button onClick={loadRates} disabled={busy} className="btn-secondary">{busy ? 'Checking…' : 'Get rates'}</button>
          ) : rates.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">No rates came back for this address and parcel.</p>
          ) : (
            <div className="space-y-2">
              {rates.map((r) => (
                <div key={r.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-700 dark:text-slate-200">
                    {r.carrier} {r.service}
                    {r.estimatedDays ? <span className="text-gray-500 dark:text-slate-400"> · {r.estimatedDays} days</span> : null}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-sm font-medium">${(r.amountCents / 100).toFixed(2)}</span>
                    <button onClick={() => buy(r.id)} disabled={busy} className="btn-primary">Buy</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const toCents = (s: string) => { const n = Number(String(s).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN }
const dollars = (cents: number) => (cents / 100).toFixed(2)

/**
 * REFUND PART OF AN ORDER. (E2E Run 2: Refund could only send back the whole order.) Pick how many of each item — and
 * the shipping, if that goes back too — and the server (POST /refunds/quote) says what they are worth: each unit's share
 * of what was paid, discount and tax included. The amount can be changed; the button says exactly what will be sent.
 */
function RefundDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const { toast } = useToast()
  const lines = (order.items || []).map((it) => ({ it, left: it.quantity - (it.refundedQuantity || 0) })).filter((l) => l.left > 0)
  // What was typed, as typed: a figure out of range is pointed out, never quietly replaced by another one.
  const [qty, setQty] = useState<Record<string, string>>({})
  const [shipping, setShipping] = useState(false)
  const [restock, setRestock] = useState(true)
  const [reason, setReason] = useState('')
  const [quote, setQuote] = useState<RefundQuote | null>(null)
  const [amount, setAmount] = useState('')
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const typed = lines.map(({ it, left }) => {
    const raw = (qty[it.id] ?? '').trim()
    const n = raw === '' ? 0 : Number(raw)
    return { it, n, bad: !Number.isInteger(n) || n < 0 || n > left ? `Enter a whole number from 0 to ${left} for ${it.productName}.` : '' }
  })
  const badQty = typed.find((t) => t.bad)?.bad || ''
  const items = typed.filter((t) => !t.bad && t.n > 0).map((t) => ({ orderItemId: t.it.id, quantity: t.n }))
  const ask = { items, shippingCents: shipping ? (quote?.shippingLeftCents ?? 0) : 0, restock }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // Ask the server what the chosen units are worth, every time the choice changes.
  useEffect(() => {
    let live = true
    if (badQty) return
    api.quoteRefund(order.id, ask).then((q) => {
      if (!live) return
      setQuote(q); setProblem('')
      if (!edited) setAmount(q.suggestedCents > 0 ? dollars(q.suggestedCents) : '')
    }).catch((e: any) => { if (live) setProblem(e?.message || 'Could not work out the refund') })
    return () => { live = false }
  }, [JSON.stringify(qty), shipping]) // eslint-disable-line react-hooks/exhaustive-deps

  const cents = toCents(amount)
  const valid = !problem && !badQty && Number.isFinite(cents) && cents > 0 && (!quote || cents <= quote.maxCents)
  const submit = async () => {
    if (!valid) return
    const what = order.providerPaymentId ? `Send ${money(cents, order.currency)} back to the customer's card?` : `Record a refund of ${money(cents, order.currency)}? There is no card payment on record, so no money is sent back from here.`
    if (!confirm(`${what}${items.length && restock ? ' The refunded units go back on the shelf.' : ''}`)) return
    setBusy(true)
    try {
      const r = await api.refundPart(order.id, { ...ask, amountCents: cents, ...(reason.trim() ? { reason: reason.trim() } : {}) })
      if (r.refund?.kind === 'refunded') toast(`Refunded ${money(cents, order.currency)} to the customer's card${r.restocked ? ` — ${r.restocked} unit${r.restocked === 1 ? '' : 's'} back in stock` : ''}`)
      else if (r.refund && 'note' in r.refund) toast(`Refund recorded. ${r.refund.note}`, 'error')
      onDone(r.order)
    } catch (e: any) {
      toast(e?.message || 'The refund did not go through', 'error')
      setBusy(false)
      // Refused or still waiting, the order changed either way: show it as it stands.
      if (e?.status === 502 || e?.code === 'order_changed' || e?.code === 'refund_in_progress') { onClose(); onDone(await api.getOrder(order.id)) }
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Refund">
      <div className="fixed inset-0 bg-black/60" onClick={() => { if (!busy) onClose() }} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-lg rounded-xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
            <h3 className="text-lg font-semibold">Refund</h3>
            <button onClick={onClose} disabled={busy} className="rounded p-1 text-gray-500 hover:text-gray-700 dark:text-slate-300 dark:hover:text-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-4 px-6 py-5">
            {lines.length > 0 ? (
              <div className="space-y-2">
                {lines.map(({ it, left }) => (
                  <div key={it.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{it.productName}</div>
                      <div className="text-xs text-gray-500 dark:text-slate-400">{it.variantName} · {money(it.unitPriceCents, order.currency)} each · {left} of {it.quantity} can be refunded</div>
                    </div>
                    <label className="sr-only" htmlFor={`rq-${it.id}`}>How many of {it.productName}</label>
                    <input id={`rq-${it.id}`} type="number" min={0} max={left} inputMode="numeric" className="input w-20 text-right"
                      value={qty[it.id] ?? ''} placeholder="0"
                      onChange={(e) => { const v = e.target.value; setEdited(false); setQty((prev) => ({ ...prev, [it.id]: v })) }} />
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-600 dark:text-slate-300">Every item has been refunded. What is left is shipping or an amount of your choosing.</p>}

            {quote && quote.shippingLeftCents > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
                <input type="checkbox" checked={shipping} onChange={(e) => { setEdited(false); setShipping(e.target.checked) }} />
                Refund the shipping ({money(quote.shippingLeftCents, order.currency)})
              </label>
            )}
            {items.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
                <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
                Put the refunded units back in stock
              </label>
            )}

            <div>
              <label className="label" htmlFor="refund-amount">Amount to refund</label>
              <input id="refund-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => { setEdited(true); setAmount(e.target.value) }} placeholder="0.00" />
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                {quote ? <>Suggested {money(quote.suggestedCents, order.currency)} for what is chosen · at most {money(quote.maxCents, order.currency)} can still be refunded.</> : 'Working it out…'}
              </p>
              {quote && Number.isFinite(cents) && cents > quote.maxCents && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">That is more than is left to refund.</p>}
            </div>
            <div>
              <label className="label" htmlFor="refund-reason">Reason (optional, for your records)</label>
              <input id="refund-reason" className="input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Damaged in transit, wrong size…" />
            </div>
            {(badQty || problem) && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{badQty || problem}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
            <button onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
            <button onClick={submit} disabled={busy || !valid} className="btn-primary">{busy ? 'Refunding…' : valid ? `Refund ${money(cents, order.currency)}` : 'Refund'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const REFUND_STATE: Record<string, { label: string; cls: string }> = {
  refunded: { label: 'Sent back', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' },
  recorded: { label: 'Recorded only', cls: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200' },
  pending: { label: 'Waiting on the provider', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  failed: { label: 'Refused — nothing sent', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
}

function RefundHistory({ order, onChanged }: { order: Order; onChanged: (o: Order) => void }) {
  const { toast } = useToast()
  const may = useMay()
  const refunds = order.refunds || []
  if (!refunds.length) return null
  const names = new Map((order.items || []).map((i) => [i.id, i.productName]))
  const retry = async (refundId: string) => {
    try { const r = await api.retryPartRefund(order.id, refundId); onChanged(r.order); toast(r.refund?.kind === 'refunded' ? 'Refund sent' : 'Refund recorded') }
    catch (e: any) { toast(e?.message || 'The refund still has not gone through', 'error'); onChanged(await api.getOrder(order.id)) }
  }
  return (
    <div className="card">
      <h2 className="border-b px-5 py-3 font-semibold text-gray-900 dark:text-slate-100">Refunds</h2>
      <div className="divide-y">
        {refunds.map((r) => {
          const st = REFUND_STATE[r.status] || REFUND_STATE.recorded
          const what = [...r.items.map((l) => `${l.quantity} × ${names.get(l.orderItemId) || 'item'}`), ...(r.shippingCents > 0 ? [`shipping ${money(r.shippingCents, order.currency)}`] : [])]
          return (
            <div key={r.id} className="space-y-1 px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-900 dark:text-slate-100">{money(r.amountCents, order.currency)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
              </div>
              <div className="text-xs text-gray-600 dark:text-slate-300">
                {formatDate(r.createdAt)}{r.createdByName ? ` · ${r.createdByName}` : ''}{what.length ? ` · ${what.join(', ')}` : ''}{r.items.length ? (r.restock ? ' · restocked' : ' · not restocked') : ''}
              </div>
              {r.reason && <div className="text-xs text-gray-600 dark:text-slate-300">{r.reason}</div>}
              {r.error && <div className="text-xs text-red-700 dark:text-red-300">{r.error}</div>}
              {r.status === 'pending' && may('orders:refund') && (
                <button onClick={() => retry(r.id)} className="btn-secondary text-xs">Try again</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'font-semibold text-gray-900 pt-1 dark:text-slate-200' : 'text-gray-600 dark:text-slate-300'} dark:text-slate-100`}><span>{label}</span><span>{value}</span></div>
}
