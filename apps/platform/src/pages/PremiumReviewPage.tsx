import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, API_URL as API } from '../supabase'
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, ExternalLink, Eye, AlertTriangle } from 'lucide-react'

interface QueueItem {
  id: string
  businessName: string | null
  businessType: string | null
  city: string | null
  state: string | null
  email: string | null
  composedAt: string | null
  approvedAt: string | null
  approvedBy: string | null
  sectionCounts: Record<string, number>
  rationale: string | null
}

interface DetailIntake {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  industry: string | null
  intake_data: any
  preview_premium_pages: { pages: Record<string, { sections: any[] }>; rationale?: string } | null
  preview_premium_generated_at: string | null
  preview_premium_approved_at: string | null
}

const PAGES: Array<'home' | 'about' | 'services' | 'contact'> = ['home', 'about', 'services', 'contact']

export default function PremiumReviewPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved'>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || ''
  }, [])

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`${API}/api/v1/factory/intake/premium-queue?status=${statusFilter}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || res.statusText)
      setItems(json.items || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load queue')
    } finally {
      setLoading(false)
    }
  }, [getToken, statusFilter])

  useEffect(() => { loadQueue() }, [loadQueue])

  if (selectedId) {
    return (
      <ReviewDetail
        id={selectedId}
        onBack={() => { setSelectedId(null); loadQueue() }}
      />
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto text-white">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Premium preview review</h1>
          <p className="text-sm text-gray-400 mt-1">Compositions waiting for staff approval before the prospect sees them.</p>
        </div>
        <button onClick={loadQueue} className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 inline-flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {(['pending', 'approved'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={'px-3 py-1.5 rounded-full text-sm ' + (statusFilter === s ? 'bg-white text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700')}
          >
            {s === 'pending' ? 'Pending review' : 'Approved'}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-900/30 border border-red-700/50 text-red-200 rounded-lg p-3 text-sm mb-4">{error}</div>}
      {loading && <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}

      {!loading && items.length === 0 && (
        <div className="border border-gray-800 rounded-xl p-12 text-center text-gray-400">
          {statusFilter === 'pending' ? 'No pending compositions. New intakes will appear here once staff triggers the AI preview.' : 'No approved compositions yet.'}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Business</th>
                <th className="px-5 py-3 text-left font-semibold">Type / Location</th>
                <th className="px-5 py-3 text-left font-semibold">Section counts</th>
                <th className="px-5 py-3 text-left font-semibold">Composed</th>
                <th className="px-5 py-3 text-right font-semibold w-0"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-gray-900/40">
                  <td className="px-5 py-3">
                    <div className="font-semibold">{item.businessName || '(unnamed)'}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{item.email || '—'}</div>
                  </td>
                  <td className="px-5 py-3 text-gray-300">
                    <div>{item.businessType || '—'}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{[item.city, item.state].filter(Boolean).join(', ') || '—'}</div>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    <div className="flex gap-3 text-gray-300">
                      {PAGES.map(p => {
                        const n = item.sectionCounts?.[p] ?? 0
                        return (
                          <span key={p} className={n === 0 ? 'text-amber-400' : ''}>
                            {n === 0 && <AlertTriangle className="inline w-3 h-3 mr-0.5" />}
                            {p}: {n}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    {item.composedAt ? new Date(item.composedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => setSelectedId(item.id)}
                      className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 inline-flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ReviewDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [intake, setIntake] = useState<DetailIntake | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const [activePage, setActivePage] = useState<'home' | 'about' | 'services' | 'contact'>('home')
  const [editedPages, setEditedPages] = useState<Record<string, { sections: any[] }> | null>(null)
  const [busy, setBusy] = useState<'approving' | 'unapproving' | null>(null)
  const [showJsonEditor, setShowJsonEditor] = useState(false)
  const [jsonDraft, setJsonDraft] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const accessToken = data.session?.access_token || ''
        setToken(accessToken)
        const res = await fetch(`${API}/api/v1/factory/intake/${id}/premium-detail`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || res.statusText)
        setIntake(json.intake)
        setEditedPages(json.intake.preview_premium_pages?.pages || {})
      } catch (e: any) {
        setError(e.message || 'Failed to load intake')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  const previewUrl = useMemo(() => {
    if (!token) return ''
    const stem = `${API}/api/v1/factory/intake/${id}/preview-premium-staff`
    const slug = activePage === 'home' ? '' : '/' + activePage
    return stem + slug + '?token=' + encodeURIComponent(token) + '&_t=' + Date.now()
  }, [id, token, activePage])

  const sectionsForActive = useMemo(() => {
    return editedPages?.[activePage]?.sections || []
  }, [editedPages, activePage])

  const openJsonEditor = () => {
    setJsonDraft(JSON.stringify(editedPages?.[activePage] || { sections: [] }, null, 2))
    setShowJsonEditor(true)
  }

  const saveJsonEdit = () => {
    try {
      const parsed = JSON.parse(jsonDraft)
      if (!parsed || !Array.isArray(parsed.sections)) {
        setError('JSON must have a sections[] array')
        return
      }
      setEditedPages(p => ({ ...(p || {}), [activePage]: parsed }))
      setShowJsonEditor(false)
      setError('')
    } catch (e: any) {
      setError('Invalid JSON: ' + e.message)
    }
  }

  const approve = async () => {
    if (!editedPages) return
    setBusy('approving')
    setError('')
    try {
      const res = await fetch(`${API}/api/v1/factory/intake/${id}/approve-premium`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: editedPages }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || res.statusText)
      onBack()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const unapprove = async () => {
    if (!confirm('Revoke approval? The public preview link will return to "pending review".')) return
    setBusy('unapproving')
    setError('')
    try {
      const res = await fetch(`${API}/api/v1/factory/intake/${id}/unapprove-premium`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || res.statusText)
      onBack()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div className="p-6 text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
  if (!intake) return <div className="p-6 text-red-400 text-sm">{error || 'Intake not found.'}</div>

  const intakeData = intake.intake_data?.intake || {}
  const alreadyApproved = !!intake.preview_premium_approved_at

  return (
    <div className="h-full flex flex-col text-white">
      <div className="px-6 py-3 border-b border-gray-800 bg-gray-900 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-white flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" />
          Queue
        </button>
        <div className="w-px h-5 bg-gray-700" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{intake.name || '(unnamed)'}</div>
          <div className="text-xs text-gray-500 truncate">{intake.email || '—'} · {[intake.city, intake.state].filter(Boolean).join(', ') || '—'}</div>
        </div>
        {error && <div className="text-sm text-red-400">{error}</div>}
        {alreadyApproved ? (
          <button onClick={unapprove} disabled={busy !== null} className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-sm disabled:opacity-50">
            {busy === 'unapproving' ? 'Working…' : 'Revoke approval'}
          </button>
        ) : (
          <button onClick={approve} disabled={busy !== null} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
            <CheckCircle2 className="w-4 h-4" />
            {busy === 'approving' ? 'Approving…' : 'Approve & send'}
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: intake details + sections list */}
        <div className="w-[420px] shrink-0 border-r border-gray-800 overflow-auto p-5 bg-gray-950">
          <section className="mb-6">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Intake</h3>
            <div className="space-y-2 text-sm">
              <KV label="Type" value={intake.industry || intakeData.businessType || '—'} />
              <KV label="Phone" value={intake.phone || intakeData.phone || '—'} />
              <KV label="Services" value={(intakeData.services || []).join(', ') || '—'} multiline />
              <KV label="Description" value={intakeData.description || '—'} multiline />
              <KV label="Goals" value={(intakeData.goals || []).join(' · ') || '—'} multiline />
              <KV label="Competitors" value={(intakeData.competitors || []).join(' · ') || '—'} multiline />
              <KV label="Nearby cities" value={(intakeData.nearbyCities || []).join(', ') || '—'} />
            </div>
          </section>

          {intake.preview_premium_pages?.rationale && (
            <section className="mb-6">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Model rationale</h3>
              <p className="text-sm text-gray-300 italic">{intake.preview_premium_pages.rationale}</p>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wider text-gray-500">Sections — {activePage}</h3>
              <button onClick={openJsonEditor} className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">Edit JSON</button>
            </div>
            {sectionsForActive.length === 0 && (
              <div className="text-sm text-amber-400 bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>This page has no sections. Approving would publish a blank page.</div>
              </div>
            )}
            <ol className="space-y-1.5 mt-2">
              {sectionsForActive.map((s: any, i: number) => (
                <li key={i} className="text-sm border border-gray-800 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">{String(i + 1).padStart(2, '0')}</div>
                  <div className="font-mono text-gray-300">{s?.type}/{s?.variant}</div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* Right: page tabs + preview iframe */}
        <div className="flex-1 flex flex-col bg-white">
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-100 flex items-center gap-2 shrink-0">
            {PAGES.map(p => (
              <button
                key={p}
                onClick={() => setActivePage(p)}
                className={'text-sm px-3 py-1.5 rounded ' + (activePage === p ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-200')}
              >
                {p}
                {(editedPages?.[p]?.sections?.length ?? 0) === 0 && <AlertTriangle className="inline w-3 h-3 ml-1 text-amber-600" />}
              </button>
            ))}
            <div className="flex-1" />
            {previewUrl && (
              <a href={previewUrl} target="_blank" rel="noreferrer" className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1.5">
                <ExternalLink className="w-3 h-3" />
                Open in new tab
              </a>
            )}
          </div>
          {previewUrl ? (
            <iframe src={previewUrl} className="flex-1 w-full border-0" title="Staff preview" />
          ) : (
            <div className="flex-1 grid place-items-center text-gray-500 text-sm">Loading preview…</div>
          )}
        </div>
      </div>

      {/* JSON editor modal */}
      {showJsonEditor && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setShowJsonEditor(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <div className="font-semibold">Edit sections JSON — {activePage}</div>
              <button onClick={() => setShowJsonEditor(false)} className="text-sm text-gray-400 hover:text-white">Close</button>
            </div>
            <textarea
              value={jsonDraft}
              onChange={(e) => setJsonDraft(e.target.value)}
              className="flex-1 bg-gray-950 text-gray-200 font-mono text-xs p-4 border-0 outline-none resize-none"
            />
            <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button onClick={() => setShowJsonEditor(false)} className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm">Cancel</button>
              <button onClick={saveJsonEdit} className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold">Apply (preview will refresh after Save)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KV({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={'grid ' + (multiline ? 'grid-cols-1 gap-0.5' : 'grid-cols-[110px_1fr] gap-2')}>
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-sm text-gray-200 break-words">{value}</div>
    </div>
  )
}
