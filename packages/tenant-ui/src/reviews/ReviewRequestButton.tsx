// "Send review request" — ask one customer for a Google review now, from a job or from the customer's page.
// Live test 2026-10-22 (landscaping, contractor, roofing): requests were only ever made by finishing a job with
// Auto-Request on, which is off until the owner turns it on, and there was no way to ask anyone by hand.
//   job      POST /api/reviews/request/:jobId          (the job's customer)
//   contact  POST /api/reviews/request-contact/:id     (no job behind it)
// Both ask marketing:create on the server, so the button asks the same; both are Review Requests' (google_reviews).
// The server answers with a sentence when nothing can go: no review link set, no mobile or email on file, or what
// the text or the email said back — shown as it is.
import { useState } from 'react'
import { Star } from 'lucide-react'
import { useMayWrite } from '../auth/PermissionsContext'

interface Api { post: (path: string, body?: any) => Promise<any> }
interface Toast { success: (m: string) => void; error: (m: string) => void }

export function ReviewRequestButton({ api, toast, jobId, contactId, hasFeature, className }: {
  api: Api; toast: Toast; jobId?: string; contactId?: string
  /** The app's own feature check. Absent: the button is not offered (a screen that cannot tell must not guess). */
  hasFeature?: (id: string) => boolean
  className?: string
}) {
  const mayAsk = useMayWrite('marketing:create')
  const [busy, setBusy] = useState(false)
  if (!hasFeature || !hasFeature('google_reviews') || !mayAsk || (!jobId && !contactId)) return null
  const send = async () => {
    setBusy(true)
    try {
      const r = await api.post(jobId ? `/api/reviews/request/${jobId}` : `/api/reviews/request-contact/${contactId}`, { channel: 'both' })
      // Where it went ("emailed to …"), and why the other way didn't go — never a bare "sent" (server sentSummary).
      toast.success(typeof r?.summary === 'string' && r.summary ? r.summary : 'Review request sent')
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'The review request could not be sent')
    } finally { setBusy(false) }
  }
  return (
    <button type="button" onClick={send} disabled={busy} data-testid="send-review-request"
      className={className || 'px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2'}>
      <Star className="w-4 h-4" />{busy ? 'Sending…' : 'Send review request'}
    </button>
  )
}

export default ReviewRequestButton
