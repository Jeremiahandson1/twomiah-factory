// Moved from templates/crm-homecare/frontend/src/components/admin/AuditLogs.tsx.
// Changes in the move:
//   · reads GET /api/audit-logs as the unified server answers it (office/auditLogs.ts): { data, pagination } of
//     { id, userId, action, tableName, recordId, oldData, newData, ipAddress, reasonCode, timestamp, userFirstName,
//     userLastName }. The template read user_name, entity_type, entity_id, changes, change_description, flags and
//     user_agent, none of which its own server sent (the search threw on `log.user_name.toLowerCase()`), so the name,
//     the record and the changes now come from those columns: the changes are the fields whose old and new value differ.
//   · the dates, the person and the record type are asked of the server (it filters on startDate, endDate, userId and
//     tableName) and change the list when changed — the template loaded once on mount and the date boxes did nothing.
//     The end date counts to the end of that day on this browser's clock (the template's sent midnight, dropping the
//     whole last day). The server pages at 200 at most; the page has Prev/Next.
//   · the record-type choices are the tables the server writes to the trail (CREATE/UPDATE/DELETE on clients, care
//     plans…); the template's 'client'/'caregiver' and lowercase 'create'/'update' never matched a stored row. The
//     action choices are the actions on the loaded page.
//   · "Suspicious Activity" and the flags are gone: no audit row carries flags. The user agent is not stored on this
//     trail; the reason code is, and shows in the details.
//   · Export CSV asks POST /api/audit-logs/export for every row matching the filters (a list) and saves it as CSV here;
//     the server makes no PDF, so "Export PDF" is gone. The compliance report is POST /api/audit-logs/compliance-report,
//     which answers counts by action (a list, not a PDF): they show on the page.
//   · every colour is a light/dark pair (the frame's tokens); refusals show the server's sentence.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, rows, errorMessage, saveBlob } from '../lib/http'
import { toLocalYMD } from '../lib/date'
import { formatDateTime } from '../lib/datetime'
import { useToast } from '../../../../shared'
import { agencyToday } from '../lib/agencyClock'

/** One row of GET /api/audit-logs. */
interface AuditRow {
  id: string
  userId: string | null
  action: string
  tableName: string | null
  recordId: string | null
  oldData: unknown
  newData: unknown
  ipAddress: string | null
  reasonCode: string | null
  timestamp: string
  userFirstName: string | null
  userLastName: string | null
}

interface Person { id: string; firstName: string | null; lastName: string | null; role: string | null }
interface Pagination { page: number; limit: number; total: number; pages: number }
interface ActionCount { action: string; count: number }

interface Filters {
  startDate: string
  endDate: string
  userId: string
  action: string
  tableName: string
  searchTerm: string
}

const PAGE_SIZE = 200

/** The tables the server writes to this trail (server/crm/homecare/** writeCareAudit). */
const TABLES: Array<{ value: string; label: string }> = [
  { value: 'clients', label: 'Client' },
  { value: 'care_plans', label: 'Care Plan' },
  { value: 'care_plan_templates', label: 'Care Plan Template' },
  { value: 'client_task_templates', label: 'Care Task' },
  { value: 'client_visit_notes', label: 'Visit Note' },
  { value: 'visit_documentation', label: 'Visit Documentation' },
  { value: 'medications', label: 'Medication' },
  { value: 'documents', label: 'Document' },
  { value: 'schedules', label: 'Schedule' },
  { value: 'route_plans', label: 'Route Plan' },
  { value: 'notifications', label: 'Notification' },
  { value: 'lead', label: 'Lead' },
  { value: 'users', label: 'User' },
]

/** The start of a calendar day on this browser's clock, as an instant. */
const dayStart = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
}
/** The end of a calendar day on this browser's clock, as an instant. */
const dayEnd = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}

const userName = (log: AuditRow) => {
  const n = `${log.userFirstName || ''} ${log.userLastName || ''}`.trim()
  return n || (log.userId === 'system' ? 'System' : log.userId || 'Unknown')
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '(empty)'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** The fields whose value differs between the old and new data (JSON keys as stored). */
function changesOf(log: AuditRow): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
  const o = log.oldData && typeof log.oldData === 'object' && !Array.isArray(log.oldData) ? (log.oldData as Record<string, unknown>) : {}
  const n = log.newData && typeof log.newData === 'object' && !Array.isArray(log.newData) ? (log.newData as Record<string, unknown>) : {}
  const keys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)]))
  return keys
    .filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => ({ field: k, oldValue: o[k], newValue: n[k] }))
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const AuditLogs = () => {
  const toast = useToast()
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedLog, setSelectedLog] = useState<AuditRow | null>(null)
  const [filters, setFilters] = useState<Filters>({
    startDate: toLocalYMD(new Date(new Date().setDate(new Date().getDate() - 30))),
    endDate: agencyToday(),
    userId: '',
    action: '',
    tableName: '',
    searchTerm: '',
  })
  const [users, setUsers] = useState<Person[]>([])
  const [report, setReport] = useState<ActionCount[] | null>(null)

  /** The filters the server reads (dates as instants on this browser's clock). */
  const serverFilters = useCallback(() => {
    const f: Record<string, string> = {}
    if (filters.startDate) f.startDate = dayStart(filters.startDate)
    if (filters.endDate) f.endDate = dayEnd(filters.endDate)
    if (filters.userId) f.userId = filters.userId
    if (filters.tableName) f.tableName = filters.tableName
    return f
  }, [filters.startDate, filters.endDate, filters.userId, filters.tableName])

  // Only the latest request's answer is shown (a filter change and its page reset can both be in flight).
  const seq = useRef(0)
  const loadLogs = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    setError('')
    try {
      const reply = await api.get('/api/audit-logs', { ...serverFilters(), page, limit: PAGE_SIZE })
      if (mine !== seq.current) return
      setLogs(rows<AuditRow>(reply))
      const p = (reply as { pagination?: Pagination })?.pagination
      setPagination(p || { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 })
    } catch (err) {
      if (mine !== seq.current) return
      setLogs([])
      setError(errorMessage(err, 'Could not load the audit logs.'))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [serverFilters, page])

  useEffect(() => { loadLogs() }, [loadLogs])

  // A filter the server reads goes back to the first page.
  useEffect(() => { setPage(1) }, [filters.startDate, filters.endDate, filters.userId, filters.tableName])

  useEffect(() => {
    // The person filter's choices: the office's logins and the caregivers. A refusal leaves the list empty.
    Promise.all([
      api.get('/api/users/admins', { limit: 200 }).then((r) => rows<Person>(r)).catch(() => [] as Person[]),
      api.get('/api/users/caregivers').then((r) => rows<Person>(r)).catch(() => [] as Person[]),
    ]).then(([admins, caregivers]) => setUsers([...admins, ...caregivers]))
  }, [])

  const actions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs])

  const filteredLogs = useMemo(() => {
    let filtered = logs
    if (filters.action) filtered = filtered.filter((log) => log.action === filters.action)
    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase()
      filtered = filtered.filter((log) =>
        userName(log).toLowerCase().includes(term) ||
        (log.recordId || '').toLowerCase().includes(term) ||
        (log.tableName || '').toLowerCase().includes(term) ||
        (log.reasonCode || '').toLowerCase().includes(term),
      )
    }
    return [...filtered].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [logs, filters.action, filters.searchTerm])

  const stats = useMemo(() => {
    const lower = (a: string) => a.toLowerCase()
    return {
      uniqueUsers: new Set(logs.map((log) => log.userId)).size,
      dataChanges: logs.filter((log) => ['create', 'update', 'delete'].includes(lower(log.action))).length,
      accessEvents: logs.filter((log) => ['login', 'access'].includes(lower(log.action))).length,
    }
  }, [logs])

  const getActionBadge = (action: string) => {
    switch (action.toLowerCase()) {
      case 'create': return { class: 'hc-badge-success', label: 'Created' }
      case 'update': return { class: 'hc-badge-info', label: 'Updated' }
      case 'delete': return { class: 'hc-badge-danger', label: 'Deleted' }
      case 'login': return { class: 'hc-badge-primary', label: 'Login' }
      case 'access': return { class: 'hc-badge-secondary', label: 'Access' }
      case 'export': return { class: 'hc-badge-warning', label: 'Export' }
      case 'failed_login': return { class: 'hc-badge-danger', label: 'Failed Login' }
      default: return { class: 'hc-badge-secondary', label: action }
    }
  }

  const getEntityIcon = (tableName: string | null) => {
    switch (tableName) {
      case 'clients': return '👥'
      case 'users': return '👤'
      case 'schedules': return '📅'
      case 'care_plans':
      case 'care_plan_templates': return '📋'
      case 'medications': return '💊'
      case 'documents': return '📄'
      default: return '📄'
    }
  }

  const exportCsv = async () => {
    try {
      const reply = await api.post('/api/audit-logs/export', serverFilters())
      const all = rows<AuditRow>(reply).filter((log) => !filters.action || log.action === filters.action)
      const header = ['Timestamp', 'User', 'Action', 'Record type', 'Record ID', 'Changes', 'IP address', 'Reason code']
      const lines = all.map((log) => [
        log.timestamp, userName(log), log.action, log.tableName, log.recordId,
        changesOf(log).map((c) => `${c.field}: ${show(c.oldValue)} → ${show(c.newValue)}`).join('; '),
        log.ipAddress, log.reasonCode,
      ].map(csvCell).join(','))
      const blob = new Blob([[header.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
      saveBlob(blob, `audit-logs-${agencyToday()}.csv`)
    } catch (err) {
      toast.error('Failed to export: ' + errorMessage(err))
    }
  }

  const loadComplianceReport = async () => {
    try {
      const body: Record<string, string> = {}
      if (filters.startDate) body.startDate = dayStart(filters.startDate)
      if (filters.endDate) body.endDate = dayEnd(filters.endDate)
      const reply = await api.post('/api/audit-logs/compliance-report', body)
      setReport(rows<ActionCount>(reply))
    } catch (err) {
      toast.error('Failed to generate report: ' + errorMessage(err))
    }
  }

  const tableLabel = (t: string | null) => TABLES.find((x) => x.value === t)?.label || (t ?? '').replace(/_/g, ' ')

  return (
    <div>
      <div className="page-header">
        <h2>🔐 Audit Logs (HIPAA Compliance)</h2>
        <div className="button-group">
          <button className="hc-btn hc-btn-secondary" onClick={exportCsv}>
            📥 Export CSV
          </button>
          <button className="hc-btn hc-btn-primary" onClick={loadComplianceReport}>
            ✓ Compliance Report
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {report && (
        <div className="hc-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Compliance Report — {filters.startDate} to {filters.endDate}</h3>
            <button className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setReport(null)}>Close</button>
          </div>
          {report.length === 0 ? (
            <p style={{ color: 'var(--hc-ink-soft)' }}>No audited events in this period.</p>
          ) : (
            <table className="hc-table" style={{ marginTop: '0.75rem' }}>
              <thead><tr><th>Action</th><th>Events</th></tr></thead>
              <tbody>
                {report.map((r) => (
                  <tr key={r.action}><td>{r.action}</td><td>{Number(r.count)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Compliance Stats */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="hc-stat-card">
          <h3>Total Events</h3>
          <div className="value">{pagination.total}</div>
        </div>
        <div className="hc-stat-card">
          <h3>Unique Users{pagination.pages > 1 ? ' (this page)' : ''}</h3>
          <div className="value">{stats.uniqueUsers}</div>
        </div>
        <div className="hc-stat-card">
          <h3>Data Changes{pagination.pages > 1 ? ' (this page)' : ''}</h3>
          <div className="value" style={{ color: 'var(--hc-blue-ink)' }}>{stats.dataChanges}</div>
        </div>
        <div className="hc-stat-card">
          <h3>Access Events{pagination.pages > 1 ? ' (this page)' : ''}</h3>
          <div className="value" style={{ color: 'var(--color-teal-dark)' }}>{stats.accessEvents}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="hc-card">
        <h3>Filter Logs</h3>
        <div className="filter-controls" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div className="form-group">
            <label>Start Date</label>
            <input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} />
          </div>

          <div className="form-group">
            <label>End Date</label>
            <input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} />
          </div>

          <div className="form-group">
            <label>User</label>
            <select value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })}>
              <option value="">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName} ({u.role})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Action</label>
            <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
              <option value="">All Actions</option>
              {actions.map((a) => <option key={a} value={a}>{getActionBadge(a).label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Record Type</label>
            <select value={filters.tableName} onChange={(e) => setFilters({ ...filters, tableName: e.target.value })}>
              <option value="">All Types</option>
              {TABLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Search</label>
            <input
              type="text"
              placeholder="Search by name, record ID or type..."
              value={filters.searchTerm}
              onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Logs */}
      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="hc-card hc-card-centered">
          <p>No audit logs found for the selected filters.</p>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
            Showing {filteredLogs.length} of {logs.length} events on this page ({pagination.total} in all)
          </div>

          <div style={{ display: 'grid', gap: '1rem' }}>
            {filteredLogs.map((log) => {
              const actionBadge = getActionBadge(log.action)
              const open = selectedLog?.id === log.id
              const changes = changesOf(log)

              return (
                <div
                  key={log.id}
                  className="hc-card"
                  style={{ borderLeft: '4px solid var(--hc-line)', cursor: 'pointer' }}
                  onClick={() => setSelectedLog(open ? null : log)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '1.2rem' }}>{getEntityIcon(log.tableName)}</span>
                        <div>
                          <strong>{userName(log)}</strong>
                          <span className={`hc-badge ${actionBadge.class}`} style={{ marginLeft: '0.5rem' }}>
                            {actionBadge.label}
                          </span>
                        </div>
                      </div>

                      <div style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
                        <p style={{ margin: '0.25rem 0' }}>
                          <strong>{tableLabel(log.tableName).toUpperCase()}</strong>
                          {log.recordId ? <> (ID: {log.recordId})</> : null}
                        </p>
                        <p style={{ margin: '0.25rem 0' }}>{formatDateTime(log.timestamp)}</p>
                        {log.ipAddress && <p style={{ margin: '0.25rem 0' }}>From: {log.ipAddress}</p>}
                      </div>
                    </div>

                    <span style={{ fontSize: '1.2rem', color: 'var(--hc-muted)' }}>{open ? '▼' : '▶'}</span>
                  </div>

                  {/* Expanded Details */}
                  {open && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--hc-line)' }}>
                      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <div>
                          <h4>Details</h4>
                          <p><strong>User ID:</strong> {log.userId}</p>
                          <p><strong>Record Type:</strong> {log.tableName}</p>
                          <p><strong>Record ID:</strong> {log.recordId || 'N/A'}</p>
                          <p><strong>Action:</strong> {log.action}</p>
                          <p><strong>Timestamp:</strong> {formatDateTime(log.timestamp)}</p>
                        </div>

                        <div>
                          <h4>Network Info</h4>
                          <p><strong>IP Address:</strong> {log.ipAddress || 'N/A'}</p>
                          <p><strong>Reason Code:</strong> {log.reasonCode || 'N/A'}</p>
                        </div>
                      </div>

                      {changes.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                          <h4>Changes</h4>
                          <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--hc-line)' }}>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Field</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Old Value</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>New Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changes.map((change) => (
                                <tr key={change.field} style={{ borderBottom: '1px solid var(--hc-line)' }}>
                                  <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{change.field}</td>
                                  <td style={{ padding: '0.5rem', color: 'var(--hc-red-ink)', wordBreak: 'break-word' }}>{show(change.oldValue)}</td>
                                  <td style={{ padding: '0.5rem', color: 'var(--hc-green-ink)', wordBreak: 'break-word' }}>{show(change.newValue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
          <button className="hc-btn hc-btn-secondary hc-btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)' }}>
            Page {pagination.page} of {pagination.pages}
          </span>
          <button className="hc-btn hc-btn-secondary hc-btn-sm" disabled={page >= pagination.pages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  )
}

export default AuditLogs
