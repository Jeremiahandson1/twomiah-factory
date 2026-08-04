import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DollarSign, ShoppingBag, Package, AlertCircle, CheckCircle2, ArrowRight , Truck } from 'lucide-react'
import api, { Order, Product, PaymentStatus } from '../services/api'
import { money, formatDate, statusColor } from '../lib/format'

export default function DashboardPage() {
  const [stats, setStats] = useState({ paidCount: 0, pendingFulfillment: 0, revenueCents: 0, atSupplier: 0 })
  const [orders, setOrders] = useState<Order[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [payment, setPayment] = useState<PaymentStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.orderStats(), api.listOrders(), api.listProducts(), api.getPaymentStatus()])
      .then(([s, o, p, pay]) => { setStats(s); setOrders(o.slice(0, 5)); setProducts(p); setPayment(pay) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const activeProducts = products.filter((p) => p.status === 'active').length
  const paymentsConnected = payment?.config?.connected
  const setupDone = paymentsConnected && activeProducts > 0

  if (loading) return <PageSpinner />

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {!setupDone && (
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-3">Finish setting up your store</h2>
          <ul className="space-y-2 text-sm">
            <ChecklistItem done={activeProducts > 0} to="/products"
              text={activeProducts > 0 ? `${activeProducts} product(s) live` : 'Add and activate your first product'} />
            <ChecklistItem done={!!paymentsConnected} to="/payments"
              text={paymentsConnected ? 'Payments connected' : 'Connect your payment account to accept orders'} />
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={DollarSign} label="Revenue" value={money(stats.revenueCents)} />
        <StatCard icon={ShoppingBag} label="Orders" value={String(stats.paidCount)} />
        <StatCard icon={Package} label="To fulfill" value={String(stats.pendingFulfillment)} highlight={stats.pendingFulfillment > 0} />
        {stats.atSupplier > 0 && <StatCard icon={Truck} label="At supplier" value={String(stats.atSupplier)} />}
      </div>

      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Recent orders</h2>
          <Link to="/orders" className="text-sm text-primary-600 flex items-center gap-1">View all <ArrowRight className="h-3 w-3" /></Link>
        </div>
        {orders.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">No orders yet.</p>
        ) : (
          <div className="divide-y">
            {orders.map((o) => (
              <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <div className="font-medium text-sm text-gray-900">{o.orderNumber || 'Pending'}</div>
                  <div className="text-xs text-gray-500">{o.customerEmail} · {formatDate(o.createdAt)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(o.status)}`}>{o.status}</span>
                  <span className="font-medium text-sm">{money(o.totalCents, o.currency)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, highlight }: { icon: any; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-sm text-gray-500"><Icon className="h-4 w-4" /> {label}</div>
      <div className={`mt-2 text-2xl font-bold ${highlight ? 'text-primary-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  )
}

function ChecklistItem({ done, text, to }: { done: boolean; text: string; to: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-2 text-gray-700 hover:text-primary-600">
        {done ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-yellow-500" />}
        {text}
      </Link>
    </li>
  )
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
}
