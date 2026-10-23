// Moved from templates/crm-store/frontend/src/pages/ReviewsPage.tsx. Product review moderation at /api/admin/reviews
// (server/crm/store/catalog/reviews.ts): the queue (reviews:read), publish or reject (reviews:update, staff's), delete for
// good (reviews:delete, the manager's). Reviews arrive pending and show on the storefront only once approved.
//
// Changes from the template:
//   · at /crm/product-reviews, not /crm/reviews: the shared menu's /crm/reviews is the CRM's Google review requests
//     (the google_reviews feature) and the address must name one page;
//   · the queue is the reply's `data` (unchanged), the counts GET /counts as before; the app's API client, toasts and the
//     shared confirm dialog (the template used window.confirm);
//   · the selected filter's ground in dark mode: the template's class list ended in dark:bg-slate-900 for every button,
//     so the selected one (white on gray-900 in light) was white on the page's own slate in dark — now each state has
//     its pair; the empty stars (gray-200) have their dark partner;
//   · in the "all" view each review says where it stands (pending, approved, rejected) — the template showed the same
//     card for all three;
//   · the dates through crm/date.ts; the filter buttons wrap at phone width.
import { useCallback, useEffect, useState } from 'react'
import { Check, ShieldCheck, Star, Trash2, X } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useConfirm, useMayWrite, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { listOf, type Review } from './lib'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

type Filter = 'pending' | 'approved' | 'rejected' | 'all'
const FILTERS: Filter[] = ['pending', 'approved', 'rejected', 'all']
const STATUS_BADGE: Record<Review['status'], string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  approved: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  rejected: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
}

export default function ReviewsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState<Filter>('pending')
  const [rows, setRows] = useState<Review[]>([])
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Staff publish or reject; deleting a review for good is the manager's.
  const mayDecide = useMayWrite('reviews:update')
  const mayDelete = useMayWrite('reviews:delete')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, c] = await Promise.all([api.get('/api/admin/reviews', { status }), api.get('/api/admin/reviews/counts')])
      setRows(listOf<Review>(data))
      setCounts({ pending: Number(c?.pending ?? 0), approved: Number(c?.approved ?? 0), rejected: Number(c?.rejected ?? 0) })
      setError(null)
    } catch (err) {
      setError(errorText(err, 'Could not load the reviews'))
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { void load() }, [load])

  const decide = async (id: string, next: 'approved' | 'rejected') => {
    try {
      await api.patch(`/api/admin/reviews/${id}`, { status: next })
      toast.success(next === 'approved' ? 'Review published' : 'Review rejected')
      void load()
    } catch (err) {
      toast.error(errorText(err, 'Could not update the review'))
    }
  }

  const remove = async (r: Review) => {
    if (!(await confirm(`Delete ${r.authorName}'s review for good? It cannot be brought back.`, { title: 'Delete review', confirmText: 'Delete' }))) return
    try {
      await api.delete(`/api/admin/reviews/${r.id}`)
      toast.success('Review deleted')
      void load()
    } catch (err) {
      toast.error(errorText(err, 'Could not delete the review'))
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Product reviews</h1>
        <p className="text-gray-600 dark:text-slate-300">Approve what appears on your product pages.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show reviews">
        {FILTERS.map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize border ${status === s
              ? 'bg-gray-900 border-gray-900 text-white dark:bg-slate-100 dark:border-slate-100 dark:text-slate-900'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            {s}{s !== 'all' ? ` (${counts[s] ?? 0})` : ''}
          </button>
        ))}
      </div>

      <PageError message={error} />

      {loading ? (
        <div className="card p-10 text-center text-gray-600 dark:text-slate-400">Loading…</div>
      ) : error ? null : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <Star className="h-9 w-9 text-gray-400 mx-auto mb-3 dark:text-slate-500" />
          <p className="text-gray-700 dark:text-slate-300">No {status === 'all' ? '' : `${status} `}reviews.</p>
          <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">Customers are asked for one a few days after their order ships.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex" aria-label={`${r.rating} out of 5`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} aria-hidden="true" className={`h-4 w-4 ${n <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300 dark:text-slate-600'}`} />
                      ))}
                    </span>
                    {r.verifiedPurchase && (
                      <span className="text-xs text-green-700 flex items-center gap-1 dark:text-green-300"><ShieldCheck className="h-3 w-3" /> Verified buyer</span>
                    )}
                    {status === 'all' && <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[r.status]}`}>{codeLabel(r.status)}</span>}
                  </div>
                  {r.title && <p className="font-medium text-gray-900 mt-1 break-words dark:text-slate-100">{r.title}</p>}
                  {r.body && <p className="text-gray-700 text-sm mt-1 whitespace-pre-wrap break-words dark:text-slate-300">{r.body}</p>}
                  <p className="text-xs text-gray-600 mt-2 dark:text-slate-400">
                    {r.authorName} on {r.productName || 'a product'} · {formatDate(r.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {mayDecide && r.status !== 'approved' && (
                    <button type="button" onClick={() => decide(r.id, 'approved')} title="Publish" aria-label="Publish" className="p-2 text-green-700 hover:bg-green-50 rounded-lg dark:text-green-300 dark:hover:bg-green-950/40"><Check className="h-4 w-4" /></button>
                  )}
                  {mayDecide && r.status !== 'rejected' && (
                    <button type="button" onClick={() => decide(r.id, 'rejected')} title="Reject" aria-label="Reject" className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg dark:text-slate-400 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
                  )}
                  {mayDelete && <button type="button" onClick={() => remove(r)} title="Delete" aria-label="Delete" className="p-2 text-red-700 hover:bg-red-50 rounded-lg dark:text-red-300 dark:hover:bg-red-950/40"><Trash2 className="h-4 w-4" /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
