// Moved from templates/crm-store/frontend/src/pages/OrdersPage.tsx — the store's orders at /crm/orders, filtered by
// status.
//
// Changes from the template:
//   · GET /api/admin/orders?status= answers { data, pagination } (was { orders }); the rows are read from `data`;
//   · a failed load says so (PageError) — the template swallowed it and read "No orders.", a shop told it had none
//     because a request failed;
//   · the filter offers `pending` as well: the server lists pending orders (an unpaid checkout, or one taken offline the
//     owner marks paid), the order page offers "Mark paid" on one, and the template's filter had no way to find them;
//   · each order links to /crm/orders/:id; money is integer cents shown as $x.xx (lib.ts cents);
//   · brand-coloured text (links, the highlighted figure) is text-orange-900 dark:text-orange-200, the only brand shades
//     that read at 4.5:1 for every company colour (scripts/check-contrast-measured.ts) — the template's
//     text-primary-600 fell under it for a yellow or lime brand;
//   · the header wraps at phone width and the table scrolls inside its card; every ink has its dark partner (the
//     filter pills had two competing dark: grounds, the total cell and the empty-state icon none).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useMayWrite } from '../../../../shared'
import { formatDate } from '../../../date'
import { cents, listOf, orderStatusLabel, statusBadge, type Order } from './lib'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

const FILTERS = ['all', 'pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'ready_for_pickup', 'picked_up', 'cancelled', 'refunded']

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Making an order for a customer (a wholesale order) is orders:create — the manager's and the owner's.
  const mayCreate = useMayWrite('orders:create')

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    api.get('/api/admin/orders', filter === 'all' ? undefined : { status: filter })
      .then((reply) => { if (live) setOrders(listOf<Order>(reply)) })
      .catch((e) => { if (live) { setOrders([]); setError(errorText(e, "Couldn't load the orders")) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [filter])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Orders</h1>
        {mayCreate && <Link to="/crm/orders/new" className="btn btn-primary">New order for a customer</Link>}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`rounded-full px-3 py-1 text-sm ${filter === f
              ? 'bg-orange-600 text-white dark:bg-orange-500'
              : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            {f === 'all' ? 'All' : f === 'pending' ? 'Not paid' : codeLabel(f)}
          </button>
        ))}
      </div>

      <PageError message={error} />

      {loading ? <PageSpinner /> : error ? null : orders.length === 0 ? (
        <div className="card p-10 text-center">
          <ShoppingBag className="h-10 w-10 mx-auto text-gray-400 dark:text-slate-400" />
          <p className="mt-3 text-gray-500 dark:text-slate-400">No {filter === 'all' ? '' : `${filter} `}orders.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500 border-b border-gray-200 dark:text-slate-400 dark:border-slate-800">
              {/* On a phone the date folds under the order and the customer is cut short, so Status and Total fit without
                  a sideways swipe — the table was 583px wide on a 375px screen (E2E Run 2). */}
              <tr><th className="px-3 sm:px-4 py-3">Order</th><th className="px-3 sm:px-4 py-3">Customer</th><th className="hidden sm:table-cell px-4 py-3">Date</th><th className="px-3 sm:px-4 py-3">Status</th><th className="px-3 sm:px-4 py-3 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-3 sm:px-4 py-3">
                    <Link to={`/crm/orders/${o.id}`} className="font-medium text-orange-900 hover:underline dark:text-orange-200">{o.orderNumber || 'Pending'}</Link>
                    <span className="block sm:hidden text-xs text-gray-500 dark:text-slate-400">{formatDate(o.createdAt)}</span>
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-gray-600 dark:text-slate-300 max-w-[8rem] sm:max-w-none truncate">{o.customerName || o.customerEmail}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-500 dark:text-slate-400">{formatDate(o.createdAt)}</td>
                  <td className="px-3 sm:px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(o.status)}`}>{orderStatusLabel(o)}</span>
                    {/* Money has gone back on an order still open: a part refund. */}
                    {(o.refundedCents || 0) > 0 && o.status !== 'refunded' && o.status !== 'cancelled' && (
                      <span className="block text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">part refunded</span>
                    )}
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-right font-medium whitespace-nowrap text-gray-900 dark:text-slate-100">{cents(o.totalCents, o.currency)}</td>
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
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-orange-500 dark:border-slate-700 dark:border-t-orange-400" /></div>
}
