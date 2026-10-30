// Settings › Intake & consent forms (server crm/salon/intakeForms.ts, /api/intake-forms; hidden feature `intake_forms`):
// the questions a client answers, or the agreement they tick and sign by typing their name, when they book online.
// Offered once per client, per form; the answers are kept as asked and show on the client's chart.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Loader2, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, usePermissions, useConfirm } from '../../../shared'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const fieldClass = 'mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

type QType = 'text' | 'longtext' | 'yesno' | 'choice' | 'consent'
interface Question { id?: string; label: string; type: QType; required: boolean; options?: string[] }
interface Form { id: string; name: string; kind: 'intake' | 'consent'; intro: string | null; questions: Question[]; serviceIds: string[]; active: boolean }
interface MenuItem { id: string; name: string }
const TYPE_WORDS: Record<QType, string> = { text: 'Short answer', longtext: 'Long answer', yesno: 'Yes / no', choice: 'Pick one', consent: 'Agreement to tick' }
const blank = (): Form => ({ id: '', name: '', kind: 'intake', intro: '', questions: [{ label: '', type: 'text', required: false }], serviceIds: [], active: true })

export default function IntakeFormsSettingsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const { can, known } = usePermissions()
  const mayEdit = known && can('company:update')
  const [forms, setForms] = useState<Form[] | null>(null)
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [editing, setEditing] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = useCallback(() => {
    api.get('/api/intake-forms').then((r: any) => setForms((r?.data ?? r) || [])).catch((e: Error) => setLoadError(e.message || 'The forms could not be loaded.'))
  }, [])
  useEffect(() => {
    load()
    api.get('/api/service-menu').then((r: any) => setMenu((((r?.data ?? r) || []) as any[]).map((m) => ({ id: m.id, name: m.name })))).catch(() => setMenu([]))
  }, [load])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!forms) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const save = async () => {
    if (!editing) return
    setSaving(true); setProblem('')
    const body = {
      name: editing.name, kind: editing.kind, intro: editing.intro || '', active: editing.active, serviceIds: editing.serviceIds,
      questions: editing.questions.map((q) => ({ ...q, options: q.type === 'choice' ? (q.options || []) : undefined })),
    }
    try {
      if (editing.id) await api.put(`/api/intake-forms/${editing.id}`, body)
      else await api.post('/api/intake-forms', body)
      toast.success('Form saved')
      setEditing(null); load()
    } catch (e: any) {
      setProblem(e?.message || 'The form could not be saved.')
    } finally { setSaving(false) }
  }
  const remove = async (f: Form) => {
    if (!(await confirm(`Delete “${f.name}”? Clients will no longer be offered it. Answers already given stay on their charts.`, { title: 'Delete form', confirmText: 'Delete form' }))) return
    try { await api.delete(`/api/intake-forms/${f.id}`); toast.success('Form deleted'); load() } catch (e: any) { toast.error(e?.message || 'The form could not be deleted.') }
  }
  const setQ = (i: number, patch: Partial<Question>) => setEditing((f) => f && ({ ...f, questions: f.questions.map((q, k) => (k === i ? { ...q, ...patch } : q)) }))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><ClipboardList className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Intake &amp; consent forms</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          Questions a new client answers, or an agreement they tick and sign, after they book online. Each client is asked each form once; you read the
          answers on their chart.
        </p>
      </div>
      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see these forms. Only an owner or admin can change them.</p>}

      {!editing && (
        <section className={box} aria-label="Your forms">
          {forms.length === 0 ? <p className={hint}>No forms yet.</p> : (
            <ul className="divide-y divide-gray-100 dark:divide-slate-800">
              {forms.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-slate-100">{f.name} {!f.active && <span className="ml-1 text-xs text-gray-500 dark:text-slate-400">(paused)</span>}</p>
                    <p className={hint}>{f.kind === 'consent' ? 'Consent form' : 'Intake form'} · {f.questions.length} question{f.questions.length === 1 ? '' : 's'} · {f.serviceIds.length ? `only for ${f.serviceIds.length} service${f.serviceIds.length === 1 ? '' : 's'}` : 'every booking'}</p>
                  </div>
                  {mayEdit && (
                    <div className="flex gap-2">
                      <button onClick={() => { setProblem(''); setEditing(f) }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">Edit</button>
                      <button onClick={() => remove(f)} aria-label={`Delete ${f.name}`} className="rounded-lg border border-gray-300 p-1.5 text-red-700 hover:bg-red-50 dark:border-slate-600 dark:text-red-300 dark:hover:bg-red-950/40"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {mayEdit && <button onClick={() => { setProblem(''); setEditing(blank()) }} className="mt-4 flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-white hover:bg-teal-800"><Plus className="h-4 w-4" aria-hidden="true" /> New form</button>}
        </section>
      )}

      {editing && (
        <section className={box} aria-label="Edit form">
          <label className="block text-sm font-medium text-gray-900 dark:text-slate-100">Name
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={120} className={fieldClass} placeholder="Health history" />
          </label>
          <label className="mt-3 block text-sm font-medium text-gray-900 dark:text-slate-100">Kind
            <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as Form['kind'] })} className={fieldClass}>
              <option value="intake">Intake form — questions to answer</option>
              <option value="consent">Consent form — an agreement, signed by typing a name</option>
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-gray-900 dark:text-slate-100">A line above the questions (optional)
            <textarea value={editing.intro || ''} onChange={(e) => setEditing({ ...editing, intro: e.target.value })} rows={2} maxLength={1000} className={fieldClass} />
          </label>

          <h2 className="mt-5 text-sm font-semibold text-gray-900 dark:text-slate-100">Questions</h2>
          <ol className="mt-2 space-y-3">
            {editing.questions.map((q, i) => (
              <li key={i} className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap gap-2">
                  <input aria-label={`Question ${i + 1}`} value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} maxLength={300} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" placeholder={q.type === 'consent' ? 'I agree to…' : 'Any allergies?'} />
                  <select aria-label={`Question ${i + 1}: kind of answer`} value={q.type} onChange={(e) => setQ(i, { type: e.target.value as QType })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    {(Object.keys(TYPE_WORDS) as QType[]).map((t) => <option key={t} value={t}>{TYPE_WORDS[t]}</option>)}
                  </select>
                  <button onClick={() => setEditing({ ...editing, questions: editing.questions.filter((_, k) => k !== i) })} aria-label={`Remove question ${i + 1}`} className="rounded-lg border border-gray-300 p-2 text-red-700 hover:bg-red-50 dark:border-slate-600 dark:text-red-300 dark:hover:bg-red-950/40"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                </div>
                {q.type === 'choice' && (
                  <label className="mt-2 block text-xs font-medium text-gray-700 dark:text-slate-300">Choices, one per line (2 to 12)
                    <textarea value={(q.options || []).join('\n')} onChange={(e) => setQ(i, { options: e.target.value.split('\n') })} rows={3} className={fieldClass} />
                  </label>
                )}
                {q.type !== 'consent' && (
                  <label className="mt-2 flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} className="h-4 w-4" /> Must be answered</label>
                )}
              </li>
            ))}
          </ol>
          <button onClick={() => setEditing({ ...editing, questions: [...editing.questions, { label: '', type: editing.kind === 'consent' ? 'consent' : 'text', required: false }] })} className="mt-3 flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"><Plus className="h-4 w-4" aria-hidden="true" /> Add a question</button>

          <fieldset className="mt-5">
            <legend className="text-sm font-semibold text-gray-900 dark:text-slate-100">Who is asked</legend>
            <p className={hint}>Leave every service unticked to ask for every online booking.</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {menu.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
                  <input type="checkbox" className="h-4 w-4" checked={editing.serviceIds.includes(m.id)} onChange={(e) => setEditing({ ...editing, serviceIds: e.target.checked ? [...editing.serviceIds, m.id] : editing.serviceIds.filter((x) => x !== m.id) })} /> {m.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100"><input type="checkbox" className="h-4 w-4" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Offer this form to clients</label>

          {problem && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{problem}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-white hover:bg-teal-800 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save form</button>
            <button onClick={() => setEditing(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-900 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">Cancel</button>
          </div>
        </section>
      )}
    </div>
  )
}
