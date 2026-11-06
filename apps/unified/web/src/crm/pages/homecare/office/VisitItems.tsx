// Forms, interventions, goals and tasks inside a visit (care_visit_items): what the agency attaches to a client's visits, tasks that
// belong to every visit, the rule that a visit note is needed to clock out, and how each goal went.
//   GET|POST /api/visit-items, PUT|DELETE /api/visit-items/:id, GET /api/visit-items/goals/:clientId, GET|PUT /api/visit-items/settings
//   (server/crm/homecare/visits/visitItems.ts), GET /api/clients, GET /api/forms/templates
import { useCallback, useEffect, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { formatDateTime } from '../lib/datetime'
import { useMay } from '../lib/useMay'

type Kind = 'form' | 'intervention' | 'goal' | 'general_task'
interface Item { id: string; kind: Kind; name: string; detail: string | null; clientId: string | null; goalId: string | null; formTemplateId: string | null; required: boolean; isActive: boolean }
interface Person { id: string; firstName: string; lastName: string }
interface Template { id: string; name: string; isActive?: boolean }
interface GoalNote { id: string; goal: string; rating: string | null; status: string; note: string | null; startTime: string; caregiverFirst: string; caregiverLast: string }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const KIND: Record<Kind, string> = { form: 'Form', intervention: 'Intervention', goal: 'Goal', general_task: 'Task' }
const KIND_PLURAL: Record<Kind, string> = { form: 'Forms', intervention: 'Interventions', goal: 'Goals', general_task: 'Tasks' }
const RATING: Record<string, string> = { progress: 'Progress', no_change: 'No change', declined: 'Declined' }
const EMPTY = { kind: 'general_task' as Kind, name: '', detail: '', goalId: '', formTemplateId: '', required: false }
type Tab = 'items' | 'goals'

export default function VisitItems() {
  const may = useMay('care-clients')
  const toast = useToast()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('items')
  const [clients, setClients] = useState<Person[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [scope, setScope] = useState('') // '' = tasks for every visit
  const [items, setItems] = useState<Item[] | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [noteRequired, setNoteRequired] = useState<boolean | null>(null)
  const [goalNotes, setGoalNotes] = useState<GoalNote[] | null>(null)

  useEffect(() => {
    listAll('/api/clients').then((r) => setClients(rows<Person>(r))).catch(() => setClients([]))
    api.get('/api/forms/templates').then((r) => setTemplates(rows<Template>(r).filter((x) => x.isActive !== false))).catch(() => setTemplates([]))
    api.get('/api/visit-items/settings').then((r: any) => setNoteRequired(r?.noteRequired === true)).catch(() => setNoteRequired(null))
  }, [])

  const load = useCallback(() => {
    api.get('/api/visit-items').then((r) => setItems(rows<Item>(r))).catch((e) => toast.error(errorMessage(e, 'Could not load the items')))
  }, [toast])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (tab !== 'goals' || !scope) { setGoalNotes(null); return }
    api.get(`/api/visit-items/goals/${scope}`).then((r) => setGoalNotes(rows<GoalNote>(r))).catch((e) => toast.error(errorMessage(e, 'Could not load goal progress')))
  }, [tab, scope, toast])

  const here = (items || []).filter((i) => (scope ? i.clientId === scope : i.clientId === null))
  const goalsHere = (items || []).filter((i) => i.kind === 'goal' && i.clientId === scope)
  const kinds: Kind[] = scope ? ['form', 'intervention', 'goal', 'general_task'] : ['form', 'general_task']

  const save = async () => {
    const body = { kind: form.kind, name: form.name, detail: form.detail || null, clientId: scope || null, required: form.required,
      goalId: form.kind === 'intervention' ? form.goalId || null : null, formTemplateId: form.kind === 'form' ? form.formTemplateId : null }
    try {
      if (editing) await api.put(`/api/visit-items/${editing}`, body)
      else await api.post('/api/visit-items', { ...body, sortOrder: (items?.length ?? 0) + 1 })
      setForm(EMPTY); setEditing(null); load(); toast.success('Saved')
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const edit = (i: Item) => { setEditing(i.id); setForm({ kind: i.kind, name: i.name, detail: i.detail || '', goalId: i.goalId || '', formTemplateId: i.formTemplateId || '', required: i.required }) }
  const patch = async (i: Item, b: Partial<Item>) => { try { await api.put(`/api/visit-items/${i.id}`, b); load() } catch (e) { toast.error(errorMessage(e)) } }
  const remove = async (i: Item) => {
    if (!(await confirm(`Remove “${i.name}”? What caregivers already recorded stays on those visits.`, { danger: true }))) return
    try { await api.delete(`/api/visit-items/${i.id}`); if (editing === i.id) { setEditing(null); setForm(EMPTY) } load() } catch (e) { toast.error(errorMessage(e)) }
  }
  const saveNoteRule = async (on: boolean) => {
    try { setNoteRequired(((await api.put('/api/visit-items/settings', { noteRequired: on })) as any).noteRequired === true); toast.success('Saved') } catch (e) { toast.error(errorMessage(e)) }
  }

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === t} className={`hc-btn hc-btn-sm ${tab === t ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setTab(t)}>{label}</button>
  )

  return (
    <div className="p-4 max-w-4xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">In-visit forms, interventions and goals</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">What a caregiver works through during a visit, beside the client&apos;s care tasks. A required item must be finished (or skipped with a reason) before they can clock out.</p>

      <label className="text-sm flex items-center gap-2 mb-4">
        <input type="checkbox" checked={noteRequired === true} disabled={!may.update || noteRequired === null} onChange={(e) => saveNoteRule(e.target.checked)} />
        A visit note is required to clock out
      </label>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-sm">For<br />
          <select className={inp} value={scope} onChange={(e) => { setScope(e.target.value); setEditing(null); setForm(EMPTY) }} aria-label="Client">
            <option value="">Every visit (all clients)</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.lastName}, {c.firstName}</option>)}
          </select>
        </label>
        <div role="tablist" className="flex gap-2">{tabBtn('items', 'Items')}{tabBtn('goals', 'Goal progress')}</div>
      </div>

      {tab === 'items' && (
        <div>
          {items && here.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">{scope ? 'Nothing is set up for this client yet.' : 'No tasks for every visit yet.'}</p>}
          {(['form', 'intervention', 'goal', 'general_task'] as Kind[]).map((k) => {
            const list = here.filter((i) => i.kind === k)
            if (!list.length) return null
            return (
              <div key={k} className="mb-3">
                <h2 className="font-semibold text-sm mb-1">{KIND_PLURAL[k]}</h2>
                <ul className="divide-y divide-gray-200 dark:divide-slate-700 rounded-md border border-gray-200 dark:border-slate-700">
                  {list.map((i) => (
                    <li key={i.id} className="p-3 flex flex-wrap items-center gap-2" style={{ opacity: i.isActive ? 1 : 0.6 }}>
                      <div className="flex-1 min-w-[12rem]">
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-gray-600 dark:text-slate-400">
                          {KIND[i.kind]}{i.required ? ' · Required' : ''}{i.goalId ? ` · For goal “${(items || []).find((g) => g.id === i.goalId)?.name || ''}”` : ''}{i.detail ? ` · ${i.detail}` : ''}{i.isActive ? '' : ' · Switched off'}
                        </div>
                      </div>
                      {may.update && (
                        <div className="flex gap-1">
                          <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => patch(i, { isActive: !i.isActive })}>{i.isActive ? 'Switch off' : 'Switch on'}</button>
                          <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => edit(i)}>Edit</button>
                          <button type="button" className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => remove(i)}>Remove</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          {may.create && (
            <div className="rounded-md border border-gray-200 dark:border-slate-700 p-3 mt-3">
              <h2 className="font-semibold mb-2">{editing ? 'Edit' : 'Add'} {scope ? `for ${clients.find((c) => c.id === scope)?.firstName ?? 'this client'}` : 'a task for every visit'}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Type<br />
                  <select className={inp} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
                    {kinds.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
                  </select></label>
                {form.kind === 'form' ? (
                  <label className="text-sm">Form<br />
                    <select className={inp} value={form.formTemplateId} onChange={(e) => setForm({ ...form, formTemplateId: e.target.value })}>
                      <option value="">Pick a form…</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select></label>
                ) : <span />}
                <label className="text-sm sm:col-span-2">{form.kind === 'form' ? 'Name shown to the caregiver (optional)' : 'What it is'}<br />
                  <input className={`${inp} w-full`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200}
                    placeholder={form.kind === 'goal' ? 'e.g. Walk to the mailbox unaided' : form.kind === 'intervention' ? 'e.g. Walk the hall with the walker twice' : form.kind === 'general_task' ? 'e.g. Wash hands on arrival' : ''} /></label>
                {form.kind === 'intervention' && (
                  <label className="text-sm sm:col-span-2">For which goal<br />
                    <select className={inp} value={form.goalId} onChange={(e) => setForm({ ...form, goalId: e.target.value })}>
                      <option value="">No particular goal</option>
                      {goalsHere.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select></label>
                )}
                {form.kind !== 'form' && <label className="text-sm sm:col-span-2">More detail (optional)<br /><input className={`${inp} w-full`} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} maxLength={1000} /></label>}
                <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />Required to clock out</label>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" className="hc-btn hc-btn-primary" onClick={save}>{editing ? 'Save changes' : 'Add'}</button>
                {editing && <button type="button" className="hc-btn hc-btn-secondary" onClick={() => { setEditing(null); setForm(EMPTY) }}>Cancel</button>}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'goals' && (
        !scope ? <p className="text-sm text-gray-600 dark:text-slate-400">Pick a client to see how their goals have gone, visit by visit.</p>
          : goalNotes && goalNotes.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">No goal progress recorded for this client yet.</p>
          : goalNotes && (
            <table className="hc-table">
              <thead><tr><th>Visit</th><th>Goal</th><th>How it went</th><th>Caregiver</th><th>Note</th></tr></thead>
              <tbody>
                {goalNotes.map((g) => (
                  <tr key={g.id}>
                    <td>{formatDateTime(g.startTime)}</td>
                    <td>{g.goal}</td>
                    <td>{g.status === 'done' ? (RATING[g.rating || ''] || g.rating) : g.status === 'refused' ? 'Client refused' : 'Skipped'}</td>
                    <td>{g.caregiverFirst} {g.caregiverLast}</td>
                    <td>{g.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}
    </div>
  )
}
