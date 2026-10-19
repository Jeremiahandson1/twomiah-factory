// Moved from templates/crm-store/frontend/src/pages/CustomersPage.tsx — the store's customers at /crm/customers, each
// with how many orders they have placed, what they have spent and when they last ordered.
//
// Changes from the template:
//   · the customers are the CRM's contacts (docs/UNIFIED_STORE_PLAN.md decision 2): GET /api/admin/orders/customers
//     answers { data, pagination } of contacts (was { customers }, derived from orders by email), each with its own
//     `id`; a row is keyed by that id (the template keyed by email) and opens the shopper's contact page,
//     /crm/contacts/:id, where their orders, emails and texts are — for a seat that may open contacts (contacts:read);
//   · the server pages the list (50 at a time; the template sent everyone at once), so the page has Previous / Next;
//   · lastOrderAt is null for a contact who has not ordered yet (a lead made a customer by hand): the cell reads "—";
//     spend is shown only where the reply carries it;
//   · brand-coloured text (links, the highlighted figure) is text-orange-900 dark:text-orange-200, the only brand shades
//     that read at 4.5:1 for every company colour (scripts/check-contrast-measured.ts) — the template's
//     text-primary-600 fell under it for a yellow or lime brand;
//   · the failure reads the server's sentence with its dark partner (the template's red text had none); every other ink
//     has its pair too, the empty-state icon included; the header wraps and the table scrolls inside its card.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, usePermissions } from '../../../../shared'
import { formatDate } from '../../../date'
import { cents, listOf } from './lib'

interface Customer {
  id: string; name: string; email: string | null; phone: string | null
  orderCount: number; totalSpentCents?: number | null; lastOrderAt: string | null
}
interface Pagination { page: number; limit: number; total: number; pages: number }

const LIMIT = 50

export default function CustomersPage() {
  const { known, can } = usePermissions()
  const mayOpenContact = !known || can('contacts:read')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  // A failed load used to fall through to 'No customers yet' — a shop told it has no customers because a request failed. (Store QA T1)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    api.get('/api/admin/orders/customers', { page, limit: LIMIT })
      .then((reply) => {
        if (!live) return
        setCustomers(listOf<Customer>(reply))
        const p = (reply as { pagination?: Pagination } | null)?.pagination
        setPagination(p && typeof p.total === 'number' ? p : null)
      })
      .catch((e) => { if (live) setError(errorText(e, "Couldn't load the customers")) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [page])

  const pages = Math.max(1, pagination?.pages ?? 1)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Customers</h1>
          {pagination && <p className="text-sm text-gray-500 dark:text-slate-400">{pagination.total} {pagination.total === 1 ? 'customer' : 'customers'}</p>}
        </div>
      </div>

      {loading ? <PageSpinner /> : error ? (
        <PageError message={`${error} — refresh to try again.`} />
      ) : customers.length === 0 ? (
        <div className="card p-10 text-center">
          <Users className="h-10 w-10 mx-auto text-gray-400 dark:text-slate-400" />
          <p className="mt-3 text-gray-500 dark:text-slate-400">No customers yet. They'll appear here after the first order.</p>
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500 border-b border-gray-200 dark:text-slate-400 dark:border-slate-800">
                <tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Orders</th><th className="px-4 py-3">Spent</th><th className="px-4 py-3 whitespace-nowrap">Last order</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                    <td className="px-4 py-3">
                      {mayOpenContact
                        ? <Link to={`/crm/contacts/${c.id}`} className="font-medium text-orange-900 hover:underline dark:text-orange-200">{c.name || c.email || 'Customer'}</Link>
                        : <div className="font-medium text-gray-900 dark:text-slate-100">{c.name || c.email || 'Customer'}</div>}
                      <div className="text-xs text-gray-500 dark:text-slate-400">{[c.email, c.phone].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{c.orderCount}</td>
                    <td className="px-4 py-3 font-medium whitespace-nowrap text-gray-900 dark:text-slate-100">{typeof c.totalSpentCents === 'number' ? cents(c.totalSpentCents) : '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-slate-400">{c.lastOrderAt ? formatDate(c.lastOrderAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600 dark:text-slate-300">
              <span>Page {page} of {pages}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn btn-secondary px-3 py-1.5"><ChevronLeft className="h-4 w-4" /> Previous</button>
                <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="btn btn-secondary px-3 py-1.5">Next <ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-orange-500 dark:border-slate-700 dark:border-t-orange-400" /></div>
}
