// Moved from templates/crm-homecare/frontend/src/components/admin/LoginActivity.tsx.
// Changes in the move:
//   · reads GET /api/compliance/login-activity as the unified server answers it: { data, pagination } of camelCase rows
//     (ipAddress, userAgent, createdAt, failReason, user { firstName, lastName, role }). The template read `data.activity`
//     and snake_case fields, which its own server never sent, so it always showed "No login activity found".
//   · the server answers the last 100 attempts and reads no page, email or result filter (office/compliance.ts), so the
//     email and result filters narrow those 100 rows here and the page says so; the Prev/Next pager is gone (one page).
//   · a failure's reason is the sentence the shared sign-in records ("Wrong password"); the template's codes still map.
//   · every colour is a light/dark pair (the frame's tokens).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { parseLocalDate } from '../lib/date'
import { formatDateTime } from '../lib/datetime'

/** One row of GET /api/compliance/login-activity. */
interface LoginRow {
  id: string
  email: string | null
  userId: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  success: boolean
  failReason: string | null
  user: { firstName: string | null; lastName: string | null; role: string | null } | null
}

// Parses a user-agent string into a human-readable device/browser summary
function parseUserAgent(ua: string | null): string {
  if (!ua) return '—'
  let browser = 'Unknown browser'
  let os = ''

  if (/Chrome\//.test(ua) && !/Chromium|Edg/.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari'
  else if (/Edg\//.test(ua)) browser = 'Edge'

  if (/iPhone/.test(ua)) os = 'iPhone'
  else if (/iPad/.test(ua)) os = 'iPad'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Windows NT/.test(ua)) os = 'Windows'
  else if (/Mac OS X/.test(ua)) os = 'macOS'
  else if (/Linux/.test(ua)) os = 'Linux'

  return os ? `${browser} / ${os}` : browser
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - parseLocalDate(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const FAIL_LABELS: Record<string, string> = {
  user_not_found: 'Unknown email',
  invalid_password: 'Wrong password',
  account_inactive: 'Inactive account',
}

interface Filters { email: string; success: '' | 'true' | 'false' }

const LoginActivity = () => {
  const [activity, setActivity] = useState<LoginRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<Filters>({ email: '', success: '' })
  const [appliedFilters, setAppliedFilters] = useState<Filters>({ email: '', success: '' })

  const loadActivity = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const reply = await api.get('/api/compliance/login-activity')
      setActivity(rows<LoginRow>(reply))
    } catch (err) {
      setError(errorMessage(err, 'Could not load login activity.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadActivity() }, [loadActivity])

  const handleSearch = () => setAppliedFilters({ ...filters })

  const handleReset = () => {
    const reset: Filters = { email: '', success: '' }
    setFilters(reset)
    setAppliedFilters(reset)
  }

  const shown = useMemo(() => activity.filter((a) => {
    if (appliedFilters.email && !(a.email || '').toLowerCase().includes(appliedFilters.email.toLowerCase())) return false
    if (appliedFilters.success !== '' && String(a.success) !== appliedFilters.success) return false
    return true
  }), [activity, appliedFilters])

  const failedCount = shown.filter((a) => !a.success).length
  const uniqueIPs = new Set(shown.map((a) => a.ipAddress).filter(Boolean)).size

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h2>Login Activity</h2>
          <p style={{ color: 'var(--hc-ink-soft)', margin: 0 }}>
            The last 100 sign-in attempts — who, when, where, and whether it worked
          </p>
        </div>
        <button className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => loadActivity()}>
          ↻ Refresh
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Summary stats */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Attempts Shown', value: shown.length, className: '', color: 'var(--hc-blue-ink)' },
          { label: 'Failed', value: failedCount, className: '', color: 'var(--hc-red-ink)' },
          { label: 'Succeeded', value: shown.length - failedCount, className: '', color: 'var(--hc-green-ink)' },
          { label: 'Unique IPs', value: uniqueIPs, className: 'text-violet-700 dark:text-violet-300', color: undefined },
        ].map((s) => (
          <div key={s.label} className="hc-card" style={{ textAlign: 'center', padding: '1rem' }}>
            <div className={s.className} style={{ fontSize: '1.75rem', fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)', marginTop: '0.25rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="hc-card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
            <label>Search email</label>
            <input
              type="text"
              className="form-control"
              placeholder="Filter by email..."
              value={filters.email}
              onChange={(e) => setFilters((f) => ({ ...f, email: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            />
          </div>
          <div className="form-group" style={{ margin: 0, minWidth: '160px' }}>
            <label>Result</label>
            <select
              className="form-control"
              value={filters.success}
              onChange={(e) => setFilters((f) => ({ ...f, success: e.target.value as Filters['success'] }))}
            >
              <option value="">All attempts</option>
              <option value="true">✅ Successful only</option>
              <option value="false">❌ Failed only</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="hc-btn hc-btn-primary hc-btn-sm" onClick={handleSearch}>Search</button>
            <button className="hc-btn hc-btn-secondary hc-btn-sm" onClick={handleReset}>Reset</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="hc-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <div className="spinner" />
          </div>
        ) : shown.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--hc-ink-soft)' }}>
            No login activity found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="hc-table" style={{ margin: 0, minWidth: '700px' }}>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Name / Role</th>
                  <th>IP Address</th>
                  <th>Device / Browser</th>
                  <th>When</th>
                  <th>Fail Reason</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const name = row.user?.firstName ? `${row.user.firstName} ${row.user.lastName || ''}`.trim() : ''
                  return (
                    <tr key={row.id} style={row.success ? undefined : { background: 'var(--hc-danger-bg)' }}>
                      <td>
                        <span
                          className="hc-badge"
                          style={{
                            background: row.success ? 'var(--hc-success-bg)' : 'var(--hc-danger-bg)',
                            color: row.success ? 'var(--hc-success-ink)' : 'var(--hc-danger-ink)',
                            border: `1px solid ${row.success ? 'var(--hc-success-line)' : 'var(--hc-danger-line)'}`,
                            fontWeight: 700,
                          }}
                        >
                          {row.success ? '✅ Success' : '❌ Failed'}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{row.email || '—'}</td>
                      <td>
                        {name ? (
                          <div>
                            <div style={{ fontWeight: 600 }}>{name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)' }}>{row.user?.role}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{row.ipAddress || '—'}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)' }}>
                        {parseUserAgent(row.userAgent)}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          {timeAgo(row.createdAt)}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink-soft)' }}>
                          {formatDateTime(row.createdAt)}
                        </div>
                      </td>
                      <td>
                        {row.failReason ? (
                          <span className="hc-badge" style={{ background: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)', border: '1px solid var(--hc-warning-line)' }}>
                            {FAIL_LABELS[row.failReason] || row.failReason}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && activity.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem', color: 'var(--hc-ink-soft)' }}>
          Showing {shown.length} of the last {activity.length} attempts
        </div>
      )}
    </div>
  )
}

export default LoginActivity
