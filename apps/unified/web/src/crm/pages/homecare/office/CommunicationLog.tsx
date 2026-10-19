// Moved from templates/crm-homecare/frontend/src/components/admin/CommunicationLog.tsx.
// Timestamped notes, calls and emails per client or caregiver: standalone at /crm/communication-log (the template's
// AdminDashboard rendered it with entityType 'client', no entity, "All Entries" — the defaults here), or embedded with
// an entity passed in.
//
// Changes from the template:
//   · every field is read as the server answers it (camelCase: logType, isPinned, followUpDate, followUpDone,
//     loggedByName, createdAt, entityId). The template read snake_case on rows its Drizzle routes sent camelCase, so
//     every entry showed as a "Note", a pin never showed or toggled off, follow-ups never showed and the pending banner
//     never matched;
//   · the type filter is applied to the rows on the screen: GET /api/communication-log/:type/:id ignores ?type (as the
//     template's route did), so choosing a type changed nothing;
//   · the contact picker asks for every client (lib/http.ts listAll, page by page): /api/clients is a page of 50;
//   · a failed pin, follow-up, delete or load says so (the template swallowed it); delete asks in the app's dialog;
//   · Add Entry shows only with care-portal:create and Delete only with care-portal:delete (what the server asks).
import { useEffect, useState } from 'react'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { formatDate } from '../lib/date'
import { formatAgencyDate, formatAgencyDateTime } from '../lib/agencyClock'
import { useConfirm, usePermissions, useToast } from '../../../../shared'

interface LogType { value: string; label: string; icon: string; chip: string; edge: string }

// Each chip's ground and ink are a pair in both themes; the edge is the entry's left border.
const LOG_TYPES: LogType[] = [
  { value: 'note', label: 'Note', icon: '📝', chip: 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-100', edge: 'border-l-gray-500 dark:border-l-slate-400' },
  { value: 'call', label: 'Call', icon: '📞', chip: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200', edge: 'border-l-blue-500 dark:border-l-blue-400' },
  { value: 'email', label: 'Email', icon: '📧', chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200', edge: 'border-l-violet-500 dark:border-l-violet-400' },
  { value: 'text', label: 'Text', icon: '💬', chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200', edge: 'border-l-emerald-500 dark:border-l-emerald-400' },
  { value: 'visit', label: 'Visit', icon: '🏠', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', edge: 'border-l-amber-500 dark:border-l-amber-400' },
  { value: 'incident', label: 'Incident', icon: '⚠️', chip: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200', edge: 'border-l-red-500 dark:border-l-red-400' },
  { value: 'complaint', label: 'Complaint', icon: '🚨', chip: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200', edge: 'border-l-red-700 dark:border-l-red-500' },
  { value: 'compliment', label: 'Compliment', icon: '⭐', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', edge: 'border-l-amber-500 dark:border-l-amber-400' },
  { value: 'other', label: 'Other', icon: '📋', chip: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200', edge: 'border-l-gray-400 dark:border-l-slate-500' },
]

const DIRECTIONS = ['inbound', 'outbound', 'internal']

/** A row of GET /api/communication-log/… (the communication_log table, camelCase). */
interface LogEntry {
  id: string
  entityType: string
  entityId: string
  logType: string
  direction: string | null
  subject: string | null
  body: string
  loggedByName: string | null
  followUpDate: string | null
  followUpDone: boolean
  isPinned: boolean
  createdAt: string
}

interface Entity { type: string; id: string; name: string }
interface Person { id: string; firstName?: string | null; lastName?: string | null }

interface Props {
  entityType?: string
  entityId?: string | null
  entityName?: string
  compact?: boolean
}

const LABEL = 'mb-1 block text-xs font-semibold text-gray-700 dark:text-slate-300'
const FIELD = 'w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const PANEL = 'mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800/60'
const ICON_BTN = 'rounded px-1 text-sm opacity-70 hover:opacity-100'

const emptyForm = { logType: 'note', direction: 'internal', subject: '', body: '', followUpDate: '' }
const fullName = (p: Person) => `${p.firstName || ''} ${p.lastName || ''}`.trim()

export default function CommunicationLog({ entityType = 'client', entityId = null, entityName = 'All Entries', compact = false }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const { can } = usePermissions()
  const mayCreate = can('care-portal:create')
  const mayDelete = can('care-portal:delete')

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [followUps, setFollowUps] = useState<LogEntry[]>([])
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  // Standalone (no entity passed in) needs a contact picker, or every entry would post entityId: null and be refused.
  const standalone = !entityId
  const [entities, setEntities] = useState<Entity[]>([])
  const [picked, setPicked] = useState<Entity | null>(entityId ? { type: entityType, id: entityId, name: entityName } : null)
  const effType = picked?.type
  const effId = picked?.id

  const loadEntities = async () => {
    try {
      const [cData, cgData] = await Promise.all([
        listAll('/api/clients'),
        api.get('/api/users/caregivers'),
      ])
      const clients = rows<Person>(cData).map((x) => ({ type: 'client', id: x.id, name: fullName(x) }))
      const caregivers = rows<Person>(cgData).map((x) => ({ type: 'caregiver', id: x.id, name: `${fullName(x)} (caregiver)` }))
      setEntities([...clients, ...caregivers])
    } catch (e) { toast.error(errorMessage(e, 'Could not load clients and caregivers')) }
  }

  const load = async () => {
    if (!effId || !effType) { setLogs([]); setLoading(false); return }
    setLoading(true)
    try {
      const reply = await api.get(`/api/communication-log/${encodeURIComponent(effType)}/${encodeURIComponent(effId)}`)
      setLogs(rows<LogEntry>(reply))
    } catch (e) { toast.error(errorMessage(e, 'Could not load the log')) }
    setLoading(false)
  }

  const loadFollowUps = async () => {
    try {
      const reply = await api.get('/api/communication-log/follow-ups/pending')
      setFollowUps(rows<LogEntry>(reply).filter((f) => f.entityId === effId))
    } catch { /* the banner is a convenience: the entries still show each follow-up */ }
  }

  useEffect(() => { if (standalone) void loadEntities() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); void loadFollowUps() }, [effId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!form.body.trim()) return
    if (!editId && !effId) { toast.warning('Pick a client or caregiver first'); return }
    setSaving(true)
    try {
      if (editId) await api.put(`/api/communication-log/${editId}`, { body: form.body, subject: form.subject })
      else await api.post('/api/communication-log', { entityType: effType, entityId: effId, ...form })
      toast.success(editId ? 'Updated' : 'Entry saved')
      setForm(emptyForm)
      setEditId(null)
      setShowForm(false)
      void load(); void loadFollowUps()
    } catch (e) { toast.error(errorMessage(e, 'Error saving')) }
    setSaving(false)
  }

  const togglePin = async (log: LogEntry) => {
    try { await api.put(`/api/communication-log/${log.id}`, { isPinned: !log.isPinned }) } catch (e) { toast.error(errorMessage(e)) }
    void load()
  }

  const markFollowUpDone = async (id: string) => {
    try { await api.put(`/api/communication-log/${id}`, { followUpDone: true }) } catch (e) { toast.error(errorMessage(e)) }
    void load(); void loadFollowUps()
  }

  const deleteLog = async (id: string) => {
    if (!(await confirm('Delete this entry?', { title: 'Delete entry', confirmText: 'Delete' }))) return
    try { await api.delete(`/api/communication-log/${id}`) } catch (e) { toast.error(errorMessage(e)) }
    void load(); void loadFollowUps()
  }

  const startEdit = (log: LogEntry) => {
    setEditId(log.id)
    setForm({ ...form, body: log.body, subject: log.subject || '' })
    setShowForm(true)
    window.scrollTo(0, 0)
  }

  const typeInfo = (t: string) => LOG_TYPES.find((l) => l.value === t) || LOG_TYPES[0]
  const fmt = (dt: string) => formatAgencyDate(dt, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + formatAgencyDateTime(dt, { hour: 'numeric', minute: '2-digit' })

  const shown = filterType ? logs.filter((l) => l.logType === filterType) : logs

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className={`m-0 font-semibold text-gray-900 dark:text-slate-100 ${compact ? 'text-base' : 'text-lg'}`}>📋 Communication Log</h3>
          {entityName && <span className="text-sm text-gray-600 dark:text-slate-400">— {entityName}</span>}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-slate-700 dark:text-slate-200">{shown.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={`${FIELD} w-auto py-1.5`}>
            <option value="">All types</option>
            {LOG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          {mayCreate && (
            <button
              type="button"
              onClick={() => { setShowForm(!showForm); setEditId(null) }}
              className={showForm
                ? 'rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-800 dark:bg-slate-700 dark:text-slate-100'
                : 'rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500'}
            >
              {showForm ? '✕ Cancel' : '+ Add Entry'}
            </button>
          )}
        </div>
      </div>

      {/* Contact picker (standalone) */}
      {standalone && (
        <div className={PANEL}>
          <label className={LABEL} htmlFor="comm-log-contact">Contact (client or caregiver)</label>
          <select
            id="comm-log-contact"
            value={picked ? `${picked.type}:${picked.id}` : ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v) { setPicked(null); return }
              setPicked(entities.find((x) => `${x.type}:${x.id}` === v) || null)
            }}
            className={`${FIELD} max-w-md`}
          >
            <option value="">Select a client or caregiver…</option>
            {entities.map((x) => <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>{x.name}</option>)}
          </select>
        </div>
      )}

      {/* Pending follow-ups */}
      {followUps.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-900/30">
          <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">⏰ {followUps.length} follow-up{followUps.length > 1 ? 's' : ''} pending</span>
          <div className="flex flex-wrap gap-2">
            {followUps.slice(0, 3).map((f) => (
              <span key={f.id} className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-xs text-gray-800 dark:border-amber-700 dark:bg-slate-800 dark:text-slate-100">
                {f.subject || f.body.slice(0, 30)}
                <button type="button" onClick={() => markFollowUpDone(f.id)} title="Mark follow-up done" className="ml-1 font-bold text-emerald-700 dark:text-emerald-400">✓</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Add / edit */}
      {showForm && (
        <div className={PANEL}>
          <div className="mb-3 grid grid-cols-2 gap-3">
            {!editId && (
              <>
                <div>
                  <label className={LABEL} htmlFor="comm-log-type">Type</label>
                  <select id="comm-log-type" value={form.logType} onChange={(e) => setForm((f) => ({ ...f, logType: e.target.value }))} className={FIELD}>
                    {LOG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL} htmlFor="comm-log-direction">Direction</label>
                  <select id="comm-log-direction" value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))} className={FIELD}>
                    {DIRECTIONS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
              </>
            )}
            <div className="col-span-2">
              <label className={LABEL} htmlFor="comm-log-subject">Subject (optional)</label>
              <input id="comm-log-subject" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Brief subject..." className={FIELD} />
            </div>
          </div>
          <div className="mb-3">
            <label className={LABEL} htmlFor="comm-log-body">Notes *</label>
            <textarea id="comm-log-body" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="Enter your notes here..." rows={4} className={`${FIELD} resize-y`} />
          </div>
          {!editId && (
            <div className="mb-3">
              <label className={LABEL} htmlFor="comm-log-followup">Follow-up Date (optional)</label>
              <input id="comm-log-followup" type="date" value={form.followUpDate} onChange={(e) => setForm((f) => ({ ...f, followUpDate: e.target.value }))} className={`${FIELD} w-auto`} />
            </div>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || !form.body.trim()}
            className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {saving ? 'Saving...' : editId ? '✓ Update' : '✓ Save Entry'}
          </button>
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <div className="p-8 text-center text-gray-500 dark:text-slate-400">Loading...</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center text-gray-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
          <div className="mb-2 text-3xl">📋</div>
          {standalone && !effId ? 'Pick a client or caregiver to see their log' : 'No communication log entries yet'}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((log) => {
            const ti = typeInfo(log.logType)
            const pinned = log.isPinned
            const openFollowUp = !!log.followUpDate && !log.followUpDone
            return (
              <div
                key={log.id}
                className={`relative rounded-lg border border-l-4 px-4 py-3 ${ti.edge} ${pinned
                  ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'
                  : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800'}`}
              >
                <div className="mb-1.5 flex flex-wrap items-start justify-between gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ti.chip}`}>{ti.icon} {ti.label}</span>
                    {log.direction && log.direction !== 'internal' && (
                      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-slate-700 dark:text-slate-200">
                        {log.direction === 'inbound' ? '↙ In' : '↗ Out'}
                      </span>
                    )}
                    {pinned && <span className="text-xs">📌</span>}
                    {openFollowUp && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                        ⏰ Follow-up: {formatDate(log.followUpDate, { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => togglePin(log)} title={pinned ? 'Unpin' : 'Pin'} className={ICON_BTN}>📌</button>
                    {openFollowUp && (
                      <button type="button" onClick={() => markFollowUpDone(log.id)} title="Mark follow-up done" className={`${ICON_BTN} text-emerald-700 dark:text-emerald-400`}>✓</button>
                    )}
                    <button type="button" onClick={() => startEdit(log)} title="Edit" className={ICON_BTN}>✏️</button>
                    {mayDelete && (
                      <button type="button" onClick={() => deleteLog(log.id)} title="Delete" className={`${ICON_BTN} text-red-700 dark:text-red-400`}>🗑</button>
                    )}
                  </div>
                </div>
                {log.subject && <div className="mb-1 text-sm font-semibold text-gray-900 dark:text-slate-100">{log.subject}</div>}
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-slate-200">{log.body}</div>
                <div className="mt-2 text-xs text-gray-600 dark:text-slate-400">
                  {log.loggedByName || 'Admin'} · {fmt(log.createdAt)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
