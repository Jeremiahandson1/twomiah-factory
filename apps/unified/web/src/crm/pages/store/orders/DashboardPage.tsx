// Moved from templates/crm-store/frontend/src/pages/DashboardPage.tsx — the store's home at /crm/dashboard: the set-up
// checklist, the sales tiles and the latest orders.
//
// Changes from the template:
//   · the calls are the unified server's: GET /api/admin/orders/stats answers the stats object itself (was { stats });
//     GET /api/admin/orders and GET /api/admin/products are { data, pagination } (were { orders } / { products }); GET
//     /api/admin/payments is unchanged;
//   · each of the four reads stands alone (Promise.allSettled): the template's Promise.all dropped every figure when any
//     one call failed, and swallowed the failure, so a dashboard read "0 orders" because the products call broke. A
//     failed stats read now says so (PageError) instead of showing zeros;
//   · the links are the app's: /crm/orders, /crm/orders/:id, /crm/products, /crm/payments;
//   · money is integer cents shown as $x.xx (lib.ts cents); the revenue, refunded and net tiles still go when the reply
//     withholds them (null for a seat without revenue:read);
//   · brand-coloured text (links, the highlighted figure) is text-orange-900 dark:text-orange-200, the only brand shades
//     that read at 4.5:1 for every company colour (scripts/check-contrast-measured.ts) — the template's
//     text-primary-600 fell under it for a yellow or lime brand;
//   · the header wraps at phone width; every ink has its dark partner (the stat value's light class sat under a second
//     dark: class — one pair now; the recent order's total had no ink of its own).
import { useEffect, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, CheckCircle2, DollarSign, Package, PackageMinus, RotateCcw, ShoppingBag, Truck } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useMayWrite } from '../../../../shared'
import { formatDate } from '../../../date'
import { cents, isUnfinishedCheckout, listOf, orderStatusLabel, statusBadge, type Order } from './lib'

interface Stats {
  paidCount: number; pendingFulfillment: number; atSupplier: number
  /** null: not this seat's to see (revenue:read). */
  revenueCents?: number | null; refundedCount: number; refundedCents?: number | null; netCents?: number | null
  /** Products with an option at or under its low-stock level; absent unless the shop has low-stock alerts on. */
  lowStock?: number
}
interface PaymentStatus { config: { provider: string; mode: string; connected: boolean } | null }

export default function DashboardPage() {
  // Connecting payments is POST /api/admin/payments/connect — payments:update. A seat without it reads the step, it is
  // not sent to a page where it can change nothing. (Store QA T1 sweep)
  const mayConnectPayments = useMayWrite('payments:update')
  const mayAddProducts = useMayWrite('products:create')
  const [stats, setStats] = useState<Stats | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [activeProducts, setActiveProducts] = useState<number | null>(null)
  const [payment, setPayment] = useState<PaymentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    Promise.allSettled([
      api.get('/api/admin/orders/stats'),
      api.get('/api/admin/orders'),
      api.get('/api/admin/products'),
      // The payment account is the owner's to read (GET /api/admin/payments asks payments:update): asked only by a seat
      // that holds it, so no other seat's dashboard makes a request that is refused.
      mayConnectPayments ? api.get('/api/admin/payments') : Promise.resolve(null),
    ]).then(([s, o, p, pay]) => {
      if (!live) return
      if (s.status === 'fulfilled') setStats(s.value as Stats)
      else setError(errorText(s.reason, "Couldn't load the store's figures"))
      // The recent sales: a checkout the shopper never finished is not one (Orders lists it, labelled).
      if (o.status === 'fulfilled') setOrders(listOf<Order>(o.value).filter((x) => !isUnfinishedCheckout(x)).slice(0, 5))
      if (p.status === 'fulfilled') setActiveProducts(listOf<{ status: string }>(p.value).filter((x) => x.status === 'active').length)
      if (pay.status === 'fulfilled' && pay.value) setPayment(pay.value as PaymentStatus)
    }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [mayConnectPayments])

  if (loading) return <PageSpinner />

  const paymentsConnected = !!payment?.config?.connected
  // The checklist shows only once both answers are in; an unknown is not "not done".
  const setupKnown = activeProducts !== null && (!mayConnectPayments || payment !== null)
  // Connecting payments is the owner's step; another seat's checklist is the products alone.
  const setupDone = (paymentsConnected || !mayConnectPayments) && (activeProducts ?? 0) > 0

  // Which tiles show depends on the seat (revenue:read) and the data (a refund, an order at the supplier): two to six.
  // The columns follow the count, so a row never leaves one tile on its own. (Store QA T2, N1)
  const tiles = stats ? [
    stats.revenueCents != null && <StatCard key="revenue" icon={DollarSign} label="Revenue" value={cents(stats.revenueCents)} />,
    // Revenue counts a refunded sale (the sale happened); what went back is shown beside it. (Store QA T1, L3)
    stats.refundedCents != null && stats.refundedCount > 0 && <StatCard key="refunded" icon={RotateCcw} label={`Refunded (${stats.refundedCount} order${stats.refundedCount === 1 ? '' : 's'})`} value={cents(stats.refundedCents)} />,
    // …and what the shop kept, once anything has gone back — part refunds included. (E2E Run 2)
    stats.netCents != null && stats.refundedCount > 0 && <StatCard key="net" icon={DollarSign} label="Net sales" value={cents(stats.netCents)} />,
    <StatCard key="orders" icon={ShoppingBag} label="Orders" value={String(stats.paidCount)} />,
    <StatCard key="fulfill" icon={Package} label="To fulfill" value={String(stats.pendingFulfillment)} highlight={stats.pendingFulfillment > 0} />,
    stats.atSupplier > 0 && <StatCard key="supplier" icon={Truck} label="At supplier" value={String(stats.atSupplier)} />,
    // Low-stock alerts (store_low_stock): the list it opens counts the same products.
    stats.lowStock != null && <Link key="lowstock" to="/crm/products?filter=low_stock" className="block"><StatCard icon={PackageMinus} label="Running low" value={String(stats.lowStock)} highlight={stats.lowStock > 0} /></Link>,
  ].filter(Boolean) : []

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Dashboard</h1>
      </div>

      <PageError message={error} />

      {setupKnown && !setupDone && (
        <div className="card p-5">
          {/* A seat that cannot do a step reads where it stands and who does it — not an instruction it cannot follow.
              (Store QA T5, staff: 'Connect your payment account to accept orders' shown to a seat Payments refuses.) */}
          <h2 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">{mayConnectPayments ? 'Finish setting up your store' : 'Store setup'}</h2>
          <ul className="space-y-2 text-sm">
            <ChecklistItem done={(activeProducts ?? 0) > 0} to={mayAddProducts ? '/crm/products' : undefined}
              text={(activeProducts ?? 0) > 0 ? `${activeProducts} product(s) live` : mayAddProducts ? 'Add and activate your first product' : 'No products are live yet'} />
            {mayConnectPayments && <ChecklistItem done={paymentsConnected} to="/crm/payments"
              text={paymentsConnected ? 'Payments connected' : 'Connect your payment account to accept orders'} />}
          </ul>
        </div>
      )}

      {tiles.length > 0 && (
        <div className={`grid grid-cols-1 ${TILE_COLUMNS[tiles.length] || TILE_COLUMNS[6]} gap-4`}>
          {tiles}
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-slate-800">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">Recent orders</h2>
          <Link to="/crm/orders" className="text-sm text-orange-900 hover:underline flex items-center gap-1 dark:text-orange-200">View all <ArrowRight className="h-3 w-3" /></Link>
        </div>
        {orders.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500 dark:text-slate-400">No orders yet.</p>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-slate-800">
            {orders.map((o) => (
              <Link key={o.id} to={`/crm/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-gray-50 dark:hover:bg-slate-800">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-gray-900 dark:text-slate-100">{o.orderNumber || 'Pending'}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{o.customerEmail} · {formatDate(o.createdAt)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(o.status)}`}>{orderStatusLabel(o)}</span>
                  <span className="font-medium text-sm text-gray-900 dark:text-slate-100">{cents(o.totalCents, o.currency)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Tile count → columns, as whole class names (Tailwind only builds the classes it can read). Four sit 2 × 2 until the
// main column is wide enough for four in a row (xl); five sit 3 + 2 until five fit with their longest label on one line.
const TILE_COLUMNS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
  5: 'sm:grid-cols-3 2xl:grid-cols-5',
  6: 'sm:grid-cols-2 lg:grid-cols-3',
}

function StatCard({ icon: Icon, label, value, highlight }: { icon: ComponentType<{ className?: string }>; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400"><Icon className="h-4 w-4" /> {label}</div>
      <div className={`mt-2 text-2xl font-bold ${highlight ? 'text-orange-900 dark:text-orange-200' : 'text-gray-900 dark:text-slate-100'}`}>{value}</div>
    </div>
  )
}

function ChecklistItem({ done, text, to }: { done: boolean; text: string; to?: string }) {
  const body = <>{done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-300" /> : <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />}{text}</>
  return (
    <li>
      {to
        ? <Link to={to} className="flex items-center gap-2 text-gray-700 hover:text-orange-900 dark:text-slate-200 dark:hover:text-orange-200">{body}</Link>
        : <span className="flex items-center gap-2 text-gray-700 dark:text-slate-200">{body}</span>}
    </li>
  )
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-orange-500 dark:border-slate-700 dark:border-t-orange-400" /></div>
}
