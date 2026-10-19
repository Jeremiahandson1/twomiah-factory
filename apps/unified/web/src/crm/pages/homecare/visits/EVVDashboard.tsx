// Moved from templates/crm-homecare/frontend/src/components/admin/EVVDashboard.tsx — the office's Electronic Visit
// Verification records.
//
// Server (server/crm/homecare/visits/evv.ts, the office's evv permission): GET /api/evv?page&limit&status&startDate&
// endDate → { data, pagination } (the template answered { visits, total }); each row camelCase: serviceDate
// (YYYY-MM-DD), serviceCode, modifier, actualStart, actualEnd, unitsOfService, gpsInLat / gpsInLng, isVerified,
// sandataStatus, sandataExceptionCode / Desc, evvMethod, timeEntry { startTime, endTime, durationMinutes },
// client { firstName, lastName, mcoMemberId }. PATCH /api/evv/:id/verify.
//
// Changes from the template: no token; the list and its total read from the list reply; a refusal to verify shows the
// server's sentence; the app's toast; clock times are instants printed on the agency's clock (the template ran them
// through parseLocalDate, which would read an instant at exactly UTC midnight as a calendar day); the badges were white
// on light fills (orange 2.1:1, green 2.8:1) and are now ink-on-ground pairs in both themes; the stat tiles are
// hc-stat-card and the table hc-table (the template's data-table had no style at all).
import { useEffect, useState } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { formatDate } from '../lib/date'
import { formatAgencyDateTime } from '../lib/agencyClock'
import { useToast } from '../../../../shared'
import { useMay } from '../lib/useMay'

/** A row of GET /api/evv. */
interface EvvVisit {
  id: string
  serviceDate: string | null
  serviceCode: string | null
  modifier: string | null
  actualStart: string | null
  actualEnd: string | null
  unitsOfService: string | number | null
  gpsInLat: string | number | null
  gpsInLng: string | number | null
  isVerified: boolean | null
  sandataStatus: string | null
  sandataExceptionCode: string | null
  sandataExceptionDesc: string | null
  evvMethod: string | null
  timeEntry: { startTime: string | null; endTime: string | null; durationMinutes: number | null } | null
  client: { firstName: string | null; lastName: string | null; mcoMemberId: string | null } | null
}

const formatTime = (value: string | null | undefined) => {
  const t = formatAgencyDateTime(value, { hour: 'numeric', minute: '2-digit' })
  return t || '—'
}

const CHIP = 'inline-block rounded px-2 py-1 text-xs font-bold'
// Each Sandata status: ground + ink, light and dark.
const SANDATA_CHIP: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  submitted: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200',
  accepted: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
  error: 'bg-red-200 text-red-950 dark:bg-red-950 dark:text-red-200',
  not_submitted: 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200',
}
const NEUTRAL_CHIP = 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200'

const EVVDashboard = () => {
  const toast = useToast()
  // Verifying is the office's evv:delete (server visits/evv.ts) — offered only to whoever holds it (lib/useMay.ts).
  const may = useMay('evv')
  const [visits, setVisits] = useState<EvvVisit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState({ status: '', startDate: '', endDate: '' })
  const limit = 50

  const loadVisits = async () => {
    setLoading(true)
    try {
      const reply = await api.get('/api/evv', {
        page, limit,
        status: filter.status || undefined,
        startDate: filter.startDate || undefined,
        endDate: filter.endDate || undefined,
      })
      setVisits(rows<EvvVisit>(reply))
      setTotal(Number((reply as { pagination?: { total?: number } })?.pagination?.total) || 0)
    } catch (error) {
      console.error('Failed to load EVV visits:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadVisits() }, [page, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const verifyVisit = async (visitId: string) => {
    try {
      await api.patch(`/api/evv/${visitId}/verify`)
      toast.success('Visit verified')
      loadVisits()
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to verify visit'))
    }
  }

  const sandataBadge = (status: string | null) => (
    <span className={`${CHIP} ${SANDATA_CHIP[status || 'pending'] || NEUTRAL_CHIP}`}>
      {(status || 'pending').replace('_', ' ').toUpperCase()}
    </span>
  )

  const verifiedBadge = (isVerified: boolean | null, hasGps: boolean) => {
    if (isVerified) return <span className={`${CHIP} ${SANDATA_CHIP.accepted}`}>VERIFIED</span>
    if (hasGps) return <span className={`${CHIP} ${SANDATA_CHIP.pending}`}>GPS OK</span>
    return <span className={`${CHIP} ${NEUTRAL_CHIP}`}>UNVERIFIED</span>
  }

  // Summary stats
  const verifiedCount = visits.filter((v) => v.isVerified).length
  const acceptedCount = visits.filter((v) => v.sandataStatus === 'accepted').length
  const rejectedCount = visits.filter((v) => v.sandataStatus === 'rejected' || v.sandataStatus === 'error').length
  const totalPages = Math.ceil(total / limit)
  const small = { fontSize: '0.75rem', color: 'var(--hc-muted)' }

  return (
    <div className="container">
      <div className="page-header">
        <h2>📍 EVV Dashboard</h2>
        <button className="hc-btn hc-btn-secondary" onClick={loadVisits}>Refresh</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '1rem' }}>
        <div className="hc-stat-card">
          <h3>Total Visits</h3>
          <div className="value">{total}</div>
        </div>
        <div className="hc-stat-card">
          <h3>Verified</h3>
          <div className="value value-success">{verifiedCount}</div>
          <small style={small}>This page</small>
        </div>
        <div className="hc-stat-card">
          <h3>Sandata Accepted</h3>
          <div className="value" style={{ color: 'var(--hc-blue-ink)' }}>{acceptedCount}</div>
          <small style={small}>This page</small>
        </div>
        <div className="hc-stat-card">
          <h3>Rejected/Error</h3>
          <div className="value value-danger">{rejectedCount}</div>
          <small style={small}>This page</small>
        </div>
      </div>

      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Sandata Status</label>
            <select value={filter.status} onChange={(e) => { setFilter({ ...filter, status: e.target.value }); setPage(1) }}>
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="submitted">Submitted</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Start Date</label>
            <input type="date" value={filter.startDate} onChange={(e) => { setFilter({ ...filter, startDate: e.target.value }); setPage(1) }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>End Date</label>
            <input type="date" value={filter.endDate} onChange={(e) => { setFilter({ ...filter, endDate: e.target.value }); setPage(1) }} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (
        <div className="hc-card" style={{ overflowX: 'auto' }}>
          <table className="hc-table">
            <thead>
              <tr>
                <th>Service Date</th>
                <th>Client</th>
                <th>Service Code</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Units</th>
                <th>GPS / Verified</th>
                <th>Sandata</th>
                <th>Method</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visits.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>No EVV visits found</td></tr>
              ) : visits.map((v) => {
                const hasGps = v.gpsInLat != null && v.gpsInLng != null
                return (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600 }}>{formatDate(v.serviceDate)}</td>
                    <td>
                      {v.client ? `${v.client.firstName || ''} ${v.client.lastName || ''}`.trim() || '—' : '—'}
                      {v.client?.mcoMemberId && <div style={small}>MCO: {v.client.mcoMemberId}</div>}
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>
                      {v.serviceCode || '—'}
                      {v.modifier ? <span style={{ color: 'var(--hc-muted)' }}>:{v.modifier}</span> : ''}
                    </td>
                    <td>{formatTime(v.actualStart || v.timeEntry?.startTime)}</td>
                    <td>{formatTime(v.actualEnd || v.timeEntry?.endTime)}</td>
                    <td>{v.unitsOfService || (v.timeEntry?.durationMinutes ? (v.timeEntry.durationMinutes / 60).toFixed(1) : '—')}</td>
                    <td>{verifiedBadge(v.isVerified, hasGps)}</td>
                    <td>
                      {sandataBadge(v.sandataStatus)}
                      {v.sandataExceptionCode && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--hc-red-ink)', marginTop: '2px' }}>
                          {v.sandataExceptionCode}: {v.sandataExceptionDesc || ''}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--hc-ink-soft)' }}>{v.evvMethod || '—'}</td>
                    <td>
                      {may.delete && !v.isVerified && (
                        <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => verifyVisit(v.id)}>Verify</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '1rem 0' }}>
              <button className="hc-btn hc-btn-sm hc-btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>Page {page} of {totalPages}</span>
              <button className="hc-btn hc-btn-sm hc-btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default EVVDashboard
