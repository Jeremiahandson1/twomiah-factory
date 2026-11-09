// The customer's rating of a visit, on the job page (landscaping parity row 31, Jobber's feedback): what they gave, their comment,
// flagged when it is under the business's alert line. GET /api/visit-reports/job/:jobId (jobs:read), behind visit_reports and
// visit_survey. Landscaping live test 11/08: a 2 of 5 showed nowhere in the office but small stars on Visit messages.
import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { api } from '../../../api'
import { useAuth } from '../../../shared'

export default function VisitRatingPanel({ jobId }: { jobId: string }) {
  const { hasFeature } = useAuth()
  const on = hasFeature('visit_reports') && hasFeature('visit_survey')
  const [r, setR] = useState<{ rating: number | null; ratingComment: string | null } | null>(null)
  const [below, setBelow] = useState(3)
  useEffect(() => {
    if (!on || !jobId) return
    api.get(`/api/visit-reports/job/${jobId}`).then((x: any) => setR(x)).catch(() => setR(null))
    api.get('/api/visit-reports/settings').then((x: any) => { if (Number(x?.alertBelow)) setBelow(Number(x.alertBelow)) }).catch(() => {})
  }, [on, jobId])
  if (!on || r?.rating == null) return null
  const low = r.rating < below
  return (
    <section aria-label="The customer's rating" className={`rounded-xl border p-4 ${low ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40' : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-slate-100"><Star className="h-5 w-5" aria-hidden />Customer rating</h2>
      <p className="text-sm text-gray-900 dark:text-slate-100">{r.rating} of 5{low ? ' — low rating' : ''}</p>
      {r.ratingComment && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-slate-200">“{r.ratingComment}”</p>}
    </section>
  )
}
