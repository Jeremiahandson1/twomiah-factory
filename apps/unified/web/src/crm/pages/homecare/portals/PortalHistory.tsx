// The client portal's Visit History: completed visits, newest first, ten at a time. Moved from
// templates/crm-homecare/frontend/src/components/portal/PortalHistory.tsx.
//
// Server: GET /api/portal/history?limit&offset (server/crm/homecare/portals/clientPortal.ts) — a list ({ data,
// pagination: { total } }) of { id, startTime, endTime, durationMinutes, notes, caregiverFirstName, caregiverLastName }.
import { useEffect, useState } from 'react'
import { formatAgencyDateTime } from '../lib/agencyClock'
import { usePortal } from './portalHttp'

interface HistoryVisit {
  id: string
  startTime: string | null
  durationMinutes: number | null
  notes: string | null
  caregiverFirstName: string | null
  caregiverLastName: string | null
}
interface HistoryPage { data?: HistoryVisit[]; pagination?: { total?: number } }

const formatDuration = (minutes: number | null) => {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// A visit's clock-in, on the agency's clock (lib/agencyClock), not the browser's.
const formatDateTime = (iso: string | null) => (iso ? formatAgencyDateTime(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—')

const LIMIT = 10

export default function PortalHistory() {
  const portal = usePortal()
  const [visits, setVisits] = useState<HistoryVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const loadVisits = (reset = false) => {
    const newOffset = reset ? 0 : offset
    setLoading(true)
    portal.get<HistoryPage>(`/api/portal/history?limit=${LIMIT}&offset=${newOffset}`)
      .then((reply) => {
        if (!reply) return
        const page = Array.isArray(reply.data) ? reply.data : []
        setVisits((prev) => (reset ? page : [...prev, ...page]))
        setOffset(newOffset + LIMIT)
        // More when the server counts past this page (the template guessed from a full page).
        const total = Number(reply.pagination?.total)
        setHasMore(Number.isFinite(total) ? newOffset + page.length < total : page.length === LIMIT)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadVisits(true) }, [portal]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && visits.length === 0) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--hc-muted)' }}>Loading visit history...</div>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: 'var(--hcp-navy)' }}>🕐 Visit History</h2>

      {visits.length === 0 ? (
        <div style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '48px', textAlign: 'center', color: 'var(--hc-muted)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📋</div>
          <div>No visit history yet.</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {visits.map((visit) => (
              <div
                key={visit.id}
                style={{
                  background: 'var(--hc-surface)', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--hc-ink)', marginBottom: '3px' }}>{formatDateTime(visit.startTime)}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)' }}>with {visit.caregiverFirstName} {visit.caregiverLastName}</div>
                  {visit.notes && <div style={{ fontSize: '0.8rem', color: 'var(--hc-muted)', marginTop: '4px' }}>📝 {visit.notes}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ background: 'var(--hc-success-bg)', color: 'var(--hc-success-ink)', padding: '4px 12px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600 }}>
                    ✓ {formatDuration(visit.durationMinutes)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <button
                onClick={() => loadVisits(false)}
                disabled={loading}
                className="hc-btn"
                style={{ background: 'transparent', color: 'var(--hc-blue-ink)', border: '1px solid var(--hc-blue-ink)' }}
              >
                {loading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
