// Moved from templates/crm-roof/frontend/src/pages/roofing/MaterialsPage.tsx. Material orders at /api/materials
// (server/crm/roof/field/materials.ts, the `materials` feature): { data, pagination }, each order with its job's
// `jobNumber` and its orderStatus as `status`.
//
// Changes from the template:
//   · the Total Cost column follows margin:read — the permission the server withholds an order's prices by — where the
//     template read a `moneyWithheld` flag the list no longer carries;
//   · the status filter offers the statuses an order can have (not ordered, ordered, partial, delivered, cancelled); the
//     template offered draft and shipped, which no order ever has, and lacked not ordered and partial;
//   · the total and the page count are the reply's pagination.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, usePermissions, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { supplierName } from '../lib/supplier'
import { listOf, paginationOf } from './http'

/** server/crm/roof/validation.ts MATERIAL_ORDER_STATUSES, each with its badge. */
const STATUS_COLORS: Record<string, string> = {
  not_ordered: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  ordered: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  partial: 'bg-purple-100 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40',
  delivered: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  cancelled: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
}

function formatStatus(s: string | null | undefined) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface MaterialOrder {
  id: string
  jobId: string | null
  jobNumber: string | null
  supplier: string | null
  status: string | null
  orderDate: string | null
  deliveryDate: string | null
  /** Absent for a seat without margin:read (the server withholds it). */
  totalCost?: string | number | null
}

const LIMIT = 25

export default function MaterialsPage() {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const navigate = useNavigate()
  // What the business paid: shown to the seats the server shows it to (margin:read). (T42)
  const showCost = usePermissions().can('margin:read')

  const [orders, setOrders] = useState<MaterialOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [supplierFilter, setSupplierFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [suppliers, setSuppliers] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const reply = await api.get('/api/materials', {
        page, limit: LIMIT,
        supplier: supplierFilter || undefined, status: statusFilter || undefined,
        dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
      })
      const items = listOf<MaterialOrder>(reply)
      const p = paginationOf(reply)
      setOrders(items)
      setTotal(p ? p.total : items.length)
      setPages(p ? Math.max(1, p.pages) : 1)
      // The supplier picker grows from the suppliers seen so far.
      const seen = items.map((o) => o.supplier).filter((s): s is string => !!s)
      setSuppliers((prev) => [...new Set([...prev, ...seen])])
    } catch (e) {
      toastRef.current.error(errorText(e, 'Failed to load material orders'))
    } finally {
      setLoading(false)
    }
  }, [page, supplierFilter, statusFilter, dateFrom, dateTo])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [supplierFilter, statusFilter, dateFrom, dateTo])

  const columns = showCost ? 6 : 5

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Material Orders</h1>
            <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">{total} {total === 1 ? 'order' : 'orders'}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Suppliers</option>
            {/* The value stays the stored slug — the server filters on it — and only the label is
                the supplier's name. (T41) */}
            {suppliers.map((s) => <option key={s} value={s}>{supplierName(s)}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Statuses</option>
            {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{formatStatus(s)}</option>)}
          </select>
          <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400">
            <span>From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400">
            <span>To</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b dark:bg-slate-900">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Job #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Order Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Delivery Date</th>
                  {showCost && (
                    <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Total Cost</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={columns} className="text-center py-12 text-gray-500 dark:text-slate-400">Loading...</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={columns} className="text-center py-12 text-gray-500 dark:text-slate-400">No material orders found</td></tr>
                ) : (
                  orders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => order.jobId && navigate(`/crm/jobs/${order.jobId}`)}
                      className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-700 dark:text-slate-200">
                        {/* jobNumber is the real "ROOF-0005"; never glue the raw
                            record id onto a "ROOF-" prefix as a fallback. */}
                        {order.jobNumber || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-slate-100">{supplierName(order.supplier) || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[order.status || ''] || 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'}`}>
                          {formatStatus(order.status) || 'Ordered'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs dark:text-slate-400">
                        {order.orderDate ? formatDate(order.orderDate) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs dark:text-slate-400">
                        {order.deliveryDate ? formatDate(order.deliveryDate) : '—'}
                      </td>
                      {showCost && (
                        <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-slate-100">
                          {order.totalCost != null ? `$${Number(order.totalCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 dark:bg-slate-900">
              <p className="text-xs text-gray-500 dark:text-slate-400">Page {page} of {pages}</p>
              <div className="flex gap-1">
                <button aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button aria-label="Next page" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
