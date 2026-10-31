// Job Checklists (server crm/field/checklistRoutes.ts, /api/checklists): the checklists the business builds for its own
// kinds of job. The tech fills one in on the phone; the customer can sign it on site. A job gets the checklists that
// name its job type, plus any that name none (those are for every job).
import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, Loader2, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

type FieldType = 'pass_fail' | 'yes_no' | 'text' | 'dropdown' | 'multi_select' | 'number' | 'date' | 'photo' | 'signature' | 'section'
/** `optionsText` is only the box the owner types the choices into (one per line); the server's `options` is what is kept. */
interface Q { id?: string; label: string; type: FieldType; required: boolean; options?: string[]; optionsText?: string }
interface Checklist { id: string; name: string; description: string | null; active: boolean; fields: Q[]; jobTypes: string[]; requireSignature: boolean; requirePhoto: boolean }
interface Draft { id?: string; name: string; description: string; fields: Q[]; jobTypes: string; requireSignature: boolean; requirePhoto: boolean; active: boolean }

const TYPE_WORDS: Record<FieldType, string> = {
  pass_fail: 'Pass / Fail / Needs attention', yes_no: 'Yes / No', text: 'Write-in', dropdown: 'Pick one from a list', multi_select: 'Pick several from a list',
  number: 'Number', date: 'Date', photo: 'Photo', signature: 'Signature', section: 'Heading (groups the questions under it)',
}
const hasChoices = (t: FieldType) => t === 'dropdown' || t === 'multi_select'
const optionsOf = (f: Q) => (f.optionsText ?? (f.options ?? []).join('\n')).split('\n').map((x) => x.trim()).filter(Boolean)
const box = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900'
const input = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const btn = 'rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50'
const ghost = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800'
const blank = (): Draft => ({ name: '', description: '', fields: [{ label: '', type: 'pass_fail', required: true }], jobTypes: '', requireSignature: false, requirePhoto: false, active: true })
const toDraft = (c: Checklist): Draft => ({ id: c.id, name: c.name, description: c.description || '', fields: c.fields.map((f) => ({ ...f, optionsText: (f.options ?? []).join('\n') })), jobTypes: c.jobTypes.join(', '), requireSignature: c.requireSignature, requirePhoto: c.requirePhoto, active: c.active })

function Editor({ draft, onChange, onSave, onCancel, busy }: { draft: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  const setQ = (i: number, patch: Partial<Q>) => onChange({ ...draft, fields: draft.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) })
  const move = (i: number, by: number) => {
    const to = i + by
    if (to < 0 || to >= draft.fields.length) return
    const next = [...draft.fields]; [next[i], next[to]] = [next[to], next[i]]
    onChange({ ...draft, fields: next })
  }
  return (
    <section className={box} aria-label={draft.id ? 'Edit checklist' : 'New checklist'}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm text-gray-800 dark:text-slate-200">Name<input className={input} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="Furnace tune-up" /></label>
        <label className="grid gap-1 text-sm text-gray-800 dark:text-slate-200">For these kinds of job
          <input className={input} value={draft.jobTypes} onChange={(e) => onChange({ ...draft, jobTypes: e.target.value })} placeholder="Furnace tune-up, Install (leave empty for every job)" />
        </label>
        <label className="grid gap-1 text-sm text-gray-800 dark:text-slate-200 md:col-span-2">Note for the tech (optional)<input className={input} value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} /></label>
      </div>

      <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-slate-100">Questions</h3>
      <ol className="mt-1 grid gap-2">
        {draft.fields.map((f, i) => (
          <li key={f.id ?? i} className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-sm text-gray-600 dark:text-slate-300">{i + 1}.</span>
              <input aria-label={f.type === 'section' ? `Heading ${i + 1}` : `Question ${i + 1}`} className={`${input} min-w-[14rem] flex-1 ${f.type === 'section' ? 'font-semibold' : ''}`} value={f.label} onChange={(e) => setQ(i, { label: e.target.value })} placeholder={f.type === 'section' ? 'Name this group of questions' : 'What should the tech check?'} />
              <select aria-label={`Answer for question ${i + 1}`} className={input} value={f.type} onChange={(e) => setQ(i, { type: e.target.value as FieldType, ...(e.target.value === 'section' ? { required: false } : {}) })}>
                {(Object.keys(TYPE_WORDS) as FieldType[]).map((k) => <option key={k} value={k}>{TYPE_WORDS[k]}</option>)}
              </select>
              {f.type !== 'section' && <label className="flex items-center gap-1 text-sm text-gray-800 dark:text-slate-200"><input type="checkbox" checked={f.required} onChange={(e) => setQ(i, { required: e.target.checked })} />Must be answered</label>}
              <button type="button" aria-label={`Move question ${i + 1} up`} className={ghost} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label={`Move question ${i + 1} down`} className={ghost} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
              <button type="button" aria-label={`Remove question ${i + 1}`} className="text-red-700 dark:text-red-300" onClick={() => onChange({ ...draft, fields: draft.fields.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button>
            </div>
            {hasChoices(f.type) && (
              <label className="ml-8 grid gap-1 text-sm text-gray-800 dark:text-slate-200">Choices, one per line (at least two)
                <textarea aria-label={`Choices for question ${i + 1}`} rows={3} className={input} value={f.optionsText ?? ''} onChange={(e) => setQ(i, { optionsText: e.target.value })} placeholder={'16x25\n20x25\n20x20'} />
              </label>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className={`${ghost} mt-2`} onClick={() => onChange({ ...draft, fields: [...draft.fields, { label: '', type: 'pass_fail', required: true }] })}><Plus className="mr-1 inline h-4 w-4" />Add a question</button>
      <button type="button" className={`${ghost} ml-2 mt-2`} onClick={() => onChange({ ...draft, fields: [...draft.fields, { label: '', type: 'section', required: false }] })}><Plus className="mr-1 inline h-4 w-4" />Add a heading</button>

      <div className="mt-4 grid gap-1 text-sm text-gray-800 dark:text-slate-200">
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.requireSignature} onChange={(e) => onChange({ ...draft, requireSignature: e.target.checked })} />The customer signs it on site</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.requirePhoto} onChange={(e) => onChange({ ...draft, requirePhoto: e.target.checked })} />The job needs a photo before it can be sent</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.active} onChange={(e) => onChange({ ...draft, active: e.target.checked })} />In use</label>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className={btn} disabled={busy} onClick={onSave}>Save checklist</button>
        <button type="button" className={ghost} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  )
}

export default function ChecklistsPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('settings:update')
  const [rows, setRows] = useState<Checklist[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setRows(((await api.get('/api/checklists/templates')) as any)?.data ?? []) }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Your checklists could not be loaded.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    setBusy(true)
    const body = {
      name: draft.name, description: draft.description || null, fields: draft.fields.map((f) => ({ ...(f.id ? { id: f.id } : {}), label: f.label, type: f.type, required: f.type === 'section' ? false : f.required, ...(hasChoices(f.type) ? { options: optionsOf(f) } : {}) })),
      jobTypes: draft.jobTypes.split(',').map((x) => x.trim()).filter(Boolean), requireSignature: draft.requireSignature, requirePhoto: draft.requirePhoto, active: draft.active,
    }
    try {
      if (draft.id) await api.put(`/api/checklists/templates/${draft.id}`, body); else await api.post('/api/checklists/templates', body)
      toast.success('Checklist saved'); setDraft(null); await load()
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : 'The checklist could not be saved') } finally { setBusy(false) }
  }
  const remove = async (c: Checklist) => {
    try {
      const r: any = await api.delete(`/api/checklists/templates/${c.id}`)
      toast.success(r?.archived ? 'It has been filled in on jobs, so it was switched off and kept' : 'Checklist removed'); await load()
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : 'Could not remove it') }
  }

  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>
  if (!rows) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-slate-100"><ClipboardCheck className="h-6 w-6" aria-hidden />Job Checklists</h1>
          <p className="text-sm text-gray-600 dark:text-slate-300">Build the checklist for each kind of job. Your techs fill it in on the phone, and the customer can sign it on site. Set a job’s kind on the job itself.</p>
        </div>
        {mayEdit && !draft && <button type="button" className={btn} onClick={() => setDraft(blank())}><Plus className="mr-1 inline h-4 w-4" />New checklist</button>}
      </div>
      {draft && <Editor draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} busy={busy} />}
      {rows.length === 0 && !draft && <p className="text-sm text-gray-700 dark:text-slate-300">No checklists yet.</p>}
      {rows.map((c) => (
        <section key={c.id} className={box} aria-label={c.name}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{c.name}{!c.active && <span className="ml-2 text-xs font-normal text-gray-600 dark:text-slate-300">(not in use)</span>}</h2>
            {mayEdit && <div className="flex gap-2"><button type="button" className={ghost} onClick={() => setDraft(toDraft(c))}>Edit</button><button type="button" className={ghost} onClick={() => remove(c)}>Remove</button></div>}
          </div>
          <p className="text-sm text-gray-600 dark:text-slate-300">
            {c.jobTypes.length ? `For: ${c.jobTypes.join(', ')}` : 'For every job'} · {c.fields.filter((f) => f.type !== 'section').length} question{c.fields.filter((f) => f.type !== 'section').length === 1 ? '' : 's'}{c.fields.some((f) => f.type === 'section') ? ` in ${c.fields.filter((f) => f.type === 'section').length} group${c.fields.filter((f) => f.type === 'section').length === 1 ? '' : 's'}` : ''}
            {c.requireSignature ? ' · customer signs' : ''}{c.requirePhoto ? ' · needs a photo' : ''}
          </p>
        </section>
      ))}
    </div>
  )
}
