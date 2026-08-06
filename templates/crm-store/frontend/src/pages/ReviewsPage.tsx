import { useEffect, useState, useCallback } from 'react'
import { Star, Check, X, Trash2, ShieldCheck } from 'lucide-react'
import api, { type Review } from '../services/api'
import { useToast } from '../contexts/ToastContext'

// Reviews arrive as pending and only go public once approved — an open review
// box on a small store is a spam magnet.
export default function ReviewsPage() {
  const { toast } = useToast()
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [rows, setRows] = useState<Review[]>([])
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, c] = await Promise.all([api.listReviews(status), api.reviewCounts()])
      setRows(data)
      setCounts(c)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load reviews', 'error')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { void load() }, [load])

  const decide = async (id: string, next: 'approved' | 'rejected') => {
    try {
      await api.setReviewStatus(id, next)
      toast(next === 'approved' ? 'Review published' : 'Review rejected')
      void load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update review', 'error')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this review permanently?')) return
    try {
      await api.deleteReview(id)
      void load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete review', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
        <p className="text-gray-500">Approve what appears on your product pages.</p>
      </div>

      <div className="flex gap-2">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize ${status === s ? 'bg-gray-900 text-white' : 'bg-white border text-gray-600'}`}>
            {s}{s !== 'all' ? ` (${counts[s] ?? 0})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card p-10 text-center text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <Star className="h-9 w-9 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No {status === 'all' ? '' : status} reviews.</p>
          <p className="text-sm text-gray-400 mt-1">Customers are asked for one a few days after their order ships.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`h-4 w-4 ${n <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200'}`} />
                      ))}
                    </span>
                    {r.verifiedPurchase && (
                      <span className="text-xs text-green-700 flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Verified buyer</span>
                    )}
                  </div>
                  {r.title && <p className="font-medium text-gray-900 mt-1">{r.title}</p>}
                  {r.body && <p className="text-gray-600 text-sm mt-1 whitespace-pre-wrap">{r.body}</p>}
                  <p className="text-xs text-gray-400 mt-2">
                    {r.authorName} on {r.productName || 'product'} · {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {r.status !== 'approved' && (
                    <button onClick={() => decide(r.id, 'approved')} title="Publish" className="p-2 text-green-600 hover:bg-green-50 rounded-lg"><Check className="h-4 w-4" /></button>
                  )}
                  {r.status !== 'rejected' && (
                    <button onClick={() => decide(r.id, 'rejected')} title="Reject" className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><X className="h-4 w-4" /></button>
                  )}
                  <button onClick={() => remove(r.id)} title="Delete" className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
