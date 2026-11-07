// The contractor's client portal, finished (contractor parity row 10; client_portal_plus, not ready): on the client's project
// page, what the builder chose to show them — the schedule (phases or every task) with a comment on each, the daily logs and
// their photos, the photos and files shared, and the client's own to-dos to tick off. Server: the unified app's
// crm/projects/clientPortal.ts behind /api/portal/p/:token/projects/:id/extras; it answers only what this client may see.
import React, { useCallback, useEffect, useState } from 'react'
import { usePortal } from './PortalContext'
import { formatDate } from './common'

type Comment = { id: string; body: string; fromClient: boolean; createdAt: string | null }
type Task = { id: string; name: string; startDate: string | null; endDate: string | null; progress: number; status: string; comments: Comment[] }
type Log = { id: string; date: string | null; weather: string | null; workPerformed: string | null; workCompleted: string | null; photos: Array<{ id: string; caption: string | null }> }
type FileRow = { id: string; name: string; type: string; mimeType: string | null; createdAt: string | null; image: boolean }
type Todo = { id: string; title: string; notes: string | null; checklist: Array<{ text: string; done: boolean }>; dueDate: string | null; status: string; completedAt: string | null }
export type ProjectExtras = { sections: { schedule: string; dailyLogs: boolean; photos: boolean; todos: boolean }; schedule?: Task[]; dailyLogs?: Log[]; files?: FileRow[]; todos?: Todo[] }

const h3 = 'font-semibold text-gray-900 mb-3 dark:text-slate-100'
const muted = 'text-sm text-gray-500 dark:text-slate-400'

export function PortalProjectExtras({ projectId }: { projectId: string }) {
  const { fetch: portalFetch, url } = usePortal()
  const [x, setX] = useState<ProjectExtras | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const load = useCallback(() => { portalFetch(`/projects/${projectId}/extras`).then(setX).catch(() => setX(null)) }, [portalFetch, projectId])
  useEffect(() => { load() }, [load])
  if (!x) return null

  const comment = async (taskId: string) => {
    const body = (draft[taskId] || '').trim()
    if (!body) return
    setErr('')
    try {
      await portalFetch(`/projects/${projectId}/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body }), headers: { 'Content-Type': 'application/json' } })
      setDraft((d) => ({ ...d, [taskId]: '' })); load()
    } catch (e) { setErr((e as Error).message || 'Could not send that') }
  }
  const tick = async (todoId: string, change: { item?: number; done?: boolean; complete?: boolean }) => {
    setErr('')
    try { await portalFetch(`/projects/${projectId}/todos/${todoId}`, { method: 'POST', body: JSON.stringify(change), headers: { 'Content-Type': 'application/json' } }); load() }
    catch (e) { setErr((e as Error).message || 'Could not save that') }
  }

  return (
    <div data-testid="project-extras">
      {err && <p role="alert" className="px-6 pt-4 text-sm text-red-700 dark:text-red-300">{err}</p>}
      {x.todos && x.todos.length > 0 && (
        <div className="p-6 border-b dark:border-slate-700" data-testid="client-todos">
          <h3 className={h3}>Your to-dos</h3>
          <ul className="space-y-3">
            {x.todos.map((t) => (
              <li key={t.id} className="rounded-lg border p-3 dark:border-slate-700">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`font-medium text-gray-900 dark:text-slate-100 ${t.status === 'done' ? 'line-through' : ''}`}>{t.title}</p>
                    {t.dueDate && <p className={muted}>Due {formatDate(t.dueDate)}</p>}
                    {t.notes && <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap dark:text-slate-200">{t.notes}</p>}
                  </div>
                  <button type="button" onClick={() => tick(t.id, { complete: t.status !== 'done' })} className="shrink-0 rounded-lg border px-3 py-1 text-sm dark:border-slate-600">{t.status === 'done' ? 'Reopen' : 'Mark done'}</button>
                </div>
                {t.checklist.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {t.checklist.map((c, i) => (
                      <li key={i}><label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200"><input type="checkbox" checked={c.done} onChange={(e) => tick(t.id, { item: i, done: e.target.checked })} />{c.text}</label></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {x.schedule && (
        <div className="p-6 border-b dark:border-slate-700" data-testid="client-schedule">
          <h3 className={h3}>Schedule</h3>
          {x.schedule.length === 0 ? <p className={muted}>Nothing on the schedule yet.</p> : (
            <ul className="space-y-3">
              {x.schedule.map((t) => (
                <li key={t.id} className="rounded-lg border p-3 dark:border-slate-700">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-gray-900 dark:text-slate-100">{t.name}</p>
                    <p className={muted}>{t.startDate ? formatDate(t.startDate) : 'Not yet dated'}{t.endDate && t.endDate !== t.startDate ? ` – ${formatDate(t.endDate)}` : ''}{t.progress ? ` · ${t.progress}% done` : ''}</p>
                  </div>
                  {t.comments.map((c) => (
                    <p key={c.id} className={`mt-2 text-sm ${c.fromClient ? 'text-gray-800 dark:text-slate-200' : 'text-orange-800 dark:text-orange-200'}`}><span className="font-medium">{c.fromClient ? 'You' : 'Your builder'}:</span> {c.body}</p>
                  ))}
                  <div className="mt-2 flex gap-2">
                    <input aria-label={`Comment on ${t.name}`} value={draft[t.id] || ''} onChange={(e) => setDraft((d) => ({ ...d, [t.id]: e.target.value }))} placeholder="Ask or comment" className="flex-1 rounded-lg border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
                    <button type="button" onClick={() => comment(t.id)} className="rounded-lg border px-3 py-1.5 text-sm dark:border-slate-600">Send</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {x.dailyLogs && x.dailyLogs.length > 0 && (
        <div className="p-6 border-b dark:border-slate-700" data-testid="client-daily-logs">
          <h3 className={h3}>Daily logs</h3>
          <ul className="space-y-4">
            {x.dailyLogs.map((l) => (
              <li key={l.id}>
                <p className="font-medium text-gray-900 dark:text-slate-100">{l.date ? formatDate(l.date) : ''}{l.weather ? <span className={muted}> · {l.weather}</span> : null}</p>
                {l.workPerformed && <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap dark:text-slate-200">{l.workPerformed}</p>}
                {l.workCompleted && <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap dark:text-slate-200">{l.workCompleted}</p>}
                {l.photos.length > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {l.photos.map((p, i) => {
                      const src = url(`/projects/${projectId}/files/log-photo/${l.id}:${p.id}`)
                      return <a key={p.id} href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={p.caption || `Site photo ${i + 1}`} loading="lazy" className="aspect-square w-full rounded object-cover bg-gray-100 dark:bg-slate-800" /></a>
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {x.files && x.files.length > 0 && (
        <div className="p-6 border-b dark:border-slate-700" data-testid="client-files">
          <h3 className={h3}>Photos &amp; files</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {x.files.map((f) => {
              const src = url(`/projects/${projectId}/files/document/${f.id}`)
              return (
                <a key={f.id} href={src} target="_blank" rel="noopener noreferrer" className="block rounded-lg border p-2 text-sm dark:border-slate-700" aria-label={`Open ${f.name}`}>
                  {f.image ? <img src={src} alt={f.name} loading="lazy" className="mb-1 aspect-square w-full rounded object-cover bg-gray-100 dark:bg-slate-800" /> : null}
                  <span className="block truncate text-gray-900 dark:text-slate-100">{f.name}</span>
                </a>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
