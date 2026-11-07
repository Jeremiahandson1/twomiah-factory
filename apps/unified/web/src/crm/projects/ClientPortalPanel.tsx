// The project's client portal, from the office (contractor parity row 10; client_portal_plus, not ready): what this project's
// client sees and is emailed about, which daily logs and files are shared, the client's to-dos, their comments on the schedule,
// and "tell the client". Server: crm/projects/clientPortal.ts (/api/client-portal). Reading asks projects:read; every change
// projects:update, the same as the server.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'
import { formatDate } from '../date'

type Settings = { schedule: 'off' | 'phases' | 'all'; scheduleWeeks: number | null; dailyLogs: boolean; photos: boolean; todos: boolean; payments: boolean; documents: boolean; shareByDefault: boolean; notify: Record<string, boolean> }
type Log = { id: string; date: string; workPerformed?: string | null; sharedWithClient?: boolean }
type Doc = { id: string; name: string; sharedWithCustomer?: boolean }
type Todo = { id: string; title: string; status: string; dueDate?: string | null; checklist?: Array<{ text: string; done: boolean }> }
type Comment = { id: string; taskId: string; taskName: string; body: string; fromClient: boolean; createdAt: string }

const box = 'rounded-lg border border-gray-200 p-3 dark:border-slate-700'
const muted = 'text-xs text-gray-500 dark:text-slate-400'
const input = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900'

export function ClientPortalPanel({ projectId }: { projectId: string }) {
  const toast = useToast()
  const { known, can } = usePermissions()
  const mayChange = known && can('projects:update')
  const [s, setS] = useState<Settings | null>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [todoDraft, setTodoDraft] = useState({ title: '', dueDate: '', checklist: '' })
  const [reply, setReply] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const pick = (r: any) => (Array.isArray(r) ? r : r?.data || [])
    const [st, lg, dc, td, cm] = await Promise.all([
      api.get(`/api/client-portal/${projectId}/settings`).catch(() => null),
      api.get(`/api/daily-logs?projectId=${projectId}&limit=50`).catch(() => ({ data: [] })),
      api.get(`/api/documents?projectId=${projectId}`).catch(() => ({ data: [] })),
      api.get(`/api/client-portal/${projectId}/todos`).catch(() => ({ data: [] })),
      api.get(`/api/client-portal/${projectId}/comments`).catch(() => ({ data: [] })),
    ])
    setS(st as Settings | null)
    setLogs(pick(lg).map((r: any) => r.dailyLog ?? r))
    setDocs(pick(dc))
    setTodos(pick(td))
    setComments(pick(cm))
  }, [projectId])
  useEffect(() => { load() }, [load])
  if (!s) return null

  const fail = (e: unknown, words: string) => toast.error(e instanceof Error && e.message ? e.message : words)
  const save = async (patch: Partial<Settings>) => {
    try { setS(await api.put(`/api/client-portal/${projectId}/settings`, patch) as Settings) } catch (e) { fail(e, 'Could not save that') }
  }
  const shareLog = async (l: Log, shared: boolean) => {
    try { const r: any = await api.put(`/api/client-portal/daily-logs/${l.id}/share`, { shared }); if (r?.told === 'email') toast.success('Shared, and the client was emailed'); load() } catch (e) { fail(e, 'Could not share it') }
  }
  const shareDoc = async (dd: Doc, shared: boolean) => {
    try { await api.put(`/api/client-portal/documents/${dd.id}/share`, { shared }); load() } catch (e) { fail(e, 'Could not share it') }
  }
  const addTodo = async () => {
    if (!todoDraft.title.trim()) { toast.error('Give the to-do a title'); return }
    const checklist = todoDraft.checklist.split('\n').map((x) => x.trim()).filter(Boolean).map((text) => ({ text, done: false }))
    try {
      await api.post(`/api/client-portal/${projectId}/todos`, { title: todoDraft.title.trim(), ...(todoDraft.dueDate ? { dueDate: todoDraft.dueDate } : {}), ...(checklist.length ? { checklist } : {}) })
      setTodoDraft({ title: '', dueDate: '', checklist: '' }); load()
    } catch (e) { fail(e, 'Could not add the to-do') }
  }
  const removeTodo = async (id: string) => { try { await api.delete(`/api/client-portal/todos/${id}`); load() } catch (e) { fail(e, 'Could not remove it') } }
  const answer = async (taskId: string) => {
    const body = (reply[taskId] || '').trim()
    if (!body) return
    try { await api.post(`/api/client-portal/${projectId}/tasks/${taskId}/comments`, { body }); setReply((r) => ({ ...r, [taskId]: '' })); load() } catch (e) { fail(e, 'Could not send that') }
  }
  const tell = async (what: 'schedule' | 'files') => {
    try { await api.post(`/api/client-portal/${projectId}/notify`, { what }); toast.success('The client was emailed') } catch (e) { fail(e, 'Could not reach the client') }
  }
  const tick = (key: keyof Settings, label: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!mayChange} checked={!!s[key]} onChange={(e) => save({ [key]: e.target.checked } as any)} />{label}</label>
  )
  const mail = (key: string, label: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!mayChange} checked={!!s.notify?.[key]} onChange={(e) => save({ notify: { [key]: e.target.checked } } as any)} />{label}</label>
  )
  const byTask = comments.reduce<Record<string, Comment[]>>((acc, c) => { (acc[c.taskId] ||= []).push(c); return acc }, {})

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6 space-y-4" data-testid="client-portal-panel">
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Client portal</h2>
        <p className={muted}>What the client sees on this project in their portal, and what they are emailed about.</p>
      </div>

      <div className={box}>
        <p className="text-sm font-medium mb-2">They see</p>
        <label className="flex items-center gap-2 text-sm mb-2">Schedule
          <select aria-label="Schedule the client sees" disabled={!mayChange} value={s.schedule} onChange={(e) => save({ schedule: e.target.value as Settings['schedule'] })} className={input}>
            <option value="off">Not shown</option><option value="phases">Phases only</option><option value="all">Every task</option>
          </select>
          {s.schedule !== 'off' && (
            <select aria-label="How far ahead" disabled={!mayChange} value={s.scheduleWeeks ?? ''} onChange={(e) => save({ scheduleWeeks: e.target.value ? Number(e.target.value) : null })} className={input}>
              <option value="">all of it</option><option value="2">2 weeks ahead</option><option value="4">4 weeks ahead</option><option value="8">8 weeks ahead</option><option value="12">12 weeks ahead</option>
            </select>
          )}
        </label>
        <div className="flex flex-wrap gap-4">{tick('dailyLogs', 'Daily logs you share')}{tick('photos', 'Photos & files you share')}{tick('todos', 'Their to-dos')}</div>
        <p className="text-sm font-medium mt-3 mb-2">Email them when</p>
        <div className="flex flex-wrap gap-4">{mail('dailyLogs', 'a daily log is shared')}{mail('todos', 'a to-do is added')}</div>
        {mayChange && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => tell('schedule')} className="rounded-lg border px-3 py-1 text-sm dark:border-slate-600">Tell them the schedule changed</button>
            <button type="button" onClick={() => tell('files')} className="rounded-lg border px-3 py-1 text-sm dark:border-slate-600">Tell them about new files</button>
          </div>
        )}
      </div>

      {s.dailyLogs && logs.length > 0 && (
        <div className={box} data-testid="share-daily-logs">
          <p className="text-sm font-medium mb-2">Daily logs</p>
          <ul className="space-y-1">
            {logs.map((l) => (
              <li key={l.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Share the log of ${formatDate(l.date)}`} disabled={!mayChange} checked={!!l.sharedWithClient} onChange={(e) => shareLog(l, e.target.checked)} />{formatDate(l.date)}<span className={`${muted} truncate`}>{l.workPerformed || ''}</span></label></li>
            ))}
          </ul>
        </div>
      )}

      {s.photos && docs.length > 0 && (
        <div className={box} data-testid="share-files">
          <p className="text-sm font-medium mb-2">Photos &amp; files</p>
          <ul className="space-y-1">
            {docs.map((dd) => (
              <li key={dd.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Share ${dd.name}`} disabled={!mayChange} checked={!!dd.sharedWithCustomer} onChange={(e) => shareDoc(dd, e.target.checked)} />{dd.name}</label></li>
            ))}
          </ul>
        </div>
      )}

      {s.todos && (
        <div className={box} data-testid="client-todos-office">
          <p className="text-sm font-medium mb-2">Their to-dos</p>
          {todos.length === 0 ? <p className={muted}>None yet.</p> : (
            <ul className="space-y-1 mb-2">
              {todos.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className={t.status === 'done' ? 'line-through' : ''}>{t.title}{t.dueDate ? <span className={muted}> · due {formatDate(t.dueDate)}</span> : null}{t.checklist?.length ? <span className={muted}> · {t.checklist.filter((c) => c.done).length}/{t.checklist.length}</span> : null}</span>
                  {mayChange && <button type="button" onClick={() => removeTodo(t.id)} aria-label={`Remove ${t.title}`} className="text-red-700 dark:text-red-300">×</button>}
                </li>
              ))}
            </ul>
          )}
          {mayChange && (
            <div className="grid gap-2 sm:grid-cols-3">
              <input aria-label="To-do title" value={todoDraft.title} onChange={(e) => setTodoDraft({ ...todoDraft, title: e.target.value })} placeholder="Pick a paint colour" className={input} />
              <input aria-label="To-do due date" type="date" value={todoDraft.dueDate} onChange={(e) => setTodoDraft({ ...todoDraft, dueDate: e.target.value })} className={input} />
              <button type="button" onClick={addTodo} className="rounded-lg bg-orange-600 px-3 py-1 text-sm text-white hover:bg-orange-700">Add to-do</button>
              <textarea aria-label="To-do checklist" value={todoDraft.checklist} onChange={(e) => setTodoDraft({ ...todoDraft, checklist: e.target.value })} placeholder="Checklist, one item per line (optional)" rows={2} className={`${input} sm:col-span-3`} />
            </div>
          )}
        </div>
      )}

      {comments.length > 0 && (
        <div className={box} data-testid="client-comments">
          <p className="text-sm font-medium mb-2">Comments on the schedule</p>
          {Object.entries(byTask).map(([taskId, list]) => (
            <div key={taskId} className="mb-3">
              <p className="text-sm font-medium">{list[0].taskName}</p>
              {list.map((c) => <p key={c.id} className="text-sm"><span className="font-medium">{c.fromClient ? 'Client' : 'You'}:</span> {c.body}</p>)}
              {mayChange && (
                <div className="mt-1 flex gap-2">
                  <input aria-label={`Answer on ${list[0].taskName}`} value={reply[taskId] || ''} onChange={(e) => setReply((r) => ({ ...r, [taskId]: e.target.value }))} className={`${input} flex-1`} />
                  <button type="button" onClick={() => answer(taskId)} className="rounded-lg border px-3 py-1 text-sm dark:border-slate-600">Answer</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
