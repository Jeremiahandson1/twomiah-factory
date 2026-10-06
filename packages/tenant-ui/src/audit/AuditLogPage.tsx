/**
 * The audit log, as a screen. One page for every CRM. (T51 follow-up)
 *
 * Owner, on the contractor: "audit log gaps, and no screen to view the audit log."
 *
 * The second half was true of almost the whole fleet. NINE templates mount `/api/audit` and record
 * to it on every create, update, delete, status change, payment and export — and only the dispensary
 * had a page that could read it. Not one template had a nav entry. So the trail an owner needs when
 * they ask "who changed this price" was being written faithfully and was unreachable from the
 * product, which is the rule about a server feature needing a screen, at eight-vertical scale.
 *
 * Modelled on the dispensary's page, which earned its shape the hard way and whose lessons are kept
 * here deliberately:
 *   · the filter vocabulary comes from GET /api/audit/filters, NOT a list in this file. The old
 *     dispensary version hard-coded fifteen composite values like 'order_created' and the log stores
 *     `action` and `entity` in two separate columns — so every option matched zero rows and picking
 *     one emptied the screen. A filter built from the data cannot drift from the data. (T41)
 *   · the range goes as startDate/endDate, the names the endpoint actually reads. Sent as
 *     dateFrom/dateTo they were ignored and narrowing to a week returned the whole log. (T41)
 *   · timestamps render in the COMPANY's timezone, not the browser's, so an entry lines up with the
 *     record it belongs to. The dispensary read 14:32 on an order and 19:32 in the log. (T41)
 *   · the user filter is only fetched and only shown when the seat holds `users:read`. A manager
 *     holds team:read and not that, so asking anyway produced a 403 in the console on a page that
 *     had otherwise loaded, and left the control silently empty. (T42 L2)
 *
 * The dispensary keeps its own page for now: it has an /export endpoint and kiosk-specific action
 * colours that the other eight have no route for. That duplication is real and worth collapsing, and
 * it is not what the owner reported — said here rather than quietly left.
 */
import { useState, useEffect, useCallback } from 'react'
import { Shield, Search, User } from 'lucide-react'
import { field, who, whatChanged, humanise } from './auditFields'

export interface AuditLogApi {
  get: (path: string, params?: Record<string, unknown>) => Promise<any>
}
export interface AuditLogPageProps {
  api: AuditLogApi
  toast: { error: (m: string) => void }
  /** The company's own clock. Without it this falls back to the browser's, which is the T41 fault. */
  timeZone?: string
  /** `can('users:read')` — gates the roster filter, which most seats cannot read. */
  canReadUsers?: boolean
}

/**
 * THE INSTANT, IN THE COMPANY'S ZONE — formatted here, not by the template. (T51 follow-up)
 *
 * The first version of this page took a `formatDateTime` prop so each template could pass its own.
 * Only the dispensary HAS one: the other eight export `formatDate` and nothing else, so all eight
 * wrappers were broken and the typecheck guard caught it on crm-vet. A shared page that depends on a
 * helper eight of nine templates do not have is not shared.
 *
 * So it owns its own rendering, and every wrapper is then identical. `timeZone` is the company's,
 * because the whole point of the T41 fix was that an audit entry has to line up with the record it
 * belongs to — a dispensary read 14:32 on an order and 19:32 in the log. With no zone configured it
 * falls back to the reader's, which is the best available answer rather than a wrong one.
 */
/**
 * THE API SENDS snake_case. THIS PAGE READ camelCase. (T58 follow-up)
 *
 * Owner: "the new Audit Log page shows '—' and 'System' in every row. The data is in the API, so the
 * page is probably reading the wrong field names." Exactly right. The rows come straight off a raw
 * `db.execute`, so they arrive as `created_at`, `user_name`, `user_email`, `entity_name`,
 * `ip_address` — and this page asked for `createdAt`, `userName`, `entityName`, `ipAddress`, got
 * undefined for every one, and printed its fallbacks.
 *
 * This is the SECOND shape mismatch on this page: the filter options differed per template too. The
 * lesson both times is that a shared screen cannot assume a shape — nine templates feed it. So it
 * reads either spelling, which costs nothing and cannot be wrong whichever way a template's route is
 * written.
 */
const whenIn = (value: string, tz?: string) => {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      /**
       * NAME THE ZONE. (T58)
       *
       *   "Events: the two-factor timestamp has no timezone."
       *
       * The row said "Oct 6, 2026, 02:14 PM" and nothing more. This page converts every entry into
       * the COMPANY's zone on purpose — that is the whole of the T41 fix, so an audit entry lines up
       * with the record it belongs to — and then did not say so, which leaves the reader unable to
       * tell whether they are looking at their own clock or the shop's. On a security event ("who
       * turned two-factor off, and when") that ambiguity is the only thing the timestamp is for.
       *
       * Named in BOTH cases: with no zone configured the fallback is the reader's own, and an
       * unlabelled time there is the same ambiguity wearing a different cause.
       */
      timeZoneName: 'short',
      ...(tz ? { timeZone: tz } : {}),
    }).format(d)
  } catch {
    // An unknown or malformed zone must not take the page down with it.
    return d.toLocaleString()
  }
}

// humanise, field, who and whatChanged live in ./auditFields — pure, with no imports, so CI can run
// real API rows through them. They were inside this .tsx before, which is why two shape mismatches
// shipped: nothing could execute them, so they were only ever checked by being looked at. (T58)

/**
 * Colour by what the action DID, keyed on the values that are really stored — `action` from the
 * audit table, not an invented composite. Anything unlisted falls through to neutral, which is the
 * correct outcome for a module that starts logging something new.
 */
const actionColors: Record<string, string> = {
  create: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  status_change: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  payment: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  refund: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  export: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  role_change: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200',
  login: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-200',
  logout: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-200',
  login_failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
}

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-800'

export function AuditLogPage({ api, toast, timeZone, canReadUsers = false }: AuditLogPageProps) {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<any>(null)
  const [page, setPage] = useState(1)

  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  /** What THIS company's log can be filtered by. See the note at the top. */
  const [options, setOptions] = useState<{ actions: { value: string; count: number }[]; entities: { value: string; count: number }[] }>({ actions: [], entities: [] })
  const [users, setUsers] = useState<any[]>([])

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { page, limit: 50 }
      if (actionFilter) params.action = actionFilter
      if (entityFilter) params.entity = entityFilter
      if (userFilter) params.userId = userFilter
      // startDate/endDate — the names the endpoint reads. (T41)
      if (dateFrom) params.startDate = dateFrom
      if (dateTo) params.endDate = dateTo
      if (search) params.search = search
      const data = await api.get('/api/audit', params)
      setLogs(Array.isArray(data) ? data : data?.data || [])
      setPagination(data?.pagination || null)
    } catch {
      toast.error('Failed to load the audit log')
    } finally {
      setLoading(false)
    }
  }, [page, actionFilter, entityFilter, userFilter, dateFrom, dateTo, search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadLogs() }, [loadLogs])
  useEffect(() => { setPage(1) }, [actionFilter, entityFilter, userFilter, dateFrom, dateTo, search])

  /**
   * The filter vocabulary, once. A log with no rows yet leaves the dropdowns at "All", which filters
   * nothing and shows everything, rather than blocking the page.
   *
   * TWO SHAPES ACCEPTED, deliberately. /filters returns `{ value, count }` where it reads the
   * company's own rows, and a bare string[] on a tenant still serving the older handler that
   * returned the whole static vocabulary. Reading `.value` off a string gives `undefined`, and that
   * is precisely what the live tenants showed on the day this page shipped — every option rendering
   * "undefined (undefined)". The server side is fixed; this stays tolerant because a tenant mid-roll
   * should get a usable filter rather than a row of undefineds. (T51 follow-up)
   */
  useEffect(() => {
    let cancelled = false
    const normalise = (v: unknown): { value: string; count: number }[] => {
      if (!Array.isArray(v)) return []
      return v
        .map((x: any) => (typeof x === 'string'
          ? { value: x, count: 0 }
          : { value: String(x?.value ?? ''), count: Number(x?.count ?? 0) }))
        .filter((x) => x.value)
    }
    api.get('/api/audit/filters')
      .then((d: any) => {
        if (cancelled) return
        setOptions({ actions: normalise(d?.actions), entities: normalise(d?.entities) })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Only when the answer can be yes — see the note at the top.
  useEffect(() => {
    if (!canReadUsers) return
    let cancelled = false
    api.get('/api/company/users')
      .then((d: any) => { if (!cancelled) setUsers(Array.isArray(d) ? d : d?.data || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [canReadUsers]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
          <Shield className="w-6 h-6 text-orange-600 dark:text-orange-300" />
          Audit Log
        </h1>
        <p className="text-gray-600 dark:text-slate-400">Who changed what, and when — every create, edit, deletion and payment.</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4 dark:bg-slate-900">
        {/* One column fewer where the roster is not readable, so the row does not leave a gap. */}
        <div className={`grid gap-3 ${canReadUsers ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
              aria-label="Search the audit log"
              className={`w-full pl-10 ${inputCls}`}
            />
          </div>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} aria-label="Filter by action" className={inputCls}>
            <option value="">All actions</option>
            {options.actions.map((a) => <option key={a.value} value={a.value}>{humanise(a.value)}{a.count ? ` (${a.count})` : ''}</option>)}
          </select>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} aria-label="Filter by record type" className={inputCls}>
            <option value="">All records</option>
            {options.entities.map((e) => <option key={e.value} value={e.value}>{humanise(e.value)}{e.count ? ` (${e.count})` : ''}</option>)}
          </select>
          {canReadUsers && (
            <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} aria-label="Filter by person" className={inputCls}>
              <option value="">Everyone</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          )}
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" className={inputCls} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" className={inputCls} />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto dark:bg-slate-900">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-900">
              <tr>
                {['When', 'Who', 'Action', 'Record', 'What changed', 'IP address'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-800">
              {logs.map((log: any, idx: number) => (
                <tr key={log.id || idx} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap dark:text-slate-200">
                    {field(log, 'createdAt') ? whenIn(field(log, 'createdAt'), timeZone) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center dark:bg-slate-700">
                        <User className="w-3 h-3 text-gray-500 dark:text-slate-400" />
                      </div>
                      <span className="text-sm text-gray-900 dark:text-slate-100">{who(log)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${actionColors[log.action] || 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'}`}>
                      {(log.action || 'unknown').replace(/_/g, ' ')}
                    </span>
                  </td>
                  {/* The entity is its own column, because "update" on its own says nothing. */}
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap dark:text-slate-200">
                    {field(log, 'entityName') || (log.entity ? humanise(log.entity) : '—')}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-md truncate dark:text-slate-200" title={whatChanged(log)}>
                    {whatChanged(log)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono dark:text-slate-400">{field(log, 'ipAddress') || '—'}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">
                    <Shield className="w-10 h-10 mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                    Nothing matches those filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {pagination && (pagination.totalPages ?? pagination.pages ?? 1) > 1 && (
          <div className="px-4 py-3 border-t dark:border-slate-800 flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Page {pagination.page} of {pagination.totalPages ?? pagination.pages} ({pagination.total} entries)
            </p>
            <div className="flex gap-2">
              <button
                type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >Previous</button>
              <button
                type="button" onClick={() => setPage((p) => p + 1)}
                disabled={page >= (pagination.totalPages ?? pagination.pages ?? 1)}
                className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
