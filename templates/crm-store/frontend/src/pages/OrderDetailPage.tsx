import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import api, { Order } from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { money, formatDate, statusColor } from '../lib/format'

const NEXT_STATUS: Record<string, string[]> = {
  paid: ['fulfilled', 'shipped', 'cancelled', 'refunded'],
  fulfilled: ['shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
}

export default function OrderDetailPage() {
  const { id } = useParams()
  const { toast } = useToast()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')

  const load = () => api.getOrder(id!).then((o) => {
    setOrder(o); setCarrier(o.trackingCarrier || ''); setTracking(o.trackingNumber || ''); setNote(o.internalNote || '')
  }).catch(() => toast('Could not load order', 'error')).finally(() => setLoading(false))

  useEffect(() => { load() }, [id])

  const setStatus = async (status: string) => {
    try { const o = await api.setOrderStatus(id!, status); setOrder((prev) => prev ? { ...prev, ...o } : prev); toast(`Marked ${status}`) }
    catch (e: any) { toast(e?.message || 'Failed', 'error') }
  }
  const saveFulfillment = async (markShipped: boolean) => {
    try {
      const o = await api.setFulfillment(id!, { trackingCarrier: carrier, trackingNumber: tracking, internalNote: note, markShipped })
      setOrder((prev) => prev ? { ...prev, ...o } : prev)
      toast(markShipped ? 'Marked shipped' : 'Saved')
    } catch (e: any) { toast(e?.message || 'Failed', 'error') }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
  if (!order) return <p className="text-gray-500">Order not found.</p>

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/orders" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft className="h-4 w-4" /> Orders</Link>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{order.orderNumber || 'Pending order'}</h1>
          <p className="text-sm text-gray-500">{formatDate(order.createdAt)} · {order.provider}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusColor(order.status)}`}>{order.status}</span>
      </div>

      {/* Status actions */}
      {NEXT_STATUS[order.status]?.length > 0 && (
        <div className="card p-4 flex flex-wrap gap-2">
          {NEXT_STATUS[order.status].map((s) => (
            <button key={s} onClick={() => setStatus(s)} className="btn-secondary text-xs capitalize">Mark {s}</button>
          ))}
        </div>
      )}

      {/* Items */}
      <div className="card">
        <h2 className="px-5 py-3 font-semibold text-gray-900 border-b">Items</h2>
        <div className="divide-y">
          {order.items?.map((it) => (
            <div key={it.id} className="flex items-center gap-3 px-5 py-3">
              <div className="h-12 w-12 rounded bg-gray-100 overflow-hidden flex-shrink-0">
                {it.imageUrl && <img src={it.imageUrl} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{it.productName}</div>
                <div className="text-xs text-gray-500">{it.variantName} · {it.sku} · × {it.quantity}</div>
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
        </div>
      </div>

      {/* Customer */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Customer</h2>
          <p className="text-sm text-gray-700">{order.customerName || '—'}</p>
          <p className="text-sm text-gray-500">{order.customerEmail}</p>
          {order.customerPhone && <p className="text-sm text-gray-500">{order.customerPhone}</p>}
        </div>
        {(order.supplierStatus || order.supplierOrderId) && (
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 mb-2">Supplier</h2>
            <div className="text-sm text-gray-600 space-y-1">
              <div>Status: <span className={"font-medium " + (order.supplierStatus === 'error' ? 'text-red-600' : order.supplierStatus === 'placed' || order.supplierStatus === 'shipped' ? 'text-green-600' : 'text-yellow-600')}>{order.supplierStatus}</span></div>
              {order.supplierOrderId && <div>Supplier order: <span className="font-mono text-xs">{order.supplierOrderId}</span></div>}
              {order.supplierCostCents != null && <div>Supplier cost: ${(order.supplierCostCents / 100).toFixed(2)} <span className="text-gray-400">(margin ${((order.totalCents - order.supplierCostCents) / 100).toFixed(2)})</span></div>}
              {order.supplierError && <div className="text-red-600 text-xs">{order.supplierError}</div>}
            </div>
            {!order.supplierOrderId && (
              <div className="flex gap-2 mt-3">
                <button className="btn-primary text-xs" onClick={async () => { try { const r: any = await api.forwardOrderToSupplier(order.id); toast(r?.ok ? 'Sent to supplier' : (r?.note || 'Could not forward'), r?.ok ? undefined : 'error'); load() } catch (e: any) { toast(e?.message || 'Could not forward', 'error') } }}>Send to supplier now</button>
                {order.supplierStatus !== 'hold' && <button className="btn-secondary text-xs" onClick={async () => { await api.holdSupplierOrder(order.id); toast('Held — will not auto-forward'); load() }}>Hold</button>}
              </div>
            )}
          </div>
        )}

        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Ship to</h2>
          {order.shippingAddress ? (
            <address className="not-italic text-sm text-gray-600 leading-relaxed">
              {order.shippingAddress.line1}<br />
              {order.shippingAddress.line2 && <>{order.shippingAddress.line2}<br /></>}
              {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}<br />
              {order.shippingAddress.country}
            </address>
          ) : <p className="text-sm text-gray-400">No shipping address</p>}
        </div>
      </div>

      {/* Fulfillment */}
      <div className="card p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Fulfillment</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label">Carrier</label><input className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="USPS, UPS, FedEx…" /></div>
          <div><label className="label">Tracking number</label><input className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
        </div>
        <div><label className="label">Internal note</label><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex gap-2">
          <button onClick={() => saveFulfillment(false)} className="btn-secondary">Save</button>
          <button onClick={() => saveFulfillment(true)} className="btn-primary">Save & mark shipped</button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'font-semibold text-gray-900 pt-1' : 'text-gray-600'}`}><span>{label}</span><span>{value}</span></div>
}
