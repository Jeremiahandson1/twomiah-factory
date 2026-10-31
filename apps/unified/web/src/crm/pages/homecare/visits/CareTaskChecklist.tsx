// Moved from templates/crm-homecare/frontend/src/components/CareTaskChecklist.tsx.
// During a shift, the client's care tasks: tap Done / Skip / Refused, add a note. "Every visit" tasks are done on every
// shift; "Set times a week" tasks show "done earlier this week" once any shift this week has completed them (the same
// labels as Care Tasks in the office). Shown on the caregiver's active shift.
//
// Server: GET /api/care-tasks/time-entry/:id ({ data } rows: taskId, taskName, description, category, allottedMinutes,
// cadence, status, notes, doneThisWeek) and PUT /api/care-tasks/time-entry/:id/:taskId { status, notes }
// (server/crm/homecare/clients/careTasks.ts). Changes: no token; the rows are camelCase (task_id → taskId …);
// the dialog's buttons are hc-btn (the app's stylesheet also defines .btn).
import { useEffect, useState } from 'react'
import { api, rows, errorMessage } from '../lib/http'

const CATEGORY_LABELS: Record<string, string> = {
  adl: 'ADL', iadl: 'IADL', medication: 'Med', companion: 'Companion', safety: 'Safety', other: 'Other',
}

// Each status is a complete pair: ground + ink, in both themes.
const STATUS: Record<string, { card: string; chip: string; label: string }> = {
  pending: { card: 'bg-white border-gray-300 dark:bg-slate-800 dark:border-slate-600', chip: 'text-gray-600 dark:text-slate-300', label: '⬜ Pending' },
  completed: { card: 'bg-emerald-50 border-emerald-500 dark:bg-emerald-950 dark:border-emerald-600', chip: 'text-emerald-800 dark:text-emerald-200', label: '✅ Done' },
  skipped: { card: 'bg-amber-50 border-amber-500 dark:bg-amber-950 dark:border-amber-600', chip: 'text-amber-800 dark:text-amber-200', label: '↪️ Skipped' },
  refused: { card: 'bg-red-50 border-red-500 dark:bg-red-950 dark:border-red-600', chip: 'text-red-800 dark:text-red-200', label: '🚫 Refused' },
}

/** A row of GET /api/care-tasks/time-entry/:id. */
interface Item {
  taskId: string
  taskName: string
  description?: string | null
  category: string
  allottedMinutes: number | null
  cadence?: string | null
  status: string
  notes?: string | null
  doneThisWeek?: boolean
  isRequired?: boolean
}

export default function CareTaskChecklist({ timeEntryId, compact = false, onChange }: { timeEntryId: string; compact?: boolean; onChange?: () => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notesFor, setNotesFor] = useState<Item | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  // 'refuse': the same dialog, asking WHY the client refused; the reason is required (server too).
  const [notesMode, setNotesMode] = useState<'note' | 'refuse' | 'skip'>('note')
  const [notesError, setNotesError] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)

  const load = async () => {
    try {
      setItems(rows<Item>(await api.get(`/api/care-tasks/time-entry/${timeEntryId}`)))
    } catch (e) { setError(errorMessage(e, 'Could not load the care tasks')) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (timeEntryId) load() }, [timeEntryId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Returns the server's refusal (or '' when saved), so a dialog can keep itself open and say why.
  const setStatus = async (taskId: string, status: string, notes?: string | null): Promise<string> => {
    setError('')
    try {
      await api.put(`/api/care-tasks/time-entry/${timeEntryId}/${taskId}`, { status, notes: notes ?? null })
      setItems((prev) => prev.map((it) => it.taskId === taskId ? { ...it, status, notes: notes ?? it.notes } : it))
      onChange?.()
      return ''
    } catch (e) {
      const status0 = (e as { status?: number })?.status === 0
      const msg = status0 ? 'Not saved — check your connection and try again' : errorMessage(e, 'Not saved — try again')
      setError(msg)
      return msg
    }
  }

  const openNotes = (t: Item, mode: 'note' | 'refuse' | 'skip') => {
    setNotesFor(t); setNotesMode(mode); setNotesDraft(t.notes || ''); setNotesError('')
  }

  const saveNotes = async () => {
    if (!notesFor) return
    const refusing = notesMode === 'refuse'
    const skipping = notesMode === 'skip'
    if (refusing && !notesDraft.trim()) { setNotesError('Say why the client refused — the office needs the reason.'); return }
    if (skipping && !notesDraft.trim()) { setNotesError('Say why you are skipping this — it is a required task, and the office needs the reason.'); return }
    setNotesSaving(true)
    const msg = await setStatus(notesFor.taskId, refusing ? 'refused' : skipping ? 'skipped' : notesFor.status, notesDraft)
    setNotesSaving(false)
    if (msg) { setNotesError(msg); return }
    setNotesFor(null)
    setNotesDraft('')
    setNotesError('')
  }

  if (loading) return <div className="p-3 text-center text-sm text-gray-600 dark:text-slate-400">Loading tasks…</div>
  if (!items.length) {
    return compact ? null : (
      <div className="p-3 text-center text-sm rounded-lg bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">
        {error || 'No care tasks set up for this client.'}
      </div>
    )
  }

  const done = items.filter((i) => i.status === 'completed').length
  const pct = Math.round((done / items.length) * 100)
  const daily = items.filter((t) => (t.cadence || 'daily') !== 'weekly')
  const weekly = items.filter((t) => (t.cadence || 'daily') === 'weekly')

  const btn = 'px-2.5 py-1.5 rounded-md text-xs font-semibold border'
  const renderItem = (t: Item) => {
    const sc = STATUS[t.status] || STATUS.pending
    const weeklyDone = t.cadence === 'weekly' && t.doneThisWeek
    return (
      <div key={t.taskId} className={`rounded-xl border-2 px-3 py-2.5 ${sc.card} ${weeklyDone && t.status !== 'completed' ? 'opacity-70' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1">
            <div className="font-semibold text-sm text-gray-900 dark:text-slate-100">{t.taskName}{t.isRequired && <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">Required</span>}</div>
            <div className="text-xs text-gray-600 dark:text-slate-400">
              {CATEGORY_LABELS[t.category] || t.category}
              {(t.allottedMinutes ?? 0) > 0 && ` · ${t.allottedMinutes} min`}
              {weeklyDone && ' · ✅ done earlier this week'}
            </div>
          </div>
          <span className={`text-xs font-bold ${sc.chip}`}>{sc.label}</span>
        </div>
        {t.description && <div className="text-xs mb-1.5 text-gray-600 dark:text-slate-300">{t.description}</div>}
        {t.notes && <div className="text-xs mb-1.5 px-2 py-1 rounded-md bg-black/5 text-gray-700 dark:bg-white/10 dark:text-slate-200">📝 {t.notes}</div>}
        <div className="flex flex-wrap gap-1.5">
          {t.status !== 'completed' && (
            <button type="button" onClick={() => setStatus(t.taskId, 'completed', t.notes)}
              className={`${btn} border-emerald-700 bg-emerald-700 text-white dark:border-emerald-700 dark:bg-emerald-700 dark:text-white`}>✓ Done</button>
          )}
          {t.status !== 'skipped' && (
            <button type="button" onClick={() => (t.isRequired ? openNotes(t, 'skip') : setStatus(t.taskId, 'skipped', t.notes))}
              className={`${btn} border-amber-500 bg-white text-amber-800 dark:border-amber-500 dark:bg-slate-900 dark:text-amber-200`}>Skip</button>
          )}
          {t.status !== 'refused' && (
            <button type="button" onClick={() => openNotes(t, 'refuse')}
              className={`${btn} border-red-500 bg-white text-red-800 dark:border-red-500 dark:bg-slate-900 dark:text-red-200`}>Refused</button>
          )}
          {t.status !== 'pending' && (
            <button type="button" onClick={() => setStatus(t.taskId, 'pending', t.notes)}
              className={`${btn} border-gray-300 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300`}>Reset</button>
          )}
          <button type="button" onClick={() => openNotes(t, 'note')}
            className={`${btn} ml-auto border-gray-300 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200`}>
            {t.notes ? '📝 Edit Note' : '📝 Add Note'}
          </button>
        </div>
      </div>
    )
  }

  const header = 'text-xs font-bold uppercase tracking-wide mt-1 mb-1.5 text-gray-600 dark:text-slate-400'
  return (
    <div className={compact ? 'py-2' : 'p-3'}>
      <div className="flex items-center justify-between mb-2">
        <strong className="text-sm text-gray-900 dark:text-slate-100">📋 Care Tasks</strong>
        <span className="text-xs text-gray-600 dark:text-slate-400">{done} of {items.length} done ({pct}%)</span>
      </div>
      <div className="h-1.5 rounded mb-2.5 overflow-hidden bg-gray-200 dark:bg-slate-700">
        <div className={`h-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {error && <div className="mb-2 px-3 py-2 rounded-md text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
      {daily.length > 0 && (
        <div className={weekly.length ? 'mb-3' : ''}>
          <div className={header}>📅 Every visit</div>
          <div className="flex flex-col gap-1.5">{daily.map(renderItem)}</div>
        </div>
      )}
      {weekly.length > 0 && (
        <div>
          <div className={header}>🗓️ Set times a week</div>
          <div className="flex flex-col gap-1.5">{weekly.map(renderItem)}</div>
        </div>
      )}

      {notesFor && (
        <div className="fixed inset-0 z-[2400] flex items-center justify-center p-4 bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setNotesFor(null) }}>
          <div className="w-full max-w-md rounded-xl p-5 bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100">
            <h4 className="m-0 mb-2 text-base font-semibold">
              {notesMode === 'refuse' ? `Refused: ${notesFor.taskName}` : notesMode === 'skip' ? `Skip: ${notesFor.taskName}` : `Note for: ${notesFor.taskName}`}
            </h4>
            {notesMode === 'refuse' && (
              <label htmlFor="task-refusal-reason" className="block mb-1 text-sm font-semibold text-gray-700 dark:text-slate-300">Why did the client refuse? (required)</label>
            )}
            {notesMode === 'skip' && (
              <label htmlFor="task-refusal-reason" className="block mb-1 text-sm font-semibold text-gray-700 dark:text-slate-300">Why are you skipping it? (required)</label>
            )}
            <textarea id="task-refusal-reason" value={notesDraft} onChange={(e) => { setNotesDraft(e.target.value); setNotesError('') }} rows={4}
              placeholder="e.g. Client refused — said she'd shower tomorrow"
              className="w-full p-2 mb-3 rounded-md border text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
            {notesError && <div role="alert" className="mb-3 px-3 py-2 rounded-md text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">{notesError}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setNotesFor(null)} className="hc-btn hc-btn-secondary hc-btn-sm">Cancel</button>
              <button type="button" onClick={saveNotes} disabled={notesSaving} className="hc-btn hc-btn-primary hc-btn-sm">
                {notesSaving ? 'Saving…' : notesMode === 'refuse' ? 'Mark Refused' : notesMode === 'skip' ? 'Mark Skipped' : 'Save Note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
