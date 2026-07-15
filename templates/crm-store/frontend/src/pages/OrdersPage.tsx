import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import api, { Order } from '../services/api'
import { money, formatDate, statusColor } from '../lib/format'

const FILTERS = ['all', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded']

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.listOrders(filter === 'all' ? undefined : filter).then(setOrders).catch(() => {}).finally(() => setLoading(false))
  }, [filter])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Orders</h1>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${filter === f ? 'bg-primary-500 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>
            {f}
          </button>
        ))}
      </div>

      {loading ? <PageSpinner /> : orders.length === 0 ? (
        <div className="card p-10 text-center">
          <ShoppingBag className="h-10 w-10 mx-auto text-gray-300" />
          <p className="mt-3 text-gray-500">No {filter === 'all' ? '' : filter} orders.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-400 border-b">
              <tr><th className="px-4 py-3">Order</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><Link to={`/orders/${o.id}`} className="font-medium text-primary-600">{o.orderNumber || 'Pending'}</Link></td>
                  <td className="px-4 py-3 text-gray-600">{o.customerName || o.customerEmail}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(o.createdAt)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(o.status)}`}>{o.status}</span></td>
                  <td className="px-4 py-3 text-right font-medium">{money(o.totalCents, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
}
