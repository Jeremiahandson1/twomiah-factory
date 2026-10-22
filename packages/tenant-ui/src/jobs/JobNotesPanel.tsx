// A job's running notes: who wrote what, when, newest first. Live test 2026-10-22 (contractor, landscaping): the job
// page had one Notes field inside the edit form and no log, so a crew's "gate code changed" overwrote the office's
// "customer away until Tuesday". The server half is /api/comments (any record's comments, under the record's own
// permission: reading a job's notes is jobs:read, adding one jobs:update).
import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { MessageSquare } from 'lucide-react'
import { Button, errMsg } from '../invoicing/ui'
import type { JobsApi, JobsToast } from './types'

interface Note { id: string; content: string; createdAt: string; user?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null }

const card = 'bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6'

/** "Oct 22, 2026, 3:04 PM" on the business's own clock when it is known (the browser's is somebody else's). */
export const whenWritten = (iso: string, timeZone?: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(d)
}
const author = (n: Note) => [n.user?.firstName, n.user?.lastName].filter(Boolean).join(' ') || n.user?.email || 'Someone'

export function JobNotesPanel({ api, toast, jobId, mayWrite, timeZone }: { api: JobsApi; toast: JobsToast; jobId: string; mayWrite: boolean; timeZone?: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setFailed(null)
    try {
      const r = await api.get(`/api/comments/job/${jobId}`)
      const rows: Note[] = Array.isArray(r) ? r : r?.data || []
      setNotes([...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)))
    } catch (err) { setNotes([]); setFailed(errMsg(err, 'The notes could not be loaded')) }
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content) return
    setSaving(true)
    try { await api.post(`/api/comments/job/${jobId}`, { content }); setDraft(''); toast.success('Note added'); load() }
    catch (err) { toast.error(errMsg(err, 'The note could not be saved')) }
    finally { setSaving(false) }
  }

  return (
    <div className={card}>
      <h2 className="font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-slate-100"><MessageSquare className="w-4 h-4" /> Notes{notes && notes.length ? ` (${notes.length})` : ''}</h2>
      {mayWrite && (
        <form onSubmit={add} className="mb-4">
          <label htmlFor={`job-note-${jobId}`} className="sr-only">Add a note</label>
          <textarea id={`job-note-${jobId}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={5000} placeholder="Add a note for the team…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600" />
          <div className="mt-2 flex justify-end"><Button type="submit" disabled={saving || !draft.trim()}>{saving ? 'Saving…' : 'Add note'}</Button></div>
        </form>
      )}
      {failed && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{failed}</p>}
      {notes === null && !failed && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}
      {notes && !notes.length && !failed && <p className="text-sm text-gray-500 dark:text-slate-400">No notes yet.</p>}
      {notes && notes.length > 0 && (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0 dark:border-slate-800">
              <p className="text-xs text-gray-500 dark:text-slate-400"><span className="font-medium text-gray-700 dark:text-slate-200">{author(n)}</span> · {whenWritten(n.createdAt, timeZone)}</p>
              <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap break-words dark:text-slate-200">{n.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
