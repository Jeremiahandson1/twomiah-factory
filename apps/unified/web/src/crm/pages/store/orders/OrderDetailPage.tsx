// Moved from templates/crm-store/frontend/src/pages/OrderDetailPage.tsx — one order at /crm/orders/:id: its status moves
// (by the server's table), the money back (a whole refund or a cancel, a part refund with its quote, Try again), the
// items and totals, the refund history, the customer, the supplier (forward / hold), fulfilment (tracking and the
// internal note, "Save & mark shipped") and the carrier label (rates → buy).
//
// Changes from the template:
//   · the calls are the unified server's (server/crm/store/orders): GET /api/admin/orders/:id answers the order itself
//     (was { order }); PATCH …/fulfillment the order itself (was { order }); POST …/refunds/quote the quote itself (was
//     { quote }); the status, refund and retry replies keep { order, refund }; GET /api/admin/shipping/orders/:id/rates
//     is { data, pagination }; the supplier's forward and hold answer { success: true, note? } (were { ok, note? }) and a
//     forward the supplier refuses is a 400 whose `error` is the note — the template read `ok` and would now have read
//     every forward as refused;
//   · a refusal's code rides on the thrown error's body (lib.ts codeOf): order_changed, no_parcel, refund_failed,
//     refund_unconfirmed and refund_in_progress reload the order. The 502 refund failures no longer carry the order, so
//     the page always reads it again after one (the template's whole-refund retry only reloaded by luck of a second
//     call); the over-the-total refusal no longer carries maxCents — its sentence names the figure, and is shown;
//   · the status, fulfilment and label replies carry the order without its items and refunds, so they are merged into the
//     order on screen (as the template did for status) — never replacing it, which emptied the item list;
//   · no native confirm(): refunding, cancelling and a part refund ask through the app's confirm dialog (useConfirm);
//   · Hold had no error handling (a refusal was an unhandled rejection and the toast still said "Held"); Forward and
//     Hold are now one request at a time and say what the server said;
//   · money and the supplier's cost: the supplier cost and margin show only where the reply carries supplierCostCents
//     (margin:read); the card-refund wording only where it carries providerPaymentId (orders:refund) — a seat without
//     them is never shown a guess. All money is integer cents shown as $x.xx (lib.ts cents) in the order's currency;
//   · the customer links to their contact page (/crm/contacts/:id) where the order carries one and the seat may open it;
//   · controls the seat cannot use are not shown: each status move asks what the server asks for it (orders:update for
//     moving a paid order along the floor, orders:refund for the rest), part refunds and Try again orders:refund,
//     fulfilment orders:update, the label shipping:label, forward / hold integrations:update;
//   · brand-coloured text (links, the highlighted figure) is text-orange-900 dark:text-orange-200, the only brand shades
//     that read at 4.5:1 for every company colour (scripts/check-contrast-measured.ts) — the template's
//     text-primary-600 fell under it for a yellow or lime brand;
//   · every ink has its dark partner (the totals rows carried two competing dark: classes; the back link's hover, the
//     line and rate prices had none), and the header and button rows wrap at phone width.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useConfirm, usePermissions, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { cents, codeOf, listOf, statusBadge, statusOf, type MoneyBack, type Order } from './lib'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

// The SERVER's table (server/crm/store/orders/rules.ts NEXT_STATUS): only these moves are offered.
const NEXT_STATUS: Record<string, string[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'shipped', 'cancelled', 'refunded'],
  fulfilled: ['shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
}

// The server's rule (rules.ts isFulfilment), so the buttons offered are the ones it accepts: moving a PAID order along
// the floor is orders:update, which staff hold; anything that changes whether it was paid for — cancel, refund, shipping
// an unpaid order — is orders:refund.
const COUNTED = ['paid', 'fulfilled', 'shipped', 'delivered']
const FULFILMENT = ['fulfilled', 'shipped', 'delivered']
// Shipping is a move like any other: offered only where the table allows it (a cancelled or refunded order is closed).
const canShip = (from: string) => from === 'shipped' || (NEXT_STATUS[from] || []).includes('shipped')
// The server's hasParcel: tracking belongs to an order going out or gone out — never to one pending, cancelled, or
// refunded before it left.
const hasParcel = (o: Order) => COUNTED.includes(o.status) || (o.status === 'refunded' && !!o.fulfilledAt)
// What the button does, in its own words: from a paid order, refunding and cancelling send money back.
const statusAction = (from: string, to: string, partlyRefunded = false) =>
  COUNTED.includes(from) && to === 'refunded' ? (partlyRefunded ? 'Refund the rest' : 'Refund everything')
    : COUNTED.includes(from) && to === 'cancelled' ? 'Cancel and refund' : `Mark ${to}`
const moveNeeds = (from: string, to: string) => (COUNTED.includes(from) && FULFILMENT.includes(to)) ? 'orders:update' : 'orders:refund'
/** The refusals after which the order on screen is no longer the order: read it again. */
const RELOAD_ON = ['order_changed', 'no_parcel', 'refund_failed', 'refund_unconfirmed', 'refund_in_progress', 'label_in_progress']

/** Offer the control unless the permission list has arrived and says no (the server still refuses). */
function useMay() {
  const { known, can } = usePermissions()
  return useCallback((permission: string) => !known || can(permission), [known, can])
}

interface RateQuote { id: string; carrier: string; service: string; amountCents: number; currency: string; estimatedDays?: number | null }
interface RefundQuote { suggestedCents: number; maxCents: number; shippingLeftCents: number }

export default function OrderDetailPage() {
  const { id = '' } = useParams()
  const toast = useToast()
  const confirm = useConfirm()
  const may = useMay()
  const { known, can } = usePermissions()
  // The toast object is made afresh on every render of its provider: read through a ref so `load` stays put.
  const toastRef = useRef(toast)
  toastRef.current = toast
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const [refunding, setRefunding] = useState(false)
  const [busy, setBusy] = useState(false)

  /** The order as saved; the boxes become what was saved. */
  const show = useCallback((o: Order) => {
    setOrder(o); setCarrier(o.trackingCarrier || ''); setTracking(o.trackingNumber || ''); setNote(o.internalNote || '')
  }, [])
  /** A reply's order carries no items or refunds: laid over the one on screen, never in place of it. */
  const merge = useCallback((o: Order) => setOrder((prev) => (prev ? { ...prev, ...o } : o)), [])

  const load = useCallback(async () => {
    try {
      show(await api.get(`/api/admin/orders/${encodeURIComponent(id)}`) as Order)
      setLoadError('')
    } catch (e) {
      if (statusOf(e) === 404) setOrder(null)
      else setLoadError(errorText(e, "Couldn't load the order"))
    } finally {
      setLoading(false)
    }
  }, [id, show])

  useEffect(() => { void load() }, [load])

  // Someone else moved this order while it was open (409 order_changed), or the provider refused: nothing of ours was
  // applied, so show the order as it now stands rather than the buttons for a status it has left.
  const failed = (e: unknown, fallback = 'That did not go through') => {
    toast.error(errorText(e, fallback))
    if (RELOAD_ON.includes(codeOf(e) || '')) void load()
  }

  const setStatus = async (status: string) => {
    if (!order) return
    // Refunding — or cancelling — a paid order sends the shopper's money back through the provider, so it is asked
    // once, with the amount, the way any refund screen asks. (Owner's decision, 10/12)
    const givesMoneyBack = COUNTED.includes(order.status) && (status === 'refunded' || status === 'cancelled')
    if (givesMoneyBack) {
      // After part refunds, only what is left goes back (and only the units not refunded yet go back on the shelf).
      const amount = cents(order.totalCents - (order.refundedCents || 0), order.currency)
      const ask = order.providerPaymentId
        ? `${status === 'refunded' ? 'Refund' : 'Cancel this order and refund'} ${amount} to the customer's card? The stock goes back on the shelf.`
        : `${status === 'refunded' ? 'Mark this order refunded' : 'Cancel this order'}? There is no card payment on record, so no money is sent back from here. The stock goes back on the shelf.`
      const yes = await confirm(ask, { title: status === 'refunded' ? 'Refund order' : 'Cancel order', confirmText: status === 'refunded' ? 'Refund' : 'Cancel order' })
      if (!yes) return
    }
    setBusy(true)
    try {
      const r = await api.patch(`/api/admin/orders/${encodeURIComponent(order.id)}/status`, { status }) as { order: Order; refund?: MoneyBack }
      merge(r.order)
      const refund = r.refund
      if (refund?.kind === 'refunded') {
        toast.success(refund.alreadyRefunded ? `Marked ${status} — the payment had already been refunded`
          : refund.awaiting ? `Marked ${status} — the payment provider is holding the refund, so nothing is restocked until it confirms it`
          : `${status === 'refunded' ? 'Refunded' : 'Cancelled and refunded'} ${cents(refund.amountCents ?? (order.totalCents - (order.refundedCents || 0)), order.currency)} to the customer's card`)
      } else if (refund && 'note' in refund) toast.warning(`Marked ${status}. ${refund.note}`)
      else toast.success(`Marked ${status}`)
      // The refund history and the lines' refunded counts changed: read the order whole.
      if (refund) await load()
    } catch (e) { failed(e, `Couldn't mark the order ${status}`) } finally { setBusy(false) }
  }

  const retryRefund = async () => {
    if (!order) return
    setBusy(true)
    try {
      const r = await api.post(`/api/admin/orders/${encodeURIComponent(order.id)}/refund/retry`) as { order: Order; refund: MoneyBack | null }
      merge(r.order)
      toast.success(r.order.refundPendingAt ? 'The refund is still under way' : `Refunded ${cents(r.order.totalCents, r.order.currency)} to the customer's card`)
      await load()
    } catch (e) {
      toast.error(errorText(e, 'The refund still has not gone through'))
      // A refused retry no longer carries the order: read it again, whatever the code.
      await load()
    } finally { setBusy(false) }
  }

  const saveFulfillment = async (markShipped: boolean) => {
    if (!order) return
    // Only the boxes this person changed: one adding the tracking number while another wrote the note used to send
    // both, and the second save blanked the first one's.
    const body: { trackingCarrier?: string; trackingNumber?: string; internalNote?: string; markShipped?: boolean } = { markShipped }
    if (carrier !== (order.trackingCarrier || '')) body.trackingCarrier = carrier
    if (tracking !== (order.trackingNumber || '')) body.trackingNumber = tracking
    if (note !== (order.internalNote || '')) body.internalNote = note
    setBusy(true)
    try {
      const o = await api.patch(`/api/admin/orders/${encodeURIComponent(order.id)}/fulfillment`, body) as Order
      merge(o)
      // The boxes now show the order as saved — the other person's fields included — so they are the next baseline.
      setCarrier(o.trackingCarrier || ''); setTracking(o.trackingNumber || ''); setNote(o.internalNote || '')
      toast.success(markShipped ? 'Marked shipped' : 'Saved')
    } catch (e) { failed(e, "Couldn't save the fulfilment") } finally { setBusy(false) }
  }

  const forward = async () => {
    if (!order) return
    setBusy(true)
    try {
      const r = await api.post(`/api/admin/suppliers/orders/${encodeURIComponent(order.id)}/forward`) as { success: true; note?: string }
      toast.success(r.note ? `Sent to supplier. ${r.note}` : 'Sent to supplier')
    } catch (e) { toast.error(errorText(e, 'Could not forward the order')) } finally { setBusy(false); void load() }
  }
  const hold = async () => {
    if (!order) return
    setBusy(true)
    try {
      await api.post(`/api/admin/suppliers/orders/${encodeURIComponent(order.id)}/hold`)
      toast.success('Held — will not auto-forward')
    } catch (e) { toast.error(errorText(e, 'Could not hold the order')) } finally { setBusy(false); void load() }
  }

  if (loading) return <PageSpinner />
  if (loadError && !order) return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6"><PageError message={loadError} /></div>
  if (!order) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-3">
        <BackLink />
        <p className="text-gray-500 dark:text-slate-400">Order not found.</p>
      </div>
    )
  }

  const refunded = order.refundedCents || 0
  const moves = (NEXT_STATUS[order.status] || []).filter((s) => may(moveNeeds(order.status, s)))
  const mayPartRefund = COUNTED.includes(order.status) && !order.refundPendingAt && refunded < order.totalCents && may('orders:refund')
  const mayOpenContact = !known || can('contacts:read')

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{order.orderNumber || 'Pending order'}</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">{formatDate(order.createdAt)} · <span className="capitalize">{order.provider}</span></p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusBadge(order.status)}`}>{codeLabel(order.status)}</span>
      </div>

      <PageError message={loadError} onDismiss={() => setLoadError('')} />

      {/* Where the shopper's money stands, once a refund has been asked for. */}
      {order.refundPendingAt && (
        <div className={`rounded-lg border p-4 text-sm ${order.refundError
          ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
          : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}>
          {order.refundError
            ? <>The refund has not gone through yet, so nothing has been restocked. {order.refundError}</>
            : <>A refund is being sent back to the customer's card. It finishes on its own if it was interrupted.</>}
          {order.refundError && may('orders:refund') && (
            <button onClick={retryRefund} disabled={busy} className="btn btn-secondary px-3 py-1.5 text-xs ml-3 mt-2 sm:mt-0">Try the refund again</button>
          )}
        </div>
      )}
      {!order.refundPendingAt && order.refundedAt && (
        <p className="text-sm text-gray-600 dark:text-slate-300">Money returned to the customer's card on {formatDate(order.refundedAt)}.</p>
      )}

      {/* Status actions — only the moves this person may make */}
      {(moves.length > 0 || mayPartRefund) && (
        <div className="card p-4 flex flex-wrap gap-2">
          {moves.map((s) => (
            <button key={s} onClick={() => setStatus(s)} disabled={busy} className="btn btn-secondary px-3 py-1.5 text-xs">{statusAction(order.status, s, refunded > 0)}</button>
          ))}
          {/* Part of it: chosen units, the shipping, or an amount (RefundDialog). */}
          {mayPartRefund && (
            <button onClick={() => setRefunding(true)} disabled={busy} className="btn btn-secondary px-3 py-1.5 text-xs">Refund items…</button>
          )}
        </div>
      )}

      {/* Items */}
      <div className="card">
        <h2 className="px-5 py-3 font-semibold text-gray-900 border-b border-gray-200 dark:text-slate-100 dark:border-slate-800">Items</h2>
        <div className="divide-y divide-gray-200 dark:divide-slate-800">
          {(order.items || []).map((it) => (
            <div key={it.id} className="flex items-center gap-3 px-5 py-3">
              <div className="h-12 w-12 rounded bg-gray-100 overflow-hidden flex-shrink-0 dark:bg-slate-800">
                {it.imageUrl && <img src={it.imageUrl} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate dark:text-slate-100">{it.productName}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400">{it.variantName} · {it.sku} · × {it.quantity}{(it.refundedQuantity || 0) > 0 ? ` · ${it.refundedQuantity === it.quantity ? 'refunded' : `${it.refundedQuantity} refunded`}` : ''}</div>
              </div>
              <div className="text-sm font-medium whitespace-nowrap text-gray-900 dark:text-slate-100">{cents(it.lineTotalCents, order.currency)}</div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 space-y-1 text-sm dark:border-slate-800">
          <Row label="Subtotal" value={cents(order.subtotalCents, order.currency)} />
          <Row label="Shipping" value={cents(order.shippingCents, order.currency)} />
          <Row label="Tax" value={cents(order.taxCents, order.currency)} />
          {order.discountCents > 0 && <Row label="Discount" value={`−${cents(order.discountCents, order.currency)}`} />}
          <Row label="Total" value={cents(order.totalCents, order.currency)} bold />
          {refunded > 0 && <Row label="Refunded" value={`−${cents(refunded, order.currency)}`} />}
          {refunded > 0 && <Row label="Net" value={cents(order.totalCents - refunded, order.currency)} bold />}
        </div>
      </div>

      <RefundHistory order={order} onChanged={merge} reload={load} />
      {refunding && <RefundDialog order={order} onClose={() => setRefunding(false)} onDone={(o) => { setRefunding(false); if (o) merge(o); void load() }} />}

      {/* Customer */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-2 dark:text-slate-100">Customer</h2>
          {order.contactId && mayOpenContact
            ? <Link to={`/crm/contacts/${order.contactId}`} className="text-sm font-medium text-orange-900 hover:underline dark:text-orange-200">{order.customerName || order.customerEmail}</Link>
            : <p className="text-sm text-gray-700 dark:text-slate-200">{order.customerName || '—'}</p>}
          <p className="text-sm text-gray-500 break-all dark:text-slate-400">{order.customerEmail}</p>
          {order.customerPhone && <p className="text-sm text-gray-500 dark:text-slate-400">{order.customerPhone}</p>}
        </div>
        {(order.supplierStatus || order.supplierOrderId) && (
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 mb-2 dark:text-slate-100">Supplier</h2>
            <div className="text-sm text-gray-600 space-y-1 dark:text-slate-300">
              <div>Status: <span className={`font-medium ${order.supplierStatus === 'error' ? 'text-red-700 dark:text-red-300' : order.supplierStatus === 'placed' || order.supplierStatus === 'shipped' ? 'text-green-700 dark:text-green-300' : 'text-amber-800 dark:text-amber-300'}`}>{order.supplierStatus}</span></div>
              {order.supplierOrderId && <div>Supplier order: <span className="font-mono text-xs">{order.supplierOrderId}</span></div>}
              {/* What the shop paid, and the margin: only where the reply carries it (margin:read). */}
              {typeof order.supplierCostCents === 'number' && (
                <div>Supplier cost: {cents(order.supplierCostCents, order.currency)} <span className="text-gray-500 dark:text-slate-400">(margin {cents(order.totalCents - order.supplierCostCents, order.currency)})</span></div>
              )}
              {order.supplierError && <div className="text-red-700 text-xs dark:text-red-300">{order.supplierError}</div>}
            </div>
            {/* Forwarding and holding run on the supplier connection — the owner's (integrations:update). */}
            {!order.supplierOrderId && may('integrations:update') && (
              <div className="flex flex-wrap gap-2 mt-3">
                <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={forward}>Send to supplier now</button>
                {order.supplierStatus !== 'hold' && <button className="btn btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={hold}>Hold</button>}
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
            <div><label className="label" htmlFor="ord-carrier">Carrier</label><input id="ord-carrier" className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="USPS, UPS, FedEx…" readOnly={!may('orders:update')} /></div>
            <div><label className="label" htmlFor="ord-tracking">Tracking number</label><input id="ord-tracking" className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} readOnly={!may('orders:update')} /></div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-slate-400">This order is {codeLabel(order.status)} and never went out, so it has no tracking.</p>
        )}
        <div><label className="label" htmlFor="ord-note">Internal note</label><textarea id="ord-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} readOnly={!may('orders:update')} /></div>
        {may('orders:update') && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => saveFulfillment(false)} disabled={busy} className="btn btn-secondary">Save</button>
            {canShip(order.status) && may(moveNeeds(order.status, 'shipped')) && (
              <button onClick={() => saveFulfillment(true)} disabled={busy} className="btn btn-primary">Save & mark shipped</button>
            )}
          </div>
        )}
      </div>

      {/* Shipping label */}
      <LabelPanel order={order} onBought={(o) => { if (o) merge(o); void load() }} />
    </div>
  )
}

function BackLink() {
  return <Link to="/crm/orders" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"><ArrowLeft className="h-4 w-4" /> Orders</Link>
}

// Buy a carrier label for this order. Hidden entirely when no carrier account is connected (or this seat may not read
// the carrier set-up, shipping:read) — the manual tracking fields above still work on their own.
function LabelPanel({ order, onBought }: { order: Order; onBought: (o: Order | null) => void }) {
  const toast = useToast()
  const may = useMay()
  const [connected, setConnected] = useState<boolean | null>(null)
  const [rates, setRates] = useState<RateQuote[] | null>(null)
  const [busy, setBusy] = useState(false)
  // Buying marks the order shipped, so it is the same move as "Mark shipped" (server orders/shipping.ts).
  const mayBuy = may('shipping:label') && canShip(order.status) && may(moveNeeds(order.status, 'shipped'))

  useEffect(() => {
    let live = true
    api.get('/api/admin/shipping/config')
      .then((c) => { if (live) setConnected(!!(c as { connected?: boolean })?.connected) })
      .catch(() => { if (live) setConnected(false) })
    return () => { live = false }
  }, [])

  if (connected === null) return null
  if (connected === false && !order.labelUrl) return null

  const loadRates = async () => {
    setBusy(true)
    try {
      setRates(listOf<RateQuote>(await api.get(`/api/admin/shipping/orders/${encodeURIComponent(order.id)}/rates`)))
    } catch (e) {
      toast.error(errorText(e, 'Could not get rates'))
    } finally {
      setBusy(false)
    }
  }

  const buy = async (rateId: string) => {
    // The print tab is opened NOW, inside the click: a browser lets a page open a tab only while the click is fresh,
    // and buying the label takes a few seconds — opened afterwards, it is blocked as a pop-up. It is pointed at the
    // label once there is one, and closed if the purchase fails. "Print label" below stays as the way back to it.
    const printTab = window.open('', '_blank')
    setBusy(true)
    try {
      const res = await api.post(`/api/admin/shipping/orders/${encodeURIComponent(order.id)}/label`, { rateId, markShipped: true }) as { label: { labelUrl: string }; order: Order; note?: string }
      // A note means the label was bought but the order was not marked shipped (someone cancelled or refunded it).
      if (res.note) toast.warning(res.note)
      else toast.success('Label bought — customer emailed')
      if (printTab) printTab.location.href = res.label.labelUrl
      onBought(res.order)
    } catch (e) {
      printTab?.close()
      toast.error(errorText(e, 'Could not buy the label'))
      // Refused because of where the order stands — a label already bought or being bought from another screen, or the
      // order moved: show it as it is now.
      const s = statusOf(e)
      if (s !== undefined && s >= 400 && s < 500) onBought(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-semibold text-gray-900 dark:text-slate-100">Shipping label</h2>

      {order.labelUrl ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            {order.trackingCarrier} {order.trackingNumber}
            {typeof order.labelCostCents === 'number' && <span className="text-gray-500 dark:text-slate-400"> · {cents(order.labelCostCents, order.currency)}</span>}
          </p>
          <a href={order.labelUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">Print label</a>
        </div>
      ) : !order.shippingAddress ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">This order has no shipping address, so a label cannot be bought.</p>
      ) : !canShip(order.status) ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">This order is {codeLabel(order.status)}, so no label can be bought for it.</p>
      ) : !mayBuy ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">{may('shipping:label') ? 'This order is not paid, so shipping it is for a manager or the owner.' : 'Labels are bought by the people who pack and ship orders.'}</p>
      ) : !rates ? (
        <button onClick={loadRates} disabled={busy} className="btn btn-secondary">{busy ? 'Checking…' : 'Get rates'}</button>
      ) : rates.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">No rates came back for this address and parcel.</p>
      ) : (
        <div className="space-y-2">
          {rates.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
              <span className="text-sm text-gray-700 dark:text-slate-200">
                {r.carrier} {r.service}
                {r.estimatedDays ? <span className="text-gray-500 dark:text-slate-400"> · {r.estimatedDays} days</span> : null}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{cents(r.amountCents, r.currency)}</span>
                <button onClick={() => buy(r.id)} disabled={busy} className="btn btn-primary px-3 py-1.5">Buy</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const toCents = (s: string) => { const n = Number(String(s).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN }
const dollars = (c: number) => (c / 100).toFixed(2)

/**
 * REFUND PART OF AN ORDER. (E2E Run 2: Refund could only send back the whole order.) Pick how many of each item — and
 * the shipping, if that goes back too — and the server (POST /refunds/quote) says what they are worth: each unit's share
 * of what was paid, discount and tax included. The amount can be changed; the button says exactly what will be sent.
 */
function RefundDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order | null) => void }) {
  const toast = useToast()
  const confirm = useConfirm()
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
  const items = useMemo(() => typed.filter((t) => !t.bad && t.n > 0).map((t) => ({ orderItemId: t.it.id, quantity: t.n })),
    // `typed` is remade each render; what it says follows the quantities typed alone.
    [JSON.stringify(qty)]) // eslint-disable-line react-hooks/exhaustive-deps
  const shippingCents = shipping ? (quote?.shippingLeftCents ?? 0) : 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // Ask the server what the chosen units are worth, every time the choice changes.
  const editedRef = useRef(edited)
  editedRef.current = edited
  useEffect(() => {
    let live = true
    if (badQty) return
    api.post(`/api/admin/orders/${encodeURIComponent(order.id)}/refunds/quote`, { items, shippingCents })
      .then((q) => {
        if (!live) return
        const quoteNow = q as RefundQuote
        setQuote(quoteNow); setProblem('')
        if (!editedRef.current) setAmount(quoteNow.suggestedCents > 0 ? dollars(quoteNow.suggestedCents) : '')
      })
      .catch((e) => { if (live) setProblem(errorText(e, 'Could not work out the refund')) })
    return () => { live = false }
  }, [order.id, items, shippingCents, badQty])

  const amountCents = toCents(amount)
  const valid = !problem && !badQty && Number.isFinite(amountCents) && amountCents > 0 && (!quote || amountCents <= quote.maxCents)
  const submit = async () => {
    if (!valid) return
    const what = order.providerPaymentId
      ? `Send ${cents(amountCents, order.currency)} back to the customer's card?`
      : `Record a refund of ${cents(amountCents, order.currency)}? There is no card payment on record, so no money is sent back from here.`
    if (!(await confirm(`${what}${items.length && restock ? ' The refunded units go back on the shelf.' : ''}`, { title: 'Refund', confirmText: `Refund ${cents(amountCents, order.currency)}` }))) return
    setBusy(true)
    try {
      const r = await api.post(`/api/admin/orders/${encodeURIComponent(order.id)}/refunds`, {
        items, shippingCents, restock, amountCents, ...(reason.trim() ? { reason: reason.trim() } : {}),
      }) as { order: Order; refund: MoneyBack; restocked: number }
      if (r.refund?.kind === 'refunded' && r.refund.awaiting) toast.success(`${cents(amountCents, order.currency)} sent — the payment provider is holding the refund, so nothing is restocked until it confirms it`)
      else if (r.refund?.kind === 'refunded') toast.success(`Refunded ${cents(amountCents, order.currency)} to the customer's card${r.restocked ? ` — ${r.restocked} unit${r.restocked === 1 ? '' : 's'} back in stock` : ''}`)
      else if (r.refund && 'note' in r.refund) toast.warning(`Refund recorded. ${r.refund.note}`)
      onDone(r.order)
    } catch (e) {
      toast.error(errorText(e, 'The refund did not go through'))
      setBusy(false)
      // Refused or still waiting, the order changed either way (and the 502 no longer carries it): read it again.
      const code = codeOf(e)
      if (statusOf(e) === 502 || code === 'order_changed' || code === 'refund_in_progress' || code === 'nothing_to_refund') onDone(null)
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
                      <div className="text-xs text-gray-500 dark:text-slate-400">{it.variantName} · {cents(it.unitPriceCents, order.currency)} each · {left} of {it.quantity} can be refunded</div>
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
                Refund the shipping ({cents(quote.shippingLeftCents, order.currency)})
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
                {quote ? <>Suggested {cents(quote.suggestedCents, order.currency)} for what is chosen · at most {cents(quote.maxCents, order.currency)} can still be refunded.</> : 'Working it out…'}
              </p>
              {quote && Number.isFinite(amountCents) && amountCents > quote.maxCents && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">That is more than is left to refund.</p>}
            </div>
            <div>
              <label className="label" htmlFor="refund-reason">Reason (optional, for your records)</label>
              <input id="refund-reason" className="input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Damaged in transit, wrong size…" />
            </div>
            {(badQty || problem) && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{badQty || problem}</p>}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
            <button onClick={onClose} disabled={busy} className="btn btn-secondary">Cancel</button>
            <button onClick={submit} disabled={busy || !valid} className="btn btn-primary">{busy ? 'Refunding…' : valid ? `Refund ${cents(amountCents, order.currency)}` : 'Refund'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const REFUND_STATE: Record<string, { label: string; cls: string }> = {
  refunded: { label: 'Sent back', cls: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' },
  recorded: { label: 'Recorded only', cls: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300' },
  pending: { label: 'Waiting on the provider', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  failed: { label: 'Refused — nothing sent', cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
}

function RefundHistory({ order, onChanged, reload }: { order: Order; onChanged: (o: Order) => void; reload: () => Promise<void> }) {
  const toast = useToast()
  const may = useMay()
  const [busy, setBusy] = useState<string | null>(null)
  const refunds = order.refunds || []
  if (!refunds.length) return null
  const names = new Map((order.items || []).map((i) => [i.id, i.productName]))
  const retry = async (refundId: string) => {
    setBusy(refundId)
    try {
      const r = await api.post(`/api/admin/orders/${encodeURIComponent(order.id)}/refunds/${encodeURIComponent(refundId)}/retry`) as { order: Order; refund: MoneyBack | null }
      onChanged(r.order)
      toast.success(r.refund?.kind === 'refunded' ? (r.refund.awaiting ? 'Still waiting on the payment provider' : 'Refund sent') : 'Refund recorded')
    } catch (e) {
      toast.error(errorText(e, 'The refund still has not gone through'))
      // The 502 no longer carries the order: read it again.
      await reload()
    } finally { setBusy(null) }
  }
  return (
    <div className="card">
      <h2 className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-900 dark:border-slate-800 dark:text-slate-100">Refunds</h2>
      <div className="divide-y divide-gray-200 dark:divide-slate-800">
        {refunds.map((r) => {
          const st = REFUND_STATE[r.status] || REFUND_STATE.recorded
          const what = [...(r.items || []).map((l) => `${l.quantity} × ${names.get(l.orderItemId) || 'item'}`), ...(r.shippingCents > 0 ? [`shipping ${cents(r.shippingCents, order.currency)}`] : [])]
          return (
            <div key={r.id} className="space-y-1 px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-900 dark:text-slate-100">{cents(r.amountCents, order.currency)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
              </div>
              <div className="text-xs text-gray-600 dark:text-slate-300">
                {formatDate(r.createdAt)}{r.createdByName ? ` · ${r.createdByName}` : ''}{what.length ? ` · ${what.join(', ')}` : ''}{(r.items || []).length ? (r.restock ? ' · restocked' : ' · not restocked') : ''}
              </div>
              {r.reason && <div className="text-xs text-gray-600 dark:text-slate-300">{r.reason}</div>}
              {r.error && <div className="text-xs text-red-700 dark:text-red-300">{r.error}</div>}
              {r.status === 'pending' && may('orders:refund') && (
                <button onClick={() => retry(r.id)} disabled={busy === r.id} className="btn btn-secondary px-3 py-1.5 text-xs">{busy === r.id ? 'Trying…' : 'Try again'}</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'font-semibold text-gray-900 pt-1 dark:text-slate-100' : 'text-gray-600 dark:text-slate-300'}`}><span>{label}</span><span>{value}</span></div>
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-orange-500 dark:border-slate-700 dark:border-t-orange-400" /></div>
}
