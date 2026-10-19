// Moved from templates/crm-homecare/frontend/src/pages/PerformanceReviewsPage.tsx (/crm/performance-reviews — reached
// from AdminDashboard's renderPage, not from its menu). Caregiver performance reviews with ratings and notes.
//
// GET  /api/performance-reviews (hr/performanceReviews.ts, care-hr:read) → { data }: caregiverName, reviewDate,
//      satisfactionScore, strengths, areasForImprovement. The template read `rating` and `improvements` (no reply has
//      them: every card showed no stars and no improvements) — read from satisfactionScore / areasForImprovement here.
//      `reviewer` and `goals` are not stored (reported).
// POST /api/performance-reviews (care-hr:create) requires caregiverId AND clientId; this form has no client, so the
//      server refuses it ("Caregiver and Client are required") — the template ignored the refusal and closed the form as
//      if saved. The refusal now shows. (Reported: the form needs a client picker, or the page retired in favour of
//      /crm/performance, which writes the same reviews.)
import { useEffect, useState, type FormEvent } from 'react'
import { Award, Loader2, Plus, Star } from 'lucide-react'
import { useToast } from '../../../../shared'
import { api, errorMessage, rows } from '../lib/http'
import { formatDate } from '../lib/date'

interface Review {
  id: string
  caregiverId: string
  caregiverName: string | null
  reviewDate: string | null
  satisfactionScore: number | null
  strengths: string
  areasForImprovement: string
  /** Not in the reply. */
  reviewer?: string | null
  goals?: string | null
}

const EMPTY = { caregiverId: '', rating: 5, reviewDate: '', reviewer: '', strengths: '', improvements: '', goals: '', notes: '' }
const fieldCls = 'border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100'

export default function PerformanceReviewsPage() {
  const toast = useToast()
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(EMPTY)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setReviews(rows<Review>(await api.get('/api/performance-reviews')))
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      // The template's body, plus the names the route reads for the same boxes (areasForImprovement, performanceNotes).
      await api.post('/api/performance-reviews', {
        ...form, rating: Number(form.rating), areasForImprovement: form.improvements, performanceNotes: form.notes,
      })
      setShowCreate(false)
      setForm(EMPTY)
      load()
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the review'))
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-teal-700 dark:text-teal-300" /></div>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-slate-100"><Award className="w-6 h-6 text-teal-700 dark:text-teal-300" />Performance Reviews</h1>
          <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">Quarterly and annual caregiver performance tracking</p>
        </div>
        {/* teal-700: white text on the template's teal-500 was 2.5:1. */}
        <button onClick={() => setShowCreate(true)} className="bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />New Review</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reviews.length === 0 ? <div className="col-span-full bg-white rounded-lg border border-gray-200 dark:border-slate-700 p-12 text-center text-gray-500 dark:bg-slate-900 dark:text-slate-400">No performance reviews yet.</div> :
          reviews.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-gray-200 dark:border-slate-700 p-5 dark:bg-slate-900 text-gray-900 dark:text-slate-100">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold">{r.caregiverName || r.caregiverId}</div>
                  <div className="text-xs text-gray-600 dark:text-slate-400">{r.reviewDate ? formatDate(r.reviewDate) : '—'} · by {r.reviewer || '—'}</div>
                </div>
                <div className="flex items-center gap-0.5">{[1, 2, 3, 4, 5].map((s) => <Star key={s} className={`w-4 h-4 ${s <= (r.satisfactionScore || 0) ? 'fill-yellow-400 text-yellow-500' : 'text-gray-300 dark:text-slate-600'}`} />)}</div>
              </div>
              {r.strengths && <div className="text-sm mb-2"><span className="font-semibold text-green-700 dark:text-green-400">Strengths:</span> {r.strengths}</div>}
              {r.areasForImprovement && <div className="text-sm mb-2"><span className="font-semibold text-yellow-800 dark:text-yellow-300">Improvements:</span> {r.areasForImprovement}</div>}
              {r.goals && <div className="text-sm"><span className="font-semibold text-blue-700 dark:text-blue-300">Goals:</span> {r.goals}</div>}
            </div>
          ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[2000]">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 dark:bg-slate-900 text-gray-900 dark:text-slate-100">
            <h2 className="text-xl font-bold mb-4">New Performance Review</h2>
            <form onSubmit={create} className="space-y-3">
              <input required placeholder="Caregiver ID" value={form.caregiverId} onChange={(e) => setForm({ ...form, caregiverId: e.target.value })} className={`w-full ${fieldCls}`} />
              <div className="grid grid-cols-2 gap-3">
                <input type="date" value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} className={fieldCls} />
                <select value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} className={fieldCls}>{[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r} star{r !== 1 ? 's' : ''}</option>)}</select>
              </div>
              <input placeholder="Reviewer name" value={form.reviewer} onChange={(e) => setForm({ ...form, reviewer: e.target.value })} className={`w-full ${fieldCls}`} />
              <textarea placeholder="Strengths" value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} rows={2} className={`w-full ${fieldCls}`} />
              <textarea placeholder="Areas for improvement" value={form.improvements} onChange={(e) => setForm({ ...form, improvements: e.target.value })} rows={2} className={`w-full ${fieldCls}`} />
              <textarea placeholder="Goals" value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} rows={2} className={`w-full ${fieldCls}`} />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg">Create</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
