import React, { useEffect, useState } from 'react'

// Google Business Profile reviews — connect the business's Google listing,
// see the rating + reviews, reply inline. OAuth runs through the factory
// broker; this page only starts the redirect and consumes tenant APIs.

interface Review {
  name: string
  reviewer: string
  starRating: string
  comment: string
  createTime: string
  reply: string | null
}

function getToken(): string {
  try { return localStorage.getItem('token') || localStorage.getItem('accessToken') || '' } catch { return '' }
}
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }
function Stars({ rating }: { rating: number }) {
  return <span className="text-yellow-500">{'★'.repeat(Math.round(rating))}<span className="text-gray-300">{'★'.repeat(5 - Math.round(rating))}</span></span>
}

export function GbpReviewsPage(): React.ReactElement {
  const [status, setStatus] = useState<any>(null)
  const [locations, setLocations] = useState<Array<{ accountName: string; locationName: string; title: string }>>([])
  const [summary, setSummary] = useState<{ averageRating: number | null; totalReviewCount: number } | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/gbp/status', { headers: authHeaders() })
      const d = await r.json()
      setStatus(d)
      if (d.connected && d.needsLocation) {
        const lr = await fetch('/api/gbp/locations', { headers: authHeaders() })
        const ld = await lr.json()
        if (!lr.ok) setError(ld.error || 'Could not list your Google locations')
        else setLocations(ld.locations || [])
      } else if (d.connected && d.locationName) {
        await loadReviews()
      }
    } catch { setError('Could not load Google Business status') }
    setLoading(false)
  }

  const loadReviews = async () => {
    setError('')
    const r = await fetch('/api/gbp/reviews', { headers: authHeaders() })
    const d = await r.json()
    if (!r.ok) { setError(d.error || 'Could not load reviews'); return }
    setSummary({ averageRating: d.averageRating, totalReviewCount: d.totalReviewCount })
    setReviews(d.reviews || [])
  }

  useEffect(() => { loadStatus() }, [])

  const connect = async () => {
    const ret = window.location.href.split('?')[0]
    const r = await fetch('/api/gbp/connect-url?return=' + encodeURIComponent(ret), { headers: authHeaders() })
    const d = await r.json()
    if (!r.ok || !d.url) { setError(d.error || 'Could not start Google sign-in'); return }
    window.location.assign(d.url)
  }

  const pickLocation = async (loc: { accountName: string; locationName: string; title: string }) => {
    setBusy(true)
    await fetch('/api/gbp/location', { method: 'POST', headers: authHeaders(), body: JSON.stringify(loc) })
    setBusy(false)
    await loadStatus()
  }

  const sendReply = async (reviewName: string) => {
    setBusy(true); setError('')
    const r = await fetch('/api/gbp/reviews/reply', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reviewName, comment: replyText }) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setError(d.error || 'Reply failed'); return }
    setReplyFor(null); setReplyText('')
    await loadReviews()
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Google Reviews</h1>
      <p className="text-sm text-gray-500 mb-6">Your Google Business Profile — where local customers find and judge you. Reply to every review; it matters more than any ad.</p>
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</div>}

      {!status?.connected && (
        <div className="bg-white border rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-4">Connect the Google account that manages your business listing. You'll approve access on Google's own sign-in page — we never see your password.</p>
          <button onClick={connect} className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold">Connect Google Business</button>
        </div>
      )}

      {status?.connected && status?.needsLocation && (
        <div className="bg-white border rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-3">Connected as <span className="font-mono">{status.email}</span>. Which listing is this business?</p>
          {locations.length === 0 && !error && <p className="text-sm text-gray-400">No listings found on that Google account.</p>}
          <div className="space-y-2">
            {locations.map(l => (
              <button key={l.locationName} disabled={busy} onClick={() => pickLocation(l)} className="block w-full text-left px-4 py-2 border rounded-md hover:bg-gray-50 text-sm">{l.title}</button>
            ))}
          </div>
        </div>
      )}

      {status?.connected && status?.locationName && (
        <>
          <div className="bg-white border rounded-lg p-5 mb-4 flex items-center gap-6">
            <div>
              <div className="text-3xl font-bold">{summary?.averageRating != null ? summary.averageRating.toFixed(1) : '—'}</div>
              {summary?.averageRating != null && <Stars rating={summary.averageRating} />}
            </div>
            <div className="text-sm text-gray-600">
              <div className="font-semibold text-gray-900">{status.locationTitle}</div>
              <div>{summary?.totalReviewCount ?? 0} reviews on Google</div>
            </div>
          </div>
          <div className="space-y-3">
            {reviews.map(r => (
              <div key={r.name} className="bg-white border rounded-lg p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">{r.reviewer}</span>
                  <span className="text-xs text-gray-400">{new Date(r.createTime).toLocaleDateString()}</span>
                </div>
                <Stars rating={STARS[r.starRating] || 0} />
                {r.comment && <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{r.comment}</p>}
                {r.reply ? (
                  <div className="mt-3 pl-3 border-l-2 border-gray-200 text-sm text-gray-600">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-1">Your reply</span>
                    {r.reply}
                  </div>
                ) : replyFor === r.name ? (
                  <div className="mt-3">
                    <textarea className="w-full border rounded-md p-2 text-sm min-h-[80px]" value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Thank them, address concerns…" />
                    <div className="flex gap-2 mt-2">
                      <button disabled={busy || !replyText.trim()} onClick={() => sendReply(r.name)} className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white rounded-md text-xs font-semibold">{busy ? 'Sending…' : 'Post reply'}</button>
                      <button onClick={() => { setReplyFor(null); setReplyText('') }} className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setReplyFor(r.name); setReplyText('') }} className="mt-2 text-xs font-semibold text-orange-600 hover:text-orange-700">Reply</button>
                )}
              </div>
            ))}
            {reviews.length === 0 && <p className="text-sm text-gray-400">No reviews yet.</p>}
          </div>
        </>
      )}
    </div>
  )
}
